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
  assert.match(html, /<span>포이즌 상품정보<\/span>/);
  assert.match(html, /id="brand-cards"/);
});

test("completed download history does not block a new brand search", () => {
  assert.match(renderer, /function hasActiveBrandExportJobs\(\)/);
  assert.match(renderer, /some\(\(job\) => !brandJobIsFinished\(job\?\.state\)\)/);
  assert.match(renderer, /brandSelectionBusy \|\| activeExportBrand \|\| hasActiveBrandExportJobs\(\)/);
  assert.doesNotMatch(renderer, /brandSelectionBusy \|\| activeExportBrand \|\| brandExportJobs\.size\) \{/);
  assert.match(renderer, /window\.aroundG\.beginSellerBrandSearchSession/);
  assert.match(renderer, /brandExportJobs\.clear\(\)/);
  assert.match(preload, /beginSellerBrandSearchSession: \(\) => ipcRenderer\.invoke\("seller:begin-brand-search-session"\)/);
  assert.match(main, /ipcMain\.handle\("seller:begin-brand-search-session"/);
  assert.match(main, /historicalJobCount: savedBrandExportJobs\(\)\.length/);
});

test("brand search click shows progress and never cancels a delayed main-process response", () => {
  assert.match(renderer, /검색 세션 준비 중/);
  assert.match(renderer, /검색 준비 응답 대기 중/);
  assert.match(renderer, /작업은 취소되지 않습니다/);
  assert.match(renderer, /30_000/);
  assert.doesNotMatch(renderer, /BRAND_SESSION_START_TIMEOUT/);
  assert.doesNotMatch(renderer, /Promise\.race\(\[\s*window\.aroundG\.beginSellerBrandSearchSession/);
  assert.match(renderer, /검색 시작 실패/);
  assert.match(renderer, /brandSelectionBusy = false/);
});

test("POIZON product search opens from a working seller page with physical menu clicks", () => {
  const start = main.indexOf("async function automateSellerBrandExport");
  const end = main.indexOf("async function syncBrandCatalogFromKrPoizon", start);
  const workflow = main.slice(start, end);
  assert.match(workflow, /openSellerCenterWindow\(SELLER_CENTER_URL/);
  assert.match(workflow, /deferNavigation: true/);
  assert.match(workflow, /await sellerWindow\.loadURL\(SELLER_CENTER_URL\)/);
  assert.doesNotMatch(main, /SELLER_MAIN_URL/);
  assert.match(workflow, /enterSellerProductSearchViaMenu\(\)/);
  assert.doesNotMatch(main, /SELLER_PRODUCT_SEARCH_URL/);
  assert.doesNotMatch(main, /loadURL\([^\n]*\/main\/goods\/search/);
  assert.match(main, /performPhysicalSellerSortAndExport/);
  assert.match(main, /BACKGROUND_LOCAL_SALES_SORT/);
  assert.match(main, /BACKGROUND_EXPORT/);
  assert.match(main, /PHYSICAL_EXPORT_DOWNLOAD_CENTER_SHORTCUT/);
});

test("seller failure details stay bounded so the brand screen remains responsive", () => {
  assert.match(renderer, /automation\?\.diagnostics\?\.reason/);
  assert.match(renderer, /\.replace\(\/\\s\+\/g, " "\)[\s\S]*?\.slice\(0, 160\)/);
});

test("a new search session preserves history only as a baseline and clears live job ownership", () => {
  const start = main.indexOf('ipcMain.handle("seller:begin-brand-search-session"');
  const end = main.indexOf('ipcMain.handle("seller:abort-brand-export-attempt"', start);
  const session = main.slice(start, end);
  assert.match(session, /brandWorkSessionGeneration \+= 1/);
  assert.match(session, /brandExportJobs\.clear\(\)/);
  assert.doesNotMatch(session, /brandExportJobCache: \[\]/);
});

test("brand workflow clicks the product menus physically and searches English before Korean fallback", () => {
  const start = main.indexOf("async function automateSellerBrandExport");
  const end = main.indexOf("async function syncBrandCatalogFromKrPoizon", start);
  const workflow = main.slice(start, end);
  assert.match(workflow, /openSellerCenterWindow\(SELLER_CENTER_URL/);
  assert.match(workflow, /deferNavigation: true/);
  assert.match(workflow, /sellerWindow\.loadURL\(SELLER_CENTER_URL\)/);
  assert.match(main, /"PHYSICAL_PRODUCT_MENU"/);
  assert.match(main, /"PHYSICAL_PRODUCT_SEARCH_MENU"/);
  assert.match(main, /sellerProductSearchPageState/);
  assert.match(workflow, /typeSellerBrandWithRealKeyboard\(candidate\.frame, sellerBrandSearchName\)/);
  assert.match(workflow, /seller-brand-input-confirmed/);
  assert.doesNotMatch(workflow, /applyExactSellerBrandFilter\(candidate\.frame/);
  assert.doesNotMatch(workflow, /\.\.\.officialAliases/);
  assert.doesNotMatch(workflow, /pageSizePattern|PAGE_SIZE_20|PAGE_SIZE_CONTROL/);
  assert.doesNotMatch(workflow, /20건\/페이지/);
  const realInput = workflow.indexOf("typeSellerBrandWithRealKeyboard(candidate.frame");
  const visibleAfterInput = workflow.indexOf("sellerWindow.showInactive();", realInput);
  const runSearch = workflow.indexOf("runSellerSearch(candidate.frame", realInput);
  const physicalSort = workflow.indexOf("performPhysicalSellerSortAndExport(candidate.frame", runSearch);
  assert.ok(realInput >= 0 && visibleAfterInput > realInput && visibleAfterInput < runSearch);
  assert.ok(physicalSort > runSearch);
  assert.match(main, /"PHYSICAL_SEARCH_BUTTON_CLICKED"/);
  assert.match(workflow, /runSellerSearch\(candidate\.frame, Boolean\(realKeyboardInput\?\.submitted\)\)/);
  assert.match(main, /performPhysicalSellerSortAndExport\(candidate\.frame\)/);
  assert.match(main, /waiting-for-seller-result-navigation/);
  assert.match(main, /document\.readyState === "loading"/);
  assert.match(main, /\$\{step\}_NOT_FOUND/);
  assert.match(main, /"BACKGROUND_LOCAL_SALES_SORT"/);
  assert.match(main, /"BACKGROUND_DESCENDING"/);
  assert.match(main, /"BACKGROUND_SORT_CONFIRM"/);
  assert.match(main, /"BACKGROUND_EXPORT"/);
  assert.match(workflow, /clickSellerDownloadCenterShortcutPhysical\(candidate\.frame\)/);
  assert.match(workflow, /current brand remains in the live Download Center/);
  assert.doesNotMatch(workflow, /confirmSellerExportRequestPhysical\(productFrame\)/);
  assert.match(workflow, /EXPORT_CONFIRMATION_NOT_ACKNOWLEDGED/);
  assert.match(main, /\[mainFrame, targetFrame, \.\.\.sellerWindowFrames\(\)\]/);
  assert.match(main, /\/exportCenter\/i\.test\(href\)/);
  assert.match(main, /const deadline = Date\.now\(\) \+ 30_000/);
  assert.match(main, /PHYSICAL_DOWNLOAD_CENTER/);
  assert.match(main, /navigated: true/);
  assert.match(main, /if \(!alreadySubmitted\) \{/);
  assert.match(workflow, /searchInputAttempt <= 1/);
  assert.doesNotMatch(workflow, /searchInputAttempt <= 4/);
  assert.doesNotMatch(workflow, /검색 입력창 재탐색/);
  assert.doesNotMatch(workflow, /alreadySubmitted && requestedInputConfirmed/);
  assert.match(main, /physicalCursorMoved: true/);
  assert.match(main, /moveWindowsCursorAndClick/);
  assert.match(workflow, /normalizedKey\.length > 3/);
  assert.match(workflow, /tokens\.includes/);
  assert.match(workflow, /sellerBrandSearchName = brandsMatch\(brandName, "On"\) \? "On Running"/);
  assert.match(workflow, /hasRows && brandMatched && requestedInputConfirmed/);
  assert.doesNotMatch(workflow, /brandMatched \|\| \(alreadySubmitted && requestedInputConfirmed\)/);
  assert.match(workflow, /"PUMA", "Puma", "푸마", "彪马"/);
  assert.match(workflow, /"Adidas Originals", "adidas Originals"/);
  assert.match(main, /async function applyExactSellerBrandFilter/);
  assert.doesNotMatch(workflow, /applyExactSellerBrandFilter\(candidate\.frame/);
  assert.doesNotMatch(workflow, /const result = exactBrandFilter/);
  assert.match(main, /route: "EXACT_BRAND_FILTER"/);
  assert.match(main, /async function readSellerExportJobsFreshly/);
  assert.match(workflow, /readSellerExportJobsFreshly\(\)/);
  assert.match(renderer, /orphanedExportRisk = failureCode === "EXPORT_JOB_NOT_CREATED"/);
  assert.match(workflow, /clickSellerDownloadCenterShortcutPhysical\(candidate\.frame\)/);
  assert.match(workflow, /readSellerExportJobs\(\)/);
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

test("daily POIZON search limit stops the remaining brand queue", () => {
  assert.match(renderer, /failureCode === "DAILY_SEARCH_LIMIT_EXCEEDED"/);
  assert.match(renderer, /포이즌 검색 데이터는 하루 20번만 가능합니다\. 오늘 사용 가능 횟수를 초과했습니다\./);
  assert.match(renderer, /brandExportQueue = \[\]/);
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
