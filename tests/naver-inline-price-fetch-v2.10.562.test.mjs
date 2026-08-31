import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

test("expanded Naver result offers an isolated price fetch action", () => {
  assert.match(inline, /store === "네이버 패션타운" && contextKey/);
  assert.match(inline, /data-inline-naver-price=/);
  assert.match(inline, />가격 가져오기<\/button>/);
  assert.match(inline, /window\.aroundG\.lookupDomesticPrice\(\{/);
});

test("Naver price candidates update only the selected Excel product", () => {
  assert.match(inline, /excelPreviewProductCache\.get\(key\)/);
  assert.match(inline, /excelPreviewSearchResults\.set\(key,/);
  assert.match(inline, /domesticPriceCandidates:/);
  assert.match(inline, /renderExcelProductRows\(activeExcelPreview\.file, excelPreviewPageProducts\)/);
});

test("price lookup failure stays local and keeps the result link usable", () => {
  assert.match(inline, /if \(!response\?\.ok \|\| !Array\.isArray\(response\.candidates\)/);
  assert.match(inline, /button\.textContent = "다시 가져오기"/);
  assert.doesNotMatch(inline, /cancelDomesticSearch/);
});
