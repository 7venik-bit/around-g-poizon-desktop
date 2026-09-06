import test from 'node:test';
import assert from 'node:assert/strict';
import { recentMetric, resolveExcelRecentMetric, createPageCrossCheck } from '../services/live-poizon-crosscheck.mjs';

test('explicit recent raw survives a stale availability flag', () => {
  const metric = recentMetric({ sales30dRaw: '100+', sales30d: 100, hasSalesData: false });
  assert.equal(metric?.raw, '100+');
});

test('missing recent value reports total-sales evidence instead of plain unknown', () => {
  const resolved = resolveExcelRecentMetric([{ totalSalesRaw: '800+', hasTotalSalesData: true }]);
  assert.equal(resolved.state, 'missing');
  assert.match(resolved.raw, /최근30일 값 없음/);
  assert.match(resolved.raw, /총판매 800\+/);
});

test('cross-check exposes which Excel recent metric is missing', () => {
  const excel = [{ spuId: '11', articleNumber: 'A11', sourceRowNumber: 2, totalSalesRaw: '700+', localTotalSalesRaw: '40' }];
  const source = [{ spuId: '11', articleNumber: 'A11', sales30dRaw: '100+', localSales30dRaw: '30', hasSalesData: true, hasLocalSalesData: true }];
  const row = createPageCrossCheck({ runId: 'diag', excelProducts: excel }).acceptPage(source, { pageNum: 1 }).rows[0];
  assert.equal(row.status, 'Excel 최근 30일 값 없음 (2개 항목)');
  assert.match(row.excelChina, /총판매 700\+/);
  assert.match(row.excelLocal, /총판매 40/);
});

test('conflicting valid recent values still never get guessed', () => {
  const resolved = resolveExcelRecentMetric([
    { sales30dRaw: '100+', hasSalesData: true },
    { sales30dRaw: '200+', hasSalesData: true },
  ]);
  assert.equal(resolved.state, 'conflict');
  assert.match(resolved.raw, /100\+/);
  assert.match(resolved.raw, /200\+/);
});
