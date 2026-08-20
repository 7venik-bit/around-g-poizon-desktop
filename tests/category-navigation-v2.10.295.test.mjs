import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

test("브랜드 검색 옆 카테고리 버튼에서 세부 메뉴 화면으로 이동한다", () => {
  assert.match(html, /id="brand-open-category"/);
  assert.match(html, /id="category-detail-buttons"/);
  assert.match(html, /id="category-search" class="primary" disabled>검색/);
  assert.match(renderer, /data-service-explorer="category"/);
  assert.match(renderer, /data-category-detail/);
});
