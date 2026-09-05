import test from "node:test";
import assert from "node:assert/strict";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { applyPoizonScreenSalesToWorkbook } from "../services/poizon-screen-excel-sync.mjs";

function workbook() {
  const shared = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="7" uniqueCount="7"><si><t>SPU ID</t></si><si><t>상품 번호</t></si><si><t>중국 총 판매량</t></si><si><t>현지 판매자 총 판매량</t></si><si><t>19438508</t></si><si><t>JWVAX25017</t></si><si><t>다른상품</t></si></sst>`;
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" s="2"><v>13</v></c><c r="D2" s="2"><v>10</v></c></row><row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>6</v></c><c r="C3"><v>7</v></c><c r="D3"><v>5</v></c></row></sheetData></worksheet>`;
  return Buffer.from(zipSync({ "xl/sharedStrings.xml": strToU8(shared), "xl/worksheets/sheet1.xml": strToU8(sheet) }));
}

test("POIZON 화면 값은 매칭된 Excel 행의 판매량 셀만 수정한다", () => {
  const result = applyPoizonScreenSalesToWorkbook(workbook(), [{
    spuId: "19438508", articleNumber: "JWVAX25017", sales30d: 100, sales30dRaw: "100+", hasSalesData: true,
    localSales30d: 83, localSales30dRaw: "83", hasLocalSalesData: true,
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.changedRows, 1);
  assert.equal(result.changedCells, 2);
  const xml = strFromU8(unzipSync(new Uint8Array(result.buffer))["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /<c r="C2" s="2" t="inlineStr"><is><t>100\+<\/t><\/is><\/c>/);
  assert.match(xml, /<c r="D2" s="2"><v>83<\/v><\/c>/);
  assert.match(xml, /<c r="C3"><v>7<\/v><\/c>/);
});

test("화면에서 검증되지 않은 값은 원본 Excel을 변경하지 않는다", () => {
  const result = applyPoizonScreenSalesToWorkbook(workbook(), [{
    articleNumber: "JWVAX25017", sales30d: 0, sales30dRaw: "--", hasSalesData: false,
    localSales30d: 0, localSales30dRaw: "--", hasLocalSalesData: false,
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
});
