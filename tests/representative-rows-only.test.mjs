import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

const start = renderer.indexOf("function renderOriginalExcelRows(file, products = []) {");
const end = renderer.indexOf("function renderOriginalSkuSales(", start);
const originalRows = renderer.slice(start, end);

test("original rows show only the highest-price row per article number", () => {
  assert.match(originalRows, /representativeKeys/);
  assert.match(
    originalRows,
    /const representative = keys\.filter\(\(key\) => repPlan\.representativeKeys\.includes\(key\)\);/,
  );
  assert.match(originalRows, /if \(representative\.length\) shownKeys = representative;/);
});

test("hidden size rows leave the list but stay in the workbook", () => {
  assert.match(originalRows, /displayOrder\.flatMap\(\(i\) => \{/);
  assert.match(originalRows, /const p = products\[i\];/);
  assert.match(originalRows, /return shownKeys;/);
  assert.doesNotMatch(originalRows, /return keys;/);
});

test("original rows display in product-name order", () => {
  assert.match(originalRows, /originalRowDisplayName/);
  assert.match(originalRows, /localeCompare\(originalRowDisplayName\(products\[right\]\), "ko"\)/);
});

test("original rows show the POIZON highest figure", () => {
  assert.match(originalRows, /poizonHighestPrice/);
  assert.match(originalRows, /money\(highest\)/);
});
