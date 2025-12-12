window.CommentsWidget = {
    articleId: null,
    currentUser: null,
    userProfile: null,
    
    // --- FONCTIONS LOG/UTILITAIRES (Inchangées) ---
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
        // IMPORTANT : Si articleId est encore un objet HTML, c'est ici que ça sera exposé.
        this.log('info', 'Initialisation (TEST LECTURE SEULE DES COMMENTAIRES).');
        this.articleId = articleId;
        this.currentUser = currentUser;
        this.userProfile = userProfile;
        
        // Nous désactivons l'événement de soumission pour ce test de lecture
        // const submitButton = document.getElementById('comment-submit');
        // if (submitButton) { submitButton.onclick = () => this.submitComment(); }
        
        this.fetchComments();
    },

    // --- REQUÊTE MODIFIÉE : LECTURE UNIQUMENT DE sessions_commentaires ---
    async fetchComments() {
        this.log('info', `Démarrage de la récupération des commentaires pour article: ${this.articleId}`);
        const { supabase } = window.supabaseClient;
        const commentList = document.getElementById('comment-list');
        
        // Requete unique vers la table des commentaires
        const { data: comments, error } = await supabase
            .from('sessions_commentaires') 
            .select('session_id, user_id, public_profile_id, texte, date_created') 
            .eq('article_id', this.articleId) // Filtration par article_id
            .order('date_created', { ascending: true });

        if (error) {
            this.log('error', 'ÉCHEC TOTAL. (Vérifiez si articleId est un UUID et le RLS sur la table).', error);
            if (commentList) {
                commentList.innerHTML = '<div style="color: red;">ERREUR DE CHARGEMENT. (Problème de type de données ou de RLS sur la table sessions_commentaires).</div>';
            }
            return;
        }

        this.log('success', `Chargement de ${comments.length} commentaires réussi.`);
        if (commentList) {
            commentList.innerHTML = this.renderCommentsHtml(comments);
        }
    },

    renderCommentsHtml(comments) {
        let html = '';
        
        for (const comment of comments) {
            // Affichage extrêmement simplifié pour ce test
            const prenom = comment.user_id ? 'Auth' : 'Simulé';
            const nom = comment.session_id.substring(0, 5); 
            const initials = prenom[0];

            // --- Rendu HTML SANS REPONSE/ACTION ---
            html += `
                <div class="comment-item" id="comment-${comment.session_id}">
                    <div class="comment-header">
                        <div class="comment-avatar">${initials}</div>
                        <span class="comment-author">${prenom} ${nom}</span>
                        <span class="comment-date">${this.formatDate(comment.date_created)}</span>
                    </div>
                    <div class="comment-text">COMMENTAIRE : ${this.escapeHtml(comment.texte)}</div>
                </div>
            `;
        }
        return html;
    },
    
    // --- Les fonctions submitComment, submitReply, edit, delete, etc. sont omises pour ce test de lecture ---
};

window.CommentsWidget = window.CommentsWidget;
