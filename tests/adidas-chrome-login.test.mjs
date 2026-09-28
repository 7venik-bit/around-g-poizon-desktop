import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';
import {ShoppingLoginConnector} from '../services/shopping-accounts.mjs';

const main=await readFile(new URL('../main.mjs',import.meta.url),'utf8');
const renderer=await readFile(new URL('../src/shopping-accounts.js',import.meta.url),'utf8');
const section=(start,end)=>main.slice(main.indexOf(start),main.indexOf(end,main.indexOf(start)));
const source={id:'adidas',name:'아디다스 공식몰',url:'https://www.adidas.co.kr/',loginUrl:'https://www.adidas.co.kr/account-login',domains:['adidas.co.kr']};
const accounts={source:id=>id==='adidas'?source:undefined,
  publicAccount:()=>{throw Error('saved account must not be read');},
  credentials:()=>{throw Error('saved credentials must not be read');}};
function connector(openChrome) {
  return new ShoppingLoginConnector({accounts,openChrome,windows:new Map(),
    BrowserWindow:class {constructor(){throw Error('embedded browser must not open');}}});
}

test('Adidas opens its homepage in Chrome without credentials or an embedded login',async()=>{
  const urls=[],c=connector(async url=>urls.push(url));
  const result=await c.open('adidas');
  assert.deepEqual(urls,[source.url]);
  assert.equal(result.ok,true);assert.equal(result.external,true);assert.equal(result.browser,'chrome');
  assert.equal(result.automatic,undefined);
  assert.equal(c.status('adidas').code,'LOGIN_EXTERNAL_OPENED');
  assert.match(result.message,/Chrome에만/);
  assert.equal((await c.open('unknown')).ok,false);assert.equal(urls.length,1);
});

test('Chrome failure is sanitized and does not retry or report successful login',async()=>{
  let attempts=0;
  const c=connector(async()=>{attempts++;throw Error('private-path-and-credential');});
  const result=await c.open('adidas');
  assert.equal(result.ok,false);assert.equal(attempts,1);
  assert.equal(c.status('adidas').code,'CHROME_OPEN_FAILED');
  assert.doesNotMatch(JSON.stringify(result),/private-path|credential/);
});

test('both configured and unconfigured legacy Adidas login routes use the Chrome connector',async()=>{
  const opened=[];
  const ctx={domesticLoginSource:()=>source,shoppingAccountServices:()=>({connector:{open:async id=>{opened.push(id);return {external:true};}}})};
  const result=await runInNewContext(section('async function openDomesticLogin(', 'async function clearDomesticLogin(')+';openDomesticLogin("adidas")',ctx);
  assert.equal(result.external,true);assert.deepEqual(opened,['adidas']);
});

test('production account services request a real Chrome window',async()=>{
  const launches=[];
  const ctx={ShoppingAccounts:class {source(){return source;}},ShoppingLoginConnector,
    store:{},DOMESTIC_LOGIN_SOURCES:[source],encrypted(){},decrypted(){},BrowserWindow:class {},
    DOMESTIC_SEARCH_PARTITION:'unused',domesticLoginWindows:new Map(),mainWindow:null,
    openExternalInChromeTab:async(...args)=>launches.push(args)};
  await runInNewContext(section('let shoppingAccountServicesCache;', 'async function hasUsableNaverLoginSession()')+';shoppingAccountServices().connector.open("adidas")',ctx);
  assert.equal(launches[0][0],source.url);
  assert.equal(launches[0][1].requireChrome,true);assert.equal(launches[0][1].newWindow,true);
});

function launcher({failure=false,platform='win32'}={}) {
  const calls=[],fallback=[];
  const ctx={URL,process:{platform,env:{}},shell:{openExternal:async url=>fallback.push(url)},
    execFile:(file,args,options,done)=>{calls.push({file,args,options});done(failure?Error('failed'):null);}};
  runInNewContext(section('async function openExternalInChromeTab(', 'let mainWindow;'),ctx);
  return {...ctx,calls,fallback};
}
test('strict Chrome launch uses a separate window and passes URL as data',async()=>{
  const f=launcher();
  assert.equal((await f.openExternalInChromeTab(source.url,{requireChrome:true,newWindow:true})).browser,'chrome');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.env.AROUND_G_EXTERNAL_URL,source.url);
  assert.equal(f.calls[0].options.env.AROUND_G_CHROME_NEW_WINDOW,'1');
  assert.equal(f.calls[0].options.windowsHide,true);assert.equal(f.fallback.length,0);
  assert.match(f.calls[0].args.at(-1),/--new-window/);
});
test('strict Chrome failure never silently opens another browser; ordinary links retain fallback',async()=>{
  for(const platform of ['win32','linux']) {
    const f=launcher({failure:true,platform});
    await assert.rejects(f.openExternalInChromeTab(source.url,{requireChrome:true}),/CHROME_OPEN_FAILED/);
    assert.equal(f.fallback.length,0);
    assert.equal((await f.openExternalInChromeTab(source.url)).browser,'default');
    assert.deepEqual(f.fallback,[source.url]);
  }
});

for(const outcome of ['opened','failed','throw']) test(`Adidas settings button: ${outcome}, no save, no misleading session status`,async t=>{
  const dom=new JSDOM('<div id="domestic-login-list"></div>',{runScripts:'outside-only'});t.after(()=>dom.window.close());
  const calls=[];let finish;
  dom.window.aroundG={listShoppingAccounts:async()=>[{...source,methods:['password','naver','kakao'],method:'password',hasSession:true,connection:{code:'LOGIN_CONFIRMED'}}],
    saveShoppingAccount:async()=>{calls.push('save');throw Error('must not save');},
    openShoppingAccount:async id=>{calls.push(id);await new Promise(resolve=>finish=resolve);
      if(outcome==='throw') throw Error('private detail');
      return {ok:outcome==='opened',message:outcome==='opened'?'Chrome에서 열었습니다.':'Chrome을 열지 못했습니다.'};}};
  dom.window.eval(renderer);await dom.window.AroundGShoppingAccounts.render();
  const row=dom.window.document.querySelector('[data-shopping-account="adidas"]'),button=row.querySelector('[data-shop-connect]');
  assert.equal(button.textContent,'Chrome에서 로그인');
  for(const selector of ['[data-shop-save]','[data-shop-clear]','[data-shop-fields]']) assert.equal(row.querySelector(selector).hidden,true);
  assert.equal(row.querySelector('[data-shop-state]').textContent,'Chrome에서 직접 로그인');
  assert.match(row.querySelector('[data-shop-method-hint]').textContent,/자동 검색에는 공유되지 않습니다/);
  button.click();button.click();assert.deepEqual(calls,['adidas']);assert.equal(button.disabled,true);
  finish();await new Promise(setImmediate);
  assert.equal(button.disabled,false);assert.equal(row.dataset.busy,'false');
  assert.match(row.querySelector('[data-shop-message]').textContent,outcome==='opened'?/Chrome에서/:/Chrome을 열지 못했습니다/);
  assert.doesNotMatch(row.textContent,/private detail|로그인 확인 완료|저장된 세션 있음/);
});
