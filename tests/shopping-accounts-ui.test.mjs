import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const script=await readFile(new URL('../src/shopping-accounts.js',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
async function fixture(t,overrides={}) {
  const dom=new JSDOM('<form><input id="nike-login-id" value="old-id"><input id="nike-password"><div id="domestic-login-list"></div></form>',{runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const sources=[{id:'naver',name:'네이버',methods:['password'],method:'password'},
    {id:'kakao',name:'카카오 계정',methods:['password'],method:'password'},
    {id:'nike',name:'나이키 공식몰',methods:['password','naver','kakao'],method:'password',loginId:'old-id',hasPassword:true,configured:true}];
  const calls=[];
  dom.window.aroundG={listShoppingAccounts:async()=>sources,
    saveShoppingAccount:async input=>{calls.push(['save',input]);const source=sources.find(s=>s.id===input.id);Object.assign(source,{loginId:input.loginId,method:input.method,hasPassword:true,configured:true});return {...source};},
    openShoppingAccount:async id=>{calls.push(['open',id]);return {ok:true};},
    clearDomesticLogin:async id=>{calls.push(['clear',id]);return {ok:true};},...overrides};
  dom.window.eval(script);await dom.window.AroundGShoppingAccounts.render();
  const row=dom.window.document.querySelector('[data-shopping-account="nike"]');
  const input=(selector,value)=>{const el=row.querySelector(selector);el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));return el;};
  return {dom,row,sources,calls,input};
}
test('settings provide independent account rows with no duplicate Naver fields',async t=>{
  const f=await fixture(t);
  assert.equal(f.dom.window.document.querySelectorAll('[data-shopping-account]').length,2);
  assert.equal(f.dom.window.document.querySelector('[data-shopping-account="kakao"]').open,true);
  f.row.querySelector('[data-shop-method]').value='naver';
  f.row.querySelector('[data-shop-method]').dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));
  assert.equal(f.row.querySelector('[data-shop-fields]').hidden,true);
  assert.match(f.row.querySelector('[data-shop-method-hint]').textContent,/네이버/);
  f.row.querySelector('[data-shop-connect]').click();await settle();
  assert.deepEqual(f.calls.map(call=>call[0]),['save','open']);
  assert.equal(f.calls[0][1].method,'naver');
  assert.equal(f.calls[1][1],'nike');
});
test('failed save preserves secret input and never opens a login window',async t=>{
  const f=await fixture(t,{saveShoppingAccount:async()=>{throw Error('fixture-sensitive-disk-error');}});
  f.input('[data-shop-id]','replacement-id');f.input('[data-shop-password]','fixture-secret');
  f.row.querySelector('[data-shop-connect]').click();await settle();
  assert.equal(f.row.querySelector('[data-shop-password]').value,'fixture-secret');
  assert.equal(f.row.dataset.dirty,'true');assert.equal(f.row.querySelector('[data-shop-connect]').disabled,false);
  assert.equal(f.calls.length,0);
  assert.doesNotMatch(f.row.textContent,/fixture-sensitive/);assert.match(f.row.textContent,/저장하지 못했습니다/);
});
test('status refresh preserves edited values; successful row save clears password and syncs legacy form',async t=>{
  const f=await fixture(t);f.input('[data-shop-id]','replacement-id');f.input('[data-shop-password]','fixture-secret');
  await f.dom.window.AroundGShoppingAccounts.render();
  assert.equal(f.row.querySelector('[data-shop-id]').value,'replacement-id');
  assert.equal(f.row.querySelector('[data-shop-password]').value,'fixture-secret');
  f.row.querySelector('[data-shop-save]').click();await settle();
  assert.equal(f.row.querySelector('[data-shop-password]').value,'');
  assert.equal(f.dom.window.document.querySelector('#nike-login-id').value,'replacement-id');
  assert.equal(f.calls.length,1);assert.match(f.row.querySelector('[data-shop-state]').textContent,/저장됨/);
});
test('save finishes before connect; double clicks and edits cannot race the in-flight save',async t=>{
  let resolveSave;
  const f=await fixture(t,{saveShoppingAccount:()=>new Promise(resolve=>{resolveSave=resolve;})});
  f.input('[data-shop-password]','fixture-secret');
  f.row.querySelector('[data-shop-connect]').click();f.row.querySelector('[data-shop-connect]').click();
  assert.equal(f.row.querySelector('[data-shop-id]').disabled,true);assert.equal(f.calls.length,0);
  resolveSave({id:'nike',loginId:'old-id'});await settle();
  assert.equal(f.calls.filter(call=>call[0]==='open').length,1);
  assert.equal(f.row.querySelector('[data-shop-id]').disabled,false);
});
test('Enter cannot accidentally submit the enclosing global settings form',async t=>{
  const f=await fixture(t);
  const event=new f.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
  f.row.querySelector('[data-shop-password]').dispatchEvent(event);assert.equal(event.defaultPrevented,true);
});
test('logout failure is visible without exposing internal exception details',async t=>{
  const f=await fixture(t,{clearDomesticLogin:async()=>{throw Error('fixture-private-detail');}});
  f.sources[2].hasSession=true;await f.dom.window.AroundGShoppingAccounts.render();
  f.row.querySelector('[data-shop-clear]').click();await settle();
  assert.match(f.row.textContent,/해제하지 못했습니다/);assert.doesNotMatch(f.row.textContent,/fixture-private/);
});
