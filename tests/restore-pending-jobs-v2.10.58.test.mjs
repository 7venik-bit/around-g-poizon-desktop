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

test("startup restores only recent jobs that were not downloaded", () => {
  assert.match(main, /RESTORED_PENDING_JOB_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(main, /function restorePendingBrandExportJobs/);
  assert.match(main, /lastDownloadedAt > 0 \|\| createdAt < cutoff/);
  assert.match(main, /restorePendingBrandExportJobs\(\);[\s\S]*ipcMain\.handle\("store:snapshot"/);
});

test("restored jobs reopen Seller Center and restart monitoring", () => {
  assert.match(main, /ipcMain\.handle\("brand-export:pending-jobs"/);
  assert.match(main, /openSellerCenterWindow\(SELLER_EXPORT_CENTER_URL, \{ visible: false \}\)/);
  assert.match(main, /scheduleBrandExportMonitor\(0\)/);
  assert.match(preload, /listPendingBrandExportJobs/);
});

test("renderer rebuilds pending rows before restarting monitor", () => {
  assert.match(renderer, /async function restorePendingBrandExportJobs/);
  assert.match(renderer, /재시작 복원 · 다운로드센터 성공 여부 확인 중/);
  assert.match(renderer, /void restorePendingBrandExportJobs\(\)/);
  assert.match(renderer, /await window\.aroundG\.startSellerBrandExportMonitor\(\)/);
});

test("release metadata is 2.10.58", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.58");
  assert.equal(JSON.parse(lockSource).version, "2.10.58");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.58");
});
