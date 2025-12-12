window.CommentsWidget = {
    articleId: null,
    currentUser: null,
    userProfile: null,
    
    // --- FONCTIONS LOG/UTILITAIRES ---
    log: function(level, message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = `[WidgetComments - ${timestamp}]`;
        switch (level) {
            case 'info': console.info(`${prefix} INFO: ${message}`, data); break;
            case 'error': console.error(`${prefix} ERREUR: ${message}`, data); break;
            default: console.log(`${prefix} LOG: ${message}`, data);
        }
    },
    formatDate(dateString) {
        const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        return new Date(dateString).toLocaleDateString(undefined, options);
    },
    escapeHtml(unsafe) {
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    },
    showAlert(message, type = 'info') {
        this.log(type, `ALERTE: ${message}`);
    },
    // ------------------------------------

    // 🚩 ALIAS 'render' pour la correction JavaScript
    render: function(articleId, currentUser, userProfile) {
        this.log('warn', "Appel de l'ancienne méthode 'render'. Redirection vers 'init'.");
        if (articleId) {
            this.init(articleId, currentUser, userProfile);
        } else {
            this.log('error', "Appel 'render' invalide.");
        }
    },

    init(articleId, currentUser, userProfile) {
        this.log('info', 'Initialisation du Widget de Commentaires (VERSION AUTHENTIQUE).');
        this.articleId = articleId;
        this.currentUser = currentUser;
        this.userProfile = userProfile;
        
        const submitButton = document.getElementById('comment-submit');
        if (submitButton) {
            submitButton.onclick = () => this.submitComment();
        }
        this.fetchComments();
    },

    // --- REQUÊTES AUTHENTIQUES (Utilisation des Vues SQL) ---
    async fetchComments() {
        this.log('info', `Démarrage de la récupération des commentaires pour article: ${this.articleId}`);
        const { supabase } = window.supabaseClient;
        const commentList = document.getElementById('comment-list');
        
        // Requête 1: VUE comments_with_actor_info
        const { data: comments, error } = await supabase
            .from('comments_with_actor_info') // <-- VUE AUTHENTIQUE
            .select('*') 
            .eq('article_id', this.articleId)
            .order('date_created', { ascending: true });

        if (error) {
            this.log('error', 'Échec du chargement sur VUE SQL. (Vérifiez le RLS ou le type articleId).', error);
            if (commentList) {
                commentList.innerHTML = '<div style="color: red;">ERREUR. (Code: RLS-Failure). La cause est probablement l\'absence de RLS sur les Vues SQL.</div>';
            }
            return;
        }

        this.log('success', `Chargement de ${comments.length} commentaires réussi.`);
        if (commentList) {
            commentList.innerHTML = await this.renderCommentsHtml(comments);
        }
    },

    async renderCommentsHtml(comments) {
        const { supabase } = window.supabaseClient;
        let html = '';
        
        for (const comment of comments) {
            // Utilisation des colonnes fusionnées
            const prenom = comment.prenom_acteur || 'Auteur';
            const nom = comment.nom_acteur || 'Inconnu';
            const initials = `${prenom[0]}${nom[0] || ''}`.toUpperCase();
            const isAuthor = this.currentUser && this.currentUser.id === comment.user_id; 

            // Requête 2: VUE replies_with_actor_info
            const { data: replies, error: replyError } = await supabase
                .from('replies_with_actor_info') // <-- VUE AUTHENTIQUE
                .select('*')
                .eq('session_id', comment.session_id) 
                .order('date_created', { ascending: true });
            
            if (replyError) {
                this.log('warn', `Erreur ou pas de réponse pour le commentaire ${comment.session_id}.`, replyError);
            }

            // --- Rendu HTML ---
            html += `
                <div class="comment-item" id="comment-${comment.session_id}">
                    <div class="comment-header">
                        <div class="comment-avatar">${initials}</div>
                        <span class="comment-author">${prenom} ${nom}</span>
                        <span class="comment-date">${this.formatDate(comment.date_created)}</span>
                    </div>
                    <div id="comment-text-${comment.session_id}" class="comment-text">${this.escapeHtml(comment.texte)}</div>
                    
                    <div class="comment-actions">
                        ${this.currentUser ? `<button class="comment-btn" onclick="CommentsWidget.toggleReplyBox('${comment.session_id}')">Répondre</button>` : ''}
                        ${isAuthor ? `
                            <button class="comment-btn edit" onclick="CommentsWidget.editComment('${comment.session_id}')">Modifier</button>
                            <button class="comment-btn delete" onclick="CommentsWidget.deleteComment('${comment.session_id}', 'comment')">Supprimer</button>
                        ` : ''}
                    </div>
                    
                    <div id="reply-box-${comment.session_id}" style="display: none; padding-left: 45px;">
                        <textarea id="reply-input-${comment.session_id}" class="comment-textarea" placeholder="Votre réponse..."></textarea>
                        <button class="comment-submit" onclick="CommentsWidget.submitReply('${comment.session_id}')">Envoyer Réponse</button>
                    </div>
                    
                    ${replies && replies.length > 0 ? `
                        <div id="replies-${comment.session_id}" class="replies-container" style="display: none;">
                            ${replies.map(reply => {
                                const replyPrenom = reply.prenom_acteur || 'Auteur';
                                const replyNom = reply.nom_acteur || 'Inconnu';
                                const replyInitials = `${replyPrenom[0]}${replyNom[0] || ''}`.toUpperCase();
                                
                                return `<div class="reply-item">... Réponse de ${replyPrenom} ${replyNom} ...</div>`;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }
        return html;
    },
    
    // --- FONCTIONS D'ACTION (Utilisation des Tables Originales pour l'Insertion) ---

    async submitComment() {
        // ... (Logique d'insertion dans 'sessions_commentaires') ...
        if (!this.currentUser) return this.showAlert('Vous devez être connecté.', 'error');
        const input = document.getElementById('comment-input');
        const texte = input.value.trim();
        if (!texte) return this.showAlert('Veuillez écrire un commentaire.', 'warning');
        
        const { supabase } = window.supabaseClient;
        let payload = { article_id: this.articleId, texte: texte, date_created: new Date().toISOString() };
        
        if (this.currentUser.user_id) { payload.user_id = this.currentUser.user_id; } 
        else if (this.currentUser.public_profile_id) { payload.public_profile_id = this.currentUser.public_profile_id; } 
        else { return this.showAlert('Erreur de profil utilisateur.', 'error'); }

        const { error } = await supabase
            .from('sessions_commentaires') 
            .insert([payload]);

        if (error) { this.log('error', 'Erreur lors de l\'enregistrement du commentaire.', error); this.showAlert('Erreur d\'enregistrement.', 'error'); } 
        else { this.showAlert('Commentaire enregistré avec succès.', 'success'); input.value = ''; this.fetchComments(); }
    },
    
    async submitReply(sessionId) {
        // ... (Logique d'insertion dans 'session_reponses') ...
        if (!this.currentUser) return this.showAlert('Vous devez être connecté pour répondre.', 'error');
        const input = document.getElementById(`reply-input-${sessionId}`);
        const texte = input.value.trim();
        if (!texte) return this.showAlert('Veuillez écrire une réponse.', 'warning');
        
        const { supabase } = window.supabaseClient;
        let payload = { session_id: sessionId, texte: texte, date_created: new Date().toISOString() };
        
        if (this.currentUser.user_id) { payload.user_id = this.currentUser.user_id; } 
        else if (this.currentUser.public_profile_id) { payload.public_profile_id = this.currentUser.public_profile_id; } 
        else { return this.showAlert('Erreur de profil utilisateur.', 'error'); }

        const { error } = await supabase
            .from('session_reponses') 
            .insert([payload]);

        if (error) { this.log('error', 'Erreur lors de l\'enregistrement de la réponse.', error); this.showAlert('Erreur d\'enregistrement de la réponse.', 'error'); } 
        else { this.showAlert('Réponse enregistrée avec succès.', 'success'); input.value = ''; this.toggleReplyBox(sessionId); this.fetchComments(); }
    },
    
    // Simplification des fonctions de modification/suppression
    editComment(sessionId) { this.showAlert(`Modifier le commentaire ${sessionId}`, 'info'); },
    deleteComment(id, type) { this.showAlert(`Supprimer ${type}: ${id}`, 'info'); },
    toggleReplyBox(sessionId) {
        const replyBox = document.getElementById(`reply-box-${sessionId}`);
        if (replyBox) replyBox.style.display = replyBox.style.display === 'none' ? 'block' : 'none';
    },
    // ...
};

window.CommentsWidget = window.CommentsWidget;
