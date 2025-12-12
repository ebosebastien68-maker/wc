// commentaires.js - Widget Optimisé (Vues + Realtime)

window.CommentsWidget = {
    currentArticleId: null,
    supabase: null,
    currentUser: null,
    userProfile: null,
    realtimeChannel: null,
    
    // États locaux
    pendingComments: [],
    pendingReplies: [],
    
    // --- INITIALISATION ---
    async init() {
        // 1. Initialisation Supabase
        if (window.supabaseClient) {
            this.supabase = window.supabaseClient.supabase;
            this.currentUser = await window.supabaseClient.getCurrentUser();
            if (this.currentUser) {
                this.userProfile = await window.supabaseClient.getUserProfile(this.currentUser.id);
            }
        } else {
            console.error("Supabase Client introuvable.");
            return;
        }

        // 2. Récupération ID Article (Paramètre 'article')
        const urlParams = new URLSearchParams(window.location.search);
        this.currentArticleId = urlParams.get('article'); 

        // 3. Fallback sur attribut HTML si URL vide
        if (!this.currentArticleId) {
            const container = document.getElementById('comments-widget-container');
            if (container && container.dataset.articleId) {
                this.currentArticleId = container.dataset.articleId;
            }
        }

        if (!this.currentArticleId) {
            console.error("ID Article manquant (URL param 'article' ou data-attribut).");
            return;
        }

        // 4. Lancement
        await this.loadAndRender();
        this.setupRealtime();
    },

    // --- CHARGEMENT DES DONNÉES (LECTURE VIA VUES) ---
    async loadAndRender() {
        const container = document.getElementById('comments-widget-container');
        if (!container) return; // Il faut un div avec cet ID dans votre HTML

        try {
            // A. Charger les Commentaires (VUE)
            const { data: comments, error: cErr } = await this.supabase
                .from('comments_with_actor_info')
                .select('*')
                .eq('article_id', this.currentArticleId)
                .order('date_created', { ascending: false }); // Plus récents en haut

            if (cErr) throw cErr;

            // B. Charger les Réponses (VUE) - Tout d'un coup pour éviter les boucles
            const { data: replies, error: rErr } = await this.supabase
                .from('replies_with_actor_info')
                .select('*')
                .eq('article_id', this.currentArticleId)
                .order('date_created', { ascending: true }); // Chronologique

            if (rErr) throw rErr;

            // C. Rendu
            await this.render(container, comments || [], replies || []);

        } catch (error) {
            console.error("Erreur chargement:", error);
            container.innerHTML = `<p style="color:red; text-align:center;">Erreur de chargement des commentaires.</p>`;
        }
    },

    // --- RENDU UI (Votre logique visuelle conservée) ---
    async render(container, comments, allReplies) {
        // Sauvegarder la position de scroll
        const scrollPosition = container.scrollTop || 0;
        // const wasScrolledToBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;

        // Pré-traitement : Grouper les réponses par commentaire parent
        const repliesByParent = {};
        allReplies.forEach(r => {
            if (!repliesByParent[r.commentaire_parent_id]) repliesByParent[r.commentaire_parent_id] = [];
            repliesByParent[r.commentaire_parent_id].push(r);
        });

        // CSS (Votre style original)
        const styles = `
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
        `;

        container.innerHTML = `
            ${styles}
            <div class="comments-widget">
                ${comments.length === 0 && this.pendingComments.length === 0 ? `
                    <div class="no-comments">
                        <i class="fas fa-comments"></i>
                        <p>Aucun commentaire pour le moment</p>
                        <p style="font-size: 13px; margin-top: 5px;">Soyez le premier à commenter !</p>
                    </div>
                ` : ''}
                
                <div id="comments-list-${this.currentArticleId}">
                    ${this.generateCommentsHtml(comments, repliesByParent)}
                </div>
                
                ${this.currentUser ? `
                    <div class="comment-input-box">
                        <textarea id="comment-input-${this.currentArticleId}" class="comment-textarea" placeholder="Écrivez votre commentaire..."></textarea>
                        <button class="comment-submit" id="comment-submit-${this.currentArticleId}" onclick="CommentsWidget.submitComment('${this.currentArticleId}')">
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

        // Restauration scroll
        // setTimeout(() => { container.scrollTop = scrollPosition; }, 50);
    },

    generateCommentsHtml(comments, repliesByParent) {
        let html = '';

        // 1. Commentaires "En cours" (Optimistic UI)
        for (const pending of this.pendingComments.filter(c => c.article_id === this.currentArticleId)) {
            const initials = this.userProfile ? `${this.userProfile.prenom[0]}${this.userProfile.nom[0]}`.toUpperCase() : 'U';
            html += `
                <div class="comment-item pending">
                    <div class="comment-header">
                        <div class="comment-avatar">${initials}</div>
                        <span class="comment-author">${this.userProfile ? `${this.userProfile.prenom} ${this.userProfile.nom}` : 'Moi'}</span>
                        <span class="comment-date"><span class="pending-badge"><div class="pending-spinner"></div>En cours...</span></span>
                    </div>
                    <div class="comment-text">${this.escapeHtml(pending.texte)}</div>
                </div>
            `;
        }

        // 2. Commentaires de la VUE
        for (const comment of comments) {
            // MAPPING DES COLONNES DE LA VUE 'comments_with_actor_info'
            const sessionId = comment.session_id;
            const prenom = comment.prenom_acteur || 'Inconnu';
            const nom = comment.nom_acteur || '';
            const texte = comment.commentaire_texte; // Colonne VUE
            const date = comment.date_created;
            const authorId = comment.acteur_id;

            const initials = `${prenom[0]}${nom ? nom[0] : ''}`.toUpperCase();
            const isAuthor = this.currentUser && this.currentUser.id === authorId;
            
            // Réponses (depuis la map pré-calculée)
            const replies = repliesByParent[sessionId] || [];
            const pendingRepliesForComment = this.pendingReplies.filter(r => r.session_id === sessionId);
            const totalReplies = replies.length + pendingRepliesForComment.length;

            html += `
                <div class="comment-item" id="comment-${sessionId}">
                    <div class="comment-header">
                        <div class="comment-avatar">${initials}</div>
                        <span class="comment-author">${prenom} ${nom}</span>
                        <span class="comment-date">${this.formatDate(date)}</span>
                    </div>
                    <div id="comment-text-${sessionId}" class="comment-text">${this.escapeHtml(texte)}</div>
                    
                    <div id="comment-edit-${sessionId}" class="comment-text-editing" style="display: none;">
                        <textarea id="edit-textarea-${sessionId}" class="edit-textarea">${this.escapeHtml(texte)}</textarea>
                        <div class="edit-actions">
                            <button class="edit-btn-save" onclick="CommentsWidget.saveEditComment('${sessionId}')"><i class="fas fa-check"></i> Enregistrer</button>
                            <button class="edit-btn-cancel" onclick="CommentsWidget.cancelEditComment('${sessionId}')"><i class="fas fa-times"></i> Annuler</button>
                        </div>
                    </div>

                    <div class="comment-actions">
                        ${this.currentUser ? `<button class="comment-btn" onclick="CommentsWidget.toggleReplyBox('${sessionId}')"><i class="fas fa-reply"></i> Répondre</button>` : ''}
                        ${isAuthor ? `
                            <button class="comment-btn edit" onclick="CommentsWidget.editComment('${sessionId}')"><i class="fas fa-edit"></i> Modifier</button>
                            <button class="comment-btn delete" onclick="CommentsWidget.deleteComment('${sessionId}', 'comment')"><i class="fas fa-trash"></i> Supprimer</button>
                        ` : ''}
                        ${totalReplies > 0 ? `
                            <button class="comment-btn" onclick="CommentsWidget.toggleReplies('${sessionId}')"><i class="fas fa-comment"></i> ${totalReplies} réponse(s)</button>
                        ` : ''}
                    </div>
                    
                    <div id="reply-box-${sessionId}" style="display: none; margin-top: 10px; padding-left: 45px;">
                        <textarea id="reply-input-${sessionId}" class="comment-textarea" placeholder="Écrivez votre réponse..." style="min-height: 60px;"></textarea>
                        <button class="comment-submit" id="reply-submit-${sessionId}" onclick="CommentsWidget.submitReply('${sessionId}')" style="margin-top: 8px;"><i class="fas fa-paper-plane"></i> Répondre</button>
                    </div>
                    
                    ${totalReplies > 0 ? `
                        <div id="replies-${sessionId}" class="replies-container" style="display: none;">
                            ${this.generateRepliesHtml(replies, pendingRepliesForComment)}
                        </div>
                    ` : ''}
                </div>
            `;
        }
        return html;
    },

    generateRepliesHtml(replies, pendingReplies) {
        let html = '';

        // Réponses en cours
        pendingReplies.forEach(reply => {
            const replyInitials = this.userProfile ? `${this.userProfile.prenom[0]}$this.userProfile.nom[0]}`.toUpperCase() : 'U';
            html += `
                <div class="reply-item pending">
                    <div class="comment-header">
                        <div class="comment-avatar" style="width: 30px; height: 30px; font-size: 12px;">${replyInitials}</div>
                        <span class="comment-author" style="font-size: 14px;">${this.userProfile ? `${this.userProfile.prenom} ${this.userProfile.nom}` : 'Moi'}</span>
                        <span class="comment-date"><span class="pending-badge"><div class="pending-spinner"></div>En cours...</span></span>
                    </div>
                    <div class="comment-text" style="font-size: 14px;">${this.escapeHtml(reply.texte)}</div>
                </div>`;
        });

        // Réponses de la VUE
        replies.forEach(reply => {
            // MAPPING VUE 'replies_with_actor_info'
            const reponseId = reply.reponse_id;
            const rPrenom = reply.prenom_acteur || 'Inconnu';
            const rNom = reply.nom_acteur || '';
            const rTexte = reply.reponse_texte;
            const rDate = reply.date_created;
            const rInitials = `${rPrenom[0]}${rNom ? rNom[0] : ''}`.toUpperCase();
            const isReplyAuthor = this.currentUser && this.currentUser.id === reply.acteur_id;

            html += `
                <div class="reply-item" id="reply-${reponseId}">
                    <div class="comment-header">
                        <div class="comment-avatar" style="width: 30px; height: 30px; font-size: 12px;">${rInitials}</div>
                        <span class="comment-author" style="font-size: 14px;">${rPrenom} ${rNom}</span>
                        <span class="comment-date">${this.formatDate(rDate)}</span>
                    </div>
                    <div id="reply-text-${reponseId}" class="comment-text" style="font-size: 14px;">${this.escapeHtml(rTexte)}</div>
                    
                    <div id="reply-edit-${reponseId}" class="comment-text-editing" style="display: none;">
                        <textarea id="edit-reply-textarea-${reponseId}" class="edit-textarea" style="min-height: 50px; font-size: 14px;">${this.escapeHtml(rTexte)}</textarea>
                        <div class="edit-actions">
                            <button class="edit-btn-save" onclick="CommentsWidget.saveEditReply('${reponseId}')"><i class="fas fa-check"></i> Enregistrer</button>
                            <button class="edit-btn-cancel" onclick="CommentsWidget.cancelEditReply('${reponseId}')"><i class="fas fa-times"></i> Annuler</button>
                        </div>
                    </div>
                    
                    ${isReplyAuthor ? `
                        <div class="comment-actions" style="padding-left: 0; margin-top: 5px;">
                            <button class="comment-btn edit" onclick="CommentsWidget.editReply('${reponseId}')"><i class="fas fa-edit"></i> Modifier</button>
                            <button class="comment-btn delete" onclick="CommentsWidget.deleteComment('${reponseId}', 'reply')"><i class="fas fa-trash"></i> Supprimer</button>
                        </div>
                    ` : ''}
                </div>
            `;
        });

        return html;
    },

    // --- LOGIQUE REALTIME (TEMPS RÉEL) ---
    setupRealtime() {
        if (this.realtimeChannel) this.supabase.removeChannel(this.realtimeChannel);

        this.realtimeChannel = this.supabase.channel('public:comments_system')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions_commentaires', filter: `article_id=eq.${this.currentArticleId}` }, () => {
                this.loadAndRender(); // Recharger si un commentaire change
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'session_reponses' }, () => {
                this.loadAndRender(); // Recharger si une réponse change
            })
            .subscribe();
    },

    // --- ACTIONS D'ÉCRITURE (TABLES ORIGINALES) ---

    async submitComment(articleId) {
        const input = document.getElementById(`comment-input-${articleId}`);
        const submitBtn = document.getElementById(`comment-submit-${articleId}`);
        const texte = input.value.trim();

        if (!texte) return this.showAlert('Veuillez écrire un commentaire', 'warning');
        if (!this.currentUser) return this.showAlert('Connectez-vous pour commenter', 'error');

        try {
            // Optimistic UI
            const tempComment = { article_id: articleId, user_id: this.currentUser.id, texte: texte, tempId: Date.now() };
            this.pendingComments.push(tempComment);
            input.value = '';
            this.loadAndRender(); // Rafraichissement local immédiat

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<div class="comment-spinner"></div> Publication...';

            // Insertion Table TABLE
            const { error } = await this.supabase.from('sessions_commentaires').insert({ 
                article_id: articleId, 
                user_id: this.currentUser.id, 
                texte: texte 
            });

            if (error) throw error;
            
            // Nettoyage après succès (le Realtime ou le rechargement s'occupera de l'affichage final)
            this.pendingComments = this.pendingComments.filter(c => c.tempId !== tempComment.tempId);
            this.showAlert('Commentaire publié !', 'success');

        } catch (error) {
            console.error(error);
            this.showAlert('Erreur publication', 'error');
            this.pendingComments = this.pendingComments.filter(c => c.texte !== texte); // Retirer optimistic
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Publier';
            this.loadAndRender();
        }
    },

    async submitReply(sessionId) {
        const input = document.getElementById(`reply-input-${sessionId}`);
        const submitBtn = document.getElementById(`reply-submit-${sessionId}`);
        const texte = input.value.trim();

        if (!texte) return this.showAlert('Veuillez écrire une réponse', 'warning');
        if (!this.currentUser) return this.showAlert('Connectez-vous pour répondre', 'error');

        try {
            // Optimistic UI
            const tempReply = { session_id: sessionId, user_id: this.currentUser.id, texte: texte, tempId: Date.now() };
            this.pendingReplies.push(tempReply);
            input.value = '';
            
            // Forcer l'affichage du container
            const repliesDiv = document.getElementById(`replies-${sessionId}`);
            if(repliesDiv) repliesDiv.style.display = 'block';
            
            this.loadAndRender();

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<div class="comment-spinner"></div>';

            // Insertion TABLE
            const { error } = await this.supabase.from('session_reponses').insert({ 
                session_id: sessionId, 
                user_id: this.currentUser.id, 
                texte: texte 
            });

            if (error) throw error;

            this.pendingReplies = this.pendingReplies.filter(r => r.tempId !== tempReply.tempId);
            this.showAlert('Réponse publiée !', 'success');

        } catch (error) {
            console.error(error);
            this.showAlert('Erreur publication réponse', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Répondre';
            this.loadAndRender();
        }
    },

    // --- FONCTIONS D'ÉDITION / SUPPRESSION (Tables Originales) ---

    editComment(sessionId) {
        document.getElementById(`comment-text-${sessionId}`).style.display = 'none';
        document.getElementById(`comment-edit-${sessionId}`).style.display = 'block';
        const txt = document.getElementById(`edit-textarea-${sessionId}`);
        txt.focus();
    },
    cancelEditComment(sessionId) {
        document.getElementById(`comment-text-${sessionId}`).style.display = 'block';
        document.getElementById(`comment-edit-${sessionId}`).style.display = 'none';
    },
    async saveEditComment(sessionId) {
        const txt = document.getElementById(`edit-textarea-${sessionId}`).value.trim();
        if(!txt) return;
        const { error } = await this.supabase.from('sessions_commentaires').update({ texte: txt }).eq('session_id', sessionId);
        if(!error) {
            this.showAlert('Modifié avec succès', 'success');
            // Le Realtime mettra à jour
        }
    },

    editReply(id) {
        document.getElementById(`reply-text-${id}`).style.display = 'none';
        document.getElementById(`reply-edit-${id}`).style.display = 'block';
        const txt = document.getElementById(`edit-reply-textarea-${id}`);
        txt.focus();
    },
    cancelEditReply(id) {
        document.getElementById(`reply-text-${id}`).style.display = 'block';
        document.getElementById(`reply-edit-${id}`).style.display = 'none';
    },
    async saveEditReply(id) {
        const txt = document.getElementById(`edit-reply-textarea-${id}`).value.trim();
        if(!txt) return;
        const { error } = await this.supabase.from('session_reponses').update({ texte: txt }).eq('reponse_id', id);
        if(!error) this.showAlert('Réponse modifiée', 'success');
    },

    deleteComment(id, type) {
        const modal = document.createElement('div');
        modal.className = 'delete-confirm-modal';
        modal.innerHTML = `
            <div class="delete-confirm-content">
                <h3>Confirmer la suppression</h3>
                <p>Voulez-vous vraiment supprimer ?</p>
                <div class="delete-confirm-actions">
                    <button class="delete-confirm-btn cancel" onclick="this.closest('.delete-confirm-modal').remove()">Annuler</button>
                    <button class="delete-confirm-btn confirm" onclick="CommentsWidget.confirmDelete('${id}', '${type}')">Supprimer</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    },

    async confirmDelete(id, type) {
        document.querySelector('.delete-confirm-modal').remove();
        let error;
        if (type === 'comment') {
            ({ error } = await this.supabase.from('sessions_commentaires').delete().eq('session_id', id));
        } else {
            ({ error } = await this.supabase.from('session_reponses').delete().eq('reponse_id', id));
        }
        if (error) this.showAlert('Erreur suppression', 'error');
        else this.showAlert('Supprimé avec succès', 'success');
    },

    // --- UTILITAIRES ---
    showAlert(msg, type = 'info') {
        const alert = document.createElement('div');
        alert.className = `alert-message ${type}`;
        alert.innerHTML = `<span>${msg}</span>`;
        document.body.appendChild(alert);
        setTimeout(() => alert.remove(), 3000);
    },
    toggleReplyBox(id) {
        const box = document.getElementById(`reply-box-${id}`);
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
    },
    toggleReplies(id) {
        const r = document.getElementById(`replies-${id}`);
        r.style.display = r.style.display === 'none' ? 'block' : 'none';
    },
    formatDate(dateString) {
        const date = new Date(dateString);
        const diff = (new Date() - date) / 1000;
        if (diff < 60) return "À l'instant";
        if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
        if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)} h`;
        return date.toLocaleDateString('fr-FR');
    },
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
};

// Auto-init si la page est chargée
document.addEventListener('DOMContentLoaded', () => {
    window.CommentsWidget.init();
});
