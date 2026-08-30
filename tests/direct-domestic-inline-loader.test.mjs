import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const bootstrap = fs.readFileSync(new URL("../bootstrap.mjs", import.meta.url), "utf8");
const inlineRenderer = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");
const inlineCss = fs.readFileSync(new URL("../src/domestic-inline-results.css", import.meta.url), "utf8");

test("runtime always loads the below-row retailer list directly", () => {
  assert.match(bootstrap, /domesticInlineResultsSource/);
  assert.match(bootstrap, /src\/domestic-inline-results\.js/);
  assert.match(bootstrap, /executeJavaScript\(domesticInlineResultsSource, true\)/);
  assert.match(bootstrap, /src\/domestic-inline-results\.css/);
  assert.match(bootstrap, /insertCSS\([^)]*domesticInlineResultsCss/s);
  assert.match(inlineRenderer, /국내 검색 결과/);
  assert.match(inlineRenderer, /domestic-inline-detail-label/);
  assert.match(inlineRenderer, /td colspan="10"/);
  assert.match(inlineRenderer, /domestic-inline-row/);
});

test("retailer list columns are loaded through CSP-safe CSS", () => {
  assert.match(inlineCss, /\.domestic-inline-head,\.domestic-inline-row\{display:grid!important/);
  assert.match(inlineCss, /grid-template-columns:110px minmax\(240px,1fr\) 120px 90px 70px!important/);
  assert.match(inlineCss, /\.excel-product-search-detail\{display:table-row!important/);
});

test("direct and postinstall list loaders cannot install twice", () => {
  assert.match(inlineRenderer, /globalThis\.__aroundGDomesticInlineResultsInstalled/);
  assert.match(inlineRenderer, /if \(globalThis\.__aroundGDomesticInlineResultsInstalled\) return/);
});
