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
  assert.match(renderer, /categorySearchCacheId\(category, detail/);
  assert.match(renderer, /"축구화": \[\/\(\?:축구\|풋살\|football\|soccer\|cleat\)/);
  assert.match(renderer, /categorySelections/);
  assert.match(renderer, /products: detailProducts/);
});

test("카테고리는 브랜드 한 개씩 검색하고 완료 결과만 누적한다", () => {
  assert.match(renderer, /await searchNextBrand\(\)/);
  assert.match(renderer, /brandIds: favoriteBrandIds/);
  assert.match(renderer, /detailProductsByKey\.set\(key, \{ \.\.\.product/);
  assert.match(renderer, /failedSourceCount \+= 1/);
});

test("완료된 브랜드는 즉시 저장하고 재검색에서 건너뛴다", () => {
  assert.match(renderer, /completedBrandIds\.has\(brandId\)/);
  assert.match(renderer, /complete: false/);
  assert.match(renderer, /await savePartialResult\(\)/);
  assert.match(renderer, /검색 · 진행 중/);
});

test("카테고리 화면에서 즐겨찾기 브랜드를 골라 검색한다", () => {
  assert.match(html, /id="category-brand-section"/);
  assert.match(html, /id="category-brand-select-all"/);
  assert.match(html, /id="category-brand-clear"/);
  assert.match(renderer, /data-category-brand-id/);
  assert.match(renderer, /const favoriteBrandIds = \[\.\.\.categoryBrandIds\]/);
  assert.match(renderer, /!selectedCategoryPairs\(\)\.length \|\| !categoryBrandIds\.size/);
});

test("상위 카테고리와 세부 메뉴를 복수 선택하고 다시 눌러 해제한다", () => {
  assert.match(renderer, /let selectedCategorySelections = new Map\(\)/);
  assert.match(renderer, /function toggleCategoryDetail\(category, detail\)/);
  assert.match(renderer, /if \(details\.has\(detail\)\) details\.delete\(detail\)/);
  assert.match(renderer, /categorySelections\.some\(\(selection\) =>/);
  assert.match(renderer, /복수 선택 \$\{pairs\.length\}개/);
});
