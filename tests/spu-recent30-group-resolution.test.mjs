import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageCrossCheck, resolveExcelRecentMetric } from '../services/live-poizon-crosscheck.mjs';

const row = (rowNumber, china, local, extra = {}) => ({
  spuId: '11',
  articleNumber: 'ITEM-11',
  sourceRowNumber: rowNumber,
  sales30dRaw: china,
  localSales30dRaw: local,
  hasSalesData: china !== null,
  hasLocalSalesData: local !== null,
  ...extra,
});

const screen = (china = '100+', local = '72') => ({
  spuId: '11',
  articleNumber: 'ITEM-11',
  sales30dRaw: china,
  localSales30dRaw: local,
  hasSalesData: true,
  hasLocalSalesData: true,
});

test('blank option rows do not turn one unambiguous SPU recent-30 value into unknown', () => {
  const excel = [
    row(2, '100+', '72'),
    row(3, null, null),
    row(4, null, null),
  ];
  assert.equal(resolveExcelRecentMetric(excel, false).state, 'resolved');
  assert.equal(resolveExcelRecentMetric(excel, true).state, 'resolved');
  const result = createPageCrossCheck({ runId: 'group-1', excelProducts: excel }).acceptPage([screen()]);
  assert.equal(result.rows[0].status, '일치');
  assert.equal(result.rows[0].excelChina, '100+');
  assert.equal(result.rows[0].excelLocal, '72');
  assert.deepEqual(result.rows[0].excelRows, [2, 3, 4]);
});

test('repeated identical recent-30 values across size rows collapse to one SPU value', () => {
  const excel = [row(10, '600+', '100+'), row(11, '600+', '100+'), row(12, null, null)];
  const result = createPageCrossCheck({ runId: 'group-2', excelProducts: excel }).acceptPage([screen('600+', '100+')]);
  assert.equal(result.rows[0].status, '일치');
  assert.equal(result.rows[0].excelChina, '600+');
  assert.equal(result.rows[0].excelLocal, '100+');
});

test('conflicting valid option values are never guessed as the SPU parent value', () => {
  const excel = [row(20, '100+', '72'), row(21, '200+', '72'), row(22, null, null)];
  const result = createPageCrossCheck({ runId: 'group-3', excelProducts: excel }).acceptPage([screen('100+', '72')]);
  assert.equal(result.rows[0].status, 'Excel 최근 30일 값 충돌');
  assert.equal(result.rows[0].excelChinaState, 'conflict');
  assert.match(result.rows[0].excelChina, /100\+/);
  assert.match(result.rows[0].excelChina, /200\+/);
  assert.equal(result.rows[0].equal, false);
});

test('truly absent recent-30 values remain unknown instead of using lifetime totals', () => {
  const excel = [
    row(30, null, null, { totalSalesRaw: '900+', localTotalSalesRaw: '75' }),
    row(31, null, null, { totalSalesRaw: '800+', localTotalSalesRaw: '80' }),
  ];
  const result = createPageCrossCheck({ runId: 'group-4', excelProducts: excel }).acceptPage([screen()]);
  assert.equal(result.rows[0].status, '최근 30일 값 미확인');
  assert.equal(result.rows[0].excelChina, '미확인');
  assert.equal(result.rows[0].excelLocal, '미확인');
});
