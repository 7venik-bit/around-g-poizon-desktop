// Real Electron, offline merchant/provider pages only. This verifies popup
// opener/callback and native input; it does not assert live provider acceptance.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const root=resolve(__dirname,'../..');
app.setPath('userData',process.env.AROUNDG_STOCK_TEST_PROFILE);
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{console.error('SHOPPING_LOGIN_FIXTURE_TIMEOUT');app.exit(1);},50000);
app.whenReady().then(async()=>{
  const {ShoppingLoginConnector,captureShoppingLoginPage}=await import(pathToFileURL(resolve(root,'services/shopping-accounts.mjs')));
  for(const method of ['password','naver','kakao']) {
    const partition='persist:offline-shopping-'+method,isolated=session.fromPartition(partition);
    const merchant='https://www.kolonmall.com',provider=method==='naver'?'https://nid.naver.com':'https://accounts.kakao.com';
    const source={id:'kolon',name:'코오롱몰',url:merchant,domains:['kolonmall.com']};
    const credentials=id=>({loginId:id+'-fixture-id',password:id+'-fixture-secret',code:''});
    const accounts={source:()=>source,publicAccount:()=>({method}),credentials};
    const windows=new Map(),submissions=[];
    const form='<form method="post" action="/submit"><input name="username" autocomplete="username"><input type="password" name="password"><button type="submit">로그인</button></form>';
    isolated.protocol.handle('https',async request=>{
      const url=new URL(request.url);let body='';
      if(url.pathname==='/submit') {
        const fields=new URLSearchParams(await request.text());
        submissions.push({origin:url.origin,id:fields.get('username'),password:fields.get('password')});
        body=`<script>location.href=${JSON.stringify(merchant+'/callback')}</script>`;
      } else if(url.origin===provider) body=form;
      else if(url.pathname==='/callback') body=`<script>document.cookie='member_session=fixture;path=/;SameSite=Lax;Secure';if(window.opener){window.opener.postMessage('fixture-login-complete',${JSON.stringify(merchant)});setTimeout(()=>window.close(),100);}else{document.write('<button>로그아웃</button>');}</script>`;
      else if(url.pathname==='/login') body=method==='password' ? form
        : `<button onclick="const popup=window.open('about:blank','fixture-social');popup.location.href='${provider}/login';">${method} 로그인</button><script>addEventListener('message',event=>{if(event.origin===${JSON.stringify(merchant)}&&event.data==='fixture-login-complete'){window.callbackReceived=true;document.body.innerHTML='<button>로그아웃</button>';}});</script>`;
      else body='<a href="/login">로그인</a>';
      return new Response('<!doctype html><meta charset="utf-8"><body>'+body+'</body>',{headers:{'content-type':'text/html;charset=utf-8'}});
    });
    const connector=new ShoppingLoginConnector({accounts,BrowserWindow,partition,windows,notify:()=>{}});
    await connector.open('kolon');const win=windows.get('kolon');
    for(let i=0;i<120 && connector.status('kolon').code!=='LOGIN_CONFIRMED';i++) await wait(100);
    if(connector.status('kolon').code!=='LOGIN_CONFIRMED') console.log(JSON.stringify({method,
      url:win.webContents.getURL(),page:await win.webContents.executeJavaScript(`(${captureShoppingLoginPage.toString()})(${JSON.stringify(method)})`)}));
    assert.equal(connector.status('kolon').code,'LOGIN_CONFIRMED',method+': '+JSON.stringify(connector.status('kolon')));
    assert.equal(submissions.length,1,method+' submitted exactly once');
    const expectedId=method==='password'?'kolon':method;
    assert.deepEqual(submissions[0],{origin:method==='password'?merchant:provider,id:credentials(expectedId).loginId,password:credentials(expectedId).password});
    if(method!=='password') assert.equal(await win.webContents.executeJavaScript('window.callbackReceived'),true);
    assert.equal((await isolated.cookies.get({url:merchant,name:'member_session'})).length,1);
    console.log(JSON.stringify({method,electron:process.versions.electron,offline:true,submittedOnce:true,merchantCallback:true,sharedSession:true}));
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
