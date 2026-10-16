import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function explorerCardBlock() {
  const start = renderer.indexOf("function renderExplorerResults(");
  assert.notEqual(start, -1);
  const end = renderer.indexOf("function totalSalesAndMatched(", start);
  assert.notEqual(end, -1);
  return renderer.slice(start, end);
}

test("explorer card stacks the POIZON button above the domestic search button", () => {
  const card = explorerCardBlock();
  assert.match(card, /<span class="inventory-actions">\$\{globalThis\.AroundGPoizonProductView\?\.button\(product\) \|\| ""\}<button data-domestic/);
  assert.doesNotMatch(card, /explorer-product-meta">\$\{globalThis\.AroundGPoizonProductView/);
});

test("the stacked card actions use a vertical layout", () => {
  assert.match(css, /\.inventory-actions\{display:flex;flex-direction:column/);
});
