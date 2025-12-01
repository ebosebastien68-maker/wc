// commentaires.js - Widget de commentaires avec modification, suppression et affichage instantané

window.CommentsWidget = {
    currentArticleId: null,
    refreshCallback: null,
    pendingComments: [],
    pendingReplies: [],

    async render(container, articleId, comments, currentUser, userProfile, refreshCallback) {
        this.currentArticleId = articleId;
        this.refreshCallback = refreshCallback;

        const scrollPosition = container.scrollTop || 0;
        const wasScrolledToBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;

        container.innerHTML = `
            <style>
                .comments-widget { padding: 20px; }
                .comment-item { padding: 15px; border-bottom: 1px solid var(--border-color); position: relative; }
                .comment-item.pending { opacity: 0.7; background: rgba(255, 215, 0, 0.05); border-left: 3px solid #ffd700; }
                .comment-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
                .comment-avatar { width: 35px; height: 35px; border-radius: 50%; background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%); display: flex; align-items: center; justify-content: center; color: #1a1a1a; font-weight: bold; font-size: 14px; box-shadow: 0 2px 8px rgba(255, 215, 0, 0.4); }
                .comment-author { font-weight: 600; color: var(--text-primary); }
                .comment-date { font-size: 12px; color: var(--text-tertiary); margin-left: auto; display: flex; align-items: center; gap: 5px; }
                .pending-badge { display: inline-flex; align-items: center; gap: 5px; background: rgba(255, 215, 0, 0.2); color: #ffd700; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
                .pending-spinner { width: 12px; height: 12px; border: 2px solid rgba(255, 215, 0, 0.3); border-top: 2px solid #ffd700; border-radius: 50%; animation: spin 1s linear infinite; }
                .comment-text { color: var(--text-primary); margin: 8px 0; padding-left: 45px; line-height: 1.5; }
                .comment-text-editing { padding-left: 45px; margin: 8px 0; }
                .edit-textarea { width: 100%; padding: 10px; border: 2px solid #ffd700; border-radius: 8px; font-family: inherit; font-size: 14px; min-height: 60px; resize: vertical; background: var(--bg-secondary); color: var(--text-primary); }
                .edit-actions { display: flex; gap: 10px; margin-top: 8px; }
                .edit-btn-save, .edit-btn-cancel { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.3s; }
                .edit-btn-save { background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%); color: white; }
                .edit-btn-save:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4); }
                .edit-btn-cancel { background: #e0e0e0; color: #333; }
                .edit-btn-cancel:hover { background: #d0d0d0; }
                .comment-actions { padding-left: 45px; display: flex; gap: 15px; flex-wrap: wrap; }
                .comment-btn { background: none; border: none; color: #ffd700; font-size: 13px; cursor: pointer; font-weight: 600; transition: all 0.3s; display: flex; align-items: center; gap: 5px; }
                .comment-btn:hover { text-decoration: underline; transform: translateX(3px); }
                .comment-btn.delete { color: #f44336; }
                .comment-btn.edit { color: #2196f3; }
                .replies-container { margin-left: 45px; border-left: 2px solid var(--border-color); padding-left: 15px; margin-top: 10px; }
                .reply-item { padding: 10px 0; }
                .reply-item.pending { opacity: 0.7; background: rgba(255, 215, 0, 0.05); padding: 10px; border-radius: 8px; border-left: 3px solid #ffd700; }
                .comment-input-box { margin-top: 15px; padding: 15px; background: var(--bg-primary); border-radius: 12px; }
                .comment-textarea { width: 100%; padding: 12px; border: 2px solid var(--border-color); border-radius: 10px; font-family: inherit; font-size: 14px; min-height: 80px; resize: vertical; transition: border-color 0.3s; background: var(--bg-secondary); color: var(--text-primary); }
                .comment-textarea:focus { outline: none; border-color: #ffd700; box-shadow: 0 0 0 3px rgba(255, 215, 0, 0.1); }
                .comment-submit { margin-top: 10px; padding: 10px 20px; background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%); color: #1a1a1a; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s; box-shadow: 0 4px 15px rgba(255, 215, 0, 0.3); }
                .comment-submit:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(255, 215, 0, 0.5); }
                .comment-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
                .no-comments { text-align: center; padding: 40px 20px; color: var(--text-tertiary); }
                .no-comments i { font-size: 40px; margin-bottom: 10px; display: block; opacity: 0.5; }
                .comment-spinner { border: 2px solid var(--border-color); border-top: 2px solid #ffd700; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                .alert-message { position: fixed; top: 20px; right: 20px; padding: 15px 20px; border-radius: 10px; display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; z-index: 10000; animation: slideInRight 0.3s ease, slideOutRight 0.3s ease 2.7s; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2); }
                .alert-message.success { background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%); color: white; }
                .alert-message.error { background: linear-gradient(135deg, #f44336 0%, #e57373 100%); color: white; }
                .alert-message.info { background: linear-gradient(135deg, #2196f3 0%, #64b5f6 100%); color: white; }
                .alert-message.warning { background: linear-gradient(135deg, #ff9800 0%, #ffb74d 100%); color: white; }
                @keyframes slideInRight { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
                @keyframes slideOutRight { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100px); } }
                .delete-confirm-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); display: flex; align-items: center; justify-content: center; z-index: 9999; animation: fadeIn 0.2s ease; }
                .delete-confirm-content { background: var(--bg-primary); padding: 25px; border-radius: 15px; max-width: 400px; width: 90%; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3); animation: scaleIn 0.2s ease; }
                .delete-confirm-content h3 { margin: 0 0 15px 0; color: var(--text-primary); display: flex; align-items: center; gap: 10px; }
                .delete-confirm-content p { color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5; }
                .delete-confirm-actions { display: flex; gap: 10px; justify-content: flex-end; }
                .delete-confirm-btn { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s; }
                .delete-confirm-btn.cancel { background: #e0e0e0; color: #333; }
                .delete-confirm-btn.confirm { background: linear-gradient(135deg, #f44336 0%, #e57373 100%); color: white; }
                .delete-confirm-btn:hover { transform: translateY(-2px); }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes scaleIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            </style>
            
            <div class="comments-widget">
                ${comments.length === 0 && this.pendingComments.length === 0 ? `
                    <div class="no-comments">
                        <i class="fas fa-comments"></i>
                        <p>Aucun commentaire pour le moment</p>
                        <p style="font-size: 13px; margin-top: 5px;">Soyez le premier à commenter !</p>
                    </div>
                ` : ''}
                
                <div id="comments-list-${articleId}">
                    ${await this.renderComments(comments, articleId, currentUser, userProfile)}
                </div>
                
                ${currentUser ? `
                    <div class="comment-input-box">
                        <textarea id="comment-input-${articleId}" class="comment-textarea" placeholder="Écrivez votre commentaire..."></textarea>
                        <button class="comment-submit" id="comment-submit-${articleId}" onclick="CommentsWidget.submitComment('${articleId}')">
                            <i class="fas fa-paper-plane"></i> Publier
                        </button>
                    </div>
                ` : `
                    <div class="comment-input-box">
                        <p style="text-align: center; color: var(--text-secondary);"><i class="fas fa-lock"></i> Connectez-vous pour commenter</p>
                    </div>
                `}
            </div>
        `;

        setTimeout(() => {
            if (wasScrolledToBottom) {
                container.scrollTop = container.scrollHeight;
            } else {
                container.scrollTop = scrollPosition;
            }
        }, 50);
    },

    async renderComments(comments, articleId, currentUser, userProfile) {
        const { supabase } = window.supabaseClient;
        let html = '';

        for (const pendingComment of this.pendingComments.filter(c => c.article_id === articleId)) {
            const initials = userProfile ? `${userProfile.prenom[0]}${userProfile.nom[0]}`.toUpperCase() : 'U';
            html += `
                <div class="comment-item pending">
                    <div class="comment-header">
                        <div class="comment-avatar">${initials}</div>
                        <span class="comment-author">${userProfile ? `${userProfile.prenom} ${userProfile.nom}` : 'Utilisateur'}</span>
                        <span class="comment-date"><span class="pending-badge"><div class="pending-spinner"></div>En cours...</span></span>
                    </div>
                    <div class="comment-text">${this.escapeHtml(pendingComment.texte)}</div>
                </div>
            `;
        }

        for (const comment of comments) {
            const author = comment.users_profile;
            const initials = `${author.prenom[0]}${author.nom[0]}`.toUpperCase();
            const isAuthor = currentUser && currentUser.id === comment.user_id;
            
            const { data: replies } = await supabase.from('session_reponses').select(`*, users_profile(prenom, nom)`).eq('session_id', comment.session_id).order('date_created', { ascending: true });
            const pendingRepliesForComment = this.pendingReplies.filter(r => r.session_id === comment.session_id);

            html += `
                <div class="comment-item" id="comment-${comment.session_id}">
                    <div class="comment-header">
                        <div class="comment-avatar">${initials}</div>
                        <span class="comment-author">${author.prenom} ${author.nom}</span>
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
                        ${currentUser ? `<button class="comment-btn" onclick="CommentsWidget.toggleReplyBox('${comment.session_id}')"><i class="fas fa-reply"></i> Répondre</button>` : ''}
                        ${isAuthor ? `
                            <button class="comment-btn edit" onclick="CommentsWidget.editComment('${comment.session_id}')"><i class="fas fa-edit"></i> Modifier</button>
                            <button class="comment-btn delete" onclick="CommentsWidget.deleteComment('${comment.session_id}', 'comment')"><i class="fas fa-trash"></i> Supprimer</button>
                        ` : ''}
                        ${(replies && replies.length > 0) || pendingRepliesForComment.length > 0 ? `
                            <button class="comment-btn" onclick="CommentsWidget.toggleReplies('${comment.session_id}')"><i class="fas fa-comment"></i> ${replies.length + pendingRepliesForComment.length} réponse(s)</button>
                        ` : ''}
                    </div>
                    
                    <div id="reply-box-${comment.session_id}" style="display: none; margin-top: 10px; padding-left: 45px;">
                        <textarea id="reply-input-${comment.session_id}" class="comment-textarea" placeholder="Écrivez votre réponse..." style="min-height: 60px;"></textarea>
                        <button class="comment-submit" id="reply-submit-${comment.session_id}" onclick="CommentsWidget.submitReply('${comment.session_id}')" style="margin-top: 8px;"><i class="fas fa-paper-plane"></i> Répondre</button>
                    </div>
                    
                    ${(replies && replies.length > 0) || pendingRepliesForComment.length > 0 ? `
                        <div id="replies-${comment.session_id}" class="replies-container" style="display: none;">
                            ${pendingRepliesForComment.map(reply => {
                                const replyInitials = userProfile ? `${userProfile.prenom[0]}${userProfile.nom[0]}`.toUpperCase() : 'U';
                                return `
                                    <div class="reply-item pending">
                                        <div class="comment-header">
                                            <div class="comment-avatar" style="width: 30px; height: 30px; font-size: 12px;">${replyInitials}</div>
                                            <span class="comment-author" style="font-size: 14px;">${userProfile ? `${userProfile.prenom} ${userProfile.nom}` : 'Utilisateur'}</span>
                                            <span class="comment-date"><span class="pending-badge"><div class="pending-spinner"></div>En cours...</span></span>
                                        </div>
                                        <div class="comment-text" style="font-size: 14px;">${this.escapeHtml(reply.texte)}</div>
                                    </div>
                                `;
                            }).join('')}
                            ${replies ? replies.map(reply => {
                                const replyAuthor = reply.users_profile;
                                const replyInitials = `${replyAuthor.prenom[0]}${replyAuthor.nom[0]}`.toUpperCase();
                                const isReplyAuthor = currentUser && currentUser.id === reply.user_id;
                                return `
                                    <div class="reply-item" id="reply-${reply.reponse_id}">
                                        <div class="comment-header">
                                            <div class="comment-avatar" style="width: 30px; height: 30px; font-size: 12px;">${replyInitials}</div>
                                            <span class="comment-author" style="font-size: 14px;">${replyAuthor.prenom} ${replyAuthor.nom}</span>
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

    async submitComment(articleId) {
        const { supabase, getCurrentUser } = window.supabaseClient;
        const input = document.getElementById(`comment-input-${articleId}`);
        const submitBtn = document.getElementById(`comment-submit-${articleId}`);
        const texte = input.value.trim();

        if (!texte) {
            this.showAlert('Veuillez écrire un commentaire', 'warning');
            return;
        }

        try {
            const user = await getCurrentUser();
            if (!user) {
                this.showAlert('Vous devez être connecté pour commenter', 'error');
                window.location.href = 'connexion.html';
                return;
            }

            const { data: userProfile } = await supabase.from('users_profile').select('prenom, nom').eq('user_id', user.id).single();
            
            const tempComment = { article_id: articleId, user_id: user.id, texte: texte, tempId: Date.now() };
            this.pendingComments.push(tempComment);
            input.value = '';

            if (this.refreshCallback) {
                await this.refreshCallback(articleId, userProfile);
            }

            submitBtn.disabled = true;
            const originalContent = submitBtn.innerHTML;
            submitBtn.innerHTML = '<div class="comment-spinner"></div> Publication...';

            const { error } = await supabase.from('sessions_commentaires').insert({ article_id: articleId, user_id: user.id, texte: texte });
            this.pendingComments = this.pendingComments.filter(c => c.tempId !== tempComment.tempId);

            if (error) throw error;

            this.showAlert('Commentaire publié avec succès !', 'success');

            if (this.refreshCallback) {
                await this.refreshCallback(articleId);
            }

            submitBtn.disabled = false;
            submitBtn.innerHTML = originalContent;

        } catch (error) {
            console.error('Erreur:', error);
            this.showAlert('Erreur lors de la publication du commentaire', 'error');
            this.pendingComments = this.pendingComments.filter(c => c.article_id !== articleId);
            if (this.refreshCallback) await this.refreshCallback(articleId);
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Publier';
        }
    },

    async submitReply(sessionId) {
        const { supabase, getCurrentUser } = window.supabaseClient;
        const input = document.getElementById(`reply-input-${sessionId}`);
        const submitBtn = document.getElementById(`reply-submit-${sessionId}`);
        const texte = input.value.trim();

        if (!texte) {
            this.showAlert('Veuillez écrire une réponse', 'warning');
            return;
        }

        try {
            const user = await getCurrentUser();
            if (!user) {
                this.showAlert('Vous devez être connecté pour répondre', 'error');
                window.location.href = 'connexion.html';
                return;
            }

            const { data: userProfile } = await supabase.from('users_profile').select('prenom, nom').eq('user_id', user.id).single();

            const tempReply = { session_id: sessionId, user_id: user.id, texte: texte, tempId: Date.now() };
            this.pendingReplies.push(tempReply);
            input.value = '';

            if (this.refreshCallback && this.currentArticleId) {
                await this.refreshCallback(this.currentArticleId, userProfile);
                setTimeout(() => {
                    const repliesContainer = document.getElementById(`replies-${sessionId}`);
                    if (repliesContainer) repliesContainer.style.display = 'block';
                }, 100);
            }

            submitBtn.disabled = true;
            const originalContent = submitBtn.innerHTML;
            submitBtn.innerHTML = '<div class="comment-spinner"></div> Publication...';

            const { error } = await supabase.from('session_reponses').insert({ session_id: sessionId, user_id: user.id, texte: texte });
            this.pendingReplies = this.pendingReplies.filter(r => r.tempId !== tempReply.tempId);

            if (error) throw error;

            this.showAlert('Réponse publiée avec succès !', 'success');

            if (this.refreshCallback && this.currentArticleId) {
                await this.refreshCallback(this.currentArticleId);
                setTimeout(() => {
                    const repliesContainer = document.getElementById(`replies-${sessionId}`);
                    if (repliesContainer) repliesContainer.style.display = 'block';
                }, 100);
            }

            submitBtn.disabled = false;
            submitBtn.innerHTML = originalContent;

        } catch (error) {
            console.error('Erreur:', error);
            this.showAlert('Erreur lors de la publication de la réponse', 'error');
            this.pendingReplies = this.pendingReplies.filter(r => r.session_id !== sessionId);
            if (this.refreshCallback && this.currentArticleId) await this.refreshCallback(this.currentArticleId);
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Répondre';
        }
    },

    editComment(sessionId) {
        document.getElementById(`comment-text-${sessionId}`).style.display = 'none';
        document.getElementById(`comment-edit-${sessionId}`).style.display = 'block';
        const textarea = document.getElementById(`edit-textarea-${sessionId}`);
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    },

    cancelEditComment(sessionId) {
        document.getElementById(`comment-text-${sessionId}`).style.display = 'block';
        document.getElementById(`comment-edit-${sessionId}`).style.display = 'none';
    },

    async saveEditComment(sessionId) {
        const { supabase } = window.supabaseClient;
        const textarea = document.getElementById(`edit-textarea-${sessionId}`);
        const newText = textarea.value.trim();

        if (!newText) {
            this.showAlert('Le commentaire ne peut pas être vide', 'warning');
            return;
        }

        try {
            const { error } = await supabase.from('sessions_commentaires').update({ texte: newText }).eq('session_id', sessionId);
            if (error) throw error;

            this.showAlert('Commentaire modifié avec succès !', 'success');
            document.getElementById(`comment-text-${sessionId}`).innerHTML = this.escapeHtml(newText);
            document.getElementById(`comment-text-${sessionId}`).style.display = 'block';
            document.getElementById(`comment-edit-${sessionId}`).style.display = 'none';
        } catch (error) {
            console.error('Erreur:', error);
            this.showAlert('Erreur lors de la modification du commentaire', 'error');
        }
    },

    editReply(reponseId) {
        document.getElementById(`reply-text-${reponseId}`).style.display = 'none';
        document.getElementById(`reply-edit-${reponseId}`).style.display = 'block';
        const textarea = document.getElementById(`edit-reply-textarea-${reponseId}`);
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    },

    cancelEditReply(reponseId) {
        document.getElementById(`reply-text-${reponseId}`).style.display = 'block';
        document.getElementById(`reply-edit-${reponseId}`).style.display = 'none';
    },

    async saveEditReply(reponseId) {
        const { supabase } = window.supabaseClient;
        const textarea = document.getElementById(`edit-reply-textarea-${reponseId}`);
        const newText = textarea.value.trim();

        if (!newText) {
            this.showAlert('La réponse ne peut pas être vide', 'warning');
            return;
        }

        try {
            const { error } = await supabase.from('session_reponses').update({ texte: newText }).eq('reponse_id', reponseId);
            if (error) throw error;

            this.showAlert('Réponse modifiée avec succès !', 'success');
            document.getElementById(`reply-text-${reponseId}`).innerHTML = this.escapeHtml(newText);
            document.getElementById(`reply-text-${reponseId}`).style.display = 'block';
            document.getElementById(`reply-edit-${reponseId}`).style.display = 'none';
        } catch (error) {
            console.error('Erreur:', error);
            this.showAlert('Erreur lors de la modification de la réponse', 'error');
        }
    },

    deleteComment(id, type) {
        const modal = document.createElement('div');
        modal.className = 'delete-confirm-modal';
        modal.innerHTML = `
            <div class="delete-confirm-content">
                <h3><i class="fas fa-exclamation-triangle" style="color: #f44336;"></i>Confirmer la suppression</h3>
                <p>Êtes-vous sûr de vouloir supprimer ce ${type === 'comment' ? 'commentaire' : 'réponse'} ? Cette action est irréversible.</p>
                <div class="delete-confirm-actions">
                    <button class="delete-confirm-btn cancel" onclick="this.closest('.delete-confirm-modal').remove()"><i class="fas fa-times"></i> Annuler</button>
                    <button class="delete-confirm-btn confirm" onclick="CommentsWidget.confirmDelete('${id}', '${type}')"><i class="fas fa-trash"></i> Supprimer</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    },

    async confirmDelete(id, type) {
        const { supabase } = window.supabaseClient;
        const modal = document.querySelector('.delete-confirm-modal');
        if (modal) modal.remove();

        try {
            let error;
            if (type === 'comment') {
                ({ error } = await supabase.from('sessions_commentaires').delete().eq('session_id', id));
            } else {
                ({ error } = await supabase.from('session_reponses').delete().eq('reponse_id', id));
            }

            if (error) throw error;

            this.showAlert(`${type === 'comment' ? 'Commentaire' : 'Réponse'} supprimé avec succès !`, 'success');

            if (this.refreshCallback && this.currentArticleId) {
                await this.refreshCallback(this.currentArticleId);
            }

        } catch (error) {
            console.error('Erreur:', error);
            this.showAlert(`Erreur lors de la suppression du ${type === 'comment' ? 'commentaire' : 'réponse'}`, 'error');
        }
    },

    showAlert(message, type = 'info') {
        const oldAlerts = document.querySelectorAll('.alert-message');
        oldAlerts.forEach(alert => alert.remove());

        const alert = document.createElement('div');
        alert.className = `alert-message ${type}`;
        
        const icon = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        }[type] || 'fa-info-circle';
        
        alert.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
        document.body.appendChild(alert);

        setTimeout(() => alert.remove(), 3000);
    },

    toggleReplyBox(sessionId) {
        const box = document.getElementById(`reply-box-${sessionId}`);
        const isVisible = box.style.display !== 'none';
        
        document.querySelectorAll('[id^="reply-box-"]').forEach(b => {
            if (b.id !== `reply-box-${sessionId}`) {
                b.style.display = 'none';
            }
        });
        
        box.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            const textarea = document.getElementById(`reply-input-${sessionId}`);
            setTimeout(() => textarea.focus(), 100);
        }
    },

    toggleReplies(sessionId) {
        const replies = document.getElementById(`replies-${sessionId}`);
        const isVisible = replies.style.display !== 'none';
        replies.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            replies.style.opacity = '0';
            replies.style.transform = 'translateY(-10px)';
            setTimeout(() => {
                replies.style.transition = 'all 0.3s ease';
                replies.style.opacity = '1';
                replies.style.transform = 'translateY(0)';
            }, 10);
        }
    },

    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 7) {
            return date.toLocaleDateString('fr-FR', { 
                day: 'numeric', 
                month: 'short',
                year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
            });
        } else if (days > 0) {
            return `Il y a ${days} jour${days > 1 ? 's' : ''}`;
        } else if (hours > 0) {
            return `Il y a ${hours} heure${hours > 1 ? 's' : ''}`;
        } else if (minutes > 0) {
            return `Il y a ${minutes} minute${minutes > 1 ? 's' : ''}`;
        } else {
            return 'À l\'instant';
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
