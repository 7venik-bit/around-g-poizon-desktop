import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext, Script } from 'node:vm';
import { setImmediate as immediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import * as relay from '../relay/domestic-search.mjs';
import * as naver from '../services/naver-fashiontown-result.mjs';
import * as matcher from '../services/matcher.mjs';

const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));
const channels = [
  ['네이버 패션타운', 'https://shopping.naver.com/window/search/fashion-group?q=SR123UPS11', 'https://shopping.naver.com/window-products/department/123'],
  ['SSG', 'https://www.ssg.com/search.ssg?query=SR123UPS11', 'https://www.ssg.com/item/itemView.ssg?itemId=100'],
  ['롯데온', 'https://www.lotteon.com/search/search/search.ecn?render=search&q=SR123UPS11', 'https://www.lotteon.com/p/product/LO100'],
];

function fixture(t, { delay = 0, navigation = 'resolved', navigationDelay = 0, executeFrozen = false, empty = false, lateSecond = 0, pendingPrice = 0, pages = {} } = {}) {
  let now = 0, nextId = 0;
  const timers = new Map(), windows = [], captures = [], navigations = [];
  const setTimer = (fn, ms = 0) => { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id; };
  const clearTimer = id => timers.delete(id);
  class BrowserWindow {
    constructor() {
      this.destroyed = false;
      this.dom = new JSDOM('<body></body>', { url: 'https://offline.test', runScripts: 'outside-only', pretendToBeVisual: true });
      const w = this.dom.window;
      Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
      w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 180, height: 100 });
      w.scrollTo = () => {};
      this.webContents = {
        getURL: () => this.dom.window.location.href,
        isDestroyed: () => this.destroyed,
        setWindowOpenHandler() {}, setUserAgent() {},
        session: { clearCache: async () => {}, clearStorageData: async () => {}, fetch: async () => ({ok:false}) },
        executeJavaScript: async code => {
          if (this.destroyed) throw new Error('Object has been destroyed');
          if (executeFrozen) return new Promise(() => {});
          if (code.includes('const productCards = []')) captures.push({ at: now, url: this.webContents.getURL() });
          try { new Script(code); } catch (error) { console.error(error.stack); throw error; }
          return this.dom.window.eval(code);
        },
      };
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
    ...relay, ...naver, ...matcher, BrowserWindow, URL, console,
    Date: class extends Date { static now() { return now; } },
    setTimeout: setTimer, clearTimeout: clearTimer, wait: ms => new Promise(r => setTimer(r, ms)),
    domesticSearchGeneration: 0, domesticSearchCanceled: () => false,
    store: { data: { settings: {} }, snapshot: () => ({ settings: {} }), setSettings: async () => {} },
    activeDomesticSearchWindows: new Set(), APP_ICON_PATH: '', DOMESTIC_SEARCH_PARTITION: 'test',
    OFFICIAL_DOMAIN_STATUS: { VERIFIED: 'verified', SEARCH_UNSUPPORTED: 'unsupported' },
    // Network detail adapters are controlled; the actual browser scripts,
    // card parsers, source deadline and aggregation execute unchanged.
    verifyApprovedNaverDomesticProducts: async products => ({ products: products.map(p => ({ ...p, domesticSellerVerified: true, articleNumberVerified: true })), candidateCount: products.length, checkedCount: products.length, failedCount: 0 }),
    clickRenderedProductCard: async (w, url) => { if (Object.hasOwn(pages,url)) await w.loadURL(url); else w.dom.reconfigure({url}); return true; },
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
  assert.equal(result.sources[0].verificationReason, 'page_load_timeout');
  assert.equal(result.sources[0].absenceConfirmed, false);
  assert.ok(f.now() <= 90_000);
});

test('the complete IPC path keeps progressing past two minutes and returns every retailer', async t => {
  const f = fixture(t, {navigationDelay:18_000});
  const h = f.installHandler([...channels,...channels]);
  const response = await h.run();
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.data.sources.length, 6);
  assert.equal(response.data.products.length, 3);
  assert.ok(f.now() > 120_000, 'exercise the former overall cutoff');
  assert.ok(response.data.sources.every(s => !s.verificationFailed));
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

test('all ranked queries run when earlier authoritative empty searches each take one minute', async t => {
  const f = fixture(t);
  const h = f.installHandler([channels[1]]);
  f.context.queryDomesticProducts = async () => ({products:[],sources:[{store:'SSG',renderCount:true,linkOnly:true,searchUrl:channels[1][1],searchAttempts:[{query:'SR123UPS11'},{query:'카라 셔츠'},{query:'카라 셔츠 SR123UPS11'}]}]});
  const attempts = [];
  f.context.renderedSearchSourceResult = async (_source,_article,_brand,_title,_retry,attempt) => {
    attempts.push(attempt.query);
    await f.context.wait(60_000);
    const products = attempts.length === 3 ? [{store:'SSG',title:'데상트 SR123UPS11 카라 셔츠',articleNumber:'SR123UPS11',articleNumberVerified:true,price:84550,url:channels[1][2]}] : [];
    return {count:products.length,products,absenceConfirmed:!products.length,searchCompleted:true};
  };
  const response = await h.run();
  assert.equal(attempts.length, 3);
  assert.equal(response.ok, true);
  assert.equal(response.data.products[0].price, 84550);
  assert.ok(f.now() >= 180_000);
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

test('more than eight product details finish beyond 90 seconds while emitting retained checkpoints', async t => {
  const searchUrl='https://www.lotteon.com/search/search/search.ecn?q=SR123UPS11&fixture=12';
  const cards=Array.from({length:12},(_,i)=>`<li><a href="https://www.lotteon.com/p/product/LO${i}"><img alt="데상트 SR123UPS11 카라 셔츠"></a><strong>데상트 SR123UPS11 카라 셔츠</strong><span>롯데백화점</span><span>84,550원</span></li>`).join('');
  const pages={[searchUrl]:`<main><p>전체 12개</p><ul>${cards}</ul></main>`};
  for(let i=0;i<12;i++) pages[`https://www.lotteon.com/p/product/LO${i}`]='<main><h1>데상트 SR123UPS11 카라 셔츠</h1><button data-size="95">95</button><button>구매하기</button></main>';
  const f=fixture(t,{pages});const snapshots=[];
  const original=f.context.clickRenderedProductCard;
  f.context.clickRenderedProductCard=async(...args)=>{await f.context.wait(10_000);return original(...args);};
  const result=await f.drive(f.context.addRenderedSearchCounts({products:[],sources:[{store:'롯데온',searchUrl,renderCount:true}]},'SR123UPS11','데상트','카라 셔츠',0,null,value=>snapshots.push(value)));
  assert.equal(result.products.length,12);assert.ok(f.now()>90_000);
  assert.ok(snapshots.some(s=>s.products.length===1));assert.ok(snapshots.some(s=>s.products.length===12));
});

test('a stalled later detail retains the completed product checkpoint', async t => {
  const f=fixture(t,{lateSecond:1000});let visited=0;const original=f.context.clickRenderedProductCard;
  f.context.clickRenderedProductCard=async(...args)=>{visited++;if(visited===2)return new Promise(()=>{});return original(...args);};
  const result=await f.search([channels[2]]);
  assert.equal(result.products.length,1);assert.equal(result.sources[0].verificationStage,'source_timeout');assert.equal(result.sources[0].verificationPending,true);
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
