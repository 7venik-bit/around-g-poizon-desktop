import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("opening an Excel workbook restores only current-session results", () => {
  assert.match(renderer, /around-g-excel-search-results-v2/);
  assert.match(renderer, /const excelPreviewSearchResultsByPath = new Map\(\)/);
  assert.match(renderer, /if \(saved\)[\s\S]*excelPreviewSearchResults\.set\(key, value\)/);
  assert.match(renderer, /localStorage\.removeItem\(EXCEL_SEARCH_RESULTS_KEY\)/);
});

test("manual search refreshes one result and selected search preserves unselected results", () => {
  assert.match(renderer, /clearDomesticIdentityCache\(product\);\s*excelPreviewSearchResults\.delete\(key\);/s);
  assert.match(renderer, /for \(const key of keys\) excelPreviewSearchResults\.delete\(key\);\s*domesticIdentitySearchCache\.clear\(\);/);
  assert.doesNotMatch(renderer, /Completed results for[\s\S]*excelPreviewSearchResults\.clear\(\)/);
});

test("combined brand workspace restores completed results from the current app session", () => {
  assert.match(renderer, /restoreSavedExcelSearchResults\("combined:\/\/selected-brands"\)/);
});

test("every domestic request clears HTTP cache without deleting login cookies", () => {
  assert.match(main, /ipcMain\.handle\("domestic:search"[\s\S]*session\.fromPartition\(DOMESTIC_SEARCH_PARTITION\)\.clearCache\(\)/);
  assert.doesNotMatch(main.match(/ipcMain\.handle\("domestic:search"[\s\S]*?const settings/)[0], /clearStorageData|cookies\.remove/);
});

test("a completed domestic batch deletes persisted results before a fresh run", () => {
  assert.match(renderer, /DOMESTIC_RESULT_POLICY_VERSION = 6/);
  assert.match(renderer, /clearSavedDomesticStockResults\(batchId\)/);
  assert.match(renderer, /window\.aroundG\.remove\("domesticSearches", saved\.id\)/);
  assert.match(renderer, /if \(!selectedOnly && savedProgress\)[\s\S]*restoreDomesticStockResults[\s\S]*else[\s\S]*domesticResults\.clear\(\)/);
});
