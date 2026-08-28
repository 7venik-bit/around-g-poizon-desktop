import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("raw search result column is balanced with the compact table", () => {
  assert.match(css, /\.excel-raw-search-heading,\.excel-preview-grid \.excel-raw-search-cell\{min-width:170px;width:170px;max-width:170px\}/);
  assert.match(css, /\.excel-raw-search-pending\{height:54px;min-height:54px;text-align:center\}/);
  assert.match(css, /\.excel-raw-search-pending>\.excel-product-search\{display:inline-flex;width:88px/);
});
