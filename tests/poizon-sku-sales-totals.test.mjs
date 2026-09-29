import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePoizonSkuSales, filterPoizonPreviewRows } from '../services/poizon-sales-filter.mjs';

const aggregate = (values) => aggregatePoizonSkuSales(values.map((value, i) => ({ skuId: String(i), value })));

test('original SKU totals add distinct sizes instead of taking the largest size', () => {
  assert.deepEqual(aggregate([5, 16, 15, 8, 5, '<5', '<5', '--']), {
    available: true, minimum: 49, maximum: null, raw: '49+', skuCount: 8,
  });
  assert.equal(aggregate([13, 17, 14, 26]).raw, '70');
  assert.equal(aggregate([24, 49, 48, 54, 50, 21, 8, '--']).raw, '254+');
});

test('censored values retain bounds, never an invented exact count', () => {
  assert.deepEqual(aggregate(['<5', '<5']), { available: true, minimum: 0, maximum: 8, raw: '<9', skuCount: 2 });
  assert.equal(aggregate([16, '<5']).raw, '16~20');
  assert.equal(aggregate(['<5', '--']).raw, '합계 미확정');
  assert.equal(aggregate(['--', '']).available, false);
  assert.equal(aggregate(['0', 0]).raw, '0');
  assert.equal(aggregate(['1,000+', '３０']).raw, '1030+');
});

test('duplicate SKU observations count once and conflicting values remain unknown', () => {
  const summarize = (values) => aggregatePoizonSkuSales(values.map((value) => ({ skuId: 'same', value })));
  assert.equal(summarize([16, 16, '--']).raw, '16');
  assert.equal(summarize(['10+', 16]).raw, '16');
  assert.equal(summarize([16, 17]).available, false);
  assert.equal(aggregatePoizonSkuSales([{ skuId: '', value: 16 }]), null);
  assert.equal(aggregatePoizonSkuSales([{ skuId: 'A', value: 16 }, { skuId: '', value: 16 }]).raw, '16+');
});

const headers = ['SPU ID', '상품 번호', 'SKU ID', '중국 총 판매량', '현지 판매자 총 판매량'];
const rows = [
  ['A', 'SHOE', 'A1', 20, 16], ['A', 'SHOE', 'A2', 20, 15], ['A', 'SHOE', 'A3', '--', '--'],
  ...Array.from({ length: 7 }, (_, i) => ['B', 'UNCERTAIN', `B${i}`, 10, '<5']),
  ['C', 'UNKNOWN', 'C1', 100, '--'],
];

test('product filter qualifies proven SKU sums, retains options, and does not qualify guessed sums', () => {
  const before = structuredClone(rows);
  const result = filterPoizonPreviewRows(headers, rows, { salesMetric: 'total', minimumLocalTotal: 25 });
  assert.equal(result.filteredProducts, 1);
  assert.equal(result.localQualifiedProducts, 1);
  assert.equal(result.missingLocalProducts, 1);
  assert.deepEqual(result.entries.map((e) => e.values[2]), ['A1', 'A2', 'A3']);
  assert.equal(result.entries[0].originalSalesTotals.local.raw, '31+');
  assert.deepEqual(rows, before);
});

test('an upper bound filter does not accept a partial sum as an exact total', () => {
  const result = filterPoizonPreviewRows(headers, rows, { salesMetric: 'total', maximumLocalTotal: 35 });
  assert.deepEqual([...new Set(result.entries.map((e) => e.values[0]))], ['B']);
});

test('original row filtering is unchanged and does not attach a product total', () => {
  const result = filterPoizonPreviewRows(headers, rows, { salesMetric: 'total', rowLevel: true, minimumLocalTotal: 25 });
  assert.equal(result.entries.length, 0);
});
