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

test("startup recovery owns the poller order and reports real file progress", () => {
  const startup = main.match(/configureUpdater\(\);[\s\S]*?app\.on\("activate"/)?.[0] || "";
  assert.doesNotMatch(startup, /startBrandExportFolderPolling\(\)/);
  assert.match(main, /startup-recovery:progress/);
  assert.match(preload, /onStartupRecoveryProgress/);
  assert.match(preload, /startBrandExportFolderPolling/);
  assert.match(renderer, /await recoverInterruptedBrandWorkAtStartup\(\)[\s\S]*finally \{[\s\S]*await window\.aroundG\.startBrandExportFolderPolling\(\)/);
});

test("startup recovery is visible with a determinate loading bar", () => {
  assert.match(html, /id="startup-recovery"/);
  assert.match(html, /id="startup-recovery-bar"/);
  assert.match(html, /id="startup-recovery-percent"/);
  assert.match(renderer, /function renderStartupRecoveryProgress/);
  assert.match(renderer, /percent:\s*100/);
});

test("startup recovery does not scan the complete Excel list twice", () => {
  const recovery = renderer.match(/async function recoverInterruptedBrandWorkAtStartup\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.equal((recovery.match(/await restoreDownloadedBrandFiles\(\)/g) || []).length, 1);
});
