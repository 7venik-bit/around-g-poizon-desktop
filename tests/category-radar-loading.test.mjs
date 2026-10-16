import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

function categoryLoadingHtml() {
  const start = html.indexOf('<section id="category-loading"');
  assert.notEqual(start, -1);
  return html.slice(start, html.indexOf("</section>", start));
}

test("category loading shows the popular-list radar scope", () => {
  const block = categoryLoadingHtml();
  // Existing copy/bar/stop controls stay for behavior and older tests.
  assert.match(block, /id="category-loading-title"/);
  assert.match(block, /id="category-loading-count"/);
  assert.match(block, /id="category-loading-time"/);
  assert.match(block, /id="category-loading-bar"/);
  assert.match(block, /id="category-search-stop"/);
  assert.match(block, /class="popular-radar"/);
  assert.match(block, /class="popular-radar-face"/);
  assert.match(block, /class="popular-radar-sweep"/);
  assert.equal((block.match(/class="popular-radar-tag"/g) || []).length, 8);
  assert.match(block, /class="popular-radar-dot"/);
  assert.match(block, /class="popular-radar-percent"[^>]*><b>0<\/b><span>%<\/span>/);
  assert.match(block, /class="popular-radar-caption">카테고리 탐색 레이더/);
  assert.match(block, /class="popular-progress-feed"/);
  assert.match(block, /class="popular-progress-count"><b>0<\/b>/);
  assert.match(block, /브랜드 · 상품 0개 · 0%/);
  assert.match(block, /class="popular-progress-items"/);
});

test("category progress drives the radar with brand values", () => {
  assert.match(renderer, /function updateCategoryRadar\(host,/);
  assert.match(renderer, /function resetCategoryRadar\(\)/);
  const start = renderer.indexOf("function updateCategoryLoading({ title,");
  const end = renderer.indexOf("function updateCategoryRadar(host,", start);
  const fn = renderer.slice(start, end);
  assert.match(fn, /brand = "", brandDone = false/);
  assert.match(fn, /updateCategoryRadar\(host, \{ done, maximum, products, safePercent, brand, brandDone \}\)/);
  assert.match(renderer, /0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7/);
  assert.match(renderer, /resetCategoryRadar\(\);/);
  // Sliced-vm fixtures run with stub nodes, so radar DOM access is guarded.
  assert.match(renderer, /typeof host\.querySelector !== "function"/);
});

test("category result status stays short while keeping the missing-sales guidance", () => {
  const start = renderer.indexOf("const detailProducts = [...detailProductsByKey.values()];");
  const status = renderer.slice(start, start + 800);
  assert.match(status, /· 상품 \$\{/);
  assert.match(status, /· 브랜드 \$\{/);
  assert.match(status, /· Excel \$\{/);
  assert.match(status, /판매량 값이 없는 상품 \$\{/);
  assert.doesNotMatch(status, /조건 비교에서 제외했습니다/);
});

test("category radar styles mirror the popular radar scope", () => {
  assert.match(css, /#category-loading \.popular-radar-face\{/);
  assert.match(css, /#category-loading \.popular-radar-sweep\{/);
  assert.match(css, /#category-loading \.popular-radar-tag\{/);
  assert.match(css, /#category-loading \.popular-radar-tag\.tag-pos-11\{/);
  assert.match(css, /#category-loading \.popular-radar-percent b\{/);
  assert.match(css, /#category-loading \.popular-radar-caption\{/);
  assert.match(css, /#category-loading\[data-complete\] \.popular-radar-sweep/);
  assert.match(css, /#category-loading \.popular-progress-feed\{/);
  assert.match(css, /#category-loading \.popular-progress-count b\{/);
  assert.match(css, /#category-loading \.popular-progress-items\{/);
  assert.match(css, /#category-loading \.popular-progress-item\{/);
  assert.match(css, /category-loading-progress/);
});
