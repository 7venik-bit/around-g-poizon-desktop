import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';
import {JsonStore} from '../services/store.mjs';
import {ShoppingAccounts,ShoppingLoginConnector,captureShoppingLoginPage,shoppingLoginHostAllowed} from '../services/shopping-accounts.mjs';

const sources=[{id:'musinsa',name:'무신사',url:'https://www.musinsa.com/',domains:['musinsa.com']},
  {id:'kolon',name:'코오롱몰',url:'https://www.kolonmall.com/',domains:['kolonmall.com']},
  {id:'naver',name:'네이버',url:'https://nid.naver.com/nidlogin.login',domains:['naver.com']},
  {id:'kakao',name:'카카오',url:'https://accounts.kakao.com/login',domains:['accounts.kakao.com']},
  {id:'nike',name:'나이키',url:'https://www.nike.com/kr/',domains:['nike.com']}];
const encrypt=value=>Buffer.from('fixture:'+value).toString('base64');
const decrypt=value=>{const decoded=Buffer.from(value,'base64').toString();if(!decoded.startsWith('fixture:'))throw Error('private detail');return decoded.slice(8);};
async function fixture(t) {
  const folder=await mkdtemp(join(tmpdir(),'shopping-accounts-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const store=new JsonStore(folder);await store.load();
  const changes=[];
  const accounts=new ShoppingAccounts({store,sources,encrypt,decrypt,onChanged:async(...args)=>changes.push(args)});
  return {folder,store,accounts,changes};
}

test('shopping credentials are encrypted, survive restart and are absent from public account data',async t=>{
  const f=await fixture(t);
  const result=await f.accounts.save({id:'musinsa',loginId:'shop-fixture-id',password:'shop-fixture-secret'});
  const disk=await readFile(f.store.path,'utf8');
  assert.doesNotMatch(disk,/shop-fixture-id|shop-fixture-secret/);
  assert.deepEqual(Object.keys(result).sort(),['configured','credentialCode','hasPassword','id','loginId','method'].sort());
  const restored=new JsonStore(f.folder);await restored.load();
  const accounts=new ShoppingAccounts({store:restored,sources,encrypt,decrypt});
  assert.equal(accounts.credentials('musinsa').password,'shop-fixture-secret');
  await accounts.save({id:'musinsa',loginId:'shop-fixture-id',password:''});
  assert.equal(accounts.credentials('musinsa').password,'shop-fixture-secret');
});
test('concurrent mall saves preserve both accounts and reject ID changes without a replacement secret',async t=>{
  const f=await fixture(t);
  await Promise.all(['musinsa','kolon'].map(id=>f.accounts.save({id,loginId:id+'-id',password:'fixture-secret'})));
  assert.equal(Object.keys(f.store.snapshot().settings.shoppingAccounts).length,2);
  await assert.rejects(f.accounts.save({id:'musinsa',loginId:'another-id'}),/ACCOUNT_PASSWORD_REQUIRED_ON_CHANGE/);
  assert.equal(f.accounts.publicAccount('musinsa').loginId,'musinsa-id');
});
test('failed storage never changes account settings or clears a login session',async t=>{
  const f=await fixture(t);await mkdir(f.store.path+'.tmp');
  await assert.rejects(f.accounts.save({id:'kolon',loginId:'fixture',password:'secret'}));
  assert.equal(f.accounts.publicAccount('kolon').configured,false);assert.equal(f.changes.length,0);
});
test('social login can be selected without a merchant password and preserves provider separation',async t=>{
  const f=await fixture(t);
  await f.accounts.save({id:'kolon',method:'kakao'});
  await f.accounts.save({id:'kakao',loginId:'kakao-fixture',password:'kakao-secret'});
  assert.equal(f.accounts.publicAccount('kolon').method,'kakao');
  assert.equal(f.accounts.credentials('kolon').password,'');
  assert.equal(f.accounts.credentials('kakao').password,'kakao-secret');
  await assert.rejects(f.accounts.save({id:'kakao',method:'naver'}),/ACCOUNT_METHOD_INVALID/);
});
test('existing Naver and official-mall accounts remain the single credential source',async t=>{
  const f=await fixture(t);
  await f.store.setSettings({naverLoginId:'naver-fixture',naverPasswordEncrypted:encrypt('naver-secret')});
  assert.equal(f.accounts.credentials('naver').password,'naver-secret');
  await f.accounts.save({id:'nike',loginId:'nike-fixture',password:'nike-secret'});
  assert.equal(f.store.snapshot().settings.nikeLoginId,'nike-fixture');
  assert.equal(decrypt(f.store.snapshot().settings.nikePasswordEncrypted),'nike-secret');
  assert.equal(f.store.snapshot().settings.shoppingAccounts.nike.passwordEncrypted,undefined);
});
test('unreadable secrets produce a sanitized account status',async t=>{
  const f=await fixture(t);await f.store.setSettings({shoppingAccounts:{kolon:{method:'password',idEncrypted:'wrong-machine'}}});
  const result=f.accounts.publicAccount('kolon');
  assert.equal(result.credentialCode,'ACCOUNT_CREDENTIALS_UNREADABLE');
  assert.doesNotMatch(JSON.stringify(result),/private detail|wrong-machine/);
});
test('automatic input trusts HTTPS merchant boundaries and the exact provider login host',()=>{
  for(const url of ['https://www.kolonmall.com/login','https://m.kolonmall.com/login']) assert.equal(shoppingLoginHostAllowed(url,['kolonmall.com']),true);
  for(const url of ['http://www.kolonmall.com/login','https://kolonmall.com.evil.test/login','https://user:pass@kolonmall.com/login']) assert.equal(shoppingLoginHostAllowed(url,['kolonmall.com']),false);
  assert.equal(shoppingLoginHostAllowed('https://accounts.kakao.com/login',['accounts.kakao.com']),true);
  assert.equal(shoppingLoginHostAllowed('https://www.kakao.com/login',['accounts.kakao.com']),false);
});

function browserFixture(t,accounts) {
  const windows=[],inserted=[],scripts=[],events=[];
  class BrowserWindow extends EventEmitter {
    constructor(options={}) {
      super();this.options=options;this.dom=new JSDOM('<body></body>',{url:'https://www.kolonmall.com/',runScripts:'outside-only'});
      const w=this.dom.window;t.after(()=>w.close());
      w.document.addEventListener('submit',event=>event.preventDefault());
      Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
      w.HTMLElement.prototype.getBoundingClientRect=function(){const index=[...w.document.querySelectorAll('*')].indexOf(this);return {left:0,top:index*30,width:100,height:20};};
      w.document.elementFromPoint=(_x,y)=>[...w.document.querySelectorAll('*')].find(el=>{const r=el.getBoundingClientRect();return Math.round(r.top+r.height/2)===y;});
      const wc=this.webContents=new EventEmitter();
      wc.focus=()=>{};
      wc.isFocused=()=>true;
      wc.getURL=()=>w.location.href;wc.session={cookies:{flushStore:async()=>{this.flushed=true;}}};
      wc.mainFrame={executeJavaScript:async script=>{scripts.push(script);return w.eval(script);}};
      wc.setWindowOpenHandler=fn=>{this.popupHandler=fn;};
      wc.sendInputEvent=event=>{if(event.type==='mouseUp'){
        const el=[...w.document.querySelectorAll('*')].find(el=>{const r=el.getBoundingClientRect();return Math.round(r.top+r.height/2)===event.y;});
        if(el?.tagName==='INPUT') {this.focused=el;el.focus();} else el?.click();
      }};
      wc.insertText=async value=>{inserted.push({url:wc.getURL(),value});this.focused.value=value;};
      windows.push(this);
    }
    isDestroyed(){return Boolean(this.destroyed);} isFocused(){return true;} show(){} focus(){}
    close(){this.destroyed=true;this.emit('closed');}
    async loadURL(url){this.dom.reconfigure({url});}
  }
  const connector=new ShoppingLoginConnector({accounts,BrowserWindow,partition:'persist:test',windows:new Map(),notify:event=>events.push(event),
    wait:async()=>{},setIntervalImpl:()=>1,clearIntervalImpl:()=>{}});
  return {BrowserWindow,connector,windows,inserted,scripts,events};
}
const form='<form><input name="username" autocomplete="username"><input type="password"><button type="submit">로그인</button></form>';
test('merchant password submits once and never appears inside injected scripts',async t=>{
  const f=await fixture(t);await f.accounts.save({id:'kolon',loginId:'merchant-id',password:'merchant-secret'});
  const b=browserFixture(t,f.accounts),w=new b.BrowserWindow();w.dom.window.document.body.innerHTML=form;
  const flow={source:sources[1],method:'password',started:Date.now(),acted:new Set()};
  await b.connector.advance(w,flow);await b.connector.advance(w,flow);
  assert.deepEqual(b.inserted.map(x=>x.value),['merchant-id','merchant-secret']);
  assert.ok(b.scripts.every(script=>!script.includes('merchant-secret')));
  assert.equal(b.connector.status('kolon').code,'LOGIN_SUBMITTED');
});
for(const provider of ['naver','kakao']) test(`${provider} login preserves popup callback and only fills provider credentials on its origin`,async t=>{
  const f=await fixture(t);
  await f.accounts.save({id:'kolon',loginId:'merchant-id',password:'merchant-secret',method:provider});
  await f.accounts.save({id:provider,loginId:provider+'-id',password:provider+'-secret'});
  const b=browserFixture(t,f.accounts);await b.connector.open('kolon');
  const parent=b.windows[0];
  assert.equal(parent.popupHandler({url:'about:blank'}).action,'allow');
  assert.equal(parent.popupHandler({url:'https://accounts.kakao.com/login'}).overrideBrowserWindowOptions.webPreferences.partition,'persist:test');
  assert.equal(parent.popupHandler({url:'javascript:alert(1)'}).action,'deny');
  parent.dom.window.document.body.innerHTML=`<button>${provider} 로그인</button>`;
  let clicked=0;parent.dom.window.document.querySelector('button').onclick=()=>clicked++;
  const flow={source:sources[1],method:provider,started:Date.now(),acted:new Set(),children:new Set()};
  await b.connector.advance(parent,flow);await b.connector.advance(parent,flow);
  assert.equal(clicked,1);assert.equal(b.inserted.length,0);
  const child=new b.BrowserWindow();child.dom.window.document.body.innerHTML=form;
  await child.loadURL('https://untrusted.test/login');await b.connector.advance(child,flow);assert.equal(b.inserted.length,0);
  const host=provider==='naver'?'nid.naver.com':'accounts.kakao.com';
  await child.loadURL(`https://${host}/login`);await b.connector.advance(child,flow);
  assert.deepEqual(b.inserted.map(x=>x.value),[provider+'-id',provider+'-secret']);
  parent.dom.window.document.body.innerHTML='<button>로그아웃</button>';
  await b.connector.advance(parent,flow);
  assert.equal(b.connector.status('kolon').code,'LOGIN_CONFIRMED');assert.equal(parent.flushed,true);
});
test('verification pages receive no automatic credential input',async t=>{
  const f=await fixture(t);await f.accounts.save({id:'kolon',loginId:'fixture',password:'secret'});
  const b=browserFixture(t,f.accounts),w=new b.BrowserWindow();w.dom.window.document.body.innerHTML='<h1>보안 확인</h1>'+form;
  await b.connector.advance(w,{source:sources[1],method:'password',started:Date.now(),acted:new Set()});
  assert.equal(b.inserted.length,0);assert.equal(b.connector.status('kolon').code,'LOGIN_VERIFICATION_REQUIRED');
});
for(const provider of ['naver','kakao']) test(`${provider} merchant confirmation survives a slower popup submission`,async t=>{
  const f=await fixture(t);await f.accounts.save({id:provider,loginId:'provider-id',password:'provider-secret'});
  const b=browserFixture(t,f.accounts),parent=new b.BrowserWindow(),child=new b.BrowserWindow();
  parent.dom.window.document.body.innerHTML='<button>로그아웃</button>';
  child.dom.window.document.body.innerHTML=form;
  await child.loadURL(`https://${provider==='naver'?'nid.naver.com':'accounts.kakao.com'}/login`);
  const flow={source:sources[1],method:provider,started:Date.now(),acted:new Set()};
  let submitted=false,confirmedDuringClick=false;
  child.dom.window.document.querySelector('form').addEventListener('submit',()=>{submitted=true;});
  b.connector.wait=async()=>{
    if(submitted && !confirmedDuringClick) {
      confirmedDuringClick=true;
      await b.connector.advance(parent,flow);
      assert.equal(b.connector.status('kolon').code,'LOGIN_CONFIRMED');
    }
  };
  await b.connector.advance(child,flow);
  assert.equal(confirmedDuringClick,true);assert.equal(flow.stopped,true);
  assert.equal(b.connector.status('kolon').code,'LOGIN_CONFIRMED');
  assert.deepEqual(b.inserted.map(x=>x.value),['provider-id','provider-secret']);
  assert.equal(b.events.at(-1).code,'LOGIN_CONFIRMED');
});
test('a pending popup capture cannot replace confirmed merchant status or enter more credentials',async t=>{
  const f=await fixture(t);await f.accounts.save({id:'kakao',loginId:'provider-id',password:'provider-secret'});
  const b=browserFixture(t,f.accounts),parent=new b.BrowserWindow(),child=new b.BrowserWindow();
  parent.dom.window.document.body.innerHTML='<button>로그아웃</button>';
  child.dom.window.document.body.innerHTML=form;
  await child.loadURL('https://accounts.kakao.com/login');
  const flow={source:sources[1],method:'kakao',started:Date.now(),acted:new Set()};
  let releaseCapture;
  const capture=child.webContents.mainFrame.executeJavaScript;
  child.webContents.mainFrame.executeJavaScript=script=>new Promise(resolve=>{releaseCapture=async()=>{
    child.webContents.mainFrame.executeJavaScript=capture;resolve(await capture(script));
  };});
  const pending=b.connector.advance(child,flow);
  await b.connector.advance(parent,flow);await releaseCapture();await pending;
  assert.equal(b.connector.status('kolon').code,'LOGIN_CONFIRMED');
  assert.equal(b.inserted.length,0);
});
test('social discovery ignores unrelated footer links and hidden social buttons',t=>{
  const dom=new JSDOM('<body><footer><a href="https://blog.naver.com">네이버</a></footer><div hidden><button>네이버 로그인</button></div></body>',{url:'https://www.kolonmall.com/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:100,height:20});
  const observed=dom.window.eval(`(${captureShoppingLoginPage.toString()})('naver')`);
  assert.equal(observed.provider,null);
});
test('two-stage native login enters the ID once then submits the password once',async t=>{
  const f=await fixture(t);await f.accounts.save({id:'kolon',loginId:'fixture-id',password:'fixture-secret'});
  const b=browserFixture(t,f.accounts),w=new b.BrowserWindow();
  w.dom.window.document.body.innerHTML='<input type="email" name="username"><button>다음</button>';
  const flow={source:sources[1],method:'password',started:Date.now(),acted:new Set()};
  await b.connector.advance(w,flow);await b.connector.advance(w,flow);
  w.dom.window.document.body.innerHTML='<form><input type="password"><button type="submit">로그인</button></form>';
  await b.connector.advance(w,flow);await b.connector.advance(w,flow);
  assert.deepEqual(b.inserted.map(x=>x.value),['fixture-id','fixture-secret']);
});
test('navigation during native focus prevents secrets from reaching the changed page',async t=>{
  const f=await fixture(t);await f.accounts.save({id:'kolon',loginId:'fixture-id',password:'fixture-secret'});
  const b=browserFixture(t,f.accounts),w=new b.BrowserWindow();w.dom.window.document.body.innerHTML=form;
  w.webContents.sendInputEvent=()=>w.dom.reconfigure({url:'https://untrusted.test/login'});
  await assert.rejects(b.connector.advance(w,{source:sources[1],method:'password',started:Date.now(),acted:new Set()}),/LOGIN_PAGE_CHANGED/);
  assert.equal(b.inserted.length,0);
});
test('a lost input focus never types credentials into another control or submits a login',async t=>{
  const f=await fixture(t);await f.accounts.save({id:'kolon',loginId:'fixture-id',password:'fixture-secret'});
  const b=browserFixture(t,f.accounts),w=new b.BrowserWindow();w.dom.window.document.body.innerHTML=form;
  w.webContents.sendInputEvent=()=>{};
  await assert.rejects(b.connector.advance(w,{source:sources[1],method:'password',started:Date.now(),acted:new Set()}),/LOGIN_INPUT_NOT_FOCUSED/);
  assert.equal(b.inserted.length,0);
});
test('automatic login stops at its deadline while a later manual callback can still be confirmed',async t=>{
  const f=await fixture(t);await f.accounts.save({id:'kolon',loginId:'fixture-id',password:'fixture-secret'});
  const b=browserFixture(t,f.accounts),w=new b.BrowserWindow();w.dom.window.document.body.innerHTML=form;
  const flow={source:sources[1],method:'password',started:Date.now()-121000,acted:new Set()};
  await b.connector.advance(w,flow);assert.equal(flow.automaticStopped,true);assert.equal(b.inserted.length,0);
  w.dom.window.document.body.innerHTML='<button>로그아웃</button>';
  await b.connector.advance(w,flow);assert.equal(b.connector.status('kolon').code,'LOGIN_CONFIRMED');
});
test('provider account changes clear only the shops linked through that provider',async()=>{
  const main=await readFile(new URL('../main.mjs',import.meta.url),'utf8');
  const start=main.indexOf('async function clearDomesticLogin(');
  const code=main.slice(start,main.indexOf('\napp.whenReady()',start));
  const removed=[],closed=[],statuses=[];
  const context={DOMESTIC_LOGIN_SOURCES:sources,domesticLoginSource:id=>sources.find(source=>source.id===id),
    DOMESTIC_SEARCH_PARTITION:'persist:fixture',store:{snapshot:()=>({settings:{shoppingAccounts:{kolon:{method:'naver'},musinsa:{method:'kakao'}}}})},
    session:{fromPartition:()=>({cookies:{get:async({domain})=>[{name:'member_session',domain,secure:true}],remove:async url=>removed.push(new URL(url).hostname)}})},
    domesticLoginWindows:new Map(['kolon','naver','musinsa'].map(id=>[id,{close:()=>closed.push(id)}])),
    shoppingAccountServicesCache:{connector:{update:id=>statuses.push(id)}}};
  const clear=runInNewContext(code+'\nclearDomesticLogin',context);
  await clear('naver');
  assert.deepEqual(closed,['kolon','naver']);assert.deepEqual(statuses,['kolon','naver']);
  assert.ok(removed.includes('kolonmall.com'));assert.ok(removed.includes('naver.com'));
  assert.ok(!removed.includes('musinsa.com'));
});
test('shopping secrets are excluded from portable backup and renderer snapshot',async()=>{
  const main=await readFile(new URL('../main.mjs',import.meta.url),'utf8');
  const portable=main.slice(main.indexOf('function publicPortableSnapshot('),main.indexOf('function setOneDriveBackupStatus('));
  assert.match(portable,/"shoppingAccounts"/);
  assert.match(main,/delete snapshot\.settings\.shoppingAccounts/);
});
