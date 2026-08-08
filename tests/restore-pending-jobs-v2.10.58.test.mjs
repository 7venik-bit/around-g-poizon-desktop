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
  assert.match(main, /const lastDownloadedAt = Number\(saved\?\.lastDownloadedAt \|\| 0\)/);
  assert.match(main, /if \(!jobId \|\| !brandName \|\| lastDownloadedAt > 0 \|\| createdAt < cutoff\) continue/);
  assert.match(main, /restorePendingBrandExportJobs\(\);[\s\S]*ipcMain\.handle\("store:snapshot"/);
});

test("restored jobs are rebuilt as safe non-downloading jobs", () => {
  assert.match(main, /downloadStarted: false/);
  assert.match(main, /downloadRequestedAt: 0/);
  assert.match(main, /restored: true/);
  assert.match(main, /expectedProductCount: Number\(saved\?\.expectedProductCount \|\| 0\)/);
});

test("restored jobs reopen Seller Center and restart monitoring", () => {
  assert.match(main, /ipcMain\.handle\("brand-export:pending-jobs"/);
  assert.match(main, /brandExportJobs\.size && \(!sellerWindow \|\| sellerWindow\.isDestroyed\(\)\)/);
  assert.match(main, /openSellerCenterWindow\(SELLER_EXPORT_CENTER_URL, \{ visible: false \}\)/);
  assert.match(main, /scheduleBrandExportMonitor\(0\)/);
  assert.match(preload, /listPendingBrandExportJobs: \(\) => ipcRenderer\.invoke\("brand-export:pending-jobs"\)/);
});

test("renderer rebuilds pending rows before restarting monitor", () => {
  assert.match(renderer, /async function restorePendingBrandExportJobs/);
  assert.match(renderer, /재시작 복원 · 다운로드센터 성공 여부 확인 중/);
  assert.match(renderer, /미다운로드 작업 \$\{pending\.length\}개 복원/);
  assert.match(renderer, /void restorePendingBrandExportJobs\(\)/);
  assert.match(renderer, /await window\.aroundG\.startSellerBrandExportMonitor\(\)/);
});

test("release metadata is 2.10.92", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.92");
  assert.equal(JSON.parse(lockSource).version, "2.10.92");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.92");
});
