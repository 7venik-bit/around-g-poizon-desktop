import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("selected brand downloads are merged with the fixed AND filter", () => {
  assert.match(renderer, /async function openCombinedSelectedBrandPreview/);
  assert.match(renderer, /minimumTotal: "100"/);
  assert.match(renderer, /minimumLocalTotal: "25"/);
  assert.match(renderer, /fixedTotalAnd: true/);
  assert.match(renderer, /productView: true/);
  assert.match(renderer, /products\.push\(\.\.\.mergeDomesticSearchProducts/);
  assert.doesNotMatch(renderer, /async function openCombinedSelectedBrandPreview[\s\S]{0,100}return openReviewLocalBrandPreview/);
});

test("domestic search applies 100/25 AND and groups option rows by product", () => {
  assert.match(renderer, /openCombinedSelectedBrandPreview\(files, \{ minimumTotal: "100", minimumLocalTotal: "25" \}\)/);
  assert.match(renderer, /function mergeDomesticSearchProducts/);
  assert.match(renderer, /spuId \? `SPU:\$\{spuId\}` : articleNumber \? `ARTICLE:\$\{articleNumber\}`/);
  assert.match(renderer, /current\.optionCount \+= 1/);
});

test("combined product list pages by 100 while selecting all filtered products", () => {
  assert.match(renderer, /function renderCombinedBrandPreviewPage/);
  assert.match(renderer, /const limit = 100/);
  assert.match(renderer, /combinedProducts: combinedBrandPreview\.products/);
  assert.match(renderer, /필터 결과 전체 선택/);
  assert.match(renderer, /preview\.combinedProducts\.map\(\(product\) => excelPreviewStableSelectionKey/);
});

test("combined rows preserve each source workbook and brand identity", () => {
  assert.match(renderer, /function excelPreviewProductSourcePath/);
  assert.match(renderer, /brandImportPathKey\(excelPreviewProductSourcePath\(product, file\)\)/);
  assert.match(renderer, /selectedDownloads\.length \? selectedDownloads : fallbackDownloads/);
});
