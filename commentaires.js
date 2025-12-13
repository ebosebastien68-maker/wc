// ============================================================================
// WIDGET COMMENTAIRES - WORLD CONNECT
// ============================================================================
// Version: 2.0.0 - Intégration vues SQL + Temps réel
// Compatible avec index.html et pages standalone
// ============================================================================

'use strict';

window.CommentsWidget = {
    supabase: null,
    currentUser: null,
    userProfile: null,
    realtimeChannels: new Map(),
    
    // ============================================================================
    // INITIALISATION
    // ============================================================================
    
    /**
     * Initialiser le widget
     */
    async init() {
        console.log('🔄 [CommentsWidget] Initialisation...');
        
        // Vérifier que supabaseClient est disponible
        if (!window.supabaseClient) {
            console.error('❌ [CommentsWidget] supabaseClient non disponible');
            return false;
        }
        
        this.supabase = window.supabaseClient.supabase;
        this.currentUser = await window.supabaseClient.getCurrentUser();
        
        if (this.currentUser) {
            this.userProfile = await window.supabaseClient.getUserProfile(this.currentUser.id);
        }
        
        console.log('✅ [CommentsWidget] Initialisé', {
            user: this.currentUser?.id,
            profile: this.userProfile?.prenom
        });
        
        return true;
    },
    
    // ============================================================================
    // RENDU DES COMMENTAIRES
    // ============================================================================
    
    /**
     * Charger et afficher les commentaires pour un article
     */
    async loadComments(articleId, container) {
        if (!this.supabase) {
            await this.init();
        }
        
        container.innerHTML = '<div class="comments-loader"><div class="spinner"></div></div>';
        
        try {
            console.log('📥 [CommentsWidget] Chargement commentaires:', articleId);
            
            // Récupérer les commentaires via la vue SQL
            const { data: comments, error: commentError } = await this.supabase
                .from('comments_with_actor_info')
                .select('*')
                .eq('article_id', articleId)
                .order('date_created', { ascending: false });
            
            if (commentError) throw commentError;
            
            // Récupérer TOUTES les réponses (pas de filtre article_id car cette colonne n'existe pas)
            const { data: allReplies, error: replyError } = await this.supabase
                .from('replies_with_actor_info')
                .select('*')
                .order('date_created', { ascending: true });
            
            if (replyError) throw replyError;
            
            // Filtrer les réponses qui appartiennent aux commentaires de cet article
            const commentIds = comments.map(c => c.session_id);
            const replies = allReplies.filter(r => commentIds.includes(r.session_id));
            
            console.log('✅ [CommentsWidget] Données chargées:', {
                comments: comments?.length || 0,
                replies: replies?.length || 0,
                totalReplies: allReplies?.length || 0
            });
            
            // Rendu
            this.renderComments(container, articleId, comments || [], replies || []);
            
            // Activer le temps réel
            this.setupRealtime(articleId, container);
            
        } catch (error) {
            console.error('❌ [CommentsWidget] Erreur chargement:', error);
            container.innerHTML = `
                <div class="comments-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>Erreur de chargement des commentaires</p>
                    <button onclick="CommentsWidget.loadComments('${articleId}', document.getElementById('comments-${articleId}'))" 
                        class="retry-btn">
                        <i class="fas fa-sync-alt"></i> Réessayer
                    </button>
                </div>
            `;
        }
    },
    
    /**
     * Rendu HTML des commentaires
     */
    renderComments(container, articleId, comments, allReplies) {
        // Grouper les réponses par session_id (commentaire parent)
        const repliesByComment = {};
        allReplies.forEach(reply => {
            const parentId = reply.session_id; // La réponse est liée au session_id du commentaire
            if (!repliesByComment[parentId]) repliesByComment[parentId] = [];
            repliesByComment[parentId].push(reply);
        });
        
        console.log('📊 [CommentsWidget] Groupement réponses:', {
            totalReplies: allReplies.length,
            groupedBy: Object.keys(repliesByComment).length,
            repliesByComment: repliesByComment
        });
        
        let html = `
            <div class="comments-widget">
                <div class="comments-header">
                    <h4 class="comments-title">
                        <i class="fas fa-comments"></i>
                        Commentaires (${comments.length})
                    </h4>
                </div>
        `;
        
        // Section d'ajout de commentaire
        if (!this.currentUser || !this.userProfile) {
            html += `
                <div class="comments-login-prompt">
                    <i class="fas fa-lock"></i>
                    <p>Connectez-vous pour commenter</p>
                    <button onclick="window.location.href='connexion.html'" class="login-btn">
                        <i class="fas fa-sign-in-alt"></i> Se connecter
                    </button>
                </div>
            `;
        } else {
            html += `
                <div class="comment-input-box">
                    <div class="comment-input-avatar">
                        ${this.getInitials(this.userProfile.prenom, this.userProfile.nom)}
                    </div>
                    <div class="comment-input-wrapper">
                        <textarea 
                            id="comment-input-${articleId}" 
                            class="comment-input"
                            placeholder="Écrivez votre commentaire..."
                            rows="3"></textarea>
                        <button 
                            onclick="CommentsWidget.submitComment('${articleId}')" 
                            class="comment-submit-btn">
                            <i class="fas fa-paper-plane"></i> Envoyer
                        </button>
                    </div>
                </div>
            `;
        }
        
        // Liste des commentaires
        if (comments.length === 0) {
            html += `
                <div class="comments-empty">
                    <i class="fas fa-comment-slash"></i>
                    <p>Soyez le premier à commenter !</p>
                </div>
            `;
        } else {
            html += '<div class="comments-list">';
            
            comments.forEach(comment => {
                html += this.renderComment(comment, repliesByComment[comment.session_id] || [], articleId);
            });
            
            html += '</div>';
        }
        
        html += '</div>';
        
        // Injecter le CSS si ce n'est pas déjà fait
        this.injectStyles();
        
        container.innerHTML = html;
    },
    
    /**
     * Rendu d'un commentaire individuel
     */
    renderComment(comment, replies, articleId) {
        const commentId = comment.session_id;
        const prenom = comment.prenom_acteur || 'Utilisateur';
        const nom = comment.nom_acteur || '';
        const texte = comment.texte; // Colonne 'texte' dans la vue comments_with_actor_info
        const date = comment.date_created;
        const initials = this.getInitials(prenom, nom);
        const isMyComment = this.currentUser && this.currentUser.id === comment.user_id;
        
        let html = `
            <div class="comment-item" id="comment-${commentId}" data-comment-id="${commentId}">
                <div class="comment-main">
                    <div class="comment-avatar">${initials}</div>
                    <div class="comment-content">
                        <div class="comment-header">
                            <span class="comment-author">${this.escapeHtml(prenom)} ${this.escapeHtml(nom)}</span>
                            <span class="comment-date">${this.formatDate(date)}</span>
                        </div>
                        <div class="comment-text">${this.escapeHtml(texte)}</div>
                        <div class="comment-actions">
                            ${this.currentUser ? `
                                <button class="comment-action-btn" onclick="CommentsWidget.toggleReplyBox('${commentId}')">
                                    <i class="fas fa-reply"></i> Répondre
                                </button>
                            ` : ''}
                            ${isMyComment ? `
                                <button class="comment-action-btn delete-btn" onclick="CommentsWidget.deleteComment('${commentId}', '${articleId}')">
                                    <i class="fas fa-trash"></i> Supprimer
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
                
                ${this.currentUser ? `
                    <div id="reply-box-${commentId}" class="reply-input-box" style="display: none;">
                        <div class="reply-input-avatar">
                            ${this.getInitials(this.userProfile.prenom, this.userProfile.nom)}
                        </div>
                        <div class="reply-input-wrapper">
                            <textarea 
                                id="reply-input-${commentId}" 
                                class="reply-input"
                                placeholder="Votre réponse..."
                                rows="2"></textarea>
                            <button onclick="CommentsWidget.submitReply('${commentId}', '${articleId}')" class="reply-submit-btn">
                                <i class="fas fa-paper-plane"></i> Répondre
                            </button>
                        </div>
                    </div>
                ` : ''}
                
                ${replies.length > 0 ? `
                    <div class="replies-list">
                        ${replies.map(reply => this.renderReply(reply)).join('')}
                    </div>
                ` : ''}
            </div>
        `;
        
        return html;
    },
    
    /**
     * Rendu d'une réponse
     */
    renderReply(reply) {
        const prenom = reply.prenom_acteur || 'Utilisateur';
        const nom = reply.nom_acteur || '';
        const texte = reply.texte; // Colonne 'texte' dans la vue replies_with_actor_info
        const date = reply.date_created;
        const initials = this.getInitials(prenom, nom);
        
        return `
            <div class="reply-item" id="reply-${reply.reponse_id}">
                <div class="reply-avatar">${initials}</div>
                <div class="reply-content">
                    <div class="reply-header">
                        <span class="reply-author">${this.escapeHtml(prenom)} ${this.escapeHtml(nom)}</span>
                        <span class="reply-date">${this.formatDate(date)}</span>
                    </div>
                    <div class="reply-text">${this.escapeHtml(texte)}</div>
                </div>
            </div>
        `;
    },
    
    // ============================================================================
    // ACTIONS UTILISATEUR
    // ============================================================================
    
    /**
     * Soumettre un commentaire
     */
    async submitComment(articleId) {
        if (!this.currentUser || !this.userProfile) {
            this.showToast('Connexion requise', 'error');
            return;
        }
        
        const input = document.getElementById(`comment-input-${articleId}`);
        const texte = input.value.trim();
        
        if (!texte) {
            this.showToast('Le commentaire ne peut pas être vide', 'warning');
            return;
        }
        
        try {
            console.log('📤 [CommentsWidget] Envoi commentaire...');
            
            const { error } = await this.supabase
                .from('sessions_commentaires')
                .insert([{
                    article_id: articleId,
                    user_id: this.currentUser.id,
                    texte: texte
                }]);
            
            if (error) throw error;
            
            input.value = '';
            this.showToast('Commentaire publié', 'success');
            console.log('✅ [CommentsWidget] Commentaire envoyé');
            
            // Recharger les commentaires
            const container = document.getElementById(`comments-${articleId}`);
            if (container) {
                this.loadComments(articleId, container);
            }
            
        } catch (error) {
            console.error('❌ [CommentsWidget] Erreur envoi commentaire:', error);
            this.showToast('Erreur lors de l\'envoi', 'error');
        }
    },
    
    /**
     * Soumettre une réponse
     */
    async submitReply(parentId, articleId) {
        if (!this.currentUser || !this.userProfile) {
            this.showToast('Connexion requise', 'error');
            return;
        }
        
        const input = document.getElementById(`reply-input-${parentId}`);
        const texte = input.value.trim();
        
        if (!texte) {
            this.showToast('La réponse ne peut pas être vide', 'warning');
            return;
        }
        
        try {
            console.log('📤 [CommentsWidget] Envoi réponse...');
            
            const { error } = await this.supabase
                .from('session_reponses')
                .insert([{
                    session_id: parentId,
                    user_id: this.currentUser.id,
                    texte: texte
                }]);
            
            if (error) throw error;
            
            input.value = '';
            this.toggleReplyBox(parentId);
            this.showToast('Réponse publiée', 'success');
            console.log('✅ [CommentsWidget] Réponse envoyée');
            
            // Recharger les commentaires
            const container = document.getElementById(`comments-${articleId}`);
            if (container) {
                this.loadComments(articleId, container);
            }
            
        } catch (error) {
            console.error('❌ [CommentsWidget] Erreur envoi réponse:', error);
            this.showToast('Erreur lors de l\'envoi', 'error');
        }
    },
    
    /**
     * Supprimer un commentaire
     */
    async deleteComment(commentId, articleId) {
        if (!confirm("Voulez-vous vraiment supprimer ce commentaire ?")) return;
        
        try {
            console.log('🗑️ [CommentsWidget] Suppression commentaire...');
            
            const { error } = await this.supabase
                .from('sessions_commentaires')
                .delete()
                .eq('session_id', commentId)
                .eq('user_id', this.currentUser.id);
            
            if (error) throw error;
            
            this.showToast('Commentaire supprimé', 'success');
            console.log('✅ [CommentsWidget] Commentaire supprimé');
            
            // Recharger les commentaires
            const container = document.getElementById(`comments-${articleId}`);
            if (container) {
                this.loadComments(articleId, container);
            }
            
        } catch (error) {
            console.error('❌ [CommentsWidget] Erreur suppression:', error);
            this.showToast('Erreur lors de la suppression', 'error');
        }
    },
    
    /**
     * Toggle boîte de réponse
     */
    toggleReplyBox(commentId) {
        const box = document.getElementById(`reply-box-${commentId}`);
        if (box) {
            const isVisible = box.style.display !== 'none';
            box.style.display = isVisible ? 'none' : 'block';
            
            if (!isVisible) {
                const input = document.getElementById(`reply-input-${commentId}`);
                if (input) input.focus();
            }
        }
    },
    
    // ============================================================================
    // TEMPS RÉEL
    // ============================================================================
    
    /**
     * Activer les mises à jour en temps réel
     */
    setupRealtime(articleId, container) {
        // Nettoyer l'ancien canal si existant
        if (this.realtimeChannels.has(articleId)) {
            this.supabase.removeChannel(this.realtimeChannels.get(articleId));
        }
        
        console.log('🔄 [CommentsWidget] Activation temps réel:', articleId);
        
        const channel = this.supabase
            .channel(`comments:${articleId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'sessions_commentaires',
                filter: `article_id=eq.${articleId}`
            }, (payload) => {
                console.log('📩 [CommentsWidget] Changement commentaire:', payload);
                this.loadComments(articleId, container);
            })
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'session_reponses'
            }, (payload) => {
                console.log('📩 [CommentsWidget] Changement réponse:', payload);
                this.loadComments(articleId, container);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('✅ [CommentsWidget] Temps réel activé');
                }
            });
        
        this.realtimeChannels.set(articleId, channel);
    },
    
    // ============================================================================
    // UTILITAIRES
    // ============================================================================
    
    /**
     * Obtenir les initiales
     */
    getInitials(prenom, nom) {
        const p = (prenom || 'U')[0].toUpperCase();
        const n = (nom || '')[0]?.toUpperCase() || '';
        return p + n;
    },
    
    /**
     * Formater la date
     */
    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        
        // Moins d'1 minute
        if (diff < 60000) return 'À l\'instant';
        
        // Moins d'1 heure
        if (diff < 3600000) {
            const minutes = Math.floor(diff / 60000);
            return `Il y a ${minutes} min`;
        }
        
        // Moins de 24h
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000);
            return `Il y a ${hours}h`;
        }
        
        // Moins de 7 jours
        if (diff < 604800000) {
            const days = Math.floor(diff / 86400000);
            return `Il y a ${days}j`;
        }
        
        // Sinon date complète
        const options = { day: 'numeric', month: 'short', year: 'numeric' };
        return date.toLocaleDateString('fr-FR', options);
    },
    
    /**
     * Échapper HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * Afficher une notification
     */
    showToast(message, type = 'info') {
        if (window.ToastManager) {
            window.ToastManager[type]('Commentaires', message);
        } else {
            console.log(`[CommentsWidget] ${type.toUpperCase()}: ${message}`);
        }
    },
    
    /**
     * Injecter les styles CSS
     */
    injectStyles() {
        if (document.getElementById('comments-widget-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'comments-widget-styles';
        style.textContent = `
            .comments-widget {
                padding: 20px;
                background: var(--bg-secondary);
            }
            
            .comments-header {
                margin-bottom: 20px;
                padding-bottom: 16px;
                border-bottom: 2px solid var(--border-color);
            }
            
            .comments-title {
                font-size: 18px;
                font-weight: 700;
                color: var(--text-primary);
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .comments-title i {
                color: var(--accent-blue);
            }
            
            .comments-login-prompt {
                text-align: center;
                padding: 40px 20px;
                background: var(--bg-primary);
                border-radius: 16px;
                margin-bottom: 20px;
            }
            
            .comments-login-prompt i {
                font-size: 48px;
                color: var(--text-tertiary);
                margin-bottom: 16px;
            }
            
            .comments-login-prompt p {
                color: var(--text-secondary);
                margin-bottom: 20px;
                font-size: 15px;
            }
            
            .login-btn {
                padding: 12px 24px;
                background: var(--accent-kaki);
                color: white;
                border: none;
                border-radius: 12px;
                cursor: pointer;
                font-weight: 600;
                font-size: 15px;
                transition: all 0.3s ease;
                box-shadow: 0 4px 12px rgba(107, 114, 73, 0.3);
            }
            
            .login-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(107, 114, 73, 0.5);
            }
            
            .comment-input-box, .reply-input-box {
                display: flex;
                gap: 12px;
                margin-bottom: 24px;
                padding: 16px;
                background: var(--bg-primary);
                border-radius: 16px;
            }
            
            .comment-input-avatar, .reply-input-avatar {
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: linear-gradient(135deg, var(--accent-blue), var(--accent-cyan));
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: 700;
                font-size: 18px;
                flex-shrink: 0;
            }
            
            .reply-input-avatar {
                width: 40px;
                height: 40px;
                font-size: 16px;
            }
            
            .comment-input-wrapper, .reply-input-wrapper {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            
            .comment-input, .reply-input {
                width: 100%;
                padding: 12px 16px;
                border: 2px solid var(--border-color);
                border-radius: 12px;
                font-family: inherit;
                font-size: 14px;
                color: var(--text-primary);
                background: var(--bg-secondary);
                resize: vertical;
                transition: all 0.3s ease;
            }
            
            .comment-input:focus, .reply-input:focus {
                outline: none;
                border-color: var(--accent-blue);
                box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
            }
            
            .comment-submit-btn, .reply-submit-btn {
                align-self: flex-end;
                padding: 10px 20px;
                background: var(--accent-kaki);
                color: white;
                border: none;
                border-radius: 10px;
                cursor: pointer;
                font-weight: 600;
                font-size: 14px;
                transition: all 0.3s ease;
                box-shadow: 0 3px 10px rgba(107, 114, 73, 0.3);
            }
            
            .comment-submit-btn:hover, .reply-submit-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(107, 114, 73, 0.5);
            }
            
            .comments-empty {
                text-align: center;
                padding: 60px 20px;
                color: var(--text-tertiary);
            }
            
            .comments-empty i {
                font-size: 64px;
                margin-bottom: 16px;
                opacity: 0.5;
            }
            
            .comments-list {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            
            .comment-item {
                padding: 16px;
                background: var(--bg-primary);
                border-radius: 16px;
                border-left: 4px solid var(--accent-blue);
                transition: all 0.3s ease;
            }
            
            .comment-item:hover {
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                transform: translateX(4px);
            }
            
            .comment-main {
                display: flex;
                gap: 12px;
            }
            
            .comment-avatar {
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: linear-gradient(135deg, var(--accent-blue), var(--accent-cyan));
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: 700;
                font-size: 18px;
                flex-shrink: 0;
            }
            
            .comment-content {
                flex: 1;
                min-width: 0;
            }
            
            .comment-header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 8px;
            }
            
            .comment-author {
                font-weight: 700;
                font-size: 15px;
                color: var(--text-primary);
            }
            
            .comment-date {
                font-size: 13px;
                color: var(--text-tertiary);
            }
            
            .comment-text {
                color: var(--text-primary);
                line-height: 1.6;
                font-size: 14px;
                margin-bottom: 10px;
                word-wrap: break-word;
            }
            
            .comment-actions {
                display: flex;
                gap: 16px;
            }
            
            .comment-action-btn {
                background: none;
                border: none;
                color: var(--accent-blue);
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
                padding: 6px 0;
                transition: all 0.3s ease;
            }
            
            .comment-action-btn:hover {
                color: var(--accent-cyan);
                transform: scale(1.05);
            }
            
            .comment-action-btn.delete-btn {
                color: var(--accent-red);
            }
            
            .comment-action-btn.delete-btn:hover {
                color: #dc2626;
            }
            
            .reply-input-box {
                margin: 12px 0 0 60px;
                padding: 12px;
            }
            
            .replies-list {
                margin-top: 16px;
                margin-left: 60px;
                padding-left: 20px;
                border-left: 3px solid var(--border-color);
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            
            .reply-item {
                display: flex;
                gap: 10px;
                padding: 12px;
                background: var(--bg-secondary);
                border-radius: 12px;
                transition: all 0.3s ease;
            }
            
            .reply-item:hover {
                background: var(--bg-primary);
                transform: translateX(4px);
            }
            
            .reply-avatar {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: linear-gradient(135deg, var(--accent-purple), var(--accent-pink));
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: 700;
                font-size: 14px;
                flex-shrink: 0;
            }
            
            .reply-content {
                flex: 1;
                min-width: 0;
            }
            
            .reply-header {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 6px;
            }
            
            .reply-author {
                font-weight: 600;
                font-size: 14px;
                color: var(--text-primary);
            }
            
            .reply-date {
                font-size: 12px;
                color: var(--text-tertiary);
            }
            
            .reply-text {
                color: var(--text-primary);
                line-height: 1.5;
                font-size: 13px;
                word-wrap: break-word;
            }
            
            .comments-loader {
                text-align: center;
                padding: 40px;
            }
            
            .comments-error {
                text-align: center;
                padding: 40px 20px;
                color: var(--text-tertiary);
            }
            
            .comments-error i {
                font-size: 48px;
                color: var(--accent-red);
                margin-bottom: 16px;
            }
            
            .retry-btn {
                margin-top: 16px;
                padding: 10px 20px;
                background: var(--accent-kaki);
                color: white;
                border: none;
                border-radius: 10px;
                cursor: pointer;
                font-weight: 600;
                transition: all 0.3s ease;
            }
            
            .retry-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(107, 114, 73, 0.4);
            }
            
            @media (max-width: 768px) {
                .comment-item {
                    padding: 12px;
                }
                
                .replies-list {
                    margin-left: 40px;
                    padding-left: 12px;
                }
                
                .reply-input-box {
                    margin-left: 40px;
                }
                
                .comment-avatar {
                    width: 40px;
                    height: 40px;
                    font-size: 16px;
                }
                
                .reply-avatar {
                    width: 32px;
                    height: 32px;
                    font-size: 13px;
                }
                
                .comment-input-avatar, .reply-input-avatar {
                    width: 40px;
                    height: 40px;
                    font-size: 16px;
                }
            }
        `;
        
        document.head.appendChild(style);
    },
    
    // ============================================================================
    // NETTOYAGE
    // ============================================================================
    
    /**
     * Nettoyer les canaux temps réel
     */
    cleanup() {
        console.log('🧹 [CommentsWidget] Nettoyage...');
        
        this.realtimeChannels.forEach((channel, articleId) => {
            this.supabase.removeChannel(channel);
            console.log(`✅ [CommentsWidget] Canal ${articleId} fermé`);
        });
        
        this.realtimeChannels.clear();
    }
};

// ============================================================================
// AUTO-INITIALISATION
// ============================================================================

// Initialiser automatiquement au chargement si supabaseClient est disponible
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (window.supabaseClient) {
            window.CommentsWidget.init();
        }
    });
} else {
    if (window.supabaseClient) {
        window.CommentsWidget.init();
    }
}

// Nettoyer avant de quitter la page
window.addEventListener('beforeunload', () => {
    window.CommentsWidget.cleanup();
});

console.log('✅ [CommentsWidget] Module chargé');

// ============================================================================
// EXPORTS POUR COMPATIBILITÉ
// ============================================================================

// Alias pour compatibilité avec l'ancien code
if (!window.loadComments) {
    window.loadComments = (articleId, container) => {
        window.CommentsWidget.loadComments(articleId, container);
    };
}

if (!window.submitComment) {
    window.submitComment = (articleId) => {
        window.CommentsWidget.submitComment(articleId);
    };
}

if (!window.submitReply) {
    window.submitReply = (parentId, articleId) => {
        window.CommentsWidget.submitReply(parentId, articleId);
    };
}

if (!window.deleteComment) {
    window.deleteComment = (commentId, articleId) => {
        window.CommentsWidget.deleteComment(commentId, articleId);
    };
}

if (!window.toggleReplyBox) {
    window.toggleReplyBox = (commentId) => {
        window.CommentsWidget.toggleReplyBox(commentId);
    };
    }
