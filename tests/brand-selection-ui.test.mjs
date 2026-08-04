import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("brand picker removes the duplicate multi-selection summary panel", () => {
  const layoutStart = renderer.indexOf("function setupBrandLayout");
  const layoutEnd = renderer.indexOf("function renderBrandWorkbench", layoutStart);
  const layout = renderer.slice(layoutStart, layoutEnd);

  assert.match(layout, /picker\.append\(summary, toolbar, cards\)/);
  assert.doesNotMatch(layout, /brand-selection-panel|brand-selection-chips|brand-selection-history/);
});

test("one brand-card click selects one brand and starts its export", () => {
  const clickStart = renderer.indexOf('document.addEventListener("click"');
  const clickEnd = renderer.indexOf('document.querySelectorAll(".explorer-mode")', clickStart);
  const clickHandler = renderer.slice(clickStart, clickEnd);

  assert.match(clickHandler, /closest\("\.brand-card\[data-brand-id\]"\)/);
  assert.match(clickHandler, /const brand = selectSingleBrand\(brandButton\.dataset\.brandId\)/);
  assert.match(clickHandler, /brandExportQueue = \[brand\]/);
  assert.match(clickHandler, /void exportNextSelectedBrand\(generation\)/);
  assert.doesNotMatch(clickHandler, /toggleBrandSelection\(brandId\);\s*return;\s*selectedBrandId/);
});

test("single-brand selection does not toggle off on a repeated click", () => {
  const selectStart = renderer.indexOf("function selectSingleBrand");
  const selectEnd = renderer.indexOf("async function exportNextSelectedBrand", selectStart);
  const selection = renderer.slice(selectStart, selectEnd);

  assert.match(selection, /selectedBrandIds\.clear\(\);\s*selectedBrandIds\.add\(id\)/);
  assert.doesNotMatch(selection, /selectedBrandIds\.delete\(id\)/);
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
  assert.doesNotMatch(completed, /brandIntegrity\?\.ok === false/);
  assert.match(completed, /downloadedBrandFiles\.some/);
});

test("download UI does not expose brand mismatch wording", () => {
  assert.doesNotMatch(renderer, /브랜드 불일치/);
  assert.doesNotMatch(renderer, /실제 \$\{actualBrand\}/);
  assert.match(renderer, /updateBrandExportJob\(file\?\.jobId, "다운완료"/);
});

test("upgrade clears the legacy persisted job state before startup restore", () => {
  const migrationStart = renderer.indexOf('const DOWNLOAD_STATUS_MIGRATION_KEY');
  const restoreStart = renderer.indexOf('const savedJob = JSON.parse(localStorage.getItem("around-g-last-brand-export-job")');
  const migration = renderer.slice(migrationStart, restoreStart);

  assert.ok(migrationStart >= 0);
  assert.ok(restoreStart > migrationStart);
  assert.match(migration, /around-g-download-status-v2\.10\.29/);
  assert.match(migration, /localStorage\.removeItem\("around-g-last-brand-export-job"\)/);
});
