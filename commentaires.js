window.CommentsWidget = {
    supabase: null,
    articleId: null,
    currentUser: null,
    userProfile: null,
    realtimeChannel: null,

    // --- INITIALISATION ---
    async init() {
        // 1. Initialisation Supabase & User
        if (window.supabaseClient) {
            this.supabase = window.supabaseClient.supabase;
            this.currentUser = await window.supabaseClient.getCurrentUser();
            if (this.currentUser) {
                // On récupère le profil complet si nécessaire
                this.userProfile = await window.supabaseClient.getUserProfile(this.currentUser.id);
            }
        } else {
            console.error("Supabase Client introuvable.");
            return;
        }

        // 2. Récupération de l'ID Article depuis l'URL
        const urlParams = new URLSearchParams(window.location.search);
        this.articleId = urlParams.get('article_id');

        if (!this.articleId) {
            this.log('error', "ID de l'article manquant dans l'URL.");
            return;
        }

        this.log('info', `Initialisation pour l'article : ${this.articleId}`);

        // 3. Attacher les événements DOM (Bouton envoyer)
        const submitButton = document.getElementById('comment-submit');
        if (submitButton) {
            // Retirer les anciens listeners pour éviter les doublons
            const newBtn = submitButton.cloneNode(true);
            submitButton.parentNode.replaceChild(newBtn, submitButton);
            newBtn.addEventListener('click', () => this.submitComment());
        }

        // 4. Charger les données et activer le Realtime
        await this.loadData();
        this.setupRealtime();
    },

    // --- CHARGEMENT DES DONNÉES (LECTURE VIA VUES) ---
    async loadData() {
        const container = document.getElementById('comment-list');
        if (!container) return;

        try {
            // A. Récupérer les COMMENTAIRES via la VUE
            const { data: comments, error: commentError } = await this.supabase
                .from('comments_with_actor_info')
                .select('*')
                .eq('article_id', this.articleId)
                .order('date_created', { ascending: false }); // Plus récents en haut

            if (commentError) throw commentError;

            // B. Récupérer les RÉPONSES via la VUE (Filtrées par article_id pour optimiser)
            const { data: replies, error: replyError } = await this.supabase
                .from('replies_with_actor_info')
                .select('*')
                .eq('article_id', this.articleId)
                .order('date_created', { ascending: true }); // Plus anciennes en premier (logique de discussion)

            if (replyError) throw replyError;

            // C. Rendu
            this.renderComments(container, comments || [], replies || []);

        } catch (err) {
            this.log('error', 'Erreur lors du chargement des données.', err);
            container.innerHTML = `<p class="error-msg">Impossible de charger les discussions.</p>`;
        }
    },

    // --- RENDU HTML ---
    renderComments(container, comments, allReplies) {
        if (comments.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>Soyez le premier à commenter cet article !</p></div>`;
            return;
        }

        // On groupe les réponses par leur parent (session_id)
        const repliesByComment = {};
        allReplies.forEach(r => {
            const parentId = r.commentaire_parent_id; // Colonne définie dans la VUE
            if (!repliesByComment[parentId]) repliesByComment[parentId] = [];
            repliesByComment[parentId].push(r);
        });

        const html = comments.map(comment => {
            // Mapping des colonnes de la VUE SQL
            const commentId = comment.session_id;
            const prenom = comment.prenom_acteur || 'Utilisateur';
            const nom = comment.nom_acteur || '';
            const texte = comment.commentaire_texte; // Colonne définie dans la VUE
            const date = comment.date_created;
            const initials = `${prenom[0]}${nom ? nom[0] : ''}`.toUpperCase();
            
            // Gestion des boutons d'action (Si c'est mon commentaire)
            const isMyComment = this.currentUser && this.currentUser.id === comment.acteur_id;

            // Récupérer les réponses pour ce commentaire
            const commentReplies = repliesByComment[commentId] || [];
            
            // Génération HTML des réponses
            const repliesHtml = commentReplies.map(reply => {
                const rPrenom = reply.prenom_acteur || 'Utilisateur';
                const rNom = reply.nom_acteur || '';
                const rInitials = `${rPrenom[0]}${rNom ? rNom[0] : ''}`.toUpperCase();
                
                return `
                    <div class="reply-item" id="reply-${reply.reponse_id}">
                        <div class="reply-header">
                            <div class="reply-avatar-small">${rInitials}</div>
                            <span class="reply-author">${rPrenom} ${rNom}</span>
                            <span class="reply-date">${this.formatDate(reply.date_created)}</span>
                        </div>
                        <div class="reply-text">${this.escapeHtml(reply.reponse_texte)}</div>
                    </div>
                `;
            }).join('');

            return `
                <div class="comment-item" id="comment-${commentId}">
                    <div class="comment-main">
                        <div class="comment-header">
                            <div class="comment-avatar">${initials}</div>
                            <div class="comment-meta">
                                <span class="comment-author">${prenom} ${nom}</span>
                                <span class="comment-date">${this.formatDate(date)}</span>
                            </div>
                        </div>
                        <div class="comment-body">
                            ${this.escapeHtml(texte)}
                        </div>
                        <div class="comment-actions">
                            <button class="action-btn reply-btn" onclick="CommentsWidget.toggleReplyBox('${commentId}')">
                                <i class="fas fa-reply"></i> Répondre
                            </button>
                            ${isMyComment ? `
                                <button class="action-btn delete-btn" onclick="CommentsWidget.deleteComment('${commentId}')">
                                    <i class="fas fa-trash"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    <div id="reply-box-${commentId}" class="reply-input-box" style="display:none;">
                        <textarea id="reply-input-${commentId}" placeholder="Écrivez votre réponse..."></textarea>
                        <button onclick="CommentsWidget.submitReply('${commentId}')">Publier</button>
                    </div>

                    <div class="replies-list">
                        ${repliesHtml}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    },

    // --- LOGIQUE D'INSERTION (ÉCRITURE DANS LES TABLES) ---
    async submitComment() {
        if (!this.currentUser) {
            this.showAlert('Veuillez vous connecter pour commenter.', 'error');
            return;
        }

        const input = document.getElementById('comment-input');
        const texte = input.value.trim();

        if (!texte) return;

        // Insertion dans la TABLE 'sessions_commentaires'
        const { error } = await this.supabase
            .from('sessions_commentaires')
            .insert([{
                article_id: this.articleId,
                user_id: this.currentUser.id,
                texte: texte
            }]);

        if (error) {
            this.log('error', "Erreur insertion commentaire", error);
            this.showAlert("Erreur lors de l'envoi.", 'error');
        } else {
            input.value = ''; // Vider le champ
            // Pas besoin de recharger manuellement si le Realtime est actif, 
            // mais par sécurité on peut appeler this.loadData()
        }
    },

    async submitReply(parentId) {
        if (!this.currentUser) {
            this.showAlert('Veuillez vous connecter pour répondre.', 'error');
            return;
        }

        const input = document.getElementById(`reply-input-${parentId}`);
        const texte = input.value.trim();

        if (!texte) return;

        // Insertion dans la TABLE 'session_reponses'
        const { error } = await this.supabase
            .from('session_reponses')
            .insert([{
                session_id: parentId, // Lien vers le commentaire parent
                user_id: this.currentUser.id,
                texte: texte
            }]);

        if (error) {
            this.log('error', "Erreur insertion réponse", error);
            this.showAlert("Erreur lors de l'envoi.", 'error');
        } else {
            this.toggleReplyBox(parentId); // Fermer la boite
            // Le Realtime mettra à jour l'affichage
        }
    },

    async deleteComment(commentId) {
        if (!confirm("Voulez-vous vraiment supprimer ce commentaire ?")) return;

        const { error } = await this.supabase
            .from('sessions_commentaires')
            .delete()
            .eq('session_id', commentId)
            .eq('user_id', this.currentUser.id); // Sécurité supplémentaire

        if (error) {
            this.showAlert("Impossible de supprimer.", 'error');
        }
    },

    // --- REALTIME / TEMPS RÉEL ---
    setupRealtime() {
        // On écoute les changements sur les TABLES (les vues ne déclenchent pas toujours les événements)
        // Mais on recharge les données depuis les VUES.
        
        if (this.realtimeChannel) {
            this.supabase.removeChannel(this.realtimeChannel);
        }

        this.realtimeChannel = this.supabase.channel('public:comments_updates')
            // Écoute des nouveaux commentaires sur la table
            .on('postgres_changes', 
                { event: '*', schema: 'public', table: 'sessions_commentaires', filter: `article_id=eq.${this.articleId}` }, 
                (payload) => {
                    this.log('info', 'Changement détecté sur commentaires', payload);
                    this.loadData(); // Recharger la vue complète
                }
            )
            // Écoute des nouvelles réponses sur la table
            .on('postgres_changes', 
                { event: '*', schema: 'public', table: 'session_reponses' }, 
                (payload) => {
                    this.log('info', 'Changement détecté sur réponses', payload);
                    this.loadData(); // Recharger la vue complète
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    this.log('info', 'Abonnement Temps Réel actif.');
                }
            });
    },

    // --- UTILITAIRES ---
    toggleReplyBox(id) {
        const box = document.getElementById(`reply-box-${id}`);
        if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
    },

    formatDate(dateString) {
        const options = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
        return new Date(dateString).toLocaleDateString('fr-FR', options);
    },

    escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },

    log(level, msg, data = null) {
        const prefix = `[CommentsWidget]`;
        if (data) console[level || 'log'](`${prefix} ${msg}`, data);
        else console[level || 'log'](`${prefix} ${msg}`);
    },

    showAlert(msg, type) {
        // Simple alerte pour l'exemple, à remplacer par votre système de notification (ex: Toastify)
        alert(msg);
    }
};

// Initialisation automatique au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
    window.CommentsWidget.init();
});
