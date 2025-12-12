window.CommentsWidget = {
    articleId: null,
    currentUser: null,
    userProfile: null,
    
    // ... (Logique de logging et autres fonctions utilitaires) ...
    log: function(level, message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = `[WidgetComments - ${timestamp}]`;
        // ... (Corps de la fonction log) ...
        switch (level) {
            case 'info':
                console.info(`${prefix} INFO: ${message}`, data);
                break;
            case 'error':
                console.error(`${prefix} ERREUR: ${message}`, data);
                break;
            default:
                console.log(`${prefix} LOG: ${message}`, data);
        }
    },
    // ------------------------------------

    // 🚩 Alias pour la méthode 'render' (la correction JavaScript est toujours là)
    render: function(articleId, currentUser, userProfile) {
        this.log('warn', "Appel de l'ancienne méthode 'render'. Redirection vers 'init'.");
        if (articleId && currentUser) {
            this.init(articleId, currentUser, userProfile);
        } else if (this.articleId) {
            this.fetchComments();
        } else {
            this.log('error', "Appel 'render' invalide.");
        }
    },

    // Point d'entrée principal (init)
    init(articleId, currentUser, userProfile) {
        this.log('info', 'Initialisation du Widget de Commentaires.');
        this.articleId = articleId;
        this.currentUser = currentUser;
        this.userProfile = userProfile;
        // ... (Attachement de l'événement submitComment) ...
        const submitButton = document.getElementById('comment-submit');
        if (submitButton) {
            submitButton.onclick = () => this.submitComment();
        }
        this.fetchComments();
    },

    async fetchComments() {
        this.log('info', `Démarrage de la récupération des commentaires (TEST sur TABLE AUTHENTIQUE).`);
        const { supabase } = window.supabaseClient;
        const commentList = document.getElementById('comment-list');
        
        // --- REQUÊTE MODIFIÉE : Interrogation DIRECTE de la table sessions_commentaires ---
        const { data: comments, error } = await supabase
            .from('sessions_commentaires') // <-- TABLE AUTHENTIQUE !
            .select('session_id, article_id, user_id, public_profile_id, texte, date_created') 
            .eq('article_id', this.articleId)
            .order('date_created', { ascending: true });

        if (error) {
            this.log('error', 'Échec du chargement sur TABLE AUTHENTIQUE. (Problème RLS sur la table).', error);
            if (commentList) {
                commentList.innerHTML = '<div style="color: red;">Échec du chargement (TEST TABLE). RLS sur `sessions_commentaires` est probablement manquant.</div>';
            }
            return;
        }

        this.log('success', `Chargement réussi de ${comments.length} commentaires (TEST TABLE).`);
        if (commentList) {
            commentList.innerHTML = await this.renderCommentsHtml(comments);
        }
    },

    async renderCommentsHtml(comments) {
        const { supabase } = window.supabaseClient;
        let html = '';
        
        for (const comment of comments) {
            // Dans ce mode test, les données d'acteur ne sont pas fusionnées, 
            // mais nous affichons un placeholder pour vérifier le chargement.
            const isAuth = comment.user_id ? ' (Auth)' : ' (Simulé)';
            const prenom = 'Acteur';
            const nom = comment.session_id.substring(0, 5) + isAuth; // Affiche une partie de l'ID comme nom
            const initials = 'A'; // Placeholder
            const isAuthor = this.currentUser && this.currentUser.id === comment.user_id;

            // --- REQUÊTE MODIFIÉE : Interrogation DIRECTE de la table session_reponses ---
            const { data: replies, error: replyError } = await supabase
                .from('session_reponses') // <-- TABLE AUTHENTIQUE !
                .select('reponse_id, session_id, user_id, public_profile_id, texte, date_created')
                .eq('session_id', comment.session_id) 
                .order('date_created', { ascending: true });
            
            if (replyError) {
                this.log('warn', `Erreur ou pas de réponse sur la TABLE AUTHENTIQUE pour ${comment.session_id}.`, replyError);
            }

            // ... (Le reste du rendu HTML pour le Commentaire Principal et les Réponses) ...
            html += `
                <div class="comment-item">
                    <div class="comment-header">
                        <div class="comment-avatar">${initials}</div>
                        <span class="comment-author">${prenom} ${nom}</span>
                        <span class="comment-date">${this.formatDate(comment.date_created)}</span>
                    </div>
                    <div class="comment-text">${this.escapeHtml(comment.texte)}</div>
                    ${replies && replies.length > 0 ? `
                        <div class="replies-container">
                            ${replies.map(reply => {
                                // Affichage simplifié des réponses
                                const replyNom = reply.reponse_id.substring(0, 5);
                                return `<div class="reply-item">... Réponse de ${replyNom} ...</div>`;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }
        return html;
    },

    // ... (Toutes les autres fonctions : submitComment, init, formatDate, showAlert, etc. doivent être incluses ici) ...
    formatDate(dateString) { /* ... */ return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); },
    escapeHtml(unsafe) { /* ... */ return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); },
    showAlert(message, type = 'info') { this.log(type, `ALERTE: ${message}`); },
    // ...
};
