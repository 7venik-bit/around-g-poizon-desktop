import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

const buttons = [
  ["completed-brand-toggle", "최근 10개/전체보기"],
  ["frequent-brand-export", "포이즌 상품정보"],
  ["completed-brand-domestic-search", "국내 상품검색"],
  ["frequent-brand-category", "카테고리"],
];

test("all completed-brand action buttons exist and have click handlers", () => {
  for (const [id, label] of buttons) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${label} button missing`);
    assert.match(renderer, new RegExp(`\\$\\("#${id}"\\)\\?\\.addEventListener\\("click"`), `${label} click handler missing`);
  }
});

test("domestic search is independent from POIZON busy state", () => {
  assert.match(renderer, /domesticSearch\.disabled = completedCount === 0 \|\| combinedBrandPreviewLoading/);
  assert.doesNotMatch(renderer, /domesticSearch\.disabled = brandSelectionBusy/);
});

test("domestic search prevents only duplicate combined-list loads", () => {
  assert.match(renderer, /if \(combinedBrandPreviewLoading\) return/);
  assert.match(renderer, /finally \{\s*combinedBrandPreviewLoading = false;\s*updateBrandSelectionControls\(\)/);
});
