import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createPageCrossCheck, resolveExcelRecentMetric, assertPoizonPageReadyForCorrection } from '../services/live-poizon-crosscheck.mjs';

// Reproduced input shape from the screenshot: distinct scalar SKU rows, NOT one slash-separated cell.
const source = (china = '1,300+', local = '78', extra = {}) => ({ spuId:'3507808', articleNumber:'1026592', sales30dRaw:china, localSales30dRaw:local, hasSalesData:true, hasLocalSalesData:true, ...extra });
const excel = (china, local, extra = {}) => ({ ...source(china, local), sourceRowNumber:109, ...extra });
const check = (products, screen = [source()]) => createPageCrossCheck({ runId:'evidence-v2', excelProducts:products }).acceptPage(screen, { pageNum:1, pageCount:150 });

test('separate SKU scalar rows with values never become two missing sales cells', () => {
  const china = ['33', '100+', '93', '200+', '28', '<5', '--'];
  const local = ['5', '14', '16', '40', '10', '25', '<5'];
  const items = china.map((v, i) => excel(v, local[i], { skuId:String(i + 1), salesScope:'sku', sourceRowNumber:109 + i }));
  assert.ok(items.every((p) => !p.sales30dRaw.includes('/')));
  const r = check(items), row = r.rows[0];
  assert.equal(r.matchedProducts, 1); assert.equal(r.missingProducts, 0); assert.equal(r.missingSalesCells, 0);
  assert.equal(row.excelChinaState, 'scope-mismatch'); assert.equal(row.excelLocalState, 'scope-mismatch');
  assert.equal(row.equal, false); assert.equal(row.autoCorrectionBlocked, true);
  assert.doesNotMatch(row.status, /누락|일치/);
  assert.match(row.excelChina, /33 \/ 100\+/);
  assert.deepEqual(row.excelChinaEvidence.map((e) => e.row), [109,110,111,112,113,114,115]);
});

test('a single SKU row must not be mislabeled missing or parent-equal either', () => {
  const row = check([excel('1,300+', '78', { metricScope:'sku' })]).rows[0];
  assert.equal(row.equal, false); assert.equal(row.missingSalesCells, 0); assert.equal(row.autoCorrectionBlocked, true);
});

test('slash strings are present but unconfirmed, never summed into a parent match', () => {
  const row = check([excel('5 / 7 / 35 / 25 / 30', '32 / 28 / 7 / 1')], [source('100+', '68')]).rows[0];
  assert.equal(row.excelChinaState, 'present-unparsed'); assert.equal(row.excelLocalState, 'present-unparsed');
  assert.equal(row.equal, false); assert.equal(row.autoCorrectionBlocked, true); assert.equal(row.missingSalesCells, 0);
  assert.doesNotMatch(row.status, /누락|일치/); assert.doesNotMatch(row.excelChina, /합계/);
});

test('malformed component and undisclosed values cannot disappear in filter(Boolean)', () => {
  for (const raw of ['10 / -- / 20', 'not-a-number', '--', 'N/A', '3 /']) {
    const row = check([excel(raw, '78'), excel('1,300+', '78', {sourceRowNumber:110})]).rows[0];
    assert.equal(row.equal, false, raw); assert.equal(row.autoCorrectionBlocked, true, raw);
    assert.equal(row.missingSalesCells, 0, raw);
  }
});

for (const [china, local] of [['1,300+', '78'], ['0', '0'], ['<5', '<5'], ['100+', '30+'], ['≤5', '≥30'], ['１，３００＋', '７８']]) {
  test(`identical parent values remain an exact match: ${china}, ${local}`, () => {
    const row = check([excel(china, local)], [source(china, local)]).rows[0];
    assert.equal(row.equal, true); assert.equal(row.autoCorrectionBlocked, false); assert.equal(row.missingSalesCells, 0);
  });
}

test('range overlap is not equality: 102 vs 100+, and 4 vs <5', () => {
  for (const [a,b] of [['102','100+'], ['4','<5'], ['100+','200+']]) {
    const row = check([excel(a,'78')], [source(b,'78')]).rows[0];
    assert.equal(row.equal, false); assert.equal(row.autoCorrectionBlocked, false);
    assert.match(row.status, /값 다름/);
  }
});

test('only a confirmed empty parent cell is a missing sale value', () => {
  const row = check([excel('', '78', {hasSalesData:false, sales30d:0})]).rows[0];
  assert.equal(row.excelChinaState, 'missing'); assert.equal(row.missingSalesCells, 1);
  assert.equal(row.autoCorrectionBlocked, false); assert.match(row.status, /판매량 누락 1개/);
});

test('unknown mapping is not a blank cell and lifetime totals are never substituted', () => {
  const row = check([{spuId:'3507808', articleNumber:'1026592', totalSalesRaw:'1300', localTotalSalesRaw:'78'}]).rows[0];
  assert.equal(row.excelChinaState, 'unavailable'); assert.equal(row.missingSalesCells, 0); assert.equal(row.equal, false);
  assert.equal(row.autoCorrectionBlocked, true);
});

test('parent header evidence takes precedence over stale grouped fields and SKU flags per metric', () => {
  const p = excel('10 / 20', '3 / 4', {salesScope:'sku', reviewMetricEvidence:{
    china:{columnFound:true,columnName:'POIZON 상품 최근 30일 판매량',columnIndex:22,scope:'spu',raw:'1,300+'},
    local:{columnFound:true,columnName:'POIZON 상품 현지 판매자 최근 30일 판매량',columnIndex:23,scope:'spu',raw:'78'},
  }});
  const row = check([p]).rows[0];
  assert.equal(row.equal, true); assert.equal(row.excelChina,'1,300+'); assert.equal(row.excelLocal,'78');
  assert.equal(row.excelChinaEvidence[0].columnIndex,22);
  p.reviewMetricEvidence.local.scope = 'sku';
  assert.equal(check([p]).rows[0].autoCorrectionBlocked, true);
});

test('mixed blank and valid parent rows cannot be called fully equal or fully missing', () => {
  const row = check([excel('1,300+', '78'), excel('', '78', {hasSalesData:false,sourceRowNumber:110})]).rows[0];
  assert.equal(row.excelChinaState,'partial'); assert.equal(row.equal,false); assert.equal(row.missingSalesCells,0);
});

test('conflicting parent rows are not summed or overwritten', () => {
  const row = check([excel('100+', '78'), excel('200+', '78', {sourceRowNumber:110})]).rows[0];
  assert.equal(row.excelChinaState,'conflict'); assert.equal(row.autoCorrectionBlocked,true);
});

test('same code different SPU stays an identity conflict, not a new product', () => {
  const r = check([excel('1,300+','78', {spuId:'OTHER'})]);
  assert.equal(r.rows[0].identityConflict,true); assert.equal(r.missingProducts,0);
  assert.throws(() => assertPoizonPageReadyForCorrection([source()],r.rows,1));
});

test('guard associates reordered results by SPU and fails closed before any page write', () => {
  const items = [source(),source('100','30',{spuId:'SECOND',articleNumber:'SECOND'})];
  const r = check([excel('1,300+','78'), excel('100','30',{spuId:'SECOND',articleNumber:'SECOND'})],items);
  assert.deepEqual(assertPoizonPageReadyForCorrection(items,[...r.rows].reverse(),1),items);
  r.rows[0].autoCorrectionBlocked = true;
  assert.throws(() => assertPoizonPageReadyForCorrection(items,[...r.rows].reverse(),1), /SPU:3507808/);
  assert.throws(() => assertPoizonPageReadyForCorrection(items,r.rows.slice(1),1), /증거 수/);
});

test('normal mismatches and actual new products can still reach correction', () => {
  const mismatch = check([excel('100','30')]);
  assert.deepEqual(assertPoizonPageReadyForCorrection([source()],mismatch.rows,1),[source()]);
  const missing = check([]);
  assert.equal(missing.missingProducts,1); assert.equal(missing.rows[0].autoCorrectionBlocked,false);
  assert.deepEqual(assertPoizonPageReadyForCorrection([source()],missing.rows,1),[source()]);
});

test('shipping XLSX reader -> preview builder -> snapshot -> IPC-shaped input retains scalar SKU evidence', async (t) => {
  const main = await readFile(new URL('../main.mjs',import.meta.url),'utf8');
  const {findPoizonColumn, findPoizonRecentSalesColumns, findPoizonTotalSalesColumns} = await import('../services/poizon-xlsx.mjs');
  const {parsePoizonSalesMetric} = await import('../services/poizon-sales-filter.mjs');
  const {readReviewWorkbook} = await import('../services/poizon-review-workbook.mjs');
  const {default:writeXlsxFile} = await import('write-excel-file/node');
  const functionText = main.match(/function buildExcelPreviewProducts\([^]*?\n\}/)?.[0];
  assert.ok(functionText,'The production preview builder must exist; do not substitute a test mapper.');
  const build = runInNewContext('(' + functionText + ')',{findPoizonColumn,findPoizonRecentSalesColumns,findPoizonTotalSalesColumns,parsePoizonSalesMetric});
  const dir = await mkdtemp(join(tmpdir(),'poizon-sku-evidence-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const path = join(dir,'synthetic-sku-export.xlsx');
  const headers = ['SPU ID','SPU 이미지','상품 번호','상품명','상품 브랜드','SKU ID','사이즈/옵션/색상','최근 30일간 평균 거래가','중국 총 판매량','현지 판매자 총 판매량'];
  const originals = [headers, ['3507808','','1026592','KEEN','KEEN','SKU1','250','100','33','5'], ['3507808','','1026592','KEEN','KEEN','SKU2','260','100','100+','14'], ['3507808','','1026592','KEEN','KEEN','SKU3','270','100','--','--']];
  await writeXlsxFile(originals.map((r) => r.map((value) => ({value,type:String}))),{filePath:path});
  const before = await readFile(path);
  const snapshot = await readReviewWorkbook({path},build);
  assert.equal(snapshot.ok,true,snapshot.message); assert.equal(snapshot.products.length,3);
  const input = snapshot.products.map(({sourceValues,...p}) => p);
  const r = check(input);
  assert.equal(r.rows[0].excelChinaState,'scope-mismatch'); assert.equal(r.missingSalesCells,0);
  assert.equal(r.rows[0].excelChinaEvidence[0].column,'중국 총 판매량');
  assert.deepEqual(r.rows[0].excelChinaEvidence.map((e) => e.raw), ['33','100+','--']);
  assert.deepEqual(await readFile(path),before);

  // Execute the real capture block with the failing page, not just a guard-string assertion.
  const capture = main.slice(main.indexOf('async function captureSellerBrandSales'),main.indexOf('async function lookupSellerTransactionPrice'));
  const from = capture.indexOf('    if (liveVerifier) {'), to = capture.indexOf('    reportCaptureProgress({',from);
  assert.ok(from >= 0 && to > from);
  let writes = 0;
  const sandbox = { liveVerifier:createPageCrossCheck({runId:'shipping',excelProducts:input}),
    capture:{rows:[source()],currentPage:1,pageCount:150}, mergeSellerBrandPages:(pages) => pages.flat(),
    mainWindow:{webContents:{send(){}}}, sellerWindow:{webContents:{executeJavaScript:async () => {}}},
    paintSellerVerification(){}, verificationConditionLabel:() => '',
    checkpointSummary:{enabled:true,backupPath:''}, input:{verification:{runId:'shipping',filePath:path}},
    assertPoizonPageReadyForCorrection, syncPoizonPageCheckpoint:async () => { writes++; return {ok:true,reverified:true}; },
  };
  await assert.rejects(runInNewContext('(async()=>{' + capture.slice(from,to) + '})()',sandbox),/상품단위 비교 보류/);
  assert.equal(writes,0); assert.deepEqual(await readFile(path),before);

  // With real parent columns, correction must still work and preserve every SKU value.
  const parentHeaders = [...headers,'POIZON 상품 최근 30일 판매량','POIZON 상품 현지 판매자 최근 30일 판매량'];
  const withParents = [parentHeaders,...originals.slice(1).map((row) => [...row,'100+','30'])];
  await writeXlsxFile(withParents.map((r) => r.map((value) => ({value,type:String}))),{filePath:path});
  const parents = await readReviewWorkbook({path},build);
  const prior = check(parents.products);
  assert.equal(prior.rows[0].autoCorrectionBlocked,false); assert.equal(prior.rows[0].equal,false);
  const {syncPoizonPageCheckpoint} = await import('../services/poizon-page-checkpoint.mjs');
  const saved = await syncPoizonPageCheckpoint({filePath:path,products:assertPoizonPageReadyForCorrection([source()],prior.rows,1),pageNum:1});
  assert.equal(saved.ok,true,saved.message); assert.equal(saved.reverified,true);
  const after = await readReviewWorkbook({path},build);
  assert.equal(check(after.products).equalProducts,1);
  assert.deepEqual(after.products.map((p) => p.sourceValues.slice(0,headers.length)),originals.slice(1));
});

test('shipping build preserves strict source and both write entry points', async () => {
  const main = await readFile(new URL('../main.mjs',import.meta.url),'utf8');
  const review = await readFile(new URL('../services/poizon-review-session.mjs',import.meta.url),'utf8');
  const live = await readFile(new URL('../services/live-poizon-crosscheck.mjs',import.meta.url),'utf8');
  assert.match(live,/POIZON_METRIC_EVIDENCE_V2/); assert.doesNotMatch(live,/function compoundRecentMetric|function metricCompatible/);
  assert.match(main,/assertPoizonPageReadyForCorrection\(currentPageProducts, livePage.rows, capture.currentPage\)/);
  assert.match(review,/assertPoizonPageReadyForCorrection\(captured.products \|\| \[\], coverage.rows\)/);
  assert.match(review,/if \(row.autoCorrectionBlocked === true\) return 'unknown'/);
});
