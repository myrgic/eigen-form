// Cache-first service worker for the ast_diffusion app.
// Registered from this app's own index.html (see app.json provenance.changes),
// scoped to this directory by default (no explicit scope option), so it can
// never intercept requests for other apps or the hub shell.
const CACHE_NAME = 'ast-diffusion-v2';
const ASSETS = [
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './vendor/d3.v7.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
  // Deliberately no runtime cache growth: only the ASSETS list above is ever
  // written to the cache (at install time), so this stays a fixed-size cache.
});
