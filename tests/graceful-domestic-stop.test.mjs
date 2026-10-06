import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

const stopStart = renderer.indexOf("function stopExcelPreviewSearch()");
const stopEnd = renderer.indexOf("function showDomesticSearchOverlay(", stopStart);
const stopFn = renderer.slice(stopStart, stopEnd);

test("first stop press finishes the in-flight product instead of discarding it", () => {
  assert.match(renderer, /let excelPreviewGracefulStop = false;/);
  assert.match(stopFn, /if \(excelPreviewBatchSearching && !excelPreviewGracefulStop\)/);
  const deferAt = stopFn.indexOf("excelPreviewGracefulStop = true;");
  const bumpAt = stopFn.indexOf("++excelPreviewSearchRunId;");
  assert.ok(deferAt >= 0 && bumpAt >= 0 && deferAt < bumpAt,
    "graceful deferral must precede run invalidation");
  assert.match(stopFn, /현재 상품 검색을 마친 뒤 중지합니다/);
});

test("second stop press still stops immediately with main cancellation", () => {
  assert.match(stopFn, /excelPreviewGracefulStop = false;\s*\+\+excelPreviewSearchRunId;/);
  assert.match(stopFn, /requestDomesticSearchCancel\(\)/);
  assert.match(stopFn, /검색을 중지했습니다/);
});

test("batch loop saves the finished product, then stops before the next one", () => {
  const loopStart = renderer.indexOf("const response = await cachedDomesticSearch(product, true);");
  const loopEnd = renderer.indexOf("refreshDomesticSearchRows();\n    document.querySelector('#domestic-recovery-notice')", loopStart);
  const loopTail = renderer.slice(loopStart, loopEnd);
  assert.match(loopTail, /persistExcelSearchResults\(activeExcelPreview\.file\.path\)/);
  assert.match(loopTail, /if \(excelPreviewGracefulStop\)/);
  assert.match(loopTail, /까지 저장하고 중지했습니다/);
});

test("a new search clears a stale graceful stop", () => {
  assert.match(renderer, /excelPreviewBatchSearching = true;\s*excelPreviewGracefulStop = false;/);
});
