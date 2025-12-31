/**
 * Service Worker for Practice Chat PWA
 * Provides offline support and caching
 */

const CACHE_NAME = 'practice-chat-v1';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Files to cache immediately on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/src/app.js',
  '/src/asr-client.js',
  '/src/text-processor.js',
  '/manifest.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - network first, then cache
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip WebSocket and external API requests
  if (request.url.startsWith('wss://') ||
      request.url.includes('railway.app') ||
      request.url.includes('googleapis.com')) {
    return; // Let it go to network
  }

  // For everything else: Network first, fall back to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Clone and cache successful responses
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed - try cache
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            console.log('[Service Worker] Serving from cache:', request.url);
            return cachedResponse;
          }
          // Not in cache either
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
