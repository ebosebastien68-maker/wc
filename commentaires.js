window.CommentsWidget = {
    articleId: null,
    currentUser: null,
    userProfile: null,
    pendingComments: [],
    pendingReplies: [],

    init(articleId, currentUser, userProfile) {
        this.articleId = articleId;
        this.currentUser = currentUser;
        this.userProfile = userProfile;
        
        // Initialiser l'écouteur pour le bouton 'Submit'
        const submitButton = document.getElementById('comment-submit');
        if (submitButton) {
            submitButton.onclick = () => this.submitComment(articleId);
        }
        
        this.fetchComments();
    },

    async fetchComments() {
        const { supabase } = window.supabaseClient;
        const commentList = document.getElementById('comment-list');
        if (!commentList) return;

        // Requête utilisant la VUE UNIFIÉE comments_with_actor_info
        const { data: comments, error } = await supabase
            .from('comments_with_actor_info')
            .select('*') 
            .eq('article_id', this.articleId)
            .order('date_created', { ascending: true });

        if (error) {
            console.error('Erreur lors du chargement des commentaires:', error);
            this.showAlert('Impossible de charger les commentaires.', 'error');
            return;
        }

        commentList.innerHTML = await this.renderComments(comments);
        this.showAlert('Commentaires mis à jour.', 'info');
    },

    async renderComments(comments) {
        const { supabase } = window.supabaseClient;
        let html = '';

        // Rendu des commentaires en attente (inchangé)
        for (const pendingComment of this.pendingComments.filter(c => c.article_id === this.articleId)) {
            const initials = this.userProfile ? `${this.userProfile.prenom[0]}${this.userProfile.nom[0]}`.toUpperCase() : 'U';
            html += `
                <div class="comment-item pending">
                    <div class="comment-header">
                        <div class="comment-avatar">${initials}</div>
                        <span class="comment-author">${this.userProfile ? `${this.userProfile.prenom} ${this.userProfile.nom}` : 'Utilisateur'}</span>
                        <span class="comment-date"><span class="pending-badge"><div class="pending-spinner"></div>En cours...</span></span>
                    </div>
                    <div class="comment-text">${this.escapeHtml(pendingComment.texte)}</div>
                </div>
            `;
        }

        for (const comment of comments) {
            // LOGIQUE UNIFIÉE : UTILISATION DIRECTE DES CHAMPS ACTEUR
            const prenom = comment.prenom_acteur || 'Anonyme';
            const nom = comment.nom_acteur || '';
            const initials = `${prenom[0]}${nom[0] || ''}`.toUpperCase();
            
            // Vérification de l'auteur pour les boutons Modifier/Supprimer
            // On utilise la colonne 'user_id' de la vue pour la vérification
            const isAuthor = this.currentUser && this.currentUser.id === comment.user_id; 

            // --- REQUÊTE POUR LES RÉPONSES UTILISANT LA VUE UNIFIÉE ---
            const { data: replies } = await supabase
                .from('replies_with_actor_info') 
                .select('*')
                .eq('session_id', comment.session_id)
                .order('date_created', { ascending: true });
            
            const pendingRepliesForComment = this.pendingReplies.filter(r => r.session_id === comment.session_id);

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
                                // Rendu unifié de l'auteur de la réponse (via replies_with_actor_info)
                                const replyPrenom = reply.prenom_acteur || 'Anonyme';
                                const replyNom = reply.nom_acteur || '';
                                const replyInitials = `${replyPrenom[0]}${replyNom[0] || ''}`.toUpperCase();
                                
                                // On se base sur le 'user_id' pour savoir si l'utilisateur connecté est l'auteur.
                                // La vue 'replies_with_actor_info' DOIT inclure 'user_id' pour cette vérification.
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

    // --------------------------------------------------------------------------------
    // FONCTIONS D'ACTION (SUBMIT, EDIT, DELETE) - Elles doivent cibler les TABLES de base
    // --------------------------------------------------------------------------------

    async submitComment() {
        if (!this.currentUser) {
            this.showAlert('Vous devez être connecté pour commenter.', 'error');
            return;
        }

        const input = document.getElementById('comment-input');
        const texte = input.value.trim();
        if (!texte) {
            this.showAlert('Veuillez écrire un commentaire.', 'warning');
            return;
        }

        const newComment = {
            article_id: this.articleId,
            user_id: this.currentUser.id,
            texte: texte,
            date_created: new Date().toISOString()
        };

        this.pendingComments.push(newComment);
        input.value = '';
        this.fetchComments();

        const { supabase } = window.supabaseClient;
        const { error } = await supabase
            .from('sessions_commentaires') // CIBLE LA TABLE DE BASE
            .insert(newComment);

        this.pendingComments = this.pendingComments.filter(c => c.texte !== texte || c.article_id !== this.articleId);
        
        if (error) {
            console.error('Erreur lors de la soumission du commentaire:', error);
            this.showAlert('Erreur lors de l\'envoi du commentaire.', 'error');
        }
        
        this.fetchComments();
    },

    async submitReply(sessionId) {
        if (!this.currentUser) {
            this.showAlert('Vous devez être connecté pour répondre.', 'error');
            return;
        }

        const input = document.getElementById(`reply-input-${sessionId}`);
        const texte = input.value.trim();
        if (!texte) {
            this.showAlert('Veuillez écrire une réponse.', 'warning');
            return;
        }

        const newReply = {
            session_id: sessionId,
            user_id: this.currentUser.id,
            texte: texte,
            date_created: new Date().toISOString()
        };
        
        this.pendingReplies.push(newReply);
        input.value = '';
        this.fetchComments();

        const { supabase } = window.supabaseClient;
        const { error } = await supabase
            .from('session_reponses') // CIBLE LA TABLE DE BASE
            .insert(newReply);

        this.pendingReplies = this.pendingReplies.filter(r => r.texte !== texte || r.session_id !== sessionId);

        if (error) {
            console.error('Erreur lors de la soumission de la réponse:', error);
            this.showAlert('Erreur lors de l\'envoi de la réponse.', 'error');
        } 
        
        this.fetchComments();
    },

    editComment(sessionId) {
        document.getElementById(`comment-text-${sessionId}`).style.display = 'none';
        document.getElementById(`comment-edit-${sessionId}`).style.display = 'block';
    },

    cancelEditComment(sessionId) {
        document.getElementById(`comment-text-${sessionId}`).style.display = 'block';
        document.getElementById(`comment-edit-${sessionId}`).style.display = 'none';
        // Rétablir l'ancienne valeur si nécessaire, ou laisser l'utilisateur rééditer
    },

    async saveEditComment(sessionId) {
        const textarea = document.getElementById(`edit-textarea-${sessionId}`);
        const newText = textarea.value.trim();

        if (!newText) {
            this.showAlert('Le commentaire ne peut pas être vide.', 'warning');
            return;
        }

        const { supabase } = window.supabaseClient;
        const { error } = await supabase
            .from('sessions_commentaires') // CIBLE LA TABLE DE BASE
            .update({ texte: newText })
            .eq('session_id', sessionId)
            .eq('user_id', this.currentUser.id); // SÉCURITÉ : Vérifie que l'utilisateur est bien l'auteur

        if (error) {
            this.showAlert('Erreur lors de la modification du commentaire. (Vérifiez les règles RLS)', 'error');
            console.error(error);
        } else {
            this.showAlert('Commentaire modifié avec succès.', 'success');
            this.fetchComments();
        }
    },

    editReply(reponseId) {
        document.getElementById(`reply-text-${reponseId}`).style.display = 'none';
        document.getElementById(`reply-edit-${reponseId}`).style.display = 'block';
    },

    cancelEditReply(reponseId) {
        document.getElementById(`reply-text-${reponseId}`).style.display = 'block';
        document.getElementById(`reply-edit-${reponseId}`).style.display = 'none';
    },

    async saveEditReply(reponseId) {
        const textarea = document.getElementById(`edit-reply-textarea-${reponseId}`);
        const newText = textarea.value.trim();

        if (!newText) {
            this.showAlert('La réponse ne peut pas être vide.', 'warning');
            return;
        }

        const { supabase } = window.supabaseClient;
        const { error } = await supabase
            .from('session_reponses') // CIBLE LA TABLE DE BASE
            .update({ texte: newText })
            .eq('reponse_id', reponseId)
            .eq('user_id', this.currentUser.id); // SÉCURITÉ : Vérifie que l'utilisateur est bien l'auteur

        if (error) {
            this.showAlert('Erreur lors de la modification de la réponse. (Vérifiez les règles RLS)', 'error');
            console.error(error);
        } else {
            this.showAlert('Réponse modifiée avec succès.', 'success');
            this.fetchComments();
        }
    },

    deleteComment(id, type) {
        // Simple confirmation de suppression (peut être remplacé par une modale)
        if (confirm(`Êtes-vous sûr de vouloir supprimer ce ${type === 'comment' ? 'commentaire' : 'réponse'}?`)) {
            this.confirmDelete(id, type);
        }
    },

    async confirmDelete(id, type) {
        const { supabase } = window.supabaseClient;
        let table;
        let idColumn;

        if (type === 'comment') {
            table = 'sessions_commentaires'; // CIBLE LA TABLE DE BASE
            idColumn = 'session_id';
        } else if (type === 'reply') {
            table = 'session_reponses'; // CIBLE LA TABLE DE BASE
            idColumn = 'reponse_id';
        } else {
            return;
        }

        const { error } = await supabase
            .from(table)
            .delete()
            .eq(idColumn, id)
            .eq('user_id', this.currentUser.id); // SÉCURITÉ : Vérifie que l'utilisateur est bien l'auteur

        if (error) {
            this.showAlert(`Erreur lors de la suppression du ${type}. (Vérifiez les règles RLS)`, 'error');
            console.error(error);
        } else {
            this.showAlert(`${type === 'comment' ? 'Commentaire' : 'Réponse'} supprimé(e) avec succès.`, 'success');
            this.fetchComments();
        }
    },

    showAlert(message, type = 'info') {
        const alertBox = document.getElementById('comment-alert');
        if (alertBox) {
            alertBox.textContent = message;
            alertBox.className = `comment-alert comment-alert-${type}`;
            alertBox.style.display = 'block';
            setTimeout(() => {
                alertBox.style.display = 'none';
            }, 5000);
        }
    },

    toggleReplyBox(sessionId) {
        const box = document.getElementById(`reply-box-${sessionId}`);
        if (box.style.display === 'none') {
            box.style.display = 'block';
            document.getElementById(`reply-input-${sessionId}`).focus();
        } else {
            box.style.display = 'none';
        }
    },

    toggleReplies(sessionId) {
        const repliesContainer = document.getElementById(`replies-${sessionId}`);
        if (repliesContainer) {
            if (repliesContainer.style.display === 'none') {
                repliesContainer.style.display = 'block';
            } else {
                repliesContainer.style.display = 'none';
            }
        }
    },

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    escapeHtml(text) {
        if (!text) return '';
        return text.replace(/&/g, "&amp;")
                   .replace(/</g, "&lt;")
                   .replace(/>/g, "&gt;")
                   .replace(/"/g, "&quot;")
                   .replace(/'/g, "&#039;");
    }
};

// Exposez la fonction globale pour les onclick
window.CommentsWidget = window.CommentsWidget;
