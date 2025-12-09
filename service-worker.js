// ============================================================================
// SERVICE WORKER PRODUCTION - WORLD CONNECT
// ============================================================================
// Version: 5.0.1 - Fix Notification Body
// ============================================================================

'use strict';

// ----------------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------------
const VERSION = '5.0.1';
const CACHE_NAME = `worldconnect-v${VERSION}`;
const CACHE_STATIC = `${CACHE_NAME}-static`;
const CACHE_IMAGES = `${CACHE_NAME}-images`;
const CACHE_OFFLINE_DATA = `${CACHE_NAME}-offline-data`;

// Assets statiques
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/connect_pro.png',
  '/offline.html'
];

// URLs à TOUJOURS chercher sur le réseau
const NEVER_CACHE_PATTERNS = [
  /\/api\//,
  /supabase\.co/,
  /\/auth\//,
  /realtime/,
  /\.json$/,
  /\/notifications/,
  /\/messages/,
  /\/reactions/,
  /\/comments/,
  /\/articles/,
  /timestamp=/,
  /cache-bust=/
];

// Ressources cachables
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
  MAX_CACHE_SIZE: 100,
  CACHE_MAX_AGE: 86400000, // 24h
  NOTIFICATION_ICON: '/connect_pro.png',
  NETWORK_TIMEOUT: 5000,
  VAPID_PUBLIC_KEY: 'BEDVco0GQtfwptI7b5r5v6nrwdN_mYlSR0SM1s80MMuxwGSoPBeDohL3SxyXWoJLX8aQsXNsv9VQxBfj68JqnsI',
  SYNC_RETRY_INTERVAL: 60000,
  MAX_SYNC_RETRIES: 5
};

const SUPPORT = {
  notifications: 'Notification' in self,
  push: 'PushManager' in self,
  cache: 'caches' in self,
  backgroundSync: 'sync' in self.registration,
  periodicBackgroundSync: 'periodicSync' in self.registration
};

console.log(`🚀 SW v${VERSION} - Support:`, SUPPORT);

// ----------------------------------------------------------------------------
// QUEUE DE SYNCHRONISATION
// ----------------------------------------------------------------------------

class SyncQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  async add(action) {
    this.queue.push({
      id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      action: action,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: CONFIG.MAX_SYNC_RETRIES
    });

    console.log('📥 Action ajoutée à la queue:', action.type);
    await this.saveQueue();
    
    if (!this.processing) {
      this.processQueue();
    }
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    console.log(`🔄 Traitement de ${this.queue.length} action(s)...`);

    while (this.queue.length > 0) {
      const item = this.queue[0];
      
      try {
        await this.executeAction(item.action);
        this.queue.shift();
        console.log('✅ Action synchronisée:', item.action.type);
        
        await this.notifyClients({
          type: 'SYNC_SUCCESS',
          action: item.action
        });
      } catch (error) {
        console.error('❌ Erreur sync:', error);
        item.retries++;
        
        if (item.retries >= item.maxRetries) {
          this.queue.shift();
          console.warn('⚠️ Action abandonnée après', item.retries, 'tentatives');
          
          await this.notifyClients({
            type: 'SYNC_FAILED',
            action: item.action,
            error: error.message
          });
        } else {
          console.log(`🔄 Nouvelle tentative (${item.retries}/${item.maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, CONFIG.SYNC_RETRY_INTERVAL));
        }
      }
      
      await this.saveQueue();
    }

    this.processing = false;
    console.log('✅ Queue terminée');
  }

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
      default:
        throw new Error(`Type d'action inconnu: ${action.type}`);
    }
  }

  async syncReaction(data) {
    if (!data.userToken) {
      throw new Error('Token d\'authentification manquant');
    }

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
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return await response.json();
  }

  async syncRemoveReaction(data) {
    if (!data.userToken) {
      throw new Error('Token d\'authentification manquant');
    }

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
      throw new Error(`HTTP ${response.status}`);
    }
  }

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
        texte: data.content
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  }

  async syncDeleteComment(data) {
    const response = await fetch(
      `${data.supabaseUrl}/rest/v1/sessions_commentaires?session_id=eq.${data.commentId}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': data.supabaseKey,
          'Authorization': `Bearer ${data.userToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  }

  async saveQueue() {
    try {
      const db = await this.openDB();
      const tx = db.transaction('syncQueue', 'readwrite');
      const store = tx.objectStore('syncQueue');
      
      await store.clear();
      
      for (const item of this.queue) {
        await store.add(item);
      }
    } catch (error) {
      console.error('❌ Erreur sauvegarde queue:', error);
    }
  }

  async loadQueue() {
    try {
      const db = await this.openDB();
      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');
      
      this.queue = await store.getAll();
      console.log(`📦 ${this.queue.length} action(s) chargée(s)`);
      
      if (this.queue.length > 0) {
        this.processQueue();
      }
    } catch (error) {
      console.error('❌ Erreur chargement queue:', error);
      this.queue = [];
    }
  }

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

  async notifyClients(message) {
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => {
      client.postMessage(message);
    });
  }
}

const syncQueue = new SyncQueue();

// ----------------------------------------------------------------------------
// UTILITAIRES DE CACHE
// ----------------------------------------------------------------------------

const mustUseNetwork = (url) => {
  return NEVER_CACHE_PATTERNS.some(pattern => pattern.test(url));
};

const isCacheable = (url) => {
  return CACHEABLE_PATTERNS.some(pattern => pattern.test(url));
};

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

const limitCacheSize = async (cacheName, maxItems) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > maxItems) {
    const toDelete = keys.slice(0, keys.length - maxItems);
    await Promise.all(toDelete.map(key => cache.delete(key)));
    console.log(`🧹 ${toDelete.length} images supprimées du cache`);
  }
};

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

const networkOnly = async (request) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.NETWORK_TIMEOUT);
    
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    return response;
  } catch (error) {
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

const cacheFirst = async (request) => {
  const cacheName = request.url.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/) 
    ? CACHE_IMAGES 
    : CACHE_STATIC;
  
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  if (cached && isCacheValid(cached)) {
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
    
    if (cached) return cached;
    throw error;
  }
};

// ----------------------------------------------------------------------------
// ÉVÉNEMENTS DU SERVICE WORKER
// ----------------------------------------------------------------------------

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

self.addEventListener('activate', (event) => {
  console.log(`🚀 Activation SW v${VERSION}`);
  
  event.waitUntil(
    (async () => {
      try {
        await cleanupCaches();
        await self.clients.claim();
        await syncQueue.loadQueue();
        
        console.log('✅ SW activé');
        
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  if (request.method !== 'GET') return;
  if (url.origin !== location.origin && !url.hostname.includes('supabase') && !url.hostname.includes('cdnjs') && !url.hostname.includes('jsdelivr')) return;
  
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
    console.log('🔄 Background Sync:', event.tag);
    
    if (event.tag === 'sync-reactions' || event.tag === 'sync-comments') {
      event.waitUntil(syncQueue.processQueue());
    }
  });
}

if (SUPPORT.periodicBackgroundSync) {
  self.addEventListener('periodicsync', (event) => {
    console.log('🔄 Periodic Sync:', event.tag);
    
    if (event.tag === 'sync-pending-actions') {
      event.waitUntil(syncQueue.processQueue());
    }
  });
}

// ----------------------------------------------------------------------------
// NOTIFICATIONS PUSH - 🔥 SECTION CORRIGÉE
// ----------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  console.log('📩 Notification push reçue');
  
  if (!SUPPORT.push || !SUPPORT.notifications) {
    console.warn('⚠️ Notifications non supportées');
    return;
  }
  
  event.waitUntil(
    (async () => {
      try {
        // Valeurs par défaut
        let notificationData = {
          title: 'World Connect',
          body: 'Nouvelle notification',
          icon: CONFIG.NOTIFICATION_ICON,
          badge: CONFIG.NOTIFICATION_ICON,
          tag: `notif-${Date.now()}`,
          data: { url: '/' }
        };
        
        // Parser les données de la notification
        if (event.data) {
          try {
            const payload = event.data.json();
            console.log('📦 Payload reçu:', JSON.stringify(payload, null, 2));
            
            // 🔥 FIX CRITIQUE: Le payload contient un objet "notification"
            const notification = payload.notification || payload;
            
            console.log('🔍 Notification extraite:', JSON.stringify(notification, null, 2));
            console.log('🔍 Title:', notification.title);
            console.log('🔍 Body:', notification.body);
            
            notificationData = {
              title: notification.title || payload.title || notificationData.title,
              body: notification.body || notification.message || payload.body || payload.message || notificationData.body,
              icon: notification.icon || payload.icon || notificationData.icon,
              badge: notification.badge || payload.badge || notificationData.badge,
              tag: notification.tag || payload.tag || notificationData.tag,
              requireInteraction: notification.requireInteraction || payload.requireInteraction || (notification.priority >= 8),
              data: {
                url: notification.data?.url || payload.url || payload.data?.url || '/',
                type: notification.data?.type || payload.type || payload.data?.type,
                articleId: notification.data?.articleId || payload.articleId || payload.data?.articleId,
                ...(notification.data || payload.data || {})
              }
            };
            
            console.log('✅ Notification finale:', JSON.stringify(notificationData, null, 2));
            
            // Actions (si supportées)
            if ('actions' in Notification.prototype) {
              notificationData.actions = notification.actions || payload.actions || [
                { action: 'open', title: '👀 Voir', icon: '/icons/view.png' },
                { action: 'dismiss', title: '✕ Fermer' }
              ];
            }
            
            // Vibration (si supportée)
            if ('vibrate' in navigator) {
              notificationData.vibrate = notification.vibrate || payload.vibrate || [200, 100, 200];
            }
          } catch (e) {
            console.error('❌ Erreur parsing notification:', e);
            console.error('Stack:', e.stack);
            try {
              console.error('Raw data:', event.data.text());
            } catch (textError) {
              console.error('Impossible de lire les données brutes');
            }
          }
        } else {
          console.warn('⚠️ Aucune donnée dans le push');
        }
        
        // Afficher la notification
        console.log('📤 Affichage notification - Title:', notificationData.title, '| Body:', notificationData.body);
        await self.registration.showNotification(notificationData.title, notificationData);
        console.log('✅ Notification affichée avec succès');
        
        // Jouer un son (optionnel)
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(client => {
          client.postMessage({
            type: 'PLAY_NOTIFICATION_SOUND',
            notification: notificationData
          });
        });
        
      } catch (error) {
        console.error('❌ Erreur affichage notification:', error);
        console.error('Stack:', error.stack);
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('🖱️ Notification cliquée:', event.action);
  
  event.notification.close();
  
  const { action } = event;
  const { url, articleId } = event.notification.data || {};
  
  // Si action "dismiss", ne rien faire
  if (action === 'dismiss') return;
  
  event.waitUntil(
    (async () => {
      // Déterminer l'URL à ouvrir
      let urlToOpen = url || '/';
      
      // Si c'est une notification d'article, aller directement à l'article
      if (articleId) {
        urlToOpen = `/?article=${articleId}`;
      }
      
      const fullUrl = new URL(urlToOpen, self.location.origin).href;
      
      // Chercher une fenêtre ouverte
      const clients = await self.clients.matchAll({ 
        type: 'window',
        includeUncontrolled: true 
      });
      
      // Si une fenêtre existe déjà, la focaliser
      for (const client of clients) {
        if (client.url === fullUrl && 'focus' in client) {
          return client.focus();
        }
      }
      
      // Sinon, ouvrir une nouvelle fenêtre
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullUrl);
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

console.log(`✅ Service Worker v${VERSION} prêt pour la production!`);
console.log('📱 Notifications Push: ACTIVÉES ET CORRIGÉES');
console.log('🔄 Synchronisation optimiste: ACTIVÉE');
