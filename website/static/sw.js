let CACHE_NAME = 'idashboard-pwa-v4';
let STATIC_ASSETS = [
  '/static/js/modal.js',
  '/static/js/toast.js',
  '/static/js/sidebar.js',
  '/static/js/pwa.js',
  '/static/js/dashboard_loader.js',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/maskable-512.png',
  '/static/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, offlineResponse, shouldCache) {
  try {
    let response = await fetch(request);
    if (shouldCache && response && response.status === 200) {
      let copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch (err) {
    let cached = await caches.match(request);
    return cached || offlineResponse();
  }
}

self.addEventListener('fetch', (event) => {
  let request = event.request;
  if (request.method !== 'GET') return;

  let url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, () => new Response('iDashboard is offline. Please reconnect and reload.', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status: 503
      }), false)
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      networkFirst(request, () => new Response('{"error": "offline"}', {
        headers: { 'Content-Type': 'application/json' },
        status: 503
      }), true)
    );
    return;
  }

  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      networkFirst(request, () => new Response('', { status: 503 }), true)
    );
  }
});