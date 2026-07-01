// VACH* — Service Worker
// Cachea el shell del sitio para que la PWA instale rápido y funcione offline
// para las páginas ya visitadas.

const VERSION = 'vach-v2';
const PRECACHE = [
  '/',
  '/manifest.json',
  '/merchandising/',
  '/merchandising/assets/shared.css',
  '/merchandising/assets/watermark.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return Promise.all(
        PRECACHE.map(function (url) {
          return cache.add(url).catch(function () {
            // si algún recurso no existe todavía, no rompe la instalación
          });
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // no tocar analytics/fonts cross-origin

  // Navegación entre páginas: red primero, cache como respaldo, offline.html si no hay nada
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(VERSION).then(function (cache) { cache.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (cached) {
            return cached || caches.match('/offline.html');
          });
        })
    );
    return;
  }

  // Resto de recursos (css, imágenes, js): cache primero, actualiza en segundo plano
  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req)
        .then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(VERSION).then(function (cache) { cache.put(req, copy); });
          }
          return res;
        })
        .catch(function () { return cached; });
      return cached || network;
    })
  );
});
