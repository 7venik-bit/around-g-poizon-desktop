import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext, Script } from 'node:vm';
import { setImmediate as immediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import * as relay from '../relay/domestic-search.mjs';
import * as naver from '../services/naver-fashiontown-result.mjs';
import * as matcher from '../services/matcher.mjs';
import * as recovery from '../services/domestic-recovery.mjs';
import * as brandOfficial from '../services/brand-official-search.mjs';
import * as officialAdapters from '../services/official-mall-adapters.mjs';
import * as brandIntegrity from '../services/brand-integrity.mjs';
import * as naverPrice from '../services/naver-price.mjs';
import * as detailPage from '../services/domestic-detail-page.mjs';

const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));
const channels = [
  ['네이버 패션타운', 'https://shopping.naver.com/window/search/fashion-group?q=SR123UPS11', 'https://shopping.naver.com/window-products/department/123'],
  ['SSG', 'https://www.ssg.com/search.ssg?query=SR123UPS11', 'https://www.ssg.com/item/itemView.ssg?itemId=100'],
  ['롯데온', 'https://www.lotteon.com/search/search/search.ecn?render=search&q=SR123UPS11', 'https://www.lotteon.com/p/product/LO100'],
];

function fixture(t, { delay = 0, navigation = 'resolved', navigationDelay = 0, executeFrozen = false, captureError = false, empty = false, lateSecond = 0, pendingPrice = 0, scrollPage = null, pages = {} } = {}) {
  let now = 0, nextId = 0;
  const timers = new Map(), windows = [], captures = [], navigations = [];
  const setTimer = (fn, ms = 0) => { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id; };
  const clearTimer = id => timers.delete(id);
  class BrowserWindow {
    constructor(options = {}) {
      this.options = options;
      this.destroyed = false;
      this.dom = new JSDOM('<body></body>', { url: 'https://offline.test', runScripts: 'outside-only', pretendToBeVisual: true });
      const w = this.dom.window;
      Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
      w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 180, height: 100 });
      w.scrollTo = () => { if (scrollPage !== null) w.document.body.innerHTML = scrollPage; };
      this.webContents = {
        getURL: () => this.dom.window.location.href,
        isDestroyed: () => this.destroyed,
        setWindowOpenHandler() {}, setUserAgent() {},
        session: { clearCache: async () => {}, clearStorageData: async () => {}, fetch: async () => ({ok:false}) },
        executeJavaScript: async code => {
          if (this.destroyed) throw new Error('Object has been destroyed');
          if (executeFrozen) return new Promise(() => {});
          if (captureError && code.includes('const productCards = []')) throw new Error('Script failed to execute');
          if (code.includes('const productCards = []')) captures.push({ at: now, url: this.webContents.getURL() });
          try { new Script(code); } catch (error) { console.error(error.stack); throw error; }
          return this.dom.window.eval(code);
        },
      };
      this.webContents.mainFrame = { executeJavaScript: this.webContents.executeJavaScript };
      windows.push(this);
    }
    on(name, callback) { if (name === 'closed') this.onClosed = callback; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.onClosed?.(); }
    show() {} maximize() {} focus() {}
    async loadURL(url) {
      navigations.push(url);
      this.dom.reconfigure({ url });
      if (Object.hasOwn(pages, url)) this.dom.window.document.body.innerHTML = pages[url];
      const channel = channels.find(c => c[1] === url);
      if (channel) {
        this.dom.window.document.body.innerHTML = '';
        const paint = () => {
          if (this.destroyed) return;
          this.dom.window.document.body.innerHTML = empty ? '<div>검색 결과가 없습니다</div>'
            : `<div>전체 ${lateSecond ? 2 : 1}개</div><ul aria-busy="${Boolean(pendingPrice)}"><li><a href="${channel[2]}"><img src="https://images.test/product.jpg" alt="데상트 SR123UPS11 카라 셔츠"></a><strong>데상트 SR123UPS11 카라 셔츠</strong><span>본사직영 브랜드직영몰 롯데백화점</span><span class="price">84,550원</span></li></ul>`;
          if (lateSecond) setTimer(() => {
            const card = this.dom.window.document.querySelector('li').cloneNode(true);
            card.querySelector('a').href = channel[2].replace(/123$|100$/, '200');
            this.dom.window.document.querySelector('ul').append(card);
          }, lateSecond);
          if (pendingPrice) setTimer(() => {
            this.dom.window.document.querySelector('.price').textContent = '79,000원';
            this.dom.window.document.querySelector('ul').setAttribute('aria-busy', 'false');
          }, pendingPrice);
        };
        if (delay) setTimer(paint, delay); else paint();
        if (navigation === 'pending') return new Promise(() => {});
        if (navigation === 'rejected') throw new Error('ERR_ABORTED');
        if (navigationDelay) await new Promise(r => setTimer(r, navigationDelay));
      }
    }
  }
  const sandbox = {
    ...relay, ...naver, ...matcher, ...recovery, ...brandOfficial, ...officialAdapters, ...brandIntegrity, ...naverPrice, ...detailPage, BrowserWindow, URL, console,
    Date: class extends Date { static now() { return now; } },
    setTimeout: setTimer, clearTimeout: clearTimer, wait: ms => new Promise(r => setTimer(r, ms)),
    domesticSearchGeneration: 0, domesticSearchCanceled: () => false,
    store: { data: { settings: {} }, snapshot: () => ({ settings: {} }), setSettings: async () => {} },
    activeDomesticSearchWindows: new Set(), APP_ICON_PATH: '', DOMESTIC_SEARCH_PARTITION: 'test',
    DOMESTIC_RETAILER_HARD_TIMEOUT_MS: 90_000,
    NAVER_COLLECTION_GRACE_MS: 45_000,
    OFFICIAL_DOMAIN_STATUS: { VERIFIED: 'verified', SEARCH_UNSUPPORTED: 'unsupported', NO_OFFICIAL_STORE: 'no_official_store' },
    // Network detail adapters are controlled; the actual browser scripts,
    // card parsers, source deadline and aggregation execute unchanged.
    verifyApprovedNaverDomesticProducts: async products => ({ products: products.map(p => ({ ...p, domesticSellerVerified: true, articleNumberVerified: true })), candidateCount: products.length, checkedCount: products.length, failedCount: 0 }),
    clickRenderedProductCard: async (w, url) => {
      await w.loadURL(url);
      if (!Object.hasOwn(pages,url)) w.dom.window.document.body.innerHTML='<main><h1>데상트 SR123UPS11 카라 셔츠</h1><button data-size="100">100 (3개 남음)</button><button>구매하기</button></main>';
      return true;
    },
    openRenderedSizeOptions: async () => {}, renderedStockSelectors: () => [],
    imageFingerprint: async () => null,
    browserWindowUsable: w => Boolean(w && !w.isDestroyed()),
  };
  const context = createContext(sandbox);
  runInContext(section('async function readNaverFashionTownChannelCounts(', '\nasync function ensureNaverOfficialBrandFilter('), context);
  runInContext(section('function renderedSearchFailure(', '\nasync function '), context);
  runInContext(section('async function waitForDomesticCaptureReady(', '\nfunction brandsWithOfficialDomainStatus('), context);
  runInContext(section('async function addMatchConfidence(', '\nasync function verifyAllStoresWithMusinsaImage('), context);
  runInContext(section('async function officialDetailImage(', '\nfunction isNaverSecurityVerificationText('), context);
  runInContext(section('async function submitOfficialMallSearch(', '\nfunction renderedSearchFailure('), context);
  runInContext(section('async function resolveDomesticOfficialBrand(', '\nasync function persistOfficialDomainAudit('), context);
  t.after(() => windows.forEach(w => w.dom.window.close()));
  async function drive(promise) {
    let result, error, done = false;
    promise.then(v => { result = v; done = true; }, e => { error = e; done = true; });
    for (let i = 0; i < 10000 && !done; i++) {
      await immediate();
      if (done) break;
      const entry = [...timers].sort((a,b) => a[1].at - b[1].at)[0];
      assert.ok(entry, 'runtime stalled without a deadline');
      now = entry[1].at;
      timers.delete(entry[0]);
      entry[1].fn();
    }
    assert.ok(done, 'search did not settle');
    if (error) throw error;
    return result;
  }
  const search = list => drive(context.addRenderedSearchCounts({products: [], sources: list.map(([store, searchUrl]) => ({store, searchUrl, searchQuery:'SR123UPS11',renderCount:true,linkOnly:true}))}, 'SR123UPS11', '데상트', '카라 셔츠'));
  function installHandler(list = channels) {
    const handlers = new Map(), events = [];
    // Load the shipping entry-point dependencies too. The restored collector
    // used to be absent here, silently selecting the IPC's otherwise-dead path.
    const restoredStart = main.indexOf('async function september10AddMatchConfidence(');
    if (restoredStart >= 0) runInContext(main.slice(restoredStart, main.indexOf('\nlet store;', restoredStart)), context);
    Object.assign(context, {
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      session: { fromPartition: () => ({ clearCache: async () => {} }) },
      brandSearchProfileKey: () => 'descente', selectBrandSearchStrategy: () => 'brand_code',
      officialDomainRecordForBrand: () => null, recordBrandSearchOutcome: () => ({}),
      queryDomesticProducts: async () => ({ products: [], sources: list.map(([store,searchUrl]) => ({store,searchUrl,searchQuery:'SR123UPS11',renderCount:true,linkOnly:true})) }),
    });
    runInContext(section('let domesticSearchGeneration = 0;', '\nconst DOMESTIC_LOGIN_SOURCES'), context);
    runInContext(section('async function verifyAllStoresWithMusinsaImage(', '\nasync function officialDetailImage('), context);
    runInContext(section('  ipcMain.handle("domestic:search"', '  ipcMain.handle("domestic:cancel"'), context);
    return { events, run: () => drive(handlers.get('domestic:search')({sender:{isDestroyed:()=>false,send:(_name,event)=>events.push(event)}}, {articleNumber:'SR123UPS11',brand:'데상트',title:'카라 셔츠',verifyLinkCounts:true,requestId:'fixture-request'})) };
  }
  return { search, context, drive, captures, navigations, installHandler, now: () => now };
}

test('Naver navigation diagnostics retain a rendered page that never exposes results', async t => {
  const f = fixture(t);
  f.context.BrowserWindow.prototype.loadURL = async function(url) {
    this.dom.reconfigure({url});
    this.dom.window.document.body.innerHTML = '<main>상품 검색 화면을 준비하고 있습니다</main>';
  };
  const result = await f.search([channels[0]]);
  const source = result.sources[0], d = source.verificationDiagnostics;
  assert.equal(source.verificationReason, 'naver_result_not_settled');
  assert.equal(source.verificationStage, 'naver_result_navigation');
  assert.equal(d.expectedPage, true);
  assert.equal(d.productCardCount, 0);
  assert.equal(d.inspectedFrames, 60);
  assert.ok(d.bodyLength > 0);
  assert.equal(d.resolvedUrl, channels[0][1]);
  assert.equal(source.absenceConfirmed, false);
  assert.equal('text' in d, false, 'do not copy the page body into diagnostics');
});

test('Naver accepts a visible external official-store card when the query appears only in its input', async t => {
  const f = fixture(t);
  f.context.BrowserWindow.prototype.loadURL = async function(url) {
    this.dom.reconfigure({url});
    this.dom.window.document.body.innerHTML = '<main><input aria-label="검색" value="SR123UPS11">'
      + '<ul><li><a href="https://dk-on.com/DESCENTE/detail.html?goodsNo=123"><img alt="데상트 카라 셔츠"></a>'
      + '<strong>데상트 카라 셔츠</strong><span>브랜드직영몰</span><span>84,550원</span></li></ul></main>';
  };
  const window = new f.context.BrowserWindow();
  const result = await f.drive(f.context.loadNaverFashionTownResultPage(window,channels[0][1],'SR123UPS11'));
  assert.equal(result.ok,true,JSON.stringify(result));
});

test('Lotte product clicks wait for the actual navigation instead of rejecting after two seconds', async t => {
  const f = fixture(t);
  runInContext(section('async function clickRenderedProductCard(', '\nfunction browserWindowUsable('),f.context);
  const window = new f.context.BrowserWindow();
  const target = channels[2][2];
  window.dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  window.dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({left:20,top:20,width:160,height:80});
  await window.loadURL(channels[2][1]);
  window.webContents.sendInputEvent = event => {
    if (event.type === 'mouseUp') f.context.setTimeout(() => window.dom.reconfigure({url:target}),5000);
  };
  const result = await f.drive(f.context.clickRenderedProductCard(window,target,channels[2][1]));
  assert.equal(result,true,'the exact observed product opens after 5 seconds');
  assert.equal(window.webContents.getURL(),target);
});

test('a product click that opens the wrong product stops without repeating the click', async t => {
  const f = fixture(t);
  runInContext(section('async function clickRenderedProductCard(', '\nfunction browserWindowUsable('),f.context);
  const window = new f.context.BrowserWindow();
  window.dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  window.dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({left:20,top:20,width:160,height:80});
  await window.loadURL(channels[2][1]);
  let clicks = 0;
  window.webContents.sendInputEvent = event => {
    if (event.type === 'mouseUp') {
      clicks++;
      window.dom.reconfigure({url:'https://www.lotteon.com/p/product/WRONG'});
    }
  };
  const result = await f.drive(f.context.clickRenderedProductCard(window,channels[2][2],channels[2][1]));
  assert.equal(result,false,'a different product must never be accepted');
  assert.equal(clicks,1,'observe the existing navigation without resubmitting it');
  assert.ok(f.now() >= 25000 && f.now() < 30000,'navigation observation must remain bounded');
});

for (const channel of channels.slice(1)) test(`${channel[0]} preserves navigation and frame errors instead of discarding them`, async t => {
  const f = fixture(t);
  f.context.BrowserWindow.prototype.loadURL = async function(url) {
    this.dom.reconfigure({url});
    this.webContents.mainFrame.executeJavaScript = async () => { throw new Error('FRAME_NOT_AVAILABLE'); };
    throw new Error('net::ERR_CONNECTION_RESET');
  };
  const result = await f.search([channel]);
  const d = result.sources[0].verificationDiagnostics;
  assert.equal(d.stage, 'retailer_result_navigation');
  assert.equal(d.navigationError, 'net::ERR_CONNECTION_RESET');
  assert.equal(d.inspectionError, 'FRAME_NOT_AVAILABLE');
  assert.equal(d.inspectedFrames, 0);
  assert.equal(result.sources[0].absenceConfirmed, false);
});

test('a frozen retailer frame retains its navigation stage after the watchdog destroys the window', async t => {
  const f = fixture(t, {executeFrozen: true});
  const result = await f.search([channels[2]]);
  const source = result.sources[0];
  assert.equal(source.verificationReason, 'collection_stalled');
  assert.equal(source.verificationStage, 'retailer_result_navigation');
  assert.equal(source.verificationDiagnostics.inspectedFrames, 0);
  assert.equal(source.verificationDiagnostics.resolvedUrl, channels[2][1]);
  assert.equal(source.absenceConfirmed, false);
});

test('production Naver matching retains Adidas Originals JH9976 with Korean retailer brand wording', async t => {
  const f=fixture(t);
  Object.assign(f.context,{DOMESTIC_SELLER_EVIDENCE_PARTITION:'evidence'});
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  const url='https://shopping.naver.com/window-products/department/123';
  const load=f.context.BrowserWindow.prototype.loadURL;
  f.context.BrowserWindow.prototype.loadURL=async function(value){await load.call(this,value);this.dom.window.document.body.innerHTML='<main><h1>아디다스 오리지널스 JH9976 슈퍼스타</h1><p>현대백화점에서 판매하는 상품</p><button data-size="270">270 (3개 남음)</button><button>구매하기</button></main>';};
  const approval=await f.drive(f.context.verifyApprovedNaverDomesticProducts([{store:'네이버 패션타운',title:'아디다스 오리지널스 JH9976 슈퍼스타',url,price:99000}],{articleNumber:'JH9976',brand:'Adidas Originals',title:'슈퍼스타',requireArticleIdentity:true}));
  assert.equal(approval.products.length,1);
  const matched=await f.context.addMatchConfidence({products:approval.products,sources:[{store:'네이버 패션타운'}]}, {articleNumber:'JH9976',brand:'Adidas Originals',title:'슈퍼스타'});
  assert.equal(matched.products.length,1,'a POIZON brand label must not discard the exact retailer product');
  assert.equal(matched.products[0].sizes[0].quantity,3);
});

test('Naver waits for hydrated product/options after the document reports complete', async t => {
  const f=fixture(t);
  Object.assign(f.context,{DOMESTIC_SELLER_EVIDENCE_PARTITION:'evidence'});
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  const load=f.context.BrowserWindow.prototype.loadURL;
  f.context.BrowserWindow.prototype.loadURL=async function(value){await load.call(this,value);this.dom.window.document.body.innerHTML='<main>상품 정보를 불러오는 중</main>';Object.defineProperty(this.dom.window.document,'readyState',{value:'complete',configurable:true});f.context.setTimeout(()=>{this.dom.window.document.body.innerHTML='<main><h1>아디다스 JH9976 슈퍼스타</h1><p>현대백화점에서 판매하는 상품</p><button data-size="270">270 (3개 남음)</button><button>구매하기</button></main>';},6_000);};
  const approval=await f.drive(f.context.verifyApprovedNaverDomesticProducts([{store:'네이버 패션타운',title:'아디다스 JH9976 슈퍼스타',url:'https://shopping.naver.com/window-products/department/123',price:99000}],{articleNumber:'JH9976',brand:'아디다스',title:'슈퍼스타',requireArticleIdentity:true}));
  assert.equal(approval.products[0]?.sizes?.[0]?.quantity,3,'document completion is not product/stock readiness');
});

for (const channel of channels.slice(1)) test(`${channel[0]} waits for its hydrated product and public stock`, async t => {
  const f=fixture(t,{pages:{[channel[2]]:'<main>상품 정보를 불러오는 중</main>'}});
  const load=f.context.BrowserWindow.prototype.loadURL;
  f.context.BrowserWindow.prototype.loadURL=async function(url) {
    await load.call(this,url);
    if(url===channel[2]) f.context.setTimeout(()=>{this.dom.window.document.body.innerHTML='<main><h1>데상트 SR123UPS11 카라 셔츠</h1><button data-size="100">100 (5개 남음)</button><button data-size="105" disabled>105 품절</button><button>구매하기</button></main>';},6_000);
  };
  const result=await f.search([channel]);
  assert.equal(result.products[0].price,84550);
  assert.equal(result.products[0].sizes.find(size=>/100/.test(size.label))?.quantity,5,JSON.stringify(result.products[0]));
  assert.equal(result.products[0].sizes.find(size=>/105/.test(size.label))?.inStock,false);
  assert.equal(result.sources[0].verificationFailed,false);
});

test('SSG card navigation respects itemId with tracking parameters instead of opening the first item', async t => {
  const f=fixture(t);
  runInContext(section('async function clickRenderedProductCard(', '\nfunction browserWindowUsable('),f.context);
  const w=new f.context.BrowserWindow();
  w.dom.reconfigure({url:channels[1][1]});
  w.dom.window.document.body.innerHTML='<a href="https://www.ssg.com/item/itemView.ssg?itemId=999&siteNo=6001">다른 상품</a><a href="https://www.ssg.com/item/itemView.ssg?itemId=100&siteNo=6001">JH9976</a>';
  let scrolled='';
  for (const [index,link] of [...w.dom.window.document.querySelectorAll('a')].entries()) {
    link.scrollIntoView=()=>{scrolled=link.href;};
    link.getBoundingClientRect=()=>({left:index*200,top:0,width:100,height:40});
  }
  w.webContents.sendInputEvent=event=>{if(event.type==='mouseUp') w.dom.reconfigure({url:w.dom.window.document.querySelectorAll('a')[event.x>200?1:0].href});};
  assert.equal(await f.drive(f.context.clickRenderedProductCard(w,channels[1][2],channels[1][1])),true);
  assert.match(scrolled,/itemId=100/);
  assert.match(w.webContents.getURL(),/itemId=100/);
  w.dom.reconfigure({url:channels[1][1]});
  w.webContents.sendInputEvent=event=>{if(event.type==='mouseUp') w.dom.reconfigure({url:'https://www.ssg.com/item/itemView.ssg?itemId=999'});};
  assert.equal(await f.drive(f.context.clickRenderedProductCard(w,channels[1][2],channels[1][1])),false,'another item with the same pathname must fail');
});

test('Naver keeps exact observed card prices when detail data fails and shares the search session', async t => {
  const url='https://shopping.naver.com/window-products/department/123';
  const f=fixture(t,{pages:{[url]:'<main>상품 정보를 불러오는 중</main>'}});
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  const browserSession={name:'existing-search-session'};
  let actualSession;
  const load=f.context.BrowserWindow.prototype.loadURL;
  f.context.BrowserWindow.prototype.loadURL=async function(value){actualSession=this.options.webPreferences.session;return load.call(this,value);};
  const approval=await f.drive(f.context.verifyApprovedNaverDomesticProducts([{store:'네이버 패션타운',title:'아디다스 JH9976',url,price:99000}],{articleNumber:'JH9976',brand:'Adidas Originals',requireArticleIdentity:true,browserSession}));
  const matched=await f.context.addMatchConfidence({products:approval.products,sources:[]},{articleNumber:'JH9976',brand:'Adidas Originals'});
  assert.equal(actualSession,browserSession);
  assert.equal(matched.products[0]?.price,99000);
  assert.equal(matched.products[0]?.inStock,null);
  assert.equal(matched.products[0]?.stockCoverage,'unknown');
  assert.equal(approval.failedCount,1);
  assert.equal(approval.detailFailures[0].reason,'product_detail_not_ready');
});

test('native size placeholder waits for the retailer option response', async t => {
  const f=fixture(t),w=new f.context.BrowserWindow();
  w.dom.window.document.body.innerHTML='<main><h1>아디다스 JH9976</h1><select aria-label="사이즈"><option value="">사이즈 선택</option></select><button>구매하기</button></main>';
  f.context.setTimeout(()=>{w.dom.window.document.querySelector('select').innerHTML+='<option value="270">270 (3개 남음)</option><option value="280" disabled>280 품절</option>';},6_000);
  const stock=await f.drive(f.context.collectRenderedProductStock(w,'롯데온'));
  assert.equal(stock.sizes.find(size=>/270/.test(size.label))?.quantity,3,JSON.stringify(stock));
  assert.equal(stock.sizes.find(size=>/280/.test(size.label))?.inStock,false);
});

test('detail navigation preserves colour variants while ignoring retailer tracking fields', () => {
  const base='https://www.ssg.com/item/itemView.ssg?itemId=100';
  assert.equal(detailPage.domesticProductUrlIdentity(base),detailPage.domesticProductUrlIdentity(base+'&siteNo=6001&NaPm=tracking'));
  assert.notEqual(detailPage.domesticProductUrlIdentity(base+'&color=BLACK'),detailPage.domesticProductUrlIdentity(base+'&color=WHITE'));
});

test('Naver partial-price retention excludes wrong models, brands and barcode-removed sellers', async t => {
  const f=fixture(t);
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  f.context.waitForDomesticDetailReady=async()=>{throw new Error('product_detail_not_ready');};
  const candidates=[{title:'아디다스 JI0079'},{title:'Nike JH9976'},{title:'아디다스 JH9976',text:'바코드 제거 상품'}]
    .map((p,index)=>({...p,url:'https://shopping.naver.com/window-products/department/'+index,price:99000}));
  const result=await f.drive(f.context.verifyApprovedNaverDomesticProducts(candidates,{articleNumber:'JH9976',brand:'Adidas Originals',requireArticleIdentity:true}));
  assert.equal(result.products.length,0);
});

test('a Naver detail access restriction remains explicit and stops further detail attempts', async t => {
  const url='https://shopping.naver.com/window-products/department/123';
  const f=fixture(t,{pages:{[url]:'<main>보안 확인 CAPTCHA</main>'}});
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  const result=await f.drive(f.context.verifyApprovedNaverDomesticProducts([{title:'아디다스 JH9976',url,price:99000},{title:'아디다스 JH9976',url:url+'4',price:99000}],{articleNumber:'JH9976',brand:'Adidas Originals',requireArticleIdentity:true}));
  assert.equal(result.securityVerificationRequired,true);
  assert.equal(f.navigations.length,1);
  assert.equal(result.products[0]?.price,99000);
  assert.equal(result.products[0]?.stockVerified,false);
});

for (const channel of channels) test(`${channel[0]}: actual source deadline allows visible cards and prices to reach aggregation`, async t => {
  const f = fixture(t);
  const result = await f.search([channel]);
  assert.equal(result.sources[0].verificationFailed, false, JSON.stringify(result.sources[0]));
  assert.equal(result.products.length, 1, 'visible product was discarded before capture');
  assert.equal(result.products[0].price, 84550);
  assert.ok(f.captures.length > 0);
});

test('matching returns verified prices without an out-of-scope aggregation variable', async t => {
  const f = fixture(t);
  const result = await f.drive(f.context.addMatchConfidence({sources:[],products:[{store:'무신사',title:'데상트 SR123UPS11',articleNumber:'SR123UPS11',price:84550,url:'https://www.musinsa.com/products/1'}]}, {articleNumber:'SR123UPS11',brand:'데상트'}));
  assert.equal(result.domesticPriceCandidates[0].price, 84550);
});

for (const channel of channels.slice(1)) test(`${channel[0]} reads search data before nonessential resources finish loading`, async t => {
  const f=fixture(t,{navigation:'pending'});
  const result=await f.search([channel]);
  assert.equal(result.products[0]?.price,84550);
  assert.equal(result.products[0]?.sizes[0]?.quantity,3);
  assert.ok(f.now()<35_000,'the full-page load promise must not consume the collection budget');
});

test('three retailer card parsers retain their own prices in one complete search', async t => {
  const f = fixture(t);
  const result = await f.search(channels);
  assert.equal(result.products.length, 3);
  assert.deepEqual(Array.from(result.products, p => p.price), [84550, 84550, 84550]);
  assert.ok(result.sources.every(s => !s.verificationFailed));
  assert.ok(f.now() >= 75_000, 'preserve a full observation window for every retailer');
  assert.ok(f.now() < 3 * 90_000);
});

for (const channel of channels) test(`${channel[0]}: declared second card arriving at 18 seconds is captured`, async t => {
  const f = fixture(t, { lateSecond: 18_000 });
  const result = await f.search([channel]);
  assert.equal(result.products.length, 2, JSON.stringify(result.sources[0]));
  assert.ok(f.captures[0].at >= 18_000);
  assert.ok(f.now() < 90_000);
});

test('wait for pending price hydration before storing the current price', async t => {
  const f = fixture(t, { pendingPrice: 7_000 });
  const result = await f.search([channels[0]]);
  assert.equal(result.products[0].price, 79000);
});

for (const channel of channels) test(`${channel[0]}: a parsed empty page remains an authoritative absence`, async t => {
  const f = fixture(t, { empty: true });
  const result = await f.search([channel]);
  assert.equal(result.products.length, 0);
  assert.equal(result.sources[0].absenceConfirmed, true, JSON.stringify(result.sources[0]));
});

test('a stalled retailer remains bounded and is not reported as product absence', async t => {
  const f = fixture(t, { executeFrozen: true });
  const result = await f.search([channels[1]]);
  assert.equal(result.sources[0].verificationReason, 'collection_stalled');
  assert.equal(result.sources[0].absenceConfirmed, false);
  assert.ok(f.now() <= 90_000);
});

test('Naver gets one bounded collection grace period without repeating its search', async t => {
  const f = fixture(t);
  let searches = 0;
  f.context.renderedSearchSourceResult = async (source) => {
    searches += 1;
    await f.context.wait(100_000);
    return {count:1,products:[{store:source.store,sourceStore:source.store,title:'데상트 SR123UPS11 카라 셔츠',
      articleNumber:'SR123UPS11',articleNumberVerified:true,price:84550,url:channels[0][2],
      inStock:null,sizes:[],stockVerified:false,stockCoverage:'unknown'}],searchCompleted:true};
  };
  const result = await f.search([channels[0]]);
  assert.equal(searches, 1, 'the grace period must not resubmit the Naver query');
  assert.equal(f.now(), 100_000);
  assert.equal(result.products.length, 1);
  assert.equal(result.sources[0].verificationFailed, false);
});

test('the complete IPC path keeps progressing past two minutes and returns every retailer', async t => {
  const f = fixture(t, {delay:18_000,navigationDelay:18_000});
  const h = f.installHandler([...channels,...channels]);
  const response = await h.run();
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.data.sources.length, 6);
  assert.equal(response.data.products.length, 3,JSON.stringify(response.data.sources));
  assert.ok(f.now() > 120_000, 'exercise the former overall cutoff');
  assert.ok(response.data.sources.every(s => !s.verificationFailed));
  assert.equal(response.data.technicalWarnings.length, 0, JSON.stringify(response.data.technicalWarnings));
  assert.ok(h.events.some(event => event.phase === 'checkpoint'), 'shipping IPC must retain stock checkpoints');
});

for (const ErrorType of [SyntaxError, ReferenceError, TypeError]) test(`IPC exposes ${ErrorType.name} as a collector error and continues the next retailer`, async t => {
  const f = fixture(t);
  const original = f.context.analyzeRenderedChannelProducts;
  f.context.analyzeRenderedChannelProducts = (content, store, ...rest) => {
    if (store === 'SSG') throw new ErrorType('collector fixture error');
    return original(content, store, ...rest);
  };
  const response = await f.installHandler(channels.slice(1)).run();
  assert.equal(response.ok, true);
  const source = response.data.sources.find(s => s.store === 'SSG');
  assert.equal(source.verificationReason, 'result_script_failed');
  assert.equal(source.verificationStage, 'result_capture');
  assert.equal(source.verificationDiagnostics.errorMessage, 'collector fixture error');
  assert.equal(source.absenceConfirmed, false);
  assert.equal(source.searchCompleted, false);
  assert.ok(response.data.products.some(p => (p.sourceStore || p.store) === '롯데온'));
});

test('Electron-wrapped capture exceptions remain script failures in the production IPC', async t => {
  const f = fixture(t, {captureError:true});
  const response = await f.installHandler([channels[0]]).run();
  assert.equal(response.data.sources[0].verificationReason, 'result_script_failed');
  assert.equal(response.data.sources[0].verificationDiagnostics.errorMessage, 'Script failed to execute');
  assert.equal(response.data.sources[0].absenceConfirmed, false);
  assert.equal(response.data.partial, true);
});

test('SSG classification preserves query-source identity for completed stock in the IPC', async t => {
  const f = fixture(t);
  const response = await f.installHandler([channels[1]]).run();
  assert.equal(response.ok, true);
  assert.equal(response.data.products.length, 1);
  assert.match(response.data.products[0].store, /^SSG/);
  assert.equal(response.data.products[0].sourceStore, 'SSG');
  assert.equal(response.data.products[0].stockVerified, true);
  assert.equal(response.data.partial, false, JSON.stringify(response.data));
});

test('the shared IPC finishes every retailer while new stock options continue past four minutes', async t => {
  const f = fixture(t);
  const h = f.installHandler();
  f.context.renderedSearchSourceResult = async (source, _article, _brand, _title, _retry, _attempt, _shared, _generation, activity) => {
    const options = [];
    const url = channels.find(c => c[0] === source.store)[2];
    for (let size = 250; size <= 290; size += 10) {
      await f.context.wait(30_000);
      options.push({size:String(size),stockText:'3개 남음',quantity:3,inStock:true});
      await activity({option:String(size), optionCheckpoint:{url, options:[...options], branches:[], checkedAt:new Date().toISOString()}});
    }
    const products = [{store:source.store,title:'데상트 SR123UPS11 카라 셔츠',articleNumber:'SR123UPS11',articleNumberVerified:true,price:84550,url,stockOptions:options}];
    await activity({products,completedProducts:1,totalProducts:1});
    return {count:1,products,searchCompleted:true};
  };
  const result = await h.run();
  assert.equal(result.timedOut, undefined);
  assert.equal(result.data.products.length, 3);
  assert.ok(result.data.sources.every(source => !source.verificationFailed));
  assert.ok(f.now() > 4 * 60_000);
});

test('an empty product checkpoint never waits for a POIZON image download', async t => {
  const f = fixture(t);
  let imageReads = 0;
  f.context.imageFingerprint = async () => { imageReads++; return null; };
  await f.context.addMatchConfidence({products:[],sources:[]}, {articleNumber:'JH9976',imageUrl:'https://images.test/source.jpg'});
  assert.equal(imageReads, 0);
});

test('option checkpoints persist without repeating product image verification', async t => {
  const f = fixture(t);
  const h = f.installHandler([channels[1]]);
  let verifications = 0;
  const original = f.context.addMatchConfidence;
  f.context.addMatchConfidence = async (...args) => { verifications++; return original(...args); };
  f.context.renderedSearchSourceResult = async (_source,_a,_b,_t,_r,_q,_s,_g,activity) => {
    const before = verifications;
    for (let size=1; size<=20; size++) await activity({option:String(size),optionCheckpoint:{url:channels[1][2],options:Array(size).fill({quantity:3}),branches:[]}});
    assert.equal(verifications, before);
    return {count:0,products:[],absenceConfirmed:true,searchCompleted:true};
  };
  const response = await h.run();
  assert.equal(response.ok, true);
  assert.ok(h.events.some(event => event.checkpoint?.optionCheckpoints?.[channels[1][2]]?.options?.length === 20));
});

test('repeating the same stock option remains bounded and the next retailer runs', async t => {
  const f = fixture(t);
  const h = f.installHandler([channels[1],channels[2]]);
  f.context.renderedSearchSourceResult = async (source,_a,_b,_t,_r,_q,_s,_g,activity) => {
    if (source.store === '롯데온') return {count:0,products:[],absenceConfirmed:true,searchCompleted:true};
    for (let i=0;i<20;i++) { await f.context.wait(20_000); await activity({option:'250',optionCheckpoint:{url:channels[1][2],options:[{size:'250'}],branches:[]}}); }
    return {count:0,products:[]};
  };
  const response = await h.run();
  assert.equal(response.data.sources[0].verificationReason, 'collection_stalled');
  assert.equal(response.data.sources[0].verificationStage, 'stock_options');
  assert.equal(response.data.sources[1].absenceConfirmed, true);
  assert.ok(f.now() <= 110_000);
});

test('LotteON captures the result grid before scrolling can replace it with recommendations', async t => {
  const f = fixture(t, { scrollPage: '<aside>추천 상품<a href="https://www.lotteon.com/p/product/LO999"><img alt="다른 상품">OTHER12345 9,000원</a></aside>' });
  const result = await f.search([channels[2]]);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].url, channels[2][2]);
  assert.equal(f.navigations.includes('https://www.lotteon.com/p/product/LO999'), false);
});

test('fallback failure retains the actual query and submitted URL in diagnostics', async t => {
  const f = fixture(t);
  const queries = ['SR123UPS11', '데상트 카라 셔츠'];
  const attempts = queries.map(query => ({ query, url: `https://www.lotteon.com/csearch/search/search?q=${encodeURIComponent(query)}` }));
  let calls = 0;
  f.context.renderedSearchSourceResult = async () => ++calls === 1
    ? { count: 0, products: [], absenceConfirmed: true, searchCompleted: true }
    : { count: null, products: [], verificationReason: 'result_script_failed', verificationStage: 'result_capture' };
  const result = await f.drive(f.context.addRenderedSearchCounts({ products: [], sources: [{store:'롯데온',renderCount:true,
    searchQuery:queries[0],searchUrl:attempts[0].url,searchAttempts:attempts}] }, queries[0]));
  assert.equal(calls, 2);
  assert.equal(result.sources[0].searchQuery, queries[1]);
  assert.equal(result.sources[0].verificationDiagnostics.targetUrl, attempts[1].url);
  assert.equal(result.sources[0].absenceConfirmed, false);
});

test('completed empty queries count as progress before the next distinct fallback', async t => {
  const f = fixture(t);
  const attempts = ['SR123UPS11', '데상트 카라 셔츠', '데상트 카라 셔츠 SR123UPS11']
    .map(query => ({query, url:`https://www.lotteon.com/csearch/search/search?q=${encodeURIComponent(query)}`}));
  const seen = [];
  f.context.renderedSearchSourceResult = async (_source,_code,_brand,_title,_retry,attempt) => {
    seen.push(attempt.query);
    await f.context.wait(40_000);
    return {count:0,products:[],absenceConfirmed:true,searchCompleted:true,resolvedSearchUrl:attempt.url};
  };
  const result = await f.drive(f.context.addRenderedSearchCounts({products:[],sources:[{
    store:'롯데온',renderCount:true,searchAttempts:attempts,searchUrl:attempts[0].url,
  }]}, 'SR123UPS11'));
  assert.deepEqual(seen, attempts.map(a => a.query));
  assert.equal(result.sources[0].absenceConfirmed, true);
  assert.equal(result.sources[0].verificationReason, '');
  assert.equal(f.now(), 120_000);
});

for (const [store,url,html,reason] of [
  ['네이버 패션타운','https://shopping.naver.com/window/search/fashion-group?q=JH9976','<main>보안 확인을 완료해 주세요. <input placeholder="정답"></main>','security_verification_required'],
  ['무신사','https://www.musinsa.com/search/goods?keyword=JH9976&gf=A','<main>서비스 접속이 원활하지 않습니다. 잠시 후 다시 이용해 주세요.</main>','service_unavailable'],
]) test(`${store}: an observed access/error page ends the source promptly without declaring absence`, async t => {
  const f=fixture(t,{pages:{[url]:html}});
  const result=await f.drive(f.context.addRenderedSearchCounts({products:[],sources:[{store,searchUrl:url,searchQuery:'JH9976',renderCount:true,searchAttempts:[{query:'JH9976',url},{query:'다른 검색어',url}]}]},'JH9976','아디다스','슈퍼스타'));
  assert.equal(result.sources[0].verificationReason, reason);
  assert.equal(result.sources[0].absenceConfirmed, false);
  assert.equal(result.sources[0].searchCompleted, false);
  assert.equal(f.navigations.filter(value => value === url).length, 1);
  assert.ok(f.now() < 10_000);
});

test('Musinsa explicit zero takes precedence over promotional product cards below the results', async t => {
  const url='https://www.musinsa.com/search/goods?keyword=JH9976&gf=A';
  const f=fixture(t,{pages:{[url]:'<main>JH9976 새 상품0 USED0 검색 결과가 없습니다. 다른 검색어를 입력해 보세요.<section>회원가입 이벤트 상품<a href="https://www.musinsa.com/products/123">오드타입 3,990원</a></section></main>'}});
  const result=await f.drive(f.context.addRenderedSearchCounts({products:[],sources:[{store:'무신사',searchUrl:url,searchQuery:'JH9976',renderCount:true}]},'JH9976','아디다스','슈퍼스타'));
  assert.equal(result.sources[0].absenceConfirmed, true);
  assert.equal(result.products.length, 0);
  assert.ok(!f.navigations.includes('https://www.musinsa.com/products/123'));
});

test('ordinary login navigation and member benefits do not block visible retailer products', t => {
  const f=fixture(t);
  assert.equal(f.context.domesticPageAccessState('회원 로그인 · 로그인 후 할인 혜택을 받으세요', 1).verificationReason, '');
  assert.equal(f.context.domesticPageAccessState('로그인이 필요합니다', 0).verificationReason, 'login_required');
  assert.equal(f.context.domesticPageAccessState('보안 확인을 완료해 주세요', 1).verificationReason, 'security_verification_required');
});

test('a real stall returns the last verified checkpoint instead of discarding its products', async t => {
  const f = fixture(t);
  f.installHandler();
  const checkpoint = {products:[{store:'무신사',price:84550}],sources:[{store:'무신사',searchCompleted:true}]};
  const response = await f.drive(f.context.withDomesticSearchHardTimeout(new Promise(()=>{}), 0, {lastProgressAt:0,checkpoint}));
  assert.equal(response.ok, true);
  assert.equal(response.data.partial, true);
  assert.equal(response.data.products[0].price, 84550);
  assert.equal(response.timedOut, true);
});

test('IPC returns verified retailer prices promptly if final preference saving never returns', async t => {
  const f = fixture(t);
  const h = f.installHandler();
  f.context.store.setSettings = () => new Promise(()=>{});
  const response = await h.run();
  assert.equal(response.ok, true);
  assert.equal(response.data.searchLearning.saved, false);
  assert.ok(response.data.technicalWarnings.some(w => w.stage === 'search_learning_save'));
  assert.equal(response.data.products.length, 3);
  assert.ok(response.data.products.every(p => p.price === 84550));
  assert.ok(response.data.sources.every(s => s.searchCompleted));
  assert.ok(f.now() < 120_000, 'completed results must not wait for stalled preference saving');
});

test('a stalled fallback remains bounded after a completed empty query', async t => {
  const f = fixture(t);
  const h = f.installHandler([channels[1]]);
  f.context.queryDomesticProducts = async () => ({products:[],sources:[{store:'SSG',renderCount:true,linkOnly:true,searchUrl:channels[1][1],searchAttempts:[{query:'SR123UPS11'},{query:'카라 셔츠'},{query:'카라 셔츠 SR123UPS11'}]}]});
  const attempts = [];
  f.context.renderedSearchSourceResult = async (_source,_article,_brand,_title,_retry,attempt) => {
    attempts.push(attempt.query);
    await f.context.wait(attempts.length === 1 ? 60_000 : 120_000);
    const products = attempts.length === 3 ? [{store:'SSG',title:'데상트 SR123UPS11 카라 셔츠',articleNumber:'SR123UPS11',articleNumberVerified:true,price:84550,url:channels[1][2]}] : [];
    return {count:products.length,products,absenceConfirmed:!products.length,searchCompleted:true};
  };
  const response = await h.run();
  assert.equal(attempts.length, 2);
  assert.equal(response.ok, true);
  assert.equal(response.data.products.length, 0);
  assert.equal(response.data.sources[0].verificationReason, 'collection_stalled');
  assert.equal(response.data.sources[0].absenceConfirmed, false);
  assert.equal(f.now(), 150_000);
});

test('an expired old source timer cannot close a window opened after cancellation', async t => {
  const f = fixture(t, {executeFrozen:true});
  const h = f.installHandler([channels[1]]);
  const protectedWindow = {destroyed:false,isDestroyed(){return this.destroyed;},destroy(){this.destroyed=true;}};
  f.context.protectedWindow = protectedWindow;
  f.context.setTimeout(() => {
    f.context.cancelDomesticSearches();
    runInContext('activeDomesticSearchWindows.add(protectedWindow)',f.context);
  },10_000);
  const response = await h.run();
  assert.equal(response.canceled,true);
  assert.equal(protectedWindow.destroyed,false);
});

const officialHome = 'https://official.example/';
const officialSearch = 'https://official.example/search?keyword=SR123UPS11';
const officialProduct = 'https://official.example/products/4021';
const officialCard = (title = '남녀공용 카라 셔츠', url = officialProduct) => `<main><h1>SR123UPS11 검색 결과</h1><ul><li><a href="${url}"><img src="https://images.test/product.jpg" alt="${title}"></a><strong>${title}</strong><span class="price">84,550원</span></li></ul></main>`;
const officialSource = {store:'브랜드 공식몰',renderCount:true,linkOnly:true,officialStatus:'verified',homepageUrl:officialHome,officialProductUrl:officialSearch,searchUrl:officialSearch,searchQuery:'SR123UPS11'};

test('official search execution check runs its generated script and recognizes the submitted result', async t => {
  const f = fixture(t, {pages:{[officialSearch]:officialCard()}});
  const w = new f.context.BrowserWindow();
  await w.loadURL(officialSearch);
  assert.equal(await f.context.officialMallSearchWasExecuted(w,'SR123UPS11',officialHome),true);
});

test('official cards without a printed model number survive the complete IPC and matching path', async t => {
  const f = fixture(t, {pages:{[officialSearch]:officialCard(),[officialProduct]:'<main><h1>남녀공용 카라 셔츠</h1><span class="price">84,550원</span></main>'}});
  const h = f.installHandler([]);
  f.context.queryDomesticProducts = async () => ({products:[],sources:[officialSource]});
  const response = await h.run();
  assert.equal(response.ok,true,JSON.stringify(response));
  assert.equal(response.data.products.length,1,'captured official card was lost during final matching');
  assert.equal(response.data.products[0].url,officialProduct);
  assert.equal(response.data.products[0].price,84550);
  assert.notEqual(response.data.products[0].articleNumberVerified,true,'a search-result card must not fabricate exact article evidence');
  assert.equal(response.data.domesticPriceCandidates[0].price,84550);
});

test('an official result exposing a conflicting model stays excluded', async t => {
  const f = fixture(t, {pages:{[officialSearch]:officialCard('다른 제품 SR323UTS71')}});
  const h = f.installHandler([]);
  f.context.queryDomesticProducts = async () => ({products:[],sources:[officialSource]});
  const response = await h.run();
  assert.equal(response.data.products.length,0);
});

test('an off-domain link is not accepted as an official result', async t => {
  const f = fixture(t, {pages:{[officialSearch]:officialCard('남녀공용 카라 셔츠','https://unrelated.example/products/1')}});
  const h = f.installHandler([]);
  f.context.queryDomesticProducts = async () => ({products:[],sources:[officialSource]});
  const response = await h.run();
  assert.equal(response.data.products.length,0);
});

test('unsubmitted official homepage cards do not become verified search results', async t => {
  const f = fixture(t, {pages:{[officialHome]:officialCard()}});
  const h = f.installHandler([]);
  f.context.queryDomesticProducts = async () => ({products:[],sources:[{...officialSource,officialProductUrl:officialHome,searchUrl:officialHome}]});
  const response = await h.run();
  assert.equal(response.data.products.length,0);
});

test('official product IDs carried in query parameters remain separate in the final list', async t => {
  const one = 'https://official.example/product/detail?goodsNo=4021';
  const two = 'https://official.example/product/detail?goodsNo=4022';
  const f = fixture(t, {pages:{[officialSearch]:officialCard('남녀공용 카라 셔츠 화이트',one)+officialCard('남녀공용 카라 셔츠 블랙',two)}});
  const h = f.installHandler([]);
  f.context.queryDomesticProducts = async () => ({products:[],sources:[officialSource]});
  const response = await h.run();
  assert.equal(response.data.products.length,2,'different goodsNo products were collapsed by dropping the query string');
  assert.deepEqual(Array.from(response.data.products,p=>p.url).sort(),[one,two]);
});

test('a similar official product image alone cannot bypass query-result evidence', async t => {
  const f = fixture(t);
  f.context.imageFingerprint = async () => [true];
  f.context.fingerprintSimilarity = () => 1;
  const result = await f.drive(f.context.addMatchConfidence({sources:[],products:[{store:'브랜드 공식몰',title:'데상트 남녀공용 카라 셔츠',price:84550,url:officialProduct,imageUrl:'https://images.test/similar.jpg'}]}, {articleNumber:'SR123UPS11',brand:'데상트',title:'남녀공용 카라 셔츠',imageUrl:'https://images.test/source.jpg'}));
  assert.equal(result.products.length,0);
});

for (const label of ['품절','SOLD OUT','솔드아웃','재고 없음','현재 구매할 수 없는 상품입니다.']) {
  test(`platform stock wording is preserved and unavailable: ${label}`, () => {
    const result = relay.normalizeRenderedStockEvidence({pageText:label,purchaseAvailable:true});
    assert.equal(result.stockText,label);
    assert.equal(result.inStock,false);
  });
}

test('all platform stock notices survive normalization without translation', () => {
  const result = relay.normalizeRenderedStockEvidence({pageText:'현재 구매할 수 없는 상품입니다.\n품절'});
  assert.equal(result.stockText,'현재 구매할 수 없는 상품입니다.\n품절');
});

test('rendered official detail keeps sold-out notices and excludes its price from purchase candidates', async t => {
  const f = fixture(t,{pages:{[officialSearch]:officialCard(),[officialProduct]:'<header><a href="/cart">장바구니</a></header><main><h1>남녀공용 카라 셔츠</h1><p>현재 구매할 수 없는 상품입니다.</p><button disabled>품절</button></main>'}});
  const h=f.installHandler([]);
  f.context.queryDomesticProducts=async()=>({products:[],sources:[officialSource]});
  const response=await h.run();
  assert.equal(response.data.products.length,1);
  assert.equal(response.data.products[0].inStock,false);
  assert.equal(response.data.products[0].stockText,'현재 구매할 수 없는 상품입니다.\n품절');
  assert.equal(response.data.domesticPriceCandidates.length,0);
});

test('Kolon API product is refreshed from its own sold-out detail page', async t => {
  const url='https://www.kolonmall.com/Product/SR123UPS11';
  const f=fixture(t,{pages:{[url]:'<main><h1>데상트 SR123UPS11 카라 셔츠</h1><p>현재 구매할 수 없는 상품입니다.</p><button disabled>품절</button></main>'}});
  const h=f.installHandler([]);
  f.context.queryDomesticProducts=async()=>({products:[{store:'코오롱몰',id:'SR123UPS11',title:'데상트 SR123UPS11 카라 셔츠',articleNumber:'SR123UPS11',price:84550,inStock:true,url}],sources:[{store:'코오롱몰',ok:true,renderCount:false,count:1}]});
  const response=await h.run();
  assert.equal(response.data.products.length,1);
  assert.equal(response.data.products[0].inStock,false);
  assert.equal(response.data.products[0].stockText,'현재 구매할 수 없는 상품입니다.\n품절');
});

test('stock capture ignores another product and delivery-policy notices', async t => {
  const url='https://official.example/products/own';
  const f=fixture(t,{pages:{[url]:'<header><a>장바구니</a></header><main><section><h1>현재 상품</h1><button>구매하기</button></section><aside><h2>추천 상품</h2><button disabled>SOLD OUT</button></aside><div class="delivery">품절 시 환불됩니다.</div></main>'}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const snapshot=await w.webContents.executeJavaScript(`(${relay.captureRenderedStockEvidence.toString()})()`);
  const result=relay.normalizeRenderedStockEvidence(snapshot);
  assert.equal(result.inStock,true);
  assert.equal(result.stockText,'');
});

test('one sold-out option does not mark the entire product sold out', async t => {
  const url='https://official.example/products/options';
  const f=fixture(t,{pages:{[url]:'<main><h1>사이즈 선택</h1><button data-size="95">95 재고 있음</button><button data-size="100" disabled>100 SOLD OUT</button><button>구매하기</button></main>'}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const snapshot=await w.webContents.executeJavaScript(`(${relay.captureRenderedStockEvidence.toString()})()`);
  const result=relay.normalizeRenderedStockEvidence(snapshot);
  assert.equal(result.inStock,true);
  assert.equal(result.stockText,'');
  assert.equal(result.sizes[1].stockText,'100 SOLD OUT');
  assert.equal(result.sizes[1].inStock,false);
});

test('Naver seller verification retains the product detail stock text', async t => {
  const url=channels[0][2];
  const f=fixture(t,{pages:{[url]:'<main><h1>데상트 SR123UPS11 카라 셔츠</h1><p>공식 롯데백화점에서 판매중인 상품</p><p>품번 SR123UPS11</p><button disabled>SOLD OUT</button></main>'}});
  Object.assign(f.context,{DOMESTIC_SELLER_EVIDENCE_PARTITION:'test',isDomesticNaverPriceCard:()=>true,isApprovedNaverDomesticSellerEvidence:()=>true,brandsMatch:()=>true});
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  const result=await f.drive(f.context.verifyApprovedNaverDomesticProducts([{title:'데상트 SR123UPS11 카라 셔츠',url}],{articleNumber:'SR123UPS11',brand:'데상트',title:'카라 셔츠',requireArticleIdentity:true}));
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].stockText,'SOLD OUT');
  assert.equal(result.products[0].inStock,false);
  assert.equal(f.context.activeDomesticSearchWindows.size, 0);
});

test('the JH9976 queryType=ac source collects its detail price and public stock into the result', async t => {
  const url=relay.naverFashionTownUrl('overview','아디다스','JH9976');
  assert.equal(url,'https://shopping.naver.com/window/search/fashion-group?q=JH9976&queryType=ac');
  const detail='https://shopping.naver.com/window-products/department/123';
  const f=fixture(t,{pages:{
    [url]:`<main>JH9976 전체 1개<ul><li><a href="${detail}">아디다스 JH9976</a><strong>아디다스 JH9976 슈퍼스타</strong><span>롯데백화점</span><span>99,000원</span></li></ul></main>`,
    [detail]:'<main><h1>아디다스 JH9976 슈퍼스타</h1><p>공식 롯데백화점 품번 JH9976</p><p>99,000원</p><button data-size="270">270 (3개 남음)</button><button data-size="280" disabled>280 (품절)</button><p>1인 최대 2개 구매</p><button>구매하기</button></main>',
  }});
  Object.assign(f.context,{DOMESTIC_SELLER_EVIDENCE_PARTITION:'test',isDomesticNaverPriceCard:()=>true,isApprovedNaverDomesticSellerEvidence:()=>true,brandsMatch:()=>true});
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  const result=await f.drive(f.context.addRenderedSearchCounts({products:[],sources:[{store:'네이버 패션타운',searchUrl:url,searchQuery:'JH9976',renderCount:true}]},'JH9976','아디다스','슈퍼스타'));
  assert.equal(result.products.length,1,JSON.stringify(result.sources));
  assert.equal(result.products[0].price,99000);
  assert.equal(result.products[0].sizes[0].quantity,3);
  assert.match(result.products[0].sizes[0].stockText,/3개 남음/);
  assert.equal(result.products[0].sizes[1].inStock,false);
  assert.equal(result.sources[0].absenceConfirmed,false);
});

test('the Naver detail browser belongs to cancellation cleanup during stock collection', async t => {
  const url=channels[0][2];
  const f=fixture(t,{pages:{[url]:'<main><h1>데상트 SR123UPS11 카라 셔츠</h1><p>공식 롯데백화점 품번 SR123UPS11</p><button>구매하기</button></main>'}});
  Object.assign(f.context,{DOMESTIC_SELLER_EVIDENCE_PARTITION:'test',isDomesticNaverPriceCard:()=>true,isApprovedNaverDomesticSellerEvidence:()=>true,brandsMatch:()=>true});
  let tracked=false;
  f.context.collectRenderedProductStock=async w=>{tracked=f.context.activeDomesticSearchWindows.has(w);w.destroy();return {};};
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  await f.drive(f.context.verifyApprovedNaverDomesticProducts([{title:'데상트 SR123UPS11 카라 셔츠',url}],{articleNumber:'SR123UPS11',brand:'데상트',title:'카라 셔츠',requireArticleIdentity:true}));
  assert.equal(tracked,true);
  assert.equal(f.context.activeDomesticSearchWindows.size,0);
});

test('Naver Fashion Town keeps exact domestic inventory for every brand without a seller banner', async t => {
  const url=channels[0][2];
  const f=fixture(t,{pages:{[url]:'<main><h1>코오롱스포츠 JWJJM26321 남성 재킷</h1><p>품번 JWJJM26321</p><button>구매하기</button><div role="option">100</div><div role="option" aria-disabled="true">105 품절</div></main>'}});
  Object.assign(f.context,{DOMESTIC_SELLER_EVIDENCE_PARTITION:'test',isDomesticNaverPriceCard:()=>true,isApprovedNaverDomesticSellerEvidence:()=>false,brandsMatch:()=>true});
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  const result=await f.drive(f.context.verifyApprovedNaverDomesticProducts([{title:'코오롱스포츠 JWJJM26321 남성 재킷',url}],{articleNumber:'JWJJM26321',brand:'코오롱스포츠',title:'남성 재킷',requireArticleIdentity:true}));
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].articleNumberVerified,true);
  assert.equal(result.products[0].domesticSellerVerified,true);
});

test('Naver Fashion Town route fallback still rejects barcode-removed sellers', async t => {
  const url=channels[0][2];
  const f=fixture(t,{pages:{[url]:'<main><h1>코오롱스포츠 JWJJM26321 남성 재킷</h1><p>품번 JWJJM26321</p><p>QR코드 제거 후 발송</p><div role="option">100</div></main>'}});
  Object.assign(f.context,{DOMESTIC_SELLER_EVIDENCE_PARTITION:'test',isDomesticNaverPriceCard:()=>true,isApprovedNaverDomesticSellerEvidence:()=>false,brandsMatch:()=>true});
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  const result=await f.drive(f.context.verifyApprovedNaverDomesticProducts([{title:'코오롱스포츠 JWJJM26321 남성 재킷',url}],{articleNumber:'JWJJM26321',brand:'코오롱스포츠',title:'남성 재킷',requireArticleIdentity:true}));
  assert.equal(result.products.length,0);
  assert.equal(result.rejectedCount,1);
});

test('Naver brand-direct card keeps inventory from its external official detail', async t => {
  const url='https://official.example/products/JWJJM26321';
  const f=fixture(t,{pages:{[url]:'<main><h1>코오롱스포츠 JWJJM26321 남성 재킷</h1><p>품번 JWJJM26321</p><button data-size="100">100</button><button>구매하기</button></main>'}});
  Object.assign(f.context,{DOMESTIC_SELLER_EVIDENCE_PARTITION:'test',isDomesticNaverPriceCard:()=>true,isApprovedNaverDomesticSellerEvidence:()=>false,brandsMatch:()=>true});
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  const finalized=naver.finalizeNaverFashionTownResult({productCards:[{productUrl:url,title:'코오롱스포츠 JWJJM26321 남성 재킷',officialBrandStoreLabelMatched:true}]},{articleNumber:'JWJJM26321'});
  assert.equal(finalized.products[0].naverTrustedChannelEvidence,true);
  const result=await f.drive(f.context.verifyApprovedNaverDomesticProducts(finalized.products,{articleNumber:'JWJJM26321',brand:'코오롱스포츠',title:'남성 재킷',requireArticleIdentity:true}));
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].articleNumberVerified,true);
  assert.equal(result.products[0].sizes[0].label,'100');
});

test('official product collector excludes repeated home navigation links', async t => {
  const page=`<main><nav><a href="https://official.example/shop/home">홈</a><a href="https://official.example/shop/women">홈</a></nav>${officialCard()}</main>`;
  const f=fixture(t,{pages:{[officialSearch]:page}});
  runInContext(section('async function collectOfficialMallSearchProducts(', '\nfunction renderedSearchFailure('),f.context);
  const w=new f.context.BrowserWindow();await w.loadURL(officialSearch);
  const products=await f.drive(f.context.collectOfficialMallSearchProducts(w,'SR123UPS11'));
  assert.equal(products.length,1);
  assert.equal(products[0].url,officialProduct);
  assert.notEqual(products[0].title,'홈');
});

test('a product purchase area in an aside retains the Kolon sold-out message', async t => {
  const url='https://www.kolonmall.com/Product/JWJJM26321DGY';
  const f=fixture(t,{pages:{[url]:'<main><img alt="남성 트레이닝 재킷"><aside><h1>남성 트레이닝 재킷 (SET UP)</h1><p>현재 구매할 수 없는 상품입니다.</p><button disabled>품절</button></aside></main>'}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const snapshot=await w.webContents.executeJavaScript(`(${relay.captureRenderedStockEvidence.toString()})()`);
  const result=relay.normalizeRenderedStockEvidence(snapshot);
  assert.equal(result.stockText,'현재 구매할 수 없는 상품입니다.\n품절');
  assert.equal(result.inStock,false);
});

test('manual official search results retain the card stock wording', async t => {
  const f=fixture(t,{pages:{[officialSearch]:officialCard().replace('</li>','<span>재고 없음</span></li>')}});
  runInContext(section('async function collectOfficialMallSearchProducts(', '\nfunction renderedSearchFailure('),f.context);
  const w=new f.context.BrowserWindow();await w.loadURL(officialSearch);
  const products=await f.drive(f.context.collectOfficialMallSearchProducts(w,'SR123UPS11'));
  assert.equal(products.length,1);
  assert.equal(products[0].stockText,'재고 없음');
  assert.equal(products[0].inStock,false);
});

test('Kolon exact model search keeps sold-out products with a human-readable name', () => {
  const html='{"__typename":"productResult","code":"JWJJM26321DGY","name":"남성 트레이닝 재킷 (SET UP)","supplierBrandName":"코오롱스포츠","representationImage":"https://images.test/jacket.jpg","soldOutYn":"Y","price":{"price":100000,"wishPrice":200000}}';
  const products=relay.parseKolonSearch(html,'JWJJM26321DGY');
  assert.equal(products.length,1);
  assert.equal(products[0].inStock,false);
  assert.equal(products[0].url,'https://www.kolonmall.com/Product/JWJJM26321DGY');
  assert.equal(relay.parseKolonSearch(html,'OTHER12345').length,0);
});

test('purchase limits and imminent-sellout promotion are not inventory evidence', () => {
  const result=relay.normalizeRenderedStockEvidence({stockTexts:['*ID당 구매 가능 수량 10개','실시간 인기 품절 임박 아이템'],purchaseAvailable:true});
  assert.equal(result.inStock,true);
  assert.equal(result.stockText,'');
  assert.equal(result.purchaseLimitText,'*ID당 구매 가능 수량 10개');
  const unknown=relay.normalizeRenderedStockEvidence({pageText:'*ID당 구매 가능 수량 10개'});
  assert.equal(unknown.inStock,null);
});

test('explicit stock counts preserve source wording, including zero stock', () => {
  assert.equal(relay.normalizeRenderedStockEvidence({pageText:'재고: 0개',purchaseAvailable:true}).inStock,false);
  const result=relay.normalizeRenderedStockEvidence({pageText:'남은 수량 3개'});
  assert.equal(result.stockText,'남은 수량 3개');
  assert.equal(result.inStock,true);
});

test('size capture reads leaf controls and excludes purchase quantities and size guides', async t => {
  const url='https://official.example/products/sizes';
  const f=fixture(t,{pages:{[url]:'<main><h1>재킷</h1><div class="size-list"><button data-size="90">90</button><button data-size="95">95 (재고 3개)</button><button data-size="100" disabled><span>100</span><span> SOLD OUT</span></button></div><button class="size-guide">사이즈 가이드</button><label>구매 수량<select name="quantity"><option>1</option><option>2</option></select></label><p>*ID당 구매 가능 수량 10개</p><p>실시간 인기 품절 임박 아이템</p><button>구매하기</button></main>'}});
  runInContext(section('function renderedStockSelectors(', '\nasync function clickRenderedProductCard('),f.context);
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const snapshot=await w.webContents.executeJavaScript(`(${relay.captureRenderedStockEvidence.toString()})(${JSON.stringify(f.context.renderedStockSelectors('브랜드 공식몰'))})`);
  const result=relay.normalizeRenderedStockEvidence(snapshot);
  assert.deepEqual(result.sizes.map(s=>[s.label,s.inStock]),[['90',true],['95 (재고 3개)',true],['100 SOLD OUT',false]]);
  assert.equal(result.inStock,true);
  assert.equal(result.stockText,'');
  assert.equal(result.purchaseLimitText,'*ID당 구매 가능 수량 10개');
});

test('Kolon stock refresh opens size choices before capturing the result', async t => {
  const url='https://www.kolonmall.com/Product/JKJGX25272SBU';
  const f=fixture(t,{pages:{[url]:'<main><h1>여성 방수재킷</h1><button>구매하기</button></main>'}});
  let opened=0;
  f.context.openRenderedSizeOptions=async w=>{opened++;w.dom.window.document.querySelector('main').insertAdjacentHTML('beforeend','<button data-size="90">90</button><button data-size="95" disabled>95 품절</button>');};
  const result=await f.drive(f.context.refreshDomesticProductStock({url,store:'코오롱몰'}));
  assert.equal(opened,1);
  assert.deepEqual(result.sizes.map(s=>s.label),['90','95 품절']);
});

test('Kolon stock refresh has an absolute deadline even while option activity continues', async t => {
  const url='https://www.kolonmall.com/Product/JKJGX25272SBU';
  const f=fixture(t,{pages:{[url]:'<main><h1>여성 방수재킷</h1><button>구매하기</button></main>'}});
  f.context.waitForDomesticCaptureReady=async()=>true;
  f.context.collectRenderedProductStock=async(_w,_store,_generation,onActivity)=>{
    for (;;) { await onActivity({option:'확인 중'}); await f.context.wait(5); }
  };
  const result=await f.drive(f.context.refreshDomesticProductStock({url,store:'코오롱몰'},0,null,[],[],25));
  assert.equal(result.stockStatus,'unknown');
  assert.equal(result.stockVerified,false);
});

test('opening size options keeps already-visible choices open', async t => {
  const url='https://official.example/products/open-options';
  const f=fixture(t,{pages:{[url]:'<main><h1>재킷</h1><button aria-expanded="true">사이즈 선택</button><div role="listbox"><div role="option">90</div><div role="option">95 품절</div></div><button>구매하기</button></main>'}});
  runInContext(section('async function openRenderedSizeOptions(', '\nasync function clickRenderedProductCard('),f.context);
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  w.webContents.sendInputEvent=()=>assert.fail('visible size choices must not be toggled');
  assert.equal(await f.drive(f.context.openRenderedSizeOptions(w)),false);
});

test('Naver verified seller detail opens options and returns their availability', async t => {
  const url=channels[0][2];
  const f=fixture(t,{pages:{[url]:'<main><h1>데상트 SR123UPS11 카라 셔츠</h1><p>공식 롯데백화점에서 판매중인 상품</p><p>품번 SR123UPS11</p><button>구매하기</button></main>'}});
  Object.assign(f.context,{DOMESTIC_SELLER_EVIDENCE_PARTITION:'test',isDomesticNaverPriceCard:()=>true,isApprovedNaverDomesticSellerEvidence:()=>true,brandsMatch:()=>true,
    openRenderedSizeOptions:async w=>w.dom.window.document.querySelector('main').insertAdjacentHTML('beforeend','<div role="option">95</div><div role="option" aria-disabled="true">100 품절</div>')});
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('),f.context);
  const result=await f.drive(f.context.verifyApprovedNaverDomesticProducts([{title:'데상트 SR123UPS11 카라 셔츠',url}],{articleNumber:'SR123UPS11',requireArticleIdentity:true}));
  assert.equal(result.products.length,1);
  assert.deepEqual(result.products[0].sizes.map(s=>[s.label,s.inStock]),[['95',true],['100 품절',false]]);
});

test('live Nike radio markup retains all six sizes and disabled XS/XXL labels', async t => {
  const url='https://www.nike.com/kr/t/fixture/IM8402-411';
  const html=readFileSync(new URL('./fixtures/retailer-stock/nike-options.html',import.meta.url),'utf8');
  const f=fixture(t,{pages:{[url]:`<main><h1>나이키 스포츠웨어</h1>${html}<button>장바구니</button></main>`}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const result=await f.drive(f.context.collectRenderedProductStock(w,'네이버 패션타운'));
  assert.equal(result.stockStrategy,'nike');
  assert.deepEqual(result.sizes.map(s=>[s.label,s.inStock]),[['XS',false],['S',true],['M',true],['L',true],['XL',true],['XXL',false]]);
});

for(const [name,host,code,color,labels,soldout] of [
  ['northface','www.thenorthfacekorea.co.kr','NJ1DR65B','REAL_BLACK',['085(XS)','090(S)','095(M)','100(L)','105(XL)','110(XXL)','115(XXXL)'],[]],
  ['skechers','www.skecherskorea.co.kr','SP0MRCGY051','BBK',['250','255','260','265','270','275','280','290','300','310','320'],['275','280','290','300','310']],
])test(`${name}: actual brand markup keeps the selected SKU and excludes restock-modal choices`,async t=>{
  const url=`https://${host}/product/${code}`;
  const html=readFileSync(new URL(`./fixtures/retailer-stock/${name}-options.html`,import.meta.url),'utf8');
  const f=fixture(t,{pages:{[url]:`<main><h1>${code}</h1>${html}<button>바로구매</button></main>`}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const result=await f.drive(f.context.collectRenderedProductStock(w,'브랜드 공식몰'));
  assert.equal(result.stockStrategy,name);
  assert.deepEqual(result.sizes.map(s=>[s.label,s.inStock]),labels.map(label=>[`${color} / ${label}`,!soldout.includes(label)]));
  assert.equal(w.webContents.getURL(),url,'related colour product links must not change this SKU');
  assert.equal(result.stockCoverage,'observed');
});

test('unlisted brand mixes radio colours with dependent native sizes without dropping either dimension',async t=>{
  const url='https://new-brand.example/product/1';
  const f=fixture(t,{pages:{[url]:'<main><h1>재킷</h1><label><input type="radio" name="color" value="black">블랙</label><label><input type="radio" name="color" value="white">화이트</label><select name="size"><option value="">선택하세요</option></select><button>구매하기</button></main>'}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  for(const radio of w.dom.window.document.querySelectorAll('[name=color]'))radio.addEventListener('change',()=>{
    w.dom.window.document.querySelector('[name=size]').innerHTML=radio.value==='black'?'<option value="95">95 (재고 2개)</option><option value="100" disabled>100 품절</option>':'<option value="95" disabled>95 SOLD OUT</option>';
  });
  const result=await f.drive(f.context.collectRenderedProductStock(w,'브랜드 공식몰'));
  assert.deepEqual(result.sizes.map(s=>s.label),['블랙 / 95 (재고 2개)','블랙 / 100 품절','화이트 / 95 SOLD OUT']);
  assert.equal(result.sizes[0].quantity,2);
});

test('brand button swatches read each colour and do not select a related product link',async t=>{
  const url='https://new-store.example/product/1';
  const f=fixture(t,{pages:{[url]:'<main><h1>신발</h1><div data-option-name="color"><button data-value="black">블랙</button><button data-value="white">화이트</button><a href="/product/other">다른 제품</a></div><div data-option-name="size"><button>250</button></div><button>구매하기</button></main>'}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  for(const button of w.dom.window.document.querySelectorAll('[data-value]'))button.addEventListener('click',()=>{w.dom.window.document.querySelector('[data-option-name=size]').innerHTML=button.dataset.value==='black'?'<button>250</button><button disabled>260 SOLD OUT</button>':'<button>250 재고 3개</button>';});
  const result=await f.drive(f.context.collectRenderedProductStock(w,'브랜드 공식몰'));
  assert.deepEqual(result.sizes.map(s=>[s.label,s.inStock]),[['블랙 / 250',true],['블랙 / 260 SOLD OUT',false],['화이트 / 250 재고 3개',true]]);
});

test('official results remove the active sold-out exclusion before reading product cards',async t=>{
  const url='https://official.example/search?q=SR123UPS11';
  const f=fixture(t,{pages:{[url]:'<main><span name="sold_out" class="selected"></span><span>품절 상품 제외</span></main>'}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const capture=()=>w.webContents.executeJavaScript(`(${officialAdapters.captureOfficialSoldOutFilter.toString()})()`);
  assert.ok(await capture());
  w.dom.window.document.querySelector('[name=sold_out]').classList.remove('selected');
  assert.equal(await capture(),null);
});

test('on-demand official discovery closes timed-out windows and does not alter other brands',async t=>{
  const f=fixture(t);let settings={officialBrandRegistry:[{registryId:'id:9',brandId:9,brandName:'Other',domain:'other.example',status:'verified'}]},discoveryWindow;
  Object.assign(f.context,{createOfficialDomainAuditWindow:()=>discoveryWindow=new f.context.BrowserWindow(),auditOneOfficialDomain:()=>new Promise(()=>{}),
    failedOfficialDomainAuditRecord:(r,reason)=>({...r,status:'pending',lastVerificationError:reason}),
    store:{snapshot:()=>({settings}),setSettings:async next=>{settings={...settings,...next};}}});
  const result=await f.drive(f.context.resolveDomesticOfficialBrand({brand:'New Label',verifyLinkCounts:true},0,()=>{}));
  assert.equal(result.status,'pending');assert.equal(result.lastVerificationError,'BRAND_SEARCH_DISCOVERY_TIMEOUT');
  assert.equal(discoveryWindow.isDestroyed(),true);assert.equal(settings.officialBrandRegistry[0].domain,'other.example');
  assert.equal(settings.officialBrandRegistry.length,2);
});

test('live SSG dropdown markup preserves available 100/105 and all four raw 매진 options', async t => {
  const url='https://www.ssg.com/item/itemView.ssg?itemId=1000759016358';
  const html=readFileSync(new URL('./fixtures/retailer-stock/ssg-options.html',import.meta.url),'utf8');
  const f=fixture(t,{pages:{[url]:`<main><div class="cdtl_col_rgt"><h2 class="cdtl_info_tit">FN3869-010</h2><dl>${html}</dl><button>바로구매</button></div><aside class="sticky-purchase"><dl>${html.replaceAll('ordOpt1','_bar_ordOpt1')}</dl></aside></main>`}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const result=await f.drive(f.context.collectRenderedProductStock(w,'SSG'));
  assert.deepEqual(result.sizes.map(s=>[s.label,s.inStock]),[['100',true],['105',true],['085(매진)',false],['090(매진)',false],['095(매진)',false],['110(매진)',false]]);
  assert.equal(result.inStock,true);assert.equal(result.stockCoverage,'observed');
});

test('production collector visits all native colour/size combinations and excludes quantity controls', async t => {
  const url='https://new-brand.example/products/jacket';
  const f=fixture(t,{pages:{[url]:'<main><h1>재킷</h1><select name="color"><option value="">선택하세요.</option><option value="black">블랙</option><option value="white">화이트</option></select><select name="size"><option value="">선택하세요.</option></select><select name="quantity"><option>1</option><option>2</option></select><button>구매하기</button></main>'}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  w.dom.window.document.querySelector('[name=color]').addEventListener('change',event=>{
    w.dom.window.document.querySelector('[name=size]').innerHTML=event.target.value==='black'?'<option value="95">95 (재고 3개)</option><option value="100" disabled>100 품절</option>':'<option value="95" disabled>95 SOLD OUT</option>';
  });
  const result=await f.drive(f.context.collectRenderedProductStock(w,'브랜드 공식몰'));
  assert.deepEqual(result.sizes.map(s=>s.label),['블랙 / 95 (재고 3개)','블랙 / 100 품절','화이트 / 95 SOLD OUT']);
  assert.equal(result.sizes[0].quantity,3);assert.equal(result.stockCoverage,'observed');
});

test('production custom dropdown collector follows dependent colour and size menus', async t => {
  const url='https://brand.naver.com/example/products/123';
  const f=fixture(t,{pages:{[url]:'<main><h1>재킷</h1><button role="combobox" aria-label="색상" aria-controls="colors">색상 선택</button><div id="colors" role="listbox" hidden></div><button role="combobox" aria-label="사이즈" aria-controls="sizes">사이즈 선택</button><div id="sizes" role="listbox" hidden></div><button>구매하기</button></main>'}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);const d=w.dom.window.document;
  let color='';
  d.querySelector('[aria-controls=colors]').addEventListener('click',()=>{d.querySelector('#colors').hidden=false;d.querySelector('#colors').innerHTML='<div role="option">블랙</div><div role="option">화이트</div>';});
  d.querySelector('#colors').addEventListener('click',event=>{color=event.target.textContent;d.querySelector('#colors').hidden=true;d.querySelector('#sizes').hidden=true;});
  d.querySelector('[aria-controls=sizes]').addEventListener('click',()=>{d.querySelector('#sizes').hidden=false;d.querySelector('#sizes').innerHTML=color==='블랙'?'<div role="option">95</div><div role="option" aria-disabled="true">100 품절</div>':'<div role="option">100</div>';});
  const result=await f.drive(f.context.collectRenderedProductStock(w,'네이버 패션타운'));
  assert.deepEqual(result.sizes.map(s=>s.label),['블랙 / 95','블랙 / 100 품절','화이트 / 100']);
});

test('size-guide tabs are never stock and member-only text stays explicit', async t => {
  const url='https://www.musinsa.com/products/member';
  const f=fixture(t,{pages:{[url]:'<main><h1>카라 셔츠</h1><div class="StandardSizeTable__Tab"><button>남성 의류</button><button>여성 의류</button></div><button>장바구니</button><button>회원 전용</button></main>'}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const result=await f.drive(f.context.collectRenderedProductStock(w,'무신사'));
  assert.deepEqual(result.sizes,[]);assert.equal(result.stockStatus,'login_required');assert.equal(result.stockText,'회원 전용');assert.equal(result.inStock,null);
});

test('all twelve slow product details finish while completed stock checkpoints advance', async t => {
  const searchUrl='https://www.lotteon.com/search/search/search.ecn?q=SR123UPS11&fixture=12';
  const cards=Array.from({length:12},(_,i)=>`<li><a href="https://www.lotteon.com/p/product/LO${i}"><img alt="데상트 SR123UPS11 카라 셔츠"></a><strong>데상트 SR123UPS11 카라 셔츠</strong><span>롯데백화점</span><span>84,550원</span></li>`).join('');
  const pages={[searchUrl]:`<main><p>전체 12개</p><ul>${cards}</ul></main>`};
  for(let i=0;i<12;i++) pages[`https://www.lotteon.com/p/product/LO${i}`]='<main><h1>데상트 SR123UPS11 카라 셔츠</h1><button data-size="95">95</button><button>구매하기</button></main>';
  const f=fixture(t,{pages});const snapshots=[];
  const original=f.context.clickRenderedProductCard;
  f.context.clickRenderedProductCard=async(...args)=>{await f.context.wait(10_000);return original(...args);};
  const result=await f.drive(f.context.addRenderedSearchCounts({products:[],sources:[{store:'롯데온',searchUrl,renderCount:true}]},'SR123UPS11','데상트','카라 셔츠',0,null,value=>snapshots.push(value)));
  assert.equal(result.products.length, 12);
  assert.ok(f.now() > 90_000);
  assert.equal(result.sources[0].verificationFailed, false);
  assert.ok(snapshots.some(s=>s.products.length===1));
  assert.ok(snapshots.some(s=>s.products.length===result.products.length));
});

test('a stalled later detail retains the completed product checkpoint', async t => {
  const f=fixture(t,{lateSecond:1000});let visited=0;const original=f.context.clickRenderedProductCard;
  f.context.clickRenderedProductCard=async(...args)=>{visited++;if(visited===2)return new Promise(()=>{});return original(...args);};
  const result=await f.search([channels[2]]);
  assert.equal(result.products.length,1);assert.equal(result.sources[0].verificationStage,'product_detail');assert.equal(result.sources[0].verificationPending,true);
});

for (const [store, baseSearch, baseProduct] of channels) test(`${store}: failed detail visits cannot keep renewing both search watchdogs`, async t => {
  const searchUrl = `${baseSearch}&fixture=failed-details`;
  const productUrls = Array.from({length:12}, (_, index) => baseProduct.replace(/123$|100$/, String(1000 + index)));
  const pages = {[searchUrl]: `<main><p>전체 12개</p><ul>${productUrls.map(url =>
    `<li><a href="${url}"><img alt="데상트 SR123UPS11 카라 셔츠"></a><strong>데상트 SR123UPS11 카라 셔츠</strong><span>본사직영 롯데백화점</span><span>84,550원</span></li>`).join('')}</ul></main>`};
  for (const url of productUrls) pages[url] = '<main>상품 정보를 불러오는 중</main>';
  const nextUrl = 'https://www.lotteon.com/search/search/search.ecn?q=next&fixture=empty';
  pages[nextUrl] = '<main>검색 결과가 없습니다</main>';
  const f = fixture(t, {pages});
  const h = f.installHandler([[store,searchUrl],['롯데온',nextUrl]]);
  runInContext(section('async function verifyApprovedNaverDomesticProducts(', '\nasync function filterApprovedNaverDomesticProducts('), f.context);
  const response = await h.run();
  t.diagnostic(`12 failing detail pages: ${f.now()} ms virtual elapsed`);
  assert.equal(response.data.sources[0].verificationReason, 'collection_stalled');
  assert.ok(response.data.sources[0].verificationDiagnostics.failedDetails > 0);
  assert.equal(response.data.sources[0].verificationDiagnostics.totalProducts, 12);
  assert.equal(response.data.sources[0].verificationDiagnostics.lastDetailFailure, 'product_detail_not_ready');
  assert.equal(response.data.sources[0].absenceConfirmed, false);
  assert.equal(response.data.partial, true);
  assert.equal(response.data.sources[1].absenceConfirmed, true, 'the next retailer still runs');
  assert.ok(f.now() < 150_000, 'failed visits are not new observed detail/stock progress');
  assert.ok(f.navigations.filter(url => productUrls.includes(url)).length < 12, 'do not keep opening a stalled retailer');
});

test('live Naver colour radios pair with all thirteen sizes without repeating sticky controls', async t => {
  const url='https://shopping.naver.com/window-products/outlet/12460382307';
  const html=readFileSync(new URL('./fixtures/retailer-stock/naver-options.html',import.meta.url),'utf8');
  const f=fixture(t,{pages:{[url]:`<main><h3>푸마 스피드캣 OG 39884601</h3>${html}${html}<button>구매하기</button></main>`}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const result=await f.drive(f.context.collectRenderedProductStock(w,'네이버 패션타운'));
  assert.equal(result.sizes.length,13);
  assert.equal(result.sizes[0].label,'블랙(39884601) / 220');
  assert.equal(result.sizes[12].label,'블랙(39884601) / 280');
  assert.ok(result.sizes.every(s=>s.inStock===true));
});

test('live Lotte option markup preserves 5개 남음 and six sold-out sizes without prices as stock', async t => {
  const url='https://www.lotteon.com/p/product/LE1219586328';
  const html=readFileSync(new URL('./fixtures/retailer-stock/lotte-options.html',import.meta.url),'utf8');
  const f=fixture(t,{pages:{[url]:`<main><h2 class="pd-widget1__product-name">P-6000 CD6404-002</h2>${html}${html.replaceAll('pageOpt','bundleOpt')}<button>구매하기</button></main>`}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const result=await f.drive(f.context.collectRenderedProductStock(w,'롯데온'));
  assert.equal(result.sizes.length,14);
  assert.equal(result.sizes.filter(s=>s.inStock===false).length,6);
  const size=result.sizes.find(s=>s.label==='230');
  assert.equal(size.stockText,'5개 남음 (품절임박)');assert.equal(size.quantity,5);assert.equal(size.inStock,true);
  assert.ok(result.sizes.every(s=>!s.label.includes('75,900')));
});

test('a missing dependent size list cannot turn a colour choice into available stock', async t => {
  const url='https://new-brand.example/products/partial';
  const f=fixture(t,{pages:{[url]:'<main><h1>재킷</h1><select name="color"><option value="black">블랙</option></select><select name="size"><option value="">선택하세요.</option></select><button>구매하기</button></main>'}});
  const w=new f.context.BrowserWindow();await w.loadURL(url);
  const result=await f.drive(f.context.collectRenderedProductStock(w,'브랜드 공식몰'));
  assert.equal(result.stockCoverage,'partial');assert.equal(result.inStock,null);assert.deepEqual(result.sizes,[]);
});

test('stock from a mismatched detail never overrides the unresolved product identity', async t => {
  const f=fixture(t,{pages:{[officialSearch]:officialCard(),[officialProduct]:'<main><h1>다른 제품 SR323UTS71</h1><p>품번 SR323UTS71</p><button data-size="95">95</button><button>구매하기</button></main>'}});
  f.context.analyzeRenderedChannelProducts=()=>({count:1,products:[{store:'브랜드 공식몰',title:'카라 셔츠',url:officialProduct,detailArticleVerificationRequired:true}],absenceConfirmed:false});
  const result=await f.drive(f.context.addRenderedSearchCounts({products:[],sources:[officialSource]},'SR123UPS11','데상트','카라 셔츠'));
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].inStock,null);assert.equal(result.products[0].stockVerified,false);assert.equal(result.products[0].sizes.length,0);
});


test('verified lack of a Korean official store completes while unresolved discovery stays pending',async t=>{
  const f=fixture(t);
  for(const [status,complete] of [['no_official_store',true],['pending',false]]) {
    const result=await f.drive(f.context.addRenderedSearchCounts({products:[],sources:[{store:'브랜드 공식몰',officialStatus:status,renderCount:false}]},'SR123UPS11','데상트','카라 셔츠'));
    assert.equal(recovery.domesticObservationComplete(result),complete);
  }
  assert.equal(f.navigations.length,0);
});

test('stock option checkpoints use the stable product URL across option navigation',async t=>{
  const f=fixture(t);const w=new f.context.BrowserWindow();
  const original='https://www.ssg.com/item/itemView.ssg?itemId=100';
  await w.loadURL(original+'&color=black');
  w.dom.window.document.body.innerHTML='<main><select name="size"><option value="95">95</option><option value="100" disabled>100 품절</option></select></main>';
  const checkpoints=[];
  await f.drive(f.context.collectRenderedProductStock(w,'SSG',0,u=>checkpoints.push(u.optionCheckpoint),[],[],original));
  assert.equal(checkpoints.length,2);assert.ok(checkpoints.every(c=>c.url===original));
  assert.equal(checkpoints.at(-1).options[1].inStock,false);
});
