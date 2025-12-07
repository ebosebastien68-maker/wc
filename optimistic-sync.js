// ============================================================================
// OPTIMISTIC SYNC - WORLD CONNECT
// ============================================================================
// Synchronisation instantanée avec mise à jour optimiste de l'UI
// Compatible avec service-worker.js v4.0.0
// ============================================================================

'use strict';

/**
 * Gestionnaire de synchronisation optimiste
 * Mise à jour instantanée de l'UI + sync en arrière-plan via Service Worker
 */
class OptimisticSyncManager {
  constructor() {
    this.supabaseUrl = null;
    this.supabaseKey = null;
    this.currentUser = null;
    this.swReady = false;
    this.pendingActions = new Map();
    this.retryQueue = [];
    
    this.init();
  }

  /**
   * Initialisation
   */
  async init() {
    console.log('🔄 Initialisation OptimisticSync...');
    
    // Attendre que le Service Worker soit prêt
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.ready;
        this.swReady = true;
        console.log('✅ Service Worker prêt');
        
        // Écouter les messages du SW
        this.listenToServiceWorker();
        
        // Vérifier l'état de la queue
        await this.checkSyncQueue();
      } catch (error) {
        console.warn('⚠️ Service Worker non disponible:', error);
        this.swReady = false;
      }
    }
  }

  /**
   * Configuration avec les credentials Supabase
   */
  configure(supabaseUrl, supabaseKey, currentUser) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.currentUser = currentUser;
    console.log('✅ OptimisticSync configuré pour:', currentUser?.id);
  }

  /**
   * Écouter les messages du Service Worker
   */
  listenToServiceWorker() {
    if (!navigator.serviceWorker.controller) return;
    
    navigator.serviceWorker.addEventListener('message', (event) => {
      const { type, action, error } = event.data;
      
      switch (type) {
        case 'SYNC_SUCCESS':
          this.handleSyncSuccess(action);
          break;
          
        case 'SYNC_FAILED':
          this.handleSyncFailure(action, error);
          break;
          
        case 'SW_ACTIVATED':
          console.log('🚀 Service Worker activé:', event.data.version);
          this.swReady = true;
          break;
      }
    });
  }

  /**
   * Vérifier l'état de la queue de synchronisation
   */
  async checkSyncQueue() {
    if (!this.swReady || !navigator.serviceWorker.controller) return;
    
    const channel = new MessageChannel();
    
    return new Promise((resolve) => {
      channel.port1.onmessage = (event) => {
        const { queue, processing } = event.data;
        console.log(`📊 Queue de sync: ${queue.length} action(s), processing: ${processing}`);
        resolve(queue);
      };
      
      navigator.serviceWorker.controller.postMessage(
        { type: 'GET_SYNC_QUEUE' },
        [channel.port2]
      );
    });
  }

  /**
   * Envoyer une action au Service Worker
   */
  async sendToServiceWorker(actionType, data) {
    if (!this.swReady || !navigator.serviceWorker.controller) {
      console.warn('⚠️ Service Worker non disponible, ajout à la queue locale');
      this.retryQueue.push({ actionType, data });
      return false;
    }
    
    try {
      navigator.serviceWorker.controller.postMessage({
        type: 'SYNC_ACTION',
        payload: {
          type: actionType,
          data: {
            supabaseUrl: this.supabaseUrl,
            supabaseKey: this.supabaseKey,
            userToken: this.currentUser?.token || this.currentUser?.session?.access_token,
            ...data
          }
        }
      });
      
      console.log('📤 Action envoyée au SW:', actionType);
      return true;
    } catch (error) {
      console.error('❌ Erreur envoi au SW:', error);
      return false;
    }
  }

  /**
   * Gérer le succès de synchronisation
   */
  handleSyncSuccess(action) {
    console.log('✅ Synchronisation réussie:', action.type);
    
    // Retirer de la map des actions en attente
    const pendingKey = `${action.type}_${action.data.articleId}_${Date.now()}`;
    this.pendingActions.delete(pendingKey);
    
    // Émettre un événement custom pour notifier l'UI
    window.dispatchEvent(new CustomEvent('optimistic-sync-success', {
      detail: { action }
    }));
  }

  /**
   * Gérer l'échec de synchronisation
   */
  handleSyncFailure(action, error) {
    console.error('❌ Échec de synchronisation:', action.type, error);
    
    // Annuler la mise à jour optimiste dans l'UI
    this.revertOptimisticUpdate(action);
    
    // Émettre un événement custom pour notifier l'UI
    window.dispatchEvent(new CustomEvent('optimistic-sync-failed', {
      detail: { action, error }
    }));
    
    // Afficher une notification à l'utilisateur
    if (window.ToastManager) {
      window.ToastManager.error(
        'Synchronisation échouée',
        'Vérifiez votre connexion Internet'
      );
    }
  }

  /**
   * Annuler une mise à jour optimiste
   */
  revertOptimisticUpdate(action) {
    switch (action.type) {
      case 'ADD_REACTION':
        this.revertReaction(action.data.articleId, action.data.reactionType, 'add');
        break;
        
      case 'REMOVE_REACTION':
        this.revertReaction(action.data.articleId, action.data.reactionType, 'remove');
        break;
        
      case 'ADD_COMMENT':
        this.revertComment(action.data.articleId, action.data.tempId);
        break;
    }
  }

  /**
   * Annuler une réaction
   */
  revertReaction(articleId, reactionType, originalAction) {
    const postElement = document.querySelector(`[data-article-id="${articleId}"]`);
    if (!postElement) return;
    
    const reactionBtn = postElement.querySelector(`[onclick*="${reactionType}"]`);
    if (!reactionBtn) return;
    
    const countElement = reactionBtn.querySelector('span');
    let currentCount = parseInt(countElement.textContent) || 0;
    
    // Inverser l'action
    if (originalAction === 'add') {
      currentCount = Math.max(0, currentCount - 1);
      reactionBtn.classList.remove('active');
    } else {
      currentCount++;
      reactionBtn.classList.add('active');
    }
    
    countElement.textContent = currentCount;
  }

  /**
   * Annuler un commentaire
   */
  revertComment(articleId, tempId) {
    const commentElement = document.querySelector(`[data-temp-id="${tempId}"]`);
    if (commentElement) {
      commentElement.classList.add('opacity-0', 'transition-opacity');
      setTimeout(() => commentElement.remove(), 300);
    }
  }

  /**
   * Forcer la synchronisation de la queue
   */
  async forceSyncQueue() {
    if (!this.swReady || !navigator.serviceWorker.controller) {
      console.warn('⚠️ Service Worker non disponible');
      return false;
    }
    
    console.log('🔄 Forçage de la synchronisation...');
    navigator.serviceWorker.controller.postMessage({
      type: 'FORCE_SYNC'
    });
    
    return true;
  }
}

// ============================================================================
// GESTION DES RÉACTIONS AVEC SYNC OPTIMISTE
// ============================================================================

class OptimisticReactionManager {
  constructor(syncManager) {
    this.syncManager = syncManager;
  }

  /**
   * Ajouter une réaction (mise à jour instantanée)
   */
  async addReaction(articleId, reactionType, userId) {
    // 1️⃣ MISE À JOUR INSTANTANÉE DE L'UI
    this.updateUIInstantly(articleId, reactionType, 'add');
    
    // 2️⃣ SYNCHRONISATION VIA SERVICE WORKER
    const sent = await this.syncManager.sendToServiceWorker('ADD_REACTION', {
      articleId,
      userId,
      reactionType
    });
    
    if (!sent) {
      console.warn('⚠️ Réaction en attente de synchronisation');
    }
  }

  /**
   * Retirer une réaction (mise à jour instantanée)
   */
  async removeReaction(articleId, reactionId, reactionType, userId) {
    // 1️⃣ MISE À JOUR INSTANTANÉE DE L'UI
    this.updateUIInstantly(articleId, reactionType, 'remove');
    
    // 2️⃣ SYNCHRONISATION VIA SERVICE WORKER
    const sent = await this.syncManager.sendToServiceWorker('REMOVE_REACTION', {
      articleId,
      reactionId,
      userId,
      reactionType
    });
    
    if (!sent) {
      console.warn('⚠️ Suppression en attente de synchronisation');
    }
  }

  /**
   * Mise à jour instantanée de l'interface
   */
  updateUIInstantly(articleId, reactionType, action) {
    const postElement = document.querySelector(`[data-article-id="${articleId}"]`);
    if (!postElement) return;
    
    const reactionButton = postElement.querySelector(`[onclick*="${reactionType}"]`);
    if (!reactionButton) return;
    
    const countElement = reactionButton.querySelector('span');
    let currentCount = parseInt(countElement.textContent) || 0;
    
    if (action === 'add') {
      currentCount++;
      reactionButton.classList.add('active');
      
      // Animation de succès
      reactionButton.classList.add('animate-bounce');
      setTimeout(() => reactionButton.classList.remove('animate-bounce'), 600);
    } else {
      currentCount = Math.max(0, currentCount - 1);
      reactionButton.classList.remove('active');
    }
    
    countElement.textContent = currentCount;
    
    // Animation du compteur
    countElement.style.transform = 'scale(1.3)';
    countElement.style.fontWeight = 'bold';
    setTimeout(() => {
      countElement.style.transform = 'scale(1)';
      countElement.style.fontWeight = '';
    }, 200);
  }
}

// ============================================================================
// GESTION DES COMMENTAIRES AVEC SYNC OPTIMISTE
// ============================================================================

class OptimisticCommentManager {
  constructor(syncManager) {
    this.syncManager = syncManager;
  }

  /**
   * Ajouter un commentaire (affichage instantané)
   */
  async addComment(articleId, content, userId, userName, userAvatar) {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 1️⃣ AFFICHAGE INSTANTANÉ
    this.displayCommentInstantly({
      id: tempId,
      article_id: articleId,
      commentaire: content,
      user_id: userId,
      user_name: userName,
      user_avatar: userAvatar,
      date_created: new Date().toISOString(),
      pending: true
    });
    
    // 2️⃣ SYNCHRONISATION VIA SERVICE WORKER
    const sent = await this.syncManager.sendToServiceWorker('ADD_COMMENT', {
      articleId,
      userId,
      content,
      tempId
    });
    
    if (!sent) {
      console.warn('⚠️ Commentaire en attente de synchronisation');
    }
  }

  /**
   * Supprimer un commentaire
   */
  async deleteComment(commentId, articleId, userId) {
    // 1️⃣ SUPPRESSION INSTANTANÉE DE L'UI
    const commentElement = document.querySelector(`[data-comment-id="${commentId}"]`);
    if (commentElement) {
      commentElement.style.opacity = '0.5';
      commentElement.style.pointerEvents = 'none';
    }
    
    // 2️⃣ SYNCHRONISATION VIA SERVICE WORKER
    const sent = await this.syncManager.sendToServiceWorker('DELETE_COMMENT', {
      commentId,
      articleId,
      userId
    });
    
    if (sent && commentElement) {
      setTimeout(() => commentElement.remove(), 300);
    }
  }

  /**
   * Afficher commentaire instantanément
   */
  displayCommentInstantly(comment) {
    const postElement = document.querySelector(`[data-article-id="${comment.article_id}"]`);
    if (!postElement) return;
    
    const commentsContainer = postElement.querySelector(`#comments-${comment.article_id}`);
    if (!commentsContainer) return;
    
    const commentHTML = `
      <div class="comment ${comment.pending ? 'opacity-70' : ''}" 
           data-comment-id="${comment.id}"
           data-temp-id="${comment.pending ? comment.id : ''}"
           style="padding: 12px; border-bottom: 1px solid var(--border-color); animation: slideInUp 0.3s ease;">
        <div style="display: flex; gap: 12px;">
          <img src="${comment.user_avatar || '/default-avatar.png'}" 
               alt="${comment.user_name}"
               style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
          <div style="flex: 1;">
            <div style="background: var(--bg-primary); border-radius: 12px; padding: 10px 14px;">
              <p style="font-weight: 700; font-size: 14px; margin-bottom: 4px; color: var(--text-primary);">
                ${this.escapeHtml(comment.user_name)}
              </p>
              <p style="font-size: 14px; line-height: 1.5; color: var(--text-primary);">
                ${this.escapeHtml(comment.commentaire)}
              </p>
            </div>
            <div style="margin-top: 6px; font-size: 12px; color: var(--text-tertiary); display: flex; gap: 8px; align-items: center;">
              <span>À l'instant</span>
              ${comment.pending ? '<span style="color: var(--accent-yellow);">⏳ Envoi en cours...</span>' : ''}
            </div>
          </div>
        </div>
      </div>
    `;
    
    commentsContainer.insertAdjacentHTML('afterbegin', commentHTML);
    
    // Scroll vers le nouveau commentaire
    const newComment = commentsContainer.firstElementChild;
    newComment.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Échapper HTML pour sécurité
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ============================================================================
// INITIALISATION GLOBALE
// ============================================================================

// Instances globales
let optimisticSync, reactionManager, commentManager;

/**
 * Initialiser OptimisticSync
 */
async function initOptimisticSync(supabaseUrl, supabaseKey, currentUser) {
  if (!optimisticSync) {
    optimisticSync = new OptimisticSyncManager();
    await optimisticSync.init();
  }
  
  if (supabaseUrl && supabaseKey && currentUser) {
    optimisticSync.configure(supabaseUrl, supabaseKey, currentUser);
    
    // Créer les gestionnaires
    reactionManager = new OptimisticReactionManager(optimisticSync);
    commentManager = new OptimisticCommentManager(optimisticSync);
    
    console.log('✅ OptimisticSync initialisé et configuré');
  }
  
  return optimisticSync;
}

/**
 * Obtenir les gestionnaires
 */
function getOptimisticManagers() {
  return {
    sync: optimisticSync,
    reactions: reactionManager,
    comments: commentManager
  };
}

/**
 * Forcer la synchronisation
 */
async function forceSyncQueue() {
  if (optimisticSync) {
    return await optimisticSync.forceSyncQueue();
  }
  return false;
}

/**
 * Vérifier l'état de la queue
 */
async function checkSyncQueueStatus() {
  if (optimisticSync) {
    return await optimisticSync.checkSyncQueue();
  }
  return [];
}

// ============================================================================
// ÉVÉNEMENTS GLOBAUX
// ============================================================================

// Écouter les événements de connexion/déconnexion
window.addEventListener('online', async () => {
  console.log('🌐 Connexion rétablie - Forçage de la synchronisation');
  await forceSyncQueue();
});

window.addEventListener('offline', () => {
  console.log('📡 Hors ligne - Les actions seront synchronisées à la reconnexion');
});

// Écouter les événements de synchronisation
window.addEventListener('optimistic-sync-success', (event) => {
  console.log('✅ Sync réussie:', event.detail.action);
});

window.addEventListener('optimistic-sync-failed', (event) => {
  console.error('❌ Sync échouée:', event.detail.action, event.detail.error);
});

// ============================================================================
// EXPORTS
// ============================================================================

// Export pour utilisation dans d'autres scripts
if (typeof window !== 'undefined') {
  window.OptimisticSync = {
    init: initOptimisticSync,
    getManagers: getOptimisticManagers,
    forceSync: forceSyncQueue,
    checkQueue: checkSyncQueueStatus,
    OptimisticSyncManager,
    OptimisticReactionManager,
    OptimisticCommentManager
  };
}

// Auto-initialisation si les credentials sont déjà disponibles
if (typeof window !== 'undefined' && window.supabaseClient) {
  (async () => {
    const { supabase, getCurrentUser } = window.supabaseClient;
    
    if (supabase) {
      const currentUser = await getCurrentUser();
      const supabaseUrl = supabase.supabaseUrl;
      const supabaseKey = supabase.supabaseKey;
      
      if (currentUser) {
        await initOptimisticSync(supabaseUrl, supabaseKey, currentUser);
      }
    }
  })();
}

console.log('✅ optimistic-sync.js chargé');
