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
  assert.match(renderer, /mode: "category",\s*brandIds: \[brandId\]/);
  assert.doesNotMatch(renderer, /const popularResult = await capturePopularProducts\(\{ runDomestic: false, renderResults: false \}\)/);
  assert.match(main, /requestedBrandIds/);
  assert.match(main, /categoryBrands = input\?\.mode === "category"/);
});

test("다운로드 완료 브랜드 구성이 바뀌면 별도의 카테고리 캐시를 사용한다", () => {
  assert.match(renderer, /categorySearchCacheId\(category, detail, minimumChinaSales30, minimumLocalSales30, brandIds = pinnedBrandIds\)/);
  assert.match(renderer, /:\$\{detail \|\| "all"\}:/);
  assert.match(renderer, /favorites:\$\{brandKey\}/);
  assert.match(renderer, /category:v3:/);
  assert.match(renderer, /다운로드 완료 브랜드가 없습니다/);
});

test("카테고리 30일 필터는 중국과 현지 판매량의 개별 최솟값을 AND로 적용한다", () => {
  assert.match(main, /product\.sales30d >= minimumChinaSales30/);
  assert.match(main, /product\.localSales30d >= minimumLocalSales30/);
  assert.match(renderer, /localSales30d: Number\(product\.localSales30d \|\| 0\)/);
  assert.match(renderer, /const minimumChinaSales30 = categorySalesMinimum/);
  assert.match(html, /id="category-min-china-sales30"[^>]+value="30"/);
  assert.match(html, /id="category-min-local-sales30"[^>]+value="30"/);
  assert.doesNotMatch(html, /id="category-min-sales"/);
});
