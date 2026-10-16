import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function batchProgressBlock() {
  const start = renderer.indexOf("const renderBatchSearchProgress = (completedCount");
  assert.notEqual(start, -1);
  // The batch progress closure ends right before the first render call.
  const end = renderer.indexOf("renderBatchSearchProgress(0);", start);
  assert.notEqual(end, -1);
  return renderer.slice(start, end);
}

test("batch loading reuses the popular-list radar scope with popular values", () => {
  const block = batchProgressBlock();
  assert.match(block, /banner\.className = "domestic-loading-banner popular-radar-mode"/);
  assert.match(block, /class="popular-radar"/);
  assert.match(block, /class="popular-radar-face"/);
  assert.match(block, /class="popular-radar-sweep"/);
  assert.match(block, /popular-radar-tag/);
  assert.match(block, /class="popular-radar-dot"/);
  assert.match(block, /class="popular-radar-percent"/);
  assert.match(block, /국내 상품 탐색 레이더/);
  assert.match(block, /class="popular-progress-feed"/);
  assert.match(block, /class="popular-progress-count"/);
  assert.match(block, /수집 중 ·/);
  assert.match(block, /class="popular-progress-items"/);
  assert.match(block, /"popular-progress-item"/);
  assert.match(block, /class="popular-progress-code"/);
  assert.match(block, /class="popular-progress-name"/);
  assert.match(block, /toggleAttribute\("data-complete", percent >= 100\)/);
  assert.match(block, /0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7/);
  assert.doesNotMatch(block, /aroundg-amp\.jpg/);
  assert.doesNotMatch(block, /국내 상품 탐색 앰프/);
  assert.doesNotMatch(block, /domestic-loading-banner-needle/);
  assert.doesNotMatch(block, /domestic-loading-banner-tube/);
  assert.doesNotMatch(block, /domestic-loading-banner-level/);
  assert.doesNotMatch(block, /domestic-loading-banner-bar/);
});

test("radar-mode banner styles mirror the popular radar scope", () => {
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-radar-face\{/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-radar-sweep\{/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-radar-tag\{/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-radar-tag\.tag-pos-11\{/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-radar-percent b\{/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-radar-caption\{/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode\[data-complete\] \.popular-radar-sweep/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-progress-feed\{/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-progress-count b\{/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-progress-items\{/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-progress-item\{/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-progress-code\{/);
  assert.match(css, /#domestic-loading-banner\.popular-radar-mode \.popular-progress-name\{/);
});

test("banner hides when batch search settles or stops", () => {
  assert.equal(
    (renderer.match(/\$\("#domestic-loading-banner"\)\?\.remove\(\)/g) || []).length >= 3,
    true,
  );
  assert.match(css, /#domestic-loading-banner\[hidden\]\{display:none\}/);
});
