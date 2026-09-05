import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [renderer, main, html] = await Promise.all([
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
]);

test("카테고리 검색은 인기리스트 대신 다운로드 완료 브랜드를 전달한다", () => {
  assert.match(renderer, /const favoriteBrandIds = \[\.\.\.categoryBrandIds\]/);
  assert.match(renderer, /const excelSales = await downloadedBrandSalesByArticle\(brand\)/);
  assert.match(renderer, /captureSellerBrandSales\(\{/);
  assert.match(renderer, /mergeExcelProductsWithSellerScreen\(excelSales\.products, sellerResult\.products/);
  assert.match(renderer, /const categoryProducts = crossValidated\.products/);
  assert.doesNotMatch(renderer, /const popularResult = await capturePopularProducts\(\{ runDomestic: false, renderResults: false \}\)/);
});

test("다운로드 완료 브랜드 구성이 바뀌면 별도의 카테고리 캐시를 사용한다", () => {
  assert.match(renderer, /categorySearchCacheId\(category, detail, minimumChinaSales30, minimumLocalSales30, brandIds = pinnedBrandIds\)/);
  assert.match(renderer, /:\$\{detail \|\| "all"\}:/);
  assert.match(renderer, /favorites:\$\{brandKey\}/);
  assert.match(renderer, /category:seller-screen-v7:/);
  assert.match(renderer, /다운로드 완료 브랜드가 없습니다/);
});

test("카테고리 필터는 POIZON 화면 최근 30일 값을 우선해 AND로 적용한다", () => {
  assert.match(renderer, /hasSalesData: screenProduct\.hasSalesData === true/);
  assert.match(renderer, /hasLocalSalesData: screenProduct\.hasLocalSalesData === true/);
  assert.match(renderer, /downloadedBrandSalesByArticle\(brand\)/);
  assert.match(renderer, /Number\(product\.sales30d \|\| 0\) >= minimumChinaSales30/);
  assert.match(renderer, /Number\(product\.localSales30d \|\| 0\) >= minimumLocalSales30/);
  assert.match(renderer, /salesSource: "seller-center-screen"/);
  assert.match(renderer, /const minimumChinaSales30 = categorySalesMinimum/);
  assert.match(html, /id="category-min-china-sales-30"[^>]+value="100"/);
  assert.match(html, /id="category-min-local-sales-30"[^>]+value="30"/);
  assert.doesNotMatch(html, /id="category-min-sales"/);
});

test("상단 Excel 가져오기는 다운로드 파일 동기화 한 버튼으로 대체한다", () => {
  assert.match(html, /id="import-button"[^>]*>다운로드 파일 동기화<\/button>/);
  assert.doesNotMatch(html, /id="brand-download-clear"/);
  const start = renderer.indexOf('$("#import-button").addEventListener');
  const end = renderer.indexOf('$("#export-button").addEventListener', start);
  const handler = renderer.slice(start, end);
  assert.match(handler, /await restoreDownloadedBrandFiles\(\)/);
  assert.match(handler, /activateSearchServiceMode\?\.\("files"\)/);
  assert.match(handler, /다운로드 파일.*개를 동기화했습니다/);
  assert.doesNotMatch(handler, /importExcel\(/);
});
