import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findNewSellerExportJob } from "../services/brand-export-jobs.mjs";

const [mainSource, rendererSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);

test("every selected brand creates a fresh POIZON export job", () => {
  const start = mainSource.indexOf("async function automateSellerBrandExport");
  const end = mainSource.indexOf("async function syncBrandCatalogFromKrPoizon", start);
  const workflow = mainSource.slice(start, end);

  assert.match(workflow, /const baselineJobs = await readStableSellerExportJobs\(\)/);
  assert.match(workflow, /code: "EXPORT_CENTER_BASELINE_UNAVAILABLE"/);
  assert.match(workflow, /if \(Array\.isArray\(currentJobs\)\) \{/);
  assert.match(workflow, /createdJob = findNewSellerExportJob\(\[\.\.\.baselineJobIds\], currentJobs\)/);
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

test("an unreadable export center does not block real brand work", () => {
  const readStart = mainSource.indexOf("async function readSellerExportJobs");
  const readEnd = mainSource.indexOf("function normalizeBrandExportKey", readStart);
  const reader = mainSource.slice(readStart, readEnd);

  assert.match(reader, /catch\(\(\) => null\)/);
  assert.match(reader, /snapshot\?\.ready/);
  assert.match(reader, /stableReads >= 2/);
  assert.doesNotMatch(reader, /catch\(\(\) => \[\]\)/);
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
