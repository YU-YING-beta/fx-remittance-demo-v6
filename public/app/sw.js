/* 外匯申報 APP：離線快取。頁面先連網取最新版（3 秒內沒回應就用快取），其他檔案先用快取。 */
const V = 'fx-app-v1';
const SHELL = ['./', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('fx-app-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if(r.method !== 'GET' || u.origin !== self.location.origin || u.pathname.startsWith('/api/')) return;
  if(r.mode === 'navigate'){
    e.respondWith((async () => {
      const net = fetch(r).then(res => { if(res.ok){ const cp = res.clone(); caches.open(V).then(c => c.put('./', cp)); } return res; });
      const slow = new Promise(ok => setTimeout(ok, 3000)).then(() => caches.match('./'));
      try{ const first = await Promise.race([net, slow]); if(first) return first; return await net; }
      catch(err){ return (await caches.match('./')) || Response.error(); }
    })());
    return;
  }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if(res.ok){ const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; })));
});
