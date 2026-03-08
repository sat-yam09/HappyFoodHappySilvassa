const CACHE_NAME = 'hfhs-cache-v3';
const urlsToCache = [
  '/',
  '/css/design-system.css',
  '/css/feed.css',
  '/js/utils.js',
  '/js/config.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  // Clean up old caches
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // Pass through non-GET requests (Supabase POST calls, etc.)
  if (request.method !== 'GET') return;

  // NEVER intercept navigation requests (HTML pages).
  // Let the browser handle redirects (e.g., Vercel cleanUrls /feed.html → /feed).
  if (request.mode === 'navigate') return;

  // NEVER intercept API calls
  if (request.url.includes('/api/')) return;

  // For sub-resources (CSS, JS, images), use cache-first strategy
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // Don't cache bad responses or opaque redirects
        if (!response || response.status !== 200 || response.type === 'opaqueredirect') {
          return response;
        }
        // Clone and cache successful responses
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
        return response;
      }).catch(() => {
        // Offline fallback — just fail silently for sub-resources
      });
    })
  );
});
