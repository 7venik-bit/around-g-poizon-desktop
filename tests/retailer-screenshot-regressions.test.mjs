import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { sanitizeDomesticProductCode, sanitizeDomesticQuery } from '../relay/domestic-search.mjs';
import { captureDomesticDetailPage } from '../services/domestic-detail-page.mjs';

// Diagnostic-only baseline: run against the repository source, not a rewritten
// copy of the production predicates. These fixtures make no network requests.
// Initial baseline: 5eea290aa44fef0aa8c0c2f4517fd00451fc33cb.
const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `Missing production start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `Missing production end marker: ${endMarker}`);
  return source.slice(start, end);
}
function page(t, html, url) {
  const dom = new JSDOM(`<body>${html}</body>`, {
    url, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    configurable: true, get() { return this.textContent; },
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({width: 160, height: 80});
  t.after(() => dom.window.close());
  return dom;
}
async function musinsa(t, {query, actualQuery = query, empty = false, pendingLoad = false, body} = {}) {
  const url = `https://www.musinsa.com/search/goods?keyword=${encodeURIComponent(actualQuery)}`;
  const dom = page(t, body ?? (empty ? '<main>검색 결과가 없습니다</main>'
    : '<main><a href="https://www.musinsa.com/products/123">아디다스 JH9976</a></main>'), url);
  let reads = 0;
  const window = {
    isDestroyed: () => false,
    loadURL: () => pendingLoad ? new Promise(() => {}) : Promise.resolve(),
    webContents: {
      getURL: () => dom.window.location.href,
      mainFrame: {executeJavaScript: async code => {reads++; return dom.window.eval(code);}},
    },
  };
  const context = createContext({URL, sanitizeDomesticProductCode, sanitizeDomesticQuery, wait: async () => {}});
  runInContext(section(main, 'function domesticPageAccessState(', '\nasync function waitForDomesticDetailReady('), context);
  runInContext(section(main, 'async function loadMusinsaResultPage(', '\nasync function renderedSearchSourceResult('), context);
  const result = await context.loadMusinsaResultPage(window, url, query);
  return {result, reads};
}
const TITLE = '(J) 아디다스 슈퍼스타 2 클라우드 화이트 코어 블랙';

test('Musinsa: exact article code and a rendered product card are accepted', async t => {
  const {result, reads} = await musinsa(t, {query: 'JH9976'});
  assert.equal(result.ok, true);
  assert.equal(reads, 1);
});
test('Musinsa: a rendered title search with spaces must be accepted', async t => {
  const {result} = await musinsa(t, {query: TITLE});
  assert.equal(result.ok, true, JSON.stringify(result));
});
test('Musinsa: a rendered title-plus-code search must be accepted', async t => {
  const {result} = await musinsa(t, {query: `${TITLE} JH9976`});
  assert.equal(result.ok, true, JSON.stringify(result));
});
test('Musinsa: authoritative absence on the exact title query must complete', async t => {
  const {result} = await musinsa(t, {query: TITLE, empty: true});
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.explicitEmpty, true);
});
test('Musinsa: a different article code must not be accepted', async t => {
  const {result} = await musinsa(t, {query: 'JH9976', actualQuery: 'JH9977'});
  assert.equal(result.ok, false);
  assert.equal(result.errorMessage, 'MUSINSA_RESULT_DOM_NOT_READY');
});
test('Musinsa: exact-code empty results are completed, not timed out', async t => {
  const {result} = await musinsa(t, {query: 'JH9976', empty: true});
  assert.equal(result.ok, true);
  assert.equal(result.explicitEmpty, true);
});
test('Musinsa: pending full-page load does not hide an already usable DOM', async t => {
  const {result, reads} = await musinsa(t, {query: 'JH9976', pendingLoad: true});
  assert.equal(result.ok, true);
  assert.equal(reads, 1);
});
test('Musinsa: explicit security verification is not classified as product absence', async t => {
  const {result} = await musinsa(t, {query: 'JH9976', body: '<main>보안 확인이 필요합니다</main>'});
  assert.equal(result.ok, false);
  assert.equal(result.verificationReason, 'security_verification_required');
});

function detail(t, html, stock = {options: [], stockTexts: [], purchaseAvailable: true}) {
  const dom = page(t, html, 'https://shopping.naver.com/window-products/outlet/13705625469');
  return dom.window.eval(`(${captureDomesticDetailPage.toString()})(() => (${JSON.stringify(stock)}), [])`);
}
const PRODUCT = '<main><h1>아디다스 슈퍼스타 JH9976</h1><button>구매하기</button></main>';
test('Naver detail: title and observed purchase evidence produce a ready detail', t => {
  assert.equal(detail(t, PRODUCT).ready, true);
});
test('Naver detail: price and title alone do not invent verified inventory', t => {
  const result = detail(t, '<main><h1>아디다스 JH9976</h1><span>69,000원</span></main>',
    {options: [], stockTexts: [], purchaseAvailable: false});
  assert.equal(result.ready, false);
});
test('Naver detail: a visible product-loading indicator keeps the product pending', t => {
  const result = detail(t, '<main aria-busy="true"><h1>아디다스 JH9976</h1><button>구매하기</button></main>');
  assert.equal(result.ready, false);
  assert.equal(result.busy, true);
});
test('Naver detail: a hidden spinner must not block the product', t => {
  assert.equal(detail(t, PRODUCT + '<aside style="display:none" role="progressbar"></aside>').ready, true);
});
test('Naver detail: an unrelated visible recommendation loader must not block a ready product', t => {
  // Candidate defect, not proof of the live screenshot\'s DOM structure.
  const result = detail(t, PRODUCT + '<aside aria-label="추천 광고"><div role="progressbar">광고 로딩</div></aside>');
  assert.equal(result.ready, true, `Unrelated loader marked the whole product pending: ${JSON.stringify({ready: result.ready, busy: result.busy})}`);
});
test('Naver detail: genuinely missing title remains pending', t => {
  assert.equal(detail(t, '<main><button>구매하기</button></main>').ready, false);
});

function cooldownFixture() {
  const patch = readFileSync(new URL('../scripts/patch-domestic-access-next-day.mjs', import.meta.url), 'utf8');
  const helperDeclaration = section(patch, 'const helperBlock = ', '\nmain = replaceOnce(main, functionMarker');
  const helper = runInNewContext(`${helperDeclaration}\nhelperBlock;`);
  let now = new Date(2026, 8, 15, 14, 30).getTime(), writes = 0;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const store = {data: {settings: {}}, setSettings: async value => {
    writes++;
    store.data.settings = {...store.data.settings, ...value};
  }};
  const context = createContext({Date: Clock, store});
  runInContext(helper, context);
  return {context, store, now: () => now, advance: value => {now = value;}, writes: () => writes};
}
test('SSG: next-day 00:05 deadline is generated by application code without a server deadline', async () => {
  const f = cooldownFixture();
  const entry = await f.context.postponeDomesticSourceUntilTomorrow({store: 'SSG'}, 'ssg_access_limited_after_session_reset');
  const deadline = new Date(entry.until), expected = new Date(f.now());
  expected.setDate(expected.getDate() + 1);
  expected.setHours(0, 5, 0, 0);
  assert.equal(deadline.getTime(), expected.getTime());
  assert.equal(entry.reason, 'ssg_access_limited_after_session_reset');
  assert.equal(f.writes(), 1);
});
test('SSG: stored access cooldown remains active before its deadline', async () => {
  const f = cooldownFixture(), source = {store: 'SSG'};
  const entry = await f.context.postponeDomesticSourceUntilTomorrow(source);
  assert.equal(f.context.activeDomesticAccessCooldown(source).until, entry.until);
});
test('SSG: application cooldown expires at the stored deadline', async () => {
  const f = cooldownFixture(), source = {store: 'SSG'};
  const entry = await f.context.postponeDomesticSourceUntilTomorrow(source);
  f.advance(new Date(entry.until).getTime());
  assert.equal(f.context.activeDomesticAccessCooldown(source), null);
});
test('SSG: its access cooldown does not automatically block LotteON', async () => {
  const f = cooldownFixture();
  await f.context.postponeDomesticSourceUntilTomorrow({store: 'SSG'});
  assert.equal(f.context.activeDomesticAccessCooldown({store: '롯데온'}), null);
});
test('Naver is excluded from the next-day cooldown patch', async () => {
  const f = cooldownFixture(), source = {store: '네이버 패션타운'};
  assert.equal(await f.context.postponeDomesticSourceUntilTomorrow(source), null);
  assert.equal(f.context.activeDomesticAccessCooldown(source), null);
  assert.equal(f.writes(), 0);
});
