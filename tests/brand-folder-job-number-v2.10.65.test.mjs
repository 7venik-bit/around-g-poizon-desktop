import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("new downloads use brand and POIZON job number in the folder name", () => {
  assert.match(main, /function brandExportFolderName/);
  assert.ok(main.includes('const safeJobId = String(jobId || "").replace(/[^0-9]/g, "").trim();'));
  assert.match(main, /return safeJobId \? `\$\{safeBrand\}_\$\{safeJobId\}` : safeBrand/);
  assert.match(main, /join\(folder, brandExportFolderName\(exportBrand, downloadJobId\)\)/);
  assert.match(main, /join\(folder, brandExportFolderName\(detectedBrand, downloadJobId\)\)/);
});

test("folder job number is restored before the legacy cache and old brand-only folders remain supported", () => {
  assert.match(main, /function parseBrandExportFolderName/);
  assert.ok(main.includes('const matched = normalized.match(/^(.*)_([0-9]{7,})$/);'));
  assert.ok(main.includes(': { brandName: normalized, jobId: "" };'));
  assert.match(main, /folderMeta\.jobId \|\| savedJob\?\.jobId/);
  assert.match(main, /folderMeta\.brandName \|\| brandFromExportFileName/);
  assert.match(main, /folderJobId \|\| \(matchingJobs\.length === 1/);
});

test("release metadata is 2.10.240", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.240");
  assert.equal(JSON.parse(lockSource).version, "2.10.240");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.240");
});
