// Real Electron, offline merchant/provider pages only. This verifies popup
// opener/callback and native input; it does not assert live provider acceptance.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const {createContext,runInContext}=require('node:vm');
const root=resolve(__dirname,'../..');
app.setPath('userData',process.env.AROUNDG_STOCK_TEST_PROFILE);
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Current public Naver controls: passkey buttons precede ordinary password
// buttons and both are type=button. Only the ordinary button submits the form.
const naverForm=`<style>.naver-buttons-column{display:none}.naver-buttons-row{display:block}@media(max-width:599px){.naver-buttons-column{display:block}.naver-buttons-row{display:none}}</style>
  <form method="post" action="/submit"><input id="id" name="id"><input id="pw" name="pw" type="password">
  <input id="loginStay" type="checkbox"><label for="loginStay">로그인 상태 유지</label>
  <div class="naver-buttons-column">
  <button id="passkeyBtn_column" type="button" onclick="fetch('/passkey-trigger')">패스키 로그인</button>
  <button id="loginBtn_column" type="button" onclick="this.form.requestSubmit()">로그인</button>
  </div><div class="naver-buttons-row"><button id="passkeyBtn_row" type="button" onclick="fetch('/passkey-trigger')">패스키 로그인</button>
  <button id="loginBtn_row" type="button" onclick="this.form.requestSubmit()">로그인</button></div></form>`;
const deadline=setTimeout(()=>{console.error('SHOPPING_LOGIN_FIXTURE_TIMEOUT');app.exit(1);},50000);
app.whenReady().then(async()=>{
  const {ShoppingLoginConnector,captureShoppingLoginPage}=await import(pathToFileURL(resolve(root,'services/shopping-accounts.mjs')));
  const directPartition='persist:offline-direct-naver',directSession=session.fromPartition(directPartition);
  let directPosts=0,directPasskeyClicks=0;
  directSession.protocol.handle('https',async request=>{
    const url=new URL(request.url);
    if(url.pathname==='/passkey-trigger'){directPasskeyClicks++;return new Response('unexpected passkey click');}
    let body=naverForm;
    if(url.pathname==='/submit') {
      const fields=new URLSearchParams(await request.text());directPosts++;
      assert.equal(fields.get('id'),'naver-fixture-id');assert.equal(fields.get('pw'),'naver-fixture-secret');
      body='<script>document.cookie="NID_AUT=fixture;Domain=naver.com;path=/;Secure";document.cookie="NID_SES=fixture;Domain=naver.com;path=/;Secure";</script><button>로그아웃</button>';
    }
    return new Response('<!doctype html><meta charset="utf-8"><body>'+body+'</body>',{headers:{'content-type':'text/html;charset=utf-8'}});
  });
  const mainSource=readFileSync(resolve(root,'main.mjs'),'utf8'),directWindows=new Map();
  const directContext=createContext({BrowserWindow,session,URL,Date,wait,DOMESTIC_SEARCH_PARTITION:directPartition,
    domesticLoginWindows:directWindows,mainWindow:{webContents:{send:()=>{}}},
    domesticLoginSource:()=>({id:'naver',name:'네이버',url:'https://nid.naver.com/nidlogin.login'}),
    naverAccountCredentials:()=>({id:'naver-fixture-id',password:'naver-fixture-secret',code:''})});
  const section=(start,end)=>mainSource.slice(mainSource.indexOf(start),mainSource.indexOf(end,mainSource.indexOf(start)));
  runInContext(section('async function hasUsableNaverLoginSession()', 'function naverAccountCredentials()'),directContext);
  runInContext(section('function observeNaverLoginSession(', 'function domesticLoginSourceIdsForSearch('),directContext);
  runInContext(section('async function openDomesticLogin(', 'async function clearDomesticLogin('),directContext);
  const opened=await directContext.openDomesticLogin('naver',{background:true});
  assert.equal(opened.automatic?.ok,true,JSON.stringify(opened));
  assert.equal(directPosts,1);assert.equal(directPasskeyClicks,0);
  const reused=await directContext.openDomesticLogin('naver',{background:true});
  assert.equal(reused.reused,true);assert.equal(directPosts,1);
  directWindows.get('naver').close();directSession.protocol.unhandle('https');
  console.log(JSON.stringify({method:'direct-naver',offline:true,passwordSubmittedOnce:true,passkeyClicks:0,sessionReused:true}));
  for(const scenario of ['password','password-click-unfocused','naver','kakao']) {
    const method=scenario.startsWith('password')?'password':scenario;
    const partition='persist:offline-shopping-'+scenario,isolated=session.fromPartition(partition);
    const merchant='https://www.kolonmall.com',provider=method==='naver'?'https://nid.naver.com':'https://accounts.kakao.com';
    const source={id:'kolon',name:'코오롱몰',url:merchant,domains:['kolonmall.com']};
    const credentials=id=>({loginId:id+'-fixture-id',password:id+'-fixture-secret',code:''});
    const accounts={source:()=>source,publicAccount:()=>({method}),credentials};
    const windows=new Map(),submissions=[];let passkeyClicks=0,preventedFocus=0;
    const form='<form method="post" action="/submit"><input name="username" autocomplete="username"><input type="password" name="password"><button type="submit">로그인</button></form>';
    isolated.protocol.handle('https',async request=>{
      const url=new URL(request.url);let body='';
      if(url.pathname==='/passkey-trigger'){passkeyClicks++;return new Response('unexpected passkey click');}
      if(url.pathname==='/blocked-focus'){preventedFocus++;return new Response('fixture native focus prevented');}
      if(url.pathname==='/submit') {
        const fields=new URLSearchParams(await request.text());
        submissions.push({origin:url.origin,id:fields.get('username') ?? fields.get('id'),password:fields.get('password') ?? fields.get('pw')});
        body=`<script>location.href=${JSON.stringify(merchant+'/callback')}</script>`;
      } else if(url.origin===provider) body=method==='naver'?naverForm:form;
      else if(url.pathname==='/callback') body=`<script>document.cookie='member_session=fixture;path=/;SameSite=Lax;Secure';if(window.opener){window.opener.postMessage('fixture-login-complete',${JSON.stringify(merchant)});setTimeout(()=>window.close(),100);}else{document.write('<button>로그아웃</button>');}</script>`;
      else if(url.pathname==='/login') body=method==='password' ? form
        : `<button onclick="const popup=window.open('about:blank','fixture-social');popup.location.href='${provider}/login';">${method} 로그인</button><script>addEventListener('message',event=>{if(event.origin===${JSON.stringify(merchant)}&&event.data==='fixture-login-complete'){window.callbackReceived=true;document.body.innerHTML='<button>로그아웃</button>';}});</script>`;
      else body='<a href="/login">로그인</a>';
      if(scenario==='password-click-unfocused' && body.includes('<form')) body+='<script>document.querySelectorAll("input").forEach(input=>input.addEventListener("mousedown",event=>{event.preventDefault();fetch("/blocked-focus");}));</script>';
      return new Response('<!doctype html><meta charset="utf-8"><body>'+body+'</body>',{headers:{'content-type':'text/html;charset=utf-8'}});
    });
    const connector=new ShoppingLoginConnector({accounts,BrowserWindow,partition,windows,notify:()=>{}});
    await connector.open('kolon');const win=windows.get('kolon');
    for(let i=0;i<120 && connector.status('kolon').code!=='LOGIN_CONFIRMED';i++) await wait(100);
    if(connector.status('kolon').code!=='LOGIN_CONFIRMED') console.log(JSON.stringify({method,
      url:win.webContents.getURL(),page:await win.webContents.executeJavaScript(`(${captureShoppingLoginPage.toString()})(${JSON.stringify(method)})`)}));
    assert.equal(connector.status('kolon').code,'LOGIN_CONFIRMED',method+': '+JSON.stringify(connector.status('kolon')));
    assert.equal(submissions.length,1,method+' submitted exactly once');
    assert.equal(passkeyClicks,0,method+' must never start passkey authentication');
    if(scenario==='password-click-unfocused') assert.equal(preventedFocus,2,'both inputs require explicit focus repair');
    const expectedId=method==='password'?'kolon':method;
    assert.deepEqual(submissions[0],{origin:method==='password'?merchant:provider,id:credentials(expectedId).loginId,password:credentials(expectedId).password});
    if(method!=='password') assert.equal(await win.webContents.executeJavaScript('window.callbackReceived'),true);
    assert.equal((await isolated.cookies.get({url:merchant,name:'member_session'})).length,1);
    console.log(JSON.stringify({method,scenario,electron:process.versions.electron,offline:true,submittedOnce:true,merchantCallback:true,sharedSession:true}));
    win.close();isolated.protocol.unhandle('https');
  }
  // Render the shipping settings markup and account script with fixture data.
  const uiSession=session.fromPartition('offline-shopping-settings');
  const account=(id,name,methods)=>({id,name,methods,method:'password',loginId:id==='kakao'?'fixture@example.test':'',configured:id==='kakao',hasPassword:id==='kakao'});
  const accounts=[account('kakao','카카오 계정',['password']),account('kolon','코오롱몰·코오롱스포츠',['password','naver','kakao']),account('musinsa','무신사',['password','naver','kakao'])];
  const fixture=`window.aroundG={listShoppingAccounts:async()=>${JSON.stringify(accounts)}};addEventListener('DOMContentLoaded',async()=>{document.querySelectorAll('.view').forEach(el=>{el.classList.remove('active');el.hidden=true;});const settings=document.querySelector('#settings');settings.hidden=false;settings.classList.add('active');await window.AroundGShoppingAccounts.render();const row=document.querySelector('[data-shopping-account="kolon"]');row.open=true;row.querySelector('[data-shop-method]').value='naver';row.querySelector('[data-shop-method]').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.domestic-login-heading').scrollIntoView();window.fixtureReady=true;});`;
  uiSession.protocol.handle('https',request=>{
    const path=new URL(request.url).pathname;
    const html=readFileSync(resolve(root,'src/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>','<script src="/fixture.js"></script><script src="/shopping-accounts.js"></script></body>');
    const body=path==='/'?html:path==='/fixture.js'?fixture:/^\/[a-z0-9-]+\.(css|js)$/.test(path)?readFileSync(resolve(root,'src'+path)) : '';
    return new Response(body,{headers:{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8'}});
  });
  const ui=new BrowserWindow({show:false,width:1426,height:900,webPreferences:{session:uiSession,sandbox:true,offscreen:true,backgroundThrottling:false}});
  await ui.loadURL('https://fixture.invalid/');
  for(let i=0;i<30 && !await ui.webContents.executeJavaScript('Boolean(window.fixtureReady)');i++) await wait(100);
  assert.equal(await ui.webContents.executeJavaScript(`document.querySelectorAll('[data-shopping-account]').length`),3);
  assert.equal(await ui.webContents.executeJavaScript(`getComputedStyle(document.querySelector('[data-shopping-account="kolon"] [data-shop-fields]')).display`),'none');
  assert.equal(await ui.webContents.executeJavaScript(`document.querySelector('[data-shopping-account="kakao"] [data-shop-password]').value`),'');
  if(process.env.AROUNDG_SHOPPING_SCREENSHOT) {
    mkdirSync(resolve(process.env.AROUNDG_SHOPPING_SCREENSHOT,'..'),{recursive:true});
    writeFileSync(process.env.AROUNDG_SHOPPING_SCREENSHOT,(await ui.webContents.capturePage()).toPNG());
  }
  ui.destroy();uiSession.protocol.unhandle('https');
  console.log('Shopping account settings rendered with hidden social-password fields and no stored password values.');
  clearTimeout(deadline);app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1);});
