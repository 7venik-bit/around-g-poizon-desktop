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

function fixture(t, { delay = 0, navigation = 'resolved', empty = false, lateSecond = 0, pendingPrice = 0 } = {}) {
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
        session: { clearCache: async () => {}, clearStorageData: async () => {} },
        executeJavaScript: async code => {
          if (this.destroyed) throw new Error('Object has been destroyed');
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
      }
    }
  }
  const sandbox = {
    ...relay, ...naver, ...matcher, BrowserWindow, URL, console,
    Date: class extends Date { static now() { return now; } },
    setTimeout: setTimer, clearTimeout: clearTimer, wait: ms => new Promise(r => setTimer(r, ms)),
    domesticSearchGeneration: 0, domesticSearchCanceled: () => false,
    store: { data: { settings: {} }, setSettings: async () => {} },
    activeDomesticSearchWindows: new Set(), APP_ICON_PATH: '', DOMESTIC_SEARCH_PARTITION: 'test',
    OFFICIAL_DOMAIN_STATUS: { VERIFIED: 'verified', SEARCH_UNSUPPORTED: 'unsupported' },
    // Network detail adapters are controlled; the actual browser scripts,
    // card parsers, source deadline and aggregation execute unchanged.
    verifyApprovedNaverDomesticProducts: async products => ({ products: products.map(p => ({ ...p, domesticSellerVerified: true, articleNumberVerified: true })), candidateCount: products.length, checkedCount: products.length, failedCount: 0 }),
    clickRenderedProductCard: async (w, url) => { w.dom.reconfigure({url}); return true; },
    openRenderedSizeOptions: async () => {}, renderedStockSelectors: () => [],
    imageFingerprint: async () => null,
  };
  const context = createContext(sandbox);
  runInContext(section('async function readNaverFashionTownChannelCounts(', '\nasync function ensureNaverOfficialBrandFilter('), context);
  runInContext(section('function renderedSearchFailure(', '\nasync function '), context);
  runInContext(section('async function waitForDomesticCaptureReady(', '\nfunction brandsWithOfficialDomainStatus('), context);
  runInContext(section('async function addMatchConfidence(', '\nasync function verifyAllStoresWithMusinsaImage('), context);
  t.after(() => windows.forEach(w => w.dom.window.close()));
  async function drive(promise) {
    let result, error, done = false;
    promise.then(v => { result = v; done = true; }, e => { error = e; done = true; });
    for (let i = 0; i < 1000 && !done; i++) {
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
  return { search, context, drive, captures, navigations, now: () => now };
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
  assert.ok(f.now() < 30_000, 'ready results must not incur three unconditional 25-second sleeps');
});

for (const channel of channels) test(`${channel[0]}: declared second card arriving at 18 seconds is captured`, async t => {
  const f = fixture(t, { lateSecond: 18_000 });
  const result = await f.search([channel]);
  assert.equal(result.products.length, 2, JSON.stringify(result.sources[0]));
  assert.ok(f.captures[0].at >= 18_000);
  assert.ok(f.now() < 30_000);
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
  const f = fixture(t, { navigation: 'pending' });
  const result = await f.search([channels[1]]);
  assert.equal(result.sources[0].verificationReason, 'page_load_timeout');
  assert.equal(result.sources[0].absenceConfirmed, false);
  assert.ok(f.now() <= 30_000);
});
