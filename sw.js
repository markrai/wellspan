const CACHE = 'wellspan-app-shell-v6';
const ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/src/styles.css',
  '/src/theme-boot.js',
  '/src/app.js',
  '/src/lobo-food-editor.js',
  '/src/label-image-input.js',
  '/src/lobo-handoff.js',
  '/src/lobo-report.js',
  '/src/model.js',
  '/src/operations.js',
  '/src/offline-store.js',
  '/src/offline-sync.js',
  '/icons/wellspan.svg',
  '/icons/wellspan-192.png',
  '/icons/wellspan-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('wellspan-app-shell-') && name !== CACHE).map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  if (!ASSETS.includes(url.pathname) || url.search) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
