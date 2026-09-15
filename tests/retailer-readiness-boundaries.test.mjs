import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { sanitizeDomesticProductCode, sanitizeDomesticQuery } from '../relay/domestic-search.mjs';
import { captureDomesticDetailPage } from '../services/domestic-detail-page.mjs';

// Execute the real production functions. These are synthetic, network-free
// boundary cases, not a claim of live retailer or Windows-session validation.
const main = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
function section(startMarker, endMarker) {
  const start = main.indexOf(startMarker);
  assert.ok(start >= 0, `Missing production marker: ${startMarker}`);
  const end = main.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `Missing production marker: ${endMarker}`);
  return main.slice(start, end);
}
function page(t, html, url) {
  const dom = new JSDOM(`<body>${html}</body>`, {url, runScripts: 'outside-only', pretendToBeVisual: true});
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    configurable: true, get() { return this.textContent; },
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({width: 160, height: 80});
  t.after(() => dom.window.close());
  return dom;
}
async function result(t, query, actualQuery, {empty = false, formEncoded = false} = {}) {
  const url = new URL('https://www.musinsa.com/search/goods');
  if (formEncoded) url.searchParams.set('keyword', actualQuery);
  else url.search = `?keyword=${encodeURIComponent(actualQuery)}`;
  const dom = page(t, empty ? '<main>검색 결과가 없습니다</main>'
    : '<main><a href="/products/123">아디다스 상품</a></main>', url.href);
  const window = {
    isDestroyed: () => false,
    loadURL: async () => {},
    webContents: {
      getURL: () => dom.window.location.href,
      mainFrame: {executeJavaScript: async code => dom.window.eval(code)},
    },
  };
  const context = createContext({URL, sanitizeDomesticProductCode, sanitizeDomesticQuery, wait: async () => {}});
  runInContext(section('function domesticPageAccessState(', '\nasync function waitForDomesticDetailReady('), context);
  runInContext(section('async function loadMusinsaResultPage(', '\nasync function renderedSearchSourceResult('), context);
  return context.loadMusinsaResultPage(window, url.href, query);
}
const TITLE = '아디다스 슈퍼스타 2 클라우드 화이트';

test('Musinsa query: collapse repeated whitespace on both sides without deleting word boundaries', async t => {
  assert.equal((await result(t, `  ${TITLE.replaceAll(' ', '  ')}  `, TITLE.replaceAll(' ', '\t'))).ok, true);
});
test('Musinsa query: form-encoded plus spaces and percent-encoded spaces compare identically', async t => {
  assert.equal((await result(t, TITLE, TITLE, {formEncoded: true})).ok, true);
});
test('Musinsa query: case-only differences in article codes remain accepted', async t => {
  assert.equal((await result(t, 'JH9976', 'jh9976')).ok, true);
});
for (const [label, query, actual] of [
  ['different product title', TITLE, TITLE.replace('화이트', '블랙')],
  ['deleted word boundaries', TITLE, TITLE.replaceAll(' ', '')],
  ['deleted article punctuation', '207521-001', '207521001'],
  ['additional article suffix', 'JH9976', 'JH99760'],
  ['empty submitted query', '', ''],
]) {
  test(`Musinsa query: reject ${label} despite a rendered product card`, async t => {
    const observed = await result(t, query, actual);
    assert.equal(observed.ok, false);
    assert.equal(observed.errorMessage, 'MUSINSA_RESULT_DOM_NOT_READY');
  });
}
test('Musinsa query: empty results for another title are not authoritative absence', async t => {
  const observed = await result(t, TITLE, '다른 상품', {empty: true});
  assert.equal(observed.ok, false);
  assert.notEqual(observed.explicitEmpty, true);
});

const PRODUCT = '<main><h1>아디다스 JH9976</h1><button>구매하기</button></main>';
function detail(t, html, {bodyBusy = false} = {}) {
  const dom = page(t, html, 'https://shopping.naver.com/window-products/outlet/13705625469');
  if (bodyBusy) dom.window.document.body.setAttribute('aria-busy', 'true');
  return dom.window.eval(`(${captureDomesticDetailPage.toString()})(() => ({options: [], stockTexts: [], purchaseAvailable: true}), [])`);
}
for (const [label, html, options, expectedBusy] of [
  ['recommendation class', PRODUCT + '<aside class="product-recommendations"><div role="progressbar"></div></aside>', {}, false],
  ['advertisement test id', PRODUCT + '<aside data-testid="advertisement-panel"><div role="progressbar"></div></aside>', {}, false],
  ['purchase panel outside main', PRODUCT + '<aside aria-label="상품 구매 옵션" aria-busy="true"><button>사이즈 선택</button></aside>', {}, true],
  ['recommended size panel is not unrelated goods', PRODUCT + '<aside class="recommended-size" aria-busy="true"><button>사이즈 선택</button></aside>', {}, true],
  ['Korean recommended options remain commerce', PRODUCT + '<aside aria-label="추천 옵션 구매" aria-busy="true"><button>옵션 선택</button></aside>', {}, true],
  ['dependent size options', '<main><h1>아디다스 JH9976</h1><section aria-busy="true"><button>사이즈 선택</button></section></main>', {}, true],
  ['whole document loading', PRODUCT, {bodyBusy: true}, true],
  ['main product still loading beside recommendations', '<main aria-busy="true"><h1>아디다스 JH9976</h1><button>구매하기</button><aside aria-label="추천"><div role="progressbar"></div></aside></main>', {}, true],
  ['unclassified global overlay', PRODUCT + '<div role="progressbar" class="page-loading-overlay"></div>', {}, true],
  ['display-none ancestor', PRODUCT + '<aside style="display:none"><div role="progressbar"></div></aside>', {}, false],
  ['hidden ancestor', PRODUCT + '<aside hidden><div role="progressbar"></div></aside>', {}, false],
]) {
  test(`Detail readiness: ${label}`, t => {
    const observed = detail(t, html, options);
    assert.equal(observed.busy, expectedBusy);
    assert.equal(observed.ready, !expectedBusy);
  });
}
