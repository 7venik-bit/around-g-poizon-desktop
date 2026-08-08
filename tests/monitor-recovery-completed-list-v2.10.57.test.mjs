import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, rendererSource, html, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);
const renderer = rendererSource.replace(/\r\n/g, "\n");

test("multi-brand monitor polls every ten seconds and self-recovers", () => {
  assert.match(main, /SELLER_MULTI_EXPORT_POLL_INTERVAL_MS = 10 \* 1000/);
  assert.match(main, /function scheduleBrandExportMonitor/);
  assert.match(main, /const pollIntervalMs = SELLER_MULTI_EXPORT_POLL_INTERVAL_MS/);
  assert.match(main, /status: "monitor-recovering"/);
  assert.match(main, /if \(brandExportJobs\.size\) scheduleBrandExportMonitor\(3_000\)/);
});

test("finishing a download continues remaining jobs and emits all-complete", () => {
  assert.match(main, /if \(brandExportJobs\.size\) scheduleBrandExportMonitor\(500\)/);
  assert.match(main, /function emitBrandExportAllComplete/);
  assert.match(main, /status: "all-complete"/);
  assert.match(main, /모든 작업 확인완료/);
  assert.match(main, /ipcMain\.handle\("seller:start-brand-export-monitor"[\s\S]*?scheduleBrandExportMonitor\(0\)/);
});

test("completed downloads render in a separate persistent list", () => {
  assert.match(html, /id="brand-export-completed"/);
  assert.match(html, /id="brand-export-completed-list"/);
  assert.match(html, /id="brand-export-completed-count"/);
  assert.match(html, /id="brand-export-completed-latest"/);
  assert.match(html, /id="brand-export-completed-more"/);
  assert.match(renderer, /function renderBrandCompletedJobs/);
  assert.match(renderer, /const completed = downloadedBrandFiles\.filter/);
  assert.match(renderer, /brandGroups\.slice\(0, 3\)/);
  assert.match(renderer, /이전 기록 \$\{file\.historyCount\}건/);
  const completedRenderer = renderer.match(
    /function renderBrandCompletedJobs\(\) \{[\s\S]*?\n}\n\nfunction renderBrandExportJobs/
  )?.[0] || "";
  assert.doesNotMatch(completedRenderer, />확인완료<\/span>/);
  assert.match(renderer, /const activeEntries = \[\.\.\.brandExportJobs\.entries\(\)\]\.filter/);
  assert.match(renderer, /renderBrandCompletedJobs\(\);/);
  assert.match(renderer, /progress\?\.status === "all-complete"/);
});

test("all-complete stops activity only after the final renderer import drains", () => {
  assert.match(renderer, /let brandMainAllComplete = false/);
  const finalizer = renderer.match(
    /function finalizeBrandActivityAfterMainCompletion\(\) \{[\s\S]*?\n}\n\nfunction normalizeBrandKey/
  )?.[0] || "";
  assert.ok(finalizer);
  assert.match(finalizer, /detectedBrandImportRunning \|\| detectedBrandImportQueue\.length/);
  assert.match(finalizer, /stopBrandActivity\(\)/);
  assert.match(renderer, /else finalizeBrandActivityAfterMainCompletion\(\)/);
  assert.match(renderer, /brandMainAllComplete = true/);
});

test("release metadata is 2.10.95", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.95");
  assert.equal(JSON.parse(lockSource).version, "2.10.95");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.95");
});
