import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

test("브랜드 검색 옆 카테고리 버튼에서 세부 메뉴 화면으로 이동한다", () => {
  assert.match(html, /id="brand-open-category"/);
  assert.match(html, /id="category-detail-buttons"/);
  assert.match(html, /id="category-search" class="primary" disabled>검색/);
  assert.match(renderer, /activateSearchServiceMode\?\.\("category"\)/);
  assert.match(renderer, /data-category-detail/);
});

test("축구화 세부 메뉴는 신발 전체 캐시와 결과를 그대로 사용하지 않는다", () => {
  assert.match(renderer, /categorySearchCacheId\(selectedCategory, selectedCategoryDetail/);
  assert.match(renderer, /"축구화": \[\/\(\?:축구\|풋살\|football\|soccer\|cleat\)/);
  assert.match(renderer, /categoryDetail: selectedCategoryDetail/);
  assert.match(renderer, /products: detailProducts/);
});

test("카테고리는 브랜드 한 개씩 검색하고 완료 결과만 누적한다", () => {
  assert.match(renderer, /for \(let brandIndex = 0; brandIndex < favoriteBrandIds\.length; brandIndex \+= 1\)/);
  assert.match(renderer, /brandIds: \[brandId\]/);
  assert.match(renderer, /detailProductsByKey\.set\(key, product\)/);
  assert.match(renderer, /failedSourceCount \+= 1/);
});
