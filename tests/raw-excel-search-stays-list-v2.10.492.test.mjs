import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

test("selected search stays in the original Excel row list", () => {
  const start = renderer.indexOf('$("#excel-preview-search-selected")?.addEventListener');
  const end = renderer.indexOf('$("#excel-preview-prev")?.addEventListener', start);
  assert.ok(start >= 0 && end > start);
  const handler = renderer.slice(start, end);
  assert.doesNotMatch(handler, /excelPreviewProductMode\s*=\s*true/);
  assert.doesNotMatch(handler, /productView:\s*true/);
  assert.match(renderer, /renderRawExcelDomesticCell\(key, product, searchResult\)/);
  assert.match(renderer, /상품 검색 결과 · 링크/);
});
