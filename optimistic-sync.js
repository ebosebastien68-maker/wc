// ============================================================================
// OPTIMISTIC SYNC PRODUCTION - WORLD CONNECT
// ============================================================================
// Version: 5.0.0 - Production Ready
// ============================================================================

'use strict';

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

  async init() {
    console.log('🔄 Initialisation OptimisticSync v5.0.0...');
    
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        this.swReady = true;
        console.log('✅ Service Worker prêt');
        
        this.listenToServiceWorker();
        await this.checkSyncQueue();
      } catch (error) {
        console.warn('⚠️ Service Worker non disponible:', error);
        this.swReady = false;
      }
    }
  }

  configure(supabaseUrl, supabaseKey, currentUser) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.currentUser = currentUser;
    console.log('✅ OptimisticSync configuré pour:', currentUser?.id);
  }

  listenToServiceWorker() {
    if (!navigator.serviceWorker.controller) return;
    
    navigator.serviceWorker.addEventListener('message', (event) => {
      const { type, action, error, notification } = event.data;
      
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
          
        case 'PLAY_NOTIFICATION_SOUND':
          // Jouer un son pour les notifications
          this.playNotificationSound();
          break;
      }
    });
  }

  async checkSyncQueue() {
    if (!this.swReady || !navigator.serviceWorker.controller) return;
    
    const channel = new MessageChannel();
    
    return new Promise((resolve) => {
      channel.port1.onmessage = (event) => {
        const { queue, processing } = event.data;
        console.log(`📊 Queue: ${queue.length} action(s), processing: ${processing}`);
        resolve(queue);
      };
      
      navigator.serviceWorker.controller.postMessage(
        { type: 'GET_SYNC_QUEUE' },
        [channel.port2]
      );
    });
  }

  async sendToServiceWorker(actionType, data) {
    if (!this.swReady || !navigator.serviceWorker.controller) {
      console.warn('⚠️ SW non disponible, ajout à la queue locale');
      this.retryQueue.push({ actionType, data });
      return false;
    }
    
    // Récupérer le token
    let userToken = this.currentUser?.token || this.currentUser?.session?.access_token;
    
    if (!userToken && window.supabaseClient) {
      try {
        const { supabase } = window.supabaseClient;
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          userToken = session.access_token;
        }
      } catch (error) {
        console.error('❌ Erreur récupération token:', error);
      }
    }
    
    if (!userToken) {
      console.error('❌ Token manquant');
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
            userToken: userToken,
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

  handleSyncSuccess(action) {
    console.log('✅ Synchronisation réussie:', action.type);
    
    const pendingKey = `${action.type}_${action.data.articleId}_${Date.now()}`;
    this.pendingActions.delete(pendingKey);
    
    window.dispatchEvent(new CustomEvent('optimistic-sync-success', {
      detail: { action }
    }));
  }

  handleSyncFailure(action, error) {
    console.error('❌ Échec synchronisation:', action.type, error);
    
    this.revertOptimisticUpdate(action);
    
    window.dispatchEvent(new CustomEvent('optimistic-sync-failed', {
      detail: { action, error }
    }));
    
    if (window.ToastManager) {
      window.ToastManager.error(
        'Synchronisation échouée',
        'Vérifiez votre connexion'
      );
    }
  }

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

  revertReaction(articleId, reactionType, originalAction) {
    const postElement = document.querySelector(`[data-article-id="${articleId}"]`);
    if (!postElement) return;
    
    const reactionBtn = postElement.querySelector(`[onclick*="${reactionType}"]`);
    if (!reactionBtn) return;
    
    const countElement = reactionBtn.querySelector('span');
    let currentCount = parseInt(countElement.textContent) || 0;
    
    if (originalAction === 'add') {
      currentCount = Math.max(0, currentCount - 1);
      reactionBtn.classList.remove('active');
    } else {
      currentCount++;
      reactionBtn.classList.add('active');
    }
    
    countElement.textContent = currentCount;
  }

  revertComment(articleId, tempId) {
    const commentElement = document.querySelector(`[data-temp-id="${tempId}"]`);
    if (commentElement) {
      commentElement.classList.add('opacity-0', 'transition-opacity');
      setTimeout(() => commentElement.remove(), 300);
    }
  }

  async forceSyncQueue() {
    if (!this.swReady || !navigator.serviceWorker.controller) {
      console.warn('⚠️ SW non disponible');
      return false;
    }
    
    console.log('🔄 Forçage synchronisation...');
    navigator.serviceWorker.controller.postMessage({
      type: 'FORCE_SYNC'
    });
    
    return true;
  }

  playNotificationSound() {
    try {
      // Créer un son simple
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGWm98OScTgwOUKvo87hlHQU7k9n0yX0xBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8bllHQU7k9n0yH0wBSh+zPLaizsKGGS56+mjUBELTKXh8Q==');
      audio.volume = 0.3;
      audio.play().catch(e => console.log('Son désactivé'));
    } catch (error) {
      console.log('Son non disponible');
    }
  }
}

// ============================================================================
// GESTION DES RÉACTIONS
// ============================================================================

class OptimisticReactionManager {
  constructor(syncManager) {
    this.syncManager = syncManager;
  }

  async addReaction(articleId, reactionType, userId) {
    this.updateUIInstantly(articleId, reactionType, 'add');
    
    const sent = await this.syncManager.sendToServiceWorker('ADD_REACTION', {
      articleId,
      userId,
      reactionType
    });
    
    if (!sent) {
      console.warn('⚠️ Réaction en attente');
    }
  }

  async removeReaction(articleId, reactionId, reactionType, userId) {
    this.updateUIInstantly(articleId, reactionType, 'remove');
    
    const sent = await this.syncManager.sendToServiceWorker('REMOVE_REACTION', {
      articleId,
      reactionId,
      userId,
      reactionType
    });
    
    if (!sent) {
      console.warn('⚠️ Suppression en attente');
    }
  }

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
      reactionButton.classList.add('animate-bounce');
      setTimeout(() => reactionButton.classList.remove('animate-bounce'), 600);
    } else {
      currentCount = Math.max(0, currentCount - 1);
      reactionButton.classList.remove('active');
    }
    
    countElement.textContent = currentCount;
    countElement.style.transform = 'scale(1.3)';
    countElement.style.fontWeight = 'bold';
    setTimeout(() => {
      countElement.style.transform = 'scale(1)';
      countElement.style.fontWeight = '';
    }, 200);
  }
}

// ============================================================================
// GESTION DES COMMENTAIRES
// ============================================================================

class OptimisticCommentManager {
  constructor(syncManager) {
    this.syncManager = syncManager;
  }

  async addComment(articleId, content, userId, userName, userAvatar) {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.displayCommentInstantly({
      id: tempId,
      article_id: articleId,
      texte: content,
      user_id: userId,
      user_name: userName,
      user_avatar: userAvatar,
      date_created: new Date().toISOString(),
      pending: true
    });
    
    const sent = await this.syncManager.sendToServiceWorker('ADD_COMMENT', {
      articleId,
      userId,
      content,
      tempId
    });
    
    if (!sent) {
      console.warn('⚠️ Commentaire en attente');
    }
  }

  async deleteComment(commentId, articleId, userId) {
    const commentElement = document.querySelector(`[data-comment-id="${commentId}"]`);
    if (commentElement) {
      commentElement.style.opacity = '0.5';
      commentElement.style.pointerEvents = 'none';
    }
    
    const sent = await this.syncManager.sendToServiceWorker('DELETE_COMMENT', {
      commentId,
      articleId,
      userId
    });
    
    if (sent && commentElement) {
      setTimeout(() => commentElement.remove(), 300);
    }
  }

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
                ${this.escapeHtml(comment.texte)}
              </p>
            </div>
            <div style="margin-top: 6px; font-size: 12px; color: var(--text-tertiary); display: flex; gap: 8px;">
              <span>À l'instant</span>
              ${comment.pending ? '<span style="color: #f59e0b;">⏳ Envoi...</span>' : ''}
            </div>
          </div>
        </div>
      </div>
    `;
    
    commentsContainer.insertAdjacentHTML('afterbegin', commentHTML);
    
    const newComment = commentsContainer.firstElementChild;
    newComment.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ============================================================================
// INITIALISATION
// ============================================================================

let optimisticSync, reactionManager, commentManager;

async function initOptimisticSync(supabaseUrl, supabaseKey, currentUser) {
  if (!optimisticSync) {
    optimisticSync = new OptimisticSyncManager();
    await optimisticSync.init();
  }
  
  if (supabaseUrl && supabaseKey && currentUser) {
    optimisticSync.configure(supabaseUrl, supabaseKey, currentUser);
    reactionManager = new OptimisticReactionManager(optimisticSync);
    commentManager = new OptimisticCommentManager(optimisticSync);
    console.log('✅ OptimisticSync v5.0.0 prêt');
  }
  
  return optimisticSync;
}

function getOptimisticManagers() {
  return {
    sync: optimisticSync,
    reactions: reactionManager,
    comments: commentManager
  };
}

async function forceSyncQueue() {
  if (optimisticSync) {
    return await optimisticSync.forceSyncQueue();
  }
  return false;
}

async function checkSyncQueueStatus() {
  if (optimisticSync) {
    return await optimisticSync.checkSyncQueue();
  }
  return [];
}

// ============================================================================
// ÉVÉNEMENTS
// ============================================================================

window.addEventListener('online', async () => {
  console.log('🌐 Connexion rétablie - Sync...');
  await forceSyncQueue();
});

window.addEventListener('offline', () => {
  console.log('📡 Hors ligne - Actions seront synchronisées');
});

window.addEventListener('optimistic-sync-success', (event) => {
  console.log('✅ Sync réussie:', event.detail.action);
});

window.addEventListener('optimistic-sync-failed', (event) => {
  console.error('❌ Sync échouée:', event.detail.action);
});

// ============================================================================
// EXPORTS
// ============================================================================

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

// Auto-initialisation
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

console.log('✅ optimistic-sync.js v5.0.0 chargé');
