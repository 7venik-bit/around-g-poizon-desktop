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

test("completed download history does not block a new brand search", () => {
  assert.match(renderer, /function hasActiveBrandExportJobs\(\)/);
  assert.match(renderer, /some\(\(job\) => !brandJobIsFinished\(job\?\.state\)\)/);
  assert.match(renderer, /brandSelectionBusy \|\| activeExportBrand \|\| hasActiveBrandExportJobs\(\)/);
  assert.doesNotMatch(renderer, /brandSelectionBusy \|\| activeExportBrand \|\| brandExportJobs\.size\) \{/);
  assert.match(renderer, /await window\.aroundG\.beginSellerBrandSearchSession/);
  assert.match(renderer, /brandExportJobs\.clear\(\)/);
  assert.match(preload, /beginSellerBrandSearchSession: \(\) => ipcRenderer\.invoke\("seller:begin-brand-search-session"\)/);
  assert.match(main, /ipcMain\.handle\("seller:begin-brand-search-session"/);
  assert.match(main, /historicalJobCount: savedBrandExportJobs\(\)\.length/);
});

test("a new search session preserves history only as a baseline and clears live job ownership", () => {
  const start = main.indexOf('ipcMain.handle("seller:begin-brand-search-session"');
  const end = main.indexOf('ipcMain.handle("seller:abort-brand-export-attempt"', start);
  const session = main.slice(start, end);
  assert.match(session, /brandWorkSessionGeneration \+= 1/);
  assert.match(session, /brandExportJobs\.clear\(\)/);
  assert.doesNotMatch(session, /brandExportJobCache: \[\]/);
});

test("brand workflow connects directly and searches English before Korean fallback", () => {
  const start = main.indexOf("async function automateSellerBrandExport");
  const end = main.indexOf("async function syncBrandCatalogFromKrPoizon", start);
  const workflow = main.slice(start, end);
  assert.match(workflow, /loadURL\(SELLER_PRODUCT_SEARCH_URL\)/);
  const english = workflow.indexOf("applyValue(${JSON.stringify(brandName)})");
  const korean = workflow.indexOf("applyValue(${JSON.stringify(brandKoInput)})");
  assert.ok(english >= 0 && korean > english);
  assert.match(workflow, /if \(!searchApplied[\s\S]*brandKoInput/);
  assert.match(workflow, /typeSellerBrandWithRealKeyboard\(candidate\.frame, brandName\)/);
  assert.match(workflow, /seller-brand-input-confirmed/);
  assert.doesNotMatch(workflow, /\.\.\.officialAliases/);
  assert.doesNotMatch(workflow, /pageSizePattern|PAGE_SIZE_20|PAGE_SIZE_CONTROL/);
  assert.doesNotMatch(workflow, /20건\/페이지/);
  const realInput = workflow.indexOf("typeSellerBrandWithRealKeyboard(candidate.frame");
  const minimizeAfterInput = workflow.indexOf("sellerWindow.minimize();", realInput);
  const runSearch = workflow.indexOf("runSellerSearch(candidate.frame", realInput);
  const physicalSort = workflow.indexOf("performPhysicalSellerSortAndExport(candidate.frame", runSearch);
  assert.ok(realInput >= 0 && minimizeAfterInput > realInput && minimizeAfterInput < runSearch);
  assert.ok(physicalSort > runSearch);
  assert.match(main, /"REAL_SEARCH_BUTTON_CLICKED"/);
  assert.match(main, /runSellerSearch\(candidate\.frame, Boolean\(realKeyboardInput\?\.submitted\)\)/);
  assert.match(main, /performPhysicalSellerSortAndExport\(candidate\.frame\)/);
  assert.match(main, /waiting-for-seller-result-navigation/);
  assert.match(main, /\[targetFrame, sellerWindow\.webContents\.mainFrame, \.\.\.sellerWindowFrames\(\)\]/);
  assert.match(main, /document\.readyState === "loading"/);
  assert.match(main, /\$\{step\}_NOT_FOUND_AFTER_NAVIGATION/);
  assert.match(main, /"PHYSICAL_LOCAL_SALES_SORT"/);
  assert.match(main, /"PHYSICAL_DESCENDING"/);
  assert.match(main, /"PHYSICAL_SORT_CONFIRM"/);
  assert.match(main, /"PHYSICAL_EXPORT"/);
  assert.doesNotMatch(workflow, /clickSellerDownloadCenterShortcutPhysical\(productFrame\)/);
  assert.match(workflow, /Keep the registration window on product search/);
  assert.doesNotMatch(workflow, /confirmSellerExportRequestPhysical\(productFrame\)/);
  assert.doesNotMatch(workflow, /EXPORT_CONFIRMATION_NOT_ACKNOWLEDGED/);
  assert.match(main, /\[mainFrame, targetFrame, \.\.\.sellerWindowFrames\(\)\]/);
  assert.match(main, /\/exportCenter\/i\.test\(href\)/);
  assert.match(main, /const deadline = Date\.now\(\) \+ 30_000/);
  assert.match(main, /PHYSICAL_DOWNLOAD_CENTER/);
  assert.match(main, /navigated: true/);
  assert.match(main, /if \(!alreadySubmitted\) \{/);
  assert.match(workflow, /searchInputAttempt <= 1/);
  assert.doesNotMatch(workflow, /searchInputAttempt <= 4/);
  assert.doesNotMatch(workflow, /검색 입력창 재탐색/);
  assert.match(workflow, /alreadySubmitted && requestedInputConfirmed/);
  assert.match(main, /step: physicalClick\.ok \? "PHYSICAL_SEARCH_BUTTON_CLICKED"/);
  assert.match(main, /SetCursorPos/);
  assert.match(main, /for \(\$step = 1; \$step -le 18; \$step\+\+\)/);
  assert.match(main, /execFile\("powershell\.exe"/);
  assert.match(main, /sendInputEvent\(\{ type: "mouseDown", button: "left"/);
  assert.match(workflow, /normalizedKey\.length > 3/);
  assert.match(workflow, /tokens\.includes/);
});

test("selected brands run sequentially with a twenty-minute limit", () => {
  assert.match(renderer, /const BRAND_AUTOMATION_TIMEOUT_MS = 20 \* 60 \* 1000/);
  assert.match(main, /const SELLER_BRAND_EXPORT_HARD_TIMEOUT_MS = 20 \* 60 \* 1000/);
  assert.match(renderer, /brandExportQueue = selectedBrands\.map/);
  assert.match(renderer, /activeExportBrand = brandExportQueue\.shift\(\)/);
  assert.match(renderer, /await exportNextSelectedBrand\(generation\)/);
  assert.doesNotMatch(renderer, /setTimeout\(\(\) => exportNextSelectedBrand\(generation\), 400\)/);
  assert.match(renderer, /const BRAND_INPUT_RETRY_DELAY_MS = 60 \* 1000/);
  assert.match(renderer, /const BRAND_INPUT_RETRY_LIMIT = 2/);
  assert.match(renderer, /brandExportQueue\.unshift\(\{/);
  assert.match(renderer, /retryAfter: Date\.now\(\) \+ BRAND_INPUT_RETRY_DELAY_MS/);
  assert.match(renderer, /return \[\.\.\.selectedBrandIds\]/);
  assert.match(renderer, /완료 전에는 다음 브랜드로 이동하지 않습니다/);
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
