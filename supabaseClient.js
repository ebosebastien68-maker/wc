// supabaseClient.js - Fichier central pour la connexion à Supabase

const SUPABASE_URL = 'https://eqnvbmkdrnssbiwalocr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxbnZibWtkcm5zc2Jpd2Fsb2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3MzY1MzcsImV4cCI6MjA4MDMxMjUzN30.EFDSrgAbN5wpIYKD-8srH3mtdHZvm81gzjiqsELgCvY';

// On s'assure de n'initialiser le client qu'une seule fois.
if (!window.supabaseClient) {
    // Crée le client Supabase à partir de l'objet global `supabase` fourni par le CDN
    const supabaseInstance = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    /**
     * Récupère l'objet utilisateur actuellement connecté en se basant sur la session.
     * C'est la méthode la plus fiable pour connaître l'état de l'authentification.
     * @returns {Promise<object|null>} L'objet utilisateur ou null si non connecté.
     */
    async function getCurrentUser() {
        try {
            const { data: { session }, error } = await supabaseInstance.auth.getSession();
            if (error) throw error;
            return session ? session.user : null;
        } catch (error) {
            console.error("Erreur lors de la récupération de la session:", error.message);
            return null;
        }
    }

    /**
     * Récupère le profil complet de l'utilisateur depuis la table 'users_profile'.
     * @param {string} userId - L'ID de l'utilisateur.
     * @returns {Promise<object|null>} L'objet profil ou null en cas d'erreur.
     */
    async function getUserProfile(userId) {
        if (!userId) {
            console.error("getUserProfile a été appelé sans userId.");
            return null;
        }

        try {
            // Le trigger `handle_new_user` dans le SQL garantit que ce profil
            // est créé automatiquement lors de l'inscription.
            const { data, error, status } = await supabaseInstance
                .from('users_profile')
                .select('prenom, nom, role') // On ne sélectionne que ce qui est nécessaire
                .eq('user_id', userId)
                .single();

            if (error && status !== 406) {
                throw error;
            }

            return data;

        } catch (error) {
            console.error("Erreur lors de la récupération du profil:", error.message);
            return null;
        }
    }

    /**
     * Déconnecte l'utilisateur actuel.
     */
    async function signOut() {
        const { error } = await supabaseInstance.auth.signOut();
        if (error) {
            console.error('Erreur lors de la déconnexion:', error.message);
        }
        // Redirige vers la page de connexion après la déconnexion
        window.location.href = '/'; 
    }

    /**
     * Redirige l'utilisateur vers la page appropriée en fonction de son rôle.
     * Cette fonction doit être appelée UNIQUEMENT après une action de connexion/inscription réussie.
     * Elle ne doit PAS être appelée automatiquement sur toutes les pages.
     */
    async function redirectByRole() {
        const user = await getCurrentUser();
        
        if (!user) {
            console.log("Redirection annulée : utilisateur non connecté.");
            return;
        }

        const profile = await getUserProfile(user.id);
        
        if (!profile) {
            console.warn('Profil utilisateur introuvable. Redirection vers index.html par défaut.');
            window.location.href = 'index.html';
            return;
        }

        // Redirection basée sur le rôle récupéré du profil
        if (profile.role === 'admin') {
            window.location.href = 'publier.html';
        } else {
            window.location.href = 'index.html';
        }
    }

    /**
     * Vérifie si l'utilisateur est connecté et le redirige si nécessaire.
     * Cette fonction devrait être appelée UNIQUEMENT sur les pages qui nécessitent une authentification.
     * NE PAS utiliser sur les pages de connexion/inscription.
     * @param {boolean} requireAuth - Si true, redirige vers connexion.html si non connecté
     * @param {string|null} requiredRole - Si spécifié, vérifie que l'utilisateur a ce rôle
     */
    async function checkAuthAndRedirect(requireAuth = false, requiredRole = null) {
        const user = await getCurrentUser();
        
        // Si l'authentification est requise mais l'utilisateur n'est pas connecté
        if (requireAuth && !user) {
            console.log("Authentification requise. Redirection vers connexion.html");
            window.location.href = 'connexion.html';
            return false;
        }

        // Si un rôle spécifique est requis
        if (user && requiredRole) {
            const profile = await getUserProfile(user.id);
            
            if (!profile) {
                console.warn("Profil introuvable. Redirection vers connexion.html");
                await signOut();
                return false;
            }

            if (profile.role !== requiredRole) {
                console.warn(`Rôle insuffisant. Requis: ${requiredRole}, Actuel: ${profile.role}`);
                // Redirige vers la page appropriée pour son rôle
                if (profile.role === 'admin') {
                    window.location.href = 'publier.html';
                } else {
                    window.location.href = 'index.html';
                }
                return false;
            }
        }

        return true;
    }

    /**
     * Vérifie simplement si l'utilisateur est connecté sans redirection.
     * Utile pour afficher/masquer des éléments UI.
     * @returns {Promise<boolean>}
     */
    async function isLoggedIn() {
        const user = await getCurrentUser();
        return user !== null;
    }

    // Expose les fonctions et le client sur l'objet window pour un accès global
    window.supabaseClient = {
        supabase: supabaseInstance,
        getCurrentUser,
        getUserProfile,
        signOut,
        redirectByRole,
        checkAuthAndRedirect,
        isLoggedIn
    };
        }
