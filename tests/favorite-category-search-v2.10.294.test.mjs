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
  assert.match(renderer, /const excelSales = await downloadedBrandSalesByArticle\(brand, \{[\s\S]*minimumChinaTotalSales,[\s\S]*minimumLocalTotalSales/);
  assert.match(renderer, /const categoryProducts = excelSales\.products/);
  assert.doesNotMatch(renderer, /const popularResult = await capturePopularProducts\(\{ runDomestic: false, renderResults: false \}\)/);
});

test("다운로드 완료 브랜드 구성이 바뀌면 별도의 카테고리 캐시를 사용한다", () => {
  assert.match(renderer, /categorySearchCacheId\(category, detail, minimumChinaTotalSales, minimumLocalTotalSales, brandIds = pinnedBrandIds\)/);
  assert.match(renderer, /:\$\{detail \|\| "all"\}:/);
  assert.match(renderer, /favorites:\$\{brandKey\}/);
  assert.match(renderer, /category:excel-total-v6:/);
  assert.match(renderer, /다운로드 완료 브랜드가 없습니다/);
});

test("카테고리 필터는 OneDrive 원본의 중국과 현지 총판매량 최솟값을 AND로 적용한다", () => {
  assert.match(main, /hasTotalSalesData: columns\.totalSales >= 0/);
  assert.match(main, /hasLocalTotalSalesData: columns\.localTotalSales >= 0/);
  assert.match(renderer, /downloadedBrandSalesByArticle\(brand,/);
  assert.match(renderer, /Number\(product\.totalSales \|\| 0\) >= minimumChinaTotalSales/);
  assert.match(renderer, /Number\(product\.localTotalSales \|\| 0\) >= minimumLocalTotalSales/);
  assert.match(renderer, /hasChinaSales/);
  assert.match(renderer, /현지 판매자 총 판매량/);
  assert.match(renderer, /const minimumChinaTotalSales = categorySalesMinimum/);
  assert.match(html, /id="category-min-china-total-sales"[^>]+value="100"/);
  assert.match(html, /id="category-min-local-total-sales"[^>]+value="30"/);
  assert.doesNotMatch(html, /id="category-min-sales"/);
});
