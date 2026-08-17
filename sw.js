const CACHE='market-compass-v1.15.2';
const FILES=['./','./index.html','./styles.css','./app.js','./firebase-config.js','./manifest.json'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
});

self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);

  // GAS / Firebase / TradingViewなど外部通信はキャッシュしない。
  if(url.origin!==self.location.origin)return;

  // HTML / JS / CSS はネットワーク優先。更新直後に古いコードを掴まない。
  if(req.mode==='navigate'||/\.(?:js|css|html)$/.test(url.pathname)){
    event.respondWith(fetch(req,{cache:'no-store'}).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
      return response;
    }).catch(()=>caches.match(req)));
    return;
  }

  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
    return response;
  })));
});
