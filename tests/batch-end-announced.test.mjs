import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

test("superseded excel batches announce instead of vanishing silently", () => {
  const announced = renderer.match(/새 상품 검색이 시작되어 이전 배치를 종료했습니다\./g) || [];
  assert.ok(announced.length >= 2, `expected in-loop announcements, found ${announced.length}`);
  assert.match(renderer, /if \(excelPreviewBatchSearching\) \$\("#excel-filter-status"\)\.textContent = "새 상품 검색이 시작되어 이전 배치를 종료했습니다\."/);
});

test("explorer batch survives a mid-loop exception with flags restored", async () => {
  const source = readFileSync(resolve(root, "src/renderer.js"), "utf8");
  const body = source.slice(source.indexOf("async function runDomesticBatch("), source.indexOf('$("#domestic-search-all").addEventListener'));
  assert.match(body, /let batchError = null;/);
  assert.match(body, /if \(batchError\) \{/);
  assert.match(body, /국내 재고 검색 중 오류가 발생했습니다\. 확인된 결과는 보관했습니다\./);
  const elements = new Map();
  const context = { options: {}, DOMESTIC_BATCH_PROGRESS_KEY: "batch-progress",
    domesticBatchRunning: false, domesticBatchStopRequested: false, domesticBatchVerifyCounts: false,
    domesticBatchLoginScopeId: "", domesticIdentitySearchCache: new Map(), domesticResults: new Map(),
    allExplorerProducts: [{ articleNumber: "A" }], currentExplorerProducts: [],
    selectedExplorerKeys: new Set(),
    $: (key) => { if (!elements.has(key)) elements.set(key, {}); return elements.get(key); },
    updateExplorerSelectionUi: () => {}, domesticKey: (p) => p.articleNumber,
    domesticBatchId: () => "batch", readDomesticBatchProgress: () => undefined,
    restoreDomesticStockResults: async () => {}, clearSavedDomesticStockResults: async () => {},
    searchDomesticAt: async () => { throw new Error("mid-batch render failure"); },
    saveDomesticBatchProgress: () => {},
    localStorage: { removeItem: () => {} }, window: { aroundG: {} } };
  await runInNewContext(`${body};runDomesticBatch()`, context);
  assert.equal(context.domesticBatchRunning, false);
  assert.equal(elements.get("#domestic-search-all").disabled, false);
  assert.equal(elements.get("#domestic-search-all").textContent, "표시 목록 국내 재고 검색");
  assert.match(elements.get("#domestic-batch-status").textContent, /오류가 발생했습니다/);
});
