import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("sales filter sits right below the detail menu, above brand selection", () => {
  const detail = html.indexOf('id="category-detail-section"');
  const sales = html.indexOf('class="category-sales-filter"');
  const brands = html.indexOf('id="category-brand-section"');
  assert.ok(detail >= 0 && sales > detail, "sales filter follows the detail menu");
  assert.ok(brands > sales, "brand selection comes last");
  assert.match(html, /id="category-min-china-sales-30"/);
  assert.match(html, /id="category-min-local-sales-30"/);
  assert.match(html, /id="category-sales-filter-reset"/);
});

test("category boxes use compact metrics", () => {
  assert.match(css, /\.category-detail-section\{padding:10px 12px;margin:0 0 12px\}/);
  assert.match(css, /\.category-brand-section\{margin:0 0 12px;padding:10px 12px\}/);
  assert.match(css, /\.category-brand-cards\{gap:7px;max-height:220px\}/);
  assert.match(css, /\.category-brand-card\{grid-template-columns:30px minmax\(0,1fr\) auto;gap:7px;padding:7px 9px\}/);
  assert.match(css, /\.category-brand-card>i\{width:28px;height:28px/);
  assert.match(css, /\.category-sales-filter\{padding:10px 12px;margin:0 0 12px\}/);
  assert.match(css, /\.category-sales-filter-heading strong\{font-size:14px\}/);
});
