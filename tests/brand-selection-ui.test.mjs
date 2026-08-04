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

test("brand button shows download complete only for a registered valid workbook", () => {
  const cardsStart = renderer.indexOf("function renderBrandCards");
  const cardsEnd = renderer.indexOf("function renderCategoryButtons", cardsStart);
  const cards = renderer.slice(cardsStart, cardsEnd);
  const completedStart = renderer.indexOf("function hasCompletedBrandDownload");
  const completedEnd = renderer.indexOf("function renderDownloadedBrandFiles", completedStart);
  const completed = renderer.slice(completedStart, completedEnd);

  assert.match(cards, /hasCompletedBrandDownload\(brand\)/);
  assert.match(cards, /✓ 다운로드 완료/);
  assert.match(completed, /brandIntegrity\?\.ok === false/);
  assert.match(completed, /downloadedBrandFiles\.some/);
});
