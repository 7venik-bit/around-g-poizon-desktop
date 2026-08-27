import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("POIZON Excel registration does not prefilter sales", async () => {
  const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
  const start = main.indexOf('  ipcMain.handle("excel:import-brand-source"');
  const end = main.indexOf('  ipcMain.handle("excel:export"', start);
  assert.ok(start >= 0 && end > start, "POIZON Excel import handler must exist");
  const handler = main.slice(start, end);

  assert.match(handler, /const sheet = sourceSheet;/);
  assert.doesNotMatch(handler, /filterPoizonRowsByTotalSales\(sourceSheet/);
  assert.doesNotMatch(handler, /filtered\./);
  assert.match(handler, /sourceRows: sourceRowCount/);
  assert.match(handler, /filteredRows: sourceRowCount/);
  assert.match(handler, /minimumSales: null/);
  assert.match(handler, /filterApplied: false/);
  assert.match(handler, /const processedPath = filePath;/);
});
