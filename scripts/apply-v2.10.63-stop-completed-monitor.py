from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "main.mjs"
RENDERER = ROOT / "src" / "renderer.js"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


def regex_replace_once(source: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, lambda _m: replacement, source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return result


main = MAIN.read_text(encoding="utf-8")
main = replace_once(
    main,
    'let brandExportMonitorRestartTimer;\nlet activeBrandDownloadJobId = "";',
    'let brandExportMonitorRestartTimer;\nlet brandExportAllCompleteSent = false;\nlet activeBrandDownloadJobId = "";',
    "main all-complete latch",
)

read_statuses = r'''async function readSellerMonitorStatuses(expectedIds = []) {
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
        const usable = (element) => Boolean(element && element.isConnected);
        const textOf = (element) => String(element?.textContent || element?.innerText || "")
          .replace(/\\s+/g, " ").trim();
        const selector = "tbody tr, [role='row'], tr, [data-row-key], [class*='table'] [class*='row'], [class*='list'] [class*='item']";
        const rowCandidates = [...document.querySelectorAll(selector)].filter(usable);
        const findJobContainer = (jobId) => {
          const direct = rowCandidates
            .filter((candidate) => textOf(candidate).includes(jobId))
            .sort((left, right) => textOf(left).length - textOf(right).length)[0];
          if (direct) return direct;
          const leaf = [...document.querySelectorAll("body *")]
            .filter(usable)
            .filter((element) => {
              const value = textOf(element);
              if (!value.includes(jobId) || value.length > 1000) return false;
              return ![...element.children].some((child) => textOf(child).includes(jobId));
            })
            .sort((left, right) => textOf(left).length - textOf(right).length)[0];
          return leaf?.closest("tr, [role='row'], [data-row-key], [class*='row'], [class*='item']")
            || leaf?.parentElement
            || leaf
            || null;
        };
        return expectedIds.map((jobId) => {
          const row = findJobContainer(jobId);
          if (!row) return { jobId, state: "WAITING_FOR_ROW" };
          const rowText = textOf(row);
          if (/처리\\s*중|processing|pending|진행\\s*중/i.test(rowText)) return { jobId, state: "PROCESSING" };
          if (!/성공|완료|completed|success/i.test(rowText)) return { jobId, state: "WAITING_FOR_SUCCESS" };
          const control = [...row.querySelectorAll("a, button, [role='button']")].find((element) => {
            if (!usable(element) || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
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
'''
main = regex_replace_once(
    main,
    r'async function readSellerMonitorStatuses\(expectedIds = \[\]\) \{[\s\S]*?\n\}\n\nasync function requestSellerMonitorDownload',
    read_statuses + '\nasync function requestSellerMonitorDownload',
    "replace hidden monitor status reader",
)

request_download = r'''async function requestSellerMonitorDownload(jobId = "", preferredFrameRoutingId = null) {
  const frames = sellerMonitorFrames();
  const ordered = preferredFrameRoutingId === null
    ? frames
    : [...frames].sort((left, right) => Number(right.routingId === preferredFrameRoutingId) - Number(left.routingId === preferredFrameRoutingId));
  for (const frame of ordered) {
    const result = await frame.executeJavaScript(`(() => {
      const jobId = ${JSON.stringify(String(jobId))};
      const usable = (element) => Boolean(element && element.isConnected);
      const textOf = (element) => String(element?.textContent || element?.innerText || "").replace(/\\s+/g, " ").trim();
      const selector = "tbody tr, [role='row'], tr, [data-row-key], [class*='table'] [class*='row'], [class*='list'] [class*='item']";
      const rowCandidates = [...document.querySelectorAll(selector)].filter(usable);
      const direct = rowCandidates
        .filter((candidate) => textOf(candidate).includes(jobId))
        .sort((left, right) => textOf(left).length - textOf(right).length)[0];
      const leaf = direct ? null : [...document.querySelectorAll("body *")]
        .filter(usable)
        .filter((element) => textOf(element).includes(jobId)
          && ![...element.children].some((child) => textOf(child).includes(jobId)))
        .sort((left, right) => textOf(left).length - textOf(right).length)[0];
      const row = direct
        || leaf?.closest("tr, [role='row'], [data-row-key], [class*='row'], [class*='item']")
        || leaf?.parentElement
        || leaf
        || null;
      const control = [...(row?.querySelectorAll("a, button, [role='button']") || [])].find((element) =>
        usable(element)
        && !element.disabled
        && element.getAttribute("aria-disabled") !== "true"
        && /다운로드|download/i.test([
          textOf(element), element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("href"),
        ].filter(Boolean).join(" "))
      );
      if (!control) return { clicked: false, href: "" };
      let href = String(control.href || control.getAttribute("href") || "");
      try {
        if (href && !/^javascript:/i.test(href)) href = new URL(href, location.href).href;
      } catch {}
      if (/^https:\\/\\//i.test(href)) return { clicked: true, href };
      control.focus?.();
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        control.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button: 0,
        }));
      }
      if (typeof control.click === "function") control.click();
      return { clicked: true, href: "" };
    })()`, true).catch(() => ({ clicked: false, href: "" }));
    if (result?.clicked) return result;
  }
  return { clicked: false, href: "" };
}

function emitBrandExportAllComplete() {
  if (brandExportJobs.size || brandDownloadStarted || activeBrandDownloadJobId || brandDownloadPathsInProgress.size) return false;
  if (brandExportMonitorRestartTimer) {
    clearTimeout(brandExportMonitorRestartTimer);
    brandExportMonitorRestartTimer = null;
  }
  if (brandExportAllCompleteSent) return true;
  brandExportAllCompleteSent = true;
  mainWindow?.webContents.send("brand-export:progress", {
    status: "all-complete",
    monitorSource: "dedicated-window",
    jobState: "모든 작업 확인완료",
    message: "선택한 브랜드의 POIZON 원본 Excel 다운로드와 프로그램 등록이 모두 완료되었습니다.",
  });
  return true;
}
'''
main = regex_replace_once(
    main,
    r'async function requestSellerMonitorDownload\(jobId = "", preferredFrameRoutingId = null\) \{[\s\S]*?\n\}\n\nfunction scheduleBrandExportMonitor',
    request_download + '\nfunction scheduleBrandExportMonitor',
    "replace hidden monitor download requester",
)

main = replace_once(
    main,
    '''function scheduleBrandExportMonitor(delayMs = 0) {
  if (!brandExportJobs.size || brandExportMonitorRunning) return;''',
    '''function scheduleBrandExportMonitor(delayMs = 0) {
  if (!brandExportJobs.size || brandExportMonitorRunning) {
    if (!brandExportJobs.size) emitBrandExportAllComplete();
    return;
  }
  brandExportAllCompleteSent = false;''',
    "schedule completion guard",
)

main = replace_once(
    main,
    '''          if (brandExportJobs.size) scheduleBrandExportMonitor(500);
          return;''',
    '''          if (brandExportJobs.size) scheduleBrandExportMonitor(500);
          else emitBrandExportAllComplete();
          return;''',
    "partial download termination",
)

main = replace_once(
    main,
    '''      if (brandExportJobs.size) scheduleBrandExportMonitor(500);
      else {
        mainWindow?.webContents.send("brand-export:progress", {
          status: "all-complete",
          jobState: "모든 작업 확인완료",
          message: "선택한 브랜드의 POIZON 원본 Excel 다운로드와 프로그램 등록이 모두 완료되었습니다.",
        });
      }''',
    '''      if (brandExportJobs.size) scheduleBrandExportMonitor(500);
      else emitBrandExportAllComplete();''',
    "download completion termination",
)

main = replace_once(
    main,
    '''    if (brandExportJobs.size) scheduleBrandExportMonitor(3_000);
    else {
      mainWindow?.webContents.send("brand-export:progress", {
        status: "all-complete",
        monitorSource: "dedicated-window",
        jobState: "모든 작업 확인완료",
        message: "선택한 브랜드의 POIZON 원본 Excel 다운로드와 프로그램 등록이 모두 완료되었습니다.",
      });
    }''',
    '''    if (brandExportJobs.size) scheduleBrandExportMonitor(3_000);
    else emitBrandExportAllComplete();''',
    "monitor finally termination",
)
MAIN.write_text(main, encoding="utf-8")

renderer = RENDERER.read_text(encoding="utf-8")
renderer = replace_once(
    renderer,
    'let brandActivityMessage = "";\nconst WORK_HISTORY_RESET_KEY',
    'let brandActivityMessage = "";\nlet brandMainAllComplete = false;\nconst WORK_HISTORY_RESET_KEY',
    "renderer all-complete latch",
)

finalizer = '''function finalizeBrandActivityAfterMainCompletion() {
  if (!brandMainAllComplete || detectedBrandImportRunning || detectedBrandImportQueue.length) return false;
  for (const [jobId, job] of brandExportJobs.entries()) {
    if (!brandJobIsFinished(job.state)) {
      brandExportJobs.set(jobId, { ...job, state: "완료됨", updatedAt: Date.now() });
    }
  }
  for (const [key, item] of brandBatchStates.entries()) {
    if (item.jobId && !/확인완료|실패|오류|중단|취소/.test(item.state)) {
      brandBatchStates.set(key, { ...item, state: "확인완료", updatedAt: Date.now() });
    }
  }
  renderBrandExportJobs();
  renderBrandBatchProgress();
  stopBrandActivity();
  const activePanel = $("#brand-export-job");
  if (activePanel) activePanel.hidden = true;
  return true;
}

'''
renderer = replace_once(
    renderer,
    'function normalizeBrandKey(value = "") {',
    finalizer + 'function normalizeBrandKey(value = "") {',
    "insert renderer completion finalizer",
)

renderer = replace_once(
    renderer,
    '''  acceptBrandWorkEvents = true;
  const generation = brandWorkHistoryGeneration;''',
    '''  acceptBrandWorkEvents = true;
  brandMainAllComplete = false;
  const generation = brandWorkHistoryGeneration;''',
    "reset renderer completion latch",
)

renderer = replace_once(
    renderer,
    '''  } finally {
    detectedBrandImportRunning = false;
    if (detectedBrandImportQueue.length) void drainDetectedBrandImports();
  }
}''',
    '''  } finally {
    detectedBrandImportRunning = false;
    if (detectedBrandImportQueue.length) void drainDetectedBrandImports();
    else finalizeBrandActivityAfterMainCompletion();
  }
}''',
    "finish activity after import drain",
)

renderer = replace_once(
    renderer,
    '''  if (progress?.status === "all-complete") {
    renderBrandExportJobs();
    renderBrandCompletedJobs();
    const unfinished = [...brandExportJobs.values()].some((job) => !brandJobIsFinished(job.state));
    if (!unfinished && !detectedBrandImportRunning && !detectedBrandImportQueue.length) stopBrandActivity();
    $("#brand-status").className = "status success";
    $("#brand-status").textContent = progress?.message || "모든 작업이 확인완료되었습니다.";
    return;
  }''',
    '''  if (progress?.status === "all-complete") {
    brandMainAllComplete = true;
    renderBrandCompletedJobs();
    finalizeBrandActivityAfterMainCompletion();
    $("#brand-status").className = "status success";
    $("#brand-status").textContent = progress?.message || "모든 작업이 확인완료되었습니다.";
    return;
  }''',
    "renderer all-complete handler",
)
RENDERER.write_text(renderer, encoding="utf-8")

# Synchronize release metadata and all version assertions.
for path in [ROOT / "package.json", ROOT / "package-lock.json"]:
    data = json.loads(path.read_text(encoding="utf-8"))
    data["version"] = "2.10.63"
    if path.name == "package-lock.json":
        data.setdefault("packages", {}).setdefault("", {})["version"] = "2.10.63"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

for path in (ROOT / "tests").glob("*.test.mjs"):
    source = path.read_text(encoding="utf-8")
    source = source.replace("2.10.62", "2.10.63")
    path.write_text(source, encoding="utf-8")

new_test = ROOT / "tests" / "stop-completed-monitor-v2.10.63.test.mjs"
new_test.write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, rendererSource, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);
const main = mainSource.replace(/\r\n/g, "\n");
const renderer = rendererSource.replace(/\r\n/g, "\n");

test("hidden Seller Center monitor reads connected DOM instead of visible geometry", () => {
  const reader = main.match(/async function readSellerMonitorStatuses[\s\S]*?\n}\n\nasync function requestSellerMonitorDownload/)?.[0] || "";
  assert.ok(reader);
  assert.match(reader, /element\.isConnected/);
  assert.match(reader, /element\?\.textContent \|\| element\?\.innerText/);
  assert.match(reader, /document\.querySelectorAll\("body \*"\)/);
  assert.doesNotMatch(reader, /getClientRects\(\)\.length > 0/);
});

test("hidden download request does not require a visible button", () => {
  const requester = main.match(/async function requestSellerMonitorDownload[\s\S]*?\n}\n\nfunction emitBrandExportAllComplete/)?.[0] || "";
  assert.ok(requester);
  assert.match(requester, /element\.isConnected/);
  assert.match(requester, /pointerdown/);
  assert.doesNotMatch(requester, /getClientRects\(\)\.length > 0/);
});

test("all-complete is emitted once and cancels monitor restart", () => {
  assert.match(main, /let brandExportAllCompleteSent = false/);
  assert.match(main, /function emitBrandExportAllComplete/);
  assert.match(main, /clearTimeout\(brandExportMonitorRestartTimer\)/);
  assert.match(main, /if \(brandExportAllCompleteSent\) return true/);
  assert.match(main, /else emitBrandExportAllComplete\(\)/);
});

test("renderer stops activity after the final Excel import drains", () => {
  assert.match(renderer, /let brandMainAllComplete = false/);
  assert.match(renderer, /function finalizeBrandActivityAfterMainCompletion/);
  assert.match(renderer, /else finalizeBrandActivityAfterMainCompletion\(\)/);
  assert.match(renderer, /brandMainAllComplete = true/);
  assert.match(renderer, /stopBrandActivity\(\)/);
});

test("release metadata is 2.10.63", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.63");
  assert.equal(JSON.parse(lockSource).version, "2.10.63");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.63");
});
''', encoding="utf-8")

print("Applied v2.10.63 hidden monitor completion patch")
