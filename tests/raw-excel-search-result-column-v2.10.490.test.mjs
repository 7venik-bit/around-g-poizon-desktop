import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("raw Excel keeps search status and retailer links in the final cell", () => {
  assert.match(renderer, /상품 검색 결과 · 링크/);
  assert.match(renderer, /renderRawExcelDomesticCell\(key, product, searchResult\)/);
  assert.match(renderer, /rawExcelDomesticResultLinks/);
  assert.match(renderer, /네이버 전체 결과/);
  assert.match(renderer, /naverOverviewAdded/);
  const rawCell = renderer.slice(
    renderer.indexOf("function renderRawExcelDomesticCell"),
    renderer.indexOf("function excelPreviewProductKey"),
  );
  assert.doesNotMatch(rawCell, /추가 확인 필요/);
  assert.match(rawCell, /상품 있음 ·/);
  assert.match(rawCell, /label: "상품 없음"/);
  assert.match(renderer, /label: "검색 실패", className: "error"/);
  assert.doesNotMatch(renderer, /buttonText[\s\S]{0,800}excel-product-search-detail/);
  assert.match(style, /\.excel-raw-search-cell/);
  assert.match(style, /\.excel-raw-search-links/);
});
