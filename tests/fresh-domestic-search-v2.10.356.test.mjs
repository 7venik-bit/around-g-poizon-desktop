import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("opening an Excel workbook never restores old inventory results", () => {
  assert.match(renderer, /around-g-excel-search-results-v2/);
  assert.match(renderer, /Never[\s\S]*restore an earlier run when a workbook is opened again/);
  assert.doesNotMatch(renderer, /excelPreviewSearchResults\.set\(key, value\)/);
});

test("manual and selected Excel searches clear visible and identity caches first", () => {
  assert.match(renderer, /clearDomesticIdentityCache\(product\);\s*excelPreviewSearchResults\.delete\(key\);/s);
  assert.match(renderer, /A new button press always starts a new search session[\s\S]*excelPreviewSearchResults\.clear\(\);\s*domesticIdentitySearchCache\.clear\(\);/);
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
