import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { applyPoizonScreenSalesToWorkbook } from '../services/poizon-screen-excel-sync.mjs';

function workbook() {
  const shared = '<sst><si><t>SPU ID</t></si><si><t>상품 번호</t></si><si><t>중국 총 판매량</t></si><si><t>현지 판매자 총 판매량</t></si><si><t>19438508</t></si><si><t>JWVAX25017</t></si><si><t>다른상품</t></si></sst>';
  const sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" s="2"><v>13</v></c><c r="D2" s="2"><v>10</v></c></row><row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>6</v></c><c r="C3"><v>7</v></c><c r="D3"><v>5</v></c></row></sheetData></worksheet>';
  return Buffer.from(zipSync({ 'xl/sharedStrings.xml': strToU8(shared), 'xl/worksheets/sheet1.xml': strToU8(sheet) }));
}

test('동일 SPU는 상품번호 번역이 달라도 연결하되 원본 총판매량은 보존한다', () => {
  const result = applyPoizonScreenSalesToWorkbook(workbook(), [{
    spuId: '19438508', articleNumber: 'JWVAX25017', sales30dRaw: '100+', hasSalesData: true,
    localSales30dRaw: '83', hasLocalSalesData: true,
  }]);
  assert.equal(result.ok, true); assert.equal(result.changedRows, 2); assert.equal(result.changedCells, 4);
  const xml = strFromU8(unzipSync(new Uint8Array(result.buffer))['xl/worksheets/sheet1.xml']);
  for (const cell of ['<c r="C2" s="2"><v>13</v></c>', '<c r="D2" s="2"><v>10</v></c>', '<c r="C3"><v>7</v></c>', '<c r="D3"><v>5</v></c>']) assert.ok(xml.includes(cell));
  assert.match(xml, /POIZON 상품 최근 30일 판매량/);
  assert.match(xml, /<c r="E2" t="inlineStr"><is><t>100\+<\/t>/);
  assert.match(xml, /<c r="F2" t="inlineStr"><is><t>83<\/t>/);
});
test('화면에서 검증되지 않은 값은 원본 Excel을 변경하지 않는다', () => {
  const result = applyPoizonScreenSalesToWorkbook(workbook(), [{ articleNumber: 'JWVAX25017', hasSalesData: false, hasLocalSalesData: false }]);
  assert.equal(result.ok, true); assert.equal(result.changed, false);
});
