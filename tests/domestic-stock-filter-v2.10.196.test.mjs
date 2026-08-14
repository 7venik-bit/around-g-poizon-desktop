import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, renderer, style] = await Promise.all([
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
]);

test("category results expose a domestic-stock-only toggle", () => {
  assert.match(html, /id="domestic-stock-filter"[^>]*>국내 재고만 보기<\/button>/);
  assert.match(renderer, /function hasDomesticStock\(result\)/);
  assert.match(renderer, /some\(\(product\) => product\?\.inStock\)/);
  assert.match(renderer, /domesticStockOnly = !domesticStockOnly/);
  assert.match(renderer, /전체 상품 보기 · 국내 재고/);
  assert.match(style, /#domestic-stock-filter\.active/);
});

test("stock filtering preserves the full result set while batch search continues", () => {
  assert.match(renderer, /allExplorerProducts = \[\.\.\.products\]/);
  assert.match(renderer, /const batchProducts = \[\.\.\.\(allExplorerProducts\.length/);
  assert.match(renderer, /searchDomesticAt\(index, batchProducts\)/);
  assert.match(renderer, /국내 재고.*개 표시 \/ 전체/);
});
