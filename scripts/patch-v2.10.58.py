from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def replace_first(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    if old not in source:
        raise RuntimeError(f"{path}: patch target not found")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


main = ROOT / "main.mjs"
preload = ROOT / "preload.cjs"
renderer = ROOT / "src" / "renderer.js"
package = ROOT / "package.json"
lock = ROOT / "package-lock.json"

replace_first(
    main,
    'const SELLER_EXPORT_POLL_INTERVAL_MS = 60 * 1000;\nconst SELLER_MULTI_EXPORT_POLL_INTERVAL_MS = 10 * 1000;\nconst SELLER_EXPORT_MONITOR_TIMEOUT_MS = 60 * 60 * 1000;',
    'const SELLER_EXPORT_POLL_INTERVAL_MS = 60 * 1000;\nconst SELLER_MULTI_EXPORT_POLL_INTERVAL_MS = 10 * 1000;\nconst SELLER_EXPORT_MONITOR_TIMEOUT_MS = 60 * 60 * 1000;\nconst RESTORED_PENDING_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;',
)

replace_first(
    main,
    '''function savedBrandExportJobs() {
  const saved = store?.snapshot()?.settings?.brandExportJobCache;
  return Array.isArray(saved) ? saved : [];
}

async function rememberBrandExportJob''',
    '''function savedBrandExportJobs() {
  const saved = store?.snapshot()?.settings?.brandExportJobCache;
  return Array.isArray(saved) ? saved : [];
}

function restorePendingBrandExportJobs() {
  const cutoff = Date.now() - RESTORED_PENDING_JOB_MAX_AGE_MS;
  for (const saved of savedBrandExportJobs()) {
    const jobId = String(saved?.jobId || "").trim();
    const brandName = String(saved?.brandName || "").trim();
    const createdAt = Number(saved?.createdAt || 0);
    const lastDownloadedAt = Number(saved?.lastDownloadedAt || 0);
    if (!jobId || !brandName || lastDownloadedAt > 0 || createdAt < cutoff) continue;
    brandExportJobs.set(jobId, {
      jobId,
      brandName,
      brandKo: String(saved?.brandKo || "").trim(),
      createdAt,
      expectedProductCount: Number(saved?.expectedProductCount || 0),
      downloadStarted: false,
      downloadRequestedAt: 0,
      restored: true,
    });
  }
  return [...brandExportJobs.entries()].map(([jobId, job]) => ({
    jobId,
    brandName: job.brandName,
    brandKo: job.brandKo || "",
    createdAt: Number(job.createdAt || 0),
    expectedProductCount: Number(job.expectedProductCount || 0),
    restored: Boolean(job.restored),
  }));
}

async function rememberBrandExportJob''',
)

replace_first(
    main,
    '''  if (process.argv.includes("--migrate-only")) {
    app.quit();
    return;
  }

  ipcMain.handle("store:snapshot"''',
    '''  if (process.argv.includes("--migrate-only")) {
    app.quit();
    return;
  }
  restorePendingBrandExportJobs();

  ipcMain.handle("store:snapshot"''',
)

replace_first(
    main,
    '''ipcMain.handle("seller:start-brand-export-monitor", () => {
    scheduleBrandExportMonitor(0);
    return { ok: true, jobs: brandExportJobs.size };
  });
  ipcMain.handle("brand-export:open-file"''',
    '''ipcMain.handle("seller:start-brand-export-monitor", () => {
    if (brandExportJobs.size && (!sellerWindow || sellerWindow.isDestroyed())) {
      openSellerCenterWindow(SELLER_EXPORT_CENTER_URL, { visible: false });
    }
    scheduleBrandExportMonitor(0);
    return { ok: true, jobs: brandExportJobs.size };
  });
  ipcMain.handle("brand-export:pending-jobs", () => restorePendingBrandExportJobs());
  ipcMain.handle("brand-export:open-file"''',
)

replace_first(
    preload,
    '  startSellerBrandExportMonitor: () => ipcRenderer.invoke("seller:start-brand-export-monitor"),\n  openDownloadedBrandFile:',
    '  startSellerBrandExportMonitor: () => ipcRenderer.invoke("seller:start-brand-export-monitor"),\n  listPendingBrandExportJobs: () => ipcRenderer.invoke("brand-export:pending-jobs"),\n  openDownloadedBrandFile:',
)

replace_first(
    renderer,
    '''function recordBrandSelection(brand, action, details = {}) {
  brandSelectionHistory.unshift({''',
    '''async function restorePendingBrandExportJobs() {
  const generation = brandWorkHistoryGeneration;
  const jobs = await window.aroundG?.listPendingBrandExportJobs?.();
  if (!acceptBrandWorkEvents || generation !== brandWorkHistoryGeneration || !Array.isArray(jobs)) return;
  const pending = jobs.filter((job) => String(job?.jobId || "").trim() && String(job?.brandName || "").trim());
  if (!pending.length) return;
  for (const job of pending) {
    updateBrandExportJob(
      job.jobId,
      "재시작 복원 · 다운로드센터 성공 여부 확인 중",
      job.brandName,
    );
  }
  touchBrandActivity(`미다운로드 작업 ${pending.length}개 복원 · POIZON 다운로드센터 감시 재개`);
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `이전 실행의 미다운로드 작업 ${pending.length}개를 복원해 자동 감시를 재개합니다.`;
  await window.aroundG.startSellerBrandExportMonitor();
}

function recordBrandSelection(brand, action, details = {}) {
  brandSelectionHistory.unshift({''',
)

replace_first(
    renderer,
    '''renderBrandCompletedJobs();
void restoreDownloadedBrandFiles();
$("#brand-search").addEventListener''',
    '''renderBrandCompletedJobs();
void restoreDownloadedBrandFiles();
void restorePendingBrandExportJobs();
$("#brand-search").addEventListener''',
)

for path in (package, lock):
    data = json.loads(path.read_text(encoding="utf-8"))
    data["version"] = "2.10.58"
    if path == lock:
        data.setdefault("packages", {}).setdefault("", {})["version"] = "2.10.58"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

for test_path in (ROOT / "tests").glob("*.test.mjs"):
    source = test_path.read_text(encoding="utf-8")
    if "2.10.57" in source:
        test_path.write_text(source.replace("2.10.57", "2.10.58"), encoding="utf-8")

(ROOT / "tests" / "restore-pending-jobs-v2.10.58.test.mjs").write_text(r'''import assert from "node:assert/strict";
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
''', encoding="utf-8")

print("Applied v2.10.58 pending-job restoration patch")
