import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, preload, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);


test("restored jobs are rebuilt as safe non-downloading jobs", () => {
  assert.match(main, /downloadStarted: false/);
  assert.match(main, /downloadRequestedAt: 0/);
  assert.match(main, /restored: true/);
  assert.match(main, /expectedProductCount: Number\(saved\?\.expectedProductCount \|\| 0\)/);
});

test("manual recovery checks completed files before resuming interrupted downloads", () => {
  assert.match(main, /async function findDownloadedFileForPendingBrandExport/);
  assert.match(main, /const completedFile = await findDownloadedFileForPendingBrandExport\(saved, entries\)/);
  assert.match(main, /프로그램 시작 복구 · 기존 Excel 확인완료/);
  assert.match(renderer, /async function recoverInterruptedBrandWorkOnDemand/);
  const manualRecovery = renderer.match(/async function recoverInterruptedBrandWorkOnDemand\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const fileCheck = manualRecovery.indexOf("await restoreDownloadedBrandFiles()");
  const pendingCheck = manualRecovery.indexOf("await restorePendingBrandExportJobs()");
  assert.ok(fileCheck >= 0);
  assert.ok(pendingCheck > fileCheck);
  assert.match(renderer, /const pendingCount = await recoverInterruptedBrandWorkOnDemand\(\)/);
});



test("release metadata is 2.10.378", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.378");
  assert.equal(JSON.parse(lockSource).version, "2.10.378");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.378");
});
