// Service worker : garde une copie de l'application pour qu'elle s'ouvre même sans réseau.
// Les données (/api) passent toujours par le réseau ; hors ligne, l'application utilise son cache local.
const CACHE = 'caisse-gros-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Données, page d'installation et modèle de reconnaissance (mis en cache par la bibliothèque elle-même)
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/models/') || url.pathname === '/install' || url.pathname === '/ca.crt') return;
  const key = e.request.mode === 'navigate' ? '/' : e.request;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || Response.error())),
  );
});
