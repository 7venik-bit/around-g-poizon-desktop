import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [renderer, css] = await Promise.all([
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
]);

test("compact Excel columns receive semantic width roles", () => {
  assert.match(renderer, /function rawExcelColumnRole/);
  assert.match(renderer, /excel-column-\$\{rawExcelColumnRole\(header\)\}/);
  assert.match(renderer, /compact-raw-columns/);
});

test("visible sourcing columns use balanced fixed layout", () => {
  assert.match(css, /compact-raw-columns \.excel-preview-grid table\{width:100%;min-width:980px;table-layout:fixed\}/);
  assert.match(css, /\.excel-column-name\{min-width:125px!important;width:16%/);
  assert.match(css, /\.excel-column-price\{min-width:82px!important;width:9%/);
  assert.match(css, /\.excel-column-sales\{min-width:66px!important;width:7%/);
  assert.match(css, /\.excel-raw-search-heading,[^\n]+width:19%/);
});
