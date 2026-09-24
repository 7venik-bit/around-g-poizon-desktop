import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(join(root, 'src/domestic-inline-results.js'), 'utf8');
function renderer(t) {
  const dom = new JSDOM('<body></body>', {url:'https://offline.test',runScripts:'outside-only'});
  t.after(() => dom.window.close());
  dom.window.aroundG = {openDomesticResult: async () => {}};
  dom.window.renderDomestic = () => '';
  dom.window.eval(source);
  return {window:dom.window, render(result) {
    dom.window.document.body.innerHTML = dom.window.renderDomestic(result, {articleNumber:'JI0079'});
    return dom.window.document.body;
  }};
}

test('lower list routes Naver, SSG and Lotte result links through the app search session', t => {
  const f = renderer(t);
  const urls = ['https://shopping.naver.com/window/search/fashion-group?q=JI0079',
    'https://www.ssg.com/search.ssg?query=JI0079', 'https://www.lotteon.com/search/search/search.ecn?q=JI0079'];
  const body = f.render({products:[],sources:urls.map((url,i)=>({store:`판매처 ${i}`,searchUrl:url}))});
  assert.deepEqual([...body.querySelectorAll('[data-domestic-result-url]')].map(b=>decodeURIComponent(b.dataset.domesticResultUrl)), urls);
  assert.equal(body.querySelectorAll('[data-url]').length, 0);
  const external = f.render({products:[],sources:[{store:'무신사',searchUrl:'https://www.musinsa.com/search/goods?keyword=JI0079'},
    {store:'untrusted',searchUrl:'https://naver.com.example.test/search?q=JI0079'}]});
  assert.equal(external.querySelectorAll('[data-domestic-result-url]').length, 0);
  assert.equal(external.querySelectorAll('[data-url]').length, 2);
});

test('diagnostics stay available alongside partial products without exposing whole pages or tokens', t => {
  const f = renderer(t);
  const body = f.render({partial:true,products:[{store:'롯데온',url:'https://www.lotteon.com/p/product/LO100',price:149000,
    title:'JI0079',inStock:true,sizes:[{label:'270',quantity:3,inStock:true}]}],sources:[{store:'롯데온',count:1,
    verificationReason:'collection_stalled',verificationPending:true,verificationStage:'product_detail',
    verificationDiagnostics:{stage:'product_detail',processedProducts:1,totalProducts:3,failedDetails:1,
      resolvedUrl:'https://www.lotteon.com/search?q=JI0079&token=private-token#secret',
      lastDetailResolvedUrl:'https://nid.naver.com/nidlogin.login?token=private-token#secret',
      lastDetailState:{readiness:'product',loginFormVisible:true,hasVisibleTitle:false},
      lastDetailFailure:'<img src=x onerror=alert(1)>',text:'PRIVATE PAGE BODY',productCardCount:3}}]});
  const details = body.querySelector('details.domestic-inline-diagnostics');
  assert.ok(details);
  assert.equal(details.open, false);
  details.open = true;
  assert.match(details.textContent, /단계: product_detail/);
  assert.match(details.textContent, /상세 확인 필요 수: 1/);
  assert.doesNotMatch(details.textContent, /private-token|secret|PRIVATE PAGE BODY/);
  assert.equal(details.querySelector('img'), null);
  assert.match(details.textContent, /https:\/\/nid\.naver\.com\/nidlogin\.login/);
  assert.match(details.textContent, /로그인 입력창 감지: true/);
  assert.match(body.textContent, /149,000원/);
  assert.match(body.textContent, /재고 3개/);
});

test('Naver search submission diagnostics show the input limit and original request safely', t => {
  const f = renderer(t);
  const body = f.render({products:[],sources:[{store:'네이버 패션타운',
    verificationReason:'search_submission_failed',verificationPending:true,
    verificationStage:'naver_result_navigation',verificationDiagnostics:{
      targetUrl:'https://shopping.naver.com/window/search/fashion-group?q=TLTCM26603WHX',
      originalTargetUrl:'https://shopping.naver.com/window/search/fashion-group?q=LONG&token=private-token#secret',
      submissionStage:'search_input',submissionFailure:'query_exceeds_input_limit',
      inputMaxLength:50,submittedQueryLength:56}}]});
  const details = body.querySelector('details.domestic-inline-diagnostics');
  assert.ok(details);
  assert.match(details.textContent, /검색 입력 실패: query_exceeds_input_limit/);
  assert.match(details.textContent, /입력칸 최대 글자 수: 50/);
  assert.match(details.textContent, /입력 검색어 글자 수: 56/);
  assert.match(details.textContent, /원래 요청 주소: https:\/\/shopping\.naver\.com\/window\/search\/fashion-group\?q=LONG/);
  assert.doesNotMatch(details.textContent, /private-token|secret/);
});

test('authoritative empty Naver and official searches are labeled as absent, not errors', t => {
  const f = renderer(t);
  const sources=['네이버 패션타운','브랜드 공식몰'].map((store,index)=>({store,
    searchQuery:'LM7B80S',count:0,absenceConfirmed:true,searchCompleted:true,
    verificationReason:index?'official_explicit_empty':'naver_explicit_empty',
    verificationStage:index?'official_result_capture':'naver_result_capture'}));
  const body=f.render({products:[],sources});
  const details=body.querySelector('details.domestic-inline-diagnostics');
  assert.ok(details);
  assert.equal((details.textContent.match(/상태: 상품 없음/g)||[]).length,2);
  assert.doesNotMatch(details.textContent,/상태: 오류/);
});

for (const newline of ['\n', '\r\n']) test(`Windows-patched lower-list button uses the search session and user agent (${newline.length === 1 ? 'LF' : 'CRLF'})`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'aroundg-result-route-'));
  t.after(() => rmSync(dir, {recursive:true,force:true}));
  for (const folder of ['src','scripts']) mkdirSync(join(dir,folder));
  for (const file of ['main.mjs','preload.cjs','src/renderer.js','scripts/patch-domestic-result-internal-window.mjs']) {
    writeFileSync(join(dir,file),readFileSync(join(root,file),'utf8').replace(/\r\n/g,'\n').replace(/\n/g,newline));
  }
  execFileSync(process.execPath,[join(dir,'scripts/patch-domestic-result-internal-window.mjs')]);
  const main = readFileSync(join(dir,'main.mjs'),'utf8');
  const patchedRenderer = readFileSync(join(dir,'src/renderer.js'),'utf8');
  const ipcStart = main.indexOf('  ipcMain.handle("domestic:open-result"');
  const ipcEnd = main.indexOf('\n  });',ipcStart) + '\n  });'.length;
  const handlers = new Map(), windows = [];
  class BrowserWindow {
    static getAllWindows() {return windows;}
    constructor(options) {this.options=options;this.webContents={setUserAgent:ua=>this.ua=ua,setWindowOpenHandler(){},getURL:()=>this.url};windows.push(this);}
    isDestroyed(){return false;} isMinimized(){return false;} show(){} focus(){}
    async loadURL(url){this.url=url;}
  }
  runInNewContext(main.slice(ipcStart,ipcEnd),{ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},BrowserWindow,URL,
    APP_ICON_PATH:'',DOMESTIC_SEARCH_PARTITION:'persist:domestic-fixture'});
  const f = renderer(t);
  const url = 'https://shopping.naver.com/window/search/fashion-group?q=JI0079';
  const body = f.render({sources:[{store:'네이버 패션타운',searchUrl:url}],products:[]});
  const button = body.querySelector('[data-domestic-result-url]');
  f.window.aroundG.openDomesticResult = input => handlers.get('domestic:open-result')({},input);
  const clickStart = patchedRenderer.indexOf('  const domesticResultButton = event.target.closest("[data-domestic-result-url]");');
  const clickEnd = patchedRenderer.indexOf('\n  }',clickStart) + '\n  }'.length;
  await runInNewContext(`(async () => {${patchedRenderer.slice(clickStart,clickEnd)}})()`,{event:{target:button},window:f.window});
  assert.equal(windows.length,1);
  assert.equal(windows[0].url,url);
  assert.equal(windows[0].options.webPreferences.partition,'persist:domestic-fixture');
  assert.equal(windows[0].options.show,true);
  assert.equal(windows[0].ua,JSON.parse(main.match(/searchWindow\.webContents\.setUserAgent\(("[^"]+")\)/)[1]));
  await handlers.get('domestic:open-result')({},url);
  assert.equal(windows.length,1,'reuse the same manual inspection window');
});
