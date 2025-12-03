// ============================================================================
// CLIENT: SYNCHRONISATION OPTIMISTE (comme Facebook)
// ============================================================================
// Mise à jour instantanée de l'UI + sync arrière-plan
// ============================================================================

/**
 * Gestion des réactions avec mise à jour optimiste
 */
class OptimisticReactionManager {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.pendingActions = new Map(); // Actions en attente
  }

  /**
   * Ajouter une réaction (mise à jour instantanée)
   */
  async addReaction(postId, reactionType, userId) {
    const tempId = `temp_${Date.now()}`;
    
    // 1️⃣ MISE À JOUR INSTANTANÉE DE L'UI
    this.updateUIInstantly(postId, reactionType, userId, 'add');
    
    // 2️⃣ SYNCHRONISATION EN ARRIÈRE-PLAN
    try {
      const { data, error } = await this.supabase
        .from('reactions')
        .insert({
          post_id: postId,
          user_id: userId,
          type: reactionType,
          created_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // ✅ Succès: remplacer l'ID temporaire
      this.replaceTemporaryReaction(tempId, data.id);
      console.log('✅ Réaction synchronisée:', data.id);
      
    } catch (error) {
      // ❌ Échec: annuler la mise à jour UI
      console.error('❌ Erreur sync réaction:', error);
      this.updateUIInstantly(postId, reactionType, userId, 'remove');
      this.showErrorToast('Impossible d\'ajouter la réaction');
    }
  }

  /**
   * Retirer une réaction (mise à jour instantanée)
   */
  async removeReaction(postId, reactionId, reactionType, userId) {
    // 1️⃣ MISE À JOUR INSTANTANÉE DE L'UI
    this.updateUIInstantly(postId, reactionType, userId, 'remove');
    
    // 2️⃣ SYNCHRONISATION EN ARRIÈRE-PLAN
    try {
      const { error } = await this.supabase
        .from('reactions')
        .delete()
        .eq('id', reactionId);
      
      if (error) throw error;
      console.log('✅ Réaction supprimée:', reactionId);
      
    } catch (error) {
      // ❌ Échec: restaurer la réaction dans l'UI
      console.error('❌ Erreur suppression:', error);
      this.updateUIInstantly(postId, reactionType, userId, 'add');
      this.showErrorToast('Impossible de retirer la réaction');
    }
  }

  /**
   * Mise à jour instantanée de l'interface
   */
  updateUIInstantly(postId, reactionType, userId, action) {
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postElement) return;
    
    const reactionButton = postElement.querySelector(
      `[data-reaction="${reactionType}"]`
    );
    if (!reactionButton) return;
    
    const countElement = reactionButton.querySelector('.reaction-count');
    let currentCount = parseInt(countElement.textContent) || 0;
    
    if (action === 'add') {
      currentCount++;
      reactionButton.classList.add('active', 'animate-bounce');
      setTimeout(() => reactionButton.classList.remove('animate-bounce'), 300);
    } else {
      currentCount = Math.max(0, currentCount - 1);
      reactionButton.classList.remove('active');
    }
    
    countElement.textContent = currentCount;
    
    // Animation visuelle
    countElement.classList.add('scale-125', 'font-bold');
    setTimeout(() => {
      countElement.classList.remove('scale-125', 'font-bold');
    }, 200);
  }

  /**
   * Remplacer ID temporaire par ID réel
   */
  replaceTemporaryReaction(tempId, realId) {
    const element = document.querySelector(`[data-temp-id="${tempId}"]`);
    if (element) {
      element.setAttribute('data-reaction-id', realId);
      element.removeAttribute('data-temp-id');
    }
  }

  /**
   * Afficher toast d'erreur
   */
  showErrorToast(message) {
    // Implémentation de votre système de toast
    console.warn('⚠️', message);
  }
}

// ============================================================================
// GESTION DES COMMENTAIRES AVEC SYNC OPTIMISTE
// ============================================================================

class OptimisticCommentManager {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Ajouter un commentaire (affichage instantané)
   */
  async addComment(postId, content, userId, userName, userAvatar) {
    const tempId = `temp_${Date.now()}`;
    
    // 1️⃣ AFFICHAGE INSTANTANÉ
    this.displayCommentInstantly({
      id: tempId,
      post_id: postId,
      content: content,
      user_id: userId,
      user_name: userName,
      user_avatar: userAvatar,
      created_at: new Date().toISOString(),
      pending: true // Marquer comme en attente
    });
    
    // 2️⃣ SYNCHRONISATION EN ARRIÈRE-PLAN
    try {
      const { data, error } = await this.supabase
        .from('comments')
        .insert({
          post_id: postId,
          user_id: userId,
          content: content
        })
        .select(`
          *,
          user:users(name, avatar)
        `)
        .single();
      
      if (error) throw error;
      
      // ✅ Succès: remplacer par le vrai commentaire
      this.replaceTemporaryComment(tempId, data);
      console.log('✅ Commentaire synchronisé:', data.id);
      
    } catch (error) {
      // ❌ Échec: retirer le commentaire temporaire
      console.error('❌ Erreur sync commentaire:', error);
      this.removeTemporaryComment(tempId);
      this.showErrorToast('Impossible de publier le commentaire');
    }
  }

  /**
   * Afficher commentaire instantanément
   */
  displayCommentInstantly(comment) {
    const postElement = document.querySelector(
      `[data-post-id="${comment.post_id}"]`
    );
    if (!postElement) return;
    
    const commentsContainer = postElement.querySelector('.comments-list');
    if (!commentsContainer) return;
    
    const commentHTML = `
      <div class="comment ${comment.pending ? 'opacity-60' : ''}" 
           data-comment-id="${comment.id}"
           data-temp-id="${comment.pending ? comment.id : ''}">
        <div class="flex gap-3">
          <img src="${comment.user_avatar || '/default-avatar.png'}" 
               alt="${comment.user_name}"
               class="w-8 h-8 rounded-full">
          <div class="flex-1">
            <div class="bg-gray-100 rounded-lg px-3 py-2">
              <p class="font-semibold text-sm">${comment.user_name}</p>
              <p class="text-sm">${this.escapeHtml(comment.content)}</p>
            </div>
            <div class="text-xs text-gray-500 mt-1">
              À l'instant
              ${comment.pending ? '<span class="ml-2">⏳ Envoi...</span>' : ''}
            </div>
          </div>
        </div>
      </div>
    `;
    
    commentsContainer.insertAdjacentHTML('beforeend', commentHTML);
    
    // Scroll vers le nouveau commentaire
    const newComment = commentsContainer.lastElementChild;
    newComment.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Remplacer commentaire temporaire par réel
   */
  replaceTemporaryComment(tempId, realComment) {
    const tempElement = document.querySelector(`[data-temp-id="${tempId}"]`);
    if (!tempElement) return;
    
    tempElement.setAttribute('data-comment-id', realComment.id);
    tempElement.removeAttribute('data-temp-id');
    tempElement.classList.remove('opacity-60');
    
    const pendingIndicator = tempElement.querySelector('.ml-2');
    if (pendingIndicator) pendingIndicator.remove();
  }

  /**
   * Retirer commentaire temporaire en cas d'échec
   */
  removeTemporaryComment(tempId) {
    const element = document.querySelector(`[data-temp-id="${tempId}"]`);
    if (element) {
      element.classList.add('opacity-0', 'transition-opacity');
      setTimeout(() => element.remove(), 300);
    }
  }

  /**
   * Échapper HTML pour sécurité
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Afficher toast d'erreur
   */
  showErrorToast(message) {
    console.warn('⚠️', message);
  }
}

// ============================================================================
// INITIALISATION
// ============================================================================

// Exemple d'utilisation
let reactionManager, commentManager;

async function initializeOptimisticUI() {
  // Initialiser Supabase
  const { createClient } = supabase;
  const supabaseClient = createClient(
    'YOUR_SUPABASE_URL',
    'YOUR_SUPABASE_ANON_KEY'
  );
  
  // Créer les gestionnaires
  reactionManager = new OptimisticReactionManager(supabaseClient);
  commentManager = new OptimisticCommentManager(supabaseClient);
  
  console.log('✅ UI optimiste initialisée');
}

// Exemple: Boutons de réaction
document.addEventListener('click', async (e) => {
  const reactionBtn = e.target.closest('[data-reaction]');
  if (!reactionBtn) return;
  
  const postId = reactionBtn.closest('[data-post-id]').dataset.postId;
  const reactionType = reactionBtn.dataset.reaction;
  const userId = getCurrentUserId(); // Votre fonction
  const reactionId = reactionBtn.dataset.reactionId;
  
  if (reactionBtn.classList.contains('active')) {
    // Retirer réaction
    await reactionManager.removeReaction(postId, reactionId, reactionType, userId);
  } else {
    // Ajouter réaction
    await reactionManager.addReaction(postId, reactionType, userId);
  }
});

// Exemple: Formulaire de commentaire
document.addEventListener('submit', async (e) => {
  if (!e.target.matches('.comment-form')) return;
  e.preventDefault();
  
  const form = e.target;
  const postId = form.closest('[data-post-id]').dataset.postId;
  const content = form.querySelector('textarea').value.trim();
  
  if (!content) return;
  
  const user = getCurrentUser(); // Votre fonction
  
  await commentManager.addComment(
    postId,
    content,
    user.id,
    user.name,
    user.avatar
  );
  
  // Vider le formulaire
  form.reset();
});

// Initialiser au chargement
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeOptimisticUI);
} else {
  initializeOptimisticUI();
}

// ============================================================================
// FONCTIONS UTILITAIRES
// ============================================================================

function getCurrentUserId() {
  // Implémenter selon votre système d'auth
  return 'user-id';
}

function getCurrentUser() {
  // Implémenter selon votre système d'auth
  return {
    id: 'user-id',
    name: 'John Doe',
    avatar: '/avatar.jpg'
  };
}
