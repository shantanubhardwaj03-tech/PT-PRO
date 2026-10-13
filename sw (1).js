// Offline support: always try the network first so updates show right away,
// and fall back to the saved copy only when offline.
const VERSION='ptpro-v5';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/api/'))return; // document search always goes to the network
  const mine=u.origin===location.origin||u.hostname.includes('fonts.g');
  if(!mine)return;
  e.respondWith(fetch(e.request).then(res=>{
    if(res.ok){const cp=res.clone();caches.open(VERSION).then(c=>c.put(e.request,cp));}
    return res;
  }).catch(()=>caches.match(e.request).then(hit=>hit||caches.match('./index.html'))));
});
