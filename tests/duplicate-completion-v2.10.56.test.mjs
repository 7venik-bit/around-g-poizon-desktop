import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("restored Excel paths and job ids are registered as already completed", () => {
  assert.match(renderer, /function brandImportPathKey/);
  assert.match(renderer, /completedBrandImportPaths\.add\(pathKey\)/);
  assert.match(renderer, /completedBrandImportJobIds\.add\(jobId\)/);
  assert.match(renderer, /brandName: String\(file\.brandName \|\| saved\.brandName/);
});

test("one live job can complete only once even when the folder timestamp changes", () => {
  assert.match(renderer, /completedBrandImportJobIds\.has\(resolvedJobId\)/);
  assert.match(renderer, /if \(!resolvedJobId \|\| completedBrandImportJobIds\.has\(resolvedJobId\)\) return/);
  assert.match(renderer, /if \(!registeredBrand\) return/);
  assert.doesNotMatch(renderer, /file\?\.brandName \|\| selectedBrandName/);
});

test("folder polling never reports an unmatched historical file as live completion", () => {
  assert.match(main, /const expectedBrand = folderBrand \|\| brandFromExportFileName\(newest\.name\)/);
  assert.match(main, /if \(!matchedJobId\) return/);
  assert.doesNotMatch(main, /brandFromExportFileName\(newest\.name\) \|\| pendingBrandExportName/);
});

test("completion status exposes a unique completed count", () => {
  assert.match(renderer, /const completionLabel = `완료 \$\{completedJobs\}\/\$\{jobs\.length\}개`/);
});

test("release metadata is 2.10.56", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.56");
  assert.equal(JSON.parse(lockSource).version, "2.10.56");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.56");
});
