import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const style = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("brand picker keeps one compact multi-selection toolbar", () => {
  const layoutStart = renderer.indexOf("function setupBrandLayout");
  const layoutEnd = renderer.indexOf("function renderBrandWorkbench", layoutStart);
  const layout = renderer.slice(layoutStart, layoutEnd);

  assert.match(layout, /picker\.append\(summary, toolbar, selectionActions, cards\)/);
  assert.doesNotMatch(layout, /brand-picker-selection|브랜드를 선택해 주세요/);
  assert.doesNotMatch(layout, /brand-selection-panel|brand-selection-chips|brand-selection-history/);
});

test("brand-card clicks toggle multiple selections without starting an export", () => {
  const clickStart = renderer.indexOf('document.addEventListener("click"');
  const clickEnd = renderer.indexOf('document.querySelectorAll(".explorer-mode")', clickStart);
  const clickHandler = renderer.slice(clickStart, clickEnd);

  assert.match(clickHandler, /closest\("\.brand-card\[data-brand-id\]"\)/);
  assert.match(clickHandler, /toggleBrandSelection\(brandButton\.dataset\.brandId\)/);
  assert.doesNotMatch(clickHandler, /brandExportQueue = \[brand\]/);
  assert.doesNotMatch(clickHandler, /void exportNextSelectedBrand\(generation\)/);
});

test("brand selection supports toggle-on and toggle-off", () => {
  const selectStart = renderer.indexOf("function toggleBrandSelection");
  const selectEnd = renderer.indexOf("function updateBrandSelectionControls", selectStart);
  const selection = renderer.slice(selectStart, selectEnd);

  assert.match(selection, /selectedBrandIds\.has\(id\)/);
  assert.match(selection, /selectedBrandIds\.add\(id\)/);
  assert.match(selection, /selectedBrandIds\.delete\(id\)/);
});

test("selected brand button shows a check and the second click clears it", () => {
  const cardsStart = renderer.indexOf("function renderBrandCards");
  const cardsEnd = renderer.indexOf("function renderCategoryButtons", cardsStart);
  const cards = renderer.slice(cardsStart, cardsEnd);

  assert.match(cards, /const selected = selectedBrandIds\.has\(Number\(brand\.id\)\)/);
  assert.match(cards, /class="brand-selection-check" aria-hidden="true">✓<\/i>/);
  assert.match(cards, /aria-pressed="\$\{selected\}"/);
  assert.match(style, /\.brand-selection-check\{[\s\S]*?display:none/);
  assert.match(style, /\.brand-card\.selected \.brand-selection-check\{display:inline-flex\}/);
});




test("brand picker exposes accessible multi-select and search icons", () => {
  assert.match(indexHtml, /class="brand-filter-field"/);
  assert.match(indexHtml, /aria-label="브랜드 복수 선택 및 검색"/);
  assert.match(indexHtml, /id="brand-export-selected"/);
  assert.match(indexHtml, /<span>브랜드 검색<\/span>/);
  assert.match(indexHtml, /id="brand-selected-count"[\s\S]*id="brand-sync"[\s\S]*id="brand-selection-clear"[\s\S]*id="brand-export-selected"/);
  assert.match(indexHtml, /<svg aria-hidden="true" viewBox="0 0 24 24">/);
});


test("brand button shows down-complete whenever its data-center workbook was downloaded", () => {
  const cardsStart = renderer.indexOf("function renderBrandCards");
  const cardsEnd = renderer.indexOf("function renderCategoryButtons", cardsStart);
  const cards = renderer.slice(cardsStart, cardsEnd);
  const completedStart = renderer.indexOf("function hasCompletedBrandDownload");
  const completedEnd = renderer.indexOf("function renderDownloadedBrandFiles", completedStart);
  const completed = renderer.slice(completedStart, completedEnd);

  assert.match(cards, /latestCompletedBrandDownload\(brand\)/);
  assert.match(cards, />다운완료</);
  assert.match(cards, /brand-download-date/);
  assert.match(cards, /latestCompletedBrandDownload\(brand\)/);
  assert.match(cards, /brandDownloadCardTime/);
  assert.match(cards, /<strong>\$\{text\(brand\.name\)\}<\/strong>[\s\S]*?\$\{downloadComplete/);
  assert.match(style, /\.brand-card\.download-complete\{grid-template-columns:30px minmax\(0,1fr\)\}/);
  assert.doesNotMatch(completed, /brandIntegrity\?\.ok === false/);
  assert.match(completed, /downloadedBrandFiles[\s\S]*\.filter/);
  assert.match(completed, /rendererBrandsMatch/);
});

test("brand button shows an orange official badge only for linked official stores", () => {
  const cardsStart = renderer.indexOf("function renderBrandCards");
  const cardsEnd = renderer.indexOf("function renderCategoryButtons", cardsStart);
  const cards = renderer.slice(cardsStart, cardsEnd);

  assert.match(cards, /\["verified", "search_unsupported"\]\.includes/);
  assert.match(cards, /class="brand-official-badge" aria-label="공식몰 연동 완료">공식</);
  assert.match(cards, /officialLinked \? " official-linked"/);
  assert.match(style, /\.brand-official-badge\{[\s\S]*?background:#f28c28/);
});

test("brand button shows the linked domain and a gray no-store badge", () => {
  const cardsStart = renderer.indexOf("function renderBrandCards");
  const cardsEnd = renderer.indexOf("function renderCategoryButtons", cardsStart);
  const cards = renderer.slice(cardsStart, cardsEnd);

  assert.match(cards, /officialHomepageUrl/);
  assert.match(cards, /brand-official-domain/);
  assert.match(cards, /brand-official-badge missing/);
  assert.match(cards, />공식몰 없음</);
  assert.match(style, /\.brand-official-badge\.missing\{[^}]*background:#8b939e/);
  assert.match(style, /\.brand-official-badge\{[^}]*white-space:nowrap/);
  assert.match(style, /\.brand-official-badge\.missing\{[^}]*min-width:70px[^}]*height:22px[^}]*padding:0 9px/);
});

test("official-domain progress updates the matching brand card immediately", () => {
  assert.match(renderer, /audit\?\.updatedBrand/);
  assert.match(renderer, /updated\.officialDomainStatus = String\(audit\.updatedBrand\.status/);
  assert.match(renderer, /updated\.officialHomepageUrl = String\(audit\.updatedBrand\.homepageUrl/);
});

test("batch progress keeps only one brand row for each POIZON job number", () => {
  const updateStart = renderer.indexOf("function updateBrandBatchState");
  const updateEnd = renderer.indexOf("function renderBrandBatchProgress", updateStart);
  const update = renderer.slice(updateStart, updateEnd);

  assert.match(update, /const normalizedJobId = String\(jobId \|\| ""\)\.trim\(\)/);
  assert.match(update, /String\(existing\?\.jobId \|\| ""\)\.trim\(\) === normalizedJobId/);
  assert.match(update, /brandBatchStates\.delete\(existingKey\)/);
});

test("download completion accepts POIZON brand-name variants such as Polo Ralph Lauren", () => {
  const matcherStart = renderer.indexOf("function rendererBrandsMatch");
  const matcherEnd = renderer.indexOf("function brandImportPathKey", matcherStart);
  const matcher = renderer.slice(matcherStart, matcherEnd);
  assert.match(matcher, /leftKey\.includes\(rightKey\) \|\| rightKey\.includes\(leftKey\)/);
});

test("download UI does not expose brand mismatch wording", () => {
  assert.doesNotMatch(renderer, /브랜드 불일치/);
  assert.doesNotMatch(renderer, /실제 \$\{actualBrand\}/);
  assert.match(renderer, /updateBrandExportJob\(file\?\.jobId, "확인완료"/);
  assert.doesNotMatch(renderer, /100% 검증완료/);
});

test("upgrade clears the legacy persisted job state", () => {
  const migrationStart = renderer.indexOf('const DOWNLOAD_STATUS_MIGRATION_KEY');
  const migrationEnd = renderer.search(/try \{\r?\n  selectedBrandIds/g);
  const migration = renderer.slice(migrationStart, migrationEnd);

  assert.ok(migrationStart >= 0);
  assert.ok(migrationEnd > migrationStart);
  assert.match(migration, /around-g-download-status-v2\.10\.29/);
  assert.match(migration, /localStorage\.removeItem\("around-g-last-brand-export-job"\)/);
});

test("a previous process job number is never restored as current live work", () => {
  assert.match(renderer, /around-g-live-job-ui-v2\.10\.34/);
  assert.doesNotMatch(renderer, /localStorage\.setItem\("around-g-last-brand-export-job"/);
  assert.doesNotMatch(renderer, /if \(savedJob\?\.jobId\) updateBrandExportJob/);
});
