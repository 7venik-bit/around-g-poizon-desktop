import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("whole workbook selection does not silently start a manual search", () => {
  assert.match(html, />원본 전체 선택<\/button>/);
  assert.match(renderer, /오른쪽 상품검색을 누르면 전체 검색을 시작합니다/);
  assert.match(renderer, /readyToSearch && selectedBrandDomesticQueueRunning/);
  assert.doesNotMatch(renderer, /if \(readyToSearch\) \$\("#excel-preview-search-selected"\)\?\.click\(\)/);
});

test("selected-brand automation can still start each workbook search", () => {
  assert.match(renderer, /selectedBrandDomesticQueueRunning = true/);
  assert.match(renderer, /자동 검색을 시작합니다/);
});
