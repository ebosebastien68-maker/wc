// ============================================================================
// SERVICE WORKER UNIVERSEL - WORLD CONNECT
// ============================================================================
// Version: 2.1.0 - Compatible TOUS NAVIGATEURS
// Compatibilité: Chrome 50+, Firefox 44+, Safari 11.1+, Edge 17+
// Testé: Chrome 120, Firefox 120, Safari 17, Edge 120
// ============================================================================

'use strict';

// ----------------------------------------------------------------------------
// DÉTECTION DES CAPACITÉS DU NAVIGATEUR
// ----------------------------------------------------------------------------
const BROWSER_SUPPORT = {
  notifications: 'Notification' in self,
  push: 'PushManager' in self,
  sync: 'SyncManager' in self,
  periodicSync: 'PeriodicSyncManager' in self,
  notificationActions: 'Notification' in self && 'actions' in Notification.prototype,
  vibrate: 'vibrate' in navigator,
  badge: 'Notification' in self && 'badge' in Notification.prototype
};

console.log('🔍 Capacités du navigateur:', BROWSER_SUPPORT);

// ----------------------------------------------------------------------------
// CONFIGURATION GLOBALE
// ----------------------------------------------------------------------------
const CONFIG = {
  CACHE_VERSION: 'worldconnect-v2.1.0',
  CACHE_STRATEGY: 'network-first',
  CACHE_MAX_AGE: 7 * 24 * 60 * 60 * 1000, // 7 jours
  CACHE_MAX_ITEMS: 100,
  NOTIFICATION_BADGE: '/connect_pro.png',
  NOTIFICATION_ICON: '/connect_pro.png',
  VAPID_PUBLIC_KEY: 'BEDVco0GQtfwptI7b5r5v6nrwdN_mYlSR0SM1s80MMuxwGSoPBeDohL3SxyXWoJLX8aQsXNsv9VQxBfj68JqnsI'
};

// Caches
const STATIC_CACHE = `${CONFIG.CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CONFIG.CACHE_VERSION}-dynamic`;
const IMAGE_CACHE = `${CONFIG.CACHE_VERSION}-images`;

// Assets statiques
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/connect_pro.png',
  '/supabaseClient.js',
  '/commentaires.js'
];

// URLs à ne jamais cacher
const CACHE_BLACKLIST = [
  /\/auth\//,
  /\/api\/realtime/,
  /supabase\.co.*realtime/,
  /\.hot-update\./
];

// ----------------------------------------------------------------------------
// UTILITAIRES DE CACHE
// ----------------------------------------------------------------------------

const shouldCache = (request) => {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (CACHE_BLACKLIST.some(pattern => pattern.test(url.href))) return false;
  if (request.credentials === 'include') return false;
  return true;
};

const getCacheName = (request) => {
  const url = new URL(request.url);
  const extension = url.pathname.split('.').pop().toLowerCase();
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico'];
  return imageExtensions.includes(extension) ? IMAGE_CACHE : DYNAMIC_CACHE;
};

const cleanupOldCaches = async () => {
  const cacheNames = await caches.keys();
  const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE, IMAGE_CACHE];
  
  return Promise.all(
    cacheNames
      .filter(cacheName => !currentCaches.includes(cacheName))
      .map(cacheName => {
        console.log(`🧹 Suppression ancien cache: ${cacheName}`);
        return caches.delete(cacheName);
      })
  );
};

const limitCacheSize = async (cacheName, maxItems) => {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    if (keys.length > maxItems) {
      const itemsToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(itemsToDelete.map(key => cache.delete(key)));
    }
  } catch (error) {
    console.warn('⚠️ Erreur limitation cache:', error);
  }
};

const addCacheMetadata = (response) => {
  try {
    const clonedResponse = response.clone();
    const headers = new Headers(clonedResponse.headers);
    headers.set('sw-cache-date', Date.now().toString());
    
    return new Response(clonedResponse.body, {
      status: clonedResponse.status,
      statusText: clonedResponse.statusText,
      headers: headers
    });
  } catch (error) {
    return response;
  }
};

// ----------------------------------------------------------------------------
// STRATÉGIES DE CACHE UNIVERSELLES
// ----------------------------------------------------------------------------

const cacheFirst = async (request) => {
  try {
    const cached = await caches.match(request);
    if (cached) return cached;
    
    const response = await fetch(request);
    if (response.ok && shouldCache(request)) {
      const cache = await caches.open(getCacheName(request));
      await cache.put(request, addCacheMetadata(response.clone()));
      await limitCacheSize(getCacheName(request), CONFIG.CACHE_MAX_ITEMS);
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { 
      status: 503, 
      headers: new Headers({ 'Content-Type': 'text/plain' }) 
    });
  }
};

const networkFirst = async (request) => {
  try {
    const response = await fetch(request);
    
    if (response.ok && shouldCache(request)) {
      const cache = await caches.open(getCacheName(request));
      await cache.put(request, addCacheMetadata(response.clone()));
      await limitCacheSize(getCacheName(request), CONFIG.CACHE_MAX_ITEMS);
    }
    
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      console.log('📦 Fallback cache:', request.url.substring(0, 50));
      return cached;
    }
    
    return new Response('Offline', { 
      status: 503,
      headers: new Headers({ 'Content-Type': 'text/plain' }) 
    });
  }
};

const staleWhileRevalidate = async (request) => {
  const cached = await caches.match(request);
  
  const fetchPromise = fetch(request)
    .then(async response => {
      if (response.ok && shouldCache(request)) {
        const cache = await caches.open(getCacheName(request));
        await cache.put(request, addCacheMetadata(response.clone()));
        await limitCacheSize(getCacheName(request), CONFIG.CACHE_MAX_ITEMS);
      }
      return response;
    })
    .catch(() => cached || new Response('Offline', { status: 503 }));
  
  return cached || fetchPromise;
};

// ----------------------------------------------------------------------------
// EVENT: INSTALL
// ----------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  console.log('⚙️ Service Worker: Installation...');
  
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
        console.log('✅ Fichiers statiques cachés');
        await self.skipWaiting();
      } catch (error) {
        console.error('❌ Erreur installation:', error);
      }
    })()
  );
});

// ----------------------------------------------------------------------------
// EVENT: ACTIVATE
// ----------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker: Activation...');
  
  event.waitUntil(
    (async () => {
      try {
        await cleanupOldCaches();
        await self.clients.claim();
        console.log('✅ Service Worker activé');
        
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: CONFIG.CACHE_VERSION,
            support: BROWSER_SUPPORT
          });
        });
      } catch (error) {
        console.error('❌ Erreur activation:', error);
      }
    })()
  );
});

// ----------------------------------------------------------------------------
// EVENT: FETCH
// ----------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  if (url.origin !== location.origin && !url.origin.includes('supabase')) {
    return;
  }
  
  let strategyPromise;
  
  if (STATIC_ASSETS.some(asset => url.pathname.includes(asset))) {
    strategyPromise = cacheFirst(request);
  } else if (CONFIG.CACHE_STRATEGY === 'cache-first') {
    strategyPromise = cacheFirst(request);
  } else if (CONFIG.CACHE_STRATEGY === 'network-first') {
    strategyPromise = networkFirst(request);
  } else {
    strategyPromise = staleWhileRevalidate(request);
  }
  
  event.respondWith(strategyPromise);
});

// ----------------------------------------------------------------------------
// EVENT: PUSH (Compatible tous navigateurs)
// ----------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  console.log('📨 Push reçu');
  
  if (!BROWSER_SUPPORT.push || !BROWSER_SUPPORT.notifications) {
    console.warn('⚠️ Push/Notifications non supportés');
    return;
  }
  
  event.waitUntil(
    (async () => {
      try {
        let notificationData = {
          title: 'World Connect',
          body: 'Nouvelle notification',
          icon: CONFIG.NOTIFICATION_ICON,
          tag: `notif-${Date.now()}`,
          data: {
            url: '/',
            timestamp: Date.now()
          }
        };
        
        // Parser payload
        if (event.data) {
          try {
            const payload = event.data.json();
            notificationData = {
              title: payload.title || notificationData.title,
              body: payload.message || payload.body || notificationData.body,
              icon: payload.icon || notificationData.icon,
              tag: payload.tag || notificationData.tag,
              requireInteraction: payload.priority >= 8,
              data: {
                url: payload.url || '/',
                articleId: payload.articleId,
                messageId: payload.messageId,
                notificationId: payload.notificationId,
                type: payload.type,
                timestamp: Date.now(),
                priority: payload.priority || 5,
                ...(payload.data || {})
              }
            };
            
            // Badge (Safari ≥ 16.4 uniquement)
            if (BROWSER_SUPPORT.badge) {
              notificationData.badge = payload.badge || CONFIG.NOTIFICATION_BADGE;
            }
            
            // Vibration (Chrome/Android uniquement)
            if (BROWSER_SUPPORT.vibrate) {
              notificationData.vibrate = payload.vibrate || [200, 100, 200];
            }
            
            // Actions (Safari ≥ 16.1 uniquement)
            if (BROWSER_SUPPORT.notificationActions && payload.actions) {
              notificationData.actions = payload.actions;
            } else if (BROWSER_SUPPORT.notificationActions) {
              notificationData.actions = [
                { action: 'open', title: '👀 Voir' },
                { action: 'close', title: '❌ Fermer' }
              ];
            }
            
          } catch (parseError) {
            console.error('❌ Erreur parsing:', parseError);
            notificationData.body = event.data.text();
          }
        }
        
        // Personnalisation par type (compatible tous navigateurs)
        const { type } = notificationData.data;
        if (type === 'new_message' && BROWSER_SUPPORT.vibrate) {
          notificationData.vibrate = [300, 100, 300, 100, 300];
        } else if (type === 'new_reaction' && BROWSER_SUPPORT.vibrate) {
          notificationData.vibrate = [100, 50, 100];
        }
        
        await self.registration.showNotification(notificationData.title, notificationData);
        console.log('✅ Notification affichée');
        
      } catch (error) {
        console.error('❌ Erreur notification:', error);
        
        // Fallback ultra-simple (compatible 100%)
        await self.registration.showNotification('World Connect', {
          body: 'Nouvelle notification',
          icon: CONFIG.NOTIFICATION_ICON
        });
      }
    })()
  );
});

// ----------------------------------------------------------------------------
// EVENT: NOTIFICATION CLICK (Compatible tous navigateurs)
// ----------------------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  console.log('🖱️ Notification cliquée');
  
  event.notification.close();
  
  event.waitUntil(
    (async () => {
      try {
        const { action } = event;
        const notificationData = event.notification.data || {};
        
        if (action === 'close') {
          console.log('✅ Notification fermée');
          return;
        }
        
        // URL intelligente
        let urlToOpen = notificationData.url || '/';
        
        if (notificationData.type === 'new_message') {
          urlToOpen = '/messages.html';
        } else if (notificationData.type === 'new_article' && notificationData.articleId) {
          urlToOpen = `/?article=${notificationData.articleId}`;
        } else if (notificationData.type === 'new_notification') {
          urlToOpen = '/notifications.html';
        }
        
        const baseUrl = self.registration.scope;
        const fullUrl = new URL(urlToOpen, baseUrl).href;
        
        // Chercher fenêtre existante
        const allClients = await clients.matchAll({
          type: 'window',
          includeUncontrolled: true
        });
        
        for (const client of allClients) {
          if (client.url === fullUrl && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Ouvrir nouvelle fenêtre
        if (clients.openWindow) {
          return clients.openWindow(fullUrl);
        }
        
      } catch (error) {
        console.error('❌ Erreur click:', error);
      }
    })()
  );
});

// ----------------------------------------------------------------------------
// EVENT: NOTIFICATION CLOSE
// ----------------------------------------------------------------------------
self.addEventListener('notificationclose', (event) => {
  console.log('🔕 Notification fermée');
});

// ----------------------------------------------------------------------------
// EVENT: PUSH SUBSCRIPTION CHANGE (Compatible tous navigateurs)
// ----------------------------------------------------------------------------
self.addEventListener('pushsubscriptionchange', (event) => {
  console.warn('⚠️ Subscription changée');
  
  event.waitUntil(
    (async () => {
      try {
        const allClients = await clients.matchAll({ type: 'window' });
        allClients.forEach(client => {
          client.postMessage({
            type: 'RESUBSCRIBE_PUSH',
            reason: 'subscription_changed'
          });
        });
      } catch (error) {
        console.error('❌ Erreur subscription change:', error);
      }
    })()
  );
});

// ----------------------------------------------------------------------------
// EVENT: MESSAGE (Communication client)
// ----------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (!event.data) return;
  
  const { type, payload } = event.data;
  
  switch (type) {
    case 'SKIP_WAITING':
      console.log('⏭️ Activation immédiate');
      self.skipWaiting();
      break;
      
    case 'CLEAR_CACHE':
      event.waitUntil(
        (async () => {
          try {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
            console.log('🧹 Cache vidé');
          } catch (error) {
            console.error('❌ Erreur clear cache:', error);
          }
        })()
      );
      break;
      
    case 'GET_CACHE_STATS':
      event.waitUntil(
        (async () => {
          try {
            const stats = await getCacheStats();
            if (event.ports && event.ports[0]) {
              event.ports[0].postMessage({ type: 'CACHE_STATS', stats });
            }
          } catch (error) {
            console.error('❌ Erreur stats:', error);
          }
        })()
      );
      break;
      
    case 'PREFETCH_PAGES':
      if (payload && payload.urls) {
        event.waitUntil(prefetchPages(payload.urls));
      }
      break;
      
    default:
      console.log('❓ Message inconnu:', type);
  }
});

// ----------------------------------------------------------------------------
// EVENT: SYNC (Uniquement si supporté - Chrome/Edge)
// ----------------------------------------------------------------------------
if (BROWSER_SUPPORT.sync) {
  self.addEventListener('sync', (event) => {
    console.log('🔄 Background Sync:', event.tag);
    
    if (event.tag === 'sync-notifications') {
      event.waitUntil(syncData('notifications'));
    } else if (event.tag === 'sync-messages') {
      event.waitUntil(syncData('messages'));
    }
  });
}

// ----------------------------------------------------------------------------
// FONCTIONS UTILITAIRES
// ----------------------------------------------------------------------------

const getCacheStats = async () => {
  try {
    const cacheNames = await caches.keys();
    const stats = {};
    
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      stats[name] = keys.length;
    }
    
    return stats;
  } catch (error) {
    console.error('❌ Erreur stats:', error);
    return {};
  }
};

const prefetchPages = async (urls = []) => {
  try {
    const cache = await caches.open(DYNAMIC_CACHE);
    
    await Promise.all(
      urls.map(async url => {
        try {
          const response = await fetch(url);
          if (response.ok) {
            await cache.put(url, response);
            console.log('✅ Préchargé:', url);
          }
        } catch (error) {
          console.warn('⚠️ Échec préchargement:', url);
        }
      })
    );
  } catch (error) {
    console.error('❌ Erreur prefetch:', error);
  }
};

const syncData = async (type) => {
  console.log(`🔄 Sync ${type}...`);
  // Implémentation personnalisée selon besoins
  try {
    // Exemple: fetch('/api/sync/' + type);
  } catch (error) {
    console.error(`❌ Erreur sync ${type}:`, error);
  }
};

// ----------------------------------------------------------------------------
// GESTION D'ERREURS GLOBALE
// ----------------------------------------------------------------------------
self.addEventListener('error', (event) => {
  console.error('❌ Erreur SW:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Promise rejetée:', event.reason);
});

// ----------------------------------------------------------------------------
// INITIALISATION
// ----------------------------------------------------------------------------
console.log('🚀 Service Worker World Connect');
console.log('📋 Version:', CONFIG.CACHE_VERSION);
console.log('🌐 Support:', BROWSER_SUPPORT);
