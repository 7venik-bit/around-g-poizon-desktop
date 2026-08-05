from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
main_path = ROOT / "main.mjs"
renderer_path = ROOT / "src" / "renderer.js"
main = main_path.read_text(encoding="utf-8")
renderer = renderer_path.read_text(encoding="utf-8")

reader_block = r'''const SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT = `(() => {
  const visible = (element) => element && element.getClientRects().length > 0;
  const textOf = (element) => String(element?.innerText || element?.textContent || "")
    .replace(/\\s+/g, " ").trim();
  const candidates = [...document.querySelectorAll(
    "tbody tr, [role='row'], tr, [data-row-key], [class*='table'] [class*='row'], [class*='list'] [class*='item']"
  )].filter(visible);
  const jobs = [];
  const seen = new Set();
  for (const element of candidates) {
    const text = textOf(element);
    if (!text || text.length > 2400) continue;
    const cells = [...element.querySelectorAll("td, [role='cell'], [role='gridcell']")];
    const firstCellText = textOf(cells[0]);
    const id = firstCellText.match(/\\b\\d{7,}\\b/)?.[0]
      || text.match(/\\b\\d{7,}\\b/)?.[0]
      || "";
    if (!id || seen.has(id)) continue;
    const rowHint = cells.length >= 2
      || /내보내기|다운로드|작업|export|download|task|导出|下载|任务|처리|成功/i.test(text);
    if (!rowHint) continue;
    seen.add(id);
    jobs.push({ id, fingerprint: id, text: text.slice(0, 500) });
  }
  const bodyText = textOf(document.body);
  const emptyState = /暂无数据|没有数据|暂无任务|데이터가\\s*없|작업이\\s*없|no\\s*(?:data|task)/i.test(bodyText);
  return { ready: jobs.length > 0 || emptyState, jobs };
})()`;

async function readSellerExportJobsFromWindow(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return null;
  const mainFrame = targetWindow.webContents.mainFrame;
  const frames = [mainFrame, ...(mainFrame.framesInSubtree || [])]
    .filter((frame, index, all) => all.findIndex((candidate) => candidate.routingId === frame.routingId) === index);
  const jobsById = new Map();
  let ready = false;
  for (const frame of frames) {
    try {
      const snapshot = await frame.executeJavaScript(SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT, true);
      if (snapshot?.ready) ready = true;
      for (const job of snapshot?.jobs || []) {
        const id = String(job?.id || "").trim();
        if (id && !jobsById.has(id)) jobsById.set(id, job);
      }
    } catch {
      // 접근할 수 없는 외부 프레임은 건너뛰고 나머지 프레임을 계속 확인합니다.
    }
  }
  return ready || jobsById.size ? [...jobsById.values()] : null;
}

async function readSellerExportJobs() {
  if (!sellerWindow || sellerWindow.isDestroyed()) return null;
  if (!sellerWindow.webContents.getURL().includes("/main/exportCenter")) {
    await sellerWindow.loadURL(SELLER_EXPORT_CENTER_URL);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return readSellerExportJobsFromWindow(sellerWindow);
}

async function readSellerExportBaselineSeparately() {
  let baselineWindow;
  try {
    baselineWindow = new BrowserWindow({
      show: false,
      width: 1100,
      height: 760,
      webPreferences: {
        partition: "persist:around-g-poizon-seller",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    await baselineWindow.loadURL(SELLER_EXPORT_CENTER_URL);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    return await readSellerExportJobsFromWindow(baselineWindow);
  } catch {
    return null;
  } finally {
    if (baselineWindow && !baselineWindow.isDestroyed()) baselineWindow.destroy();
  }
}

async function readStableSellerExportJobs()'''

main, replaced = re.subn(
    r'async function readSellerExportJobs\(\) \{.*?\n\}\n\nasync function readStableSellerExportJobs\(\)',
    reader_block,
    main,
    count=1,
    flags=re.S,
)
if replaced != 1:
    raise SystemExit("readSellerExportJobs block not replaced")

baseline_start = main.find('  mainWindow?.webContents.send("brand-export:progress", {\n    status: "checking-export-baseline",')
search_navigation = main.find('  if (!sellerWindow.webContents.getURL().includes("/main/goods/search")) {', baseline_start)
if baseline_start < 0 or search_navigation < 0:
    raise SystemExit("baseline hard-stop range not found")
main = main[:baseline_start] + '''  const baselinePromise = readSellerExportBaselineSeparately().catch(() => null);
  if (cleared()) return { ok: false, code: "WORK_CLEARED", message: "작업 기록 삭제로 이전 요청을 중단했습니다." };
  mainWindow?.webContents.send("brand-export:progress", {
    status: "opening-product-search",
    brandName,
    jobState: "1단계/5 · 실제 상품검색 시작",
    message: `${brandName} · 판매자센터 상품검색 화면을 열고 실제 검색을 시작합니다.`,
  });
''' + main[search_navigation:]

search_complete_marker = '''  mainWindow?.webContents.send("brand-export:progress", {
    status: "brand-search-complete",'''
if search_complete_marker not in main:
    raise SystemExit("brand-search-complete marker not found")
baseline_after_search = '''  const baselineJobs = await baselinePromise;
  const baselineAvailable = Array.isArray(baselineJobs);
  const baselineJobIds = new Set([
    ...brandExportJobs.keys(),
    ...savedBrandExportJobs().map((job) => String(job?.jobId || "").trim()),
    ...(baselineJobs || []).map((job) => String(job?.id || "").trim()),
  ].filter(Boolean));
  if (!baselineAvailable) {
    mainWindow?.webContents.send("brand-export:progress", {
      status: "baseline-fallback",
      brandName,
      jobState: "1단계/5 · 상품검색 완료 · 작업번호 후행 확인 방식",
      message: `${brandName} · 기존 작업번호 화면 판독은 생략하고 실제 내보내기 요청 이후 새 미사용 작업번호를 확인합니다.`,
    });
  }

'''
main = main.replace(search_complete_marker, baseline_after_search + search_complete_marker, 1)

main, replaced = re.subn(
    r'(  let lastProgressAt = 0;)',
    r'\1\n  let fallbackCandidateJobId = "";\n  let fallbackCandidateStableReads = 0;',
    main,
    count=1,
)
if replaced != 1:
    raise SystemExit("fallback state insertion failed")

job_detection_pattern = re.compile(
    r'    if \(Array\.isArray\(currentJobs\)\) \{\n'
    r'      createdJob = findNewSellerExportJob\(\[\.\.\.baselineJobIds\], currentJobs\);\n'
    r'    \}\n'
    r'    if \(createdJob\) break;'
)
job_detection_replacement = '''    if (Array.isArray(currentJobs)) {
      const unusedJobs = currentJobs.filter((job) => !brandExportJobOwner(job?.id));
      const candidate = findNewSellerExportJob([...baselineJobIds], unusedJobs);
      if (candidate && baselineAvailable) {
        createdJob = candidate;
      } else if (candidate) {
        const candidateId = String(candidate.id || "").trim();
        fallbackCandidateStableReads = candidateId === fallbackCandidateJobId
          ? fallbackCandidateStableReads + 1
          : 1;
        fallbackCandidateJobId = candidateId;
        if (fallbackCandidateStableReads >= 2) createdJob = candidate;
      } else {
        fallbackCandidateJobId = "";
        fallbackCandidateStableReads = 0;
      }
    }
    if (createdJob) break;'''
main, replaced = job_detection_pattern.subn(job_detection_replacement, main, count=1)
if replaced != 1:
    raise SystemExit("current job detection block not replaced")

old_progress = '            message: `${brandName} · 전체 내보내기 요청 완료 · POIZON이 새 작업번호를 생성하는 중입니다. 화면을 반복 초기화하지 않고 기다립니다.`, '
if old_progress not in main:
    old_progress = '            message: `${brandName} · 전체 내보내기 요청 완료 · POIZON이 새 작업번호를 생성하는 중입니다. 화면을 반복 초기화하지 않고 기다립니다.`,\n'
new_progress = '''            message: baselineAvailable
              ? `${brandName} · 전체 내보내기 요청 완료 · POIZON이 새 작업번호를 생성하는 중입니다. 화면을 반복 초기화하지 않고 기다립니다.`
              : `${brandName} · 실제 내보내기 요청 완료 · 기존 목록 판독 없이 새 미사용 작업번호를 연속 확인 중입니다.`,
'''
if old_progress not in main:
    raise SystemExit("job creation progress message not found")
main = main.replace(old_progress, new_progress, 1)

old_failure_text = '"전체 내보내기 요청 후 3분 동안 다운로드센터의 새 작업번호가 확인되지 않았습니다. POIZON 처리 지연 또는 세션 상태를 확인해 주세요."'
new_failure_text = '"실제 상품검색과 전체 내보내기 요청은 실행됐지만 3분 동안 새 미사용 작업번호를 확인하지 못했습니다. 다운로드센터 화면 구조 또는 로그인 세션을 확인해 주세요."'
if old_failure_text not in main:
    raise SystemExit("job creation failure message not found")
main = main.replace(old_failure_text, new_failure_text, 1)

renderer = renderer.replace(
    '$("#brand-status").textContent = `${activeExportBrand.name} · 1단계/5 · 상품 검색 후 전체 페이지 수 확인 준비 중 (다운로드센터 작업 생성 전)`;',
    '$("#brand-status").textContent = `${activeExportBrand.name} · 1단계/5 · 판매자센터 연결 후 실제 상품검색 시작 중`;',
    1,
)
renderer = renderer.replace(
    'touchBrandActivity(`${activeExportBrand.name} · 상품 검색·전체 페이지 확인 중`);',
    'touchBrandActivity(`${activeExportBrand.name} · 실제 상품검색 실행 중`);',
    1,
)

package_path = ROOT / "package.json"
lock_path = ROOT / "package-lock.json"
package_source = package_path.read_text(encoding="utf-8")
lock_source = lock_path.read_text(encoding="utf-8")
package_source = package_source.replace('"version": "2.10.51"', '"version": "2.10.52"', 1)
lock_source = lock_source.replace('"version": "2.10.51"', '"version": "2.10.52"', 2)
package_path.write_text(package_source, encoding="utf-8")
lock_path.write_text(lock_source, encoding="utf-8")

for test_path in (ROOT / "tests").glob("*.test.mjs"):
    source = test_path.read_text(encoding="utf-8").replace("2.10.51", "2.10.52")
    source = source.replace(
        'test("an unreadable export center is never treated as an empty baseline", () => {',
        'test("an unreadable export center does not block real brand work", () => {',
    )
    source = source.replace(
        'assert.match(main, /EXPORT_CENTER_BASELINE_UNAVAILABLE/);',
        'assert.doesNotMatch(main, /EXPORT_CENTER_BASELINE_UNAVAILABLE/);',
    )
    test_path.write_text(source, encoding="utf-8")

(ROOT / "tests" / "real-brand-work-v2.10.52.test.mjs").write_text('''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, pkg, lock] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("baseline inspection is parallel and never blocks actual product search", () => {
  assert.match(main, /readSellerExportBaselineSeparately/);
  assert.match(main, /const baselinePromise = readSellerExportBaselineSeparately/);
  assert.match(main, /1단계\/5 · 실제 상품검색 시작/);
  assert.doesNotMatch(main, /EXPORT_CENTER_BASELINE_UNAVAILABLE/);
});

test("fallback job discovery requires the same unused job number twice", () => {
  assert.match(main, /unusedJobs = currentJobs\.filter/);
  assert.match(main, /fallbackCandidateStableReads >= 2/);
  assert.match(main, /새 미사용 작업번호를 연속 확인 중/);
});

test("UI reports activity only when actual product search starts", () => {
  assert.match(renderer, /판매자센터 연결 후 실제 상품검색 시작 중/);
  assert.match(renderer, /실제 상품검색 실행 중/);
});

test("release metadata is 2.10.52", () => {
  assert.equal(JSON.parse(pkg).version, "2.10.52");
  assert.equal(JSON.parse(lock).version, "2.10.52");
  assert.equal(JSON.parse(lock).packages[""].version, "2.10.52");
});
''', encoding="utf-8")

main_path.write_text(main, encoding="utf-8")
renderer_path.write_text(renderer, encoding="utf-8")
