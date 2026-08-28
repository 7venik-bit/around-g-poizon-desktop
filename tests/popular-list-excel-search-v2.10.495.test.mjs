import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");

test("popular capture opens the same raw Excel list and domestic-search controls", () => {
  assert.match(html, /id="popular-product-workspace"/);
  assert.match(html, /id="popular-integrated-preview-host"/);
  assert.match(renderer, /async function openIntegratedPopularExcel/);
  assert.match(renderer, /integratedHostId: "popular-integrated-preview-host"/);
  assert.match(renderer, /await openIntegratedPopularExcel\(popularFile\)/);
  assert.match(renderer, /renderRawExcelDomesticCell\(key, product, searchResult\)/);
  assert.match(renderer, /상품 검색 결과 · 링크/);
  assert.doesNotMatch(renderer, /acceptSellerCenterProducts\(verifiedProducts[\s\S]{0,500}runDomesticBatch\(\)/);
});

test("popular Excel columns map into searchable preview products", () => {
  assert.match(main, /articleNumber: column\("상품 번호", "상품번호", "상품코드", "품번"\)/);
  assert.match(main, /image: column\("SPU 이미지", "상품 이미지", "이미지", "이미지 URL"\)/);
  assert.match(main, /"최근 30일 평균 거래가", "평균 거래가"/);
  assert.match(renderer, /상품\\s\*코드/);
  assert.match(renderer, /이미지\(\?:\\s\*URL\)\?/);
});
