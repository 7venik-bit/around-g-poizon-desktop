import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beginLiveVerification as beginClassicLiveVerification } from '../src/live-poizon-crosscheck.js';
import { beginLiveVerification as beginReviewLiveVerification } from '../src/poizon-review-workspace.js';

class Element {
  constructor() {
    this.nodes = new Map();
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.innerHTML = '';
    this.textContent = '';
    this.isConnected = true;
    this.className = '';
    this.classList = { add: () => {}, remove: () => {} };
  }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll() { return []; }
  prepend(node) { this.child = node; }
  append(node) { this.child = node; }
  remove() { this.removed = true; this.isConnected = false; }
  setAttribute(name, value) { this.attributes ||= {}; this.attributes[name] = value; }
}

function fakeDoc() {
  const ids = new Map([
    'poizon-verification-controls', 'poizon-verification-css', 'poizon-review-styles',
    'poizon-verification-china', 'poizon-verification-local', 'category-min-china-sales-30', 'category-min-local-sales-30',
    'excel-preview', 'excel-preview-close', 'import-button', 'category-search', 'explorer-files',
  ].map((id) => [id, new Element()]));
  const body = new Element();
  body.classList = { add: () => {}, remove: () => {} };
  return { ids, body, head: new Element(), defaultView: {}, getElementById: (id) => ids.get(id) || null, createElement: () => new Element() };
}

const api = () => ({ onSellerVerificationProgress: () => () => {}, endSellerExcelVerification: async () => ({ ok: true }) });
const product = { spuId: '11', articleNumber: 'ITEM-11', sales30dRaw: '100', localSales30dRaw: '30', hasSalesData: true, hasLocalSalesData: true };

test('classic live verification passes workbook filePath to enable page checkpoint writes before next page', () => {
  const file = { path: 'C:/AroundG/POIZON/brand.xlsx', name: 'brand.xlsx' };
  const live = beginClassicLiveVerification({ file, brandName: 'TEST', excelProducts: [product], conditions: {}, api: api(), doc: fakeDoc() });
  try {
    assert.equal(live.input.filePath, file.path);
    assert.equal(live.input.fileName, file.name);
  } finally {
    live.dispose();
  }
});

test('dedicated review verification passes workbook filePath in the same capture input', () => {
  const file = { path: 'D:/exports/review.xlsx', name: 'review.xlsx', brandName: 'TEST' };
  const live = beginReviewLiveVerification({ file, brandName: 'TEST', excelProducts: [product], conditions: {}, api: api(), doc: fakeDoc() });
  try {
    assert.equal(live.input.filePath, file.path);
    assert.equal(live.input.fileName, file.name);
    assert.equal(live.input.screenOnly, true);
  } finally {
    live.dispose();
  }
});

test('shipping capture cannot click the next page before page checkpoint completion', async () => {
  const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
  const start = main.indexOf('async function captureSellerBrandSales');
  const end = main.indexOf('async function lookupSellerTransactionPrice', start);
  assert.ok(start >= 0 && end > start);
  const capture = main.slice(start, end);
  assert.match(capture, /enabled:\s*Boolean\(liveVerifier && input\.verification\?\.filePath\)/);
  assert.match(capture, /selectPoizonPageCorrectionProducts\(currentPageProducts, livePage\.rows, capture\.currentPage\)/);
  assert.match(capture, /await syncPoizonPageCheckpoint\(/);
  const checkpointDone = capture.indexOf('phase: "page-checkpoint-complete"');
  const nextPageClick = capture.indexOf('const expectedNextPage');
  assert.ok(checkpointDone > 0, 'page checkpoint completion event must exist');
  assert.ok(nextPageClick > checkpointDone, 'next page click must be after page checkpoint completion');
});
