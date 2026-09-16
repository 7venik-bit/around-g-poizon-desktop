import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function production(name) {
  const start = main.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const end = main.indexOf('\n}\n', start);
  return main.slice(start, end + 2);
}
const access = runInNewContext(production('domesticPageAccessState') + ';domesticPageAccessState', {URL});
test('Naver login URL without the old Korean sentence is authentication, not a stall', () => {
  const result = access('NAVER 아이디 비밀번호 로그인 상태 유지 로그인', 0, 'https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fshopping.naver.com');
  assert.equal(result.loginRequired, true);
  assert.equal(result.verificationReason, 'login_required');
});
test('Naver price lookup uses the same persistent session as search and Open', () => {
  const search = main.match(/const DOMESTIC_SEARCH_PARTITION = "([^"]+)";/)?.[1];
  const price = main.match(/const DOMESTIC_PRICE_PARTITION = ([^;]+);/)?.[1];
  assert.ok(search?.startsWith('persist:'));
  assert.ok(price === 'DOMESTIC_SEARCH_PARTITION' || price === JSON.stringify(search));
});
test('ordinary login header on a valid shop is not an authentication barrier', () => {
  assert.equal(access('로그인 회원가입 슈퍼스타 JI0079 149,000원', 2, 'https://shopping.naver.com/window/search/fashion-group?q=JI0079').loginRequired, false);
});
test('a lookalike hostname cannot be a Naver login endpoint', () => {
  assert.equal(access('아이디 비밀번호 로그인', 0, 'https://nid.naver.com.attacker.invalid/nidlogin.login').loginRequired, false);
});
test('security restrictions continue to take precedence', () => {
  assert.equal(access('보안 확인이 필요합니다', 0, 'https://nid.naver.com/nidlogin.login').verificationReason, 'security_verification_required');
});

import { JSDOM } from 'jsdom';
import { NaverLoginRecovery, captureNaverLoginState, submitSavedNaverLogin, isNaverCommerceUrl } from '../services/naver-login.mjs';
const target='https://shopping.naver.com/window/search/fashion-group?q=JI0079';
const login='https://nid.naver.com/nidlogin.login';
const form='<main><form method="post" action="/nidlogin.login"><input id="id"><input id="pw" type="password"><button type="submit">로그인</button></form></main>';
const fakeCredentials={enabled:true,id:'fixture-only-account',password:'fixture-only-password'};
function page(t,html=form,url=login) {
  const dom=new JSDOM('<body>'+html+'</body>',{url,runScripts:'outside-only',pretendToBeVisual:true});
  Object.defineProperty(dom.window.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:200,height:40});
  t.after(()=>dom.window.close());
  return dom;
}
function setup(t,{html=form,afterSubmit='success',manualAt=0,credentials=fakeCredentials,timeoutMs=1500,freeze=false}={}) {
  const dom=page(t,html); let now=0,submits=0,creates=0,reads=0,flushes=0,visible=0,canceled=false;
  const session={cookies:{flushStore:async()=>{flushes++;}},flushStorageData:()=>{flushes++;}};
  const complete=()=>{dom.reconfigure({url:target}); dom.window.document.body.innerHTML='<main>JI0079 149,000원</main>';};
  dom.window.document.querySelector('form')?.addEventListener('submit',e=>{
    e.preventDefault(); submits++;
    if(afterSubmit==='success')complete();
    if(afterSubmit==='rejected')dom.window.document.querySelector('form').insertAdjacentHTML('beforeend','<p>아이디 또는 비밀번호를 확인해 주세요.</p>');
    if(afterSubmit==='captcha')dom.window.document.querySelector('form').insertAdjacentHTML('beforeend','<input id="captcha" placeholder="인증번호">');
  });
  const win={isDestroyed:()=>false,show:()=>{visible++;},setTitle(){},loadURL:async()=>{},
    webContents:{mainFrame:{executeJavaScript:async code=>freeze?new Promise(()=>{}):dom.window.eval(code)}}};
  const controller=new NaverLoginRecovery({createWindow:async actual=>{assert.equal(actual,session);creates++;return win;},
    credentials:async()=>{reads++;return credentials;},now:()=>now,
    wait:async ms=>{now+=ms;if(manualAt&&now>=manualAt)complete();},timeoutMs});
  return {controller,session,dom,win,complete,setCanceled:()=>{canceled=true;},
    stats:()=>({submits,creates,reads,flushes,visible}),run:()=>controller.ensure({session,targetUrl:target,canceled:()=>canceled})};
}
for (const url of ['https://nid.naver.com.attacker.invalid/nidlogin.login','http://nid.naver.com/nidlogin.login','https://nid.naver.com:8443/nidlogin.login']) {
  test('credentials never fill an untrusted origin: '+url,async t=>{
    const dom=page(t,form,url),result=dom.window.eval(`(${submitSavedNaverLogin.toString()})(${JSON.stringify(fakeCredentials)})`);
    assert.equal(result.submitted,false);
    assert.equal(dom.window.document.querySelector('#pw').value,'');
  });
}
for (const change of [s=>s.replace('method="post"','method="get"'),s=>s.replace('action="/nidlogin.login"','action="https://attacker.invalid/"'),s=>s.replace('type="submit"','type="submit" formaction="https://attacker.invalid/"'),s=>s.replace('type="submit"','type="submit" formmethod="get"')]) {
  test('untrusted form destination/method does not receive credentials',async t=>{
    const dom=page(t,change(form)),r=dom.window.eval(`(${submitSavedNaverLogin.toString()})(${JSON.stringify(fakeCredentials)})`);
    assert.equal(r.submitted,false);
    assert.equal(dom.window.document.querySelector('#pw').value,'');
  });
}
test('restored login submits once in the same session and flushes persisted state',async t=>{
  const f=setup(t),r=await f.run();assert.equal(r.ok,true);
  assert.deepEqual(f.stats(),{submits:1,creates:1,reads:1,flushes:2,visible:0});
  assert.ok(!JSON.stringify(r).includes(fakeCredentials.password));
});
test('simultaneous search/detail requests use a single login attempt',async t=>{
  const f=setup(t),result=await Promise.all([f.run(),f.run()]);
  assert.ok(result.every(r=>r.ok));assert.equal(f.stats().creates,1);assert.equal(f.stats().submits,1);
});
test('incorrect credentials stop without retrying on following products',async t=>{
  const f=setup(t,{afterSubmit:'rejected'});assert.equal((await f.run()).ok,false);
  assert.equal((await f.run()).ok,false);assert.equal(f.stats().submits,1);assert.equal(f.stats().creates,1);
});
test('CAPTCHA after one submission is left to the user and never resubmitted',async t=>{
  const f=setup(t,{afterSubmit:'captcha',manualAt:800});assert.equal((await f.run()).ok,true);assert.equal(f.stats().submits,1);
});
test('visible OTP waits for manual completion without reading credentials',async t=>{
  const f=setup(t,{html:form.replace('</form>','<input autocomplete="one-time-code"></form>'),manualAt:800});
  assert.equal((await f.run()).ok,true);assert.equal(f.stats().reads,0);assert.equal(f.stats().submits,0);
});
test('no saved account does not invent credentials, manual login can continue',async t=>{
  const f=setup(t,{credentials:null,manualAt:800});assert.equal((await f.run()).ok,true);assert.equal(f.stats().submits,0);
});
test('disabled automatic login never submits even when a password was saved',async t=>{
  const f=setup(t,{credentials:{...fakeCredentials,enabled:false},manualAt:800});assert.equal((await f.run()).ok,true);assert.equal(f.stats().submits,0);
});
test('manual password input is never overwritten',async t=>{
  const dom=page(t);dom.window.document.querySelector('#pw').value='manual-fixture';
  const r=dom.window.eval(`(${submitSavedNaverLogin.toString()})(${JSON.stringify(fakeCredentials)})`);
  assert.equal(r.submitted,false);assert.equal(dom.window.document.querySelector('#pw').value,'manual-fixture');
});
test('cancel before recovery does not open or submit anything',async t=>{
  const f=setup(t);f.setCanceled();assert.equal((await f.run()).reason,'search_canceled');assert.equal(f.stats().creates,0);
});
test('a stuck login document hits a bounded deadline and does not retry',async t=>{
  const f=setup(t,{afterSubmit:'pending'});assert.equal((await f.run()).ok,false);assert.equal((await f.run()).ok,false);assert.equal(f.stats().submits,1);
});
test('a frozen frame evaluation cannot hang the recovery promise',async t=>{
  const f=setup(t,{freeze:true,timeoutMs:1000});const start=Date.now();
  assert.equal((await f.run()).ok,false);assert.ok(Date.now()-start<2500);assert.equal(f.stats().submits,0);
});
test('another login window can restore this shared session without credential submission',async t=>{
  const f=setup(t,{credentials:null,manualAt:800});
  f.controller.observedManualLogin(f.session);
  assert.equal((await f.run()).ok,true);assert.equal(f.stats().submits,0);
});
test('invalid return targets cannot start account automation',async t=>{
  const f=setup(t);
  for(const value of ['https://attacker.invalid/','http://shopping.naver.com/','https://shopping.naver.com:8443/','https://user:pass@shopping.naver.com/']) {
    assert.equal(isNaverCommerceUrl(value),false);
    assert.equal((await f.controller.ensure({session:f.session,targetUrl:value})).ok,false);
  }
  assert.equal(f.stats().creates,0);
});
test('capture never returns password, account input or cookies',async t=>{
  const dom=page(t);dom.window.document.querySelector('#id').value=fakeCredentials.id;dom.window.document.querySelector('#pw').value=fakeCredentials.password;
  const r=JSON.stringify(dom.window.eval(`(${captureNaverLoginState.toString()})()`));
  assert.ok(!r.includes(fakeCredentials.id));assert.ok(!r.includes(fakeCredentials.password));
});
test('portable OneDrive backup excludes Naver account and encrypted password',()=>{
  const input={settings:{naverLoginId:fakeCredentials.id,naverPasswordEncrypted:'encrypted-fixture',naverAutoLogin:true,keep:'value'}};
  const r=runInNewContext(production('publicPortableSnapshot')+';publicPortableSnapshot()',{store:{snapshot:()=>structuredClone(input)}});
  assert.equal(r.settings.keep,'value');assert.equal('naverLoginId' in r.settings,false);assert.equal('naverPasswordEncrypted' in r.settings,false);assert.equal('naverAutoLogin' in r.settings,false);
});
test('public config exposes credential presence, never the encrypted password',()=>{
  const config=runInNewContext(production('publicConfig')+';publicConfig()',{store:{snapshot:()=>({settings:{naverPasswordEncrypted:'encrypted-fixture'}})}});
  assert.equal(config.hasNaverPassword,true);assert.equal('naverPasswordEncrypted' in config,false);
});

import * as relay from '../relay/domestic-search.mjs';
import * as detail from '../services/domestic-detail-page.mjs';
import * as naver from '../services/naver-fashiontown-result.mjs';
function productionWindow(t,{mode='search',restore=true,cancelAfterLogin=false}={}) {
  const dom=page(t,'<main>대기</main>','https://offline.test/');
  let authenticated=false,authCalls=0,canceled=false,now=0;
  const destination=mode==='search'?target:'https://shopping.naver.com/window-products/outlet/13705625469';
  const navigations=[];
  const win={isDestroyed:()=>false,webContents:{getURL:()=>dom.window.location.href,
    mainFrame:{executeJavaScript:async code=>dom.window.eval(code)}},
    loadURL:async url=>{
      navigations.push(url);
      dom.reconfigure({url:authenticated?url:login});
      dom.window.document.body.innerHTML=authenticated
        ? '<main><h1>아디다스 슈퍼스타 JI0079</h1><p>상품 코드 JI0079</p><p>전체 1개</p><a href="https://shopping.naver.com/window-products/outlet/13705625469">JI0079 149,000원</a><button>구매하기</button></main>'
        : form;
    },
    recoverNaverLogin:async url=>{authCalls++;assert.equal(url,destination);authenticated=restore;if(cancelAfterLogin)canceled=true;return {ok:restore};}};
  const context={...relay,...detail,...naver,URL,Date:class extends Date {static now(){return now;}},
    wait:async ms=>{now+=ms;},domesticSearchGeneration:0,domesticSearchCanceled:()=>canceled,renderedStockSelectors:()=>[]};
  const source=['domesticPageAccessState','waitForDomesticDetailReady','loadNaverFashionTownResultPage'].map(production).join('\n');
  const f=runInNewContext(source+';({loadNaverFashionTownResultPage,waitForDomesticDetailReady})',context);
  return {dom,win,navigations,destination,stats:()=>({authCalls,canceled}),
    run:async()=>{
      if(mode==='search')return f.loadNaverFashionTownResultPage(win,destination,'JI0079');
      await win.loadURL(destination);
      return f.waitForDomesticDetailReady(win,'네이버 패션타운',destination,0,'JI0079','product');
    }};
}
test('production search resumes the exact original query after successful login',async t=>{
  const f=productionWindow(t);assert.equal((await f.run()).ok,true);
  assert.equal(f.stats().authCalls,1);assert.deepEqual(f.navigations,[target,target]);
});
test('production detail resumes the same product, retaining strict identity verification',async t=>{
  const f=productionWindow(t,{mode:'detail'});const r=await f.run();
  assert.ok(r.titleText.includes('JI0079'));assert.equal(f.stats().authCalls,1);
  assert.deepEqual(f.navigations,[f.destination,f.destination]);
});
test('failed login is explicit and does not become empty results or another query',async t=>{
  const f=productionWindow(t,{restore:false}),r=await f.run();
  assert.equal(r.loginRequired,true);assert.equal(r.verificationReason,'login_required');
  assert.notEqual(r.absenceConfirmed,true);assert.equal(f.stats().authCalls,1);assert.equal(f.navigations.length,1);
});
test('Stop during detail authentication prevents resume navigation',async t=>{
  const f=productionWindow(t,{mode:'detail',cancelAfterLogin:true});
  await assert.rejects(f.run(),/DOMESTIC_SEARCH_CANCELED/);assert.equal(f.navigations.length,1);
});
