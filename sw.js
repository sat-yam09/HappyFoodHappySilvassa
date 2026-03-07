const CACHE_NAME = 'hfhs-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/feed.html',
  '/css/design-system.css',
  '/css/feed.css',
  '/js/utils.js',
  '/js/config.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  // Pass through non-GET requests (like Supabase POST API) directly
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request).catch(() => {
          console.log('Network request failed and no cache available for: ', event.request.url);
        });
      })
  );
});
