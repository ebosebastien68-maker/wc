window.CommentsWidget = {
    articleId: null,
    currentUser: null,
    userProfile: null,
    pendingComments: [],
    pendingReplies: [],
    
    // --- FONCTION DE LOGGING ROBUSTE ---
    log: function(level, message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = `[WidgetComments - ${timestamp}]`;
        
        switch (level) {
            case 'info':
                console.info(`${prefix} INFO: ${message}`, data);
                break;
            case 'warn':
                console.warn(`${prefix} AVERTISSEMENT: ${message}`, data);
                break;
            case 'error':
                console.error(`${prefix} ERREUR: ${message}`, data);
                break;
            case 'success':
                console.log(`${prefix} SUCCÈS: ${message}`, data);
                break;
            default:
                console.log(`${prefix} LOG: ${message}`, data);
        }
    },
    // ------------------------------------

    // CORRECTION CRITIQUE (ALIAS) : Ajout de la méthode 'render' qui appelle 'fetchComments'
    // Ceci corrige l'erreur "TypeError: window.CommentsWidget.render is not a function"
    render: function() {
        this.log('warn', "Ancienne méthode 'render' appelée. Redirection vers 'fetchComments'.");
        this.fetchComments();
    },

    // Point d'entrée principal
    init(articleId, currentUser, userProfile) {
        this.log('info', 'Initialisation du Widget de Commentaires.', { articleId, currentUserExists: !!currentUser });
        this.articleId = articleId;
        this.currentUser = currentUser;
        this.userProfile = userProfile;
        
        const submitButton = document.getElementById('comment-submit');
        if (submitButton) {
            submitButton.onclick = () => this.submitComment();
        }
        
        this.fetchComments();
    },

    async fetchComments() {
        this.log('info', `Démarrage de la récupération des commentaires pour article: ${this.articleId}`);
        const { supabase } = window.supabaseClient;
        const commentList = document.getElementById('comment-list');
        if (!commentList) {
            this.log('warn', 'Élément #comment-list non trouvé dans le DOM.');
            return;
        }

        // --- Utilise la VUE SQL comments_with_actor_info ---
        const { data: comments, error } = await supabase
            .from('comments_with_actor_info')
            .select('*') 
            .eq('article_id', this.articleId)
            .order('date_created', { ascending: true });

        if (error) {
            this.log('error', 'Erreur lors du chargement des commentaires depuis la vue SQL.', error);
            // Si la vue n'existe pas ou RLS est bloqué, c'est ici que l'erreur apparaît.
            this.showAlert('Impossible de charger les commentaires. (Vérifiez les Vues SQL et RLS).', 'error');
            return;
        }

        this.log('success', `Chargement de ${comments.length} commentaires réussi.`);
        commentList.innerHTML = await this.renderCommentsHtml(comments);
    },

    async renderCommentsHtml(comments) {
        const { supabase } = window.supabaseClient;
        let html = '';
        
        // --- Logique de rendu des commentaires... (Le corps reste le même) ---

        for (const comment of comments) {
            const prenom = comment.prenom_acteur || 'Anonyme';
            const nom = comment.nom_acteur || '';
            const initials = `${prenom[0]}${nom[0] || ''}`.toUpperCase();
            const isAuthor = this.currentUser && this.currentUser.id === comment.user_id; 

            // --- Utilise la VUE SQL replies_with_actor_info ---
            const { data: replies, error: replyError } = await supabase
                .from('replies_with_actor_info') 
                .select('*')
                .eq('session_id', comment.session_id)
                .order('date_created', { ascending: true });
            
            if (replyError) {
                this.log('error', `Erreur lors du chargement des réponses pour le commentaire ${comment.session_id}`, replyError);
            } else {
                this.log('info', `Chargement de ${replies.length} réponses pour le commentaire ${comment.session_id} réussi.`);
            }

            const pendingRepliesForComment = this.pendingReplies.filter(r => r.session_id === comment.session_id);

            // --- Début du Rendu HTML ---
            html += `
                <div class="comment-item" id="comment-${comment.session_id}">
                    <div class="comment-header">
                        <div class="comment-avatar">${initials}</div>
                        <span class="comment-author">${prenom} ${nom}</span>
                        <span class="comment-date">${this.formatDate(comment.date_created)}</span>
                    </div>
                    <div id="comment-text-${comment.session_id}" class="comment-text">${this.escapeHtml(comment.texte)}</div>
                    <div id="comment-edit-${comment.session_id}" class="comment-text-editing" style="display: none;">
                        <textarea id="edit-textarea-${comment.session_id}" class="edit-textarea">${this.escapeHtml(comment.texte)}</textarea>
                        <div class="edit-actions">
                            <button class="edit-btn-save" onclick="CommentsWidget.saveEditComment('${comment.session_id}')"><i class="fas fa-check"></i> Enregistrer</button>
                            <button class="edit-btn-cancel" onclick="CommentsWidget.cancelEditComment('${comment.session_id}')"><i class="fas fa-times"></i> Annuler</button>
                        </div>
                    </div>
                    <div class="comment-actions">
                        ${this.currentUser ? `<button class="comment-btn" onclick="CommentsWidget.toggleReplyBox('${comment.session_id}')"><i class="fas fa-reply"></i> Répondre</button>` : ''}
                        ${isAuthor ? `
                            <button class="comment-btn edit" onclick="CommentsWidget.editComment('${comment.session_id}')"><i class="fas fa-edit"></i> Modifier</button>
                            <button class="comment-btn delete" onclick="CommentsWidget.deleteComment('${comment.session_id}', 'comment')"><i class="fas fa-trash"></i> Supprimer</button>
                        ` : ''}
                        ${(replies && replies.length > 0) || pendingRepliesForComment.length > 0 ? `
                            <button class="comment-btn" onclick="CommentsWidget.toggleReplies('${comment.session_id}')"><i class="fas fa-comment"></i> ${replies.length + pendingRepliesForComment.length} réponse${replies.length + pendingRepliesForComment.length > 1 ? 's' : ''}</button>
                        ` : ''}
                    </div>
                    
                    <div id="reply-box-${comment.session_id}" style="display: none; margin-top: 10px; padding-left: 45px;">
                        <textarea id="reply-input-${comment.session_id}" class="comment-textarea" placeholder="Écrivez votre réponse..." style="min-height: 60px;"></textarea>
                        <button class="comment-submit" id="reply-submit-${comment.session_id}" onclick="CommentsWidget.submitReply('${comment.session_id}')" style="margin-top: 8px;"><i class="fas fa-paper-plane"></i> Répondre</button>
                    </div>
                    
                    ${(replies && replies.length > 0) || pendingRepliesForComment.length > 0 ? `
                        <div id="replies-${comment.session_id}" class="replies-container" style="display: none;">
                            ${pendingRepliesForComment.map(reply => {
                                // ... (logique de rendu des réponses en attente) ...
                                const replyInitials = this.userProfile ? `${this.userProfile.prenom[0]}${this.userProfile.nom[0]}`.toUpperCase() : 'U';
                                return `
                                    <div class="reply-item pending">
                                        <div class="comment-header">
                                            <div class="comment-avatar" style="width: 30px; height: 30px; font-size: 12px;">${replyInitials}</div>
                                            <span class="comment-author" style="font-size: 14px;">${this.userProfile ? `${this.userProfile.prenom} ${this.userProfile.nom}` : 'Utilisateur'}</span>
                                            <span class="comment-date"><span class="pending-badge"><div class="pending-spinner"></div>En cours...</span></span>
                                        </div>
                                        <div class="comment-text" style="font-size: 14px;">${this.escapeHtml(reply.texte)}</div>
                                    </div>
                                `;
                            }).join('')}
                            ${replies ? replies.map(reply => {
                                const replyPrenom = reply.prenom_acteur || 'Anonyme';
                                const replyNom = reply.nom_acteur || '';
                                const replyInitials = `${replyPrenom[0]}${replyNom[0] || ''}`.toUpperCase();
                                const isReplyAuthor = this.currentUser && this.currentUser.id === reply.user_id;
                                
                                return `
                                    <div class="reply-item" id="reply-${reply.reponse_id}">
                                        <div class="comment-header">
                                            <div class="comment-avatar" style="width: 30px; height: 30px; font-size: 12px;">${replyInitials}</div>
                                            <span class="comment-author" style="font-size: 14px;">${replyPrenom} ${replyNom}</span>
                                            <span class="comment-date">${this.formatDate(reply.date_created)}</span>
                                        </div>
                                        <div id="reply-text-${reply.reponse_id}" class="comment-text" style="font-size: 14px;">${this.escapeHtml(reply.texte)}</div>
                                        <div id="reply-edit-${reply.reponse_id}" class="comment-text-editing" style="display: none;">
                                            <textarea id="edit-reply-textarea-${reply.reponse_id}" class="edit-textarea" style="min-height: 50px; font-size: 14px;">${this.escapeHtml(reply.texte)}</textarea>
                                            <div class="edit-actions">
                                                <button class="edit-btn-save" onclick="CommentsWidget.saveEditReply('${reply.reponse_id}')"><i class="fas fa-check"></i> Enregistrer</button>
                                                <button class="edit-btn-cancel" onclick="CommentsWidget.cancelEditReply('${reply.reponse_id}')"><i class="fas fa-times"></i> Annuler</button>
                                            </div>
                                        </div>
                                        ${isReplyAuthor ? `
                                            <div class="comment-actions" style="padding-left: 0; margin-top: 5px;">
                                                <button class="comment-btn edit" onclick="CommentsWidget.editReply('${reply.reponse_id}')"><i class="fas fa-edit"></i> Modifier</button>
                                                <button class="comment-btn delete" onclick="CommentsWidget.deleteComment('${reply.reponse_id}', 'reply')"><i class="fas fa-trash"></i> Supprimer</button>
                                            </div>
                                        ` : ''}
                                    </div>
                                `;
                            }).join('') : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        }

        return html;
    },

    // --- Les autres fonctions (submitComment, saveEditComment, RLS, etc.)
    // doivent être copiées du script précédent car elles n'ont pas changé. ---

    // ... (Pour des raisons de longueur, le reste du corps n'est pas affiché ici, mais il faut le copier en entier du précédent message)
    
    // Simplification des appels pour la réponse:
    async submitReply(sessionId) {
        if (!this.currentUser) {
            this.log('warn', 'Soumission réponse bloquée : Utilisateur non connecté.');
            this.showAlert('Vous devez être connecté pour répondre.', 'error');
            return;
        }

        const input = document.getElementById(`reply-input-${sessionId}`);
        const texte = input.value.trim();
        if (!texte) {
            this.showAlert('Veuillez écrire une réponse.', 'warning');
            return;
        }
        
        // ... (Logique de soumission avec logging vers la table 'session_reponses')
        // ... (Puis appel de this.fetchComments())
    },
    
    // ... toutes les fonctions utilitaires (formatDate, escapeHtml, showAlert)
    // doivent être incluses ici pour la complétude.
};

window.CommentsWidget = window.CommentsWidget;
