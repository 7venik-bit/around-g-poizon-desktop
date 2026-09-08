import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, rename, unlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import writeXlsxFile from 'write-excel-file/node';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { applyPoizonScreenSalesToWorkbook } from '../services/poizon-screen-excel-sync.mjs';
import { indexProductIdentities, resolveProductIdentity } from '../services/poizon-product-identity.mjs';
import { findPoizonColumn, findPoizonRecentSalesColumns, findPoizonTotalSalesColumns } from '../services/poizon-xlsx.mjs';
import { parsePoizonSalesMetric } from '../services/poizon-sales-filter.mjs';
import { readFirstDataSheet } from '../services/excel-reader.mjs';
import { createPageCrossCheck, recentMetric, meetsVerificationConditions } from '../services/live-poizon-crosscheck.mjs';
import { runVerifiedCombinedSearch, readAllVerificationProducts, checkPersistedParentMetrics } from '../services/verified-combined-search.mjs';

const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
const builderSource = main.slice(main.indexOf('function buildExcelPreviewProducts('), main.indexOf('async function previewExcelFile('));
assert.ok(builderSource.length > 100, 'real shipped workbook reader is required');
const build = new Function('findPoizonColumn', 'findPoizonRecentSalesColumns', 'findPoizonTotalSalesColumns', 'parsePoizonSalesMetric', builderSource + '; return buildExcelPreviewProducts;')(findPoizonColumn, findPoizonRecentSalesColumns, findPoizonTotalSalesColumns, parsePoizonSalesMetric);
const screen = (spuId = '11', local = '83', extra = {}) => ({ spuId, articleNumber: 'ITEM-' + spuId, sales30dRaw: '100+', sales30d: 100, hasSalesData: true, localSales30dRaw: local, localSales30d: Number(local.replace(/[^\d]/g, '')), hasLocalSalesData: true, ...extra });
const headers = ['SPU ID', '상품 번호', 'SKU ID', '사이즈/옵션/색상', '상품 브랜드', '중국 총 판매량', '현지 판매자 총 판매량', '최근 30일 판매량', '현지 판매자 최근 30일 판매량', '최근 30일 평균 거래가', '비고'];
const row = (spu = '11', sku = '111', local = '10', code = 'ITEM-' + spu) => [spu, code, sku, 'KR:95/BLACK', 'TEST', '700', '40', '100', local, '86000', '원본 보존'];
async function fixture(t, rows = [row(), row('11', '112', '20')], head = headers) {
  const folder = await mkdtemp(join(tmpdir(), 'poizon-value-simulation-')); t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'simulation.xlsx');
  const col = { type: String, value: (v) => String(v ?? '') };
  await writeXlsxFile([{ sheet: '상품', columns: head.map(() => col), data: [head, ...rows] }]).toFile(path);
  return { folder, path, buffer: await readFile(path) };
}
async function products(buffer) { const data = await readFirstDataSheet(buffer); return build(data[0], data.slice(1).map((values, i) => ({ values, sourceRowNumber: i + 2 }))); }

for (const [name, query, candidates, level, expected] of [
  ['SPU wins over translated code', { spuId: '11', articleNumber: 'OTHER' }, [{ spuId: '11', articleNumber: 'ITEM' }], 'spu', 1],
  ['different SPU cannot fallback to same code', { spuId: '12', articleNumber: 'ITEM' }, [{ spuId: '11', articleNumber: 'ITEM' }], 'spu', 0],
  ['ambiguous code is rejected', { articleNumber: 'ITEM' }, [{ spuId: '11', articleNumber: 'ITEM' }, { spuId: '12', articleNumber: 'ITEM' }], 'spu', 0],
  ['brand identifiers must not conflict', { spuId: '11', brandId: '1' }, [{ spuId: '11', brandId: '2' }], 'spu', 0],
  ['SKU exact match', { skuId: '111', spuId: '11' }, [{ skuId: '111', spuId: '11' }, { skuId: '112', spuId: '11' }], 'sku', 1],
  ['SKU mismatch does not use parent sales', { skuId: '999', spuId: '11' }, [{ skuId: '111', spuId: '11' }], 'sku', 0],
  ['Unicode suffix is not discarded for code-only matches', { articleNumber: 'AB123-服' }, [{ articleNumber: 'AB123-鞋' }], 'spu', 0],
]) test(name, () => assert.equal(resolveProductIdentity(query, indexProductIdentities(candidates), { level }).products.length, expected));

test('POIZON screen values overwrite original recent-sales cells while unrelated totals, SKU, price and notes remain intact', async (t) => {
  const f = await fixture(t);
  const before = await readFirstDataSheet(f.buffer);
  const result = applyPoizonScreenSalesToWorkbook(f.buffer, [screen('11', '1,400+')]);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.changedRows, 2);
  assert.equal(result.changedCells, 4);
  assert.equal(result.comparisonMode, 'POIZON_SCREEN_IS_SOURCE_OF_TRUTH');
  assert.equal(result.reverified, true);
  const after = await readFirstDataSheet(result.buffer);
  assert.deepEqual(after[0], before[0]);
  for (let i = 1; i < after.length; i++) {
    assert.equal(after[i][0], before[i][0]);
    assert.equal(after[i][1], before[i][1]);
    assert.equal(after[i][2], before[i][2]);
    assert.equal(after[i][3], before[i][3]);
    assert.equal(after[i][4], before[i][4]);
    assert.equal(after[i][5], before[i][5]);
    assert.equal(after[i][6], before[i][6]);
    assert.equal(after[i][7], '100+');
    assert.equal(after[i][8], '1,400+');
    assert.equal(after[i][9], before[i][9]);
    assert.equal(after[i][10], before[i][10]);
  }
  const a = unzipSync(f.buffer), b = unzipSync(result.buffer);
  for (const path of Object.keys(a).filter((p) => !/^xl\/worksheets\/sheet/.test(p))) assert.deepEqual(b[path], a[path], path);
  const second = applyPoizonScreenSalesToWorkbook(result.buffer, [screen('11', '1,400+')]);
  assert.equal(second.changed, false);
  assert.equal(second.alreadyMatchedCells, 4);
});

test('missing or mismatched Excel cells are classified and repaired from POIZON', async (t) => {
  const f = await fixture(t, [['11','ITEM-11','111','95','TEST','700','40','','10','86000','note']]);
  const result = applyPoizonScreenSalesToWorkbook(f.buffer, [screen()]);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.missingCells, 1);
  assert.equal(result.mismatchedCells, 1);
  assert.ok(result.changes.some((c) => c.reason === 'MISSING_VALUE' && c.after === '100+'));
  assert.ok(result.changes.some((c) => c.reason === 'VALUE_MISMATCH' && c.after === '83'));
  const data = await readFirstDataSheet(result.buffer);
  assert.equal(data[1][7], '100+'); assert.equal(data[1][8], '83');
});

test('workbook without a recognized recent-sales target is rejected instead of inventing columns or overwriting lifetime totals', async (t) => {
  const f = await fixture(t, [['11', 'ITEM-11']], ['SPU ID', '상품 번호']);
  const result = applyPoizonScreenSalesToWorkbook(f.buffer, [screen()]);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EXCEL_RECENT_SALES_COLUMNS_MISSING');
  assert.deepEqual(f.buffer, await readFile(f.path));
});

test('same code with different SPU cannot change the wrong workbook row', async (t) => {
  const f = await fixture(t, [row('12', '121', '10', 'ITEM-11')]);
  const result = applyPoizonScreenSalesToWorkbook(f.buffer, [screen('11')]);
  assert.equal(result.changed, false); assert.deepEqual(result.buffer, f.buffer);
});

test('SPU match survives code differences in comparison, write and reread verification', async (t) => {
  const f = await fixture(t, [row('11', '111', '10', 'LOCALIZED-CODE')]);
  const source = [screen()]; const before = await products(f.buffer);
  assert.equal(createPageCrossCheck({ runId: 'r', excelProducts: before }).acceptPage(source).matchedProducts, 1);
  const saved = applyPoizonScreenSalesToWorkbook(f.buffer, source);
  assert.equal(saved.changedRows, 1);
  const after = await products(saved.buffer);
  assert.equal(checkPersistedParentMetrics(source, before, after).ok, true);
  assert.equal(after[0].localSales30dRaw, '83');
});

test('unknown POIZON values and conflicting POIZON duplicates never damage Excel', async (t) => {
  const f = await fixture(t);
  assert.equal(applyPoizonScreenSalesToWorkbook(f.buffer, [screen('11', '--', { hasSalesData: false, hasLocalSalesData: false })]).changed, false);
  const conflict = applyPoizonScreenSalesToWorkbook(f.buffer, [screen('11', '83'), screen('11', '90')]);
  assert.equal(conflict.changed, false); assert.equal(conflict.conflictedRows, 2);
});

test('SKU-only screen observations cannot be promoted into a product-level correction', async (t) => {
  const f = await fixture(t);
  assert.equal(applyPoizonScreenSalesToWorkbook(f.buffer, [screen('11', '83', { skuId: '111' })]).changed, false);
  const p = (await products(f.buffer))[0]; assert.equal(p.salesScope, 'sku'); assert.equal(recentMetric(p, true), null);
});

test('a formula in an original target sales cell blocks the automatic correction and unrelated future cells survive', async (t) => {
  const f = await fixture(t);
  const archive = unzipSync(f.buffer); let xml = strFromU8(archive['xl/worksheets/sheet1.xml']);
  xml = xml.replace(/<c\b[^>]*r="I2"[^>]*>[\s\S]*?<\/c>/, '<c r="I2"><f>40+43</f><v>83</v></c>');
  archive['xl/worksheets/sheet1.xml'] = strToU8(xml);
  const result = applyPoizonScreenSalesToWorkbook(Buffer.from(zipSync(archive)), [screen('11', '84')]);
  assert.equal(result.ok, false); assert.match(result.message, /수식/);
});

test('actual main IPC backs up the original, writes corrected bytes atomically and leaves no temp file', async (t) => {
  const f = await fixture(t);
  const from = main.indexOf('  const screenSyncFilesInProgress =');
  const to = main.indexOf('  ipcMain.handle(', main.indexOf('  ipcMain.handle("excel:sync-seller-screen"', from) + 30);
  assert.ok(from > 0 && to > from); let handler;
  const sandbox = { ipcMain: { handle: (_name, fn) => { handler = fn; } }, resolve, readFile, writeFile, rename, unlink, stat, applyPoizonScreenSalesToWorkbook, readFirstDataSheet, excelPreviewCache: new Map() };
  runInContext(main.slice(from, to), createContext(sandbox));
  const result = await handler(null, { path: f.path, products: [screen()] });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(await readFile(result.backupPath), f.buffer);
  assert.equal((await products(await readFile(f.path)))[0].localSales30dRaw, '83');
  const audit = JSON.parse(await readFile(result.auditPath, 'utf8'));
  assert.equal(audit.scope, 'POIZON screen source-of-truth recent30');
  assert.equal(audit.changes.length, 4);
  assert.equal((await readdir(f.folder)).some((p) => p.endsWith('.tmp')), false);
});

test('production combined workflow reads all Excel rows, captures POIZON, saves, rereads and returns only verified qualified products', async (t) => {
  const f = await fixture(t, [row(), row('11', '112', '20'), row('12', '121', '999')]);
  let data = f.buffer; const order = []; let seen;
  const api = {
    previewExcelFile: async (_path, offset, _limit, filter) => { assert.equal(filter.minimumLocalTotal, ''); order.push('read'); const p = await products(data); return { ok: true, products: p, offset, totalRows: p.length }; },
    captureSellerBrandSales: async (input) => { seen = input; order.push('capture'); return { ok: true, products: [screen('11', '83'), screen('12', '29')] }; },
    syncExcelWithSellerScreen: async ({ products: p }) => { order.push('save'); const r = applyPoizonScreenSalesToWorkbook(data, p); data = r.buffer; return r; },
  };
  let done;
  const result = await runVerifiedCombinedSearch({ files: [{ path: f.path, name: 'test.xlsx', brandName: 'TEST' }], conditions: { minimumLocalSales30: 30 }, api,
    openVerification: async (_f, before, c) => { assert.equal(before.length, 3); return { input: { runId: 'r', conditions: c, excelProducts: before }, saving: () => {}, finish: (x) => { done = x; }, running: false }; } });
  assert.deepEqual(order, ['read', 'capture', 'save', 'read']);
  assert.equal(seen.verification.conditions.minimumLocalSales30, 30);
  assert.equal(result.complete, true); assert.equal(done.ok, true);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].spuId, '11');
  assert.equal(result.products[0].optionCount, 2);
  assert.equal(result.products[0].localSales30dRaw, '83');
  assert.equal(result.products[0].verificationStatus, 'POIZON 값으로 수정 후 대조 완료');
});

test('failed POIZON capture cannot write or report complete; incomplete Excel paging cannot silently omit products', async () => {
  let writes = 0;
  const result = await runVerifiedCombinedSearch({ files: [{ path: 'f.xlsx' }], conditions: {}, api: {
    previewExcelFile: async () => ({ ok: true, products: [], totalRows: 0, offset: 0 }),
    captureSellerBrandSales: async () => ({ ok: false, message: '126페이지 오류' }),
    syncExcelWithSellerScreen: async () => { writes++; },
  }, openVerification: async () => ({ input: {}, finish() {}, running: false }) });
  assert.equal(writes, 0); assert.equal(result.complete, false); assert.equal(result.failures.length, 1);
  await assert.rejects(() => readAllVerificationProducts({ previewExcelFile: async () => ({ ok: true, products: [], totalRows: 10, offset: 0 }) }, { path: 'f.xlsx' }), /누락/);
});

test('150 pages and 3000 SPUs with 6000 Excel size rows keep identities and verify every corrected cell', async (t) => {
  const rows = [], sources = [];
  for (let i = 1; i <= 3000; i++) { rows.push(row(String(i), `${i}-A`), row(String(i), `${i}-B`)); sources.push(screen(String(i), String(i % 3 + 29))); }
  const f = await fixture(t, rows); const before = await products(f.buffer);
  const verifier = createPageCrossCheck({ runId: '150-pages', excelProducts: before, conditions: { minimumLocalSales30: 30 } });
  let result;
  for (let page = 1; page <= 150; page++) result = verifier.acceptPage(sources.slice((page - 1) * 20, page * 20), { pageNum: page, pageCount: 150 });
  result = verifier.acceptPage(sources.slice(2500, 2520), { pageNum: 126, pageCount: 150 });
  assert.equal(result.checkedProducts, 3000); assert.equal(result.matchedProducts, 3000); assert.equal(result.qualifiedProducts, 2000);
  const saved = applyPoizonScreenSalesToWorkbook(f.buffer, sources);
  assert.equal(saved.changedRows, 6000); assert.equal(saved.verifiedCells, 12000);
  const after = await products(saved.buffer);
  assert.equal(after.length, 6000);
  assert.equal(checkPersistedParentMetrics(sources, before, after).ok, true);
  assert.equal(applyPoizonScreenSalesToWorkbook(saved.buffer, sources).changedRows, 0);
});

test('shipping combined view describes corrected POIZON recent values separately from collapsible original option totals', async () => {
  const renderer = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
  const from = renderer.indexOf('function renderVerifiedSpuRows('), to = renderer.indexOf('async function openVerifiedCombinedBrandPreview', from);
  assert.ok(from > 0 && to > from); const nodes = new Map(); const $ = (s) => { if (!nodes.has(s)) nodes.set(s, {}); return nodes.get(s); };
  const fn = new Function('$', 'excelPreviewStableSelectionKey', 'excelPreviewProductCache', 'text', 'money', 'renderRawExcelDomesticCell', 'excelPreviewSearchResults', renderer.slice(from, to) + '; return renderVerifiedSpuRows;')($, (p) => p.key, new Map(), (s) => String(s ?? ''), String, () => '<td></td>', new Map());
  fn({}, [{ ...screen('11', '1,400+'), key: 'SPU:11', optionCount: 1, verificationStatus: 'POIZON 값으로 수정 후 대조 완료', verificationOptions: [{ skuId: '111', option: '95', totalSalesRaw: '700', localTotalSalesRaw: '40' }] }]);
  assert.match($('#excel-preview-columns').innerHTML, /현지 상품 최근 30일/);
  assert.match($('#excel-preview-rows').innerHTML, /<details>/); assert.match($('#excel-preview-rows').innerHTML, /1,400\+/);
  assert.match($('#excel-preview-rows').innerHTML, /원본 현지 총판매 40/);
  assert.match($('#excel-preview-rows').innerHTML, /수정 후 대조 완료/);
  assert.match(renderer, /return openReviewLocalBrandPreview\(files, filters\)/);
});
