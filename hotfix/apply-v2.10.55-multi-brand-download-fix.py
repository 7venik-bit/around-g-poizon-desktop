from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
main_path = ROOT / "main.mjs"
renderer_path = ROOT / "src" / "renderer.js"
preload_path = ROOT / "preload.cjs"
package_path = ROOT / "package.json"
lock_path = ROOT / "package-lock.json"
tests_dir = ROOT / "tests"

main = main_path.read_text(encoding="utf-8")
renderer = renderer_path.read_text(encoding="utf-8")
preload = preload_path.read_text(encoding="utf-8")

# Main-process state: one authoritative download request at a time and paths owned by will-download.
old_globals = '''let brandExportMonitorRunning = false;
let activeBrandDownloadJobId = "";
let brandWorkSessionGeneration = 0;
let sellerProductFrameRoutingId = null;'''
new_globals = '''let brandExportMonitorRunning = false;
let activeBrandDownloadJobId = "";
const brandDownloadPathsInProgress = new Set();
let brandWorkSessionGeneration = 0;
let brandExportAttemptGeneration = 0;
let sellerProductFrameRoutingId = null;'''
if old_globals not in main:
    raise SystemExit("main download globals marker not found")
main = main.replace(old_globals, new_globals, 1)

# Folder polling must not race a managed Electron download, and it must recover the job id by brand.
old_candidate = '''        return { path, name: entry.name, mtimeMs: info.mtimeMs, size: info.size };'''
new_candidate = '''        return { path, name: entry.name, directory: entry.directory, mtimeMs: info.mtimeMs, size: info.size };'''
if old_candidate not in main:
    raise SystemExit("folder polling candidate marker not found")
main = main.replace(old_candidate, new_candidate, 1)

old_sort = '''    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const newest = candidates[0];'''
new_sort = '''    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const newest = candidates.find((candidate) => !brandDownloadPathsInProgress.has(candidate.path));'''
if old_sort not in main:
    raise SystemExit("folder polling newest marker not found")
main = main.replace(old_sort, new_sort, 1)

old_expected = '''    const expectedBrand = pendingBrandExportName || brandFromExportFileName(newest.name);
    const brandIntegrity = await validateBrandExportFile(newest.path, [expectedBrand]).catch((error) => ({'''
new_expected = '''    const folderBrand = newest.directory === folder ? "" : basename(newest.directory);
    const expectedBrand = folderBrand || brandFromExportFileName(newest.name) || pendingBrandExportName;
    const matchingJobs = [...brandExportJobs.entries()].filter(([_jobId, job]) =>
      normalizeBrandExportKey(job?.brandName) === normalizeBrandExportKey(expectedBrand)
      || normalizeBrandExportKey(job?.brandKo) === normalizeBrandExportKey(expectedBrand)
    );
    const matchedJobId = matchingJobs.length === 1 ? matchingJobs[0][0] : "";
    const brandIntegrity = await validateBrandExportFile(newest.path, [expectedBrand]).catch((error) => ({'''
if old_expected not in main:
    raise SystemExit("folder polling expected brand marker not found")
main = main.replace(old_expected, new_expected, 1)

old_send = '''      ...newest,
      brandName: expectedBrand,
      brandIntegrity,'''
new_send = '''      ...newest,
      brandName: expectedBrand,
      jobId: matchedJobId,
      brandIntegrity,'''
if old_send not in main:
    raise SystemExit("folder polling detected payload marker not found")
main = main.replace(old_send, new_send, 1)

# Will-download: bind the event to the oldest explicit request, never a stale pending brand.
will_start = main.index('    sellerSession.on("will-download", (_event, item) => {')
will_end = main.index('    sellerDownloadSessions.add(sellerSession);', will_start)
will_block = main[will_start:will_end]
old_download_head = '''    const sessionGeneration = brandWorkSessionGeneration;
    const downloadJobId = activeBrandDownloadJobId || pendingBrandExportJobId;
    const downloadJob = brandExportJobs.get(downloadJobId) || {
      brandName: pendingBrandExportName,
      brandKo: "",
      jobId: downloadJobId,
    };
    downloadJob.downloadStarted = true;'''
new_download_head = '''    const sessionGeneration = brandWorkSessionGeneration;
    const requestedJobs = [...brandExportJobs.entries()]
      .filter(([_jobId, job]) => Number(job?.downloadRequestedAt || 0) > 0 && !job?.downloadStarted)
      .sort((left, right) => Number(left[1].downloadRequestedAt) - Number(right[1].downloadRequestedAt));
    const lockedJobId = activeBrandDownloadJobId && brandExportJobs.has(activeBrandDownloadJobId)
      ? activeBrandDownloadJobId
      : "";
    const downloadJobId = lockedJobId
      || requestedJobs[0]?.[0]
      || (brandExportJobs.size === 1 ? [...brandExportJobs.keys()][0] : "");
    const downloadJob = brandExportJobs.get(downloadJobId);
    if (!downloadJobId || !downloadJob) {
      mainWindow?.webContents.send("brand-export:error", {
        message: "다운로드 파일과 브랜드 작업번호를 안전하게 연결하지 못해 자동 저장을 중단했습니다.",
      });
      item.cancel();
      return;
    }
    activeBrandDownloadJobId = downloadJobId;
    downloadJob.downloadStarted = true;'''
if old_download_head not in will_block:
    raise SystemExit("will-download job binding marker not found")
will_block = will_block.replace(old_download_head, new_download_head, 1)

old_save_path = '''    const filePath = join(brandFolder, fileName);
    item.setSavePath(filePath);'''
new_save_path = '''    const filePath = join(brandFolder, fileName);
    brandDownloadPathsInProgress.add(filePath);
    item.setSavePath(filePath);'''
if old_save_path not in will_block:
    raise SystemExit("will-download save path marker not found")
will_block = will_block.replace(old_save_path, new_save_path, 1)

# The requested job brand remains authoritative; detected workbook brand is diagnostic only.
old_detected_payload = '''          brandName: detectedBrand || exportBrand || downloadJob.brandName,
          jobId: downloadJobId,'''
new_detected_payload = '''          brandName: downloadJob.brandName || exportBrand,
          detectedBrandName: detectedBrand || "",
          jobId: downloadJobId,'''
if old_detected_payload not in will_block:
    raise SystemExit("will-download detected brand marker not found")
will_block = will_block.replace(old_detected_payload, new_detected_payload, 1)

# Every completion path releases the managed path before another file can be polled.
will_block = will_block.replace(
    '''          brandExportJobs.delete(downloadJobId);
          if (activeBrandDownloadJobId === downloadJobId) activeBrandDownloadJobId = "";
          brandDownloadStarted = false;
          return;''',
    '''          brandExportJobs.delete(downloadJobId);
          if (activeBrandDownloadJobId === downloadJobId) activeBrandDownloadJobId = "";
          brandDownloadPathsInProgress.delete(filePath);
          brandDownloadStarted = false;
          return;''',
    1,
)
old_final_cleanup = '''      brandExportJobs.delete(downloadJobId);
      if (activeBrandDownloadJobId === downloadJobId) activeBrandDownloadJobId = "";
      brandDownloadStarted = false;'''
new_final_cleanup = '''      brandExportJobs.delete(downloadJobId);
      if (activeBrandDownloadJobId === downloadJobId) activeBrandDownloadJobId = "";
      brandDownloadPathsInProgress.delete(filePath);
      brandDownloadStarted = false;'''
if old_final_cleanup not in will_block:
    raise SystemExit("will-download final cleanup marker not found")
will_block = will_block.replace(old_final_cleanup, new_final_cleanup, 1)
main = main[:will_start] + will_block + main[will_end:]

# Monitor: never overwrite the active download job while its browser event is pending.
old_ready = '''      const now = Date.now();
      const ready = statuses.find((status) => {
        const job = brandExportJobs.get(status.jobId);
        return status.state === "READY"
          && !job?.downloadStarted
          && (!job?.downloadRequestedAt || now - job.downloadRequestedAt >= 8_000);
      });'''
new_ready = '''      const now = Date.now();
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
        return status.state === "READY"
          && !job?.downloadStarted
          && !job?.downloadRequestedAt;
      });'''
if old_ready not in main:
    raise SystemExit("multi-job ready selector marker not found")
main = main.replace(old_ready, new_ready, 1)

old_click_fail = '''          if (!clickResult?.clicked) {
            job.downloadRequestedAt = 0;'''
new_click_fail = '''          if (!clickResult?.clicked) {
            job.downloadRequestedAt = 0;
            job.downloadStarted = false;
            if (activeBrandDownloadJobId === ready.jobId) activeBrandDownloadJobId = "";'''
if old_click_fail not in main:
    raise SystemExit("download click failure marker not found")
main = main.replace(old_click_fail, new_click_fail, 1)

# Attempt cancellation generation and bounded long-running stages.
old_attempt_head = '''  const sessionGeneration = brandWorkSessionGeneration;
  const cleared = () => sessionGeneration !== brandWorkSessionGeneration;'''
new_attempt_head = '''  const sessionGeneration = brandWorkSessionGeneration;
  const attemptGeneration = ++brandExportAttemptGeneration;
  const cleared = () => sessionGeneration !== brandWorkSessionGeneration
    || attemptGeneration !== brandExportAttemptGeneration;'''
if old_attempt_head not in main:
    raise SystemExit("brand attempt generation marker not found")
main = main.replace(old_attempt_head, new_attempt_head, 1)

old_search_call = '''      const result = await runSellerSearch(candidate.frame).catch((error) => ({
        ok: false,
        step: "SELLER_SEARCH_SCRIPT_ERROR",
        detail: String(error?.message || error || ""),
      }));'''
new_search_call = '''      const result = await Promise.race([
        runSellerSearch(candidate.frame),
        new Promise((resolve) => setTimeout(() => resolve({
          ok: false,
          step: "SELLER_SEARCH_STAGE_TIMEOUT",
        }), 70_000)),
      ]).catch((error) => ({
        ok: false,
        step: "SELLER_SEARCH_SCRIPT_ERROR",
        detail: String(error?.message || error || ""),
      }));'''
if old_search_call not in main:
    raise SystemExit("seller search timeout marker not found")
main = main.replace(old_search_call, new_search_call, 1)

old_after_search = '''  if (!searched?.ok && searched?.step === "SEARCH_INPUT_NOT_FOUND") {
    searched = { ...searched, diagnostics: lastSearchDiagnostics };
  }
  if (!searched?.ok) {'''
new_after_search = '''  if (cleared()) {
    brandExportJobPending = false;
    pendingBrandExportName = "";
    pendingBrandExportJobId = "";
    return { ok: false, code: "BRAND_ATTEMPT_ABORTED", message: `${brandName} 작업 시간이 초과되어 다음 브랜드로 이동합니다.` };
  }
  if (!searched?.ok && searched?.step === "SEARCH_INPUT_NOT_FOUND") {
    searched = { ...searched, diagnostics: lastSearchDiagnostics };
  }
  if (!searched?.ok) {'''
if old_after_search not in main:
    raise SystemExit("post-search abort marker not found")
main = main.replace(old_after_search, new_after_search, 1)

old_verify_call = '''    completeness = await verifyCompleteSellerExportAndClick(searched.expectedTotal);'''
new_verify_call = '''    completeness = await Promise.race([
      verifyCompleteSellerExportAndClick(searched.expectedTotal),
      new Promise((resolve) => setTimeout(() => resolve({
        ok: false,
        code: "PRODUCT_VERIFICATION_TIMEOUT",
        expected: Number(searched.expectedTotal || 0),
        actual: 0,
      }), 70_000)),
    ]);'''
if old_verify_call not in main:
    raise SystemExit("product verification timeout marker not found")
main = main.replace(old_verify_call, new_verify_call, 1)

old_current_jobs = '''    const currentJobs = await readSellerExportJobs();'''
new_current_jobs = '''    if (cleared()) break;
    const currentJobs = await Promise.race([
      readSellerExportJobs(),
      new Promise((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);'''
if old_current_jobs not in main:
    raise SystemExit("job discovery timeout marker not found")
main = main.replace(old_current_jobs, new_current_jobs, 1)

old_no_job = '''  if (!createdJob) {
    pendingBrandExportName = "";'''
new_no_job = '''  if (cleared()) {
    pendingBrandExportName = "";
    pendingBrandExportJobId = "";
    brandExportJobPending = false;
    return { ok: false, code: "BRAND_ATTEMPT_ABORTED", message: `${brandName} 작업 시간이 초과되어 다음 브랜드로 이동합니다.` };
  }
  if (!createdJob) {
    pendingBrandExportName = "";'''
if old_no_job not in main:
    raise SystemExit("post-job-discovery abort marker not found")
main = main.replace(old_no_job, new_no_job, 1)

# Clear stale pending-brand globals immediately after a job is registered.
old_success_tail = '''  brandExportJobPending = false;
  sellerWindow.hide();
  mainWindow?.show();'''
new_success_tail = '''  brandExportJobPending = false;
  pendingBrandExportName = "";
  pendingBrandExportJobId = "";
  sellerWindow.hide();
  mainWindow?.show();'''
if old_success_tail not in main:
    raise SystemExit("successful registration cleanup marker not found")
main = main.replace(old_success_tail, new_success_tail, 1)

# Add explicit abort IPC before the existing monitor handler.
ipc_marker = 'ipcMain.handle("seller:start-brand-export-monitor"'
ipc_index = main.find(ipc_marker)
if ipc_index < 0:
    raise SystemExit("seller monitor IPC marker not found")
abort_ipc = '''ipcMain.handle("seller:abort-brand-export-attempt", async () => {
  brandExportAttemptGeneration += 1;
  brandExportJobPending = false;
  pendingBrandExportName = "";
  pendingBrandExportJobId = "";
  sellerProductFrameRoutingId = null;
  try {
    sellerWindow?.webContents.stop();
    if (sellerWindow && !sellerWindow.isDestroyed()) {
      await Promise.race([
        sellerWindow.loadURL(SELLER_PRODUCT_SEARCH_URL),
        new Promise((resolve) => setTimeout(resolve, 8_000)),
      ]);
      sellerWindow.hide();
    }
  } catch {}
  showCollectorWindow();
  return { ok: true };
});

'''
main = main[:ipc_index] + abort_ipc + main[ipc_index:]

# New error labels.
message_marker = '    SELLER_SEARCH_SCRIPT_ERROR: `${label} 상품검색 화면 제어 중 오류가 발생했습니다. 상품검색 화면을 다시 열어 재시도해 주세요.`,\n'
message_add = message_marker + '    SELLER_SEARCH_STAGE_TIMEOUT: `${label} 상품검색 응답이 70초 동안 없어 다음 브랜드로 이동합니다.`,\n    PRODUCT_VERIFICATION_TIMEOUT: `${label} 전체 페이지 확인이 70초 안에 끝나지 않아 다음 브랜드로 이동합니다.`,\n'
if message_marker not in main:
    raise SystemExit("seller failure message marker not found")
main = main.replace(message_marker, message_add, 1)

# Preload exposes abort.
preload_marker = '  automateSellerBrandExport: (input) => ipcRenderer.invoke("seller:brand-export", input),\n'
if preload_marker not in preload:
    raise SystemExit("preload brand export marker not found")
preload = preload.replace(preload_marker, preload_marker + '  abortSellerBrandExportAttempt: () => ipcRenderer.invoke("seller:abort-brand-export-attempt"),\n', 1)

# Renderer: explicit per-brand timeout, stable job-brand ownership, and correct file-to-job recovery.
renderer_global = 'let brandExportFailureCount = 0;\nlet activeExportBrand = null;'
renderer_global_new = 'let brandExportFailureCount = 0;\nconst BRAND_AUTOMATION_TIMEOUT_MS = 5 * 60 * 1000;\nlet activeExportBrand = null;'
if renderer_global not in renderer:
    raise SystemExit("renderer timeout global marker not found")
renderer = renderer.replace(renderer_global, renderer_global_new, 1)

old_update_job = '''  const previous = brandExportJobs.get(normalizedId) || {};
  brandExportJobs.set(normalizedId, {
    brandName: brandName || previous.brandName || "선택 브랜드",
    state: state || previous.state || "감시 중",'''
new_update_job = '''  const previous = brandExportJobs.get(normalizedId) || {};
  const previousBrand = String(previous.brandName || "").trim();
  const incomingBrand = String(brandName || "").trim();
  const stableBrandName = previousBrand && previousBrand !== "선택 브랜드"
    ? previousBrand
    : incomingBrand || previousBrand || "선택 브랜드";
  brandExportJobs.set(normalizedId, {
    brandName: stableBrandName,
    state: state || previous.state || "감시 중",'''
if old_update_job not in renderer:
    raise SystemExit("renderer stable job brand marker not found")
renderer = renderer.replace(old_update_job, new_update_job, 1)

insert_after_update = '''  panel.hidden = false;
  renderBrandExportJobs();
}
'''
helper = '''  panel.hidden = false;
  renderBrandExportJobs();
}

function resolveRendererBrandJobId(file = {}) {
  const explicit = String(file?.jobId || "").trim();
  if (explicit) return explicit;
  const key = normalizeBrandKey(file?.brandName || file?.detectedBrandName || "");
  if (!key) return "";
  const matches = [...brandExportJobs.entries()].filter(([_jobId, job]) =>
    normalizeBrandKey(job?.brandName) === key
  );
  const unfinished = matches.filter(([_jobId, job]) => !brandJobIsFinished(job?.state));
  if (unfinished.length === 1) return unfinished[0][0];
  return matches.length === 1 ? matches[0][0] : "";
}
'''
if insert_after_update not in renderer:
    raise SystemExit("renderer job helper insertion marker not found")
renderer = renderer.replace(insert_after_update, helper, 1)

old_automation = '''  const automation = await window.aroundG.automateSellerBrandExport({
    brandName: activeExportBrand.name || "",
    brandKo: activeExportBrand.ko || "",
    brandId: selectedBrandId,
    deferMonitor: true,
  });'''
new_automation = '''  const automationRequest = window.aroundG.automateSellerBrandExport({
    brandName: activeExportBrand.name || "",
    brandKo: activeExportBrand.ko || "",
    brandId: selectedBrandId,
    deferMonitor: true,
  });
  const automation = await Promise.race([
    automationRequest,
    new Promise((resolve) => setTimeout(() => resolve({
      ok: false,
      code: "BRAND_AUTOMATION_TIMEOUT",
      message: `${activeExportBrand?.name || "선택 브랜드"} 작업이 5분 안에 끝나지 않아 다음 브랜드로 이동합니다.`,
    }), BRAND_AUTOMATION_TIMEOUT_MS)),
  ]);
  if (automation?.code === "BRAND_AUTOMATION_TIMEOUT") {
    await window.aroundG.abortSellerBrandExportAttempt?.();
  }'''
if old_automation not in renderer:
    raise SystemExit("renderer automation timeout marker not found")
renderer = renderer.replace(old_automation, new_automation, 1)

# Normalize detected files before they enter the queue.
old_detected_handler = '''window.aroundG.onBrandExportDetected((file) => {
  if (!acceptBrandWorkEvents) return;
  const path = String(file?.path || "").trim();
  if (!path || completedBrandImportPaths.has(path) || queuedBrandImportPaths.has(path)) return;
  updateBrandExportJob(file?.jobId, "5단계/5 · Excel 다운로드 완료 · 검증 대기", file?.brandName);
  queuedBrandImportPaths.add(path);
  detectedBrandImportQueue.push(file);
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `${file?.brandName || "선택 브랜드"} · 5단계/5 · Excel 검증·프로그램 등록 중`;
  void drainDetectedBrandImports();
});'''
new_detected_handler = '''window.aroundG.onBrandExportDetected((file) => {
  if (!acceptBrandWorkEvents) return;
  const path = String(file?.path || "").trim();
  if (!path || completedBrandImportPaths.has(path) || queuedBrandImportPaths.has(path)) return;
  const resolvedJobId = resolveRendererBrandJobId(file);
  const registeredBrand = String(brandExportJobs.get(resolvedJobId)?.brandName || "").trim();
  const normalizedFile = {
    ...file,
    jobId: resolvedJobId,
    brandName: registeredBrand || file?.brandName || "선택 브랜드",
  };
  updateBrandExportJob(normalizedFile.jobId, "5단계/5 · Excel 다운로드 완료 · 검증 대기", normalizedFile.brandName);
  queuedBrandImportPaths.add(path);
  detectedBrandImportQueue.push(normalizedFile);
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `${normalizedFile.brandName} · 5단계/5 · Excel 검증·프로그램 등록 중`;
  void drainDetectedBrandImports();
});'''
if old_detected_handler not in renderer:
    raise SystemExit("renderer detected handler marker not found")
renderer = renderer.replace(old_detected_handler, new_detected_handler, 1)

old_complete_message = '''  $("#brand-status").textContent = `${expectedBrand || "선택 브랜드"} 확인완료${countLabel} · 받은 Excel 파일 메뉴에서 확인하세요.`;'''
new_complete_message = '''  const remainingJobs = [...brandExportJobs.values()].filter((job) => !brandJobIsFinished(job.state)).length;
  $("#brand-status").textContent = remainingJobs
    ? `${expectedBrand || "선택 브랜드"} 확인완료${countLabel} · 남은 ${remainingJobs}개 브랜드 작업을 계속 감시합니다.`
    : `${expectedBrand || "선택 브랜드"} 확인완료${countLabel} · 받은 Excel 파일 메뉴에서 확인하세요.`;'''
if old_complete_message not in renderer:
    raise SystemExit("renderer completion summary marker not found")
renderer = renderer.replace(old_complete_message, new_complete_message, 1)

# Version metadata.
package_data = json.loads(package_path.read_text(encoding="utf-8"))
package_data["version"] = "2.10.55"
package_path.write_text(json.dumps(package_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
lock_data = json.loads(lock_path.read_text(encoding="utf-8"))
lock_data["version"] = "2.10.55"
lock_data.setdefault("packages", {}).setdefault("", {})["version"] = "2.10.55"
lock_path.write_text(json.dumps(lock_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Keep fixed release assertions synchronized.
for test_path in tests_dir.glob("*.test.mjs"):
    source = test_path.read_text(encoding="utf-8")
    if "2.10.54" in source:
        test_path.write_text(source.replace("2.10.54", "2.10.55"), encoding="utf-8")

regression = r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, preload, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("only one POIZON download request owns the global browser download event", () => {
  assert.match(main, /const ready = activeBrandDownloadJobId \? null : statuses\.find/);
  assert.match(main, /requestedJobs = \[\.\.\.brandExportJobs\.entries\(\)\]/);
  assert.match(main, /brandDownloadPathsInProgress\.add\(filePath\)/);
  assert.match(main, /brandDownloadPathsInProgress\.delete\(filePath\)/);
});

test("folder polling recovers a job id by brand without using a stale pending brand first", () => {
  assert.match(main, /folderBrand \|\| brandFromExportFileName\(newest\.name\) \|\| pendingBrandExportName/);
  assert.match(main, /jobId: matchedJobId/);
  assert.match(main, /candidates\.find\(\(candidate\) => !brandDownloadPathsInProgress\.has\(candidate\.path\)\)/);
});

test("registered job clears stale pending globals and keeps requested brand authoritative", () => {
  assert.match(main, /pendingBrandExportName = "";\n  pendingBrandExportJobId = "";\n  sellerWindow\.hide/);
  assert.match(main, /brandName: downloadJob\.brandName \|\| exportBrand/);
  assert.match(renderer, /stableBrandName/);
  assert.match(renderer, /resolveRendererBrandJobId/);
});

test("a stalled brand attempt is aborted and the remaining queue can continue", () => {
  assert.match(renderer, /BRAND_AUTOMATION_TIMEOUT_MS = 5 \* 60 \* 1000/);
  assert.match(renderer, /abortSellerBrandExportAttempt/);
  assert.match(preload, /seller:abort-brand-export-attempt/);
  assert.match(main, /brandExportAttemptGeneration \+= 1/);
  assert.match(main, /SELLER_SEARCH_STAGE_TIMEOUT/);
  assert.match(main, /PRODUCT_VERIFICATION_TIMEOUT/);
});

test("release metadata is 2.10.55", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.55");
  assert.equal(JSON.parse(lockSource).version, "2.10.55");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.55");
});
'''
(tests_dir / "multi-brand-download-mapping-v2.10.55.test.mjs").write_text(regression, encoding="utf-8")

main_path.write_text(main, encoding="utf-8")
renderer_path.write_text(renderer, encoding="utf-8")
preload_path.write_text(preload, encoding="utf-8")
print("Applied v2.10.55 multi-brand download mapping and queue timeout fix")
