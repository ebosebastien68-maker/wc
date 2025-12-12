window.CommentsWidget = {
    articleId: null,
    currentUser: null,
    userProfile: null,
    pendingComments: [],
    pendingReplies: [],
    
    // --- FONCTION DE LOGGING ROBUSTE (Utile pour le débogage) ---
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

    // 🚩 CORRECTION CRITIQUE : Alias pour la méthode 'render'
    // Ceci corrige l'erreur "TypeError: window.CommentsWidget.render is not a function"
    render: function(articleId, currentUser, userProfile) {
        this.log('warn', "Appel de l'ancienne méthode 'render'. Redirection vers 'init'.");
        if (articleId && currentUser) {
            this.init(articleId, currentUser, userProfile);
        } else if (this.articleId) {
            this.fetchComments();
        } else {
            this.log('error', "Appel 'render' invalide : Manque les paramètres d'initialisation.");
        }
    },

    // Point d'entrée principal
    init(articleId, currentUser, userProfile) {
        this.log('info', 'Initialisation du Widget de Commentaires.');
        this.articleId = articleId;
        this.currentUser = currentUser;
        this.userProfile = userProfile;
        
        // Attacher les gestionnaires d'événements
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

        // Requête vers la VUE UNIFIÉE des commentaires
        const { data: comments, error } = await supabase
            .from('comments_with_actor_info') // <-- Vue 1
            .select('*') 
            .eq('article_id', this.articleId)
            .order('date_created', { ascending: true });

        if (error) {
            this.log('error', 'Erreur critique lors du chargement des commentaires. (Vérifiez RLS).', error);
            commentList.innerHTML = '<div style="color: red;">Erreur de chargement. Veuillez vérifier les politiques RLS de la vue SQL.</div>';
            return;
        }

        this.log('success', `Chargement de ${comments.length} commentaires réussi.`);
        commentList.innerHTML = await this.renderCommentsHtml(comments);
    },

    async renderCommentsHtml(comments) {
        const { supabase } = window.supabaseClient;
        let html = '';
        
        // Rendu des commentaires en attente (logique à adapter si nécessaire)
        // ...

        for (const comment of comments) {
            const prenom = comment.prenom_acteur || 'Auteur';
            const nom = comment.nom_acteur || 'Inconnu';
            const initials = `${prenom[0]}${nom[0] || ''}`.toUpperCase();
            // Vérification si l'utilisateur connecté est l'auteur (via l'ID utilisateur)
            const isAuthor = this.currentUser && this.currentUser.id === comment.user_id; 

            // Requête vers la VUE UNIFIÉE des réponses pour le session_id actuel
            const { data: replies, error: replyError } = await supabase
                .from('replies_with_actor_info') // <-- Vue 2 (Lien par session_id)
                .select('*')
                .eq('session_id', comment.session_id) 
                .order('date_created', { ascending: true });
            
            if (replyError) {
                this.log('error', `Erreur lors du chargement des réponses pour le commentaire ${comment.session_id}`, replyError);
            }

            // --- Début du Rendu HTML du Commentaire Principal ---
            html += `
                <div class="comment-item" id="comment-${comment.session_id}">
                    <div class="comment-header">
                        <div class="comment-avatar">${initials}</div>
                        <span class="comment-author">${prenom} ${nom}</span>
                        <span class="comment-date">${this.formatDate(comment.date_created)}</span>
                    </div>
                    <div id="comment-text-${comment.session_id}" class="comment-text">${this.escapeHtml(comment.texte)}</div>
                    
                    <div class="comment-actions">
                        ${this.currentUser ? `<button class="comment-btn" onclick="CommentsWidget.toggleReplyBox('${comment.session_id}')"><i class="fas fa-reply"></i> Répondre</button>` : ''}
                        ${isAuthor ? `
                            <button class="comment-btn edit" onclick="CommentsWidget.editComment('${comment.session_id}')"><i class="fas fa-edit"></i> Modifier</button>
                            <button class="comment-btn delete" onclick="CommentsWidget.deleteComment('${comment.session_id}', 'comment')"><i class="fas fa-trash"></i> Supprimer</button>
                        ` : ''}
                    </div>
                    
                    <div id="reply-box-${comment.session_id}" style="display: none; /* ... styles ... */">
                        <textarea id="reply-input-${comment.session_id}" class="comment-textarea" placeholder="Écrivez votre réponse..." style="min-height: 60px;"></textarea>
                        <button class="comment-submit" onclick="CommentsWidget.submitReply('${comment.session_id}')"><i class="fas fa-paper-plane"></i> Répondre</button>
                    </div>
                    
                    ${replies && replies.length > 0 ? `
                        <div id="replies-${comment.session_id}" class="replies-container" style="display: none;">
                            ${replies.map(reply => {
                                const replyPrenom = reply.prenom_acteur || 'Auteur';
                                const replyNom = reply.nom_acteur || 'Inconnu';
                                const replyInitials = `${replyPrenom[0]}${replyNom[0] || ''}`.toUpperCase();
                                const isReplyAuthor = this.currentUser && this.currentUser.id === reply.user_id;

                                return `
                                    <div class="reply-item" id="reply-${reply.reponse_id}">
                                        <div class="comment-header">
                                            <div class="comment-avatar" style="width: 30px; height: 30px; font-size: 12px;">${replyInitials}</div>
                                            <span class="comment-author" style="font-size: 14px;">${replyPrenom} ${replyNom}</span>
                                            <span class="comment-date">${this.formatDate(reply.date_created)}</span>
                                        </div>
                                        <div class="comment-text" style="font-size: 14px;">${this.escapeHtml(reply.texte)}</div>
                                        ${isReplyAuthor ? `
                                            ` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }
        return html;
    },

    // --- Fonctions d'Action (à inclure pour la complétude) ---

    // Exemple de soumission de commentaire
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
        
        const { supabase } = window.supabaseClient;
        
        // Détermination du profil à enregistrer
        let payload = {
            article_id: this.articleId,
            texte: texte,
            date_created: new Date().toISOString()
        };

        if (this.currentUser.user_id) { // Si c'est un utilisateur authentifié
            payload.user_id = this.currentUser.user_id;
        } else if (this.currentUser.public_profile_id) { // Si c'est un profil simulé
             payload.public_profile_id = this.currentUser.public_profile_id;
        } else {
             this.log('error', 'Impossible de déterminer le type d\'utilisateur pour la soumission.');
             this.showAlert('Erreur de profil utilisateur.', 'error');
             return;
        }

        // Insertion dans la table des commentaires
        const { error } = await supabase
            .from('sessions_commentaires')
            .insert([payload]);

        if (error) {
            this.log('error', 'Erreur lors de l\'enregistrement du commentaire.', error);
            this.showAlert('Erreur d\'enregistrement du commentaire.', 'error');
        } else {
            this.log('success', 'Commentaire enregistré avec succès.');
            input.value = '';
            this.fetchComments(); // Rafraîchir
        }
    },
    
    // ... (Toutes les autres fonctions : submitReply, deleteComment, formatDate, escapeHtml, showAlert, etc. doivent être incluses ici) ...
    
    formatDate(dateString) {
        const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        return new Date(dateString).toLocaleDateString(undefined, options);
    },

    escapeHtml(unsafe) {
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    },

    showAlert(message, type = 'info') {
        console.log(`ALERTE [${type.toUpperCase()}]: ${message}`);
        // Ici, vous pouvez ajouter une logique pour afficher un message à l'utilisateur dans le DOM
    },

    // Fonctions d'édition/suppression simplifiées (à compléter avec votre logique réelle)
    // ...
};

window.CommentsWidget = window.CommentsWidget;
