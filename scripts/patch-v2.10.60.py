from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return path.read_text(encoding="utf-8")


def write(path, source):
    path.write_text(source, encoding="utf-8")


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one exact match, found {count}")
    return source.replace(old, new, 1)


def regex_once(source, pattern, replacement, label, flags=re.S):
    updated, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return updated


main_path = ROOT / "main.mjs"
renderer_path = ROOT / "src" / "renderer.js"
html_path = ROOT / "src" / "index.html"
style_path = ROOT / "src" / "style.css"
package_path = ROOT / "package.json"
lock_path = ROOT / "package-lock.json"

main = read(main_path)
renderer = read(renderer_path)
html = read(html_path)
style = read(style_path)

main = replace_once(
    main,
    'let sellerWindow;\nconst inventoryWindows = new Set();',
    'let sellerWindow;\nlet sellerMonitorWindow;\nconst inventoryWindows = new Set();',
    "seller monitor variable",
)

monitor_helpers = r'''
function ensureSellerMonitorWindow() {
  if (sellerMonitorWindow && !sellerMonitorWindow.isDestroyed()) return sellerMonitorWindow;
  sellerMonitorWindow = new BrowserWindow({
    icon: APP_ICON_PATH,
    show: false,
    skipTaskbar: true,
    width: 1360,
    height: 860,
    title: "POIZON 다운로드 감시 · Around G",
    backgroundColor: "#ffffff",
    webPreferences: {
      partition: "persist:around-g-poizon-seller",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  sellerMonitorWindow.on("closed", () => {
    sellerMonitorWindow = null;
    if (brandExportJobs.size) scheduleBrandExportMonitor(3_000);
  });
  sellerMonitorWindow.loadURL(SELLER_EXPORT_CENTER_URL);
  return sellerMonitorWindow;
}

function sellerMonitorFrames() {
  if (!sellerMonitorWindow || sellerMonitorWindow.isDestroyed()) return [];
  const mainFrame = sellerMonitorWindow.webContents.mainFrame;
  return [mainFrame, ...(mainFrame.framesInSubtree || [])]
    .filter((frame, index, all) => all.findIndex((candidate) => candidate.routingId === frame.routingId) === index);
}

const SELLER_MONITOR_STATUS_PRIORITY = {
  PAGE_NOT_READY: 0,
  WAITING_FOR_ROW: 1,
  WAITING_FOR_SUCCESS: 2,
  PROCESSING: 3,
  WAITING_FOR_DOWNLOAD: 4,
  READY: 5,
};

async function readSellerMonitorStatuses(expectedIds = []) {
  const monitor = ensureSellerMonitorWindow();
  if (!monitor.webContents.getURL().includes("/main/exportCenter")) {
    await monitor.loadURL(SELLER_EXPORT_CENTER_URL);
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const merged = new Map(expectedIds.map((jobId) => [jobId, { jobId, state: "WAITING_FOR_ROW" }]));
  const frames = sellerMonitorFrames();
  for (const frame of frames) {
    const statuses = await Promise.race([
      frame.executeJavaScript(`(() => {
        const expectedIds = ${JSON.stringify(expectedIds)};
        const visible = (element) => element && element.getClientRects().length > 0;
        const textOf = (element) => String(element?.innerText || element?.textContent || "")
          .replace(/\\s+/g, " ").trim();
        const rows = [...document.querySelectorAll(
          "tbody tr, [role='row'], tr, [data-row-key], [class*='table'] [class*='row'], [class*='list'] [class*='item']"
        )].filter(visible);
        return expectedIds.map((jobId) => {
          const row = rows.find((candidate) => textOf(candidate).includes(jobId));
          if (!row) return { jobId, state: "WAITING_FOR_ROW" };
          const rowText = textOf(row);
          if (/처리\\s*중|processing|pending/i.test(rowText)) return { jobId, state: "PROCESSING" };
          if (!/성공|completed|success/i.test(rowText)) return { jobId, state: "WAITING_FOR_SUCCESS" };
          const control = [...row.querySelectorAll("a, button, [role='button']")].find((element) => {
            if (!visible(element) || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
            return /다운로드|download/i.test([
              textOf(element), element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("href"),
            ].filter(Boolean).join(" "));
          });
          let href = String(control?.href || control?.getAttribute?.("href") || "");
          try {
            if (href && !/^javascript:/i.test(href)) href = new URL(href, location.href).href;
          } catch {}
          return { jobId, state: control ? "READY" : "WAITING_FOR_DOWNLOAD", href };
        });
      })()`, true),
      new Promise((resolve) => setTimeout(() => resolve([]), 5_000)),
    ]).catch(() => []);
    for (const status of Array.isArray(statuses) ? statuses : []) {
      const previous = merged.get(status.jobId);
      if (!previous || SELLER_MONITOR_STATUS_PRIORITY[status.state] > SELLER_MONITOR_STATUS_PRIORITY[previous.state]) {
        merged.set(status.jobId, { ...status, frameRoutingId: frame.routingId });
      }
    }
  }
  return expectedIds.map((jobId) => merged.get(jobId) || { jobId, state: "PAGE_NOT_READY" });
}

async function requestSellerMonitorDownload(jobId = "", preferredFrameRoutingId = null) {
  const frames = sellerMonitorFrames();
  const ordered = preferredFrameRoutingId === null
    ? frames
    : [...frames].sort((left, right) => Number(right.routingId === preferredFrameRoutingId) - Number(left.routingId === preferredFrameRoutingId));
  for (const frame of ordered) {
    const result = await frame.executeJavaScript(`(() => {
      const jobId = ${JSON.stringify(String(jobId))};
      const visible = (element) => element && element.getClientRects().length > 0;
      const textOf = (element) => String(element?.innerText || element?.textContent || "").replace(/\\s+/g, " ").trim();
      const rows = [...document.querySelectorAll(
        "tbody tr, [role='row'], tr, [data-row-key], [class*='table'] [class*='row'], [class*='list'] [class*='item']"
      )].filter(visible);
      const row = rows.find((candidate) => textOf(candidate).includes(jobId));
      const control = [...(row?.querySelectorAll("a, button, [role='button']") || [])].find((element) =>
        visible(element) && /다운로드|download/i.test([
          textOf(element), element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("href"),
        ].filter(Boolean).join(" "))
      );
      if (!control) return { clicked: false, href: "" };
      let href = String(control.href || control.getAttribute("href") || "");
      try {
        if (href && !/^javascript:/i.test(href)) href = new URL(href, location.href).href;
      } catch {}
      if (/^https:\\/\\//i.test(href)) return { clicked: true, href };
      control.scrollIntoView({ block: "center", inline: "center" });
      control.focus();
      if (typeof control.click === "function") control.click();
      return { clicked: true, href: "" };
    })()`, true).catch(() => ({ clicked: false, href: "" }));
    if (result?.clicked) return result;
  }
  return { clicked: false, href: "" };
}

'''
main = replace_once(
    main,
    'function scheduleBrandExportMonitor(delayMs = 0) {',
    monitor_helpers + 'function scheduleBrandExportMonitor(delayMs = 0) {',
    "monitor helpers insertion",
)

new_watch = r'''async function watchAllSellerExportJobsEveryTenSeconds() {
  if (brandExportMonitorRunning) return { ok: true, jobs: brandExportJobs.size };
  brandExportMonitorRunning = true;
  const startedAt = Date.now();
  const timeoutMs = SELLER_EXPORT_MONITOR_TIMEOUT_MS;
  const pollIntervalMs = SELLER_MULTI_EXPORT_POLL_INTERVAL_MS;
  try {
    while (brandExportJobs.size && Date.now() - startedAt < timeoutMs) {
      const expectedIds = [...brandExportJobs.keys()];
      const statuses = await readSellerMonitorStatuses(expectedIds);
      for (const status of statuses) {
        const job = brandExportJobs.get(status.jobId);
        if (!job) continue;
        const stateLabel = {
          WAITING_FOR_ROW: "4단계/5 · 작업번호 행 확인 중",
          PROCESSING: "4단계/5 · POIZON 파일 처리 중 · 10초마다 감시",
          WAITING_FOR_SUCCESS: "4단계/5 · POIZON 처리 완료 대기 중",
          WAITING_FOR_DOWNLOAD: "4단계/5 · 다운로드 버튼 대기",
          PAGE_NOT_READY: "4단계/5 · 다운로드센터 프레임 확인 중",
          READY: "4단계/5 · 처리 성공 · 다운로드 시작",
        }[status.state] || status.state;
        mainWindow?.webContents.send("brand-export:progress", {
          status: "monitoring",
          monitorSource: "dedicated-window",
          brandName: job.brandName,
          jobId: status.jobId,
          jobState: stateLabel,
          message: `${job.brandName} · 작업번호 ${status.jobId} · ${stateLabel}`,
        });
      }

      const now = Date.now();
      if (activeBrandDownloadJobId) {
        const activeJob = brandExportJobs.get(activeBrandDownloadJobId);
        const requestAge = now - Number(activeJob?.downloadRequestedAt || now);
        if (!activeJob || (!activeJob.downloadStarted && requestAge >= 120_000)) {
          if (activeJob) {
            activeJob.downloadRequestedAt = 0;
            activeJob.downloadStarted = false;
          }
          activeBrandDownloadJobId = "";
        }
      }
      const ready = activeBrandDownloadJobId ? null : statuses.find((status) => {
        const job = brandExportJobs.get(status.jobId);
        return status.state === "READY" && !job?.downloadStarted && !job?.downloadRequestedAt;
      });
      if (ready) {
        const job = brandExportJobs.get(ready.jobId);
        activeBrandDownloadJobId = ready.jobId;
        job.downloadRequestedAt = Date.now();
        const action = await requestSellerMonitorDownload(ready.jobId, ready.frameRoutingId);
        if (action?.href) ensureSellerMonitorWindow().webContents.downloadURL(action.href);
        if (!action?.clicked) {
          job.downloadRequestedAt = 0;
          job.downloadStarted = false;
          if (activeBrandDownloadJobId === ready.jobId) activeBrandDownloadJobId = "";
          mainWindow?.webContents.send("brand-export:progress", {
            status: "monitoring",
            monitorSource: "dedicated-window",
            brandName: job.brandName,
            jobId: ready.jobId,
            jobState: "4단계/5 · 다운로드 버튼 재탐색",
            message: `${job.brandName} · 작업번호 ${ready.jobId} · 모든 다운로드센터 프레임에서 버튼을 다시 찾습니다.`,
          });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const monitor = ensureSellerMonitorWindow();
      if (!monitor.webContents.getURL().includes("/main/exportCenter")) {
        await monitor.loadURL(SELLER_EXPORT_CENTER_URL);
      } else {
        await monitor.webContents.reloadIgnoringCache();
      }
    }
  } catch (error) {
    mainWindow?.webContents.send("brand-export:progress", {
      status: "monitor-recovering",
      monitorSource: "dedicated-window",
      jobState: "다운로드센터 감시 자동 복구 중",
      message: `전용 감시 창 오류를 3초 후 자동 복구합니다: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    brandExportMonitorRunning = false;
    if (brandExportJobs.size) scheduleBrandExportMonitor(3_000);
    else {
      mainWindow?.webContents.send("brand-export:progress", {
        status: "all-complete",
        monitorSource: "dedicated-window",
        jobState: "모든 작업 확인완료",
        message: "선택한 브랜드의 POIZON 원본 Excel 다운로드와 프로그램 등록이 모두 완료되었습니다.",
      });
    }
  }
  return { ok: true, jobs: brandExportJobs.size };
}

const SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT'''
main = regex_once(
    main,
    r'async function watchAllSellerExportJobsEveryTenSeconds\(\) \{[\s\S]*?\n\}\n\nconst SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT',
    new_watch,
    "replace multi-brand watcher",
)

main = regex_once(
    main,
    r'ipcMain\.handle\("seller:start-brand-export-monitor", \(\) => \{[\s\S]*?return \{ ok: true, jobs: brandExportJobs\.size \};\n\s*\}\);',
    '''ipcMain.handle("seller:start-brand-export-monitor", () => {
    if (brandExportJobs.size && (!sellerWindow || sellerWindow.isDestroyed())) {
      openSellerCenterWindow(SELLER_EXPORT_CENTER_URL, { visible: false });
    }
    if (brandExportJobs.size) ensureSellerMonitorWindow();
    scheduleBrandExportMonitor(0);
    return { ok: true, jobs: brandExportJobs.size };
  });''',
    "start monitor handler",
)

# Renderer batch state model.
renderer = replace_once(
    renderer,
    'let brandExportFailureCount = 0;\nconst BRAND_AUTOMATION_TIMEOUT_MS = 5 * 60 * 1000;',
    'let brandExportFailureCount = 0;\nlet brandBatchTotal = 0;\nconst brandBatchStates = new Map();\nconst BRAND_AUTOMATION_TIMEOUT_MS = 5 * 60 * 1000;',
    "batch state variables",
)

batch_functions = r'''
function brandBatchKey(value = "") {
  return normalizeBrandKey(value) || String(value || "").trim().toLocaleLowerCase();
}

function updateBrandBatchState(brandName = "", state = "등록 대기", jobId = "") {
  const key = brandBatchKey(brandName);
  if (!key) return;
  const previous = brandBatchStates.get(key) || {};
  brandBatchStates.set(key, {
    brandName: String(brandName || previous.brandName || "선택 브랜드").trim(),
    state: String(state || previous.state || "등록 대기"),
    jobId: String(jobId || previous.jobId || "").trim(),
    updatedAt: Date.now(),
  });
  renderBrandBatchProgress();
}

function renderBrandBatchProgress() {
  const panel = $("#brand-batch-progress");
  const summary = $("#brand-batch-summary");
  const list = $("#brand-batch-list");
  if (!panel || !summary || !list) return;
  const items = [...brandBatchStates.values()];
  const total = Math.max(brandBatchTotal, items.length);
  const completed = items.filter((item) => /확인완료/.test(item.state)).length;
  const failed = items.filter((item) => /실패|오류|중단|취소/.test(item.state)).length;
  const registered = items.filter((item) => Boolean(item.jobId)).length;
  const processing = items.filter((item) => item.jobId && !/확인완료|실패|오류|중단|취소/.test(item.state)).length;
  panel.hidden = total === 0;
  summary.textContent = `등록 ${registered}/${total} · 처리 중 ${processing} · 완료 ${completed} · 실패 ${failed}`;
  list.innerHTML = items.map((item) => {
    const stateClass = /확인완료/.test(item.state) ? " is-complete"
      : /실패|오류|중단|취소/.test(item.state) ? " is-error"
        : item.jobId ? " is-processing" : " is-registering";
    return `<div class="brand-batch-row${stateClass}"><strong>${text(item.brandName)}</strong><code>${item.jobId ? `작업번호 ${text(item.jobId)}` : "작업번호 생성 전"}</code><span>${text(item.state)}</span></div>`;
  }).join("");
}

'''
renderer = replace_once(
    renderer,
    'function renderBrandCompletedJobs() {',
    batch_functions + 'function renderBrandCompletedJobs() {',
    "batch render functions",
)

renderer = replace_once(
    renderer,
    '  renderBrandCompletedJobs();\n}\n\nfunction renderBrandActivity()',
    '  renderBrandCompletedJobs();\n  renderBrandBatchProgress();\n}\n\nfunction renderBrandActivity()',
    "render batch with jobs",
)

renderer = replace_once(
    renderer,
    '  brandExportFailureCount = 0;\n  // Snapshot the exact brands shown as selected.',
    '''  brandExportFailureCount = 0;
  brandBatchTotal = selectedBrands.length;
  brandBatchStates.clear();
  selectedBrands.forEach((brand) => updateBrandBatchState(brand.name, "등록 대기"));
  // Snapshot the exact brands shown as selected.''',
    "initialize batch state",
)

renderer = replace_once(
    renderer,
    '  touchBrandActivity(`${activeExportBrand.name} · 실제 상품검색 실행 중`);',
    '  updateBrandBatchState(activeExportBrand.name, "상품검색·내보내기 등록 중");\n  touchBrandActivity(`${activeExportBrand.name} · 실제 상품검색 실행 중`);',
    "mark active registration",
)

renderer = replace_once(
    renderer,
    '    brandExportFailureCount += 1;\n    activeExportBrand = null;',
    '    brandExportFailureCount += 1;\n    updateBrandBatchState(failedBrandName, `실패 · ${failureCode || "자동화 오류"}`);\n    activeExportBrand = null;',
    "mark failed brand",
)

renderer = replace_once(
    renderer,
    '    updateBrandExportJob(automation.jobId, "3단계/5 · 작업번호 생성 완료 · 처리 대기", activeExportBrand.name);',
    '    updateBrandExportJob(automation.jobId, "3단계/5 · 작업번호 생성 완료 · 처리 대기", activeExportBrand.name);\n    updateBrandBatchState(activeExportBrand.name, "작업 생성 · POIZON 처리 대기", automation.jobId);',
    "mark registered brand",
)

renderer = replace_once(
    renderer,
    '  updateBrandExportJob(file?.jobId, "확인완료", file?.brandName);',
    '  updateBrandExportJob(file?.jobId, "확인완료", file?.brandName);\n  updateBrandBatchState(expectedBrand, "확인완료", jobId);',
    "mark completed brand",
)

renderer = replace_once(
    renderer,
    '  updateBrandExportJob(progress?.jobId, progress?.jobState || "자동 감시 중", progress?.brandName);',
    '  updateBrandExportJob(progress?.jobId, progress?.jobState || "자동 감시 중", progress?.brandName);\n  if (progress?.brandName) updateBrandBatchState(progress.brandName, progress?.jobState || "자동 감시 중", progress?.jobId);',
    "progress updates batch",
)

renderer = replace_once(
    renderer,
    '  updateBrandExportJob(error?.jobId, error?.jobState || "데이터 가져오기 실패", error?.brandName);',
    '  updateBrandExportJob(error?.jobId, error?.jobState || "데이터 가져오기 실패", error?.brandName);\n  if (error?.brandName) updateBrandBatchState(error.brandName, error?.jobState || "데이터 가져오기 실패", error?.jobId);',
    "error updates batch",
)

renderer = replace_once(
    renderer,
    '  brandExportJobs.clear();\n  stopBrandActivity();',
    '  brandExportJobs.clear();\n  brandBatchTotal = 0;\n  brandBatchStates.clear();\n  renderBrandBatchProgress();\n  stopBrandActivity();',
    "clear batch state",
)

renderer = replace_once(
    renderer,
    '  for (const job of pending) {\n    updateBrandExportJob(',
    '  brandBatchTotal = Math.max(brandBatchTotal, pending.length);\n  for (const job of pending) {\n    updateBrandBatchState(job.brandName, "재시작 복원 · 다운로드센터 확인 중", job.jobId);\n    updateBrandExportJob(',
    "restore pending batch state",
)

html = replace_once(
    html,
    '''          <div id="brand-export-job" class="brand-export-job" hidden>
            <div id="brand-export-jobs-list" class="brand-export-jobs-list"></div>
          </div>''',
    '''          <section id="brand-batch-progress" class="brand-batch-progress" hidden aria-live="polite">
            <div class="brand-batch-progress-head"><strong>복수 브랜드 진행 현황</strong><span id="brand-batch-summary"></span></div>
            <div id="brand-batch-list" class="brand-batch-list"></div>
          </section>
          <div id="brand-export-job" class="brand-export-job" hidden>
            <div id="brand-export-jobs-list" class="brand-export-jobs-list"></div>
          </div>''',
    "batch progress html",
)

style += r'''

.brand-batch-progress{margin:12px 0;border:1px solid #c8daf7;border-radius:14px;background:#f7fbff;overflow:hidden}
.brand-batch-progress-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #dce8f8;color:#183d70}
.brand-batch-progress-head span{font-weight:800;color:#1769c2}
.brand-batch-list{display:grid;gap:1px;background:#dce8f8}
.brand-batch-row{display:grid;grid-template-columns:minmax(120px,1fr) minmax(190px,1fr) minmax(260px,2fr);gap:12px;align-items:center;padding:11px 14px;background:#fff;color:#31445e}
.brand-batch-row code{font-family:inherit;color:#225a9d;font-weight:700}
.brand-batch-row span{text-align:right;font-weight:700}
.brand-batch-row.is-complete{background:#f0fbf6}.brand-batch-row.is-complete span{color:#16825d}
.brand-batch-row.is-error{background:#fff5f3}.brand-batch-row.is-error span{color:#bd3a2d}
.brand-batch-row.is-processing span{color:#1769c2}.brand-batch-row.is-registering span{color:#8c6417}
@media(max-width:900px){.brand-batch-row{grid-template-columns:1fr}.brand-batch-row span{text-align:left}}
'''

# Version sync.
for path in [package_path, lock_path]:
    data = read(path).replace('"version": "2.10.59"', '"version": "2.10.60"')
    write(path, data)
for path in (ROOT / "tests").glob("*.mjs"):
    data = read(path).replace("2.10.59", "2.10.60")
    write(path, data)

new_test = ROOT / "tests" / "separate-monitor-window-v2.10.60.test.mjs"
new_test.write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, html, style, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("registration and monitoring use separate seller-center windows with one login partition", () => {
  assert.match(main, /let sellerMonitorWindow/);
  assert.match(main, /function ensureSellerMonitorWindow/);
  assert.match(main, /title: "POIZON 다운로드 감시 · Around G"/);
  const partitions = main.match(/partition: "persist:around-g-poizon-seller"/g) || [];
  assert.ok(partitions.length >= 2);
  assert.match(main, /monitorSource: "dedicated-window"/);
});

test("dedicated monitor searches every accessible frame and clicks in the matching frame", () => {
  assert.match(main, /function sellerMonitorFrames/);
  assert.match(main, /mainFrame\.framesInSubtree/);
  assert.match(main, /async function readSellerMonitorStatuses/);
  assert.match(main, /frameRoutingId: frame\.routingId/);
  assert.match(main, /async function requestSellerMonitorDownload/);
  assert.match(main, /모든 다운로드센터 프레임에서 버튼을 다시 찾습니다/);
});

test("multi-brand UI shows registration processing completion and failure counts", () => {
  assert.match(html, /id="brand-batch-progress"/);
  assert.match(html, /id="brand-batch-summary"/);
  assert.match(renderer, /const brandBatchStates = new Map/);
  assert.match(renderer, /등록 \$\{registered\}\/\$\{total\} · 처리 중 \$\{processing\} · 완료 \$\{completed\} · 실패 \$\{failed\}/);
  assert.match(style, /\.brand-batch-row\.is-complete/);
  assert.match(style, /\.brand-batch-row\.is-error/);
});

test("release metadata is 2.10.60", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.60");
  assert.equal(JSON.parse(lockSource).version, "2.10.60");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.60");
});
''', encoding="utf-8")

write(main_path, main)
write(renderer_path, renderer)
write(html_path, html)
write(style_path, style)
print("Applied v2.10.60 separate monitor window and batch progress patch")
