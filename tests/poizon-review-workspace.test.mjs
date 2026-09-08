import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import writeXlsxFile from 'write-excel-file/node';
import { createPageCrossCheck } from '../services/live-poizon-crosscheck.mjs';
import { findPoizonColumn, findPoizonRecentSalesColumns, findPoizonTotalSalesColumns } from '../services/poizon-xlsx.mjs';
import { parsePoizonSalesMetric } from '../services/poizon-sales-filter.mjs';
import { createReviewWorkbookSnapshot, readReviewWorkbook, checkReviewWorkbookRevision } from '../services/poizon-review-workbook.mjs';
import { loadReviewSnapshots, reviewCoverage, buildReviewReport, reviewReportText, runPoizonReviewBatch, reviewTone } from '../services/poizon-review-session.mjs';
import { paintReviewPage } from '../services/poizon-review-paint.mjs';

const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
const renderer = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
const builderSource = main.slice(main.indexOf('function buildExcelPreviewProducts('), main.indexOf('async function previewExcelFile('));
const build = new Function('findPoizonColumn', 'findPoizonRecentSalesColumns', 'findPoizonTotalSalesColumns', 'parsePoizonSalesMetric', builderSource + ';return buildExcelPreviewProducts;')(findPoizonColumn, findPoizonRecentSalesColumns, findPoizonTotalSalesColumns, parsePoizonSalesMetric);
const headers = ['SPU ID', '상품 번호', 'SKU ID', '사이즈/옵션/색상', '상품 브랜드', '중국 총 판매량', '현지 판매자 총 판매량', '최근 30일 판매량', '현지 판매자 최근 30일 판매량', '비고'];
const row = (spu = '11', local = '10', sku = '') => [spu, 'ITEM-' + spu, sku, 'KR:95', 'TEST', '700', '40', '100', local, '원본 메모'];
const source = (spu = '11', local = '83') => ({ spuId: spu, articleNumber: 'ITEM-' + spu, sales30dRaw: '100', localSales30dRaw: local, hasSalesData: true, hasLocalSalesData: true });
async function fixture(t, rows = [row()]) {
  const folder = await mkdtemp(join(tmpdir(), 'poizon-review-')); t.after(() => rm(folder, { recursive:true, force:true }));
  const path = join(folder, 'review.xlsx');
  await writeXlsxFile([{ sheet:'상품', columns: headers.map(() => ({ type:String, value:(v) => String(v ?? '') })), data:[headers, ...rows] }]).toFile(path);
  return { folder, path, name:'review.xlsx', brandName:'TEST', bytes:await readFile(path) };
}
function compared(before, sources, pageNum = 1, pageCount = 1) {
  return createPageCrossCheck({ runId:'r', excelProducts:before, conditions:{ minimumLocalSales30:30 } }).acceptPage(sources, { pageNum, pageCount });
}

test('complete workbook snapshot retains unrecognizable rows, original values and exact row positions', () => {
  const data = [headers, row(), ['', '', '', '', '', '', '', '', '', '식별자 없는 행'], row('22')];
  const snapshot = createReviewWorkbookSnapshot(data, build);
  assert.equal(snapshot.products.length, 3); assert.equal(snapshot.sourceTotalRows, 3);
  assert.deepEqual(snapshot.products.map((p) => p.sourceRowNumber), [2,3,4]);
  assert.deepEqual(snapshot.unidentifiedRows, [3]);
  assert.equal(snapshot.products[0].sourceValues[6], '40');
  assert.equal(snapshot.products[0].reviewColumnNames.local, '현지 판매자 최근 30일 판매량');
});

test('actual XLSX snapshot and revision check leave all original bytes unchanged', async (t) => {
  const f = await fixture(t); const snapshot = await readReviewWorkbook(f, build);
  assert.equal(snapshot.ok, true, snapshot.message); assert.equal(snapshot.products[0].localSales30dRaw, '10');
  assert.equal((await checkReviewWorkbookRevision({ path:f.path, revision:snapshot.revision })).unchanged, true);
  assert.deepEqual(await readFile(f.path), f.bytes); assert.deepEqual(await readdir(f.folder), ['review.xlsx']);
  await writeFile(f.path, Buffer.concat([f.bytes, Buffer.from('modified')]));
  assert.equal((await checkReviewWorkbookRevision({ path:f.path, revision:snapshot.revision })).unchanged, false);
});

test('unfiltered reader rejects missing original rows and never runs capture', async () => {
  let capture = 0;
  await assert.rejects(() => loadReviewSnapshots([{ path:'a.xlsx' }], {
    readPoizonReviewWorkbook: async () => ({ ok:true, products:[{ sourceRowNumber:2 }], sourceTotalRows:2 }),
    captureSellerBrandSales: () => capture++,
  }), /행 수/);
  assert.equal(capture, 0);
});

test('POIZON order replaces Excel order; low old Excel values are still compared', () => {
  const snapshot = createReviewWorkbookSnapshot([headers, row('11'), row('22','2')], build);
  const page = compared(snapshot.products, [source('22','29'), source('11','83')]);
  assert.deepEqual(page.rows.map((p) => p.spuId), ['22','11']);
  assert.deepEqual(page.rows.map((p) => p.excelRows), [[3],[2]]);
  assert.equal(page.rows[1].sourceLocal, '83'); assert.equal(page.rows[1].excelLocal, '10');
  assert.equal(page.rows[0].qualified, false); assert.equal(page.rows.length, 2);
});

test('150-page and 3000-product coverage detects a missing page and deduplicates a retried page', () => {
  const data = Array.from({ length:3000 }, (_, i) => source(String(i + 1)));
  const model = createPageCrossCheck({ runId:'large', excelProducts:data }); const events = [];
  for (let p = 1; p <= 150; p++) events.push(model.acceptPage(data.slice((p-1)*20,p*20), { pageNum:p, pageCount:150 }));
  const captured = { ok:true, sourceTotal:3000, missingCount:0 };
  assert.equal(reviewCoverage([...events, events[125]], captured).rows.length, 3000);
  assert.equal(reviewCoverage(events.filter((e) => e.pageNum !== 126), captured).ok, false);
  assert.equal(reviewCoverage(events, { ...captured, sourceTotal:3001 }).ok, false);
});

test('wide 10000-row original snapshot loses no row', () => {
  const data = [headers, ...Array.from({ length:10000 }, (_, i) => row(String(i+1)))];
  const snapshot = createReviewWorkbookSnapshot(data, build);
  assert.equal(snapshot.products.length, 10000); assert.equal(snapshot.products.at(-1).sourceRowNumber, 10001);
});

test('manual report preserves plus notation, true column names and SKU scope separation', () => {
  const snapshot = { file:{ name:'report.xlsx' }, ...createReviewWorkbookSnapshot([headers, row('11'), row('22','40','2201')], build) };
  const rows = compared(snapshot.products, [source('11','1,400+'), source('22','1,400+')]).rows;
  const report = buildReviewReport(snapshot, rows);
  assert.ok(report.changes.some((c) => c.type === 'value' && c.excelValue === '10' && c.poizonValue === '1,400+' && c.columnName === '현지 판매자 최근 30일 판매량'));
  assert.ok(report.changes.some((c) => c.spuId === '22' && c.type === 'unknown'));
  assert.ok(!report.changes.some((c) => c.spuId === '22' && c.type === 'value'));
  assert.match(reviewReportText({ complete:true, files:[report] }), /POIZON 화면값 기준 Excel 자동 교정/);
});

test('Excel-only rows are reported only after complete POIZON coverage', () => {
  const snapshot = { file:{ name:'a.xlsx' }, ...createReviewWorkbookSnapshot([headers, row('11'), row('22')], build) };
  const rows = compared(snapshot.products, [source('11')]).rows;
  assert.equal(buildReviewReport(snapshot, rows, { complete:false }).summary.absentRows, 0);
  assert.equal(buildReviewReport(snapshot, rows).summary.absentRows, 1);
});

test('real Seller Center painting uses the same verdict palette and refuses a different SPU with the same code', () => {
  const elements = [
    { innerText:'상품 번호: ITEM-11 SPU_ID: 11', style:{ backgroundColor:'white' }, dataset:{} },
    { innerText:'상품 번호: ITEM-11 SPU_ID: 99', style:{}, dataset:{} },
  ];
  const doc = { getElementById:()=>null, createElement:()=>({ style:{} }), body:{ prepend(){} }, querySelectorAll:()=>elements };
  paintReviewPage(doc, { pageNum:1, pageCount:1, activeKey:'SPU:11', rows:[{ key:'SPU:11', spuId:'11', articleNumber:'ITEM-11', matched:true, equal:false, status:'값 다름' }] });
  assert.equal(elements[0].style.backgroundColor, '#fff3df'); assert.equal(elements[1].style.backgroundColor, undefined);
  assert.equal(elements[0].style.outline, '3px solid #13a36f');
  assert.equal(JSON.parse(elements[0].dataset.aroundGReviewStyle).backgroundColor, 'white');
  assert.equal(reviewTone({ matched:true, equal:false, status:'최근 30일 값 미확인' }), 'unknown');
});

test('batch reads every workbook first, then corrects Excel from POIZON and rereads before one final notification', async (t) => {
  const f = await fixture(t); let current, notifications = 0, writes = 0; const order = [];
  const files = [{ ...f, name:'A.xlsx' }, { ...f, name:'B.xlsx' }];
  const api = {
    readPoizonReviewWorkbook: async (file) => { order.push('read'); return readReviewWorkbook(file, build); },
    checkPoizonReviewWorkbook: checkReviewWorkbookRevision,
    beginSellerExcelVerification: async () => ({ ok:true }),
    captureSellerBrandSales: async (input) => { order.push('capture'); assert.equal(input.verification.screenOnly, true); current.eventsList.push(compared(current.snapshot.products, [source()])); return { ok:true, products:[source()], sourceTotal:1 }; },
    syncExcelWithSellerScreen: async ({ products }) => { writes++; order.push('write'); return { ok:true, changedRows:1, changedCells:1, addedRows:0, verifiedCells:2, reverified:true, backupPath:'backup.xlsx', products }; },
  };
  const report = await runPoizonReviewBatch({ files, api,
    createView: async (snapshot) => { current = { snapshot, input:{ screenOnly:true }, eventsList:[], events(){ return this.eventsList; }, saving(){ order.push('saving'); }, finish(){} }; return current; },
    notify: (r) => { notifications++; assert.equal(order.filter((s) => s === 'capture').length, 2); assert.equal(r.files.length, 2); } });
  assert.equal(report.complete, true); assert.equal(report.autoCorrection, true);
  assert.equal(writes, 2); assert.equal(notifications, 1);
  assert.equal(report.files.every((r) => r.autoCorrection === 'POIZON_AUTO_CORRECTION_APPLIED'), true);
  assert.ok(order.indexOf('write') > order.indexOf('capture'));
});

test('newly appended POIZON product rows increase the expected reread count and must resolve by SPU', async () => {
  const base = { products:[{ spuId:'1', articleNumber:'OLD', sourceRowNumber:2 }], sourceTotalRows:1, revision:'r1', ok:true, file:{ path:'A.xlsx', name:'A.xlsx' } };
  const added = { spuId:'2', articleNumber:'NEW', sales30dRaw:'100+', localSales30dRaw:'30', hasSalesData:true, hasLocalSalesData:true };
  let current, readCount = 0, finishResult;
  const api = {
    readPoizonReviewWorkbook: async () => {
      readCount++;
      if (readCount === 1) return base;
      return { ...base, products:[...base.products, { ...added, sourceRowNumber:3 }], sourceTotalRows:2 };
    },
    checkPoizonReviewWorkbook: async () => ({ ok:true, unchanged:true }),
    beginSellerExcelVerification: async () => ({ ok:true }),
    captureSellerBrandSales: async () => { current.eventsList.push({ phase:'page-compared', pageNum:1, pageCount:1, rows:[{ key:'SPU:2', spuId:'2', articleNumber:'NEW', matched:false, equal:false, status:'Excel 상품 없음' }] }); return { ok:true, products:[added], sourceTotal:1, missingCount:0 }; },
    syncExcelWithSellerScreen: async () => ({ ok:true, changedRows:0, changedCells:0, addedRows:1, addedProducts:1, verifiedCells:2, reverified:true,
      changes:[{ reason:'MISSING_PRODUCT_ROW', spuId:'2', articleNumber:'NEW' }] }),
  };
  const report = await runPoizonReviewBatch({ files:[base.file], api,
    createView: async () => { current = { input:{screenOnly:true}, eventsList:[], events(){return this.eventsList;}, saving(){}, finish(result){ finishResult = result; } }; return current; },
    notify: async () => {} });
  assert.equal(report.complete, true);
  assert.equal(report.files[0].addedRows, 1);
  assert.equal(finishResult.ok, true);
});

test('page checkpoint counts are preserved and reread row count includes rows added before the next page', async () => {
  const base = { products:[{ spuId:'1', articleNumber:'OLD', sourceRowNumber:2 }], sourceTotalRows:1, revision:'r1', ok:true, file:{ path:'A.xlsx', name:'A.xlsx' } };
  const added = { spuId:'2', articleNumber:'NEW', sales30dRaw:'100+', localSales30dRaw:'30', hasSalesData:true, hasLocalSalesData:true };
  let current, reads = 0;
  const api = {
    readPoizonReviewWorkbook: async () => { reads++; return reads === 1 ? base : { ...base, products:[...base.products, { ...added, sourceRowNumber:3 }] }; },
    checkPoizonReviewWorkbook: async () => ({ ok:true, unchanged:true }),
    beginSellerExcelVerification: async () => ({ ok:true }),
    captureSellerBrandSales: async () => {
      current.eventsList.push({ phase:'page-compared', pageNum:1, pageCount:1, rows:[{ key:'SPU:2', spuId:'2', articleNumber:'NEW', matched:false, equal:false, status:'Excel 상품 없음' }] });
      return { ok:true, products:[added], sourceTotal:1, checkpointSync:{ enabled:true, pagesCompleted:1, changedRows:0, changedCells:0, addedRows:1, addedProducts:1, verifiedCells:2, reverified:true, backupPath:'page.bak', changes:[{ reason:'MISSING_PRODUCT_ROW', spuId:'2', articleNumber:'NEW' }] } };
    },
    syncExcelWithSellerScreen: async () => ({ ok:true, changedRows:0, changedCells:0, addedRows:0, addedProducts:0, verifiedCells:2, reverified:true, changes:[] }),
  };
  const report = await runPoizonReviewBatch({ files:[base.file], api,
    createView: async () => { current = { input:{screenOnly:true}, eventsList:[], events(){return this.eventsList;}, saving(){}, finish(){} }; return current; },
    notify: async () => {} });
  assert.equal(report.complete, true);
  assert.equal(report.files[0].addedRows, 1);
  assert.equal(report.files[0].checkpointPages, 1);
  assert.equal(report.files[0].backupPath, 'page.bak');
});

test('incomplete capture never becomes an all-match or absence report', async (t) => {
  const f = await fixture(t); const report = await runPoizonReviewBatch({ files:[f], api:{
    readPoizonReviewWorkbook:(input)=>readReviewWorkbook(input,build), beginSellerExcelVerification:async()=>({ ok:true }),
    captureSellerBrandSales:async()=>({ ok:false, message:'126페이지 오류' }),
  }, createView:async()=>({ input:{}, events:()=>[], finish(){} }) });
  assert.equal(report.complete, false); assert.deepEqual(report.files[0].changes, []);
  assert.doesNotMatch(reviewReportText(report), /확인된 비교 항목 전체 일치/);
});

test('shipped navigation, local brand lists, and file synchronization cannot implicitly start POIZON review', () => {
  const local = renderer.slice(renderer.indexOf('async function openReviewLocalBrandPreview'), renderer.indexOf('async function openVerifiedCombinedBrandPreview'));
  const sync = renderer.slice(renderer.indexOf('$("#import-button").addEventListener'), renderer.indexOf('$("#export-button").addEventListener'));
  assert.match(local, /loadReviewSnapshots/); assert.doesNotMatch(local, /captureSellerBrandSales|syncExcelWithSellerScreen/);
  assert.match(sync, /listBrandExportFiles/); assert.doesNotMatch(sync, /captureSellerBrandSales|syncExcelWithSellerScreen|beginLiveVerification/);
  assert.match(renderer, /openCombinedSelectedBrandPreview\(files, \{ minimumTotal: "100", minimumLocalTotal: "25" \}\)/);
  assert.match(renderer, /poizon-review-brand-start/); assert.match(main, /screenOnly \? domProducts/);
  assert.match(main, /backgroundSeller: true/);
});

test('dedicated view uses external CSP-compatible styling and keeps original details paged', async () => {
  const view = await readFile(new URL('../src/poizon-review-workspace.js', import.meta.url),'utf8');
  const html = await readFile(new URL('../src/index.html', import.meta.url),'utf8');
  assert.doesNotMatch(view, /createElement\(['"]style['"]\)|style\.cssText/);
  assert.match(html, /id="poizon-review-styles"/); assert.match(view, /doc\.body\.append\(panel\)/);
  assert.match(view, /originals\.slice\(offset, offset \+ 100\)/);
  assert.match(view, /openReviewPopup/);
  assert.match(view, /poizon-review-popup\\\.html/);
  assert.match(view, /popup\.document\.readyState === 'complete'/);
  assert.match(view, /navigation to the real review page would immediately erase UI/);
  const popup = await readFile(new URL('../src/poizon-review-popup.html', import.meta.url),'utf8');
  assert.match(popup, /POIZON 실시간 대조/);
});

test('one bulk approval replaces per-product correction clicks', async () => {
  const view = await readFile(new URL('../src/poizon-review-workspace.js', import.meta.url),'utf8');
  assert.match(view, /review-auto-all/);
  assert.match(view, /productKey:'__ALL__', action:'auto'/);
  assert.doesNotMatch(view, /class="review-product-action"/);
  assert.match(main, /waitForSellerVerificationAction\(input\.verification\.runId, '__ALL__', 'auto'\)/);
  assert.match(main, /phase: 'bulk-action-required'/);
  assert.doesNotMatch(main, /waitForSellerVerificationAction\(input\.verification\.runId, currentRow\.key/);
  assert.match(main, /for \(const row of livePage\.rows\.filter/);
});

test('Windows Electron renders actual source-order rows under the app CSP and closes cleanly', { skip:process.platform !== 'win32', timeout:60000 }, () => {
  const require = createRequire(import.meta.url), electron = require('electron');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electron, [fileURLToPath(new URL('./fixtures/poizon-review-smoke.cjs', import.meta.url))], { encoding:'utf8', timeout:45000, env, windowsHide:true });
  assert.equal(result.status, 0, String(result.error || '') + result.stdout + result.stderr);
  assert.match(result.stdout, /REVIEW_BROWSER_SMOKE_OK/);
});
