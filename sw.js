// COSMOS service worker: network first (updates show on the next launch), cache as the offline fallback.
const CACHE = 'cosmos-0ee5f2a';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/util.js', 'js/build.js', 'js/genome.js', 'js/store.js', 'js/device.js', 'js/world.js', 'js/audio.js', 'js/instruments.js', 'js/score.js', 'js/music.js', 'js/playlist.js', 'js/gl.js', 'js/shaders.js',
  'js/render.js', 'js/life.js', 'js/multiverse.js', 'js/observatory.js', 'js/genera.js', 'js/media.js', 'js/media2.js', 'js/media3.js', 'js/media4.js', 'js/main.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // only COSMOS's own old caches: other apps can share this origin (e.g. github.io)
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cosmos-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        }
        // a server error (or a missing file during a broken deploy) falls back to the copy we have
        return caches.match(req, { ignoreSearch: true }).then((r) => r || res);
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
