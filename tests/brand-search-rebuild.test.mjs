import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, preload, html] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
]);

test("brand-search UI remains available", () => {
  assert.match(html, /id="brand-export-selected"/);
  assert.match(html, /<span>브랜드 검색<\/span>/);
  assert.match(html, /id="brand-cards"/);
});

test("brand workflow uses the exact Seller Center brand filter with English then Korean fallback", () => {
  const start = main.indexOf("async function automateSellerBrandExport");
  const end = main.indexOf("async function syncBrandCatalogFromKrPoizon", start);
  const workflow = main.slice(start, end);
  assert.match(workflow, /loadURL\(SELLER_PRODUCT_SEARCH_URL\)/);
  assert.match(workflow, /applyExactSellerBrandFilter\(candidate\.frame, \[brandName, brandKo\]\)/);
  assert.match(workflow, /ownText\(element\) === "브랜드"/);
  assert.match(workflow, /BRAND_POPUP_INPUT_NOT_FOUND/);
  assert.match(workflow, /for \(const name of normalizedNames\)/);
  assert.match(workflow, /EXACT_BRAND_FILTER/);
  assert.match(workflow, /brand-filter-applied/);
  assert.doesNotMatch(workflow, /기존 검색 서비스 방식으로 브랜드를 입력/);
});

test("selected brands run sequentially with a twenty-minute limit", () => {
  assert.match(renderer, /const BRAND_AUTOMATION_TIMEOUT_MS = 20 \* 60 \* 1000/);
  assert.match(main, /const SELLER_BRAND_EXPORT_HARD_TIMEOUT_MS = 20 \* 60 \* 1000/);
  assert.match(renderer, /brandExportQueue = selectedBrands\.map/);
  assert.match(renderer, /activeExportBrand = brandExportQueue\.shift\(\)/);
  assert.match(renderer, /setTimeout\(\(\) => exportNextSelectedBrand\(generation\), 400\)/);
});

test("download center tracks each brand by its generated job number", () => {
  assert.match(main, /pendingBrandExportJobId = String\(createdJob\.id/);
  assert.match(main, /const registeredJobId = pendingBrandExportJobId/);
  assert.match(main, /brandExportJobs\.set\(registeredJobId, \{[\s\S]*?brandName,[\s\S]*?brandKo/);
  assert.match(main, /readSellerExportJobsFromMonitor\(\)/);
  assert.match(main, /jobId: registeredJobId/);
});

test("successful downloads use job number, brand, and timestamp", () => {
  assert.match(main, /\`\$\{downloadJobId\}_\$\{safeBrand\}_\$\{localFileTimestamp\(\)\}\.xlsx\`/);
  assert.match(main, /status: "download-started"/);
  assert.match(main, /state === "completed"/);
});

test("renderer and preload expose only the rebuilt execution path", () => {
  assert.match(renderer, /window\.aroundG\.automateSellerBrandExport/);
  assert.match(preload, /automateSellerBrandExport: \(input\) => ipcRenderer\.invoke\("seller:brand-export", input\)/);
});
