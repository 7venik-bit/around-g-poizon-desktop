import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext, Script } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as relay from '../relay/domestic-search.mjs';
import * as detail from '../services/domestic-detail-page.mjs';
import * as price from '../services/naver-price.mjs';
import * as recovery from '../services/domestic-recovery.mjs';
import { finalizeNaverFashionTownResult } from '../services/naver-fashiontown-result.mjs';

// Offline regression tests execute the production predicates and Naver verifier.
// They do not claim that this HTML is the user's live Naver document.
const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
const URL_PRODUCT = 'https://shopping.naver.com/window-products/outlet/13705625469';
const TITLE = '아디다스 슈퍼스타 2 클라우드 화이트';
const documentHtml = (extra = '') => `<main><h1>${TITLE} JH9976</h1>\n<p>상품 코드: JH9976</p>\n<p>국내 정품 공식 판매처</p>\n<strong class="price">149,000원</strong>\n${extra}</main>`;
const unknownStock = () => ({inStock:null,sizes:[],stockVerified:false,stockCoverage:'unknown',stockStatus:'unknown',stockText:''});
const completeStock = () => ({inStock:true,sizes:[{label:'260',inStock:true,stockText:'선택 가능'}],stockVerified:true,stockCoverage:'complete',stockStatus:'available',stockText:'',stockCheckedAt:new Date().toISOString()});
function productionFunction(name, input = main) {
  // Git's Windows checkout uses CRLF. Normalize only the in-memory test input,
  // without rewriting production files or changing any behavioral assertions.
  const normalized = input.replace(/\r\n?/g, '\n');
  const start = normalized.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Production function missing: ${name}`);
  const end = normalized.indexOf('\n}\n', start);
  assert.ok(end > start, `Production function end missing: ${name}`);
  const source = normalized.slice(start, end + 2);
  new Script(source);
  return source;
}
for (const [label, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test(`production function extraction preserves all Naver predicates with ${label} checkout`, () => {
    const lf = main.replace(/\r\n?/g, '\n');
    const checkout = lf.replace(/\n/g, eol);
    for (const name of ['domesticPageAccessState', 'waitForDomesticDetailReady', 'collectRenderedProductStock', 'verifyApprovedNaverDomesticProducts']) {
      assert.equal(productionFunction(name, checkout), productionFunction(name, lf), name);
    }
    assert.throws(() => productionFunction('missingProductionFunction', checkout), /Production function missing/);
  });
}
function fixture(t, {html = documentHtml(), resolvedUrl = URL_PRODUCT, collectStock, paintAfter = 0, laterHtml = ""} = {}) {
  let now = 0, optionCalls = 0;
  const windows = [], updates = [], navigations = [];
  class BrowserWindow {
    constructor() {
      this.destroyed = false;
      this.dom = new JSDOM('<body></body>', {url:'https://offline.test/',runScripts:'outside-only',pretendToBeVisual:true});
      const w = this.dom.window;
      Object.defineProperty(w.HTMLElement.prototype, 'innerText', {get(){return this.textContent;}});
      w.HTMLElement.prototype.getBoundingClientRect = function(){
        const style = w.getComputedStyle(this);
        return {x:0,y:0,left:0,top:0,right:180,bottom:80,width:style.display==='none'?0:180,height:style.display==='none'?0:80};
      };
      w.HTMLElement.prototype.scrollIntoView = () => {};
      this.webContents = {getURL:()=>this.dom.window.location.href,setUserAgent(){},session:{},
        mainFrame:{executeJavaScript:async code=>{
          if(this.destroyed) throw new Error('Object has been destroyed');
          return this.dom.window.eval(code);
        }}};
      windows.push(this);
    }
    async loadURL(url) {
      navigations.push(url);
      this.dom.reconfigure({url:resolvedUrl || url});
      this.dom.window.document.body.innerHTML = html;
    }
    isDestroyed(){return this.destroyed;}
    destroy(){this.destroyed=true;}
  }
  const context = createContext({...relay,...detail,...price,...recovery,BrowserWindow,URL,console,
    Date:class extends Date{static now(){return now;}},wait:async ms=>{now+=ms;if(paintAfter && now>=paintAfter)for(const w of windows)if(!w.destroyed)w.dom.window.document.body.innerHTML=laterHtml;},
    domesticSearchGeneration:0,domesticSearchCanceled:()=>false,APP_ICON_PATH:'',
    DOMESTIC_SEARCH_PARTITION:'offline-test',activeDomesticSearchWindows:new Set(),
    renderedStockSelectors:()=>[],openRenderedSizeOptions:async()=>false});
  for(const name of ['domesticPageAccessState','waitForDomesticDetailReady','collectRenderedProductStock','verifyApprovedNaverDomesticProducts']) {
    runInContext(productionFunction(name), context);
  }
  const actualCollector = context.collectRenderedProductStock;
  context.collectRenderedProductStock = async (...args) => {
    optionCalls++;
    return collectStock ? collectStock({updates,args,context}) : actualCollector(...args);
  };
  t.after(()=>windows.forEach(w=>w.dom.window.close()));
  const candidate = {store:'네이버 패션타운',sourceStore:'네이버 패션타운',url:URL_PRODUCT,title:TITLE,text:TITLE,price:149000,inStock:null,sizes:[]};
  return {context,updates,navigations,candidate,optionCalls:()=>optionCalls,now:()=>now,
    async document(){const w=new BrowserWindow();await w.loadURL(URL_PRODUCT);return w;},
    verify(overrides={}){return context.verifyApprovedNaverDomesticProducts([candidate],{
      articleNumber:'JH9976',brand:'아디다스',title:TITLE,requireArticleIdentity:true,
      onActivity:async update=>updates.push(structuredClone(update)),...overrides});}};
}

test('visible product text without inventory never becomes stock-ready', async t=>{
  const f=fixture(t),w=await f.document();
  const s=await w.webContents.mainFrame.executeJavaScript(`(${detail.captureDomesticDetailPage.toString()})(${relay.captureRenderedStockEvidence.toString()},[])`);
  assert.equal(s.ready,false);
  assert.ok(s.titleText.includes('JH9976'));
});
test('REGRESSION: product identity can be read before inventory controls exist', async t=>{
  const f=fixture(t),w=await f.document();
  const s=await f.context.waitForDomesticDetailReady(w,'네이버 패션타운',URL_PRODUCT,0,'JH9976','product');
  assert.ok(s.titleText.includes('JH9976'));
  assert.equal(s.ready,false,'identity readiness is not inventory readiness');
  assert.ok(f.now()<25000,'do not wait out the stock deadline for an observed exact identity');
});

test('Fashion Town copyable h3 outside main identifies the current product before options load', async t=>{
  const f=fixture(t,{html:'<header><h1>네이버플러스 스토어</h1></header><div class="_copyable"><h3>아디다스 슈퍼스타 JH9976</h3></div><section><h3>추천 상품 OTHER123</h3></section>'}),w=await f.document();
  const snapshot=await f.context.waitForDomesticDetailReady(w,'네이버 패션타운',URL_PRODUCT,0,'JH9976','product');
  assert.equal(snapshot.visibleTitleText,'아디다스 슈퍼스타 JH9976');
  assert.equal(snapshot.ready,false);
});

test('a recommendation heading cannot replace a different Fashion Town product title', async t=>{
  const f=fixture(t,{html:'<header><h1>네이버플러스 스토어</h1></header><div class="_copyable"><h3>다른 상품 OTHER123</h3></div><section><h3>추천 상품 JH9976</h3></section>'}),w=await f.document();
  await assert.rejects(f.context.waitForDomesticDetailReady(w,'네이버 패션타운',URL_PRODUCT,0,'JH9976','product'),/product_detail_not_ready/);
});

const fashionTownDocument = (productNotice = '') => `<div>디자이너뷰티해외직구</div>
  <div class="vcontainer_item"><p>아디다스 공식 스토어 상품</p>
    <div class="_copyable"><h3>${TITLE} JH9976</h3></div><button>사이즈 선택</button>
  </div><section id="DEFAULT">상품정보\n${productNotice}</section>
  <section id="SELLER">브랜드 공식</section>
  <section id="RECOMMEND">해외직구 추천 상품 QR코드 제거</section>`;

test('Fashion Town global overseas menu and recommended goods do not reject domestic product stock', async t=>{
  const f=fixture(t,{html:fashionTownDocument(),collectStock:()=>completeStock()});
  const result=await f.verify();
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].stockVerified,true);
  assert.equal(result.products[0].domesticSellerVerified,true);
  assert.equal(f.optionCalls(),1);
});

for (const notice of ['해외직구 상품', '해외 배송', '구매 대행', 'QR코드 제거 후 발송']) {
  test(`Fashion Town still rejects the current product notice: ${notice}`, async t=>{
    const f=fixture(t,{html:fashionTownDocument(notice),collectStock:()=>completeStock()});
    const result=await f.verify();
    assert.equal(result.products.length,0);
    assert.equal(result.rejectedCount,1);
    assert.equal(f.optionCalls(),0);
  });
}
test('REGRESSION: rendered Naver search requests product readiness before stock collection',()=>{
  assert.match(main,/const detailReadiness = \/\^네이버\\s\/\.test\(String\(source\.store \|\| ""\)\) \? "product" : "stock"/);
  assert.match(main,/articleNumber, detailReadiness,/);
});
test('default stock readiness remains strict for other callers', async t=>{
  const f=fixture(t),w=await f.document();
  await assert.rejects(f.context.waitForDomesticDetailReady(w,'무신사',URL_PRODUCT,0,'JH9976'),/product_detail_not_ready/);
});
test('metadata-only skeleton cannot qualify as a visible product document', async t=>{
  const f=fixture(t,{html:'<main>상품을 불러오는 중입니다</main>'}),w=await f.document();
  w.dom.window.document.title=TITLE+' JH9976';
  await assert.rejects(f.context.waitForDomesticDetailReady(w,'네이버 패션타운',URL_PRODUCT,0,'JH9976','product'),/product_detail_not_ready/);
});
test('a different host is not an accepted Naver canonical destination', async t=>{
  const f=fixture(t,{resolvedUrl:'https://unrelated.test/products/1'}),w=await f.document();
  await assert.rejects(f.context.waitForDomesticDetailReady(w,'네이버 패션타운',URL_PRODUCT,0,'JH9976','product'),/product_detail_not_ready/);
});
for(const [label,message,error] of [['security','보안 확인이 필요합니다','security_verification_required'],['login','로그인이 필요합니다','login_required']]) {
  test(`${label} restrictions still take precedence over product identity`,async t=>{
    const f=fixture(t,{html:documentHtml(`<p>${message}</p>`)}),w=await f.document();
    await assert.rejects(f.context.waitForDomesticDetailReady(w,'네이버 패션타운',URL_PRODUCT,0,'JH9976','product'),new RegExp(error));
  });
}
test('REGRESSION: Naver retains a card price when only the detail contains its model', async t=>{
  const f=fixture(t),r=await f.verify();
  assert.equal(r.products.length,1);
  assert.equal(r.failedCount,0);
  assert.equal(r.products[0].price,149000);
  assert.equal(r.products[0].articleNumber,'JH9976');
  assert.equal(r.products[0].domesticSellerVerified,true);
  assert.equal(r.products[0].stockVerified,false);
  assert.equal(r.products[0].inStock,null);
  assert.equal(recovery.stockObservationComplete(r.products[0]),false);
  assert.equal(f.optionCalls(),0,'unready inventory must not bypass the stock gate');
  assert.ok(f.now()>=25000,'the separate stock gate must actually be observed');
});
test('REGRESSION: identity checkpoint precedes optional inventory collection', async t=>{
  let checkpointSeen=false;
  const f=fixture(t,{html:documentHtml('<button>구매하기</button>'),collectStock:async({updates})=>{
    checkpointSeen=updates.some(u=>u.products?.some(p=>p.articleNumber==='JH9976'&&p.price===149000));
    assert.ok(checkpointSeen,'verified product was not published before the option wait');
    const p=updates.find(u=>u.products.length)?.products[0];
    assert.equal(p.stockVerified,false);
    assert.equal(p.inStock,null);
    return unknownStock();
  }});
  const r=await f.verify();
  assert.ok(checkpointSeen);
  assert.equal(r.products.length,1);
  assert.equal(recovery.stockObservationComplete(r.products[0]),false);
});
test('REGRESSION: inventory exception preserves identity without claiming complete stock',async t=>{
  const f=fixture(t,{html:documentHtml('<button>구매하기</button>'),collectStock:async()=>{throw new Error('OPTIONS_NOT_READY');}});
  const r=await f.verify();
  assert.equal(r.products.length,1);
  assert.equal(r.products[0].price,149000);
  assert.equal(r.products[0].stockVerified,false);
  assert.equal(r.products[0].inStock,null);
  assert.equal(r.products[0].detailVerificationPending,true);
  assert.equal(recovery.stockObservationComplete(r.products[0]),false);
});
test('completed inventory replaces the provisional state with measured options',async t=>{
  const f=fixture(t,{html:documentHtml('<button>구매하기</button>'),collectStock:async()=>completeStock()}),r=await f.verify();
  assert.equal(r.products.length,1);
  assert.equal(recovery.stockObservationComplete(r.products[0]),true);
  assert.equal(r.products[0].sizes[0].label,'260');
  assert.notEqual(r.products[0].detailVerificationPending,true);
});
test('the verifier still rejects a conflicting product code',async t=>{
  const f=fixture(t,{html:documentHtml('<button>구매하기</button>').replaceAll('JH9976','JH9977')}),r=await f.verify();
  assert.equal(r.products.length,0);
  assert.equal(r.rejectedCount,1);
  assert.equal(f.optionCalls(),0);
});
for(const wording of ['해외 직구 배송','바코드 제거 상품']) {
  test(`excluded seller evidence remains excluded: ${wording}`,async t=>{
    const f=fixture(t,{html:documentHtml(`<p>${wording}</p><button>구매하기</button>`)}),r=await f.verify();
    assert.equal(r.products.length,0);
    assert.equal(f.optionCalls(),0);
  });
}
test('54 captured unique links remain 54; tracking duplicates are not extra details',()=>{
  const cards=Array.from({length:54},(_,i)=>({productUrl:URL_PRODUCT.replace(/\d+$/,String(13705625469+i)),title:TITLE,price:'149,000원'}));
  cards.push({...cards[0],productUrl:cards[0].productUrl+'?NaPm=tracking'});
  const r=finalizeNaverFashionTownResult({productCards:cards},{articleNumber:'JH9976'});
  assert.equal(r.products.length,54);
  assert.equal(r.verificationDiagnostics.productCardCount,55);
  assert.equal(r.verificationDiagnostics.extractedProductCount,54);
});

test('exact-code search verifies matching cards without opening 165 unrelated recommendations',async t=>{
  const f=fixture(t,{html:documentHtml('<button>구매하기</button>'),collectStock:async()=>completeStock()});
  const decoys=Array.from({length:165},(_,i)=>({...f.candidate,
    url:`https://shopping.naver.com/window-products/outlet/${20000000000+i}`,
    title:`추천 운동화 ${i+1}`,text:`추천 운동화 ${i+1}`}));
  const exact={...f.candidate,title:`${TITLE} JH9976`,text:`${TITLE} JH9976 149,000원`};
  const r=await f.context.verifyApprovedNaverDomesticProducts([...decoys,exact],{
    articleNumber:'JH9976',brand:'아디다스',title:TITLE,requireArticleIdentity:true,
  });
  assert.equal(r.candidateCount,1);
  assert.equal(r.checkedCount,1);
  assert.equal(r.products.length,1);
  assert.deepEqual(f.navigations,[URL_PRODUCT]);
});


test('REGRESSION: an option loader cannot become complete inventory after identity succeeds',async t=>{
  const f=fixture(t,{html:documentHtml('<section aria-busy="true"><button>구매하기</button></section>'),collectStock:async()=>completeStock()});
  const r=await f.verify();
  assert.equal(r.products.length,1);
  assert.equal(r.products[0].price,149000);
  assert.equal(f.optionCalls(),0);
  assert.equal(recovery.stockObservationComplete(r.products[0]),false);
  assert.equal(r.products[0].inStock,null);
  assert.ok(f.updates.some(u=>u.products?.length),'identity checkpoint is retained while options stay pending');
});
test('REGRESSION: late inventory is collected only after the stock document becomes ready',async t=>{
  const f=fixture(t,{paintAfter:800,laterHtml:documentHtml('<button>구매하기</button>'),collectStock:async()=>completeStock()});
  const r=await f.verify();
  assert.ok(f.now()>=800&&f.now()<25000);
  assert.equal(f.optionCalls(),1);
  assert.equal(r.products.length,1);
  assert.equal(recovery.stockObservationComplete(r.products[0]),true);
  assert.equal(f.updates[0].products[0].stockVerified,false);
});

test('plain Naver login redirect stops immediately without a login-required sentence', async t => {
  const f = fixture(t, {resolvedUrl:'https://nid.naver.com/nidlogin.login?url=private-token#secret',
    html:'<form><input name="id"><input type="password"><button>로그인</button></form>'});
  const w = await f.document();
  await assert.rejects(f.context.waitForDomesticDetailReady(w,'네이버 패션타운',URL_PRODUCT,0,'JH9976','product'), error => {
    assert.equal(error.message, 'login_required');
    assert.equal(error.loginRequired, true);
    assert.equal(error.detailDiagnostics.resolvedUrl, 'https://nid.naver.com/nidlogin.login');
    assert.equal(error.detailDiagnostics.loginFormVisible, true);
    assert.doesNotMatch(JSON.stringify(error.detailDiagnostics), /private-token|secret/);
    return true;
  });
  assert.equal(f.now(), 0);
});

test('login overlay on the product URL is detected, but a hidden login form is not', async t => {
  for (const hidden of [false, true]) {
    const f = fixture(t, {html:documentHtml(`<section ${hidden ? 'style="display:none"' : ''}><form><input type="password"><button>로그인</button></form></section>`)});
    const w = await f.document();
    const pending = f.context.waitForDomesticDetailReady(w,'네이버 패션타운',URL_PRODUCT,0,'JH9976','product');
    if (hidden) assert.ok((await pending).visibleTitleText.includes('JH9976'));
    else await assert.rejects(pending, /login_required/);
  }
});

test('a login redirect stops the candidate loop and preserves its diagnostic reason', async t => {
  const f = fixture(t, {resolvedUrl:'https://nid.naver.com/nidlogin.login', html:'<h1>NAVER 로그인</h1>'});
  const result = await f.context.verifyApprovedNaverDomesticProducts([f.candidate,
    {...f.candidate, url:URL_PRODUCT.replace(/\d+$/, '99999999')}], {
    articleNumber:'JH9976', requireArticleIdentity:true, onActivity:async update=>f.updates.push(update),
  });
  assert.equal(result.loginRequired, true);
  assert.equal(result.failedCount, 1);
  assert.equal(result.products.length, 0);
  assert.equal(f.navigations.length, 1, 'do not visit the next candidate after an authentication redirect');
  assert.equal(result.detailFailures[0].reason, 'login_required');
  assert.equal(f.updates.at(-1).detailDiagnostics.resolvedUrl, 'https://nid.naver.com/nidlogin.login');
});

test('non-login redirect retains a safe actual destination for diagnosis', async t => {
  const f = fixture(t, {resolvedUrl:'https://shopping.naver.com/error?token=private#secret', html:'<main>잠시 후 다시 시도해 주세요.</main>'});
  const w = await f.document();
  await assert.rejects(f.context.waitForDomesticDetailReady(w,'네이버 패션타운',URL_PRODUCT,0,'JH9976','product'), error => {
    assert.equal(error.message, 'product_detail_not_ready');
    assert.equal(error.detailDiagnostics.resolvedUrl, 'https://shopping.naver.com/error');
    assert.equal(error.detailDiagnostics.expectedPage, false);
    assert.equal(error.detailDiagnostics.hasVisibleTitle, false);
    return true;
  });
});

test('live-observed Naver rate-limit page stops the detail loop without requesting login', async t => {
  // Text and destination observed through the installed app on 2026-09-20.
  // This fixture does not make live requests or imply the restriction is lifted.
  const f = fixture(t, {resolvedUrl:'https://shopv.pstatic.net/web/maintenance/rate-limit.html',
    html:'<main>현재 서비스 접속량이 많습니다. 일시적인 트래픽 증가로 인하여 서비스 연결이 지연되고 있습니다. 잠시 후 다시 시도해주세요.</main>'});
  const r = await f.context.verifyApprovedNaverDomesticProducts([f.candidate,
    {...f.candidate,url:URL_PRODUCT.replace(/\d+$/,'99999999')}],{articleNumber:'JH9976',requireArticleIdentity:true});
  assert.equal(r.rateLimited,true);
  assert.equal(r.loginRequired,false);
  assert.equal(r.securityVerificationRequired,false);
  assert.equal(r.detailFailures[0].reason,'rate_limited');
  assert.equal(r.detailFailures[0].resolvedUrl,'https://shopv.pstatic.net/web/maintenance/rate-limit.html');
  assert.equal(r.products.length,0);
  assert.equal(f.navigations.length,1);
  assert.equal(f.now(),0,'no 25-second wait and no next product request');
});

test('price candidate filtering preserves access restrictions instead of reporting no products', async () => {
  for (const flag of ['rateLimited', 'loginRequired', 'securityVerificationRequired']) {
    const context = createContext({ verifyApprovedNaverDomesticProducts:async()=>({products:[],[flag]:true}) });
    runInContext(productionFunction('filterApprovedNaverDomesticProducts'), context);
    await assert.rejects(context.filterApprovedNaverDomesticProducts([]), error => error[flag] === true);
  }
});

test('rate-limit URL is recognized before its text renders', async t => {
  const f=fixture(t,{resolvedUrl:'https://shopv.pstatic.net/web/maintenance/rate-limit.html',html:''});
  const w=await f.document();
  await assert.rejects(f.context.waitForDomesticDetailReady(w,'네이버 패션타운',URL_PRODUCT,0,'JH9976','product'),/rate_limited/);
  assert.equal(f.now(),0);
});
