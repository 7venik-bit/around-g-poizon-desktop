import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const bootstrap = fs.readFileSync(new URL("../bootstrap.mjs", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const verdict = fs.readFileSync(new URL("../src/domestic-result-verdict.js", import.meta.url), "utf8");
const inlineRenderer = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");
const inlineCss = fs.readFileSync(new URL("../src/domestic-inline-results.css", import.meta.url), "utf8");

test("runtime always loads the below-row retailer list directly", () => {
  assert.match(index, /domestic-result-verdict\.js[\s\S]*renderer\.js/);
  assert.match(bootstrap, /domesticResultVerdictSource/);
  assert.match(bootstrap, /src\/domestic-result-verdict\.js/);
  assert.match(bootstrap, /executeJavaScript\(domesticResultVerdictSource, true\)/);
  assert.match(bootstrap, /domesticInlineResultsSource/);
  assert.match(bootstrap, /src\/domestic-inline-results\.js/);
  assert.match(bootstrap, /executeJavaScript\(domesticInlineResultsSource, true\)/);
  assert.match(bootstrap, /src\/domestic-inline-results\.css/);
  assert.match(bootstrap, /insertCSS\([^)]*domesticInlineResultsCss/s);
  assert.match(inlineRenderer, /국내 검색 결과/);
  assert.match(inlineRenderer, /domestic-inline-detail-label/);
  assert.match(inlineRenderer, /td colspan="10"/);
  assert.match(inlineRenderer, /domestic-inline-row/);
  assert.match(inlineRenderer, /AroundGDomesticVerdict\.sourceVerdict/);
  assert.match(verdict, /Product evidence is the strongest signal/);
});

test("retailer list columns are loaded through CSP-safe CSS", () => {
  assert.match(inlineCss, /\.domestic-inline-head,\.domestic-inline-row\{display:grid!important/);
  assert.match(inlineCss, /grid-template-columns:120px minmax\(160px,1fr\) minmax\(200px,1\.4fr\) 110px 100px 180px!important/);
  assert.match(inlineCss, /\.domestic-inline-retailer-group\{display:grid!important;grid-template-columns:120px minmax\(0,1fr\)!important/);
  assert.match(inlineCss, /\.domestic-inline-retailer-rows>\.domestic-inline-row\{grid-template-columns:minmax\(160px,1fr\) minmax\(200px,1\.4fr\) 110px 100px 180px!important/);
  assert.match(inlineCss, /\.excel-product-search-detail\{display:table-row!important/);
});

test("direct and postinstall list loaders cannot install twice", () => {
  assert.match(inlineRenderer, /globalThis\.__aroundGDomesticInlineResultsInstalled/);
  assert.match(inlineRenderer, /if \(globalThis\.__aroundGDomesticInlineResultsInstalled\) return/);
});

test("postinstall no longer mutates the list renderer source", () => {
  const packageJson = fs.readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(packageJson, /patch-domestic-inline-results/);
  assert.doesNotMatch(packageJson, /verify-domestic-inline-results/);
});
