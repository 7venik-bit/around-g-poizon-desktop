import test from 'node:test';
import assert from 'node:assert/strict';
import { findPoizonRecentSalesColumns } from '../services/poizon-xlsx.mjs';

test('explicit recent-30-day headers take priority', () => {
  const headers = [
    'SPU ID',
    '중국 최근 30일 판매량',
    '현지 판매자 최근 30일 판매량',
    '중국 총 판매량',
    '현지 판매자 총 판매량',
  ];
  assert.deepEqual(findPoizonRecentSalesColumns(headers), { china: 1, local: 2 });
});

test('POIZON export total-sales labels are recognized when recent headers are absent', () => {
  const headers = [
    'SPU ID',
    '상품 번호',
    '중국 총 판매량',
    '현지 판매자 총 판매량',
  ];
  assert.deepEqual(findPoizonRecentSalesColumns(headers), { china: 2, local: 3 });
});

test('header spacing, parentheses and count suffixes normalize across files', () => {
  const headers = [
    'SPU_ID',
    '중국 시장 총 판매량(건)',
    '현지 판매자 총 판매량 [개]',
  ];
  assert.deepEqual(findPoizonRecentSalesColumns(headers), { china: 1, local: 2 });
});

test('ambiguous duplicate total-sales columns are not guessed', () => {
  const headers = [
    'SPU ID',
    '중국 총 판매량',
    '중국 총 판매량(건)',
    '현지 판매자 총 판매량',
  ];
  const result = findPoizonRecentSalesColumns(headers);
  assert.equal(result.china, -1);
  assert.equal(result.local, 3);
});
