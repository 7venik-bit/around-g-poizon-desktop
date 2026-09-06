import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createPageCrossCheck, normalizeVerificationConditions, meetsVerificationConditions, recentMetric, paintSellerVerification } from '../services/live-poizon-crosscheck.mjs';
import { beginLiveVerification } from '../src/live-poizon-crosscheck.js';

const product = (local = 83, extra = {}) => ({ spuId: '11', articleNumber: 'JWVAX25017', sales30d: 100, localSales30d: local, hasSalesData: true, hasLocalSalesData: true, sourceRowNumber: 2, ...extra });
const conditions = { minimumChinaSales30: 100, minimumLocalSales30: 30 };
const session = (excel = [product(10)], c = conditions) => createPageCrossCheck({ runId: 'run-1', excelProducts: excel, conditions: c });

test('30 is inclusive, AND is enforced, and 29 is excluded', () => {
  assert.equal(meetsVerificationConditions(product(29), conditions), false);
  assert.equal(meetsVerificationConditions(product(30), conditions), true);
  assert.equal(meetsVerificationConditions(product(31), conditions), true);
  assert.equal(meetsVerificationConditions(product(31, { sales30d: 99 }), conditions), false);
});
test('old Excel 10 is compared and flagged when POIZON 83 passes minimum 30', () => {
  const s = session(); const result = s.acceptPage([product()], { pageNum: 11, pageCount: 150 });
  assert.equal(result.rows[0].qualified, true); assert.equal(result.rows[0].status, '값 다름');
  assert.equal(result.rows[0].excelLocal, '10'); assert.equal(result.rows[0].sourceLocal, '83');
  assert.equal(result.differentProducts, 1); assert.deepEqual(result.rows[0].excelRows, [2]);
});
test('lifetime totals never stand in for recent sales, including threshold zero', () => {
  const p = { articleNumber: 'A1', localTotalSales: 300, totalSales: 999 };
  assert.equal(recentMetric(p, true), null);
  assert.equal(meetsVerificationConditions(p, { minimumLocalSales30: 0 }), false);
  assert.equal(meetsVerificationConditions(product(0), { minimumLocalSales30: 0 }), true);
  assert.equal(meetsVerificationConditions(product(0, { hasLocalSalesData: false }), { minimumLocalSales30: 0 }), false);
});
test('zero, blank and conservative bounds are distinct; invalid conditions fail', () => {
  assert.equal(normalizeVerificationConditions({ minimumLocalSales30: '' }).minimumLocalSales30, null);
  assert.equal(normalizeVerificationConditions({ minimumLocalSales30: 0 }).minimumLocalSales30, 0);
  assert.throws(() => normalizeVerificationConditions({ minimumLocalSales30: -1 }));
  assert.equal(meetsVerificationConditions(product(30, { localSales30dRaw: '30+' }), conditions), true);
  assert.equal(meetsVerificationConditions(product(30, { localSales30dRaw: '<30' }), conditions), false);
  assert.equal(meetsVerificationConditions(product(30, { localSales30dRaw: '<50' }), conditions), false);
});
test('shared condition snapshot cannot drift during a run', () => {
  const c = { ...conditions }; const s = session(undefined, c); c.minimumLocalSales30 = 999;
  assert.equal(s.acceptPage([product(30)], { pageNum: 1 }).rows[0].qualified, true);
  assert.equal(Object.isFrozen(s.conditions), true);
});
test('SPU identity is preserved and same-code different-SPU matches are rejected', () => {
  assert.equal(session().acceptPage([product(83, { articleNumber: 'OTHER' })]).matchedProducts, 1);
  const result = session().acceptPage([product(83, { spuId: '99' })]);
  assert.equal(result.matchedProducts, 0); assert.equal(result.rows[0].status, '식별자 충돌');
});
test('each of 150 pages is compared independently and a repeated page does not inflate counters', () => {
  const excel = Array.from({ length: 3000 }, (_, i) => product(30, { spuId: String(i + 1), articleNumber: 'ITEM' + i }));
  const s = session(excel); let r;
  for (let page = 1; page <= 150; page++) {
    r = s.acceptPage(excel.slice((page - 1) * 20, page * 20), { pageNum: page, pageCount: 150 });
    assert.equal(r.checkedProducts, page * 20); assert.equal(r.rows.length, 20);
  }
  r = s.acceptPage(excel.slice(2500, 2520), { pageNum: 126, pageCount: 150 });
  assert.equal(r.checkedProducts, 3000); assert.equal(r.equalProducts, 3000);
});
test('all source identities are retained, even a page with no qualifying products', () => {
  const r = session().acceptPage([product(2)]); assert.equal(r.checkedProducts, 1); assert.equal(r.qualifiedProducts, 0);
});

class Element {
  constructor() { this.nodes = new Map(); this.style = {}; this.dataset = {}; this.value = ''; this.disabled = false; this.checked = false; this.hidden = false; this.innerHTML = ''; this.textContent = ''; this.classes = new Set(); this.classList = { add: (s) => this.classes.add(s), remove: (s) => this.classes.delete(s) }; }
  querySelector(key) { if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key); }
  prepend(node) { this.child = node; } append(node) { this.child = node; } remove() { this.removed = true; }
}
function fakeDocument() {
  const ids = new Map(['poizon-verification-controls', 'poizon-verification-css', 'excel-preview', 'poizon-verification-china', 'poizon-verification-local', 'excel-preview-close', 'import-button', 'category-search'].map((id) => [id, new Element()]));
  return { ids, getElementById: (id) => ids.get(id), createElement: () => new Element(), head: new Element() };
}

test('real view renders page comparisons, ignores stale runs and stops listeners on failure', () => {
  const doc = fakeDocument(); let listener; let removed = 0;
  const api = { onSellerVerificationProgress: (fn) => { listener = fn; return () => { removed++; }; } };
  const live = beginLiveVerification({ file: { path: '/kolon.xlsx', name: 'kolon.xlsx' }, brandName: '코오롱', excelProducts: [product(10)], conditions, api, doc });
  const panel = doc.ids.get('excel-preview').child;
  try {
    assert.equal(panel.querySelector('.live-local').value, 30);
    listener({ runId: 'old-run', phase: 'page-compared', rows: [], checkedProducts: 999 });
    assert.doesNotMatch(panel.querySelector('.live-metrics').innerHTML, /999/);
    const r = createPageCrossCheck({ ...live.input }).acceptPage([product()], { pageNum: 11, pageCount: 150 });
    listener(r);
    assert.match(panel.querySelector('.live-current').textContent, /11\/150/);
    assert.match(panel.querySelector('tbody').innerHTML, /10 → <b>83/);
    assert.match(panel.querySelector('tbody').innerHTML, /JWVAX25017/);
    live.finish({ ok: false, message: '응답 지연' });
    assert.match(panel.querySelector('.live-phase').textContent, /검증 미완료/);
    assert.equal(removed, 1); assert.equal(live.running, false);
  } finally { live.dispose(); }
});
test('saved status follows actual reread, not an assumed successful write', () => {
  const doc = fakeDocument(); let listener;
  const live = beginLiveVerification({ file: { name: 'k.xlsx' }, brandName: 'K', excelProducts: [product(10)], conditions, doc,
    api: { onSellerVerificationProgress: (fn) => { listener = fn; return () => {}; } } });
  try {
    listener(createPageCrossCheck(live.input).acceptPage([product()], { pageNum: 1, pageCount: 1 }));
    live.saving();
    live.finish({ ok: true, changedRows: 1, screenProducts: [product()], afterProducts: [product(10)] });
    const panel = doc.ids.get('excel-preview').child;
    assert.match(panel.querySelector('.live-phase').textContent, /재읽기 일치 0상품 · 추가 확인 1상품/);
    assert.match(panel.querySelector('tbody').innerHTML, /저장 후 추가 확인 필요/);
  } finally { live.dispose(); }
});
test('Seller Center annotation does not remove rows needed for completeness', () => {
  const row = new Element(); row.innerText = '상품 번호: JWVAX25017';
  let banner;
  const doc = { getElementById: () => banner, createElement: () => new Element(), body: { prepend: (b) => { banner = b; } }, querySelectorAll: () => [row] };
  paintSellerVerification(doc, { label: '현지 30 이상', pageNum: 1, pageCount: 150, pageQualifiedProducts: 1, rows: [{ articleNumber: 'JWVAX25017', qualified: true }] });
  assert.match(banner.textContent, /현지 30 이상/); assert.equal(row.dataset.aroundGVerification, 'qualified');
  assert.equal(row.style.display, undefined); assert.equal(row.hidden, false);
});

// These assertions are mandatory in the real repository, in addition to the
// behavioral model/view tests above. A local isolated fixture can omit main.
let main = '';
try { main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (main) test('shipping capture compares before navigation and both entry points carry the same frozen conditions', async () => {
  const renderer = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../preload.cjs', import.meta.url), 'utf8');
  const capture = main.slice(main.indexOf('async function captureSellerBrandSales'), main.indexOf('async function lookupSellerTransactionPrice'));
  const from = capture.indexOf('    if (liveVerifier) {');
  const to = capture.indexOf('    reportCaptureProgress({', from);
  assert.ok(from > 0 && to > from);
  const emitted = [], paints = [];
  const sandbox = { liveVerifier: session(), capture: { rows: [product()], currentPage: 11, pageCount: 150 },
    mergeSellerBrandPages: (pages) => pages.flat(), mainWindow: { webContents: { send: (channel, p) => emitted.push([channel, p]) } },
    sellerWindow: { webContents: { executeJavaScript: async (s) => paints.push(s) } }, paintSellerVerification,
    verificationConditionLabel: () => '현지 30 이상' };
  await runInContext('(async()=>{' + capture.slice(from, to) + '})()', createContext(sandbox));
  assert.equal(emitted[0][1].differentProducts, 1); assert.equal(emitted[0][1].pageNum, 11); assert.equal(paints.length, 1);
  assert.ok(to < capture.indexOf('const expectedNextPage'));
  assert.match(preload, /onSellerVerificationProgress/);
  assert.match(renderer, /verification: liveVerification\?\.input/);
  assert.match(renderer, /verification: liveVerification.input/);
  assert.match(renderer, /conditions: verificationConditions/);
  assert.match(renderer, /await finishLivePoizonVerification\(liveVerification/);
});
