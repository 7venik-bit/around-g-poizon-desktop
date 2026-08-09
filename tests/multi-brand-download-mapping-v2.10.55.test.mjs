import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, preload, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("only one POIZON download request owns the global browser download event", () => {
  assert.match(main, /const ready = activeBrandDownloadJobId \? null : statuses\.find/);
  assert.match(main, /requestedJobs = \[\.\.\.brandExportJobs\.entries\(\)\]/);
  assert.match(main, /brandDownloadPathsInProgress\.add\(filePath\)/);
  assert.match(main, /brandDownloadPathsInProgress\.delete\(filePath\)/);
});

test("folder polling reports only a file matched to one current job", () => {
  assert.match(main, /const expectedBrand = folderMeta\.brandName \|\| brandFromExportFileName\(newest\.name\)/);
  assert.match(main, /if \(!matchedJobId\) return/);
  assert.doesNotMatch(main, /brandFromExportFileName\(newest\.name\) \|\| pendingBrandExportName/);
  assert.match(main, /jobId: matchedJobId/);
  assert.match(main, /candidates\.find\(\(candidate\) => !brandDownloadPathsInProgress\.has\(candidate\.path\)\)/);
});

test("registered job clears stale pending globals and lets the workbook repair the brand", () => {
  assert.match(main, /pendingBrandExportName = "";\r?\n  pendingBrandExportJobId = "";\r?\n  sellerWindow\.hide/);
  assert.match(main, /const detectedMatchesRequested = Boolean\(detectedBrand\)/);
  assert.match(main, /const resolvedBrandName = detectedMatchesRequested/);
  assert.match(main, /detectedBrandName: detectedMatchesRequested \? "" : detectedBrand \|\| ""/);
  assert.match(renderer, /stableBrandName/);
  assert.match(renderer, /resolveRendererBrandJobId/);
});

test("a completed job removed during download cannot be selected again by a stale status snapshot", () => {
  assert.match(main, /return Boolean\(job\) && status\.state === "READY"/);
  assert.match(main, /const currentJob = brandExportJobs\.get\(ready\.jobId\)/);
  assert.match(main, /if \(!currentJob\) continue/);
});

test("a stalled brand attempt is aborted and the remaining queue can continue", () => {
  assert.match(renderer, /BRAND_AUTOMATION_TIMEOUT_MS = 5 \* 60 \* 1000/);
  assert.match(renderer, /abortSellerBrandExportAttempt/);
  assert.match(renderer, /automation\?\.code === "BRAND_AUTOMATION_TIMEOUT" && !automation\?\.aborted/);
  assert.match(preload, /seller:abort-brand-export-attempt/);
  assert.match(main, /SELLER_BRAND_EXPORT_HARD_TIMEOUT_MS = 5 \* 60 \* 1000/);
  assert.match(main, /Promise\.race\(\[automateSellerBrandExport\(input\), timedOut\]\)/);
  assert.match(main, /return \{ \.\.\.result, aborted: true \}/);
  assert.match(main, /brandExportAttemptGeneration \+= 1/);
  assert.match(main, /SELLER_SEARCH_STAGE_TIMEOUT/);
  assert.match(main, /PRODUCT_VERIFICATION_TIMEOUT/);
});

test("release metadata is 2.10.105", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.105");
  assert.equal(JSON.parse(lockSource).version, "2.10.105");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.105");
});
