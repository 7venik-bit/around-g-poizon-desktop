import test from 'node:test';
import assert from 'node:assert/strict';
import { findPoizonRecentSalesColumns, isPoizonRawExportSchema } from '../services/poizon-xlsx.mjs';

const poizonRawHeaders = [
  'SPU ID', 'SPU 이미지', '상품 번호', '상품명', '상품 브랜드',
  '카테고리 대분류', '카테고리 중분류', '카테고리 소분류',
  '사용자의 입찰 가능 여부 1: 입찰 가능 0: 입찰 불가',
  'SKU ID', '사이즈/옵션/색상', 'SKU 이미지', '바코드',
  '입찰 상태 0:미입찰 1:입찰 완료', '최근 30일간 평균 거래가',
  '현재 중국 최저 입찰가', '현재 중국 최저 입찰가 예상 수익',
  '중국 총 판매량', '현지 판매자 총 판매량', 'SKU 상품 출처', '판매자 SKU ID',
];

test('explicit recent-30-day headers take priority', () => {
  const headers = [...poizonRawHeaders, '중국 최근 30일 판매량', '현지 판매자 최근 30일 판매량'];
  assert.deepEqual(findPoizonRecentSalesColumns(headers), { china: 21, local: 22 });
});

test('actual POIZON raw export schema recognizes its total-sales labels as comparison fields', () => {
  assert.equal(isPoizonRawExportSchema(poizonRawHeaders), true);
  assert.deepEqual(findPoizonRecentSalesColumns(poizonRawHeaders), { china: 17, local: 18 });
});

test('generic spreadsheets never substitute total sales for recent sales', () => {
  const headers = ['SPU ID', '상품 번호', '중국 총 판매량', '현지 판매자 총 판매량'];
  assert.equal(isPoizonRawExportSchema(headers), false);
  assert.deepEqual(findPoizonRecentSalesColumns(headers), { china: -1, local: -1 });
});

test('POIZON schema accepts normalized SPU header but still requires raw-export markers', () => {
  const headers = [...poizonRawHeaders];
  headers[0] = 'SPU_ID';
  assert.equal(isPoizonRawExportSchema(headers), true);
  assert.deepEqual(findPoizonRecentSalesColumns(headers), { china: 17, local: 18 });
});

test('ambiguous duplicate total-sales columns are not guessed even in POIZON export', () => {
  const headers = [...poizonRawHeaders];
  headers.splice(18, 0, '중국 총 판매량(건)');
  const result = findPoizonRecentSalesColumns(headers);
  assert.equal(result.china, -1);
  assert.equal(result.local, 19);
});
