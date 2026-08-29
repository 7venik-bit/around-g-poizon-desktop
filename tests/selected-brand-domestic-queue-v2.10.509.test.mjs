import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("domestic search queues every selected brand download", () => {
  assert.match(renderer, /const queue = selectedDownloads\.length \? selectedDownloads/);
  assert.match(renderer, /for \(let index = 0; index < queue\.length/);
  assert.match(renderer, /await openIntegratedBrandExcel\(file, true\)/);
  assert.match(renderer, /excel-preview-select-all-results/);
  assert.match(renderer, /선택 브랜드 국내검색/);
});

test("live row results remain separated by workbook while brand queue advances", () => {
  assert.match(renderer, /excelPreviewSearchResultsByPath = new Map/);
  assert.match(renderer, /excelPreviewSearchResultsByPath\.set\(pathKey, new Map\(excelPreviewSearchResults\)\)/);
  assert.match(renderer, /excelPreviewSearchResultsByPath\.get\(brandImportPathKey\(filePath\)\)/);
});

test("stopping a product batch also stops the remaining brand queue", () => {
  assert.match(renderer, /selectedBrandDomesticQueueRunning = false;\s*excelPreviewBatchSearching = false/);
});
