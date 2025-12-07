// ============================================================================
// SERVICE WORKER OPTIMISÉ - WORLD CONNECT
// ============================================================================
// Version: 4.0.0 - Synchronisation optimiste + Background Sync
// Stratégie: Network-Only pour données, Cache pour assets, Background Sync
// ============================================================================

'use strict';

// ----------------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------------
const VERSION = '4.0.0';
const CACHE_NAME = `worldconnect-v${VERSION}`;
const CACHE_STATIC = `${CACHE_NAME}-static`;
const CACHE_IMAGES = `${CACHE_NAME}-images`;
const CACHE_OFFLINE_DATA = `${CACHE_NAME}-offline-data`;

// Assets statiques UNIQUEMENT (jamais les données dynamiques)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/connect_pro.png',
  '/offline.html',
  '/optimistic-sync.js',
  '/supabaseClient.js',
  '/commentaires.js'
];

// ⚠️ CRITIQUE: URLs à TOUJOURS chercher sur le réseau (jamais en cache)
const NEVER_CACHE_PATTERNS = [
  /\/api\//,                    // Toutes les APIs
  /supabase\.co/,               // Supabase (données en temps réel)
  /\/auth\//,                   // Authentification
  /realtime/,                   // WebSocket/Realtime
  /\.json$/,                    // Fichiers de données JSON
  /\/notifications/,            // Notifications
  /\/messages/,                 // Messages
  /\/reactions/,                // Réactions
  /\/comments/,                 // Commentaires
  /\/articles/,                 // Articles
  /timestamp=/,                 // Requêtes avec timestamp (données fraîches)
  /cache-bust=/                 // Cache busting
];

// Images et assets qui peuvent être cachés
const CACHEABLE_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|webp|ico)$/,
  /\.(css|js)$/,
  /fonts\//,
  /\/static\//,
  /cdnjs\.cloudflare\.com/,
  /cdn\.jsdelivr\.net/
];

// Configuration
const CONFIG = {
  MAX_CACHE_SIZE: 100,          // Limite d'images en cache
  CACHE_MAX_AGE: 86400000,      // 24h pour les images
  NOTIFICATION_ICON: '/connect_pro.png',
  NETWORK_TIMEOUT: 5000,        // 5s timeout pour le réseau
  VAPID_PUBLIC_KEY: 'BEDVco0GQtfwptI7b5r5v6nrwdN_mYlSR0SM1s80MMuxwGSoPBeDohL3SxyXWoJLX8aQsXNsv9VQxBfj68JqnsI',
  SYNC_RETRY_INTERVAL: 60000,   // 1 minute entre les tentatives
  MAX_SYNC_RETRIES: 5           // Maximum 5 tentatives
};

// Détection des capacités
const SUPPORT = {
  notifications: 'Notification' in self,
  push: 'PushManager' in self,
  cache: 'caches' in self,
  backgroundSync: 'sync' in self.registration,
  periodicBackgroundSync: 'periodicSync' in self.registration
};

console.log(`🚀 SW v${VERSION} - Support:`, SUPPORT);

// ----------------------------------------------------------------------------
// QUEUE DE SYNCHRONISATION OPTIMISTE
// ----------------------------------------------------------------------------

class SyncQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  /**
   * Ajouter une action à la queue
   */
  async add(action) {
    this.queue.push({
      id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      action: action,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: CONFIG.MAX_SYNC_RETRIES
    });

    console.log('📥 Action ajoutée à la queue:', action.type);
    
    // Sauvegarder en IndexedDB pour persistance
    await this.saveQueue();
    
    // Démarrer le traitement si pas déjà en cours
    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * Traiter la queue d'actions
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    console.log(`🔄 Traitement de ${this.queue.length} action(s) en attente...`);

    while (this.queue.length > 0) {
      const item = this.queue[0];
      
      try {
        await this.executeAction(item.action);
        
        // Succès: retirer de la queue
        this.queue.shift();
        console.log('✅ Action synchronisée:', item.action.type);
        
        // Notifier les clients
        await this.notifyClients({
          type: 'SYNC_SUCCESS',
          action: item.action
        });
        
      } catch (error) {
        console.error('❌ Erreur sync:', error);
        
        item.retries++;
        
        if (item.retries >= item.maxRetries) {
          // Max tentatives atteint: retirer et notifier échec
          this.queue.shift();
          console.warn('⚠️ Action abandonnée après', item.retries, 'tentatives');
          
          await this.notifyClients({
            type: 'SYNC_FAILED',
            action: item.action,
            error: error.message
          });
        } else {
          // Réessayer plus tard
          console.log(`🔄 Nouvelle tentative (${item.retries}/${item.maxRetries}) dans ${CONFIG.SYNC_RETRY_INTERVAL}ms`);
          await new Promise(resolve => setTimeout(resolve, CONFIG.SYNC_RETRY_INTERVAL));
        }
      }
      
      await this.saveQueue();
    }

    this.processing = false;
    console.log('✅ Queue de synchronisation terminée');
  }

  /**
   * Exécuter une action de synchronisation
   */
  async executeAction(action) {
    switch (action.type) {
      case 'ADD_REACTION':
        return await this.syncReaction(action.data);
      
      case 'REMOVE_REACTION':
        return await this.syncRemoveReaction(action.data);
      
      case 'ADD_COMMENT':
        return await this.syncComment(action.data);
      
      case 'DELETE_COMMENT':
        return await this.syncDeleteComment(action.data);
      
      case 'UPDATE_ARTICLE':
        return await this.syncArticleUpdate(action.data);
      
      default:
        throw new Error(`Type d'action inconnu: ${action.type}`);
    }
  }

  /**
   * Synchroniser une réaction
   */
  async syncReaction(data) {
    const response = await fetch(`${data.supabaseUrl}/rest/v1/article_reactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': data.supabaseKey,
        'Authorization': `Bearer ${data.userToken}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        article_id: data.articleId,
        user_id: data.userId,
        reaction_type: data.reactionType
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Synchroniser suppression de réaction
   */
  async syncRemoveReaction(data) {
    const response = await fetch(
      `${data.supabaseUrl}/rest/v1/article_reactions?reaction_id=eq.${data.reactionId}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': data.supabaseKey,
          'Authorization': `Bearer ${data.userToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  /**
   * Synchroniser un commentaire
   */
  async syncComment(data) {
    const response = await fetch(`${data.supabaseUrl}/rest/v1/sessions_commentaires`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': data.supabaseKey,
        'Authorization': `Bearer ${data.userToken}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        article_id: data.articleId,
        user_id: data.userId,
        commentaire: data.content
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Synchroniser suppression de commentaire
   */
  async syncDeleteComment(data) {
    const response = await fetch(
      `${data.supabaseUrl}/rest/v1/sessions_commentaires?commentaire_id=eq.${data.commentId}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': data.supabaseKey,
          'Authorization': `Bearer ${data.userToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  /**
   * Synchroniser mise à jour d'article
   */
  async syncArticleUpdate(data) {
    const response = await fetch(
      `${data.supabaseUrl}/rest/v1/articles?article_id=eq.${data.articleId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': data.supabaseKey,
          'Authorization': `Bearer ${data.userToken}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(data.updates)
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Sauvegarder la queue en IndexedDB
   */
  async saveQueue() {
    try {
      const db = await this.openDB();
      const tx = db.transaction('syncQueue', 'readwrite');
      const store = tx.objectStore('syncQueue');
      
      await store.clear();
      
      for (const item of this.queue) {
        await store.add(item);
      }
      
      await tx.complete;
    } catch (error) {
      console.error('❌ Erreur sauvegarde queue:', error);
    }
  }

  /**
   * Charger la queue depuis IndexedDB
   */
  async loadQueue() {
    try {
      const db = await this.openDB();
      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');
      
      this.queue = await store.getAll();
      
      console.log(`📦 ${this.queue.length} action(s) chargée(s) depuis IndexedDB`);
      
      if (this.queue.length > 0) {
        this.processQueue();
      }
    } catch (error) {
      console.error('❌ Erreur chargement queue:', error);
      this.queue = [];
    }
  }

  /**
   * Ouvrir la base de données IndexedDB
   */
  openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('WorldConnectSync', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains('offlineData')) {
          db.createObjectStore('offlineData', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Notifier les clients d'un événement
   */
  async notifyClients(message) {
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => {
      client.postMessage(message);
    });
  }
}

// Instance globale de la queue
const syncQueue = new SyncQueue();

// ----------------------------------------------------------------------------
// UTILITAIRES DE CACHE
// ----------------------------------------------------------------------------

/**
 * Vérifie si une requête doit ABSOLUMENT venir du réseau
 */
const mustUseNetwork = (url) => {
  return NEVER_CACHE_PATTERNS.some(pattern => pattern.test(url));
};

/**
 * Vérifie si une ressource peut être mise en cache
 */
const isCacheable = (url) => {
  return CACHEABLE_PATTERNS.some(pattern => pattern.test(url));
};

/**
 * Nettoie les anciens caches
 */
const cleanupCaches = async () => {
  const cacheNames = await caches.keys();
  const currentCaches = [CACHE_STATIC, CACHE_IMAGES, CACHE_OFFLINE_DATA];
  
  return Promise.all(
    cacheNames
      .filter(name => !currentCaches.includes(name))
      .map(name => {
        console.log(`🧹 Suppression cache: ${name}`);
        return caches.delete(name);
      })
  );
};

/**
 * Limite la taille du cache d'images
 */
const limitCacheSize = async (cacheName, maxItems) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > maxItems) {
    const toDelete = keys.slice(0, keys.length - maxItems);
    await Promise.all(toDelete.map(key => cache.delete(key)));
    console.log(`🧹 ${toDelete.length} images supprimées du cache`);
  }
};

/**
 * Vérifie si une réponse en cache est encore valide
 */
const isCacheValid = (response) => {
  if (!response) return false;
  
  const cacheDate = response.headers.get('sw-cached-at');
  if (!cacheDate) return true;
  
  const age = Date.now() - parseInt(cacheDate);
  return age < CONFIG.CACHE_MAX_AGE;
};

// ----------------------------------------------------------------------------
// STRATÉGIES DE RÉCUPÉRATION
// ----------------------------------------------------------------------------

/**
 * STRATÉGIE 1: Network-Only avec timeout et fallback offline
 */
const networkOnly = async (request) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.NETWORK_TIMEOUT);
    
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    return response;
  } catch (error) {
    console.warn('⚠️ Network failed:', request.url.substring(0, 60));
    
    // Fallback: page offline pour la navigation
    if (request.mode === 'navigate') {
      const cache = await caches.open(CACHE_STATIC);
      const offline = await cache.match('/offline.html');
      if (offline) return offline;
    }
    
    return new Response('Network Error', { 
      status: 503, 
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

/**
 * STRATÉGIE 2: Cache-First pour assets statiques et images
 */
const cacheFirst = async (request) => {
  const cacheName = request.url.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/) 
    ? CACHE_IMAGES 
    : CACHE_STATIC;
  
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  if (cached && isCacheValid(cached)) {
    console.log('✅ Cache hit:', request.url.substring(0, 60));
    return cached;
  }
  
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const headers = new Headers(response.headers);
      headers.set('sw-cached-at', Date.now().toString());
      
      const responseToCache = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
      
      await cache.put(request, responseToCache.clone());
      
      if (cacheName === CACHE_IMAGES) {
        await limitCacheSize(CACHE_IMAGES, CONFIG.MAX_CACHE_SIZE);
      }
      
      return responseToCache;
    }
    
    return response;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
};

/**
 * STRATÉGIE 3: Network-First avec cache fallback (pour pages HTML)
 */
const networkFirstWithCache = async (request) => {
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      await cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    const cache = await caches.open(CACHE_STATIC);
    const cached = await cache.match(request);
    
    if (cached) {
      console.log('📦 Fallback cache:', request.url.substring(0, 60));
      return cached;
    }
    
    throw error;
  }
};

// ----------------------------------------------------------------------------
// ÉVÉNEMENTS DU SERVICE WORKER
// ----------------------------------------------------------------------------

/**
 * INSTALL: Mise en cache des assets statiques
 */
self.addEventListener('install', (event) => {
  console.log(`⚙️ Installation SW v${VERSION}`);
  
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_STATIC);
        await cache.addAll(STATIC_ASSETS);
        console.log('✅ Assets statiques cachés');
        
        await self.skipWaiting();
      } catch (error) {
        console.error('❌ Erreur installation:', error);
      }
    })()
  );
});

/**
 * ACTIVATE: Nettoyage et prise de contrôle
 */
self.addEventListener('activate', (event) => {
  console.log(`🚀 Activation SW v${VERSION}`);
  
  event.waitUntil(
    (async () => {
      try {
        await cleanupCaches();
        await self.clients.claim();
        
        // Charger la queue de synchronisation
        await syncQueue.loadQueue();
        
        console.log('✅ SW activé et en contrôle');
        
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: VERSION,
            support: SUPPORT
          });
        });
      } catch (error) {
        console.error('❌ Erreur activation:', error);
      }
    })()
  );
});

/**
 * FETCH: Routage intelligent des requêtes
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  if (request.method !== 'GET') {
    return;
  }
  
  if (url.origin !== location.origin && !url.hostname.includes('supabase') && !url.hostname.includes('cdnjs') && !url.hostname.includes('jsdelivr')) {
    return;
  }
  
  let strategy;
  
  if (mustUseNetwork(url.href)) {
    strategy = networkOnly(request);
  } else if (isCacheable(url.href)) {
    strategy = cacheFirst(request);
  } else if (request.mode === 'navigate') {
    strategy = networkFirstWithCache(request);
  } else {
    strategy = networkOnly(request);
  }
  
  event.respondWith(strategy);
});

// ----------------------------------------------------------------------------
// BACKGROUND SYNC
// ----------------------------------------------------------------------------

if (SUPPORT.backgroundSync) {
  self.addEventListener('sync', (event) => {
    console.log('🔄 Background Sync déclenché:', event.tag);
    
    if (event.tag === 'sync-reactions' || event.tag === 'sync-comments') {
      event.waitUntil(syncQueue.processQueue());
    }
  });
}

// ----------------------------------------------------------------------------
// PERIODIC BACKGROUND SYNC (si supporté)
// ----------------------------------------------------------------------------

if (SUPPORT.periodicBackgroundSync) {
  self.addEventListener('periodicsync', (event) => {
    console.log('🔄 Periodic Sync:', event.tag);
    
    if (event.tag === 'sync-pending-actions') {
      event.waitUntil(syncQueue.processQueue());
    }
  });
}

// ----------------------------------------------------------------------------
// NOTIFICATIONS PUSH
// ----------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  if (!SUPPORT.push || !SUPPORT.notifications) return;
  
  event.waitUntil(
    (async () => {
      try {
        let data = {
          title: 'World Connect',
          body: 'Nouvelle notification',
          icon: CONFIG.NOTIFICATION_ICON,
          badge: CONFIG.NOTIFICATION_ICON,
          data: { url: '/' }
        };
        
        if (event.data) {
          try {
            const payload = event.data.json();
            data = {
              title: payload.title || data.title,
              body: payload.body || payload.message || data.body,
              icon: payload.icon || data.icon,
              badge: payload.badge || data.badge,
              tag: payload.tag || `notif-${Date.now()}`,
              requireInteraction: payload.priority >= 8,
              data: {
                url: payload.url || '/',
                type: payload.type,
                ...payload.data
              }
            };
            
            if ('actions' in Notification.prototype) {
              data.actions = payload.actions || [
                { action: 'open', title: '👀 Voir' },
                { action: 'dismiss', title: '✕ Fermer' }
              ];
            }
            
            if ('vibrate' in navigator) {
              data.vibrate = payload.vibrate || [200, 100, 200];
            }
          } catch (e) {
            console.warn('⚠️ Erreur parsing notification:', e);
          }
        }
        
        await self.registration.showNotification(data.title, data);
        console.log('✅ Notification affichée');
      } catch (error) {
        console.error('❌ Erreur notification:', error);
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const { action } = event;
  const { url } = event.notification.data || {};
  
  if (action === 'dismiss') return;
  
  event.waitUntil(
    (async () => {
      const urlToOpen = new URL(url || '/', self.location.origin).href;
      
      const clients = await self.clients.matchAll({ 
        type: 'window',
        includeUncontrolled: true 
      });
      
      for (const client of clients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })()
  );
});

// ----------------------------------------------------------------------------
// MESSAGES DES CLIENTS
// ----------------------------------------------------------------------------

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CLEAR_CACHE':
      event.waitUntil(
        (async () => {
          const names = await caches.keys();
          await Promise.all(names.map(n => caches.delete(n)));
          console.log('🧹 Tous les caches supprimés');
        })()
      );
      break;
      
    case 'CLEAR_DATA_CACHE':
      event.waitUntil(
        (async () => {
          await caches.delete(CACHE_STATIC);
          await caches.delete(CACHE_OFFLINE_DATA);
          console.log('🧹 Cache de données supprimé');
        })()
      );
      break;
      
    case 'GET_VERSION':
      if (event.ports?.[0]) {
        event.ports[0].postMessage({ 
          version: VERSION,
          support: SUPPORT,
          queueLength: syncQueue.queue.length
        });
      }
      break;
      
    case 'SYNC_ACTION':
      event.waitUntil(syncQueue.add(payload));
      break;
      
    case 'FORCE_SYNC':
      event.waitUntil(syncQueue.processQueue());
      break;
      
    case 'GET_SYNC_QUEUE':
      if (event.ports?.[0]) {
        event.ports[0].postMessage({ 
          queue: syncQueue.queue,
          processing: syncQueue.processing
        });
      }
      break;
  }
});

// ----------------------------------------------------------------------------
// GESTION D'ERREURS
// ----------------------------------------------------------------------------

self.addEventListener('error', (event) => {
  console.error('❌ SW Error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Unhandled Promise:', event.reason);
});

console.log(`✅ Service Worker v${VERSION} initialisé`);
console.log('📋 Stratégie: Network-Only + Cache Assets + Background Sync');
console.log('🔄 Synchronisation optimiste activée');
