from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


main = ROOT / "main.mjs"
renderer = ROOT / "src" / "renderer.js"
index = ROOT / "src" / "index.html"
style = ROOT / "src" / "style.css"
package = ROOT / "package.json"
lock = ROOT / "package-lock.json"

replace_once(
    main,
    'let brandExportMonitorRunning = false;\nlet activeBrandDownloadJobId = "";',
    'let brandExportMonitorRunning = false;\nlet brandExportMonitorRestartTimer;\nlet activeBrandDownloadJobId = "";',
)

replace_once(
    main,
    'const SELLER_EXPORT_POLL_INTERVAL_MS = 60 * 1000;\nconst SELLER_EXPORT_MONITOR_TIMEOUT_MS = 60 * 60 * 1000;',
    'const SELLER_EXPORT_POLL_INTERVAL_MS = 60 * 1000;\nconst SELLER_MULTI_EXPORT_POLL_INTERVAL_MS = 10 * 1000;\nconst SELLER_EXPORT_MONITOR_TIMEOUT_MS = 60 * 60 * 1000;',
)

replace_once(
    main,
    '''async function watchAllSellerExportJobsEveryTenSeconds() {
  if (brandExportMonitorRunning) return { ok: true, jobs: brandExportJobs.size };
  brandExportMonitorRunning = true;
  const startedAt = Date.now();
  const timeoutMs = SELLER_EXPORT_MONITOR_TIMEOUT_MS;
  const pollIntervalMs = SELLER_EXPORT_POLL_INTERVAL_MS;''',
    '''function scheduleBrandExportMonitor(delayMs = 0) {
  if (!brandExportJobs.size || brandExportMonitorRunning) return;
  if (brandExportMonitorRestartTimer) clearTimeout(brandExportMonitorRestartTimer);
  brandExportMonitorRestartTimer = setTimeout(() => {
    brandExportMonitorRestartTimer = null;
    if (!brandExportJobs.size || brandExportMonitorRunning) return;
    void watchAllSellerExportJobsEveryTenSeconds();
  }, Math.max(0, Number(delayMs) || 0));
}

async function watchAllSellerExportJobsEveryTenSeconds() {
  if (brandExportMonitorRunning) return { ok: true, jobs: brandExportJobs.size };
  brandExportMonitorRunning = true;
  const startedAt = Date.now();
  const timeoutMs = SELLER_EXPORT_MONITOR_TIMEOUT_MS;
  const pollIntervalMs = SELLER_MULTI_EXPORT_POLL_INTERVAL_MS;''',
)

replace_once(
    main,
    '''          brandExportJobs.delete(downloadJobId);
          if (activeBrandDownloadJobId === downloadJobId) activeBrandDownloadJobId = "";
          brandDownloadPathsInProgress.delete(filePath);
          brandDownloadStarted = false;
          return;''',
    '''          brandExportJobs.delete(downloadJobId);
          if (activeBrandDownloadJobId === downloadJobId) activeBrandDownloadJobId = "";
          brandDownloadPathsInProgress.delete(filePath);
          brandDownloadStarted = false;
          if (brandExportJobs.size) scheduleBrandExportMonitor(500);
          return;''',
)

replace_once(
    main,
    '''      brandExportJobs.delete(downloadJobId);
      if (activeBrandDownloadJobId === downloadJobId) activeBrandDownloadJobId = "";
      brandDownloadPathsInProgress.delete(filePath);
      brandDownloadStarted = false;
    });''',
    '''      brandExportJobs.delete(downloadJobId);
      if (activeBrandDownloadJobId === downloadJobId) activeBrandDownloadJobId = "";
      brandDownloadPathsInProgress.delete(filePath);
      brandDownloadStarted = false;
      if (brandExportJobs.size) scheduleBrandExportMonitor(500);
      else {
        mainWindow?.webContents.send("brand-export:progress", {
          status: "all-complete",
          jobState: "모든 작업 확인완료",
          message: "선택한 브랜드의 POIZON 원본 Excel 다운로드와 프로그램 등록이 모두 완료되었습니다.",
        });
      }
    });''',
)

replace_once(
    main,
    '''  } finally {
    brandExportMonitorRunning = false;
  }
  return { ok: true, jobs: brandExportJobs.size };
}''',
    '''  } catch (error) {
    mainWindow?.webContents.send("brand-export:progress", {
      status: "monitor-recovering",
      jobState: "다운로드센터 감시 자동 복구 중",
      message: `POIZON 다운로드센터 감시 오류를 자동 복구합니다: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    brandExportMonitorRunning = false;
    if (brandExportJobs.size) scheduleBrandExportMonitor(3_000);
    else {
      mainWindow?.webContents.send("brand-export:progress", {
        status: "all-complete",
        jobState: "모든 작업 확인완료",
        message: "선택한 브랜드의 POIZON 원본 Excel 다운로드와 프로그램 등록이 모두 완료되었습니다.",
      });
    }
  }
  return { ok: true, jobs: brandExportJobs.size };
}''',
)

replace_once(
    main,
    '''      ipcMain.handle("seller:start-brand-export-monitor", () => {
        void watchAllSellerExportJobsEveryTenSeconds();
        return { ok: true, jobs: brandExportJobs.size };
      });''',
    '''      ipcMain.handle("seller:start-brand-export-monitor", () => {
        scheduleBrandExportMonitor(0);
        return { ok: true, jobs: brandExportJobs.size };
      });''',
)

replace_once(
    main,
    '''  if (brandExportPollTimer) clearInterval(brandExportPollTimer);
  if (updateCheckTimer) clearTimeout(updateCheckTimer);''',
    '''  if (brandExportPollTimer) clearInterval(brandExportPollTimer);
  if (brandExportMonitorRestartTimer) clearTimeout(brandExportMonitorRestartTimer);
  if (updateCheckTimer) clearTimeout(updateCheckTimer);''',
)

replace_once(
    renderer,
    '''function renderBrandExportJobs() {
  const list = $("#brand-export-jobs-list");
  if (!list) return;
  const now = Date.now();
  list.innerHTML = [...brandExportJobs.entries()]
    .map(([id, job]) => {
      const finished = brandJobIsFinished(job.state);
      const stateClass = /실패|오류|중단|취소/.test(String(job.state || ""))
        ? " is-error"
        : finished ? " is-success" : " is-running";
      const running = finished ? "" : '<span class="brand-export-job-spinner" aria-hidden="true"></span>';
      const elapsed = finished ? "" : ` · ${brandActivityDuration(now - Number(job.startedAt || now))}`;
      return `<div class="brand-export-job-row${stateClass}"><strong>${text(job.brandName)}</strong><code>작업번호 ${text(id)}</code><span class="brand-export-job-state">${running}${text(job.state)}${text(elapsed)}</span></div>`;
    })
    .join("");
}''',
    '''function renderBrandCompletedJobs() {
  const panel = $("#brand-export-completed");
  const list = $("#brand-export-completed-list");
  const count = $("#brand-export-completed-count");
  if (!panel || !list || !count) return;
  const seen = new Set();
  const completed = downloadedBrandFiles.filter((file) => {
    const key = String(file.jobId || "").trim() || brandImportPathKey(file.path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  panel.hidden = completed.length === 0;
  count.textContent = `${completed.length}개`;
  list.innerHTML = completed.map((file) => `
    <div class="brand-export-completed-row">
      <strong>${text(file.brandName || "선택 브랜드")}</strong>
      <code>${file.jobId ? `작업번호 ${text(file.jobId)}` : "작업번호 확인 불가"}</code>
      <time>${text(brandTime(file.time))}</time>
      <span>확인완료</span>
    </div>`).join("");
}

function renderBrandExportJobs() {
  const panel = $("#brand-export-job");
  const list = $("#brand-export-jobs-list");
  if (!list) return;
  const now = Date.now();
  const activeEntries = [...brandExportJobs.entries()].filter(([_id, job]) => !brandJobIsDownloaded(job.state));
  if (panel) panel.hidden = activeEntries.length === 0;
  list.innerHTML = activeEntries
    .map(([id, job]) => {
      const finished = brandJobIsFinished(job.state);
      const stateClass = /실패|오류|중단|취소/.test(String(job.state || ""))
        ? " is-error"
        : finished ? " is-success" : " is-running";
      const running = finished ? "" : '<span class="brand-export-job-spinner" aria-hidden="true"></span>';
      const elapsed = finished ? "" : ` · ${brandActivityDuration(now - Number(job.startedAt || now))}`;
      return `<div class="brand-export-job-row${stateClass}"><strong>${text(job.brandName)}</strong><code>작업번호 ${text(id)}</code><span class="brand-export-job-state">${running}${text(job.state)}${text(elapsed)}</span></div>`;
    })
    .join("");
  renderBrandCompletedJobs();
}''',
)

replace_once(
    renderer,
    '''  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));
  renderDownloadedBrandFiles();
  renderBrandCards($("#brand-filter")?.value || "");
}''',
    '''  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));
  renderDownloadedBrandFiles();
  renderBrandCompletedJobs();
  renderBrandCards($("#brand-filter")?.value || "");
}''',
)

replace_once(
    renderer,
    '''  $("#brand-export-job").hidden = true;
  $("#brand-export-jobs-list").innerHTML = "";
  renderDownloadedBrandFiles();
  renderBrandWorkbench();''',
    '''  $("#brand-export-job").hidden = true;
  $("#brand-export-jobs-list").innerHTML = "";
  renderDownloadedBrandFiles();
  renderBrandCompletedJobs();
  renderBrandWorkbench();''',
)

replace_once(
    renderer,
    '''  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));
  renderDownloadedBrandFiles();
  renderBrandCards($("#brand-filter")?.value || "");
}

function recordBrandSelection''',
    '''  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));
  renderDownloadedBrandFiles();
  renderBrandCompletedJobs();
  renderBrandCards($("#brand-filter")?.value || "");
}

function recordBrandSelection''',
)

replace_once(
    renderer,
    '''window.aroundG.onBrandExportProgress((progress) => {
  if (!acceptBrandWorkEvents) return;
  updateBrandExportJob(progress?.jobId, progress?.jobState || "자동 감시 중", progress?.brandName);
  touchBrandActivity(progress?.jobState || progress?.message || "POIZON 작업 진행 중");
  $("#brand-status").className = "status";
  $("#brand-status").textContent = progress?.message || "다운로드를 시작했습니다.";
});''',
    '''window.aroundG.onBrandExportProgress((progress) => {
  if (!acceptBrandWorkEvents) return;
  if (progress?.status === "all-complete") {
    renderBrandExportJobs();
    renderBrandCompletedJobs();
    const unfinished = [...brandExportJobs.values()].some((job) => !brandJobIsFinished(job.state));
    if (!unfinished && !detectedBrandImportRunning && !detectedBrandImportQueue.length) stopBrandActivity();
    $("#brand-status").className = "status success";
    $("#brand-status").textContent = progress?.message || "모든 작업이 확인완료되었습니다.";
    return;
  }
  updateBrandExportJob(progress?.jobId, progress?.jobState || "자동 감시 중", progress?.brandName);
  touchBrandActivity(progress?.jobState || progress?.message || "POIZON 작업 진행 중");
  $("#brand-status").className = progress?.status === "monitor-recovering" ? "status error" : "status";
  $("#brand-status").textContent = progress?.message || "다운로드를 시작했습니다.";
});''',
)

replace_once(
    renderer,
    '''renderDownloadedBrandFiles();
void restoreDownloadedBrandFiles();''',
    '''renderDownloadedBrandFiles();
renderBrandCompletedJobs();
void restoreDownloadedBrandFiles();''',
)

replace_once(
    index,
    '''          <div id="brand-export-job" class="brand-export-job" hidden>
            <div id="brand-export-jobs-list" class="brand-export-jobs-list"></div>
          </div>''',
    '''          <div id="brand-export-job" class="brand-export-job" hidden>
            <div class="brand-export-job-heading"><strong>진행 중·대기 작업</strong></div>
            <div id="brand-export-jobs-list" class="brand-export-jobs-list"></div>
          </div>
          <section id="brand-export-completed" class="brand-export-completed" hidden aria-label="확인완료 작업 목록">
            <div class="brand-export-completed-heading"><strong>확인완료 목록</strong><span id="brand-export-completed-count">0개</span></div>
            <div id="brand-export-completed-list" class="brand-export-completed-list"></div>
          </section>''',
)

style.write_text(style.read_text(encoding="utf-8") + '''

.brand-export-job-heading,
.brand-export-completed-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  font-size: 13px;
  color: #244267;
}
.brand-export-completed {
  margin-top: 10px;
  border: 1px solid #b9dfd1;
  border-radius: 12px;
  overflow: hidden;
  background: #f3fbf8;
}
.brand-export-completed-heading { border-bottom: 1px solid #d3eee5; }
.brand-export-completed-heading span { font-weight: 800; color: #13815c; }
.brand-export-completed-list { display: grid; }
.brand-export-completed-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(180px, 1.2fr) minmax(150px, .9fr) 90px;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-top: 1px solid #e0f2eb;
  font-size: 13px;
}
.brand-export-completed-row:first-child { border-top: 0; }
.brand-export-completed-row code { color: #22568c; font-weight: 700; }
.brand-export-completed-row time { color: #6a7888; }
.brand-export-completed-row > span {
  justify-self: end;
  border-radius: 999px;
  padding: 5px 11px;
  background: #d7f1e7;
  color: #087653;
  font-weight: 800;
}
@media (max-width: 900px) {
  .brand-export-completed-row { grid-template-columns: 1fr 1fr; }
  .brand-export-completed-row > span { justify-self: start; }
}
''', encoding="utf-8")

for path in (package, lock):
    data = json.loads(path.read_text(encoding="utf-8"))
    data["version"] = "2.10.57"
    if path == lock:
        data.setdefault("packages", {}).setdefault("", {})["version"] = "2.10.57"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

for test_path in (ROOT / "tests").glob("*.test.mjs"):
    source = test_path.read_text(encoding="utf-8")
    if "2.10.56" in source:
        test_path.write_text(source.replace("2.10.56", "2.10.57"), encoding="utf-8")

new_test = ROOT / "tests" / "monitor-recovery-completed-list-v2.10.57.test.mjs"
new_test.write_text('''import assert from "node:assert/strict";
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
  assert.match(main, /status: "monitor-recovering"/);
  assert.match(main, /if \(brandExportJobs\.size\) scheduleBrandExportMonitor\(3_000\)/);
});

test("finishing a download continues remaining jobs and emits all-complete", () => {
  assert.match(main, /if \(brandExportJobs\.size\) scheduleBrandExportMonitor\(500\)/);
  assert.match(main, /status: "all-complete"/);
  assert.match(main, /모든 작업 확인완료/);
});

test("completed downloads render in a separate persistent list", () => {
  assert.match(html, /id="brand-export-completed"/);
  assert.match(html, /id="brand-export-completed-list"/);
  assert.match(renderer, /function renderBrandCompletedJobs/);
  assert.match(renderer, /downloadedBrandFiles\.filter/);
  assert.match(renderer, /progress\?\.status === "all-complete"/);
});

test("release metadata is 2.10.57", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.57");
  assert.equal(JSON.parse(lockSource).version, "2.10.57");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.57");
});
''', encoding="utf-8")

print("Applied v2.10.57 monitor recovery and completed-list patch")
