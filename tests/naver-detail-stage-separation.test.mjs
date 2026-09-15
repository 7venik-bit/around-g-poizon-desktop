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
function productionFunction(name) {
  const start = main.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Production function missing: ${name}`);
  const end = main.indexOf('\n}\n', start);
  assert.ok(end > start, `Production function end missing: ${name}`);
  const source = main.slice(start, end + 2);
  new Script(source);
  return source;
}
function fixture(t, {html = documentHtml(), resolvedUrl = URL_PRODUCT, collectStock} = {}) {
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
    Date:class extends Date{static now(){return now;}},wait:async ms=>{now+=ms;},
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
  assert.equal(f.optionCalls(),1,'the actual option collector must still be attempted');
});
test('REGRESSION: identity checkpoint precedes optional inventory collection', async t=>{
  let checkpointSeen=false;
  const f=fixture(t,{collectStock:async({updates})=>{
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
