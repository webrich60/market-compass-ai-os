import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { initializeAuth, indexedDBLocalPersistence, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];

// v1.9.21: GitHub Pages の localStorage 容量超過対策。
// MARKET COMPASS の端末保存は IndexedDB を正本にし、localStorage は書ける場合だけ互換ミラーとして使う。
const MC_STORE_DB='market-compass-storage-v1', MC_STORE_NAME='kv';
const storageCache=Object.create(null);let storageHydrated=false;
function openMcStore(){return new Promise((resolve,reject)=>{try{const req=indexedDB.open(MC_STORE_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(MC_STORE_NAME))db.createObjectStore(MC_STORE_NAME)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)}catch(e){reject(e)}})}
async function hydrateStorageCache(){
 try{
  const db=await openMcStore();
  await new Promise((resolve,reject)=>{const tx=db.transaction(MC_STORE_NAME,'readonly'),st=tx.objectStore(MC_STORE_NAME),req=st.getAllKeys();req.onsuccess=()=>{const keys=req.result||[];if(!keys.length){resolve();return}let left=keys.length;keys.forEach(k=>{const r=st.get(k);r.onsuccess=()=>{if(r.result!==undefined)storageCache[k]=String(r.result);if(--left===0)resolve()};r.onerror=()=>{if(--left===0)resolve()}})};req.onerror=()=>reject(req.error)});
  db.close();
 }catch(e){console.warn('IndexedDB hydrate failed',e)}
 // 初回だけ既存 localStorage の小さな設定・学習データを IndexedDB へ移す。
 const keys=['mc_backend','mc_sync_token','mc_predictions','mc_journal','mc_terms','mc_days','mc_term_count','mc_desktop_scale','mc_speech_rate','mc_speech_voice_browser'];
 for(const k of keys){if(storageCache[k]!==undefined)continue;try{const v=localStorage.getItem(k);if(v!==null){storageCache[k]=v;idbStoreSet(k,v)}}catch(e){}}
 storageHydrated=true;
}
function idbStoreSet(key,value){openMcStore().then(db=>{try{const tx=db.transaction(MC_STORE_NAME,'readwrite');tx.objectStore(MC_STORE_NAME).put(String(value),key);tx.oncomplete=()=>db.close();tx.onerror=()=>db.close()}catch(e){db.close()}}).catch(e=>console.warn('IndexedDB save failed',e))}
function idbStoreRemove(key){openMcStore().then(db=>{try{const tx=db.transaction(MC_STORE_NAME,'readwrite');tx.objectStore(MC_STORE_NAME).delete(key);tx.oncomplete=()=>db.close();tx.onerror=()=>db.close()}catch(e){db.close()}}).catch(()=>{})}
function safeStorageGet(key){
 if(storageHydrated&&storageCache[key]!==undefined)return storageCache[key];
 try{const v=localStorage.getItem(key);if(v!==null){storageCache[key]=v;return v}}catch(e){}
 return storageCache[key]!==undefined?storageCache[key]:null;
}
function safeStorageSet(key,value){const v=String(value);storageCache[key]=v;idbStoreSet(key,v);try{localStorage.setItem(key,v)}catch(e){console.warn('localStorage full; using IndexedDB for',key)}}
function safeStorageRemove(key){delete storageCache[key];idbStoreRemove(key);try{localStorage.removeItem(key)}catch(e){}}

// v1.9.22: 壊れた端末保存データがあっても同期全体を止めない。
function readStoredArray(key){
 const raw=safeStorageGet(key);
 if(raw===null||raw===undefined||raw==='')return [];
 try{
  const value=JSON.parse(raw);
  if(Array.isArray(value))return value;
  throw new Error('stored value is not an array');
 }catch(err){
  console.warn('Invalid stored data reset',key,err);
  safeStorageSet(key,'[]');
  return [];
 }
}

const state={data:null,latestData:null,briefHistory:[],historySelectedRow:null,newsPollTimer:null,newsRefreshBusy:false,markets:null,learningFeed:[],learningFeedFetchedAt:0,notebook:{sheetUrl:'',sheetName:'',notebookUrl:'',ready:false},marketPeriod:'1m',marketSymbol:'NIKKEI',liveMarketSymbol:'NIKKEI',filter:'all',lifeFilter:'all',choices:{},backend:safeStorageGet('mc_backend')||'',syncToken:safeStorageGet('mc_sync_token')||'',syncTimer:null,syncBusy:false,lastSync:null,speechRun:0,speechPaused:false,speechOwner:null,sectionSpeechEl:null,audio:null,audioQueue:[],audioIndex:0,coachCancel:null,coachBusy:false};
const DEMO={
 generatedAt:new Date().toISOString(),
 pulse:[
  {name:'米国金利',value:'方向を確認',tone:'neutral',note:'FRB・物価・雇用を見る'},
  {name:'ドル円',value:'材料を比較',tone:'neutral',note:'日米金利差＋リスク回避'},
  {name:'日本株',value:'為替も確認',tone:'neutral',note:'円安/円高で業種差'},
  {name:'原油・金',value:'地政学に注意',tone:'neutral',note:'インフレ・安全資産'}
 ],
 news:[
  {region:'米国',importance:5,title:'米国の物価・雇用・FRB発言を最優先で確認する日',summary:'米国の金利見通しは、ドル円・世界株・金など幅広い市場へ波及しやすい重要材料です。',why:'「FRBが利下げ/利上げを急ぐか」が変わると、日米金利差の見方も変わります。',impact:['ドル円','米国株','金利'],url:'https://www.federalreserve.gov/'},
  {region:'日本',importance:5,title:'日銀の金融政策と国内物価の組み合わせを確認',summary:'日本の政策金利や物価見通しは、円相場と日本株の評価に直結しやすい材料です。',why:'米国だけでなく日本側の金利が動くと、日米金利差そのものが変化します。',impact:['円','日経平均','銀行株'],url:'https://www.boj.or.jp/'},
  {region:'世界',importance:4,title:'地政学・エネルギー価格がインフレへ与える影響を追う',summary:'原油や輸送コストの上昇は、物価・企業利益・金利見通しへ連鎖することがあります。',why:'ニュースを単発で見ず「エネルギー→物価→金利→通貨・株」の順で考えます。',impact:['原油','金','株式'],url:'https://www.gdeltproject.org/'},
  {region:'FX',importance:4,title:'ドル円は「日米金利差」と「リスク回避」を分けて考える',summary:'円高・円安を一つの理由だけで説明せず、複数の材料が同時にどう働くかを見る練習です。',why:'同じ日に円安材料と円高材料が同居することは普通です。',impact:['ドル円'],url:'#'},
  {region:'世界',importance:4,title:'中国・欧州の景気と貿易の変化を日本への波及まで見る',summary:'中国需要、欧州景気、関税や供給網の変化は、日本の輸出企業や原材料価格にも影響し得ます。',why:'海外ニュースを「外国の話」で終わらせず、日本企業・為替・物価へどう届くかを見る練習です。',impact:['日本株','為替','貿易'],url:'#'}
 ],
 lifestyle:[
  {category:'旅',title:'週末に行きたい国内の小さな旅先を探す',summary:'有名観光地だけでなく、温泉街・古い町並み・道の駅など、少し足を延ばしたくなる記事を集めます。',url:'#',source:'デモ'},
  {category:'温泉',title:'温泉・旅館の新しい楽しみ方',summary:'景色、食、湯、滞在体験など、次の旅行候補として保存したくなる話題を選びます。',url:'#',source:'デモ'},
  {category:'暮らし',title:'毎日の手間を少し減らす実用的な工夫',summary:'節約だけに偏らず、スマホ・AI・時間の使い方など生活が楽になる記事を少数だけ表示します。',url:'#',source:'デモ'}
 ],
 brief:'おはようございます。今日のマーケットコンパスです。まず最初に確認したいのは、米国の金利見通しです。株や為替を見るときは、価格そのものより、なぜ市場参加者が金利の先行きを変えたのかを見ます。次に日本です。日銀の金融政策と国内物価を確認し、米国側だけではなく日本側の金利がどう動きそうかを考えます。三つ目は世界情勢と原油です。地政学的な緊張や供給不安で原油が上がると、物価上昇、金利上昇、企業コスト増加という連鎖が起きる可能性があります。今日の練習は、ニュースを見た後にドル円と日経平均について方向を予想し、その理由を一行で残すことです。正解率ではなく、理由が筋道立っているかを重視してください。'
};

function buildDemoMarkets(){
 const end=new Date(), days=390, nikkei=[], usd=[];let n=40000,u=150;
 for(let i=days;i>=0;i--){const d=new Date(end);d.setDate(d.getDate()-i);if(d.getDay()===0||d.getDay()===6)continue;const k=days-i;n+=Math.sin(k/8)*34+Math.cos(k/19)*22+18+(k%17===0?-120:0);u+=Math.sin(k/7)*.08+Math.cos(k/17)*.04+(k%23===0?.18:0);const date=d.toISOString().slice(0,10);nikkei.push({date,value:Number(n.toFixed(2))});usd.push({date,value:Number(u.toFixed(2))})}
 return {ok:true,sourceMode:'DEMO',generatedAt:new Date().toISOString(),series:{NIKKEI:{id:'NIKKEI225',name:'日経平均',label:'NIKKEI 225',unit:'円',points:nikkei},USDJPY:{id:'DEXJPUS',name:'ドル円',label:'USD/JPY',unit:'円',points:usd}}};
}
const DEMO_MARKETS=buildDemoMarkets();

const terms=[
 ['政策金利','中央銀行が金融政策の基準として動かす金利。株・為替・債券を見る土台。'],['FOMC','米国の金融政策を決める会合。FRBの金利判断で世界市場が動きやすい。'],['FRB','米国の中央銀行制度。米国金利とドルの大きな材料。'],['日銀','日本銀行。日本の金融政策を担う中央銀行。'],['CPI','消費者物価指数。インフレの強さを見る代表的な指標。'],['雇用統計','雇用者数・失業率など。米国景気とFRBの判断材料。'],['長期金利','一般に10年国債利回りなど。株の評価や為替に影響。'],['国債','国が資金調達のため発行する債券。金利を見る中心的市場。'],['利回り','投資額に対して得られる収益率。債券価格とは逆方向に動きやすい。'],['インフレ','物価が継続的に上がる状態。金利政策に大きく影響する。'],['デフレ','物価が継続的に下がる状態。需要不足や賃金停滞と結びつくことがある。'],['GDP','国内で生み出された付加価値の合計。経済規模・成長を見る基本。'],['為替','異なる通貨を交換する比率。ドル円なら1ドル何円か。'],['円高','1ドルを買うのに必要な円が少なくなる状態。例150円→140円。'],['円安','1ドルを買うのに必要な円が多くなる状態。例140円→150円。'],['リスクオン','投資家がリスクを取りやすい心理状態。株などが買われやすい。'],['リスクオフ','投資家が安全性を重視する心理状態。資金移動を観察する。'],['PER','株価が利益の何倍まで買われているかを見る代表的な株価指標。'],['PBR','株価が純資産の何倍かを見る株価指標。'],['ROE','株主資本を使ってどれくらい利益を生んだかを見る指標。'],['EPS','1株あたり利益。企業利益と株価評価をつなぐ基本指標。'],['ボラティリティ','価格変動の大きさ。高いほど値動きが激しい。'],['損切り','想定が外れたとき損失拡大を防ぐためポジションを閉じること。'],['ポジションサイズ','一回の取引に投入する量。上手さより先にリスク管理が重要。']
];
const roadmap=[
 {n:1,title:'土台＋デモ',period:'0〜3か月',items:['円高・円安、金利・物価・景気の基本','毎日ニュース5本＋5分ラジオ','MARKET COMPASSで予想理由を残す','FXはまずデモで注文操作を覚える']},
 {n:2,title:'超少額の実践',period:'3〜12か月',items:['株は1株から小さく経験する','FXは1通貨など超少額から始める','指値・逆指値・決済の操作を覚える','損失上限と取引理由を毎回ノートへ']},
 {n:3,title:'中級者の型づくり',period:'12〜24か月',items:['企業利益・バリュエーションを学ぶ','テクニカルは補助として使う','ニュース→金利→為替→株を説明する','少額売買を記録して得意市場を絞る']},
 {n:4,title:'検証できる実践者',period:'24〜36か月',items:['仮説→記録→検証を習慣化','勝率より期待値と損失管理','相場環境ごとに戦略を分ける','高機能ツールは必要な機能だけ使う']},
 {n:5,title:'自分の型を持つ',period:'36か月〜',items:['得意市場と時間軸を限定','売買しない判断もルール化','四半期ごとに戦略を再検証','感情ではなく再現性を優先']}
];
const cause=['インフレ上振れ','利下げ期待が後退','金利上昇圧力','ドル買い要因','ドル円の円安要因'];
let firebaseAuth=null;
let appInitialized=false;
function firebaseConfigReady(){
 return firebaseConfig&&firebaseConfig.apiKey&&!String(firebaseConfig.apiKey).includes('YOUR_')&&firebaseConfig.authDomain&&!String(firebaseConfig.authDomain).includes('YOUR_')&&firebaseConfig.projectId&&!String(firebaseConfig.projectId).includes('YOUR_');
}
function setLoginStatus(text,mode=''){const el=$('#loginStatus');if(!el)return;el.textContent=text;el.className='login-status'+(mode?' '+mode:'')}
function showLoginGate(){
 const gate=$('#loginGate');if(!gate)return;
 document.body.classList.add('login-locked');gate.hidden=false;
 setTimeout(()=>$('#loginEmail')?.focus(),80);
}
function hideLoginGate(){const gate=$('#loginGate');if(gate)gate.hidden=true;document.body.classList.remove('login-locked')}
function friendlyFirebaseError(err){
 const code=String(err?.code||'unknown');
 if(code.includes('invalid-credential')||code.includes('wrong-password')||code.includes('user-not-found'))return `メールアドレスまたはパスワードが違います。
診断コード: ${code}`;
 if(code.includes('invalid-email'))return `メールアドレスの形式を確認してください。
診断コード: ${code}`;
 if(code.includes('too-many-requests'))return `ログイン試行が多すぎます。少し時間をおいてから再度お試しください。
診断コード: ${code}`;
 if(code.includes('network-request-failed'))return `通信できませんでした。インターネット接続を確認してください。
診断コード: ${code}`;
 if(code.includes('operation-not-allowed'))return `Firebaseのメール/パスワード認証が有効になっていません。
診断コード: ${code}`;
 if(code.includes('unauthorized-domain')||code.includes('app-not-authorized'))return `GitHub PagesのドメインがFirebase側で許可されていません。
診断コード: ${code}`;
 if(code.includes('invalid-api-key')||code.includes('api-key-not-valid'))return `Firebase Web APIキーを確認してください。
診断コード: ${code}`;
 if(code.includes('configuration-not-found'))return `Firebase Authenticationの構成を確認してください。
診断コード: ${code}`;
 const msg=String(err?.message||'').replace(/^Firebase:\s*/,'').slice(0,180);
 return `ログインできませんでした。パスワード以外のFirebase設定エラーの可能性があります。
診断コード: ${code}${msg?`
詳細: ${msg}`:''}`;
}
async function loginWithFirebase(){
 const email=$('#loginEmail')?.value.trim()||'',password=$('#loginPassword')?.value||'';
 if(!email)return setLoginStatus('メールアドレスを入力してください。','error');
 if(!password)return setLoginStatus('パスワードを入力してください。','error');
 if(!firebaseAuth)return setLoginStatus('Firebase Authenticationの初期設定が完了していません。','error');
 const btn=$('#loginSubmitBtn');if(btn){btn.disabled=true;btn.textContent='ログイン中…'};setLoginStatus('本人確認をしています…');
 try{
  await signInWithEmailAndPassword(firebaseAuth,email,password);
  setLoginStatus('ログインしました。','ok');
 }catch(err){console.warn('firebase login',err);setLoginStatus(friendlyFirebaseError(err),'error')}
 finally{if(btn){btn.disabled=false;btn.textContent='ログイン'}}
}
async function resetFirebasePassword(){
 const email=$('#loginEmail')?.value.trim()||'';
 if(!email)return setLoginStatus('先にメールアドレスを入力してください。','error');
 if(!firebaseAuth)return setLoginStatus('Firebase Authenticationの初期設定が完了していません。','error');
 try{await sendPasswordResetEmail(firebaseAuth,email);setLoginStatus('パスワード再設定メールを送信しました。','ok')}catch(err){console.warn('firebase reset',err);setLoginStatus(friendlyFirebaseError(err),'error')}
}
async function logoutFirebase(){
 try{stopSpeech?.();stopNewsAutoPoll();stopCloudSync();if(firebaseAuth)await signOut(firebaseAuth)}catch(e){console.warn('logout',e)}
 appInitialized=false;showLoginGate();setLoginStatus('ログアウトしました。');
}
function bindLoginGate(){
 $('#loginSubmitBtn')?.addEventListener('click',loginWithFirebase);
 $('#loginPassword')?.addEventListener('keydown',e=>{if(e.key==='Enter')loginWithFirebase()});
 $('#loginEmail')?.addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginPassword')?.focus()});
 $('#loginResetBtn')?.addEventListener('click',resetFirebasePassword);
}
async function boot(){
 await hydrateStorageCache();state.backend=safeStorageGet('mc_backend')||state.backend||'';state.syncToken=safeStorageGet('mc_sync_token')||state.syncToken||'';applySetupFromUrl();bindLoginGate();showLoginGate();
 if(!firebaseConfigReady()){setLoginStatus('Firebase初期設定が未完了です。firebase-config.jsを設定してください。','error');return}
 try{
  const fbApp=initializeApp(firebaseConfig);firebaseAuth=initializeAuth(fbApp,{persistence:[indexedDBLocalPersistence]});
  onAuthStateChanged(firebaseAuth,async user=>{
   if(!user){appInitialized=false;showLoginGate();return}
   hideLoginGate();
   if(!appInitialized){appInitialized=true;init()}
   const mail=$('#firebaseUserEmail');if(mail)mail.textContent='ログイン中：'+(user.email||'Firebaseユーザー');
  });
 }catch(err){console.warn('firebase init',err);setLoginStatus('Firebaseを初期化できませんでした。firebase-config.jsを確認してください。','error')}
}
function init(){
 applyDesktopScale();
 initReadAloudControls();
 applySetupFromUrl();
 $('#todayLabel').textContent=new Intl.DateTimeFormat('ja-JP',{dateStyle:'full'}).format(new Date());
 bindNav();bindActions();initSpeechControls();renderRoadmap();renderTerms();loadLocalStats();loadJournal();loadPredictions();renderData(DEMO);state.markets=DEMO_MARKETS;renderMarkets();if(!state.backend||!state.syncToken){setApiStatus('offline');setLastUpdated(null,'offline');setRefreshButton('offline')}else{setApiStatus('busy');setLastUpdated(null,'busy');setRefreshButton('busy')};
 updateMobileDock();
 if(state.backend){fetchBackend();if(state.syncToken){cloudSync(true);startCloudSync();startNewsAutoPoll();setTimeout(()=>fetchLearningFeed(false),1400)}}
 if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}
function applyDesktopScale(){
 const raw=Number(safeStorageGet('mc_desktop_scale')||'0.60');
 const allowed=[0.50,0.60,0.65,0.70,0.80,1];
 const scale=allowed.includes(raw)?raw:0.60;
 const inverse=(1/scale).toFixed(5);
 document.documentElement.style.setProperty('--mc-desktop-zoom',String(scale));
 document.documentElement.style.setProperty('--mc-desktop-unzoom',inverse);
 const select=document.querySelector('#desktopScale');if(select)select.value=scale.toFixed(2);
}

function bindNav(){
 $$('#nav button').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
 $$('[data-goto]').forEach(b=>b.onclick=()=>showPage(b.dataset.goto));
 $('#menuBtn').onclick=()=>toggleSidebar();
 $('#sidebarBackdrop')?.addEventListener('click',()=>toggleSidebar(false));
 $$('[data-mobile-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.mobilePage));
 $('#mobileMoreBtn')?.addEventListener('click',()=>toggleSidebar(true));
 updateMobileDock();
}
function showPage(page){
 $$('.page').forEach(p=>p.classList.remove('active'));$('#page-'+page).classList.add('active');
 $$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 $$('[data-mobile-page]').forEach(b=>{const active=b.dataset.mobilePage===page;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
 $('#pageTitle').textContent=$(`#nav button[data-page="${page}"]`)?.textContent.replace(/^..\s?/,'')||'MARKET COMPASS';
 if(page==='news')$('#dockNewsBtn')?.classList.remove('has-dot');
 if((page==='news'||page==='brief')&&state.backend&&state.syncToken&&!state.briefHistory.length)fetchBriefHistory(false);
 updateMobileDock();
 toggleSidebar(false);if(page==='market'){renderMarkets();renderTradingViewLive(state.liveMarketSymbol||state.marketSymbol)}if(page==='learn'&&state.backend&&state.syncToken&&(!state.learningFeed.length||Date.now()-state.learningFeedFetchedAt>30*60*1000))fetchLearningFeed(false);if(page==='notebook')fetchNotebookStatus(true);window.scrollTo({top:0,behavior:'smooth'});
}


function updateMobileDock(){
 const more=$('#mobileMoreBtn');
 const sideOpen=$('#sidebar')?.classList.contains('open');
 more?.classList.toggle('open',!!sideOpen);
 const briefBtn=$('#dockBriefBtn');
 const isPlaying=('speechSynthesis' in window)&&speechSynthesis.speaking&&!state.speechPaused;
 briefBtn?.classList.toggle('playing',!!isPlaying);
}

function toggleSidebar(force){
 const side=$('#sidebar'),back=$('#sidebarBackdrop');
 const open=typeof force==='boolean'?force:!side.classList.contains('open');
 side.classList.toggle('open',open);back?.classList.toggle('open',open);updateMobileDock();
}

function bindActions(){
 const desktopScale=$('#desktopScale');if(desktopScale){desktopScale.value=safeStorageGet('mc_desktop_scale')||'0.60';desktopScale.onchange=e=>{safeStorageSet('mc_desktop_scale',e.target.value);applyDesktopScale();renderMarkets();toast('PC表示を '+Math.round(Number(e.target.value)*100)+'％相当に変更しました')}}
 $('#refreshBtn').onclick=()=>refreshAll();
 $('#speakBtn').onclick=toggleSpeech;
 $('#stopBtn').onclick=stopSpeech;
 $('#voiceTestBtn').onclick=testVoice;
 $('#copyBriefBtn').onclick=()=>navigator.clipboard?.writeText(cleanRadioTextClient(state.data?.brief||'')).then(()=>toast('原稿をコピーしました'));
 $('#radioRefreshBtn').onclick=regenerateRadioScript;
 $('#speechRate').onchange=e=>safeStorageSet('mc_speech_rate',e.target.value);
 $$('.choice-row button').forEach(b=>b.onclick=()=>{let row=b.parentElement;row.querySelectorAll('button').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');state.choices[row.dataset.market]=b.dataset.choice;});
 ['USDJPY','NIKKEI'].forEach(m=>{$('#confidence'+m).oninput=e=>$('#confidence'+m+'Label').textContent=e.target.value+'/5'});
 $$('.save-prediction').forEach(b=>b.onclick=()=>savePrediction(b.dataset.market));
 $('#saveJournalBtn').onclick=saveJournal;
 $('#termSearch').oninput=renderTerms;
 $('#saveBackendBtn').onclick=()=>saveConnection();
 $('#syncNowBtn')?.addEventListener('click',()=>cloudSync(false));
 $('#phoneLinkBtn')?.addEventListener('click',buildPhoneSetupLink);
 $('#clearBackendBtn').onclick=()=>{safeStorageRemove('mc_backend');safeStorageRemove('mc_sync_token');state.backend='';state.syncToken='';stopNewsAutoPoll();state.briefHistory=[];state.historySelectedRow=null;state.latestData=null;$('#backendUrl').value='';$('#syncToken').value='';stopCloudSync();setSyncStatus('demo','未接続','クラウド同期を停止しました。');setApiStatus('offline');setLastUpdated(null,'offline');setRefreshButton('offline');$('#connectionMessage').textContent='接続を解除しました。';renderData(DEMO);state.markets=DEMO_MARKETS;renderMarkets()};
 $('#logoutBtn')?.addEventListener('click',logoutFirebase);
 $('#backendUrl').value=state.backend;$('#syncToken').value=state.syncToken;setSyncStatus(state.backend&&state.syncToken?'busy':'demo',state.backend&&state.syncToken?'接続準備済み':'デモモード',state.backend&&state.syncToken?'同期を確認します。':'まだクラウド同期していません。');
 if(state.backend&&state.syncToken){setApiStatus('busy');setLastUpdated(null,'busy');setRefreshButton('busy')}else{setApiStatus('offline');setLastUpdated(null,'offline');setRefreshButton('offline')}
 $$('#newsFilters button').forEach(b=>b.onclick=()=>{$$('#newsFilters button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.filter=b.dataset.filter;renderNews()});
 ['#topNews','#newsList'].forEach(sel=>$(sel)?.addEventListener('click',e=>{const b=e.target.closest('.news-ai-btn');if(b)askNewsExplain(Number(b.dataset.newsIndex||0),b)}));
 ['#newsHistoryPicker','#radioHistoryPicker'].forEach(sel=>$(sel)?.addEventListener('click',e=>{const latest=e.target.closest('[data-history-latest]');if(latest){restoreLatestBrief();return}const b=e.target.closest('[data-history-row]');if(b)loadBriefHistoryRow(Number(b.dataset.historyRow||0))}));
 $('#learningFeedRefreshBtn')?.addEventListener('click',()=>fetchLearningFeed(true));
 const learningPickHandler=e=>{const b=e.target.closest('[data-learning-pick]');if(!b)return;const item=state.learningFeed[Number(b.dataset.learningPick||0)];if(!item)return;if($('#learningUrl'))$('#learningUrl').value=item.url||'';if($('#learningNote'))$('#learningNote').value=[item.source||'',item.title||'',item.description||''].filter(Boolean).join(' / ').slice(0,1200);showPage('learn');setTimeout(()=>$('#learningUrl')?.scrollIntoView({behavior:'smooth',block:'center'}),80);toast('動画をAI分析欄へ送りました')};
 $('#learningFeedList')?.addEventListener('click',learningPickHandler);
 $('#homeLearningFeed')?.addEventListener('click',learningPickHandler);
 $('#analyzeLearningBtn')?.addEventListener('click',analyzeLearningResource);
 $('#clearLearningBtn')?.addEventListener('click',()=>{if($('#learningUrl'))$('#learningUrl').value='';if($('#learningNote'))$('#learningNote').value='';if($('#learningAnalysisResult'))$('#learningAnalysisResult').innerHTML='<div class="ai-coach-placeholder"><b>使い方</b><span>URLを貼ってAI分析を押してください。</span></div>'});
 $('#buildChatgptPromptBtn')?.addEventListener('click',()=>{const t=buildChatgptDecisionPrompt();if($('#chatgptPromptPreview'))$('#chatgptPromptPreview').value=t;toast('ChatGPT相談文を作りました')});
 $('#openChatgptBtn')?.addEventListener('click',openChatgptWithPrompt);
 $('#setupNotebookBtn')?.addEventListener('click',setupNotebookBridge);
 $('#saveNotebookTodayBtn')?.addEventListener('click',saveNotebookToday);
 $('#openNotebookSheetBtn')?.addEventListener('click',openNotebookSheet);
 $('#saveNotebookLmUrlBtn')?.addEventListener('click',saveNotebookLmUrl);
 $('#openNotebookLmBtn')?.addEventListener('click',openNotebookLm);
 $('#buildLifeCompassSummaryBtn')?.addEventListener('click',buildLifeCompassSummary);
 $$('#lifestyleFilters button').forEach(b=>b.onclick=()=>{$$('#lifestyleFilters button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.lifeFilter=b.dataset.lifeFilter;renderLifestyle()});

 $$('.market-periods button').forEach(b=>b.onclick=()=>{state.marketPeriod=b.dataset.marketPeriod;syncMarketControls();renderMarkets()});
 $$('.market-symbols button').forEach(b=>b.onclick=()=>{state.marketSymbol=b.dataset.marketSymbol;syncMarketControls();renderMarkets()});
 $$('.live-symbols button').forEach(b=>b.onclick=()=>{state.liveMarketSymbol=b.dataset.liveMarket;renderTradingViewLive(state.liveMarketSymbol)});
 $$('.ai-coach-q').forEach(b=>b.onclick=()=>askMarketCoach(b.dataset.coachQ||'overview'));
 $('#aiCoachAskBtn')?.addEventListener('click',()=>askMarketCoach('custom'));
 $('#aiCoachStopBtn')?.addEventListener('click',stopMarketCoach);
 $('#aiCoachQuestion')?.addEventListener('keydown',e=>{if(e.key==='Enter')askMarketCoach('custom')});
 let marketResizeTimer;window.addEventListener('resize',()=>{applyDesktopScale();clearTimeout(marketResizeTimer);marketResizeTimer=setTimeout(renderMarkets,120)});
}


function syncMarketControls(){
 $$('.market-periods button').forEach(b=>b.classList.toggle('active',b.dataset.marketPeriod===state.marketPeriod));
 $$('.market-symbols button').forEach(b=>b.classList.toggle('active',b.dataset.marketSymbol===state.marketSymbol));
}
function marketSeries(symbol){return state.markets?.series?.[symbol]||DEMO_MARKETS.series[symbol]}
function periodPoints(series,period){
 const pts=(series?.points||[]).filter(x=>Number.isFinite(Number(x.value)));if(!pts.length)return [];
 const days={ '1w':7,'1m':31,'3m':93,'1y':366}[period]||31;const last=new Date(pts[pts.length-1].date+'T00:00:00');const cutoff=new Date(last);cutoff.setDate(cutoff.getDate()-days);
 return pts.filter(x=>new Date(x.date+'T00:00:00')>=cutoff);
}
function marketFormat(symbol,value){if(!Number.isFinite(value))return '--';return symbol==='NIKKEI'?Math.round(value).toLocaleString('ja-JP')+'円':value.toFixed(2)+'円'}
function marketChange(points,symbol){
 if(points.length<2)return {text:'--',cls:''};const first=Number(points[0].value),last=Number(points[points.length-1].value),diff=last-first,pct=first?diff/first*100:0;const sign=diff>0?'+':'';return {text:`${sign}${symbol==='NIKKEI'?Math.round(diff).toLocaleString('ja-JP'):diff.toFixed(2)} (${sign}${pct.toFixed(2)}%)`,cls:diff>0?'is-up':diff<0?'is-down':''};
}
function renderMarkets(){
 if(!state.markets)state.markets=DEMO_MARKETS;syncMarketControls();
 const source=state.markets.sourceMode||'DEMO', live=source!=='DEMO';
 const sourceLabel=x=>x==='TWELVE_DATA'?'Twelve Data':x==='FRED'?'FRED':x==='MIXED'?'複数ソース':'デモ';
 ['NIKKEI','USDJPY'].forEach(symbol=>{
  const s=marketSeries(symbol),pts=periodPoints(s,state.marketPeriod),last=pts.at(-1),chg=marketChange(pts,symbol),isN=symbol==='NIKKEI',src=s?.source||source;
  const valueEl=$(isN?'#homeNikkeiValue':'#homeUsdJpyValue'),changeEl=$(isN?'#homeNikkeiChange':'#homeUsdJpyChange'),badge=$(isN?'#homeNikkeiBadge':'#homeUsdJpyBadge'),chart=$(isN?'#homeNikkeiChart':'#homeUsdJpyChart');
  if(valueEl)valueEl.textContent=last?marketFormat(symbol,Number(last.value)):'--';if(changeEl){changeEl.textContent=chg.text;changeEl.className=chg.cls}if(badge){badge.textContent=last?`${sourceLabel(src)}・${formatMarketDate(last.date)}`:sourceLabel(src);badge.classList.toggle('live',src==='TWELVE_DATA');badge.classList.toggle('stale',src==='FRED')}
  const homeCard=valueEl?.closest('.market-card');if(homeCard){homeCard.classList.remove('market-up','market-down','market-flat');homeCard.classList.add(chg.cls==='is-up'?'market-up':chg.cls==='is-down'?'market-down':'market-flat')}
  if(chart)drawMarketChart(chart,pts,symbol,true);
 });
 const n=marketSeries('NIKKEI'),u=marketSeries('USDJPY'),np=n?.points?.at(-1),up=u?.points?.at(-1);
 const cap=$('#homeMarketCaption');if(cap){if(source==='DEMO')cap.textContent='デモではサンプル値を表示します。';else cap.textContent=`日経平均：${sourceLabel(n?.source||source)} 基準日 ${np?formatMarketDate(np.date):'--'} ／ ドル円：${sourceLabel(u?.source||source)} 基準日 ${up?formatMarketDate(up.date):'--'}。FREDは公表元の更新待ちになることがあります。`}
 const badge=$('#marketSourceBadge');if(badge)badge.textContent=source==='TWELVE_DATA'?'Twelve Data・最新市場データ':source==='FRED'?'FRED・公表日次データ':source==='MIXED'?'市場データ・複数ソース':'デモデータ';
 const symbol=state.marketSymbol,s=marketSeries(symbol),pts=periodPoints(s,state.marketPeriod),vals=pts.map(x=>Number(x.value)),last=pts.at(-1),chg=marketChange(pts,symbol);
 const detailSrc=s?.source||source;if($('#detailMarketSource'))$('#detailMarketSource').textContent='データ源：'+sourceLabel(detailSrc)+(last?' ｜ '+formatMarketDate(last.date):'');
 if($('#detailMarketLabel'))$('#detailMarketLabel').textContent=s?.label||symbol;if($('#detailMarketName'))$('#detailMarketName').textContent=s?.name||symbol;if($('#detailMarketValue'))$('#detailMarketValue').textContent=last?marketFormat(symbol,Number(last.value)):'--';
 const c=$('#detailMarketChange');if(c){c.textContent=chg.text;c.className=chg.cls}
 const detailCard=$('.market-detail');if(detailCard){detailCard.classList.remove('market-up','market-down','market-flat');detailCard.classList.add(chg.cls==='is-up'?'market-up':chg.cls==='is-down'?'market-down':'market-flat')}
 if($('#detailHigh'))$('#detailHigh').textContent=vals.length?marketFormat(symbol,Math.max(...vals)):'--';if($('#detailLow'))$('#detailLow').textContent=vals.length?marketFormat(symbol,Math.min(...vals)):'--';if($('#detailDate'))$('#detailDate').textContent=last?formatMarketDate(last.date):'--';
 if($('#detailStartLabel'))$('#detailStartLabel').textContent=pts[0]?formatMarketDate(pts[0].date):'';if($('#detailEndLabel'))$('#detailEndLabel').textContent=last?formatMarketDate(last.date):'';if($('#detailMarketChart'))drawMarketChart($('#detailMarketChart'),pts,symbol,false);
}
function formatMarketDate(d){try{return new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric'}).format(new Date(d+'T00:00:00'))}catch{return d}}
function drawMarketChart(el,points,symbol,mini){
 if(!el)return;if(!points||points.length<2){el.innerHTML='<div class="chart-empty">データがありません</div>';return}
 const W=700,H=mini?170:310,pad=mini?12:34,vals=points.map(p=>Number(p.value)),min0=Math.min(...vals),max0=Math.max(...vals),spread=Math.max(max0-min0,Math.abs(max0)*.002,1),min=min0-spread*.12,max=max0+spread*.12;
 const xy=points.map((p,i)=>{const x=pad+(W-pad*2)*(i/(points.length-1)),y=pad+(H-pad*2)*(1-(Number(p.value)-min)/(max-min));return [x,y]});const path=xy.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' '),area=path+` L ${xy.at(-1)[0].toFixed(1)} ${(H-pad).toFixed(1)} L ${xy[0][0].toFixed(1)} ${(H-pad).toFixed(1)} Z`,gid='g'+Math.random().toString(36).slice(2,8);const last=xy.at(-1);
 const grid=mini?'':[.25,.5,.75].map(r=>`<line x1="${pad}" x2="${W-pad}" y1="${(pad+(H-2*pad)*r).toFixed(1)}" y2="${(pad+(H-2*pad)*r).toFixed(1)}" class="chart-grid-line"/>`).join('');
 el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(symbol==='NIKKEI'?'日経平均':'ドル円')} ${esc(state.marketPeriod)} の値動き"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="currentColor" stop-opacity=".18"/><stop offset="100%" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#${gid})"/><path d="${path}" class="market-line"/><circle cx="${last[0]}" cy="${last[1]}" r="${mini?4:5}" class="market-dot"><title>${esc(points.at(-1).date)} ${esc(marketFormat(symbol,Number(points.at(-1).value)))}</title></circle>${mini?'':`<text x="${pad}" y="18" class="chart-label">${esc(marketFormat(symbol,max0))}</text><text x="${pad}" y="${H-8}" class="chart-label">${esc(marketFormat(symbol,min0))}</text>`}</svg>`;
}

function setTradingViewSymbolParam_(symbol){
 try{
  const u=new URL(location.href);
  if(u.searchParams.get('tvwidgetsymbol')!==symbol){
   u.searchParams.set('tvwidgetsymbol',symbol);
   history.replaceState({},'',u.pathname+u.search+u.hash);
  }
 }catch(e){}
}
function renderTradingViewLive(symbol){
 const el=$('#tradingviewLiveChart');if(!el)return;
 const key=symbol==='USDJPY'?'USDJPY':'NIKKEI';state.liveMarketSymbol=key;
 $$('.live-symbols button').forEach(b=>b.classList.toggle('active',b.dataset.liveMarket===key));

 const cfg=key==='USDJPY'
  ?{symbol:'FX_IDC:USDJPY',title:'USD/JPY',credit:'USD/JPY'}
  :{symbol:'TVC:NI225',title:'日経225',credit:'Japan 225'};

 // TradingViewは単一銘柄ウィジェットで tvwidgetsymbol を優先できるため、
 // ページ側のパラメータも現在選択中の銘柄へ同期してAAPL既定値への落下を防ぐ。
 setTradingViewSymbolParam_(cfg.symbol);

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
 const creditHref=key==='USDJPY'
  ?'https://www.tradingview.com/symbols/USDJPY/?exchange=FX_IDC'
  :'https://www.tradingview.com/symbols/TVC-NI225/';
 credit.innerHTML='<a href="'+creditHref+'" rel="noopener nofollow" target="_blank">'+esc(cfg.credit)+' chart</a><span>&nbsp;by TradingView</span>';
 wrap.appendChild(credit);

 const config={
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
  hide_top_toolbar:false,
  hide_legend:false,
  hide_volume:false,
  save_image:false,
  withdateranges:false,
  backgroundColor:'rgba(7,17,28,1)',
  gridColor:'rgba(38,57,77,0.35)',
  watchlist:[],
  compareSymbols:[],
  studies:[]
 };

 const script=document.createElement('script');
 script.type='text/javascript';
 script.async=true;
 // 先に設定JSONを入れ、その後にsrcを指定してからDOMへ追加する。
 // TradingView公式の埋め込みコードと同じ構造にする。
 script.innerHTML=JSON.stringify(config);
 script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

 script.onerror=()=>{
  el.innerHTML='<div class="live-chart-loading">TradingViewを読み込めませんでした。通信状態を確認してください。</div>';
 };

 el.innerHTML='';
 el.appendChild(wrap);
 wrap.appendChild(script);
}


function coachQuestionText(kind){
 const custom=$('#aiCoachQuestion')?.value.trim()||'';
 const map={overview:'このチャートの意味と、初心者が最初に見る場所を説明してください。',move:'現在の値動きを初心者向けにどう見ればよいですか？ 上昇・下降・横ばい、急変、注意点を教えてください。',terms:'ローソク足、30分足、出来高、始値・高値・安値・終値をこの画面に沿って説明してください。',news:'今日のニュースとこの市場の値動きをどう結び付けて考えればよいですか？'};
 return kind==='custom'?(custom||'このチャートを初心者向けに説明してください。'):(map[kind]||map.overview);
}
function coachLocalContext(){
 const symbol=state.liveMarketSymbol||state.marketSymbol||'NIKKEI',s=marketSeries(symbol),pts=periodPoints(s,state.marketPeriod||'1m'),last=pts.at(-1),first=pts[0],chg=marketChange(pts,symbol);
 const vals=pts.map(x=>Number(x.value)).filter(Number.isFinite),firstNum=Number(first?.value),lastNum=Number(last?.value),pct=firstNum?((lastNum-firstNum)/firstNum*100):0;
 return {symbol,name:s?.name||symbol,period:state.marketPeriod||'1m',source:s?.source||state.markets?.sourceMode||'DEMO',lastDate:last?.date||'',lastValue:last?.value??'',firstValue:first?.value??'',periodHigh:vals.length?Math.max(...vals):'',periodLow:vals.length?Math.min(...vals):'',periodPct:Number.isFinite(pct)?pct.toFixed(3):'0',change:chg.text,topNews:(state.data?.news||[]).slice(0,5).map(n=>({title:n.title,summary:n.summary,why:n.why,impact:n.impact,region:n.region}))};
}
function fallbackCoachAnswer(kind){
 const c=coachLocalContext(),name=c.name||'この市場';
 const title=kind==='terms'?'チャート用語をまず4つだけ覚えましょう':kind==='news'?'ニュースと値動きを結び付ける見方':name+'のチャートは「方向・急変・出来高」の順で見ます';
 const summary=kind==='terms'?'ローソク足は一定時間の値動きを1本にまとめたものです。30分足なら1本が30分です。緑・赤などの色は上昇/下降を示しますが、色の定義はチャート設定で変わることがあります。':kind==='news'?'値動きの後から都合のよいニュースを1つだけ選ばず、金利・中央銀行・物価・景気・地政学の複数材料を確認します。ニュースは「原因候補」であって、1本の記事だけで相場を断定しません。':`${name}は、まず左から右へ価格が全体として上がっているか下がっているかを見ます。次に急に大きく動いた場所、最後にその時の出来高が増えているかを確認します。`;
 return {ok:true,mode:'RULE',title,summary,lookAt:['全体の方向（上昇・下降・横ばい）','急に大きく動いた時間帯','出来高が普段より増えた場所'],terms:kind==='terms'?['ローソク足＝一定時間の始値・高値・安値・終値','30分足＝1本のローソクが30分','出来高＝その時間帯の取引の多さ','ヒゲ＝その時間内につけた高値・安値']:['時間足を変えると見える流れも変わる','短期の1本だけで判断しない'],caution:'これは学習用の説明で、売買を推奨するものではありません。'};
}
function renderCoachAnswer(d){
 const el=$('#aiCoachAnswer');if(!el)return;
 const look=(d.lookAt||[]).map(x=>`<li>${esc(x)}</li>`).join(''),terms=(d.terms||[]).map(x=>`<li>${esc(x)}</li>`).join('');
 el.innerHTML=`<div class="ai-answer-title">${esc(d.title||'AI先生の解説')}</div><div class="ai-answer-summary">${esc(d.summary||'')}</div><div class="ai-answer-grid"><div class="ai-answer-box"><b>まず見るところ</b><ul>${look||'<li>全体の方向を確認</li>'}</ul></div><div class="ai-answer-box"><b>今日覚えること</b><ul>${terms||'<li>分からない用語は1つずつでOK</li>'}</ul></div></div>${d.caution?`<div class="ai-answer-box" style="margin-top:9px"><b>注意</b><span>${esc(d.caution)}</span></div>`:''}`;
 // AI先生の回答はinnerHTMLで後から差し替わるため、回答生成直後に読み上げ操作を付け直す。
 delete el.dataset.readAloudReady;
 enhanceReadableText(el);
 const st=$('#aiCoachStatus');if(st){st.textContent=d.mode==='AI'?'Gemini AI解説':'基本解説';st.classList.toggle('ai-live',d.mode==='AI')}
}
function setCoachBusy(busy){
 state.coachBusy=!!busy;
 $$('.ai-coach-q').forEach(b=>b.disabled=!!busy);
 const ask=$('#aiCoachAskBtn'),stop=$('#aiCoachStopBtn'),input=$('#aiCoachQuestion');
 if(ask){ask.disabled=!!busy;ask.textContent=busy?'AI先生が回答中…':'AI先生に聞く'}
 if(input)input.disabled=!!busy;
 if(stop)stop.hidden=!busy;
 const st=$('#aiCoachStatus');if(st&&busy){st.textContent='AI解説中';st.classList.remove('ai-live')}
}
function stopMarketCoach(){
 if(!state.coachBusy)return;
 const cancel=state.coachCancel;state.coachCancel=null;
 if(typeof cancel==='function'){try{cancel()}catch(e){console.warn('coach cancel',e)}}
 setCoachBusy(false);
 const st=$('#aiCoachStatus');if(st){st.textContent='基本解説・AI停止';st.classList.remove('ai-live')}
 const el=$('#aiCoachAnswer');if(el){const note=document.createElement('div');note.className='ai-coach-stop-note';note.textContent='■ Geminiの追加解説を停止しました。上の基本解説はそのまま利用できます。';el.prepend(note)}
 toast('Geminiの追加解説を停止しました');
}
function askMarketCoach(kind='overview'){
 const el=$('#aiCoachAnswer');if(!el)return;
 const q=coachQuestionText(kind);if(kind==='custom'&&!q.trim())return toast('質問を入力してください');
 if(state.coachBusy)stopMarketCoach();
 // まず基本解説を即表示。Gemini接続に失敗しても学習は続けられる。
 const base=fallbackCoachAnswer(kind);renderCoachAnswer(base);
 const st0=$('#aiCoachStatus');if(st0){st0.textContent='基本解説・Gemini確認中';st0.classList.remove('ai-live')}
 if(!state.backend||!state.syncToken){toast('基本解説を表示しました');return}
 setCoachBusy(true);
 let networkCancel=null,hardTimer=null,settled=false;
 const endWait=(label)=>{if(settled)return;settled=true;if(hardTimer)clearTimeout(hardTimer);if(typeof networkCancel==='function'){try{networkCancel()}catch(e){}}state.coachCancel=null;setCoachBusy(false);const st=$('#aiCoachStatus');if(st){st.textContent=label;st.classList.toggle('ai-live',label==='Gemini AI解説')}};
 const fail=err=>{if(settled)return;console.warn('market coach',err);endWait('基本解説');toast('Gemini追加解説を取得できませんでした。基本解説を表示しています')};
 const finish=d=>{if(settled)return;if(!d||d.ok===false){fail(new Error(d?.error||'AI解説を取得できませんでした'));return}settled=true;if(hardTimer)clearTimeout(hardTimer);state.coachCancel=null;setCoachBusy(false);renderCoachAnswer(d)};
 // どの段階で例外が起きても、10秒で必ず待機UIを解除する。
 hardTimer=setTimeout(()=>fail(new Error('coach-hard-timeout')),10000);
 try{
  const ctx=coachLocalContext();
  const url=backendActionUrl('marketCoach',{symbol:ctx.symbol,name:ctx.name,period:ctx.period,source:ctx.source,lastDate:ctx.lastDate,lastValue:ctx.lastValue,firstValue:ctx.firstValue,periodHigh:ctx.periodHigh,periodLow:ctx.periodLow,periodPct:ctx.periodPct,question:q});
  networkCancel=jsonp(url,finish,fail,9000);
  state.coachCancel=()=>{if(settled)return;settled=true;if(hardTimer)clearTimeout(hardTimer);if(typeof networkCancel==='function'){try{networkCancel()}catch(e){}}};
 }catch(err){
  console.error('market coach setup',err);
  fail(err);
 }
}

function backendActionUrl(action,params={}){
 const base=String(state.backend||'').trim();
 if(!base)throw new Error('GAS WebアプリURLが未設定です');
 const q=new URLSearchParams();
 q.set('action',String(action||''));
 if(state.syncToken)q.set('token',state.syncToken);
 Object.entries(params||{}).forEach(([k,v])=>{
  if(v===undefined||v===null)return;
  q.set(k,String(v));
 });
 return base+(base.includes('?')?'&':'?')+q.toString();
}

function fetchMarkets(fromRefresh=false){
 if(!state.backend){if(!state.markets)state.markets=DEMO_MARKETS;renderMarkets();return}
 const sep=state.backend.includes('?')?'&':'?';
 gasRequest(state.backend+sep+'action=markets&token='+encodeURIComponent(state.syncToken),data=>{
  if(!data||data.ok===false||!data.series)throw new Error(data?.error||'市場データ取得失敗');
  state.markets=data;renderMarkets();
  if(state.lastSync)setApiStatus('live');
  setRefreshButton('live');
  if(fromRefresh){setLastUpdated(data.generatedAt||new Date(),'ok');toast('市場データを更新しました')}
 },err=>{
  console.warn('market data',err);
  // 実データを一度でも取得済みなら保持。デモへの強制巻き戻しをしない。
  if(!state.markets)state.markets=DEMO_MARKETS;
  renderMarkets();setRefreshButton('live');
  if(fromRefresh)toast('市場データは前回値を維持しました');
 },25000);
}

function renderData(data){state.data=data||DEMO;renderPulse();renderNews();renderLifestyle();renderBrief();renderCause();renderBriefHistory();}
function renderPulse(){const d=state.data||DEMO;$('#pulseGrid').innerHTML=d.pulse.map(x=>`<article class="pulse"><div class="eyebrow">${esc(x.name)}</div><div class="value tone-${x.tone||'neutral'}">${esc(x.value)}</div><small>${esc(x.note||'')}</small></article>`).join('')}
function newsCard(n,i){const official=n.official?'<span class="official-badge">公式一次情報</span>':'';return `<article class="news-card"><span class="rank">${i+1}</span><div class="news-meta"><b>${esc(n.region||'世界')}</b><span>重要度 ${'★'.repeat(Math.min(5,n.importance||3))}</span>${official}</div><h3>${esc(n.title)}</h3><p>${esc(n.summary||'')}</p><div class="impact">${(n.impact||[]).map(x=>`<span>${esc(x)}</span>`).join('')}</div><div class="news-ai-actions"><button class="ghost news-ai-btn" data-news-index="${i}">✨ AIでもっと分かりやすく</button></div><div class="news-ai-answer" data-news-answer-index="${i}" hidden></div></article>`}
function renderNews(){const d=state.data||DEMO;const all=d.news||[];$('#topNews').innerHTML=all.slice(0,5).map((n,i)=>newsCard(n,i)).join('');const f=state.filter;const rows=all.map((n,idx)=>({n,idx})).filter(x=>f==='all'||x.n.region===f||(x.n.impact||[]).includes(f));$('#newsList').innerHTML=rows.map(({n,idx})=>`<article class="news-row"><div class="importance level-${Math.max(1,Math.min(5,n.importance||3))}"><strong>重要度</strong><span class="importance-stars">${'★'.repeat(Math.max(1,Math.min(5,n.importance||3)))}${'☆'.repeat(5-Math.max(1,Math.min(5,n.importance||3)))}</span><em>${importanceLabel(n.importance||3)}</em></div><div><div class="news-meta"><b>${esc(n.region||'世界')}</b><span>${esc(n.source||'')}</span>${n.official?'<span class="official-badge">公式一次情報</span>':''}</div><h3>${esc(n.title)}</h3><p>${esc(n.summary||'')}</p><p><b>なぜ重要？</b> ${esc(n.why||'市場への影響を自分で考えてみましょう。')}</p><div class="impact">${(n.impact||[]).map(x=>`<span>${esc(x)}</span>`).join('')}</div><div class="news-ai-actions"><button class="ghost news-ai-btn" data-news-index="${idx}">✨ このニュースをAI先生に聞く</button></div><div class="news-ai-answer" data-news-answer-index="${idx}" hidden></div></div><div>${n.url&&n.url!=='#'?`<a href="${safeUrl(n.url)}" target="_blank" rel="noopener">原文 ↗</a>`:''}</div></article>`).join('')||'<article class="panel">該当ニュースはありません。</article>'}

function setNewsExplainBusy(idx,busy){
 $$(`.news-ai-btn[data-news-index="${idx}"]`).forEach(b=>{b.disabled=busy;b.textContent=busy?'AI先生が整理中…':(b.closest('.news-card')?'✨ AIでもっと分かりやすく':'✨ このニュースをAI先生に聞く')});
}
function newsExplainFallback(n){return {ok:true,mode:'RULE',title:'このニュースを3段階で理解',simple:n?.summary||'まず「何が起きたか」を確認します。',background:n?.why||'次に、金利・物価・景気・企業利益のどこにつながるかを考えます。',chain:['ニュースの事実を確認','景気・物価・金利への波及を見る',(n?.impact||[]).length?'影響候補：'+n.impact.join('・'):'市場が実際にどう反応したか確認'],terms:[],checkNext:'原文と市場チャートを見て、予想と実際の反応が一致したか確認してください。',caution:'1本のニュースだけで売買方向を断定しません。'} }
function renderNewsExplain(idx,d){
 const chain=(d.chain||[]).map(x=>`<li>${esc(x)}</li>`).join('');
 const terms=(d.terms||[]).map(x=>typeof x==='string'?`<li>${esc(x)}</li>`:`<li><b>${esc(x.term||'')}</b> ${esc(x.meaning||'')}</li>`).join('');
 const html=`<div class="ai-answer-title">${esc(d.title||'AI先生の解説')}</div><div class="ai-answer-summary"><b>一言でいうと：</b> ${esc(d.simple||'')}</div><div class="ai-answer-box"><b>背景</b><span>${esc(d.background||'')}</span></div>${chain?`<div class="ai-answer-box"><b>どうつながる？</b><ol>${chain}</ol></div>`:''}${terms?`<div class="ai-answer-box"><b>今日覚える用語</b><ul>${terms}</ul></div>`:''}<div class="ai-answer-box"><b>次に確認</b><span>${esc(d.checkNext||'')}</span></div><div class="ai-answer-box caution"><b>注意</b><span>${esc(d.caution||'売買を断定せず、反対材料も確認します。')}</span></div><small class="ai-mode-note">${d.mode==='AI'?'Geminiによる追加解説':'基本解説'}</small>`;
 $$(`[data-news-answer-index="${idx}"]`).forEach(el=>{el.hidden=false;el.innerHTML=html;enhanceReadableText(el)});
}
function askNewsExplain(idx){
 const n=(state.data?.news||DEMO.news||[])[idx];if(!n)return;
 renderNewsExplain(idx,newsExplainFallback(n));
 if(!state.backend||!state.syncToken){toast('基本解説を表示しました。GAS接続後はGeminiで詳しく説明します');return}
 setNewsExplainBusy(idx,true);
 const url=gasUrl('newsExplain',{index:idx,row:state.historySelectedRow||''});
 gasRequest(url,d=>{setNewsExplainBusy(idx,false);if(!d||d.ok===false)throw new Error(d?.error||'AI解説失敗');renderNewsExplain(idx,d)},err=>{console.warn('news explain',err);setNewsExplainBusy(idx,false);toast('Gemini追加解説は取得できませんでした。基本解説を表示しています')},22000);
}

function learningFeedCards(rows,limit){
 const list=(rows||[]).slice(0,limit||rows.length);
 return list.length?list.map((x,i)=>`<article class="learning-feed-card"><div class="learning-feed-meta"><span class="source-kind">${esc(x.source||'公式')}</span><span>${esc(x.publishedLabel||x.published||'')}</span></div><h3>${esc(x.title||'')}</h3>${x.description?`<p>${esc(String(x.description).slice(0,180))}</p>`:''}<div class="hero-actions"><a class="ghost" href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">動画を見る ↗</a><button class="primary small" data-learning-pick="${i}">AI分析へ送る</button></div></article>`).join(''):'';
}
function renderLearningFeed(){
 const rows=state.learningFeed||[],page=$('#learningFeedList'),home=$('#homeLearningFeed');
 if(page)page.innerHTML=learningFeedCards(rows,12)||'<article class="panel">新しい公式動画を取得できませんでした。固定の公式リンクはそのまま利用できます。</article>';
 if(home)home.innerHTML=learningFeedCards(rows,3)||'<article class="panel">GAS接続後、朝・昼・夜の更新時に公式YouTube候補を自動収集します。</article>';
}
function fetchLearningFeed(force=false){
 const page=$('#learningFeedList'),home=$('#homeLearningFeed'),b=$('#learningFeedRefreshBtn');
 if(!state.backend||!state.syncToken){if(page)page.innerHTML='<article class="panel">GAS接続後に最新動画を取得できます。</article>';if(home)home.innerHTML='<article class="panel">GAS接続後、公式YouTube候補を自動収集します。</article>';return}
 if(!force&&state.learningFeed.length&&Date.now()-state.learningFeedFetchedAt<30*60*1000){renderLearningFeed();return}
 if(b){b.disabled=true;b.textContent='取得中…'};if(page)page.innerHTML='<article class="panel">日本銀行・財務省・金融庁・J-FLEC・JPX・IMFから最新動画を確認しています…</article>';
 gasRequest(gasUrl('learningFeed',{force:force?'1':'0'}),d=>{if(b){b.disabled=false;b.textContent='↻ 今すぐ動画更新'};if(!d||d.ok===false)throw new Error(d?.error||'取得失敗');state.learningFeed=d.items||[];state.learningFeedFetchedAt=Date.now();renderLearningFeed();if(force)toast('公式YouTube学習情報を更新しました')},err=>{console.warn('learning feed',err);if(b){b.disabled=false;b.textContent='↻ 今すぐ動画更新'};if(page)page.innerHTML='<article class="panel">公式動画の取得に失敗しました。固定の公式リンクはそのまま利用できます。</article>';if(home)home.innerHTML='<article class="panel">YouTube自動収集を確認できませんでした。</article>';if(force)toast('学習動画を取得できませんでした')},26000);
}
function renderLearningAnalysis(d){
 const el=$('#learningAnalysisResult');if(!el)return;
 const kp=(d.keyPoints||[]).map(x=>`<li>${esc(x)}</li>`).join('');
 const terms=(d.terms||[]).map(x=>typeof x==='string'?`<li>${esc(x)}</li>`:`<li><b>${esc(x.term||'')}</b> ${esc(x.meaning||'')}</li>`).join('');
 const con=(d.connections||[]).map(x=>`<li>${esc(x)}</li>`).join('');
 const qs=(d.nextQuestions||[]).map(x=>`<li>${esc(x)}</li>`).join('');
 el.innerHTML=`<div class="ai-answer-title">${esc(d.title||'学習情報のAI分析')}</div><div class="ai-answer-summary">${esc(d.summary||'')}</div><div class="learning-result-grid"><div class="ai-answer-box"><b>要点</b><ul>${kp}</ul></div><div class="ai-answer-box"><b>今日のニュース・相場との接続</b><ul>${con}</ul></div><div class="ai-answer-box"><b>用語</b><ul>${terms}</ul></div><div class="ai-answer-box"><b>次に考える質問</b><ul>${qs}</ul></div></div><div class="ai-answer-box"><b>情報の見方</b><span>${esc(d.reliability||'一次情報か、意見・解説かを区別して確認します。')}</span></div>${d.limitation?`<div class="ai-answer-box caution"><b>分析上の制限</b><span>${esc(d.limitation)}</span></div>`:''}`;
 enhanceReadableText(el);
}
function analyzeLearningResource(){
 const raw=$('#learningUrl')?.value.trim()||'',note=($('#learningNote')?.value||'').trim().slice(0,1200);if(!raw)return toast('動画または記事のURLを入力してください');
 try{new URL(raw)}catch{return toast('URLの形式を確認してください')}
 if(!state.backend||!state.syncToken){toast('この機能はGAS接続後に使えます');showPage('settings');return}
 const b=$('#analyzeLearningBtn');if(b){b.disabled=true;b.textContent='AI分析中…'};const el=$('#learningAnalysisResult');if(el)el.innerHTML='<div class="ai-coach-placeholder"><b>分析中</b><span>要点・用語・ニュースとの関係を整理しています…</span></div>';
 const url=gasUrl('learningAnalyze',{url:raw,note});
 gasRequest(url,d=>{if(b){b.disabled=false;b.textContent='✨ AIで分析する'};if(!d||d.ok===false)throw new Error(d?.error||'分析失敗');renderLearningAnalysis(d);toast('学習情報をAIで整理しました')},err=>{console.warn('learning analyze',err);if(b){b.disabled=false;b.textContent='✨ AIで分析する'};if(el)el.innerHTML='<div class="ai-coach-placeholder"><b>分析できませんでした</b><span>記事側のアクセス制限やURL形式の可能性があります。YouTubeは字幕・要点を補足メモへ貼って再試行してください。</span></div>';toast('AI分析に失敗しました')},30000);
}
function latestMarketSnapshot(){
 return ['NIKKEI','USDJPY'].map(symbol=>{const s=marketSeries(symbol),pts=periodPoints(s,state.marketPeriod||'1m'),last=pts.at(-1),chg=marketChange(pts,symbol);return `${s?.name||symbol}: ${last?marketFormat(symbol,Number(last.value)):'--'} / ${chg.text}`}).join('\n');
}
function buildChatgptDecisionPrompt(){
 const news=(state.data?.news||DEMO.news||[]).slice(0,5);const usdChoice=state.choices.USDJPY||'未選択',nikChoice=state.choices.NIKKEI||'未選択';const usdReason=$('#reasonUSDJPY')?.value.trim()||'未記入',nikReason=$('#reasonNIKKEI')?.value.trim()||'未記入';
 return `あなたは私の投資学習の最終レビュアーです。売買を断定せず、私の思い込みを検証してください。\n\n【今日の重要ニュースTOP5】\n${news.map((n,i)=>`${i+1}. ${n.title}\n   概要: ${n.summary||''}\n   重要な理由: ${n.why||''}`).join('\n')}\n\n【市場の参考値】\n${latestMarketSnapshot()}\n\n【私の予想】\nドル円: ${usdChoice}\n理由: ${usdReason}\n日経平均: ${nikChoice}\n理由: ${nikReason}\n\n【お願い】\n1. 私の予想を支持する材料と反対する材料を分けてください。\n2. ニュース間の因果関係を、金利→為替→企業利益→株価のようにつないでください。\n3. 私が見落としている可能性が高い材料を3つ挙げてください。\n4. 「上がる/下がる」と断定せず、強気・中立・弱気の3シナリオで考えてください。\n5. 明日答え合わせするときに確認すべき数字・ニュースを挙げてください。\n6. 私の判断プロセスを100点満点ではなく、良い点・改善点として評価してください。\n\nこれは学習目的です。具体的な売買注文や投資額の指示ではなく、判断の質を高めるためのレビューをしてください。`;
}
function openChatgptWithPrompt(){
 const t=$('#chatgptPromptPreview')?.value.trim()||buildChatgptDecisionPrompt();if($('#chatgptPromptPreview'))$('#chatgptPromptPreview').value=t;
 // ポップアップブロックを避けるため、クリック操作の中で先にChatGPTを開く。
 window.open('https://chatgpt.com/','_blank','noopener');
 if(navigator.clipboard?.writeText){navigator.clipboard.writeText(t).then(()=>toast('相談文をコピーしました。ChatGPTに貼り付けてください')).catch(()=>toast('ChatGPTを開きました。相談文は画面からコピーしてください'))}else toast('ChatGPTを開きました。相談文をコピーしてください');
}
function lifeCategoryLabel(x){
 const t=String(x||'暮らし');
 if(/温泉|旅館|ホテル|宿/.test(t))return '温泉';
 if(/旅|観光|ドライブ|道の駅/.test(t))return '旅';
 if(/食|地域|グルメ/.test(t))return '食・地域';
 return '暮らし';
}
function lifestyleCard(n){const cat=lifeCategoryLabel(n.category);return `<article class="lifestyle-card life-${esc(cat)}"><div class="lifestyle-meta"><span class="life-chip">${esc(cat==='温泉'?'温泉・宿':cat)}</span><span>${esc(n.source||'')}</span></div><h3>${esc(n.title||'')}</h3><p>${esc(n.summary||'')}</p>${n.url&&n.url!=='#'?`<a href="${safeUrl(n.url)}" target="_blank" rel="noopener">記事を見る ↗</a>`:''}</article>`}
function renderLifestyle(){
 const d=state.data||DEMO;const isDemo=d===DEMO||String(d.sourceMode||'').toUpperCase()==='DEMO';const all=(d.lifestyle||[]).length?d.lifestyle:(isDemo?DEMO.lifestyle:[]);
 const home=$('#homeLifestyle');if(home)home.innerHTML=all.length?all.slice(0,3).map(lifestyleCard).join(''):'<article class="lifestyle-empty">今日は「寄り道」のおすすめ記事がありません。良い記事がある日だけ表示します。</article>';
 const list=$('#lifestyleList');if(!list)return;const f=state.lifeFilter||'all';const rows=all.filter(n=>f==='all'||lifeCategoryLabel(n.category)===f);
 list.innerHTML=rows.map(lifestyleCard).join('')||'<article class="panel">今日はこのカテゴリの記事がありません。無理に埋めず、良い記事がある日だけ表示します。</article>';
}
function cleanRadioTextClient(text){
 let t=String(text||'').replace(/\r/g,'').trim();
 t=t.replace(/^```[^\n]*\n?/,'').replace(/```$/,'').trim();
 t=t.replace(/[（(【\[][^\n）)】\]]{0,80}(オープニング|エンディング|テーマ曲?|BGM|bgm|効果音|ジングル|音楽|SE|se)[^\n）)】\]]{0,80}[）)】\]]/g,'');
 t=t.replace(/^(?:はい[、, ]*)?(?:承知|了解)(?:いたしました|しました|です)[。！!、, ]*/,'');
 t=t.replace(/^「?MARKET COMPASS[^\n]{0,100}(?:編集者|原稿作家)[^\n]{0,100}[。！!]?」?[\n ]*/,'');
 t=t.replace(/^(?:以下|それでは)[^\n]{0,100}(?:原稿|ラジオ原稿|作成)[^\n]{0,100}[。！!]?[\n ]*/,'');
 t=t.split('\n').map(x=>x.trim()).filter(x=>!/^[-_*]{3,}$/.test(x)&&!/^(?:台本|原稿|オープニング|エンディング|ナレーション)[:：]/.test(x)).join('\n').replace(/\n{3,}/g,'\n\n').trim();
 const m=t.match(/(?:おはようございます。|こんにちは。|こんばんは。|MARKET COMPASS)/);if(m&&m.index>0&&m.index<350)t=t.slice(m.index).trim();
 return t;
}
function renderBrief(){
 const t=cleanRadioTextClient(state.data?.brief||DEMO.brief||'');const el=$('#briefText');if(!el)return;
 let paras=t.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
 if(paras.length<=1){const sentences=t.match(/[^。！？!?]+[。！？!?]?/g)||[t];paras=[];for(let i=0;i<sentences.length;i+=3)paras.push(sentences.slice(i,i+3).join('').trim())}
 el.innerHTML=paras.map(p=>`<p>${esc(p)}</p>`).join('');
 const meta=$('#radioMeta');if(meta){const ai=String(state.data?.radioMode||'').toUpperCase()==='AI';const when=state.data?.radioGeneratedAt?`・${formatClock(state.data.radioGeneratedAt)}作成`:'';const hist=state.historySelectedRow?(state.data?.historyLabel||'過去の更新')+'・':'';meta.textContent=hist+(ai?'✨ Gemini 2.5 Flashが重要ニュースを編集':'保存済み原稿を表示')+when;}
}

function initSpeechControls(){
 const savedRate=safeStorageGet('mc_speech_rate');if(savedRate&&$('#speechRate'))$('#speechRate').value=savedRate;
 initBrowserVoices();updateVoiceHint();
}
function initBrowserVoices(){
 if(!('speechSynthesis' in window)){updateVoiceHint();return}
 const load=()=>{
  const select=$('#speechVoice');if(!select)return;
  const voices=getJapaneseVoices();const saved=safeStorageGet('mc_speech_voice_browser')||'auto';
  select.innerHTML='<option value="auto">おすすめを自動選択</option>'+voices.map(v=>`<option value="${esc(v.name)}">${esc(formatVoiceName(v))}</option>`).join('');
  if([...select.options].some(o=>o.value===saved))select.value=saved;
  select.onchange=e=>{safeStorageSet('mc_speech_voice_browser',e.target.value);updateVoiceHint()};updateVoiceHint();
 };
 load();speechSynthesis.onvoiceschanged=load;setTimeout(load,350);
}
function getJapaneseVoices(){
 return speechSynthesis.getVoices().filter(v=>(v.lang||'').toLowerCase().startsWith('ja')).sort((a,b)=>voiceScore(b)-voiceScore(a)||a.name.localeCompare(b.name,'ja'));
}
function voiceScore(v){
 const n=(v.name||'').toLowerCase();let s=0;
 if(/natural|neural|premium|enhanced/.test(n))s+=100;
 if(/nanami|keita|sayaka|haruka|ayumi|google.*日本語|google.*japanese|kyoko/.test(n))s+=45;
 if(/online/.test(n))s+=20;if(v.default)s+=8;return s;
}
function formatVoiceName(v){const n=v.name||'日本語音声';const quality=/natural|neural|premium|enhanced/i.test(n)?' ★自然':voiceScore(v)>=45?' ★おすすめ':'';return `${n}${quality}`;}
function selectedVoice(){
 const voices=getJapaneseVoices();const selected=$('#speechVoice')?.value||'auto';
 if(selected!=='auto')return voices.find(v=>v.name===selected)||voices[0]||null;return voices[0]||null;
}
function updateVoiceHint(){
 const el=$('#voiceHint');if(!el)return;
 if(!('speechSynthesis' in window)){el.textContent='このブラウザは無料読み上げに対応していません。';return}
 const v=selectedVoice();el.textContent=v?`🔊 無料・即時再生：${v.name}（端末の日本語音声）`:'🔊 無料・即時再生：端末の標準日本語音声を使用します。';
}
function prepareSpeechText(text=''){
 return String(text).replace(/FRB/gi,'エフアールビー').replace(/FOMC/gi,'エフオーエムシー').replace(/ECB/gi,'イーシービー').replace(/CPI/gi,'シーピーアイ').replace(/GDP/gi,'ジーディーピー').replace(/FX/gi,'エフエックス').replace(/AI/gi,'エーアイ').replace(/USD\/?JPY/gi,'ドル円').replace(/％/g,'パーセント').replace(/%/g,'パーセント');
}
function splitSpeech(text){const cleaned=prepareSpeechText(text).replace(/\s+/g,' ').trim();const sentences=cleaned.match(/[^。！？!?]+[。！？!?]?/g)||[cleaned];return sentences.map(x=>x.trim()).filter(Boolean);}
function pauseForSentence(sentence,index){if(index===0)return 420;if(/^(次に|続いて|三つ目|最後に|そして|一方で|まず)/.test(sentence))return 430;if(/[！？!?]$/.test(sentence))return 330;return 210;}
function speechSettings(){return {voice:selectedVoice(),rate:parseFloat($('#speechRate')?.value||'0.9'),pitch:.96,volume:1};}
function toggleSpeech(){toggleBrowserSpeech();}
function toggleBrowserSpeech(){
 if(!('speechSynthesis'in window))return toast('このブラウザは読み上げに対応していません');
 if(speechSynthesis.speaking&&state.speechPaused){speechSynthesis.resume();state.speechPaused=false;$('#speakBtn').textContent='Ⅱ';updateMobileDock();return}
 if(speechSynthesis.speaking){speechSynthesis.pause();state.speechPaused=true;$('#speakBtn').textContent='▶';updateMobileDock();return}
 speakBrowserBrief();
}
function resetReadAloudButtons(){
 $$('.read-aloud-play').forEach(b=>{b.textContent='🔊 読み上げ';b.classList.remove('is-speaking','is-paused')});
 $$('.read-aloud-stop').forEach(b=>b.hidden=true);
}
function stopSpeech(){
 state.speechRun++;state.speechPaused=false;state.speechOwner=null;state.sectionSpeechEl=null;if('speechSynthesis'in window)speechSynthesis.cancel();if($('#speakBtn'))$('#speakBtn').textContent='▶';resetReadAloudButtons();updateMobileDock();
}
function speakBrowserBrief(){
 if(!('speechSynthesis'in window))return toast('このブラウザは読み上げに対応していません');
 stopSpeech();state.speechOwner='radio';const run=++state.speechRun;const parts=splitSpeech(cleanRadioTextClient(state.data?.brief||DEMO.brief));const settings=speechSettings();let i=0;$('#speakBtn').textContent='Ⅱ';
 const next=()=>{if(run!==state.speechRun)return;if(i>=parts.length){$('#speakBtn').textContent='▶';state.speechPaused=false;updateMobileDock();return}const sentence=parts[i];const idx=i++;const u=new SpeechSynthesisUtterance(sentence);u.lang='ja-JP';u.rate=settings.rate;u.pitch=settings.pitch;u.volume=settings.volume;if(settings.voice)u.voice=settings.voice;u.onend=()=>{if(run!==state.speechRun)return;setTimeout(next,pauseForSentence(sentence,idx))};u.onerror=e=>{if(e.error!=='canceled'&&e.error!=='interrupted')toast('読み上げを停止しました');$('#speakBtn').textContent='▶';updateMobileDock()};speechSynthesis.speak(u);updateMobileDock()};next();
}
function testVoice(){
 const sample='おはようございます。マーケットコンパスです。今日の世界経済と日本経済を、焦らず分かりやすく確認していきましょう。';
 if(!('speechSynthesis'in window))return toast('このブラウザは読み上げに対応していません');
 stopSpeech();const s=speechSettings();const u=new SpeechSynthesisUtterance(sample);u.lang='ja-JP';u.rate=s.rate;u.pitch=s.pitch;if(s.voice)u.voice=s.voice;speechSynthesis.speak(u);updateMobileDock();
}

function readableTextFromElement(el){
 if(!el)return '';
 const clone=el.cloneNode(true);
 clone.querySelectorAll('.read-aloud-controls,button,input,textarea,select,a,.ai-coach-disclaimer,.badge,.rank').forEach(n=>n.remove());
 return clone.innerText.replace(/\s+/g,' ').trim();
}
function speakReadableElement(el,playBtn,stopBtn){
 if(!('speechSynthesis' in window))return toast('このブラウザは読み上げに対応していません');
 if(state.speechOwner==='section'&&state.sectionSpeechEl===el&&speechSynthesis.speaking){
  if(state.speechPaused){speechSynthesis.resume();state.speechPaused=false;playBtn.textContent='⏸ 一時停止';playBtn.classList.remove('is-paused');playBtn.classList.add('is-speaking')}
  else{speechSynthesis.pause();state.speechPaused=true;playBtn.textContent='▶ 続きを聞く';playBtn.classList.add('is-paused')}
  return;
 }
 const text=readableTextFromElement(el);if(text.length<2)return toast('読み上げる文章がありません');
 stopSpeech();state.speechOwner='section';state.sectionSpeechEl=el;const run=++state.speechRun;const parts=splitSpeech(text);const settings=speechSettings();let i=0;
 playBtn.textContent='⏸ 一時停止';playBtn.classList.add('is-speaking');stopBtn.hidden=false;
 const finish=()=>{if(run!==state.speechRun)return;state.speechPaused=false;state.speechOwner=null;state.sectionSpeechEl=null;playBtn.textContent='🔊 読み上げ';playBtn.classList.remove('is-speaking','is-paused');stopBtn.hidden=true;updateMobileDock()};
 const next=()=>{if(run!==state.speechRun)return;if(i>=parts.length)return finish();const sentence=parts[i];const idx=i++;const u=new SpeechSynthesisUtterance(sentence);u.lang='ja-JP';u.rate=settings.rate;u.pitch=settings.pitch;u.volume=settings.volume;if(settings.voice)u.voice=settings.voice;u.onend=()=>{if(run!==state.speechRun)return;setTimeout(next,pauseForSentence(sentence,idx))};u.onerror=e=>{if(e.error!=='canceled'&&e.error!=='interrupted')toast('読み上げを停止しました');finish()};speechSynthesis.speak(u);updateMobileDock()};
 next();
}
function isReadableTarget(el){
 if(!el||el.dataset.readAloudReady==='1')return false;
 if(el.closest('#page-settings,#page-practice,#page-journal'))return false;
 const text=readableTextFromElement(el);return text.length>=28;
}
function addReadAloudControls(el){
 if(!isReadableTarget(el))return;
 el.dataset.readAloudReady='1';
 const box=document.createElement('div');box.className='read-aloud-controls';
 const play=document.createElement('button');play.type='button';play.className='read-aloud-play';play.textContent='🔊 読み上げ';
 const stop=document.createElement('button');stop.type='button';stop.className='read-aloud-stop';stop.textContent='■ 停止';stop.hidden=true;
 play.addEventListener('click',e=>{e.stopPropagation();speakReadableElement(el,play,stop)});
 stop.addEventListener('click',e=>{e.stopPropagation();stopSpeech()});
 box.append(play,stop);el.insertBefore(box,el.firstChild);
}
function enhanceReadableText(root=document){
 const selectors=['#aiCoachAnswer','#topNews .news-card','#newsList .news-row','#page-lifestyle .lifestyle-card','#page-lifestyle .lifestyle-note','#page-market .market-guide','#page-market .two-col .panel','#page-drivers .panel','#page-trade .broker-card','#page-trade .trade-guide','#page-learn .learning-source-card','#learningAnalysisResult','#roadmap .road-stage','#termGrid .term','#page-home .panel'];
 selectors.forEach(sel=>root.querySelectorAll?.(sel).forEach(addReadAloudControls));
 if(root.matches?.(selectors.join(',')))addReadAloudControls(root);
}
function initReadAloudControls(){
 enhanceReadableText(document);
 const obs=new MutationObserver(muts=>{for(const m of muts){m.addedNodes.forEach(n=>{if(n.nodeType===1)enhanceReadableText(n)})}});
 obs.observe(document.body,{childList:true,subtree:true});
}
function regenerateRadioScript(){
 if(!state.backend||!state.syncToken){toast('先にGAS接続を確認してください');showPage('settings');return}
 const b=$('#radioRefreshBtn');if(b){b.disabled=true;b.textContent='✨ AI原稿を作成中…'}
 const url=state.backend+(state.backend.includes('?')?'&':'?')+'action=radioScript&token='+encodeURIComponent(state.syncToken);
 gasRequest(url,data=>{
  if(!data||data.ok===false||!data.brief)throw new Error(data?.error||'原稿を作れませんでした');
  state.data={...(state.data||DEMO),brief:data.brief,radioMode:data.radioMode||'AI',radioGeneratedAt:data.radioGeneratedAt||new Date().toISOString()};renderBrief();toast('世界・日本経済の5分原稿を更新しました');
  if(b){b.disabled=false;b.textContent='✨ AIで原稿を作り直す'}
 },err=>{console.warn(err);toast('AI原稿の作成に失敗しました。前回原稿を維持します');if(b){b.disabled=false;b.textContent='✨ AIで原稿を作り直す'}},30000);
}
function renderCause(){const map=(state.data?.cause&&state.data.cause.length?state.data.cause:cause);$('#causeMap').innerHTML=map.map((x,i)=>`<div class="cause-node">${esc(x)}</div>${i<map.length-1?'<div class="arrow">→</div>':''}`).join('');$('#yenWeakList').innerHTML=['米国金利が相対的に上がる','日本より米国の金融引き締めが強い','日本から海外へ資金が向かいやすい','輸入企業などのドル需要が強い'].map(x=>`<li>${x}</li>`).join('');$('#yenStrongList').innerHTML=['日本金利が相対的に上がる','米国の利下げ期待が強まる','世界的なリスク回避で円買いが起きる局面','日本への資金還流が強まる'].map(x=>`<li>${x}</li>`).join('');
 // v1.9.11: 円安/円高材料は描画後に文章量が増えるため、ここで読み上げボタンを付け直す。
 ['#yenWeakList','#yenStrongList'].forEach(sel=>{const panel=$(sel)?.closest('.panel');if(!panel)return;panel.querySelector('.read-aloud-controls')?.remove();delete panel.dataset.readAloudReady;addReadAloudControls(panel)});
}
function renderRoadmap(){const done=Number(safeStorageGet('mc_term_count')||0);const current=done>18?2:1;$('#roadmap').innerHTML=roadmap.map(r=>`<article class="road-stage ${r.n===current?'current':''}"><div class="road-num">${r.n}</div><div><h3>${esc(r.title)}</h3><div class="eyebrow">目安 ${r.period}</div><ul>${r.items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div><span class="badge">${r.n<current?'修了':r.n===current?'現在地':'これから'}</span></article>`).join('')}
function renderTerms(){const learned=readStoredArray('mc_terms');const q=($('#termSearch')?.value||'').trim().toLowerCase();const list=terms.filter(t=>!q||t.join(' ').toLowerCase().includes(q));$('#termGrid').innerHTML=list.map(([name,desc])=>`<article class="term"><h3>${esc(name)}</h3><p>${esc(desc)}</p><button data-term="${esc(name)}" class="${learned.includes(name)?'done':''}">${learned.includes(name)?'✓ 覚えた':'覚えた'}</button></article>`).join('');$$('#termGrid button').forEach(b=>b.onclick=()=>toggleTerm(b.dataset.term));}
function toggleTerm(name){let a=readStoredArray('mc_terms');const learned=!a.includes(name);a=learned?[...a,name]:a.filter(x=>x!==name);safeStorageSet('mc_terms',JSON.stringify(a));safeStorageSet('mc_term_count',a.length);renderTerms();loadLocalStats();renderRoadmap();cloudWrite('setTerm',{name,learned:learned?'1':'0'})}
function savePrediction(market){const choice=state.choices[market];if(!choice)return toast('まず方向を選んでください');const reason=$('#reason'+market).value.trim().slice(0,500);if(reason.length<3)return toast('理由を一言書いてください');const rec={id:Date.now(),date:new Date().toISOString(),market,choice,reason,confidence:Number($('#confidence'+market).value)};const arr=readStoredArray('mc_predictions');arr.unshift(rec);safeStorageSet('mc_predictions',JSON.stringify(arr.slice(0,200)));markStudyDay();loadPredictions();loadLocalStats();cloudWrite('savePrediction',rec);toast('予想を保存しました。PC/スマホへ同期します')}
function loadPredictions(){const arr=readStoredArray('mc_predictions');$('#predictionHistory').innerHTML=arr.slice(0,8).map(x=>`<div class="history-row"><div><b>${x.market}</b> → ${esc(x.choice)} <small>自信${x.confidence}/5</small><br><small>${esc(x.reason)}</small></div><time>${fmt(x.date)}</time></div>`).join('')||'<p>まだ予想はありません。最初は当てる必要はありません。</p>'}
function saveJournal(){const note=$('#journalNote').value.trim().slice(0,500),learn=$('#journalLearn').value.trim().slice(0,500),next=$('#journalNext').value.trim().slice(0,300);if(!note&&!learn&&!next)return toast('何か1つだけでも書いてください');const rec={id:Date.now(),date:new Date().toISOString(),note,learn,next};const arr=readStoredArray('mc_journal');arr.unshift(rec);safeStorageSet('mc_journal',JSON.stringify(arr.slice(0,180)));$('#journalNote').value=$('#journalLearn').value=$('#journalNext').value='';markStudyDay();loadJournal();loadLocalStats();cloudWrite('saveJournal',rec);toast('今日の学びを保存しました。PC/スマホへ同期します')}
function loadJournal(){const arr=readStoredArray('mc_journal');$('#journalHistory').innerHTML=arr.slice(0,20).map(x=>`<article class="journal-entry"><time>${fmt(x.date)}</time>${x.note?`<p><b>気になったこと</b><br>${esc(x.note)}</p>`:''}${x.learn?`<p><b>わかったこと</b><br>${esc(x.learn)}</p>`:''}${x.next?`<p><b>次に確認</b><br>${esc(x.next)}</p>`:''}</article>`).join('')}
function markStudyDay(){let a=readStoredArray('mc_days');const d=new Date().toISOString().slice(0,10);if(!a.includes(d)){a.push(d);safeStorageSet('mc_days',JSON.stringify(a));cloudWrite('markStudyDay',{day:d})}}
function loadLocalStats(){const days=readStoredArray('mc_days');const p=readStoredArray('mc_predictions');const t=readStoredArray('mc_terms');$('#studyDays').textContent=days.length;$('#predictionCount').textContent=p.length;$('#termProgress').textContent=t.length;const pct=Math.min(100,Math.round((t.length/terms.length)*60+Math.min(days.length,30)/30*40));$('#levelPct').textContent=pct+'%';$('#levelBar').style.width=pct+'%';$('#stageName').textContent=pct>=90?'LEVEL 2 経済連結':'LEVEL 1 基礎'}

function applySetupFromUrl(){
 try{
  const u=new URL(location.href),b=u.searchParams.get('backend'),t=u.searchParams.get('token');
  if(b&&/^https:\/\/script\.google\.com\//.test(b)){safeStorageSet('mc_backend',b);state.backend=b}
  if(t&&t.length>=6){safeStorageSet('mc_sync_token',t);state.syncToken=t}
  if((b||t)&&location.protocol!=='file:'){u.searchParams.delete('backend');u.searchParams.delete('token');history.replaceState({},'',u.pathname+u.search+u.hash)}
 }catch(e){}
}
function setSyncStatus(mode,title,detail){
 const led=$('#syncLed'),t=$('#syncTitle'),d=$('#syncDetail');
 if(led){led.className='sync-led'+(mode==='live'?' live':mode==='busy'?' busy':mode==='error'?' error':'')}
 if(t)t.textContent=title||'';if(d)d.textContent=detail||'';
}
function saveConnection(){
 const u=$('#backendUrl').value.trim(),token=$('#syncToken').value.trim();
 if(!u)return toast('GAS URLを入力してください');
 if(!/^https:\/\/script\.google\.com\//.test(u))return toast('GAS WebアプリURLを確認してください');
 if(token.length<6)return toast('同期コードを入力してください');
 safeStorageSet('mc_backend',u);safeStorageSet('mc_sync_token',token);state.backend=u;state.syncToken=token;
 setSyncStatus('busy','接続確認中','ニュースと学習データを確認しています。');fetchBackend(true);cloudSync(false);startCloudSync();startNewsAutoPoll();
}
function buildPhoneSetupLink(){
 const out=$('#phoneLinkOutput');if(!out)return;
 if(!state.backend||!state.syncToken){out.innerHTML='<small>先にGAS URLと同期コードを保存してください。</small>';return}
 if(location.protocol==='file:'){out.innerHTML='<small>今はPC内のファイルで開いているため、公開後にスマホ用リンクを作れます。設定内容自体は保存済みです。</small>';return}
 const u=new URL(location.href);u.hash='';u.search='';u.searchParams.set('backend',state.backend);u.searchParams.set('token',state.syncToken);
 out.innerHTML=`<div class="share-link">${esc(u.href)}</div><small>このURLをスマホで1回開くと、接続情報が自動保存されます。</small>`;
 navigator.clipboard?.writeText(u.href).then(()=>toast('スマホ初回接続リンクをコピーしました')).catch(()=>{});
}
function cloudBase(action,params={}){
 if(!state.backend||!state.syncToken)return '';
 const sep=state.backend.includes('?')?'&':'?';const q=new URLSearchParams({action,token:state.syncToken});Object.entries(params).forEach(([k,v])=>q.set(k,String(v??'')));
 return state.backend+sep+q.toString();
}
function cloudWrite(action,params){
 if(!state.backend||!state.syncToken)return;
 setSyncStatus('busy','同期中','保存内容をクラウドへ送っています。');
 gasRequest(cloudBase(action,params),data=>{if(!data||data.ok===false)throw new Error(data?.error||'保存失敗');state.lastSync=new Date();setSyncStatus('live','同期済み','PCとスマホで同じ学習データを使えます。')},err=>{console.warn('cloud write',err);setSyncStatus('error','同期待ち','端末には保存済みです。次回接続時に再同期します。')},18000);
}
function mergeById(a,b,limit){const m=new Map();[...(a||[]),...(b||[])].forEach(x=>{if(x&&x.id!=null)m.set(String(x.id),x)});return [...m.values()].sort((x,y)=>String(y.date||'').localeCompare(String(x.date||''))).slice(0,limit)}
function cloudSync(silent=false){
 if(!state.backend||!state.syncToken){if(!silent)toast('同期設定がまだありません');return}
 if(state.syncBusy)return;state.syncBusy=true;if(!silent)setSyncStatus('busy','同期中','PC/スマホのデータを確認しています。');
 gasRequest(cloudBase('userData'),data=>{
  state.syncBusy=false;if(!data||data.ok===false)throw new Error(data?.error||'同期取得失敗');
  const lp=readStoredArray('mc_predictions'),lj=readStoredArray('mc_journal'),lt=readStoredArray('mc_terms'),ld=readStoredArray('mc_days');
  const rp=data.predictions||[],rj=data.journal||[],rt=data.terms||[],rd=data.days||[];
  const p=mergeById(lp,rp,200),j=mergeById(lj,rj,180),termsMerged=[...new Set([...lt,...rt])],daysMerged=[...new Set([...ld,...rd])].sort();
  safeStorageSet('mc_predictions',JSON.stringify(p));safeStorageSet('mc_journal',JSON.stringify(j));safeStorageSet('mc_terms',JSON.stringify(termsMerged));safeStorageSet('mc_term_count',termsMerged.length);safeStorageSet('mc_days',JSON.stringify(daysMerged));
  // まず接続成功を確定してUIをLIVEにする。旧端末データの移行は少量ずつ後段で行う。
  loadPredictions();loadJournal();renderTerms();loadLocalStats();renderRoadmap();state.lastSync=new Date();setSyncStatus('live','同期済み','PCとスマホで同じ学習データを使えます。');setApiStatus('live');setRefreshButton('live');if($('#connectionMessage'))$('#connectionMessage').textContent='GAS接続・同期は正常です。';if(!silent)toast('同期しました');
  const rpIds=new Set(rp.map(x=>String(x.id))),rjIds=new Set(rj.map(x=>String(x.id))),rtSet=new Set(rt),rdSet=new Set(rd);
  setTimeout(()=>{
   lp.filter(x=>!rpIds.has(String(x.id))).slice(0,5).forEach(x=>cloudWrite('savePrediction',x));
   lj.filter(x=>!rjIds.has(String(x.id))).slice(0,5).forEach(x=>cloudWrite('saveJournal',x));
   lt.filter(x=>!rtSet.has(x)).slice(0,8).forEach(name=>cloudWrite('setTerm',{name,learned:'1'}));
   ld.filter(x=>!rdSet.has(x)).slice(0,10).forEach(day=>cloudWrite('markStudyDay',{day}));
  },600);
 },err=>{state.syncBusy=false;console.warn('cloud sync',err);const msg=String(err?.message||err||'unknown');setSyncStatus('error','同期できません','診断: '+msg);if($('#connectionMessage'))$('#connectionMessage').textContent='同期エラー: '+msg;if(!silent)toast('同期できませんでした: '+msg)},20000);
}
function startCloudSync(){
 stopCloudSync();if(!state.backend||!state.syncToken)return;
 state.syncTimer=setInterval(()=>{if(document.visibilityState==='visible')cloudSync(true)},30000);
 document.addEventListener('visibilitychange',cloudVisibilitySync);
}
function cloudVisibilitySync(){if(document.visibilityState==='visible'&&state.backend&&state.syncToken){cloudSync(true);if(!state.historySelectedRow&&!state.newsRefreshBusy)fetchBackend(false,false)}}
function stopCloudSync(){if(state.syncTimer){clearInterval(state.syncTimer);state.syncTimer=null}document.removeEventListener('visibilitychange',cloudVisibilitySync)}
function startNewsAutoPoll(){
 stopNewsAutoPoll();if(!state.backend||!state.syncToken)return;
 // GAS側の定時取得後、開きっぱなしの画面も数分以内に保存済み最新版へ追従する。外部ニュースAPIは再実行しない。
 state.newsPollTimer=setInterval(()=>{if(document.visibilityState==='visible'&&!state.historySelectedRow&&!state.newsRefreshBusy)fetchBackend(false,false)},5*60*1000);
}
function stopNewsAutoPoll(){if(state.newsPollTimer){clearInterval(state.newsPollTimer);state.newsPollTimer=null}}


function setNotebookStatus(mode,title,detail){
 const led=$('#notebookSheetLed'),t=$('#notebookSheetStatus'),d=$('#notebookSheetDetail');
 if(led)led.className='sync-led'+(mode==='live'?' live':mode==='busy'?' busy':mode==='error'?' error':'');
 if(t)t.textContent=title||'';if(d)d.textContent=detail||'';
}
function applyNotebookStatus(data){
 if(!data)return;state.notebook={...state.notebook,...data,ready:!!data.ready};
 if($('#notebookLmUrl')&&data.notebookUrl!==undefined)$('#notebookLmUrl').value=data.notebookUrl||'';
 const count=Array.isArray(data.sheets)?data.sheets.length:0;
 setNotebookStatus(data.ready?'live':'demo',data.ready?'連携用シート準備済み':'準備前',data.ready?`${data.sheetName||'Market Compass専用シート'} / ${count}タブ`:'「連携用シートを準備」を押してください。');
}
function fetchNotebookStatus(silent=false){
 if(!state.backend||!state.syncToken){setNotebookStatus('demo','GAS未接続','初期設定・同期でGASを接続してください。');return}
 setNotebookStatus('busy','確認中','Googleスプレッドシートを確認しています。');
 gasRequest(cloudBase('notebookStatus'),data=>{if(!data||data.ok===false)throw new Error(data?.error||'NotebookLM連携状態の取得失敗');applyNotebookStatus(data);if(!silent)toast('NotebookLM連携状態を確認しました')},err=>{console.warn('notebook status',err);setNotebookStatus('error','確認できません','GASを再デプロイ後、もう一度お試しください。');if(!silent)toast('NotebookLM連携状態を確認できませんでした')},20000);
}
function setupNotebookBridge(){
 if(!state.backend||!state.syncToken){toast('先にGASを接続してください');showPage('settings');return}
 const b=$('#setupNotebookBtn');if(b){b.disabled=true;b.textContent='準備中…'};setNotebookStatus('busy','準備中','NotebookLM用タブを作成しています。');
 gasRequest(cloudBase('setupNotebook'),data=>{if(b){b.disabled=false;b.textContent='連携用シートを準備'};if(!data||data.ok===false)throw new Error(data?.error||'準備失敗');applyNotebookStatus(data);toast('NotebookLM連携用シートを準備しました')},err=>{if(b){b.disabled=false;b.textContent='連携用シートを準備'};console.warn('notebook setup',err);setNotebookStatus('error','準備できません','GASコード更新・再デプロイを確認してください。');toast('連携用シートを準備できませんでした')},26000);
}
function saveNotebookToday(){
 if(!state.backend||!state.syncToken){toast('先にGASを接続してください');return}
 const b=$('#saveNotebookTodayBtn');if(b){b.disabled=true;b.textContent='保存中…'};
 gasRequest(cloudBase('saveNotebookToday'),data=>{if(b){b.disabled=false;b.textContent='今日のTOP5を保存'};if(!data||data.ok===false)throw new Error(data?.error||'保存失敗');applyNotebookStatus(data);toast('今日のTOP5をNotebookLM用シートへ保存しました')},err=>{if(b){b.disabled=false;b.textContent='今日のTOP5を保存'};console.warn('notebook save today',err);toast('保存できませんでした')},26000);
}
function openNotebookSheet(){
 const u=state.notebook?.sheetUrl||'';if(!u){toast('先に連携用シートを準備してください');fetchNotebookStatus(true);return}window.open(u,'_blank','noopener');
}
function saveNotebookLmUrl(){
 if(!state.backend||!state.syncToken){toast('先にGASを接続してください');return}
 const raw=$('#notebookLmUrl')?.value.trim()||'';if(raw&&!/^https:\/\/notebooklm\.google\.com\//i.test(raw))return toast('NotebookLMのURLを確認してください');
 gasRequest(cloudBase('saveNotebookUrl',{url:raw}),data=>{if(!data||data.ok===false)throw new Error(data?.error||'保存失敗');applyNotebookStatus(data);toast(raw?'NotebookLM URLを保存しました':'NotebookLM URLを解除しました')},err=>{console.warn('notebook url save',err);toast('NotebookLM URLを保存できませんでした')},18000);
}
function openNotebookLm(){
 const u=($('#notebookLmUrl')?.value.trim()||state.notebook?.notebookUrl||'https://notebooklm.google.com/');window.open(u,'_blank','noopener');
}
function buildLifeCompassSummary(){
 if(!state.backend||!state.syncToken){toast('先にGASを接続してください');return}
 const b=$('#buildLifeCompassSummaryBtn'),el=$('#lifeCompassSummaryResult');if(b){b.disabled=true;b.textContent='要約作成中…'};if(el)el.textContent='今月の学習・予想・判断ノートを集計しています…';
 gasRequest(cloudBase('lifeCompassSummary'),data=>{if(b){b.disabled=false;b.textContent='今月の要約を作成'};if(!data||data.ok===false)throw new Error(data?.error||'要約失敗');if(el)el.textContent=data.summary||'要約を保存しました。';toast('Life Compass用月次要約を保存しました')},err=>{if(b){b.disabled=false;b.textContent='今月の要約を作成'};if(el)el.textContent='月次要約を作成できませんでした。';console.warn('life summary',err);toast('月次要約を作成できませんでした')},30000);
}

function setApiStatus(mode){
 const el=$('#apiStatus');if(!el)return;
 el.classList.remove('live','offline','busy','error');
 if(mode==='live'){el.textContent='● LIVE';el.classList.add('live');return}
 if(mode==='busy'){el.textContent='● 接続中';el.classList.add('busy');return}
 if(mode==='error'){el.textContent='● 接続エラー';el.classList.add('error');return}
 el.textContent='● 未接続';el.classList.add('offline');
}
function setRefreshButton(mode){
 const b=$('#refreshBtn');if(!b)return;
 b.classList.remove('connect-needed');
 if(mode==='busy'){b.disabled=true;b.textContent='⟳ 最新ニュース取得中…';return}
 b.disabled=false;
 if(mode==='offline'){b.textContent='⚙ 接続設定';b.classList.add('connect-needed');return}
 b.textContent='↻ 最新ニュース取得';
}
function importanceLabel(v){v=Number(v)||3;return v>=5?'最重要':v===4?'重要':v===3?'注目':v===2?'参考':'低'}
function formatClock(value){const d=value?new Date(value):new Date();if(Number.isNaN(d.getTime()))return '--:--';return new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}
function setLastUpdated(value,status='ok'){
 const el=$('#lastUpdatedLabel');if(!el)return;
 el.classList.remove('is-busy','is-ok','is-error');
 if(status==='busy'){el.textContent='更新中…';el.classList.add('is-busy');return}
 if(status==='error'){el.textContent='更新失敗 '+formatClock();el.classList.add('is-error');return}
 if(status==='offline'){el.textContent='未接続';return}
 if(status==='demo'){el.textContent='デモ更新 '+formatClock(value);return}
 el.textContent='✓ 更新完了 '+formatClock(value);el.classList.add('is-ok');
}
function refreshAll(){
 if(!state.backend||!state.syncToken){setApiStatus('offline');setLastUpdated(null,'offline');setRefreshButton('offline');toast('最初に接続設定をしてください');showPage('settings');return}
 // v1.13.0: 手動更新は「保存済み再読込」ではなく、その時点のニュースを外部ソースから新規取得する。
 state.newsRefreshBusy=true;setApiStatus('busy');setRefreshButton('busy');setLastUpdated(null,'busy');
 fetchBackend(false,true);
 fetchMarkets(true);
}

function fetchBackend(test=false,fromRefresh=false){
 if(!state.backend)return;
 $('#connectionMessage').textContent=fromRefresh?'最新ニュースを取りに行っています…':'接続を確認しています…';
 const url=state.backend+(state.backend.includes('?')?'&':'?')+'action=brief&token='+encodeURIComponent(state.syncToken)+(fromRefresh?'&refresh=1':'');
 const onOk=data=>{
  if(!data||data.ok===false)throw new Error(data?.error||'取得失敗');
  setApiStatus('live');$('#connectionMessage').textContent='GAS接続・同期は正常です。';
  state.historySelectedRow=null;state.latestData={...DEMO,...data};renderData(state.latestData);$('#dockNewsBtn')?.classList.add('has-dot');
  setLastUpdated(data.generatedAt||new Date(),'ok');setRefreshButton('live');state.newsRefreshBusy=false;fetchBriefHistory(fromRefresh);
  if(fromRefresh)toast('この時点の最新ニュースを新規取得しました');else if(test)toast('接続できました');
 };
 const onErr=err=>{
  if(state.lastSync){setApiStatus('live');$('#connectionMessage').textContent='同期は正常です。ニュース取得だけ失敗しました。前回データを維持します。'}
  else {setApiStatus('error');$('#connectionMessage').textContent='GAS接続を確認できませんでした。'}
  if(!state.data)renderData(DEMO);
  if(state.lastSync){setLastUpdated(state.lastSync,'ok')}else setLastUpdated(null,'error');setRefreshButton('live');state.newsRefreshBusy=false;
  if(fromRefresh)toast('最新ニュースを取得できませんでした。前回データを維持します');console.warn(err);
 };
 // 重い新規取得でJSONP→iframeの二重リクエストが走らないよう、手動更新はbridgeを1回だけ使う。
 if(fromRefresh)bridgeRequest(url,onOk,onErr,120000);else gasRequest(url,onOk,onErr,22000);
}
function historyPickerHtml(){
 const rows=state.briefHistory||[],latestActive=!state.historySelectedRow;
 const latestTime=state.latestData?.generatedAt?formatClock(state.latestData.generatedAt):'--:--';
 const buttons=[`<button class="history-chip ${latestActive?'active':''}" data-history-latest="1">● 最新 ${esc(latestTime)}</button>`];
 rows.forEach(x=>buttons.push(`<button class="history-chip ${Number(state.historySelectedRow)===Number(x.row)?'active':''}" data-history-row="${Number(x.row)}">${esc(x.label||formatClock(x.generatedAt))}</button>`));
 return buttons.join('')||'<span class="history-loading">まだ更新履歴がありません。</span>';
}
function renderBriefHistory(){
 const html=historyPickerHtml();['#newsHistoryPicker','#radioHistoryPicker'].forEach(sel=>{const el=$(sel);if(el)el.innerHTML=html});
 const rr=$('#radioRefreshBtn');if(rr){rr.disabled=!!state.historySelectedRow;rr.title=state.historySelectedRow?'履歴表示中は原稿を変更せず、その時点の原稿を再生します。':'最新ニュースの原稿をAIで作り直します。'}
 const intro=$('#briefIntro');if(intro)intro.textContent=state.historySelectedRow?'選択した更新時点のニュースと保存済みラジオ原稿を表示しています。':'その更新時点の重要ニュースをGeminiが整理し、意味と市場へのつながりまで約5分でまとめます。';
}
function fetchBriefHistory(force=false){
 if(!state.backend||!state.syncToken)return;
 gasRequest(cloudBase('briefHistory',{limit:12}),d=>{if(!d||d.ok===false)throw new Error(d?.error||'履歴取得失敗');state.briefHistory=d.items||[];renderBriefHistory()},err=>{console.warn('brief history',err);if(force)toast('更新履歴だけ取得できませんでした')},22000);
}
function loadBriefHistoryRow(row){
 if(!row||!state.backend||!state.syncToken)return;
 stopSpeech();
 gasRequest(cloudBase('briefHistoryItem',{row}),d=>{if(!d||d.ok===false)throw new Error(d?.error||'履歴取得失敗');const base=state.latestData||state.data||DEMO;state.historySelectedRow=row;renderData({...base,...d,pulse:base.pulse||[],cause:base.cause||[],lifestyle:base.lifestyle||[]});setLastUpdated(d.generatedAt||new Date(),'ok');toast((d.historyLabel||'過去の更新')+'を表示しています')},err=>{console.warn('history item',err);toast('この更新履歴を読み込めませんでした')},22000);
}
function restoreLatestBrief(){
 stopSpeech();state.historySelectedRow=null;if(state.latestData){renderData(state.latestData);setLastUpdated(state.latestData.generatedAt||new Date(),'ok');toast('最新ニュースへ戻りました')}else fetchBackend(false,false);
}

function gasRequest(url,ok,fail,timeoutMs=20000){
 // v1.15.1: Android/タブレットのGAS ContentServiceリダイレクト遅延に対応。
 // JSONPを従来より長く待ち、キャッシュバスター付きで1回だけ再試行してからbridgeへ移る。
 if(!url){fail(new Error('gas-url-empty'));return}
 let settled=false;
 const success=data=>{
  if(settled)return;
  settled=true;
  try{ok(data)}catch(e){fail(e)}
 };
 const failure=err=>{
  if(settled)return;
  settled=true;
  fail(err);
 };
 const firstWait=Math.max(22000,Math.min(Number(timeoutMs)||22000,45000));
 jsonp(url,success,()=>{
  if(settled)return;
  const retryUrl=url+(url.includes('?')?'&':'?')+'_mc_retry='+Date.now();
  jsonp(retryUrl,success,()=>{
   if(settled)return;
   bridgeRequest(retryUrl,success,failure,Math.max(30000,Number(timeoutMs)||30000));
  },15000);
 },firstWait);
}
function jsonp(url,ok,fail,timeoutMs=12000){
 const cb='mc_cb_'+Date.now()+'_'+Math.random().toString(36).slice(2),s=document.createElement('script');let timer=null,done=false;
 const cleanup=()=>{if(done)return;done=true;if(timer)clearTimeout(timer);try{delete window[cb]}catch(e){window[cb]=undefined}try{s.remove()}catch(e){}};
 window[cb]=d=>{cleanup();try{ok(d)}catch(e){fail(e)}};
 s.async=true;s.src=url+(url.includes('?')?'&':'?')+'callback='+encodeURIComponent(cb);
 s.onerror=()=>{cleanup();fail(new Error('jsonp-network'))};
 timer=setTimeout(()=>{cleanup();fail(new Error('jsonp-timeout'))},timeoutMs);
 document.body.appendChild(s);
 return cleanup;
}
function bridgeRequest(url,ok,fail,timeoutMs=20000){
 const requestId='mc_bridge_'+Date.now()+'_'+Math.random().toString(36).slice(2),frame=document.createElement('iframe');let timer=null,done=false;
 frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0;opacity:0;pointer-events:none';
 const cleanup=()=>{if(done)return;done=true;if(timer)clearTimeout(timer);window.removeEventListener('message',onMessage);try{frame.remove()}catch(e){}};
 const onMessage=e=>{const m=e.data;if(!m||m.type!=='MC_GAS_BRIDGE'||m.requestId!==requestId)return;cleanup();try{ok(m.data)}catch(err){fail(err)}};
 window.addEventListener('message',onMessage);
 frame.onerror=()=>{cleanup();fail(new Error('bridge-network'))};
 frame.src=url+(url.includes('?')?'&':'?')+'bridge=1&requestId='+encodeURIComponent(requestId);
 timer=setTimeout(()=>{cleanup();fail(new Error('bridge-timeout'))},timeoutMs);
 document.body.appendChild(frame);
}
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2200)}
function fmt(d){return new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(d))}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function safeUrl(u){try{const x=new URL(u);return ['http:','https:'].includes(x.protocol)?x.href:'#'}catch{return '#'}}
boot();
// v1.8.0: TradingViewライブ参考チャートを追加。履歴チャートと当日確認を分離。

// v1.8.1: PC default display density 70%, selectable 60/70/80/100; mobile stays 100%.

// v1.8.3: split GAS news cache to avoid Script Properties size/timeouts; cloud sync now owns connection status.

// v1.9.0: AI Market Coach uses MARKET COMPASS market data + news; Gemini enhances it when configured.

// v1.9.1: AI先生を高速化。ニュースは保存済みキャッシュを使用し、18秒で基本解説へ自動フォールバック。

// v1.9.2: AI先生に利用者操作の停止ボタンを追加。重複実行も防止。

// v1.9.3: 基本解説を即表示。Geminiは追加解説として最大10秒待機し、市場APIの再取得を廃止。

// v1.9.4: AI先生のGAS URL生成関数欠落を修正。例外時も待機UIを必ず解除。

// v1.9.8: Geminiは原稿品質に集中。読み上げは無料のブラウザ標準音声で即時再生。
// v1.9.9: AI先生・重要ニュース・因果関係・学習カードなど文章カードへ無料読み上げを拡張。

// v1.9.11: 円安・円高の材料カードも描画完了後に無料読み上げへ対応。
// v1.9.19: Firebaseログイン失敗時に実際の診断コードを画面表示し、原因を特定できるよう改善。
// v1.9.18: Firebase Authentication本番設定を組み込み。GitHub Pagesの承認済みドメインからメール/パスワードでログイン可能。
// v1.9.21: Firebase AuthとMARKET COMPASS端末データをIndexedDB中心へ移行。localStorage容量超過でもログイン・GAS同期を継続。

// v1.9.22: 壊れた端末保存データを自動復旧。同期成功を先に確定し、外部通信キャッシュを廃止。

// v1.10.0: 重要ニュースをホーム5本へ拡張し、少額実践→中級者向けの証券・FX入口を追加。
// v1.11.0: ニュース個別AI解説、学習URL分析、5社の役割分担、ChatGPT最終レビュー導線を追加。
// v1.12.0: Google Sheetsへ学習履歴を自動蓄積し、NotebookLM専用ソースとLife Compass月次要約を追加。

// v1.13.0: 手動更新をリアルタイム新規取得へ変更。定時/臨時ニュース履歴と各回ラジオ再生を追加。
// v1.14.0: 証券会社5社をホームへ常時表示。公式YouTube学習情報を朝・昼・夜に自動収集し、ホーム/学習ページへ表示。
// v1.15.1: TradingView銘柄固定を正式統合。tvwidgetsymbol同期、タブレットGAS JSONP再試行を追加。
