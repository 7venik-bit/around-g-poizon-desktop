import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("selected brand downloads are merged with the fixed AND filter", () => {
  assert.match(renderer, /async function openCombinedSelectedBrandPreview/);
  assert.match(renderer, /minimumTotal: "100"/);
  assert.match(renderer, /minimumLocalTotal: "30"/);
  assert.match(renderer, /fixedTotalAnd: true/);
  assert.match(renderer, /productView: true/);
  assert.match(renderer, /products\.push\(\{ \.\.\.product, _sourceFilePath: file\.path/);
});

test("combined product list pages by 100 while selecting all filtered products", () => {
  assert.match(renderer, /function renderCombinedBrandPreviewPage/);
  assert.match(renderer, /const limit = 100/);
  assert.match(renderer, /combinedProducts: combinedBrandPreview\.products/);
  assert.match(renderer, /필터 결과 전체 선택/);
  assert.match(renderer, /for \(const product of preview\.combinedProducts\)/);
});

test("combined rows preserve each source workbook and brand identity", () => {
  assert.match(renderer, /function excelPreviewProductSourcePath/);
  assert.match(renderer, /brandImportPathKey\(excelPreviewProductSourcePath\(product, file\)\)/);
  assert.match(renderer, /selectedDownloads\.length \? selectedDownloads : fallbackDownloads/);
});
