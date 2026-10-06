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
  assert.match(originalRows, /products\.flatMap\(\(p, i\) => \{/);
  assert.match(originalRows, /if \(!shownKeySet\.has\(keys\[i\]\)\) return \[\];/);
});

test("page selection follows the displayed representative rows", () => {
  assert.match(originalRows, /return shownKeys;/);
  assert.doesNotMatch(originalRows, /return keys;/);
});
