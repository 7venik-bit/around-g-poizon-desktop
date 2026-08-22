import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findNewSellerExportJob } from "../services/brand-export-jobs.mjs";

const [mainSource, rendererSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);


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

test("only a job created after final export confirmation can own the brand", () => {
  const finalExportAt = new Date(2026, 7, 22, 12, 0, 29).getTime();
  const previousPumaJob = {
    id: "1004852560",
    startAtMs: new Date(2026, 7, 21, 13, 28, 23).getTime(),
    text: "PUMA 성공",
  };
  const newKolonJob = {
    id: "1004859014",
    startAtMs: new Date(2026, 7, 22, 12, 0, 35).getTime(),
    text: "KOLON SPORT 처리 중",
  };
  const options = { notBeforeMs: finalExportAt, allowedClockSkewMs: 2 * 60_000 };

  assert.equal(findNewSellerExportJob([], [previousPumaJob], options), null);
  assert.equal(findNewSellerExportJob([], [previousPumaJob, newKolonJob], options)?.id, "1004859014");
  assert.equal(findNewSellerExportJob([], [{ id: "1004859999" }], options), null);
});

test("the export job baseline is frozen before product search and export", () => {
  const baselineAwait = mainSource.indexOf("let baselineJobs = await baselinePromise");
  const searchStart = mainSource.indexOf("const sellerBrandAliasGroups", baselineAwait);
  const exportClick = mainSource.indexOf("performPhysicalSellerSortAndExport", searchStart);
  assert.ok(baselineAwait >= 0 && searchStart > baselineAwait && exportClick > searchStart);
  assert.match(mainSource, /readSellerExportJobsFromMonitor\(\)/);
  assert.doesNotMatch(
    mainSource.slice(exportClick, mainSource.indexOf("const completeness", exportClick)),
    /await baselinePromise/,
  );
});

test("the final export confirmation freezes a fresh baseline and enforces its timestamp", () => {
  assert.match(mainSource, /finalExportBaselineJobs = await readSellerExportBaselineSeparately\(\)/);
  assert.match(mainSource, /exportAcknowledgedAt = confirmationStartedAt/);
  assert.match(mainSource, /notBeforeMs: exportAcknowledgedAt/);
  assert.match(mainSource, /allowedClockSkewMs: 2 \* 60_000/);
  assert.match(mainSource, /startAtMs/);
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
