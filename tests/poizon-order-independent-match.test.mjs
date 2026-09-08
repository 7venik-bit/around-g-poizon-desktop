import test from 'node:test';
import assert from 'node:assert/strict';
import { indexProductIdentities, resolveProductIdentity } from '../services/poizon-product-identity.mjs';
import { createPageCrossCheck } from '../services/live-poizon-crosscheck.mjs';

const excel = (spuId, articleNumber, sourceRowNumber, sales30d, localSales30d, extra = {}) => ({
  spuId, articleNumber, sourceRowNumber, sales30d, localSales30d,
  sales30dRaw: String(sales30d), localSales30dRaw: String(localSales30d),
  hasSalesData: true, hasLocalSalesData: true, salesScope: 'spu', metricScope: 'spu', ...extra,
});
const screen = (spuId, articleNumber, sales30d, localSales30d, extra = {}) => ({
  spuId, articleNumber, sales30d, localSales30d,
  sales30dRaw: String(sales30d), localSales30dRaw: String(localSales30d),
  hasSalesData: true, hasLocalSalesData: true, salesScope: 'spu', metricScope: 'spu', ...extra,
});

test('POIZON page order does not need to match Excel row order', () => {
  const workbook = [
    excel('300', 'C-3', 2, 300, 30),
    excel('100', 'A-1', 3, 100, 10),
    excel('200', 'B-2', 4, 200, 20),
  ];
  const session = createPageCrossCheck({ runId: 'order', excelProducts: workbook });
  const result = session.acceptPage([
    screen('200', 'B-2', 200, 20),
    screen('300', 'C-3', 300, 30),
    screen('100', 'A-1', 100, 10),
  ], { pageNum: 147, pageCount: 150 });
  assert.equal(result.matchedProducts, 3);
  assert.equal(result.equalProducts, 3);
  assert.equal(result.missingProducts, 0);
  assert.deepEqual(result.rows.map((row) => row.excelRows), [[4], [2], [3]]);
  assert.deepEqual(result.rows.map((row) => row.matchBy), ['SPU', 'SPU', 'SPU']);
});

test('SPU match is primary even when article text differs', () => {
  const index = indexProductIdentities([excel('900', 'EXCEL-CODE', 77, 42, 7)]);
  const matched = resolveProductIdentity(screen('900', 'SCREEN-CODE', 42, 7), index);
  assert.equal(matched.matchBy, 'SPU');
  assert.deepEqual(matched.products.map((p) => p.sourceRowNumber), [77]);
});

test('article fallback searches the whole workbook, not the same array position', () => {
  const workbook = [excel('', 'OTHER', 2, 1, 1), excel('', 'TARGET-77', 900, 55, 8)];
  const result = createPageCrossCheck({ runId: 'article', excelProducts: workbook })
    .acceptPage([screen('', 'target 77', 55, 8)], { pageNum: 1, pageCount: 1 });
  assert.equal(result.matchedProducts, 1);
  assert.equal(result.equalProducts, 1);
  assert.equal(result.rows[0].matchBy, '상품번호');
  assert.deepEqual(result.rows[0].excelRows, [900]);
});

test('same SPU may map to multiple Excel option rows without depending on order', () => {
  const workbook = [
    excel('777', 'SKU-PARENT', 41, 10, 5, { skuId: 'S2', salesScope: 'sku', metricScope: 'sku' }),
    excel('999', 'OTHER', 42, 1, 1),
    excel('777', 'SKU-PARENT', 80, 20, 6, { skuId: 'S1', salesScope: 'sku', metricScope: 'sku' }),
  ];
  const result = createPageCrossCheck({ runId: 'sku', excelProducts: workbook })
    .acceptPage([screen('777', 'SKU-PARENT', 100, 10)], { pageNum: 1, pageCount: 1 });
  assert.equal(result.matchedProducts, 1);
  assert.deepEqual(result.rows[0].excelRows, [41, 80]);
  assert.match(result.rows[0].status, /옵션별 판매량 존재/);
  assert.equal(result.rows[0].autoCorrectionBlocked, true);
});

test('known different SPU is never falsely matched by the same article', () => {
  const workbook = [excel('111', 'SAME-CODE', 2, 10, 5)];
  const result = createPageCrossCheck({ runId: 'conflict', excelProducts: workbook })
    .acceptPage([screen('222', 'SAME-CODE', 10, 5)], { pageNum: 1, pageCount: 1 });
  assert.equal(result.matchedProducts, 0);
  assert.equal(result.rows[0].identityConflict, true);
  assert.match(result.rows[0].status, /식별자 충돌/);
});
