import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("combined cache is populated after the single-file viewer initialization", () => {
  const open = renderer.indexOf("await openIntegratedBrandExcel(files[0], false)");
  const clear = renderer.indexOf("excelPreviewProductCache.clear()", open);
  const populate = renderer.indexOf("excelPreviewProductCache.set(key, product)", clear);
  assert.ok(open >= 0 && clear > open && populate > clear);
});

test("combined current-page selection uses the rendered page keys", () => {
  assert.match(renderer, /selectPage\.onchange = \(event\) => \{/);
  assert.match(renderer, /for \(const key of excelPreviewPageKeys\)/);
  assert.match(renderer, /updateExcelPreviewSelectionUi\(excelPreviewPageKeys\)/);
});

test("search reports selected versus available cache counts", () => {
  assert.match(renderer, /unavailableCount = Math\.max/);
  assert.match(renderer, /검색 데이터/);
});
