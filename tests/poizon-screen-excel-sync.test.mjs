import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { applyPoizonScreenSalesToWorkbook } from '../services/poizon-screen-excel-sync.mjs';

function workbook() {
  const shared = '<sst>'
    + '<si><t>SPU ID</t></si><si><t>상품 번호</t></si>'
    + '<si><t>중국 총 판매량</t></si><si><t>현지 판매자 총 판매량</t></si>'
    + '<si><t>SKU ID</t></si><si><t>최근 30일간 평균 거래가</t></si>'
    + '<si><t>19438508</t></si><si><t>JWVAX25017</t></si><si><t>다른상품</t></si>'
    + '<si><t>SKU-1</t></si><si><t>SKU-2</t></si>'
    + '</sst>';
  const sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>6</v></c><c r="B2" t="s"><v>7</v></c><c r="C2" s="2"><v>13</v></c><c r="D2" s="2"><v>10</v></c><c r="E2" t="s"><v>9</v></c><c r="F2"><v>1000</v></c></row>'
    + '<row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>8</v></c><c r="D3"><v>5</v></c><c r="E3" t="s"><v>10</v></c><c r="F3"><v>1100</v></c></row>'
    + '</sheetData></worksheet>';
  return Buffer.from(zipSync({ 'xl/sharedStrings.xml': strToU8(shared), 'xl/worksheets/sheet1.xml': strToU8(sheet) }));
}

test('POIZON 화면값을 기준으로 기존 Excel 판매량 셀의 불일치와 누락을 직접 수정한다', () => {
  const result = applyPoizonScreenSalesToWorkbook(workbook(), [{
    spuId: '19438508', articleNumber: 'JWVAX25017', sales30dRaw: '100+', hasSalesData: true,
    localSales30dRaw: '83', hasLocalSalesData: true,
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.changedRows, 2);
  assert.equal(result.changedCells, 4);
  assert.equal(result.missingCells, 1);
  assert.equal(result.mismatchedCells, 3);
  assert.equal(result.reverified, true);
  assert.equal(result.verifiedCells, 4);
  assert.equal(result.comparisonMode, 'POIZON_SCREEN_IS_SOURCE_OF_TRUTH');
  assert.equal(result.usedDedicatedColumns, false);

  const xml = strFromU8(unzipSync(new Uint8Array(result.buffer))['xl/worksheets/sheet1.xml']);
  assert.match(xml, /<c r="C2" s="2" t="inlineStr"><is><t>100\+<\/t>/);
  assert.match(xml, /<c r="D2" s="2" t="inlineStr"><is><t>83<\/t>/);
  assert.match(xml, /<c r="C3" t="inlineStr"><is><t>100\+<\/t>/);
  assert.match(xml, /<c r="D3" t="inlineStr"><is><t>83<\/t>/);
  assert.doesNotMatch(xml, /POIZON 상품 최근 30일 판매량/);
  assert.ok(result.changes.some((change) => change.reason === 'MISSING_VALUE'));
  assert.ok(result.changes.some((change) => change.reason === 'VALUE_MISMATCH'));
});

test('Excel 값이 이미 POIZON 화면값과 같으면 수정하지 않고 일치로 재검증한다', () => {
  const first = applyPoizonScreenSalesToWorkbook(workbook(), [{
    spuId: '19438508', articleNumber: 'JWVAX25017', sales30dRaw: '100+', hasSalesData: true,
    localSales30dRaw: '83', hasLocalSalesData: true,
  }]);
  const second = applyPoizonScreenSalesToWorkbook(first.buffer, [{
    spuId: '19438508', articleNumber: 'JWVAX25017', sales30dRaw: '100+', hasSalesData: true,
    localSales30dRaw: '83', hasLocalSalesData: true,
  }]);
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(second.changedCells, 0);
  assert.equal(second.alreadyMatchedCells, 4);
  assert.equal(second.verifiedCells, 4);
});

test('POIZON 화면에서 검증되지 않은 값은 Excel 원본을 임의 수정하지 않는다', () => {
  const result = applyPoizonScreenSalesToWorkbook(workbook(), [{
    spuId: '19438508', articleNumber: 'JWVAX25017', hasSalesData: false, hasLocalSalesData: false,
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.changedCells, 0);
});

test('상품 SPU가 충돌하면 POIZON 값으로 강제 수정하지 않는다', () => {
  const result = applyPoizonScreenSalesToWorkbook(workbook(), [{
    spuId: '99999999', articleNumber: 'JWVAX25017', sales30dRaw: '500+', hasSalesData: true,
    localSales30dRaw: '90', hasLocalSalesData: true,
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.addedRows, 0);
  assert.ok(result.unresolvedRows > 0 || result.conflictedRows > 0 || result.skippedConflictedProducts > 0);
});

test('Excel에 상품 행 자체가 없으면 확정 SPU와 POIZON 판매량으로 새 행을 추가하고 재검증한다', () => {
  const result = applyPoizonScreenSalesToWorkbook(workbook(), [{
    spuId: '77777777', articleNumber: 'NEW777', title: 'POIZON 누락 상품',
    sales30dRaw: '250+', hasSalesData: true, localSales30dRaw: '44', hasLocalSalesData: true,
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.addedRows, 1);
  assert.equal(result.addedProducts, 1);
  assert.equal(result.addedVerifiedRows, 1);
  assert.equal(result.changed, true);
  assert.ok(result.changes.some((change) => change.reason === 'MISSING_PRODUCT_ROW' && change.spuId === '77777777'));

  const xml = strFromU8(unzipSync(new Uint8Array(result.buffer))['xl/worksheets/sheet1.xml']);
  assert.match(xml, /<row r="4">/);
  assert.match(xml, /<c r="A4"[^>]*t="inlineStr"><is><t>77777777<\/t>/);
  assert.match(xml, /<c r="B4"[^>]*t="inlineStr"><is><t>NEW777<\/t>/);
  assert.match(xml, /<c r="C4"[^>]*t="inlineStr"><is><t>250\+<\/t>/);
  assert.match(xml, /<c r="D4"[^>]*t="inlineStr"><is><t>44<\/t>/);
  assert.match(xml, /<dimension ref="A1:F4"\/>/);
});

test('이미 추가된 SPU는 재실행해도 중복 행을 만들지 않는다', () => {
  const product = {
    spuId: '77777777', articleNumber: 'NEW777', sales30dRaw: '250+', hasSalesData: true,
    localSales30dRaw: '44', hasLocalSalesData: true,
  };
  const first = applyPoizonScreenSalesToWorkbook(workbook(), [product]);
  const second = applyPoizonScreenSalesToWorkbook(first.buffer, [product]);
  assert.equal(first.addedRows, 1);
  assert.equal(second.ok, true);
  assert.equal(second.addedRows, 0);
  const xml = strFromU8(unzipSync(new Uint8Array(second.buffer))['xl/worksheets/sheet1.xml']);
  assert.equal((xml.match(/77777777/g) || []).length, 1);
});

test('SPU가 없거나 동일 SPU의 상품번호가 충돌하면 새 Excel 행을 자동 추가하지 않는다', () => {
  const result = applyPoizonScreenSalesToWorkbook(workbook(), [
    { articleNumber: 'NO-SPU', sales30dRaw: '300+', hasSalesData: true, localSales30dRaw: '50', hasLocalSalesData: true },
    { spuId: '88888888', articleNumber: 'CODE-A', sales30dRaw: '300+', hasSalesData: true, localSales30dRaw: '50', hasLocalSalesData: true },
    { spuId: '88888888', articleNumber: 'CODE-B', sales30dRaw: '300+', hasSalesData: true, localSales30dRaw: '50', hasLocalSalesData: true },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.addedRows, 0);
  assert.ok(result.skippedMissingSpu >= 1);
  assert.ok(result.skippedConflictedProducts >= 1);
});
