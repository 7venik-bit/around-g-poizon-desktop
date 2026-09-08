import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import writeXlsxFile from 'write-excel-file/node';
import { readReviewWorkbook } from '../services/poizon-review-workbook.mjs';
import { findPoizonColumn, findPoizonRecentSalesColumns, findPoizonTotalSalesColumns } from '../services/poizon-xlsx.mjs';
import { parsePoizonSalesMetric } from '../services/poizon-sales-filter.mjs';
import { createPageCrossCheck, selectPoizonPageCorrectionProducts, assertPoizonPageReadyForCorrection } from '../services/live-poizon-crosscheck.mjs';

const source = (spuId, articleNumber, china, local) => ({
  spuId, articleNumber, sales30dRaw: china, localSales30dRaw: local,
  sales30d: Number(String(china).replace(/[^\d]/g, '')) || 0,
  localSales30d: Number(String(local).replace(/[^\d]/g, '')) || 0,
  hasSalesData: true, hasLocalSalesData: true,
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'poizon-real-export-shape-'));
  t.after(() => rm(dir, { recursive:true, force:true }));
  const path = join(dir, '1004816848_Adidas_sample.xlsx');
  // Exact column order used by the uploaded Adidas POIZON export.
  const headers = ['SPU ID','SPU 이미지','상품 번호','상품명','상품 브랜드','카테고리 대분류','카테고리 중분류','카테고리 소분류','사용자의 입찰 가능 여부 1: 입찰 가능 0: 입찰 불가','SKU ID','사이즈/옵션/색상','SKU 이미지','바코드','입찰 상태 0:미입찰 1:입찰 완료','최근 30일간 평균 거래가','현재 중국 최저 입찰가','현재 중국 최저 입찰가 예상 수익','중국 총 판매량','현지 판매자 총 판매량','SKU 상품 출처','판매자 SKU ID'];
  const rows = [
    headers,
    ['4962345','','HQ1801','아디다스 샘플','Adidas','','','','1','700031743','사이즈:KR 215','','','0','','','','100+','--','',''],
    ['4962345','','HQ1801','아디다스 샘플','Adidas','','','','1','624556738','사이즈:KR 220','','','0','','','','300+','<5','',''],
    ['4962345','','HQ1801','아디다스 샘플','Adidas','','','','1','624556739','사이즈:KR 225','','','0','','','','200+','7','',''],
  ];
  const columns = headers.map(() => ({ type:String, value:(value) => String(value ?? '') }));
  await writeXlsxFile([{ sheet:'SkuExportExcel|1', columns, data:rows }]).toFile(path);
  return { path, rows };
}

function productionBuilder(main) {
  const text = main.match(/function buildExcelPreviewProducts\([^]*?\n\}/)?.[0];
  assert.ok(text, 'production buildExcelPreviewProducts must exist');
  return runInNewContext('(' + text + ')', { findPoizonColumn, findPoizonRecentSalesColumns, findPoizonTotalSalesColumns, parsePoizonSalesMetric });
}

test('uploaded POIZON raw export retains SKU rows and exposes them as SKU-scope comparison evidence', async (t) => {
  const f = await fixture(t);
  const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
  const snapshot = await readReviewWorkbook({ path:f.path }, productionBuilder(main));
  assert.equal(snapshot.ok, true, snapshot.message);
  assert.equal(snapshot.products.length, 3);
  assert.deepEqual(snapshot.products.map((p) => p.skuId), ['700031743','624556738','624556739']);
  assert.deepEqual(snapshot.products.map((p) => p.sales30dRaw), ['100+','300+','200+']);

  const page = createPageCrossCheck({ runId:'reader-evidence', excelProducts:snapshot.products })
    .acceptPage([source('4962345','HQ1801','4,000+','200')], { pageNum:1, pageCount:150 });
  const row = page.rows[0];
  assert.equal(row.excelChinaState, 'scope-mismatch');
  assert.equal(row.excelLocalState, 'scope-mismatch');
  assert.deepEqual(row.excelChinaEvidence.map((e) => e.raw), ['100+','300+','200+']);
  assert.ok(row.excelChinaEvidence.every((e) => e.scope === 'sku'));
  assert.ok(row.excelLocalEvidence.every((e) => e.scope === 'sku'));
  assert.equal(row.missingSalesCells, 0);
});

test('conflicting SKU rows are neither missing nor overwritten and stop pagination', async (t) => {
  const f = await fixture(t);
  const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
  const snapshot = await readReviewWorkbook({ path:f.path }, productionBuilder(main));
  const screen = [source('4962345','HQ1801','4,000+','200')];
  const page = createPageCrossCheck({ runId:'real-adidas', excelProducts:snapshot.products }).acceptPage(screen, { pageNum:1, pageCount:150 });
  assert.equal(page.matchedProducts, 1);
  assert.equal(page.missingProducts, 0);
  assert.equal(page.missingSalesCells, 0);
  assert.equal(page.deferredProducts, 1);
  assert.match(page.rows[0].status, /옵션별 판매량 존재 · SPU 자동수정 제외/);
  assert.doesNotMatch(page.rows[0].status, /판매량 누락|수정 대상|상품 없음/);
  assert.throws(() => selectPoizonPageCorrectionProducts(screen, page.rows, 1), /다음 페이지 이동을 보류/);
});

test('shipping main blocks page navigation until the current page checkpoint is reverified', async () => {
  const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
  const view = await readFile(new URL('../src/poizon-review-workspace.js', import.meta.url), 'utf8');
  const start = main.indexOf('async function captureSellerBrandSales');
  const end = main.indexOf('async function lookupSellerTransactionPrice', start);
  assert.ok(start >= 0 && end > start, 'capture function must be present');
  const capture = main.slice(start, end);
  assert.match(capture, /POIZON_PAGE_TRANSACTION_GATE/);
  assert.match(capture, /enabled: Boolean\(liveVerifier\)/);
  assert.match(capture, /filePath: String\(input\.verification\?\.filePath \|\| input\.filePath \|\| ""\)\.trim\(\)/);
  assert.match(capture, /if \(checkpointSummary\.enabled && !checkpointSummary\.filePath\)/);
  assert.match(capture, /filePath: checkpointSummary\.filePath/);
  const checkpointAt = capture.indexOf('const checkpoint = pageCorrection.products.length');
  const nextPageAt = capture.indexOf('const expectedNextPage = capture.currentPage + 1');
  assert.ok(checkpointAt >= 0 && nextPageAt > checkpointAt, 'checkpoint must complete before next-page calculation');
  assert.match(capture.slice(checkpointAt, nextPageAt), /if \(!checkpoint\?\.ok \|\| checkpoint\.reverified !== true\)/);
  assert.match(view, /const verificationFilePath = String\(file\.path \|\| file\.filePath \|\| file\.fullPath \|\| snapshot\?\.file\?\.path \|\| snapshot\?\.path \|\| ''\)\.trim\(\)/);
  assert.match(view, /filePath: verificationFilePath/);
});

test('real SPU-level mismatch remains actionable while SKU-only rows remain deferred', () => {
  const screen = [source('11','ITEM-11','100+','30')];
  const parentExcel = [{
    spuId:'11', articleNumber:'ITEM-11', sales30dRaw:'90', localSales30dRaw:'20',
    sales30d:90, localSales30d:20, hasSalesData:true, hasLocalSalesData:true,
    salesScope:'spu', metricScope:'spu', sourceRowNumber:2,
  }];
  const page = createPageCrossCheck({ runId:'spu-actionable', excelProducts:parentExcel }).acceptPage(screen, { pageNum:1, pageCount:1 });
  assert.equal(page.deferredProducts, 0);
  assert.match(page.rows[0].status, /판매량 값 다름/);
  const selected = selectPoizonPageCorrectionProducts(screen, page.rows, 1);
  assert.equal(selected.products.length, 1);
  assert.equal(selected.deferredProducts, 0);
});

test('shipping main and final review both use SKU-safe selection before writes', async () => {
  const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
  const review = await readFile(new URL('../services/poizon-review-session.mjs', import.meta.url), 'utf8');
  assert.match(main, /POIZON_SKU_SAFE_PAGE_SELECTION/);
  assert.match(main, /selectPoizonPageCorrectionProducts\(currentPageProducts, livePage\.rows, capture\.currentPage\)/);
  assert.match(review, /POIZON_SKU_SAFE_FINAL_SELECTION/);
  assert.match(review, /selectPoizonPageCorrectionProducts\(captured\.products \|\| \[\], coverage\.rows\)/);
});

// Both the legacy checkpoint API and the current selector must fail closed.
test('canonical selector and checkpoint guard share reordered evidence and metadata', () => {
  const products = [source('11','ITEM-11','100','30'), source('22','ITEM-22','200','40')];
  const excel = [{...products[0], salesScope:'sku', sourceRowNumber:2}, {...products[1], localSales30dRaw:'20', sourceRowNumber:3}];
  const page = createPageCrossCheck({runId:'mixed-policy',excelProducts:excel}).acceptPage(products,{pageNum:1,pageCount:1});
  const rows = [...page.rows].reverse();
  assert.throws(() => assertPoizonPageReadyForCorrection(products,rows,1), /다음 페이지 이동을 보류/);
  assert.throws(() => selectPoizonPageCorrectionProducts(products,rows,1), /다음 페이지 이동을 보류/);
});

test('SKU scope never masks an unreadable POIZON screen or an identity conflict', () => {
  const product = source('11','ITEM-11','100','30');
  const excel = [{...product,salesScope:'sku',sourceRowNumber:2}];
  for (const side of ['sales30d','localSales30d']) {
    const bad = {...product,[side+'Raw']:'--'};
    const page = createPageCrossCheck({runId:'unreadable-'+side,excelProducts:excel}).acceptPage([bad],{pageNum:1,pageCount:1});
    assert.equal(page.deferredProducts,0);
    for (const choose of [assertPoizonPageReadyForCorrection,selectPoizonPageCorrectionProducts]) {
      assert.throws(() => choose([bad],page.rows,1),/미확인/);
    }
  }
  const page = createPageCrossCheck({runId:'identity-conflict',excelProducts:excel}).acceptPage([product],{pageNum:1,pageCount:1});
  page.rows[0].identityConflict = true;
  for (const choose of [assertPoizonPageReadyForCorrection,selectPoizonPageCorrectionProducts]) {
    assert.throws(() => choose([product],page.rows,1));
  }
});

test('duplicate product identities and mixed unresolved evidence never reach a writer', () => {
  const a=source('11','ITEM-11','100','30'), b=source('22','ITEM-22','200','40');
  const page=createPageCrossCheck({runId:'duplicate',excelProducts:[a,b]}).acceptPage([a,b],{pageNum:1,pageCount:1});
  for (const choose of [assertPoizonPageReadyForCorrection,selectPoizonPageCorrectionProducts]) {
    assert.throws(() => choose([a,a],page.rows,1),/중복/);
    assert.throws(() => choose([a,b],[page.rows[0],page.rows[0]],1),/중복/);
    assert.throws(() => choose([a,b],page.rows.slice(1),1),/증거 수/);
  }
  const blocked=createPageCrossCheck({runId:'mixed-block',excelProducts:[{...a,salesScope:'sku'},{...b,localSales30dRaw:'--'}]})
    .acceptPage([a,b],{pageNum:1,pageCount:1});
  for (const choose of [assertPoizonPageReadyForCorrection,selectPoizonPageCorrectionProducts]) {
    assert.throws(() => choose([a,b],blocked.rows,1));
  }
});

test('final review of SKU-only workbook makes no writer calls and preserves every byte', async (t) => {
  const {runPoizonReviewBatch}=await import('../services/poizon-review-session.mjs');
  const f=await fixture(t), before=await readFile(f.path);
  const main=await readFile(new URL('../main.mjs',import.meta.url),'utf8');
  const build=productionBuilder(main);
  const snapshot=await readReviewWorkbook({path:f.path},build);
  const products=[source('4962345','HQ1801','4,000+','200')];
  const page=createPageCrossCheck({runId:'final-skip',excelProducts:snapshot.products})
    .acceptPage(products,{pageNum:1,pageCount:1});
  let writes=0;
  const api={
    readPoizonReviewWorkbook:async () => readReviewWorkbook({path:f.path},build),
    beginSellerExcelVerification:async () => ({ok:true}),
    endSellerExcelVerification:async () => ({ok:true}),
    captureSellerBrandSales:async () => ({ok:true,products,sourceTotal:1,missingCount:0}),
    checkPoizonReviewWorkbook:async () => ({ok:true,unchanged:true}),
    syncExcelWithSellerScreen:async () => {writes++;throw new Error('SKU-only review must not call a writer');},
  };
  const view={input:{runId:'final-skip'},events:()=>[page],finish(){},showReport(){}};
  const report=await runPoizonReviewBatch({files:[{path:f.path,name:'sku.xlsx'}],api,createView:async()=>view});
  assert.equal(report.complete,false,JSON.stringify(report));
  assert.match(report.files[0].message,/다음 페이지 이동을 보류/);
  assert.equal(writes,0);
  assert.deepEqual(await readFile(f.path),before);
});

test('evidence patches are repeatable in either order and never rewrite policy or tests', async (t) => {
  const {mkdir,writeFile}=await import('node:fs/promises');
  const {spawnSync}=await import('node:child_process');
  const dir=await mkdtemp(join(tmpdir(),'poizon-patch-repeat-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const files=['main.mjs','services/poizon-review-session.mjs','services/live-poizon-crosscheck.mjs',
    'src/poizon-review-workspace.js','scripts/run-release-regressions.mjs',
    'scripts/patch-poizon-fake-missing.mjs','scripts/patch-poizon-sku-safe-pagination.mjs',
    'tests/poizon-fake-missing.test.mjs','tests/poizon-sku-safe-pagination.test.mjs'];
  const before=new Map();
  for(const file of files){
    const content=await readFile(new URL('../'+file,import.meta.url));before.set(file,content);
    await mkdir(join(dir,file,'..'),{recursive:true});await writeFile(join(dir,file),content);
  }
  for(const script of ['fake-missing','sku-safe-pagination','fake-missing','sku-safe-pagination','sku-safe-pagination','fake-missing']){
    const result=spawnSync(process.execPath,[join(dir,'scripts/patch-poizon-'+script+'.mjs')],{cwd:dir,encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
  }
  for(const [file,content] of before)assert.deepEqual(await readFile(join(dir,file)),content,file+' changed on reapplication');
  const service='services/live-poizon-crosscheck.mjs';
  await writeFile(join(dir,service),before.get(service).toString().replace('POIZON_SKU_SAFE_DEFER_V1','MISSING_POLICY'));
  const failed=spawnSync(process.execPath,[join(dir,'scripts/patch-poizon-sku-safe-pagination.mjs')],{cwd:dir,encoding:'utf8'});
  assert.notEqual(failed.status,0);
  assert.match(failed.stderr,/Canonical SKU-safe evidence policy is missing/);
});
