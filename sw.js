const CACHE='market-compass-v1.15.0-hotfix1';
const FILES=['./','./index.html','./styles.css','./app.js','./firebase-config.js','./manifest.json'];

/*
 * MARKET COMPASS v1.15.0 hotfix
 *
 * 目的:
 * 1) TradingView が日経225指定にもかかわらず AAPL を表示する問題を修正
 * 2) Android / タブレットで GAS JSONP が失敗した後 bridge-timeout になる確率を下げる
 *
 * app.js 本体を利用者が手作業で部分編集しなくて済むよう、
 * service worker が app.js を取得した時だけ、同一モジュール末尾へ安全な補正コードを追加する。
 * 次の正式なソース統合版では app.js 本体へ吸収可能。
 */
const APP_HOTFIX = String.raw`

// ===== MARKET COMPASS v1.15.0 AUTO HOTFIX =====
try {
  renderTradingViewLive = function(symbol){
    const el=$('#tradingviewLiveChart');if(!el)return;
    const key=symbol==='USDJPY'?'USDJPY':'NIKKEI';
    state.liveMarketSymbol=key;
    $$('.live-symbols button').forEach(function(b){
      b.classList.toggle('active',b.dataset.liveMarket===key);
    });

    const cfg=key==='USDJPY'
      ?{symbol:'FX_IDC:USDJPY',title:'USD/JPY'}
      :{symbol:'TVC:NI225',title:'日経225'};

    el.innerHTML='<div class="live-chart-loading">'+esc(cfg.title)+' のライブ参考チャートを読み込みます…</div>';

    const wrap=document.createElement('div');
    wrap.className='tradingview-widget-container';
    wrap.style.height='100%';
    wrap.style.width='100%';

    const widget=document.createElement('div');
    widget.className='tradingview-widget-container__widget';
    widget.style.height='calc(100% - 32px)';
    widget.style.width='100%';
    wrap.appendChild(widget);

    const credit=document.createElement('div');
    credit.className='tradingview-widget-copyright';
    credit.innerHTML='<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank">Market data</a><span>&nbsp;by TradingView</span>';
    wrap.appendChild(credit);

    const script=document.createElement('script');
    script.type='text/javascript';
    script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async=true;

    // TradingView公式の動的埋め込み例と同じく innerHTML へ設定JSONを渡す。
    // AAPLはウィジェット既定値なので、symbol設定が読まれない状態を避ける。
    script.innerHTML=JSON.stringify({
      autosize:true,
      symbol:cfg.symbol,
      interval:'30',
      timezone:'Asia/Tokyo',
      theme:'dark',
      style:'1',
      locale:'ja',
      allow_symbol_change:false,
      calendar:false,
      details:false,
      hotlist:false,
      hide_side_toolbar:true,
      save_image:false,
      backgroundColor:'rgba(7,17,28,1)',
      gridColor:'rgba(38,57,77,0.35)',
      support_host:'https://www.tradingview.com'
    });

    script.onerror=function(){
      el.innerHTML='<div class="live-chart-loading">TradingViewを読み込めませんでした。通信状態を確認してください。</div>';
    };

    el.innerHTML='';
    el.appendChild(wrap);
    wrap.appendChild(script);
  };
} catch(e) {
  console.warn('MC v1.15 TradingView hotfix',e);
}

try {
  gasRequest = function(url,ok,fail,timeoutMs=20000){
    if(!url){fail(new Error('gas-url-empty'));return;}

    let settled=false;
    const success=function(data){
      if(settled)return;
      settled=true;
      ok(data);
    };
    const failure=function(err){
      if(settled)return;
      settled=true;
      fail(err);
    };

    // 低速端末では従来12秒でJSONPを諦めるのが早すぎる場合がある。
    const firstWait=Math.max(22000,Math.min(Number(timeoutMs)||22000,45000));

    jsonp(url,success,function(){
      if(settled)return;

      // 同じURLのリダイレクトキャッシュを避けるため1回だけ再試行。
      const retryUrl=url+(url.includes('?')?'&':'?')+'_mc_retry='+Date.now();
      jsonp(retryUrl,success,function(){
        if(settled)return;
        bridgeRequest(retryUrl,success,failure,Math.max(30000,Number(timeoutMs)||30000));
      },15000);
    },firstWait);
  };
} catch(e) {
  console.warn('MC v1.15 GAS sync hotfix',e);
}

// すでに市場ページを開いている状態で更新された場合も描画し直す。
setTimeout(function(){
  try{
    if($('#page-market') && $('#page-market').classList.contains('active')){
      renderTradingViewLive(state.liveMarketSymbol||state.marketSymbol||'NIKKEI');
    }
  }catch(e){}
},800);
// ===== END MARKET COMPASS v1.15.0 AUTO HOTFIX =====
`;

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

  // GAS / Firebase / TradingViewなど外部通信はこのSWではキャッシュしない。
  if(url.origin!==self.location.origin)return;

  // app.jsだけはネットワーク最新版を読み、v1.15.0補正を同一モジュール末尾へ追加。
  if(url.pathname.endsWith('/app.js')){
    event.respondWith(
      fetch(req,{cache:'no-store'}).then(async response=>{
        if(!response.ok)return response;
        const source=await response.text();
        const patched=source+APP_HOTFIX;
        const headers=new Headers(response.headers);
        headers.set('content-type','text/javascript; charset=utf-8');
        headers.set('cache-control','no-store');
        const out=new Response(patched,{
          status:response.status,
          statusText:response.statusText,
          headers
        });
        caches.open(CACHE).then(cache=>cache.put(req,out.clone())).catch(()=>{});
        return out;
      }).catch(()=>caches.match(req))
    );
    return;
  }

  // HTML / CSS / その他JSはネットワーク優先。
  if(req.mode==='navigate'||/\.(?:js|css|html)$/.test(url.pathname)){
    event.respondWith(
      fetch(req,{cache:'no-store'}).then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
        return response;
      }).catch(()=>caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>cached||fetch(req).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
      return response;
    }))
  );
});
