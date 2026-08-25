/* sw.js — cachea el armazón de la app para que abra sin conexión.
   Los datos sísmicos NO se cachean aquí: siempre van a la red y, si falla,
   app.js muestra la última copia guardada en localStorage. */

const CACHE = 'sismos-chile-v7';
const ARCHIVOS = [
  './',
  'index.html?v=7',
  'privacidad.html?v=7',
  'app.css?v=7',
  'geo.js?v=7',
  'mundo.js?v=7',
  'app.js?v=7',
  'aire.js?v=7',
  'farmacias.js?v=7',
  'clima.js?v=7',
  'manifest.webmanifest?v=7',
  'icono.svg?v=7'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // Sin `cache: 'reload'` el navegador sirve estos archivos desde su propia
      // caché HTTP (GitHub Pages manda max-age), y la versión nueva del service
      // worker termina guardando los archivos viejos.
      .then(c => c.addAll(ARCHIVOS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;   // APIs siempre a la red

  // Red primero para el HTML (así una versión nueva se toma enseguida),
  // caché primero para el resto del armazón.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copia = r.clone();
          caches.open(CACHE).then(c => c.put('index.html?v=7', copia));
          return r;
        })
        .catch(() => caches.match('index.html?v=7'))
    );
    return;
  }

  // Resto del armazón: responde desde caché al instante y actualiza por detrás,
  // así una versión nueva queda disponible en la siguiente apertura sin que
  // haya que borrar datos del sitio a mano.
  e.respondWith(
    caches.open(CACHE).then(c =>
      c.match(e.request).then(hit => {
        const red = fetch(e.request)
          .then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })
          .catch(() => hit);
        return hit || red;
      })
    )
  );
});
