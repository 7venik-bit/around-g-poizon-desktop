import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const bootstrap = fs.readFileSync(new URL("../bootstrap.mjs", import.meta.url), "utf8");
const inlineRenderer = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

test("runtime always loads the right-column retailer list directly", () => {
  assert.match(bootstrap, /domesticInlineResultsSource/);
  assert.match(bootstrap, /src\/domestic-inline-results\.js/);
  assert.match(bootstrap, /executeJavaScript\(domesticInlineResultsSource, true\)/);
  assert.match(inlineRenderer, /국내 상품 검색 결과/);
  assert.match(inlineRenderer, /sourcing-domestic-cell/);
  assert.match(inlineRenderer, /domestic-inline-row/);
});

test("direct and postinstall list loaders cannot install twice", () => {
  assert.match(inlineRenderer, /globalThis\.__aroundGDomesticInlineResultsInstalled/);
  assert.match(inlineRenderer, /if \(globalThis\.__aroundGDomesticInlineResultsInstalled\) return/);
});
