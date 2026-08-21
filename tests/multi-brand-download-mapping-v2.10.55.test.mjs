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


test("a completed job removed during download cannot be selected again by a stale status snapshot", () => {
  assert.match(main, /return Boolean\(job\)[\s\S]*status\.state === "READY"/);
  assert.match(main, /status\.jobNumberMatched/);
  assert.match(main, /status\.workSucceeded/);
  assert.match(main, /status\.completionConfirmed/);
  assert.match(main, /const currentJob = brandExportJobs\.get\(ready\.jobId\)/);
  assert.match(main, /if \(!currentJob\) continue/);
});


test("release metadata is 2.10.327", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.327");
  assert.equal(JSON.parse(lockSource).version, "2.10.327");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.327");
});
