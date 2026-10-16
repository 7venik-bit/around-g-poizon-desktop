import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

function progressHandlerBlock() {
  const start = renderer.indexOf("window.aroundG.onDomesticSearchProgress?.((payload");
  assert.notEqual(start, -1);
  const end = renderer.indexOf("function renderRawExcelDomesticCell", start);
  assert.notEqual(end, -1);
  return renderer.slice(start, end);
}

function batchProgressBlock() {
  const start = renderer.indexOf("const renderBatchSearchProgress = (completedCount");
  assert.notEqual(start, -1);
  const end = renderer.indexOf("renderBatchSearchProgress(0);", start);
  assert.notEqual(end, -1);
  return renderer.slice(start, end);
}

test("authentication-phase waits name the awaited login instead of a bare 0/N", () => {
  const handler = progressHandlerBlock();
  assert.match(handler, /payload\.phase === "authentication"/);
  assert.match(handler, /excelPreviewBatchSearching && lastBatchSearchProgress/);
  assert.match(handler, /로그인 대기 중/);
  assert.match(handler, /로그인 창을 확인해 주세요/);
  // Both the status line and the radar banner count expose the wait.
  assert.match(handler, /\$\("#excel-filter-status"\)/);
  assert.match(handler, /\$\("#domestic-loading-banner \.popular-progress-count span"\)/);
  // Unrelated requests must never rewrite the batch line.
  assert.match(handler, /payload\.requestId !== activeDomesticProgressRequestId/);
});

test("the wait message clears when real search progress resumes", () => {
  const handler = progressHandlerBlock();
  assert.match(handler, /else if \(batchLoginWaitSource\)/);
  assert.match(handler, /batchSearchProgressText\(lastBatchSearchProgress\)/);
  assert.match(handler, /batchSearchBannerCountText\(lastBatchSearchProgress\)/);
});

test("batch progress publishes reusable context without changing its wording", () => {
  const batch = batchProgressBlock();
  assert.match(batch, /lastBatchSearchProgress = \{[^}]*completed: completedCount/);
  assert.match(batch, /batchLoginWaitSource = ""/);
  assert.match(batch, /status\.textContent = batchSearchProgressText\(lastBatchSearchProgress\)/);
  assert.match(renderer, /function batchSearchProgressText\(/);
  assert.match(renderer, /상품 검색 진행 중 ·/);
  assert.match(renderer, /function batchSearchBannerCountText\(/);
  assert.match(renderer, /수집 중 ·/);
});

test("stale wait context cannot survive stop or batch completion", () => {
  const cleared = renderer.match(/lastBatchSearchProgress = null;/g) || [];
  assert.ok(cleared.length >= 3, `expected stop/direct/batch clears, found ${cleared.length}`);
  const clearedWait = renderer.match(/batchLoginWaitSource = "";/g) || [];
  assert.ok(clearedWait.length >= 3, `expected wait-source clears, found ${clearedWait.length}`);
});
