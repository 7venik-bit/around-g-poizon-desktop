import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const inlineRenderer = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

test("the retailer list uses a full-width row below the source product", () => {
  assert.match(inlineRenderer, /excel-product-search-detail\{display:table-row!important/);
  assert.match(inlineRenderer, /<td colspan="10"><div class="domestic-inline-detail-label">/);
  assert.match(inlineRenderer, /height:54px!important;vertical-align:middle!important/);
  assert.doesNotMatch(inlineRenderer, /min-width:1420px!important/);
  assert.doesNotMatch(inlineRenderer, /min-width:430px!important/);
});

test("retailer results use labeled columns aligned like source data", () => {
  assert.match(inlineRenderer, /domestic-inline-head/);
  assert.match(inlineRenderer, /<span>판매처<\/span><span>상품명<\/span><span>품번<\/span><span>가격<\/span><span>링크<\/span>/);
  assert.match(inlineRenderer, /grid-template-columns:110px minmax\(240px,1fr\) 120px 90px 70px!important/);
});
