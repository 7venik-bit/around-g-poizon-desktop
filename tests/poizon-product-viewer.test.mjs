import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { sellerProductId, inspectSellerProductView, createPoizonProductViewer, SELLER_PRODUCT_SEARCH_URL } from '../services/poizon-product-viewer.mjs';

const ui = await readFile(new URL('../src/poizon-product-view.js', import.meta.url), 'utf8');
const renderer = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
const spuId = '17692658';
function domFixture(t, html = '', url = SELLER_PRODUCT_SEARCH_URL) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [this.getBoundingClientRect()]; };
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 10, top: this.dataset.offscreen ? 5000 : 10, width: 80, height: 30 };
  };
  return dom;
}
function inspect(dom, stage = 'start', article = '') {
  return JSON.parse(JSON.stringify(dom.window.eval(`(${inspectSellerProductView})(${JSON.stringify({ spuId, stage, article })})`)));
}
const row = (id = spuId, article = 'JI0079') => `<tr><td>상품 번호: ${article}\nSPU_ID：${id}</td><td><button>입찰 등록</button><button data-action="data">상품 데이터</button><button>더 보기</button></td></tr>`;

test('seller lookup uses global SPU, preserves workbook SPU and never treats SKU or a public local SPU as global', () => {
  assert.equal(sellerProductId({ globalSpuId: spuId, spuId: '12008411498' }), spuId);
  assert.equal(sellerProductId({ spuId: ` ${spuId}.0 ` }), spuId);
  assert.equal(sellerProductId({ source: 'kr-poizon-public-brand', spuId: '12008411498' }), '');
  assert.equal(sellerProductId({ source: 'kr-poizon-public-brand', globalSpuId: spuId, spuId: '12008411498' }), spuId);
  for (const product of [null, {}, { skuId: spuId }, { spuId: '1;alert(1)' }, { spuId: '1e7' }, { spuId: 2 ** 54 }, { spuId: '-1' }, { spuId: '0' }]) assert.equal(sellerProductId(product), '');
});
test('initial blank document waits; login and access restriction stop before any interaction', t => {
  assert.deepEqual(inspect(domFixture(t, '', 'about:blank')), { wait: true });
  assert.equal(inspect(domFixture(t, '<input type="password">', 'https://seller.poizon.com/')).error, 'LOGIN_REQUIRED');
  assert.equal(inspect(domFixture(t, 'HTTP 403 - Forbidden')).error, 'ACCESS_RESTRICTED');
  assert.equal(inspect(domFixture(t, '', 'https://unrelated.example/')).error, 'UNEXPECTED_PAGE');
});
test('only the exact SPU row can open Product Data; no bid or more-menu action', t => {
  const dom = domFixture(t, `<table><tbody>${row('176926580', 'OTHER')}${row()}</tbody></table>`);
  dom.window.document.querySelector('[data-action="data"]').getBoundingClientRect = () => ({ left: 400, top: 400, width: 20, height: 20 });
  assert.deepEqual(inspect(dom), { click: { x: 50, y: 25 }, next: 'detail', article: 'JI0079' });
  const mismatch = domFixture(t, `<table><tbody>${row('176926580')}</tbody></table>`);
  assert.deepEqual(inspect(mismatch, 'results'), { wait: true });
  const duplicate = domFixture(t, `<table><tbody>${row()}${row()}</tbody></table>`);
  assert.equal(inspect(duplicate).error, 'AMBIGUOUS_PRODUCT');
});
test('SPU search selects the observed mode and uses its editable field once', t => {
  const dom = domFixture(t, '<div class="ant-select"><div class="ant-select-selector">상품 정보</div></div><div role="option">SKU_ID</div><div role="option">SPU_ID</div><input id="globalSpuIdList" readonly><input id="globalSpuIdList">');
  assert.equal(inspect(dom).next, 'mode');
  assert.equal(inspect(dom, 'mode').next, 'input');
  assert.deepEqual(inspect(dom, 'input'), { input: { x: 50, y: 25 }, next: 'results' });
  assert.deepEqual(inspect(dom, 'results'), { wait: true }, 'do not retype or resubmit while loading results');
});
test('out of view controls and hidden details do not falsely complete the operation', t => {
  const dom = domFixture(t, `<table><tbody>${row()}</tbody></table><div class="ant-drawer-content" hidden>JI0079 거래 추이</div>`);
  dom.window.document.querySelector('[data-action="data"]').dataset.offscreen = 'true';
  assert.deepEqual(inspect(dom, 'results'), { wait: true });
  assert.deepEqual(inspect(dom, 'detail', 'JI0079'), { wait: true });
});
test('mounted results behind a search loading overlay cannot be clicked', t => {
  const dom = domFixture(t, `<div class="ant-spin-spinning">Loading</div><table><tbody>${row()}</tbody></table>`);
  assert.deepEqual(inspect(dom, 'results'), { wait: true });
  dom.window.document.querySelector('.ant-spin-spinning').hidden = true;
  assert.equal(inspect(dom, 'results').next, 'detail');
});
test('completion requires the selected article in the visible data drawer, not a similar article or the results list', t => {
  const dom = domFixture(t, `<table><tbody>${row()}</tbody></table><div class="ant-drawer-content">JI00790 거래 추이</div>`);
  assert.deepEqual(inspect(dom, 'detail', 'JI0079'), { wait: true });
  dom.window.document.querySelector('.ant-drawer-content').textContent = 'JI0079 거래 추이 최근 30일';
  assert.deepEqual(inspect(dom, 'detail', 'JI0079'), { done: true });
});

function viewerFixture(states, options = {}) {
  const windows = [], scripts = [], events = [], inserted = [];
  let clock = 0;
  class Window extends EventEmitter {
    constructor(config) {
      super(); this.config = config; this.destroyed = false; windows.push(this);
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      this.webContents.executeJavaScript = async script => { scripts.push(script); return states.shift() || { wait: true }; };
      this.webContents.sendInputEvent = event => events.push(event);
      this.webContents.insertText = async text => { inserted.push(text); };
    }
    isDestroyed() { return this.destroyed; }
    async loadURL(url) { this.url = url; }
  }
  const viewer = createPoizonProductViewer({ BrowserWindow: Window, now: () => clock,
    timeoutMs: 3600, wait: async ms => { clock += ms; }, ...options });
  return { viewer, windows, scripts, events, inserted };
}
test('isolated viewer reuses seller login, searches once, and only reports success after confirmed drawer', async () => {
  const h = viewerFixture([{ wait: true }, { click: { x: 1, y: 2 }, next: 'mode' },
    { click: { x: 3, y: 4 }, next: 'input' }, { input: { x: 5, y: 6 }, next: 'results' },
    { wait: true }, { click: { x: 7, y: 8 }, next: 'detail', article: 'JI0079' },
    { click: { x: 7, y: 8 }, next: 'detail', article: 'JI0079' }, { done: true }]);
  const task = h.viewer.open({ globalSpuId: spuId });
  assert.equal(h.viewer.open({ spuId }), task, 'duplicate concurrent clicks share the pending operation');
  assert.equal((await task).ok, true);
  assert.equal(h.windows.length, 1);
  assert.equal(h.windows[0].url, SELLER_PRODUCT_SEARCH_URL);
  assert.equal(h.windows[0].config.webPreferences.partition, 'persist:around-g-poizon-seller');
  assert.equal(h.windows[0].config.webPreferences.nodeIntegration, false);
  assert.equal(h.windows[0].config.webPreferences.sandbox, true);
  assert.deepEqual(h.inserted, [spuId]);
  assert.equal(h.events.filter(e => e.type === 'keyDown' && e.keyCode === 'Enter').length, 1);
  assert.equal(h.events.filter(e => e.type === 'mouseDown').length, 4);
  assert.match(h.scripts.at(-1), /"stage":"detail","article":"JI0079"/);
  let blocked = false;
  h.windows[0].webContents.emit('will-navigate', { preventDefault() { blocked = true; } }, 'https://other.example/');
  assert.equal(blocked, true); assert.equal(h.windows[0].openHandler().action, 'deny');
});
test('invalid identity never opens a window; restrictions stop immediately; unconfirmed results time out honestly', async () => {
  const invalid = viewerFixture([]);
  assert.equal((await invalid.viewer.open({ skuId: spuId })).code, 'INVALID_SPU');
  assert.equal(invalid.windows.length, 0);
  for (const code of ['LOGIN_REQUIRED', 'ACCESS_RESTRICTED', 'AMBIGUOUS_PRODUCT']) {
    const h = viewerFixture([{ error: code }]);
    assert.equal((await h.viewer.open({ spuId })).code, code);
    assert.equal(h.scripts.length, 1); assert.equal(h.events.length, 0);
  }
  const h = viewerFixture([{ next: 'detail', article: 'JI0079' }]);
  assert.equal((await h.viewer.open({ spuId })).code, 'PRODUCT_NOT_CONFIRMED');
});
for (const outcome of ['success', 'failure', 'throw']) test(`product button ${outcome}: explicit action only, duplicate click suppressed and outcome visible`, async t => {
  const dom = domFixture(t), calls = []; let finish;
  dom.window.aroundG = { openPoizonProduct: async product => {
    calls.push(JSON.parse(JSON.stringify(product))); await new Promise(resolve => { finish = resolve; });
    if (outcome === 'throw') throw Error('private diagnostic');
    return { ok: outcome === 'success', message: outcome === 'success' ? '상품 데이터를 열었습니다.' : '상품 확인 실패' };
  } };
  dom.window.eval(ui);
  const buttonHtml = dom.window.AroundGPoizonProductView.button({ globalSpuId: spuId, spuId: '12008411498', articleNumber: '<img src=x onerror=alert(1)>' });
  dom.window.document.body.innerHTML = buttonHtml;
  assert.equal(calls.length, 0);
  assert.equal(dom.window.document.querySelector('img'), null);
  assert.equal(dom.window.AroundGPoizonProductView.button(null), '');
  assert.equal(dom.window.AroundGPoizonProductView.button({ source: 'kr-poizon-public-brand', spuId: '12008411498' }), '');
  const button = dom.window.document.querySelector('button');
  button.click(); button.click(); assert.deepEqual(calls, [{ globalSpuId: spuId }]);
  assert.equal(button.disabled, true); finish(); await new Promise(setImmediate);
  assert.equal(button.disabled, false);
  const status = dom.window.document.querySelector('[role="status"]');
  assert.equal(status.dataset.state, outcome === 'success' ? 'success' : 'error');
  assert.doesNotMatch(status.textContent, /private diagnostic/);
});
test('production combined product rows keep per-product seller buttons before and after domestic search', t => {
  const dom = domFixture(t); dom.window.eval(ui);
  const nodes = new Map(); const $ = id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); };
  const results = new Map();
  const context = { $, AroundGPoizonProductView: dom.window.AroundGPoizonProductView,
    excelPreviewStableSelectionKey: p => p.spuId, excelPreviewProductCache: new Map(),
    excelPreviewSearchResults: results, combinedBrandPreview: null, combinedProductSalesLabels: () => ({ china: '중국', local: '현지' }),
    text: value => String(value || ''), money: String, renderDomestic: () => '<div>국내 결과</div>' };
  const start = renderer.indexOf('function renderVerifiedSpuRows('), end = renderer.indexOf('function mergeDomesticSearchProducts(', start);
  runInNewContext(renderer.slice(start, end), context);
  for (const result of [undefined, { loading: true }, { products: [] }]) {
    results.set(spuId, result);
    context.renderVerifiedSpuRows({}, [{ spuId, articleNumber: 'JI0079', optionCount: 3 }]);
    const html = $('#excel-preview-rows').innerHTML;
    assert.equal((html.match(/data-poizon-product-spu=/g) || []).length, 1);
    assert.match(html, /data-poizon-product-spu="17692658"/);
    assert.match(html, /원본 사이즈 3행/);
  }
});
