import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

test("downloaded Excel opens with untouched raw rows by default", () => {
  const start = renderer.indexOf("async function openIntegratedBrandExcel");
  const end = renderer.indexOf('$("#brand-export-completed-list")', start);
  const source = renderer.slice(start, end);
  assert.match(source, /원본 Excel 전체 보기/);
  assert.match(source, /excelPreviewProductMode = false/);
  assert.match(source, /productView: false/);
  assert.doesNotMatch(source, /productView: Boolean\(productSearch\)/);
  assert.doesNotMatch(source, /excelPreviewProductMode = Boolean\(productSearch\)/);
});

test("product grouping remains an explicit user action", () => {
  assert.match(renderer, /excel-view-products"[\s\S]*excelPreviewProductMode = true/);
  assert.match(renderer, /excel-view-raw"[\s\S]*excelPreviewProductMode = false/);
});
