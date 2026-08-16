import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mainSource = readFileSync(new URL("../main.mjs", import.meta.url), "utf8");

test("completed download is persisted before workbook inspection", () => {
  const completed = mainSource.indexOf("const completedInfo = await stat(filePath)");
  const remembered = mainSource.indexOf("lastDownloadedAt: Date.now()", completed);
  const inspected = mainSource.indexOf("const fileBuffer = await readFile(filePath)", completed);
  assert.ok(completed >= 0);
  assert.ok(remembered > completed);
  assert.ok(inspected > remembered);
});

test("download job cleanup runs unconditionally after completion processing", () => {
  const handler = mainSource.indexOf('item.once("done", (_doneEvent, state) =>');
  const finallyBlock = mainSource.indexOf("}).finally(() => {", handler);
  const deleted = mainSource.indexOf("brandExportJobs.delete(downloadJobId)", finallyBlock);
  const unlock = mainSource.indexOf('activeBrandDownloadJobId = ""', finallyBlock);
  const pathUnlock = mainSource.indexOf("brandDownloadPathsInProgress.delete(filePath)", finallyBlock);
  const monitorResume = mainSource.indexOf("scheduleBrandExportMonitor(500)", finallyBlock);
  assert.ok(handler >= 0);
  assert.ok(finallyBlock > handler);
  assert.ok(deleted > finallyBlock);
  assert.ok(unlock > deleted);
  assert.ok(pathUnlock > unlock);
  assert.ok(monitorResume > pathUnlock);
});

test("completed file inspection errors end polling instead of re-downloading", () => {
  assert.match(mainSource, /파일 다운로드는 완료됐으며 반복 감시를 종료합니다/);
  assert.match(mainSource, /Terminal cleanup is unconditional/);
  assert.match(mainSource, /if \(brandExportJobs\.size\) scheduleBrandExportMonitor\(500\);\s*else emitBrandExportAllComplete\(\);/);
});
