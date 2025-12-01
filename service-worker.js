// service-worker.js
// --- Cache (PWA) + Push notifications (push, notificationclick)
// Nom du cache (incrémente quand tu veux forcer une nouvelle mise à jour)
const CACHE_NAME = "WorldConnect-cache-v1";

// Fichiers à mettre en cache — adapte les chemins si nécessaire
const FILES_TO_CACHE = [
  "/",
  "/index.html",
  "/connect_pro.png",
  "/manifest.json"
];

// INSTALL : mise en cache des fichiers essentiels
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(FILES_TO_CACHE);
      // console.log("✅ Mise en cache des fichiers");
    } catch (err) {
      // cache.addAll peut échouer si un fichier est introuvable — gérer silencieusement
      console.error("Erreur pendant l'installation du SW et la mise en cache :", err);
    }
  })());
  // Activer immédiatement le nouveau service worker
  self.skipWaiting();
});

// ACTIVATE : nettoyage des anciens caches
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
      // console.log("🧹 Ancien cache supprimé, nouveau prêt !");
    } catch (err) {
      console.error("Erreur pendant l'activation du SW :", err);
    }
  })());
  // Prendre le contrôle immédiat des clients
  self.clients.claim();
});

// FETCH : servir depuis le cache si possible, sinon passer au réseau
self.addEventListener("fetch", event => {
  // Ne pas intercepter les requêtes vers d'autres origines sensibles si tu veux (optionnel)
  event.respondWith((async () => {
    try {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) return cachedResponse;
      // Si pas en cache, effectuer la requête réseau
      return await fetch(event.request);
    } catch (err) {
      // En cas d'erreur réseau, on peut renvoyer un fallback (optionnel)
      // return caches.match('/offline.html');
      return new Response("Service non disponible", { status: 503, statusText: "Service Unavailable" });
    }
  })());
});

// PUSH : réception de la notification (payload JSON recommandé)
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let data = {};
    try {
      if (event.data) {
        // Essayer de parser en JSON, si échec, stocker le texte brut
        try {
          data = event.data.json();
        } catch (e) {
          data = { body: event.data.text() };
        }
      }
    } catch (err) {
      console.error("Erreur lecture event.data dans push :", err);
      data = {};
    }

    const title = data.title || "Notification";
    const options = {
      body: data.body || "Vous avez une nouvelle notification.",
      icon: data.icon || "/connect_pro.png",
      badge: data.badge || "/connect_pro.png",
      // On met ici l'URL et toutes les données utiles pour le click handler
      data: {
        url: (data.url || "/"),
        // copie tout le payload si besoin
        payload: data
      },
      // actions optionnelles si tu veux gérer boutons dans la notification
      actions: Array.isArray(data.actions) ? data.actions : []
    };

    try {
      await self.registration.showNotification(title, options);
    } catch (err) {
      console.error("Erreur showNotification :", err);
    }
  })());
});

// CLICK sur la notification : ouvrir ou focaliser la bonne page
self.addEventListener("notificationclick", event => {
  event.notification.close();

  event.waitUntil((async () => {
    try {
      const urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : "/";

      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      // Essayer de focaliser une fenêtre déjà ouverte sur la même URL
      for (const client of allClients) {
        // Normaliser les URLs peut être utile dans des cas réels
        if (client.url === urlToOpen && "focus" in client) {
          return client.focus();
        }
      }
      // Sinon ouvrir une nouvelle fenêtre / onglet
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    } catch (err) {
      console.error("Erreur dans notificationclick :", err);
    }
  })());
});

// OPTIONAL: gérer le cas où une subscription change (peu fréquent, mais utile)
self.addEventListener("pushsubscriptionchange", event => {
  // Ici tu pourrais tenter de ré-souscrire automatiquement,
  // mais en pratique la ré-souscription nécessite l'action du client (front).
  // On met juste un log pour debug.
  console.warn("pushsubscriptionchange event détecté, il faut ré-souscrire côté client.");
  // event.waitUntil(...) // si tu as une logique serveur pour resubscribe
});

// Permettre au front d'envoyer un message au SW (ex: "skipWaiting" après update)
self.addEventListener("message", event => {
  if (!event.data) return;
  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
