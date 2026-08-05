import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { readPoizonColumnValues, summarizePoizonRows } from "../services/poizon-xlsx.mjs";

test("reads only the POIZON brand column from inline-string workbooks", () => {
  const sheet = `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>상품 번호</t></is></c><c r="B1" t="inlineStr"><is><t>상품 브랜드</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>100</t></is></c><c r="B2" t="inlineStr"><is><t>크록스</t></is></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>101</t></is></c><c r="B3" t="inlineStr"><is><t>조던</t></is></c></row>
    </sheetData></worksheet>`;
  const workbook = zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet) });
  const result = readPoizonColumnValues(workbook, "상품 브랜드", "브랜드");

  assert.equal(result.column, 1);
  assert.equal(result.header, "상품 브랜드");
  assert.deepEqual(result.values, ["크록스", "조던"]);
});

test("summarizes Excel data rows separately from unique, duplicate, and blank SPUs", () => {
  const summary = summarizePoizonRows([
    ["SPU ID", "상품명"],
    ["SPU-1", "첫 번째 옵션"],
    ["SPU-1", "두 번째 옵션"],
    ["SPU-2", "다른 상품"],
    ["", "SPU가 비어 있는 상품"],
    ["", ""],
  ]);

  assert.deepEqual(summary, {
    dataRowCount: 4,
    uniqueSpuCount: 2,
    duplicateSpuCount: 1,
    blankSpuCount: 1,
  });
});
