import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findNewSellerExportJob } from "../services/brand-export-jobs.mjs";

const [mainSource, rendererSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);

test("every selected brand creates a fresh POIZON export job without a blocking baseline", () => {
  const start = mainSource.indexOf("async function automateSellerBrandExport");
  const end = mainSource.indexOf("async function syncBrandCatalogFromKrPoizon", start);
  const workflow = mainSource.slice(start, end);

  assert.match(workflow, /const baselinePromise = readSellerExportBaselineSeparately\(\)\.catch\(\(\) => null\)/);
  assert.match(workflow, /const baselineAvailable = Array\.isArray\(baselineJobs\)/);
  assert.match(workflow, /unusedJobs = currentJobs\.filter\(\(job\) => !brandExportJobOwner\(job\?\.id\)\)/);
  assert.match(workflow, /const candidate = findNewSellerExportJob\(\[\.\.\.baselineJobIds\], unusedJobs\)/);
  assert.match(workflow, /fallbackCandidateStableReads >= 2/);
  assert.doesNotMatch(workflow, /EXPORT_CENTER_BASELINE_UNAVAILABLE/);
  assert.doesNotMatch(workflow, /findReusableSellerExportJob|job-reused|reusableJob/);
});

test("an old latest row is never mistaken for a newly created job", () => {
  const before = [{ id: "1004730935", text: "Jordan 처리 중" }];
  assert.equal(findNewSellerExportJob(before, before), null);
  assert.equal(findNewSellerExportJob(before, [{ id: "1004730935", text: "Jordan 성공" }]), null);

  const created = findNewSellerExportJob(before, [
    { id: "1004731042", text: "Converse 처리 중" },
    ...before,
  ]);
  assert.equal(created?.id, "1004731042");
});

test("an existing job number cannot be assigned to another brand", () => {
  assert.match(mainSource, /const existingOwner = brandExportJobOwner\(registeredJobId\)/);
  assert.match(mainSource, /code: "EXPORT_JOB_ID_REUSED"/);
  assert.match(mainSource, /기존 작업번호 \$\{registeredJobId\}/);
});

test("an unreadable export center falls back without blocking real brand work", () => {
  const readStart = mainSource.indexOf("const SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT");
  const readEnd = mainSource.indexOf("function normalizeBrandExportKey", readStart);
  const reader = mainSource.slice(readStart, readEnd);
  const workStart = mainSource.indexOf("async function automateSellerBrandExport");
  const workEnd = mainSource.indexOf("async function syncBrandCatalogFromKrPoizon", workStart);
  const workflow = mainSource.slice(workStart, workEnd);

  assert.match(reader, /readSellerExportJobsFromWindow/);
  assert.match(reader, /framesInSubtree/);
  assert.match(reader, /return ready \|\| jobsById\.size \? \[\.\.\.jobsById\.values\(\)\] : null/);
  assert.match(reader, /async function readSellerExportBaselineSeparately/);
  assert.match(workflow, /baseline-fallback/);
  assert.match(workflow, /작업번호 후행 확인 방식/);
  assert.doesNotMatch(workflow, /EXPORT_CENTER_BASELINE_UNAVAILABLE/);
});

test("renderer never sends old brand job numbers for reuse", () => {
  const start = rendererSource.indexOf("async function exportNextSelectedBrand");
  const end = rendererSource.indexOf("function retainSelectedBrandName", start);
  const workflow = rendererSource.slice(start, end);

  assert.doesNotMatch(workflow, /knownJobIds|automation\.reused|alreadySuccessful/);
});

test("brand search mismatch is explained and stops before export registration", () => {
  assert.match(mainSource, /BRAND_RESULT_MISMATCH: `\$\{label\} 검색 결과가 확인되지 않아 내보내기를 중단했습니다/);
  assert.match(mainSource, /SEARCH_RESULT_NOT_UPDATED: `\$\{label\} 검색 결과가 새로 바뀌지 않아 내보내기를 중단했습니다/);
});

test("seller brand search is restored to the v2.10.81 input and search service", () => {
  assert.doesNotMatch(mainSource, /async function applyExactSellerBrandSearch/);
  assert.doesNotMatch(mainSource, /EXACT_SELLER_SEARCH_FAILED/);
  assert.match(mainSource, /applyValue\(""\)/);
  assert.match(mainSource, /applyValue\(\$\{JSON\.stringify\(brandName\)\}\)/);
  assert.match(mainSource, /input\.dispatchEvent\(new Event\("input"/);
  assert.match(mainSource, /input\.dispatchEvent\(new Event\("change"/);
  assert.match(mainSource, /const searchApplied = await waitForSearchUpdate|let searchApplied = await waitForSearchUpdate/);
  assert.match(mainSource, /const narrowed = current\.totalCount/);
  assert.match(mainSource, /searchInputAttempt <= 4/);
  assert.match(mainSource, /SELLER_SEARCH_STAGE_TIMEOUT/);
});

test("the restored search service reopens the product-search page up to four times", () => {
  assert.match(mainSource, /if \(!sellerWindow\.webContents\.getURL\(\)\.includes\("\/main\/goods\/search"\)\)/);
  assert.match(mainSource, /검색 입력창 재탐색 \$\{searchInputAttempt\}\/4/);
  assert.match(mainSource, /if \(searchInputAttempt < 4\)/);
});
