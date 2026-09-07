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
import { createPageCrossCheck, selectPoizonPageCorrectionProducts } from '../services/live-poizon-crosscheck.mjs';

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

test('SKU rows are neither missing nor overwritten and a page may continue with an explicit deferred count', async (t) => {
  const f = await fixture(t);
  const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
  const snapshot = await readReviewWorkbook({ path:f.path }, productionBuilder(main));
  const screen = [source('4962345','HQ1801','4,000+','200')];
  const page = createPageCrossCheck({ runId:'real-adidas', excelProducts:snapshot.products }).acceptPage(screen, { pageNum:1, pageCount:150 });
  assert.equal(page.matchedProducts, 1);
  assert.equal(page.missingProducts, 0);
  assert.equal(page.missingSalesCells, 0);
  assert.equal(page.deferredProducts, 1);
  assert.match(page.rows[0].status, /옵션별 판매량 존재 · 상품단위 비교 보류/);
  assert.doesNotMatch(page.rows[0].status, /판매량 누락/);
  const selected = selectPoizonPageCorrectionProducts(screen, page.rows, 1);
  assert.equal(selected.products.length, 0);
  assert.equal(selected.deferredProducts, 1);
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
