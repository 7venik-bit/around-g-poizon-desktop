import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("the former favorite group is labeled as downloaded-complete brands", () => {
  assert.match(html, /id="frequent-brand-title">다운로드 완료 브랜드/);
  assert.match(html, /원본 Excel 다운로드 완료 브랜드를 최신순으로 표시합니다/);
  assert.doesNotMatch(html, /id="brand-move-top"/);
  assert.doesNotMatch(html, /즐겨찾는 브랜드 선택/);
  assert.match(html, /id="category-brand-title">다운로드 완료 브랜드 선택/);
});

test("downloaded brand group is derived from existing workbook scan results", () => {
  assert.match(renderer, /function completedDownloadBrands\(\)/);
  assert.match(renderer, /for \(const file of \[\.\.\.downloadedBrandFiles\]\.sort/);
  assert.match(renderer, /rendererBrandsMatch\(item\.name, fileBrandName\)/);
  assert.match(renderer, /seen\.has\(brandId\)/);
  assert.match(renderer, /completed\.push\(brand\)/);
  assert.match(renderer, /downloadedBrandFiles = result\.files/);
  assert.match(renderer, /\.sort\(\(a, b\) => Number\(b\.time/);
});

test("downloaded brands are newest-first, deduplicated, and excluded from the full list", () => {
  const cardsStart = renderer.indexOf("function renderBrandCards");
  const cardsEnd = renderer.indexOf("function renderCategoryButtons", cardsStart);
  const cards = renderer.slice(cardsStart, cardsEnd);
  assert.match(cards, /const completedBrands = completedDownloadBrands\(\)/);
  assert.match(cards, /const completedOrder = new Map/);
  assert.match(cards, /pinnedBrandIds = completedBrands\.map/);
  assert.match(cards, /const visibleCompletedBrands = matchedBrands\.filter/);
  assert.match(cards, /const regularBrands = matchedBrands\.filter\(\(brand\) => !completedOrder\.has/);
  assert.match(cards, /저장 폴더에 다운로드 완료된 원본 Excel 파일이 없습니다/);
});

test("download-completed header keeps search and category actions", () => {
  assert.match(html, /id="frequent-brand-group"[\s\S]*id="frequent-brand-export"[\s\S]*<span>브랜드 검색<\/span>/);
  assert.match(html, /id="completed-brand-domestic-search"[^>]*disabled>국내 상품검색<\/button>/);
  assert.match(html, /id="frequent-brand-category"[^>]*>카테고리<\/button>/);
  assert.match(renderer, /const completedCount = completedDownloadBrands\(\)\.length/);
  assert.match(renderer, /button === frequentSearch \? selectedCount === 0 && completedCount === 0/);
  assert.match(renderer, /\$\("#frequent-brand-export"\)\?\.addEventListener\("click"[\s\S]*pinnedBrandIds\.forEach/);
  assert.match(renderer, /\$\("#completed-brand-domestic-search"\)\?\.addEventListener\("click"[\s\S]*latestCompletedBrandDownload\(brand\)[\s\S]*selectedDownloads\.length !== 1[\s\S]*openIntegratedBrandExcel\(selectedDownloads\[0\], true\)/);
  assert.match(css, /\.frequent-brand-heading-actions/);
  assert.match(css, /\.frequent-brand-heading-actions>button\{[^}]*white-space:nowrap/);
  assert.match(css, /\.completed-brand-domestic-search\{min-width:116px\}/);
  assert.match(css, /@media\(max-width:850px\)[\s\S]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /\.frequent-brand-heading-actions>button\{width:100%;min-width:0/);
  assert.match(css, /@media\(max-width:560px\)[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.frequent-brand-search-action/);
});

test("download-completed cards show date, job number, Excel open, and ten-item toggle", () => {
  assert.match(html, /id="completed-brand-toggle"[^>]*hidden>전체보기/);
  assert.match(renderer, /visibleCompletedBrands\.slice\(0, 10\)/);
  assert.match(renderer, /completedBrandShowAll[\s\S]*?"최근 10개"/);
  assert.match(renderer, /작업번호 \$\{text\(latestDownload\.jobId\)\}/);
  assert.match(renderer, /data-open-brand-download=/);
  assert.match(renderer, /downloadedFileByEncodedPath\(downloadedBrandOpen\.dataset\.openBrandDownload\)/);
  assert.match(renderer, /await openIntegratedBrandExcel\(file, false\)/);
  assert.match(css, /\.brand-download-open/);
});

test("saved favorite data is preserved but no longer controls the displayed group", () => {
  assert.match(renderer, /around-g-pinned-brand-ids/);
  assert.match(renderer, /around-g-pinned-brand-names/);
  assert.doesNotMatch(html, /즐겨찾기로 지정한 브랜드만/);
  const cardsStart = renderer.indexOf("function renderBrandCards");
  const cardsEnd = renderer.indexOf("function renderCategoryButtons", cardsStart);
  const cards = renderer.slice(cardsStart, cardsEnd);
  assert.doesNotMatch(cards, /data-brand-unpin/);
  assert.doesNotMatch(cards, /brand-pinned-badge/);
});

test("startup waits for actual catalog and workbook scan instead of showing fallback favorites", () => {
  const startup = renderer.slice(renderer.lastIndexOf("(async () => {"));
  assert.doesNotMatch(startup, /showFavoriteCatalogFallback\(\)/);
  assert.match(startup, /setupBrandLayout\(\)/);
  assert.match(startup, /await recoverInterruptedBrandWorkAtStartup\(\)/);
  assert.match(renderer, /async function recoverInterruptedBrandWorkAtStartup\(\)[\s\S]*await restoreDownloadedBrandFiles\(\)/);
});

test("official site address uses a separate full-width bottom row", () => {
  assert.match(renderer, /<\/span>\$\{officialDomain \? `<small class="brand-official-domain"/);
  assert.match(css, /\.brand-card > \.brand-official-domain/);
  assert.match(css, /grid-column:1 \/ -1/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /word-break:break-all/);
});
