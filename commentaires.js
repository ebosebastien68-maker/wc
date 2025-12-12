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

    // CORRECTION : Point d'entrée pour l'initialisation
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
            this.showAlert('Impossible de charger les commentaires (Vérifiez la vue SQL).', 'error');
            return;
        }

        this.log('success', `Chargement de ${comments.length} commentaires réussi.`);
        commentList.innerHTML = await this.renderComments(comments);
    },

    async renderComments(comments) {
        const { supabase } = window.supabaseClient;
        let html = '';
        
        // Rendu des commentaires en attente (Logique inchangée pour la simplicité)
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
            // Utilisation des champs unifiés de la vue SQL
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

    // --------------------------------------------------------------------------------
    // FONCTIONS D'ACTION (Utilisent le logging)
    // --------------------------------------------------------------------------------

    async submitComment() {
        if (!this.currentUser) {
            this.log('warn', 'Soumission bloquée : Utilisateur non connecté.');
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
        
        this.log('info', 'Tentative d\'insertion du nouveau commentaire.', newComment);
        this.pendingComments.push(newComment);
        input.value = '';
        this.fetchComments(); 

        const { supabase } = window.supabaseClient;
        const { error } = await supabase
            .from('sessions_commentaires') 
            .insert(newComment);

        this.pendingComments = this.pendingComments.filter(c => c.texte !== texte || c.article_id !== this.articleId);
        
        if (error) {
            this.log('error', 'Erreur critique lors de l\'insertion du commentaire.', error);
            this.showAlert('Erreur lors de l\'envoi du commentaire.', 'error');
        } else {
            this.log('success', 'Commentaire inséré avec succès dans la base de données.', newComment);
        }
        
        this.fetchComments(); 
    },

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

        const newReply = {
            session_id: sessionId,
            user_id: this.currentUser.id,
            texte: texte,
            date_created: new Date().toISOString()
        };
        
        this.log('info', `Tentative d\'insertion de la nouvelle réponse pour le commentaire ${sessionId}.`, newReply);
        this.pendingReplies.push(newReply);
        input.value = '';
        this.fetchComments();

        const { supabase } = window.supabaseClient;
        const { error } = await supabase
            .from('session_reponses')
            .insert(newReply);

        this.pendingReplies = this.pendingReplies.filter(r => r.texte !== texte || r.session_id !== sessionId);

        if (error) {
            this.log('error', 'Erreur critique lors de l\'insertion de la réponse.', error);
            this.showAlert('Erreur lors de l\'envoi de la réponse.', 'error');
        } else {
            this.log('success', 'Réponse insérée avec succès.', newReply);
        }
        
        this.fetchComments();
    },

    editComment(sessionId) {
        this.log('info', `Activation du mode édition pour le commentaire ${sessionId}.`);
        document.getElementById(`comment-text-${sessionId}`).style.display = 'none';
        document.getElementById(`comment-edit-${sessionId}`).style.display = 'block';
    },

    cancelEditComment(sessionId) {
        this.log('info', `Annulation du mode édition pour le commentaire ${sessionId}.`);
        document.getElementById(`comment-text-${sessionId}`).style.display = 'block';
        document.getElementById(`comment-edit-${sessionId}`).style.display = 'none';
    },

    async saveEditComment(sessionId) {
        if (!this.currentUser) return;

        const textarea = document.getElementById(`edit-textarea-${sessionId}`);
        const newText = textarea.value.trim();
        this.log('info', `Tentative de modification du commentaire ${sessionId}.`);

        if (!newText) {
            this.showAlert('Le commentaire ne peut pas être vide.', 'warning');
            return;
        }

        const { supabase } = window.supabaseClient;
        const { error } = await supabase
            .from('sessions_commentaires') 
            .update({ texte: newText })
            .eq('session_id', sessionId)
            .eq('user_id', this.currentUser.id); 

        if (error) {
            this.log('error', 'Échec de la modification du commentaire (vérifiez RLS et autorisations).', error);
            this.showAlert('Erreur lors de la modification du commentaire.', 'error');
        } else {
            this.log('success', `Commentaire ${sessionId} modifié avec succès.`);
            this.showAlert('Commentaire modifié avec succès.', 'success');
            this.fetchComments();
        }
    },
    
    editReply(reponseId) {
        this.log('info', `Activation du mode édition pour la réponse ${reponseId}.`);
        document.getElementById(`reply-text-${reponseId}`).style.display = 'none';
        document.getElementById(`reply-edit-${reponseId}`).style.display = 'block';
    },

    cancelEditReply(reponseId) {
        this.log('info', `Annulation du mode édition pour la réponse ${reponseId}.`);
        document.getElementById(`reply-text-${reponseId}`).style.display = 'block';
        document.getElementById(`reply-edit-${reponseId}`).style.display = 'none';
    },

    async saveEditReply(reponseId) {
        if (!this.currentUser) return;

        const textarea = document.getElementById(`edit-reply-textarea-${reponseId}`);
        const newText = textarea.value.trim();
        this.log('info', `Tentative de modification de la réponse ${reponseId}.`);

        if (!newText) {
            this.showAlert('La réponse ne peut pas être vide.', 'warning');
            return;
        }

        const { supabase } = window.supabaseClient;
        const { error } = await supabase
            .from('session_reponses') 
            .update({ texte: newText })
            .eq('reponse_id', reponseId)
            .eq('user_id', this.currentUser.id); 

        if (error) {
            this.log('error', 'Échec de la modification de la réponse (vérifiez RLS et autorisations).', error);
            this.showAlert('Erreur lors de la modification de la réponse.', 'error');
        } else {
            this.log('success', `Réponse ${reponseId} modifiée avec succès.`);
            this.showAlert('Réponse modifiée avec succès.', 'success');
            this.fetchComments();
        }
    },
    
    deleteComment(id, type) {
        this.log('warn', `Demande de suppression de ${type} : ${id}.`);
        if (confirm(`Êtes-vous sûr de vouloir supprimer ce ${type === 'comment' ? 'commentaire' : 'réponse'}?`)) {
            this.confirmDelete(id, type);
        }
    },

    async confirmDelete(id, type) {
        if (!this.currentUser) return;
        
        let table;
        let idColumn;
        let logId = type === 'comment' ? `session_id ${id}` : `reponse_id ${id}`;

        if (type === 'comment') {
            table = 'sessions_commentaires';
            idColumn = 'session_id';
        } else if (type === 'reply') {
            table = 'session_reponses';
            idColumn = 'reponse_id';
        } else {
            return;
        }
        
        this.log('info', `Exécution de la suppression de ${type}: ${logId}.`);

        const { supabase } = window.supabaseClient;
        const { error } = await supabase
            .from(table)
            .delete()
            .eq(idColumn, id)
            .eq('user_id', this.currentUser.id); 

        if (error) {
            this.log('error', `Échec de la suppression de ${type}: ${logId}.`, error);
            this.showAlert(`Erreur lors de la suppression du ${type}.`, 'error');
        } else {
            this.log('success', `${type} supprimé avec succès : ${logId}.`);
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
        const action = box.style.display === 'none' ? 'Ouverture' : 'Fermeture';
        this.log('info', `${action} de la boîte de réponse pour ${sessionId}.`);

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
            const action = repliesContainer.style.display === 'none' ? 'Affichage' : 'Masquage';
            this.log('info', `${action} des réponses pour le commentaire ${sessionId}.`);
            
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
        return text.toString().replace(/&/g, "&amp;")
                   .replace(/</g, "&lt;")
                   .replace(/>/g, "&gt;")
                   .replace(/"/g, "&quot;")
                   .replace(/'/g, "&#039;");
    }
};

window.CommentsWidget = window.CommentsWidget;
