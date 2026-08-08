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

test("seller brand search accepts changed results without requiring a lower total count", () => {
  assert.doesNotMatch(mainSource, /const narrowed = current\.totalCount/);
  assert.match(mainSource, /\(changed \|\| searchRequestObserved\(\)\) && hasRows && resultBelongsToRequest/);
  assert.match(mainSource, /const inputHasRequestedBrand = \(\) =>/);
  assert.match(mainSource, /const submittedRequestedBrand = inputHasRequestedBrand\(\)/);
  assert.match(mainSource, /const exactProductSearchHint =/);
  assert.match(mainSource, /const sameContainer = Boolean\(inputForm && inputForm\.contains\(element\)\)/);
});

test("each brand starts on a fresh seller product-search page and retries stale results", () => {
  assert.match(mainSource, /Every brand starts from a fresh product-search document/);
  assert.match(mainSource, /await sellerWindow\.loadURL\(SELLER_PRODUCT_SEARCH_URL\);/);
  assert.match(mainSource, /const retryableStaleResult = \["BRAND_INPUT_NOT_APPLIED", "BRAND_RESULT_MISMATCH", "SEARCH_RESULT_NOT_UPDATED"\]/);
  assert.match(mainSource, /검색 응답이 확인되지 않아 상품검색 화면을 새로 열고 실제 입력 방식으로 재시도합니다/);
  assert.match(mainSource, /sellerWindow\.webContents\.insertText\(brandName\)/);
  assert.match(mainSource, /type: "mouseDown"/);
  assert.match(mainSource, /type: "mouseUp"/);
  assert.match(mainSource, /keyCode: "ENTER"/);
  assert.match(mainSource, /__aroundgSearchResourceBaseline/);
  assert.match(mainSource, /prepared\.inputVerified = verifiedInput\.found && verifiedInput\.value === brandName/);
  assert.match(mainSource, /검색어 검증 완료 · 검색 실행 확인 중/);
  assert.doesNotMatch(mainSource, /실제 검색어 입력 완료/);
  assert.match(mainSource, /SELLER_SECURITY_CHECK_REQUIRED/);
  assert.match(mainSource, /searchRequestObserved/);
});
