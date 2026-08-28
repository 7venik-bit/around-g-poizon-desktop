import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("raw Excel pending search uses a medium centered button", () => {
  assert.match(renderer, /excel-raw-search-cell excel-raw-search-pending/);
  assert.match(renderer, />검색<\/button>/);
  assert.doesNotMatch(renderer, /excel-raw-search-pending[^\n]+>상품검색<\/button>/);
  assert.match(css, /\.excel-raw-search-pending>\.excel-product-search\{display:inline-flex;width:auto;min-width:46px;max-width:64px/);
});
