import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, html, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("multi-brand monitor polls every ten seconds and self-recovers", () => {
  assert.match(main, /SELLER_MULTI_EXPORT_POLL_INTERVAL_MS = 10 \* 1000/);
  assert.match(main, /function scheduleBrandExportMonitor/);
  assert.match(main, /const pollIntervalMs = SELLER_MULTI_EXPORT_POLL_INTERVAL_MS/);
  assert.match(main, /status: "monitor-recovering"/);
  assert.match(main, /if \(brandExportJobs\.size\) scheduleBrandExportMonitor\(3_000\)/);
});

test("finishing a download continues remaining jobs and emits all-complete", () => {
  assert.match(main, /if \(brandExportJobs\.size\) scheduleBrandExportMonitor\(500\)/);
  assert.match(main, /status: "all-complete"/);
  assert.match(main, /모든 작업 확인완료/);
  assert.match(main, /ipcMain\.handle\("seller:start-brand-export-monitor"[\s\S]*?scheduleBrandExportMonitor\(0\)/);
});

test("completed downloads render in a separate persistent list", () => {
  assert.match(html, /id="brand-export-completed"/);
  assert.match(html, /id="brand-export-completed-list"/);
  assert.match(html, /id="brand-export-completed-count"/);
  assert.match(renderer, /function renderBrandCompletedJobs/);
  assert.match(renderer, /const completed = downloadedBrandFiles\.filter/);
  assert.match(renderer, /const activeEntries = \[\.\.\.brandExportJobs\.entries\(\)\]\.filter/);
  assert.match(renderer, /renderBrandCompletedJobs\(\);/);
  assert.match(renderer, /progress\?\.status === "all-complete"/);
});

test("all-complete stops the activity only after renderer imports finish", () => {
  assert.match(renderer, /!detectedBrandImportRunning && !detectedBrandImportQueue\.length/);
  assert.match(renderer, /if \(!unfinished && !detectedBrandImportRunning && !detectedBrandImportQueue\.length\) stopBrandActivity\(\)/);
});

test("release metadata is 2.10.61", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.61");
  assert.equal(JSON.parse(lockSource).version, "2.10.61");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.61");
});
