import test from 'node:test';
import assert from 'node:assert/strict';
import { findPoizonRecentSalesColumns } from '../services/poizon-xlsx.mjs';

test('standard recent-30-day headers remain mapped', () => {
  const headers = ['SPU ID', '최근 30일 판매량', '현지 판매자 최근 30일 판매량'];
  assert.deepEqual(findPoizonRecentSalesColumns(headers), { china: 1, local: 2 });
});

test('POIZON export header wording variants map without becoming unknown', () => {
  const cases = [
    ['중국 시장 최근 30일 판매량(원본)', '현지 판매자 최근 30일 판매량(원본)'],
    ['중국 최근30일 판매량 - POIZON', '현지 판매자 최근30일 판매량 - POIZON'],
    ['최근 30일 판매량(중국 시장)', '현지 판매자 최근 30일 판매량 [검증값]'],
    ['중국 시장 / 최근 30일 판매량', '현지 판매자 / 최근 30일 판매량'],
  ];
  for (const pair of cases) {
    assert.deepEqual(findPoizonRecentSalesColumns(['SPU ID', ...pair, '최근 30일 평균 거래가']), { china: 1, local: 2 }, pair.join(' / '));
  }
});

test('generic china recent sales is allowed only when it is the sole non-local recent-sales column', () => {
  assert.deepEqual(findPoizonRecentSalesColumns(['최근 30일 판매량', '현지 판매자 최근 30일 판매량']), { china: 0, local: 1 });
  assert.deepEqual(findPoizonRecentSalesColumns(['최근 30일 판매량', '최근 30일 판매량 보조', '현지 판매자 최근 30일 판매량']), { china: -1, local: 2 });
});

test('lifetime totals and average transaction price never substitute for recent sales', () => {
  const headers = ['중국 총 판매량', '현지 판매자 총 판매량', '최근 30일 평균 거래가'];
  assert.deepEqual(findPoizonRecentSalesColumns(headers), { china: -1, local: -1 });
});

test('china and local columns never cross-map', () => {
  assert.deepEqual(findPoizonRecentSalesColumns(['현지 판매자 최근 30일 판매량']), { china: -1, local: 0 });
  assert.deepEqual(findPoizonRecentSalesColumns(['중국 최근 30일 판매량']), { china: 0, local: -1 });
});
