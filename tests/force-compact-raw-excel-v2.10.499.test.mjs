import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("v2.10.499 resets the stale all-columns preference once", () => {
  assert.match(renderer, /EXCEL_COMPACT_MIGRATION_KEY = "around-g-excel-compact-default-v2\.10\.499"/);
  assert.match(renderer, /localStorage\.setItem\(EXCEL_COLUMN_MODE_KEY, "compact"\)/);
  assert.match(renderer, /localStorage\.setItem\(EXCEL_COMPACT_MIGRATION_KEY, "done"\)/);
});

test("raw Excel renderer directly hides non-sourcing columns", () => {
  assert.match(renderer, /function rawExcelSourcingColumnVisible/);
  assert.match(renderer, /const compactColumns = localStorage\.getItem\(EXCEL_COLUMN_MODE_KEY\) !== "all"/);
  assert.match(renderer, /excel-column-hidden/);
  assert.match(renderer, /renderRawExcelCell\(cell, headers\[columnIndex\], columnIndex, compactColumns, keepBrandColumn\)/);
  assert.match(css, /\.excel-preview-grid \.excel-column-hidden\{display:none!important\}/);
});

test("popular list alone keeps the brand column", () => {
  assert.match(renderer, /excelPreviewIntegratedWorkspaceId === "popular-product-workspace"/);
  assert.match(renderer, /keepBrand && \/\^\(\?:상품브랜드\|브랜드\)\$\/i/);
});
