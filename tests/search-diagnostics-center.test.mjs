import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const script = readFileSync(new URL('../src/search-diagnostics.js', import.meta.url), 'utf8');

test('the shipped top menu opens the diagnostics panel', t => {
  const html = readFileSync(new URL('../src/index.html',import.meta.url),'utf8');
  const dom = new JSDOM(html,{url:'https://offline.test',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  dom.window.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  dom.window.eval(script);
  dom.window.AroundGSearchDiagnostics.createController({document:dom.window.document,storage:dom.window.localStorage});
  dom.window.document.querySelector('#search-diagnostics-open').click();
  assert.equal(dom.window.document.querySelector('#search-diagnostics-dialog').open,true);
});

function fixture(t, onAction = async () => {}) {
  const dom = new JSDOM(`<button id="search-diagnostics-open">오류 점검<b id="search-diagnostics-count" hidden>0</b></button>
    <dialog id="search-diagnostics-dialog"><button id="search-diagnostics-close">닫기</button>
      <p id="search-diagnostics-summary"></p><div id="search-diagnostics-list"></div>
      <p id="search-diagnostics-action-status"></p><button id="search-diagnostics-copy">진단 코드 복사</button></dialog>`, {url:'https://offline.test',runScripts:'outside-only'});
  t.after(() => dom.window.close());
  dom.window.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  dom.window.HTMLDialogElement.prototype.close = function () {this.open = false;};
  dom.window.eval(script);
  const controller = dom.window.AroundGSearchDiagnostics.createController({
    document:dom.window.document, storage:dom.window.localStorage, onAction,
  });
  return {window:dom.window, controller};
}

test('approved Naver seller and completed recovery are not counted as errors', t => {
  const {window, controller} = fixture(t);
  controller.recordResult({sources:[
    {store:'네이버 패션타운',verificationReason:'approved_domestic_seller',verificationStage:'naver_result_capture'},
    {store:'브랜드 공식몰',verificationReason:'복구 완료',autoRecovery:{status:'recovered'}},
  ]},{articleNumber:'SR323UTS71',brand:'데상트'},{scope:'excel',key:'row-1'});
  assert.equal(window.document.querySelector('#search-diagnostics-count').hidden,true);
  assert.equal(controller.entries().length,2);
  assert.equal(controller.entries().map(item=>item.state).join(','),'recovered,verified');
  window.document.querySelector('#search-diagnostics-open').click();
  assert.match(window.document.querySelector('#search-diagnostics-summary').textContent,/조치 필요 없음/);
  assert.equal(window.document.querySelectorAll('[data-diagnostic-action]').length,0);
});

test('incomplete stock remains actionable; manual retry updates and resolves the saved issue', async t => {
  let action;
  const {window, controller} = fixture(t, async entry => {action = entry;});
  const context = {scope:'excel',key:'row-1'};
  const product = {articleNumber:'SR323UTS71'};
  controller.recordResult({sources:[{store:'네이버 패션타운',verificationReason:'approved_domestic_seller',
    detailVerificationPending:true}]},product,context);
  assert.equal(controller.entries()[0].code,'stock_unverified');
  assert.equal(controller.entries()[0].state,'open');
  assert.equal(window.document.querySelector('#search-diagnostics-count').textContent,'1');
  window.document.querySelector('#search-diagnostics-open').click();
  const button = window.document.querySelector('[data-diagnostic-action]');
  assert.match(button.textContent,/다시 검색/);
  button.click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(action.key,'row-1');
  controller.recordResult({sources:[{store:'네이버 패션타운',verificationReason:'approved_domestic_seller'}]},product,context);
  assert.equal(controller.entries().find(item=>item.code==='stock_unverified').state,'resolved');
  assert.equal(window.document.querySelector('#search-diagnostics-count').hidden,true);
  const saved = JSON.parse(window.localStorage.getItem('around-g-search-diagnostics-v1'));
  assert.equal(saved.find(item=>item.code==='stock_unverified').state,'resolved');
});

test('access restrictions require a user login action, and rescanning does not invent new attempts', t => {
  const {window, controller} = fixture(t);
  const result = {sources:[{store:'네이버 패션타운',verificationReason:'login_required',loginRequired:true}]};
  controller.recordResult(result,{articleNumber:'A1'},{scope:'explorer',key:'A1'});
  controller.recordResult(result,{articleNumber:'A1'},{scope:'explorer',key:'A1',scan:true});
  assert.equal(controller.entries()[0].count,1);
  assert.equal(controller.entries()[0].action,'login');
  assert.match(window.document.querySelector('[data-diagnostic-action]').textContent,/로그인 확인/);
});

test('rate limits remain manual and never trigger automatic login', t => {
  const {window, controller} = fixture(t);
  controller.recordResult({sources:[{store:'네이버 패션타운',verificationReason:'rate_limited',rateLimited:true}]},
    {articleNumber:'A1'},{scope:'excel',key:'A1'});
  assert.equal(controller.entries()[0].action,'retry');
  assert.match(window.document.querySelector('[data-diagnostic-action]').textContent,/제한 해제 후 다시 검색/);
});

test('copied diagnostics contain codes and stages without raw page or account evidence', async t => {
  const {window, controller} = fixture(t);
  let copied = '';
  window.aroundG = {copyDiagnostics: async text => {copied = text;}};
  controller.recordResult({sources:[{store:'네이버 패션타운',verificationReason:'rate_limited',
    verificationStage:'product_detail',verificationDiagnostics:{pageText:'PRIVATE PAGE',token:'secret'}}]},
  {articleNumber:'A1'},{scope:'excel',key:'A1'});
  window.document.querySelector('#search-diagnostics-copy').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(copied,/rate_limited.*product_detail/);
  assert.doesNotMatch(copied,/PRIVATE PAGE|secret/);
});

test('an authoritative completed search closes a previous retailer failure without a new code', t => {
  const {controller} = fixture(t);
  const context = {scope:'excel',key:'row-2'};
  controller.recordResult({sources:[{store:'무신사',verificationReason:'collection_stalled',verificationPending:true}]},
    {articleNumber:'A2'},context);
  controller.recordResult({sources:[{store:'무신사',searchCompleted:true,absenceConfirmed:true}]},
    {articleNumber:'A2'},context);
  assert.equal(controller.entries().find(item=>item.code==='collection_stalled').state,'resolved');
});

test('diagnostic display treats seller approval as a status, never an error', t => {
  const dom = new JSDOM('<body></body>',{url:'https://offline.test',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  dom.window.renderDomestic = () => '';
  dom.window.eval(readFileSync(new URL('../src/domestic-inline-results.js',import.meta.url),'utf8'));
  const html = dom.window.renderDomestic({products:[],sources:[{store:'네이버 패션타운',searchQuery:'SR323UTS71',
    verificationReason:'approved_domestic_seller',verificationStage:'naver_result_capture'}]},{articleNumber:'SR323UTS71'});
  dom.window.document.body.innerHTML = html;
  const diagnostic = dom.window.document.querySelector('.domestic-inline-diagnostics');
  assert.match(diagnostic.textContent,/상태: 판매처·상품 확인 완료/);
  assert.match(diagnostic.textContent,/판정 코드: approved_domestic_seller/);
  assert.doesNotMatch(diagnostic.textContent,/오류: approved_domestic_seller/);
});
