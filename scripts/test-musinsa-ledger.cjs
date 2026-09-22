// Offline, isolated Electron test. Never uses the user's retailer session,
// credentials, Google webhook or installed application.
const {app,BrowserWindow,session}=require('electron');
const {readFileSync,mkdtempSync,mkdirSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const {createContext,runInContext}=require('node:vm');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'..');
const scratch=resolve(root,'..','musinsa-ledger-test-profiles');mkdirSync(scratch,{recursive:true});
app.setPath('userData',mkdtempSync(join(scratch,'profile-')));
app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{console.error('MUSINSA_LEDGER_TEST_TIMEOUT');app.exit(1);},35000);
app.whenReady().then(async()=>{
  const page=await import(pathToFileURL(join(root,'services/musinsa-ledger-page.mjs')));
  const flow=await import(pathToFileURL(join(root,'services/musinsa-ledger-flow.mjs')));
  const purchase=await import(pathToFileURL(join(root,'services/purchase-ledger.mjs')));
  const partition='offline-musinsa-ledger',isolated=session.fromPartition(partition);
  let loggedIn=false,loginCount=0,googleWrites=0,productReads=0;
  const visits=[],saved=[],windows=[];
  const card=(size,line)=>`<article data-order-item-id="${line}"><a href="/products/10001">${line==='a'?'<img width="20" height="20" alt="테스트 운동화" src="https://www.musinsa.com/order-photo.png">':''}</a><a href="/products/10001">테스트 운동화</a><a href="/brands/test">테스트</a><p>옵션: ${size}</p><p>수량: 2개</p><p>실결제금액: 62,330원</p></article>`;
  isolated.protocol.handle('https',request=>{
    const url=new URL(request.url);visits.push(url.pathname);
    let html='';
    if(url.pathname==='/mypage')html=loggedIn?'<h1>마이</h1><a href="/orders">주문/배송 조회</a>':'<h1>로그인</h1><input type="password">';
    else if(url.pathname==='/orders')html='<h1>주문 내역</h1><a href="/orders/detail/ORDER-10001">주문상세</a>';
    else if(url.pathname==='/orders/detail/ORDER-10001')html='<h1>주문상세</h1><p>주문번호: ORDER-10001</p><p>주문일시: 2026.9.2 12:00</p>'+card('블랙 / 270','a')+card('블랙 / 280','b');
    else if(url.pathname==='/products/10001'){productReads++;html='<meta property="og:image" content="https://www.musinsa.com/catalog-photo.png"><h1>테스트 운동화</h1><p>현재 판매가 1원</p><p>품번: AB123-001</p>';}
    else if(url.pathname.endsWith('-photo.png'))return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNI8AAAAASUVORK5CYII=','base64'),{headers:{'content-type':'image/png'}});
    return new Response('<!doctype html><meta charset="utf-8"><style>a{display:block;padding:8px}article{border:1px solid;margin:8px}</style>'+html,{headers:{'content-type':'text/html;charset=utf-8'}});
  });
  // Real input requires a focused BrowserWindow. Keep the isolated profile and
  // fake HTTPS pages, but exercise the same show/focus path as the application.
  function FixtureWindow(options){const win=new BrowserWindow({...options,show:false,webPreferences:{...options.webPreferences,partition}});windows.push(win);return win;}
  const context=createContext({...page,...flow,...purchase,URL,setTimeout,clearTimeout,wait,BrowserWindow:FixtureWindow,
    APP_ICON_PATH:undefined,DOMESTIC_SEARCH_PARTITION:partition,mainWindow:null,
    hasUsableDomesticLoginSession:async()=>true,
    importMusinsaCredentialsFromGoogleDrive:async()=>({ok:true,imported:true}),
    waitForMusinsaAutomaticLogin:async()=>{loginCount++;loggedIn=true;return {ok:true};},
    decrypted:()=> 'offline-secret',runWeeklyLedgerBackup:async()=>{},addProgramNotification:async()=>{},
    store:{snapshot:()=>({ledger:saved,settings:{ledgerWebhookUrl:'https://script.google.com/macros/s/offline/exec',ledgerSecretEncrypted:'offline'}}),
      upsert:async(collection,row)=>{saved.push(row);return row;}},
    fetch:async(url,options)=>{assert.equal(url,'https://script.google.com/macros/s/offline/exec');googleWrites++;const body=JSON.parse(options.body);assert.equal(body.row.purchasePrice,62330);assert.equal(body.row.imageUrl,'https://www.musinsa.com/order-photo.png');return {json:async()=>({ok:true,rowNumber:45,imageStatus:'formula'})};},AbortSignal,
  });
  const source=readFileSync(join(root,'main.mjs'),'utf8');
  const start=source.indexOf('function openMusinsaLedgerWindow()'),end=source.indexOf('const SELLER_EXPORT_POLL_INTERVAL_MS',start);
  assert.ok(start>0&&end>start);
  runInContext('let musinsaLedgerWindow,musinsaLedgerOpening,musinsaLedgerCapturing;const musinsaLedgerCaptures=new MusinsaLedgerCaptures();\n'+source.slice(start,end),context);
  const opened=await context.openMusinsaLedgerWindow();assert.equal(opened.ok,true);assert.equal(opened.stage,'orders',JSON.stringify({opened,visits}));assert.equal(loginCount,1);assert.equal(googleWrites,0);
  const noDetail=await context.captureMusinsaLedgerOrder();assert.equal(noDetail.code,'ORDER_DETAIL_REQUIRED');assert.equal(googleWrites,0);
  // Simulate the user's explicit choice of the displayed detail link.
  const orderWindow=windows[0];await orderWindow.webContents.executeJavaScript("document.querySelector('a').click()",true);
  for(let i=0;i<20&&!orderWindow.webContents.getURL().includes('/detail/');i++)await wait(100);
  await wait(200);
  const captured=await context.captureMusinsaLedgerOrder();assert.equal(captured.ok,true);assert.equal(captured.rows.length,2);
  assert.equal(captured.rows[0].articleNumber,'AB123001');assert.equal(captured.rows[0].quantity,2);assert.equal(captured.rows[0].purchasePrice,62330);
  assert.notEqual(captured.rows[0].krSize,captured.rows[1].krSize);assert.equal(productReads,1);assert.equal(googleWrites,0);
  assert.equal(captured.rows[0].imageUrl,'https://www.musinsa.com/order-photo.png');assert.equal(captured.rows[1].imageUrl,'https://www.musinsa.com/catalog-photo.png');
  const same=await context.openMusinsaLedgerWindow();assert.equal(same.stage,'detail');assert.equal(loginCount,1);
  const noProof=await context.syncPurchaseLedger({...captured.rows[0],captureId:''});assert.equal(noProof.code,'ORDER_CAPTURE_REQUIRED');assert.equal(googleWrites,0);
  const wrote=await context.syncPurchaseLedger(captured.rows[0]);assert.equal(wrote.ok,true);assert.equal(googleWrites,1);assert.equal(saved[0].orderEvidence.orderNumber,'ORDER-10001');
  assert.equal(wrote.imageStatus,'formula');assert.equal(saved[0].imageUrl,captured.rows[0].imageUrl);
  assert.ok(visits.indexOf('/orders')>visits.indexOf('/mypage'));
  windows.forEach(win=>{if(!win.isDestroyed())win.destroy();});isolated.protocol.unhandle('https');clearTimeout(deadline);
  console.log('PASS: offline Electron My → one expired-session login → order history → explicitly selected detail → two options → matching product code → explicit Google write. No real account or ledger used.');app.exit(0);
}).catch(error=>{console.error(error.stack||error);clearTimeout(deadline);app.exit(1);});
