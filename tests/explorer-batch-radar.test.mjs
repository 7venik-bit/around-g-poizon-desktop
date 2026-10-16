import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const renderer = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");

function resultsHtml() {
  const start = html.indexOf('<div id="explorer-results"');
  assert.notEqual(start, -1);
  return html.slice(start, html.indexOf('<div id="explorer-product-grid"', start));
}

test("explorer results show the popular-list radar scope for batch search", () => {
  const block = resultsHtml();
  assert.match(block, /id="domestic-batch-status"/);
  const radarAt = block.indexOf('id="explorer-batch-radar"');
  assert.ok(radarAt > block.indexOf('id="domestic-batch-status"'));
  const radar = block.slice(radarAt);
  assert.match(radar, /class="popular-radar"/);
  assert.match(radar, /class="popular-radar-face"/);
  assert.match(radar, /class="popular-radar-sweep"/);
  assert.equal((radar.match(/class="popular-radar-tag"/g) || []).length, 8);
  assert.match(radar, /class="popular-radar-dot"/);
  assert.match(radar, /class="popular-radar-percent"[^>]*><b>0<\/b><span>%<\/span>/);
  assert.match(radar, /class="popular-radar-caption">국내 상품 탐색 레이더/);
  assert.match(radar, /class="popular-progress-feed"/);
  assert.match(radar, /class="popular-progress-count"><b>0<\/b>/);
  assert.match(radar, /수집 중 · 0%/);
  assert.match(radar, /class="popular-progress-items"/);
});

test("explorer batch drives and hides the radar, jumping to it on start", () => {
  assert.match(renderer, /function explorerBatchRadarHost\(\)/);
  assert.match(renderer, /function resetExplorerBatchRadar\(\)/);
  assert.match(renderer, /function updateExplorerBatchRadar\(/);
  assert.match(renderer, /function hideExplorerBatchRadar\(\)/);
  const start = renderer.indexOf("async function runDomesticBatch(");
  const end = renderer.indexOf('$("#domestic-search-all").addEventListener', start);
  const fn = renderer.slice(start, end);
  assert.match(fn, /resetExplorerBatchRadar\(\);/);
  assert.match(fn, /\$\("#explorer-batch-radar"\)\?\.scrollIntoView\?\.\(\{ behavior: "auto", block: "start" \}\)/);
  assert.match(fn, /updateExplorerBatchRadar\(\{/);
  assert.match(fn, /typeof resetExplorerBatchRadar === "function"/);
  assert.match(fn, /typeof updateExplorerBatchRadar === "function"/);
  assert.match(fn, /typeof hideExplorerBatchRadar === "function"/);
  assert.ok(fn.indexOf("hideExplorerBatchRadar();") !== fn.lastIndexOf("hideExplorerBatchRadar();"), "hide on both stop and completion");
  // Stub-node fixtures (no DOM query helpers) must keep working.
  assert.match(renderer, /typeof host\.querySelector !== "function"/);
});

test("explorer batch radar styles mirror the popular radar scope", () => {
  assert.match(css, /#explorer-batch-radar\[hidden\]\{display:none\}/);
  assert.match(css, /#explorer-batch-radar \.popular-radar-face\{/);
  assert.match(css, /#explorer-batch-radar \.popular-radar-sweep\{/);
  assert.match(css, /#explorer-batch-radar \.popular-radar-tag\{/);
  assert.match(css, /#explorer-batch-radar \.popular-radar-tag\.tag-pos-11\{/);
  assert.match(css, /#explorer-batch-radar \.popular-radar-percent b\{/);
  assert.match(css, /#explorer-batch-radar \.popular-radar-caption\{/);
  assert.match(css, /#explorer-batch-radar\[data-complete\] \.popular-radar-sweep/);
  assert.match(css, /#explorer-batch-radar \.popular-progress-feed\{/);
  assert.match(css, /#explorer-batch-radar \.popular-progress-count b\{/);
  assert.match(css, /#explorer-batch-radar \.popular-progress-items\{/);
  assert.match(css, /#explorer-batch-radar \.popular-progress-item\{/);
});

test("explorer batch completes with stub nodes and parks the radar hidden", async () => {
  const source = readFileSync(resolve(root, "src/renderer.js"), "utf8");
  const helpersStart = source.indexOf("function explorerBatchRadarHost()");
  assert.notEqual(helpersStart, -1);
  const body = source.slice(helpersStart, source.indexOf('$("#domestic-search-all").addEventListener'));
  const elements = new Map();
  const context = { options: {}, DOMESTIC_BATCH_PROGRESS_KEY: "batch-progress",
    domesticBatchRunning: false, domesticBatchStopRequested: false, domesticBatchVerifyCounts: false,
    domesticBatchLoginScopeId: "", domesticIdentitySearchCache: new Map(), domesticResults: new Map(),
    allExplorerProducts: [{ articleNumber: "A", title: "상품A" }], currentExplorerProducts: [],
    selectedExplorerKeys: new Set(),
    $: (key) => { if (!elements.has(key)) elements.set(key, {}); return elements.get(key); },
    updateExplorerSelectionUi: () => {}, domesticKey: (p) => p.articleNumber,
    domesticBatchId: () => "batch", readDomesticBatchProgress: () => undefined,
    restoreDomesticStockResults: async () => {}, clearSavedDomesticStockResults: async () => {},
    searchDomesticAt: async () => ({}), saveDomesticBatchProgress: () => {},
    localStorage: { removeItem: () => {} }, window: { aroundG: {} } };
  await runInNewContext(`${body};runDomesticBatch()`, context);
  assert.equal(context.domesticBatchRunning, false);
  assert.equal(elements.get("#explorer-batch-radar").hidden, true);
  assert.match(elements.get("#domestic-batch-status").textContent, /검색 완료/);
});
