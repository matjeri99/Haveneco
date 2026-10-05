const CACHE = 'ihk-audit-v3.1.2';
const ASSETS = ['./', 'index.html', 'config.js?v=3.1.2', 'assets/css/app.css?v=3.1.2', 'assets/js/api.js?v=3.1.2', 'assets/js/app.js?v=3.1.2',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  'assets/img/logo-mesti.webp', 'assets/img/logo-gmp.webp', 'assets/img/logo-bess.webp', 'assets/img/logo-haccp.webp',
  'mesti-checklist.json', 'risk-master.json', 'legal-master.json'];

// cache:'reload' — elak HTTP cache GitHub Pages (max-age 10 min) masukkan fail LAMA ke cache baharu
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ihk-audit-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

const isImage = url => /\.(png|webp|svg|jpe?g)$/i.test(url.pathname);

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Apps Script tidak dicache
  const key = req.mode === 'navigate' ? 'index.html' : req;

  if (isImage(url)) { // imej: cache-first
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(x => x.put(req, cp)); } return r; })));
    return;
  }
  // HTML/JS/CSS/JSON: network-first (sentiasa versi terkini bila online), cache bila offline
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(x => x.put(key, cp)); }
    return r;
  }).catch(() => caches.match(key).then(r => r || caches.match(req, { ignoreSearch: true }))));
});
