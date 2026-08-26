import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("startup removes every persisted Excel domestic-search verdict", () => {
  const keyDeclaration = renderer.indexOf('const EXCEL_SEARCH_RESULTS_KEY = "around-g-excel-search-results-v2"');
  const cacheDeclaration = renderer.indexOf("const excelPreviewProductCache", keyDeclaration);
  const startupSection = renderer.slice(keyDeclaration, cacheDeclaration);
  assert.match(startupSection, /localStorage\.removeItem\(EXCEL_SEARCH_RESULTS_KEY\)/);
});

test("Excel domestic-search results stay in memory and are not persisted", () => {
  const persistStart = renderer.indexOf("function persistExcelSearchResults");
  const persistEnd = renderer.indexOf("async function searchExcelPreviewProduct", persistStart);
  const persistFunction = renderer.slice(persistStart, persistEnd);
  assert.match(persistFunction, /localStorage\.removeItem\(EXCEL_SEARCH_RESULTS_KEY\)/);
  assert.doesNotMatch(persistFunction, /localStorage\.setItem/);
});

test("opening an Excel file clears visible results and legacy storage", () => {
  const restoreStart = renderer.indexOf("function restoreSavedExcelSearchResults");
  const restoreEnd = renderer.indexOf("function persistExcelSearchResults", restoreStart);
  const restoreFunction = renderer.slice(restoreStart, restoreEnd);
  assert.match(restoreFunction, /excelPreviewSearchResults\.clear\(\)/);
  assert.match(restoreFunction, /localStorage\.removeItem\(EXCEL_SEARCH_RESULTS_KEY\)/);
  assert.doesNotMatch(restoreFunction, /excelPreviewSearchResults\.set/);
});
