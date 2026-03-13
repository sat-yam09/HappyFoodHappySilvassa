const APP_VERSION = '20260313c';
const CACHE_NAME = `hfhs-cache-${APP_VERSION}`;
const IS_LOCAL_DEV = self.location.hostname === '127.0.0.1' || self.location.hostname === 'localhost';
const PRECACHE_ASSETS = [
  `/icons/icon-192.png?v=${APP_VERSION}`,
  `/icons/icon-512.png?v=${APP_VERSION}`,
  `/logo.png?v=${APP_VERSION}`
];

self.addEventListener('install', (event) => {
  if (IS_LOCAL_DEV) {
    event.waitUntil(self.skipWaiting());
    return;
  }

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => IS_LOCAL_DEV || key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

const networkFirst = async (request) => {
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaqueredirect') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
};

const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.status === 200 && response.type !== 'opaqueredirect') {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  if (IS_LOCAL_DEV) {
    event.respondWith(fetch(request));
    return;
  }

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || request.url.includes('supabase')) return;

  const isVersionedAsset = url.searchParams.has('v');
  const isFreshAsset =
    request.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.json') ||
    isVersionedAsset;

  if (isFreshAsset) {
    event.respondWith(
      networkFirst(request).catch(() => new Response('', { status: 503, statusText: 'Offline' }))
    );
    return;
  }

  event.respondWith(
    cacheFirst(request).catch(() => new Response('', { status: 503, statusText: 'Offline' }))
  );
});
