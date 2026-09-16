import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");

test("popular capture saves Excel and opens search results in the brand-style product view", () => {
  assert.match(html, /id="popular-product-workspace"/);
  assert.match(html, /id="popular-integrated-preview-host"/);
  assert.match(html, /id="popular-product-search"[^>]*hidden[^>]*>상품검색/);
  assert.match(renderer, /async function openIntegratedPopularExcel/);
  assert.match(renderer, /integratedHostId: "popular-integrated-preview-host"/);
  assert.doesNotMatch(renderer, /await openIntegratedPopularExcel\(popularFile\)/);
  assert.match(renderer, /await openIntegratedPopularExcel\(latestPopularExcelFile\)/);
  assert.match(renderer, /searchButton\.hidden = !completedProducts\.length/);
  assert.match(renderer, /인기리스트 Excel 저장이 완료되었습니다/);
  const popularStart = renderer.indexOf("async function openIntegratedPopularExcel");
  const popularEnd = renderer.indexOf('$("#brand-export-completed-list")', popularStart);
  const popular = renderer.slice(popularStart, popularEnd);
  assert.match(popular, /POIZON 인기리스트 · 통합 상품검색/);
  assert.match(popular, /excelPreviewProductMode = true/);
  assert.equal((popular.match(/productView: true/g) || []).length, 2);
  assert.doesNotMatch(popular, /productView: false/);
  assert.match(renderer, /renderExcelProductRows\(file, products\)/);
  assert.match(renderer, /<th>이미지<\/th><th>상품번호<\/th><th>상품명<\/th><th>브랜드<\/th>/);
  assert.doesNotMatch(renderer, /acceptSellerCenterProducts\(verifiedProducts[\s\S]{0,500}runDomesticBatch\(\)/);
});

test("popular Excel columns map into searchable preview products", () => {
  assert.match(main, /articleNumber: column\("상품 번호", "상품번호", "상품코드", "품번"\)/);
  assert.match(main, /image: column\("SPU 이미지", "상품 이미지", "이미지", "이미지 URL"\)/);
  assert.match(main, /"최근 30일 평균 거래가", "평균 거래가"/);
  assert.match(renderer, /상품\\s\*코드/);
  assert.match(renderer, /이미지\(\?:\\s\*URL\)\?/);
});
