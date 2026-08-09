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

test("selected-brand search queues every selected brand", () => {
  assert.match(renderer, /function selectedBrandsForExport\(\)/);
  assert.match(renderer, /brandExportQueue = selectedBrands\.map/);
  assert.match(renderer, /void exportNextSelectedBrand\(generation\)/);
  assert.match(renderer, /#brand-export-selected/);
});

test("the running brand-search button stops the current and queued registrations", () => {
  assert.match(renderer, /brandSelectionBusy \? "작업 중지" : "브랜드 검색"/);
  assert.match(renderer, /brandWorkHistoryGeneration \+= 1/);
  assert.match(renderer, /brandExportQueue = \[\]/);
  assert.match(renderer, /updateBrandBatchState\(stoppedBrand, "사용자 중지"\)/);
  assert.match(renderer, /await window\.aroundG\.abortSellerBrandExportAttempt/);
  assert.match(renderer, /이미 생성된 작업번호의 다운로드 감시는 계속합니다/);
});

test("brand picker exposes accessible multi-select and search icons", () => {
  assert.match(indexHtml, /class="brand-filter-field"/);
  assert.match(indexHtml, /aria-label="브랜드 복수 선택 및 검색"/);
  assert.match(indexHtml, /id="brand-export-selected"/);
  assert.match(indexHtml, /<span>브랜드 검색<\/span>/);
  assert.match(indexHtml, /id="brand-selected-count"[\s\S]*id="brand-sync"[\s\S]*id="brand-selection-clear"[\s\S]*id="brand-export-selected"/);
  assert.match(indexHtml, /<svg aria-hidden="true" viewBox="0 0 24 24">/);
});

test("active brand work has a live spinner, elapsed time, and stale-response state", () => {
  assert.match(indexHtml, /id="brand-activity"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(indexHtml, /id="brand-activity-elapsed"/);
  assert.match(indexHtml, /id="brand-activity-updated"/);
  assert.match(indexHtml, /id="brand-seller-diagnostic"[^>]*>진단 창 보기<\/button>/);
  assert.match(renderer, /openSellerProductSearch\(\)/);
  assert.match(style, /@keyframes brand-activity-spin/);
  assert.match(renderer, /setInterval\(renderBrandActivity, 1000\)/);
  assert.match(renderer, /idleSeconds >= 60/);
  assert.match(renderer, /stopBrandActivity\(\)/);
});

test("brand button shows down-complete whenever its data-center workbook was downloaded", () => {
  const cardsStart = renderer.indexOf("function renderBrandCards");
  const cardsEnd = renderer.indexOf("function renderCategoryButtons", cardsStart);
  const cards = renderer.slice(cardsStart, cardsEnd);
  const completedStart = renderer.indexOf("function hasCompletedBrandDownload");
  const completedEnd = renderer.indexOf("function renderDownloadedBrandFiles", completedStart);
  const completed = renderer.slice(completedStart, completedEnd);

  assert.match(cards, /hasCompletedBrandDownload\(brand\)/);
  assert.match(cards, />다운완료</);
  assert.match(cards, /<strong>\$\{text\(brand\.name\)\}<\/strong>\$\{downloadComplete/);
  assert.match(style, /\.brand-card\.download-complete\{grid-template-columns:30px minmax\(0,1fr\)\}/);
  assert.doesNotMatch(completed, /brandIntegrity\?\.ok === false/);
  assert.match(completed, /downloadedBrandFiles\.some/);
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
