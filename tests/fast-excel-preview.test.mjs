import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { readPoizonWorksheetRowsFast } from "../services/poizon-xlsx.mjs";

function workbookBuffer() {
  const shared = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">
  <si><t>상품 번호</t></si><si><t>상품명</t></si><si><t>브랜드</t></si>
  <si><t>D6291TPS58</t></si><si><t>데상트 트레이닝 남성 카라 셔츠</t></si><si><t>DESCENTE</t></si>
</sst>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1"/>
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c><c r="D2"><v>93000</v></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>D6291TPS59</t></is></c><c r="B4" t="inlineStr"><is><t>두번째 상품</t></is></c></row>
  </sheetData>
</worksheet>`;
  return Buffer.from(zipSync({
    "xl/sharedStrings.xml": strToU8(shared),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  }));
}

test("fast worksheet reader ignores broken A1 dimension and preserves sparse rows", () => {
  const rows = readPoizonWorksheetRowsFast(workbookBuffer());
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0].slice(0, 3), ["상품 번호", "상품명", "브랜드"]);
  assert.deepEqual(rows[1].slice(0, 4), ["D6291TPS58", "데상트 트레이닝 남성 카라 셔츠", "DESCENTE", "93000"]);
  assert.deepEqual(rows[2], []);
  assert.deepEqual(rows[3].slice(0, 2), ["D6291TPS59", "두번째 상품"]);
});
