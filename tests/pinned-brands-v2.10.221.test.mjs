import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("selected brands can be moved to a persistent frequently-used group", () => {
  assert.match(html, /id="brand-move-top"[^>]*>즐겨찾는 브랜드 선택</);
  assert.match(renderer, /around-g-pinned-brand-ids/);
  assert.match(renderer, /pinnedBrandIds = \[\.\.\.selected,/);
  assert.match(html, /id="frequent-brand-group"/);
  assert.match(html, /id="frequent-brand-cards"/);
  assert.match(html, /id="all-brand-title"/);
  assert.match(renderer, /const pinnedBrands = matchedBrands\.filter/);
  assert.match(renderer, /const regularBrands = matchedBrands\.filter/);
  assert.match(renderer, /frequentGroup\.hidden = pinnedBrands\.length === 0/);
});

test("pinned brands are visually identified and the list scrolls to the top", () => {
  assert.match(renderer, /brand-pinned-badge/);
  assert.match(renderer, /즐겨찾기에 추가하고 상단으로 이동했습니다/);
  assert.match(renderer, /scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
  assert.match(css, /\.brand-card\.brand-pinned/);
});

test("favorite brands can be removed from the right side or restored with selection clear", () => {
  assert.match(renderer, /data-brand-unpin/);
  assert.match(renderer, /즐겨찾기를 삭제하고 원래 위치로 되돌렸습니다/);
  assert.match(renderer, /selectedPinnedIds/);
  assert.match(renderer, /선택한 즐겨찾기 .*원래 위치로 되돌렸습니다/);
  assert.match(css, /\.brand-pinned-remove/);
});

test("favorite and full brand areas have separate visual containers", () => {
  assert.match(css, /\.brand-list-group\{/);
  assert.match(css, /\.frequent-brand-group\{/);
  assert.match(css, /\.all-brand-group\{/);
  assert.match(renderer, /\$\("#frequent-brand-cards"\)\.innerHTML = brandMarkup\(pinnedBrands\)/);
  assert.match(renderer, /\$\("#brand-cards"\)\.innerHTML = brandMarkup\(regularBrands\)/);
});

test("favorite brand header keeps a search button visible when the full picker is collapsed", () => {
  assert.match(html, /id="frequent-brand-group"[\s\S]*id="frequent-brand-export"[\s\S]*<span>브랜드 검색<\/span>/);
  assert.match(renderer, /\$\("#frequent-brand-export"\)\?\.addEventListener\("click"[\s\S]*\$\("#brand-export-selected"\)\?\.click\(\)/);
  assert.match(renderer, /\[search, frequentSearch\]\.filter\(Boolean\)\.forEach/);
  assert.match(html, /id="frequent-brand-category"[^>]*>카테고리<\/button>/);
  assert.match(renderer, /\$\("#frequent-brand-category"\)\?\.addEventListener\("click"[\s\S]*\$\("#brand-open-category"\)\?\.click\(\)/);
  assert.match(css, /\.frequent-brand-heading-actions/);
  assert.match(css, /\.frequent-brand-search-action/);
});

test("favorites survive unrelated corrupt history and the known 23 are recoverable", () => {
  assert.match(renderer, /const parsed = JSON\.parse\(localStorage\.getItem\("around-g-pinned-brand-ids"/);
  assert.match(renderer, /const parsed = JSON\.parse\(localStorage\.getItem\("around-g-brand-selection-history"/);
  assert.match(renderer, /function restoreKnownPinnedBrandsIfMissing/);
  assert.match(renderer, /LAST_KNOWN_PINNED_BRAND_NAMES/);
  assert.match(renderer, /"Polo Ralph Lauren", "PUMA", "Crocs", "MLB", "Lululemon"/);
});

test("official site address uses a separate full-width bottom row", () => {
  assert.match(renderer, /<\/span>\$\{officialDomain \? `<small class="brand-official-domain"/);
  assert.match(css, /\.brand-card > \.brand-official-domain/);
  assert.match(css, /grid-column:1 \/ -1/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /word-break:break-all/);
});
