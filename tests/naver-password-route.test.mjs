import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';
import {captureShoppingLoginPage} from '../services/shopping-accounts.mjs';

// Sanitized control structure read from nid.naver.com/nidlogin.login on
// 2026-09-18. Passkey controls precede the current password-login controls;
// the old log.login ID is absent. No site tokens or account data are stored.
const markup=language=>`<form><input id="id" name="id"><input id="pw" name="pw" type="password">
  <input id="loginStay" type="checkbox"><label for="loginStay">로그인 상태 유지</label>
  <button id="passkeyBtn_column" type="button">${language==='en'?'Sign in with a Passkey':'패스키 로그인'}</button>
  <button id="loginBtn_column" type="button">${language==='en'?'Sign in':'로그인'}</button>
  <div hidden><button id="passkeyBtn_row" type="button">패스키 로그인</button><button id="loginBtn_row" type="button">로그인</button></div>
  <a href="#qr" id="qrcode_login">QR 코드 로그인</a></form>`;
function page(t,html) {
  const dom=new JSDOM(html,{url:'https://nid.naver.com/nidlogin.login',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window;
  Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
  w.HTMLElement.prototype.getBoundingClientRect=function(){const y=[...w.document.querySelectorAll('*')].indexOf(this)*30;return {left:0,top:y,width:100,height:20};};
  const target=point=>[...w.document.querySelectorAll('*')].find(el=>el.getBoundingClientRect().top+10===point?.y);
  return {dom,w,target};
}
const main=readFileSync(new URL('../main.mjs',import.meta.url),'utf8');
const block=main.slice(main.indexOf('async function submitStoredNaverCredentials('),main.indexOf('function domesticLoginSourceIdsForSearch('));
const injected=block.slice(block.indexOf('executeJavaScript(`')+'executeJavaScript(`'.length,block.indexOf('`, true).catch'));
const directScript=runInNewContext('`'+injected+'`');
for(const language of ['ko','en']) test(`direct and social Naver login select the password button on the current ${language} page`,t=>{
  const {w,target}=page(t,markup(language));
  const direct=w.eval(directScript),social=w.eval(`(${captureShoppingLoginPage.toString()})('password')`);
  assert.equal(target(direct?.submit)?.id,'loginBtn_column','direct Naver must not click the preceding passkey button');
  assert.equal(target(social.submit)?.id,'loginBtn_column','social Naver must not click the preceding passkey button');
});
test('opaque passkey labels cannot be mistaken for a password submit or login entry',t=>{
  const {w}=page(t,'<form><input id="id"><input id="pw" type="password"><button type="submit" id="passkeyBtn_column">로그인</button></form>');
  const direct=w.eval(directScript),social=w.eval(`(${captureShoppingLoginPage.toString()})('password')`);
  assert.equal(direct,null);assert.equal(social.submit,null);assert.equal(social.loginEntry,null);
});
test('desktop layout uses the visible row password button when the column controls are hidden',t=>{
  const {w,target}=page(t,markup('ko'));
  w.document.querySelector('#passkeyBtn_column').hidden=true;
  w.document.querySelector('#loginBtn_column').hidden=true;
  w.document.querySelector('div[hidden]').hidden=false;
  const direct=w.eval(directScript),social=w.eval(`(${captureShoppingLoginPage.toString()})('password')`);
  assert.equal(target(direct.submit)?.id,'loginBtn_row');assert.equal(target(social.submit)?.id,'loginBtn_row');
});
test('hidden legacy password forms cannot trigger a passkey prompt from an unrelated visible button',t=>{
  const {w}=page(t,'<div hidden><input id="id"><input id="pw" type="password"><button id="log.login">로그인</button></div><button id="passkeyBtn_row">패스키 로그인</button>');
  const direct=w.eval(directScript),social=w.eval(`(${captureShoppingLoginPage.toString()})('password')`);
  assert.equal(direct,null);assert.equal(social.submit,null);assert.equal(social.loginEntry,null);
});
