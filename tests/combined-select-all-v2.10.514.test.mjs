import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("combined products receive one stable key used by rows, cache, and selection", () => {
  assert.match(renderer, /function excelPreviewStableSelectionKey/);
  assert.match(renderer, /sourceProduct\._excelSelectionKey =/);
  assert.match(renderer, /products\.map\(\(product\) => excelPreviewStableSelectionKey\(product, file\)\)/);
  assert.match(renderer, /excelPreviewProductCache\.set\(excelPreviewStableSelectionKey\(product\), product\)/);
});

test("filter-result select-all selects every combined product and refreshes visible checks", () => {
  assert.match(renderer, /combinedKeys = preview\.combinedProducts\.map/);
  assert.match(renderer, /selectedExcelPreviewProducts\.add\(combinedKeys\[index\]\)/);
  assert.match(renderer, /updateExcelPreviewSelectionUi\(excelPreviewPageKeys\)/);
  assert.match(renderer, /통합 필터 결과.*전체 선택했습니다/);
});

test("search UI uses the same stable keys after page changes", () => {
  assert.match(renderer, /excelPreviewPageProducts\.map\(\(item\) => excelPreviewStableSelectionKey\(item, file\)\)/);
  assert.match(renderer, /for \(const key of excelPreviewPageKeys\)/);
});
