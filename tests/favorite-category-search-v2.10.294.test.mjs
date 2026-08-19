import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [renderer, main] = await Promise.all([
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
]);

test("카테고리 검색은 인기리스트 대신 현재 즐겨찾기 브랜드를 전달한다", () => {
  assert.match(renderer, /const favoriteBrandIds = \[\.\.\.pinnedBrandIds\]/);
  assert.match(renderer, /mode: "category",\s*brandIds: favoriteBrandIds/);
  assert.doesNotMatch(renderer, /const popularResult = await capturePopularProducts\(\{ runDomestic: false, renderResults: false \}\)/);
  assert.match(main, /requestedBrandIds/);
  assert.match(main, /categoryBrands = input\?\.mode === "category"/);
});

test("즐겨찾기 추가·삭제 결과가 바뀌면 별도의 카테고리 캐시를 사용한다", () => {
  assert.match(renderer, /categorySearchCacheId\(category, minimumSales30, brandIds = pinnedBrandIds\)/);
  assert.match(renderer, /favorites:\$\{brandKey\}/);
  assert.match(renderer, /즐겨찾기 브랜드를 먼저 등록해 주세요/);
});
