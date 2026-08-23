import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");

test("the main window waits until it is ready instead of exposing a blank surface", () => {
  const createWindow = main.match(/function createWindow\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(createWindow, /show:\s*false/);
  assert.match(createWindow, /once\("ready-to-show"/);
});

test("OneDrive startup backup waits five minutes", () => {
  assert.match(main, /setTimeout\(\(\) => void runOneDriveRecoveryBackup\(\), 5 \* 60 \* 1_000\)/);
});

test("POIZON recovery waits for the manual button before scanning old work", () => {
  const startup = main.match(/configureUpdater\(\);[\s\S]*?app\.on\("activate"/)?.[0] || "";
  assert.doesNotMatch(startup, /startBrandExportFolderPolling\(\)/);
  assert.match(main, /startup-recovery:progress/);
  assert.match(preload, /onStartupRecoveryProgress/);
  assert.match(preload, /startBrandExportFolderPolling/);
  assert.match(html, /id="startup-recovery-run"/);
  assert.match(html, /수동 확인 대기/);
  assert.match(renderer, /startup-recovery-run[\s\S]*runManualPoizonRecovery/);
  assert.match(renderer, /const pendingCount = await recoverInterruptedBrandWorkOnDemand\(\)/);
  assert.match(renderer, /if \(pendingCount\) await window\.aroundG\.startBrandExportFolderPolling\(\)/);
  const initialization = renderer.match(/\(async \(\) => \{[\s\S]*?window\.aroundG\.onBrandSyncProgress/)?.[0] || "";
  assert.doesNotMatch(initialization, /recoverInterruptedBrandWorkOnDemand\(\)/);
  assert.doesNotMatch(initialization, /startBrandExportFolderPolling\(\)/);
});

test("startup recovery is visible with a determinate loading bar", () => {
  assert.match(html, /id="startup-recovery"/);
  assert.match(html, /id="startup-recovery-bar"/);
  assert.match(html, /id="startup-recovery-percent"/);
  assert.match(html, /기존 POIZON 작업 및 변경 사항 확인 · 수동/);
  assert.match(renderer, /function renderStartupRecoveryProgress/);
  assert.match(renderer, /percent:\s*100/);
});

test("manual recovery scans the complete Excel list once", () => {
  const recovery = renderer.match(/async function recoverInterruptedBrandWorkOnDemand\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.equal((recovery.match(/await restoreDownloadedBrandFiles\(\)/g) || []).length, 1);
});

test("a new explicit brand search starts download folder monitoring", () => {
  const handler = renderer.match(/#brand-export-selected[\s\S]*?const selectedLabel/)?.[0] || "";
  assert.match(handler, /startBrandExportFolderPolling/);
});
