const CACHE = 'ihk-audit-v3.1.1';
const ASSETS = ['./', 'index.html', 'config.js', 'assets/css/app.css', 'assets/js/api.js', 'assets/js/app.js', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  'assets/img/logo-mesti.webp', 'assets/img/logo-gmp.webp', 'assets/img/logo-bess.webp', 'assets/img/logo-haccp.webp',
  'mesti-checklist.json', 'risk-master.json', 'legal-master.json'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ihk-audit-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  // Hanya urus GET dari origin sendiri — panggilan Apps Script (script.google.com) jangan dicache
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Network-first untuk halaman, fallback ke cache bila offline
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); } return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  // Stale-while-revalidate untuk aset statik: laju & offline, dikemaskini di belakang
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(cached => {
    const net = fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; }).catch(() => cached);
    return cached || net;
  }));
});
