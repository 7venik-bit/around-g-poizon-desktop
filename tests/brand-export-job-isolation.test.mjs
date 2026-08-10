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

