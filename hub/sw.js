// Shell service worker for the eigen-form lab hub itself. Registered from
// hub/index.html with the default scope derived from this file's own path:
// hub/ root, so it can never shadow a nested app scope. Any app that
// registers its own worker (e.g. ast_diffusion) does so at a deeper scope
// under apps/; per the SW spec the most-specific matching scope wins, so
// that nested registration already takes precedence over this one for
// requests under it. This handler adds a second, explicit guard on top of
// that: it inspects the request path itself and ignores (does not call
// respondWith on) anything under apps/, so this worker never answers for
// app content even before an app's own SW has installed, and never
// interferes with the plain-network fallback for the apps that carry no SW
// of their own.
const CACHE_NAME = 'eigen-form-lab-hub-shell-v1';
const SHELL_ASSETS = [
  './index.html',
  './manifest.webmanifest',
  './icon.svg'
  // registry.json is deliberately NOT in this precache list, see the fetch
  // handler below: it's served network-first instead.
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
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
  const url = new URL(event.request.url);

  // Scope guard: never intercept anything under apps/, that's each app's
  // own SW (or the plain network, for apps with no SW) to own.
  if (url.pathname.includes('/apps/')) return;

  // registry.json: network-first, cache fallback. This is the one shell
  // file that changes when an app is added; cache-first here would mean a
  // new app silently missing from the tab bar until the cache name is
  // bumped. Network failures (offline) fall back to whatever copy was last
  // cached, so the shell still renders its last-known app list rather than
  // erroring.
  if (url.pathname.endsWith('/registry.json') || url.pathname.endsWith('registry.json')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else in the shell's own scope (index.html, manifest, icon):
  // cache-first, since these only change on a shell redeploy (new SW
  // version) and cache-first keeps the shell instant-loading and
  // offline-capable.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
