from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_exact(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}\n--- OLD ---\n{old}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


renderer_path = ROOT / "src" / "renderer.js"
main_path = ROOT / "main.mjs"

replace_exact(
    renderer_path,
    'const completedBrandImportPaths = new Set();\nlet detectedBrandImportRunning = false;',
    'const completedBrandImportPaths = new Set();\nconst completedBrandImportJobIds = new Set();\nlet detectedBrandImportRunning = false;',
)

replace_exact(
    renderer_path,
    '''function normalizeBrandKey(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
}
''',
    '''function normalizeBrandKey(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function brandImportPathKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/[\\\\/]+/g, "\\\\")
    .toLocaleLowerCase();
}
''',
)

replace_exact(
    renderer_path,
    '''function addDownloadedBrandFile(file = {}) {
  const path = String(file.path || "").trim();
  if (!path) return;
  downloadedBrandFiles = [
    {
      path,
      name: String(file.name || ""),
      brandName: String(file.brandName || selectedBrandName || "선택 브랜드"),
      jobId: String(file.jobId || ""),
      originalPath: String(file.originalPath || ""),
      size: Number(file.size || 0),
      time: Number(file.time) || Date.now(),
      brandIntegrity: file.brandIntegrity || null,
    },
    ...downloadedBrandFiles.filter((item) => String(item.path || "") !== path),
  ].slice(0, 500);
  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));
  renderDownloadedBrandFiles();
  renderBrandCards($("#brand-filter")?.value || "");
}
''',
    '''function addDownloadedBrandFile(file = {}) {
  const path = String(file.path || "").trim();
  const pathKey = brandImportPathKey(path);
  const jobId = String(file.jobId || "").trim();
  if (!pathKey) return;
  downloadedBrandFiles = [
    {
      path,
      name: String(file.name || ""),
      brandName: String(file.brandName || "선택 브랜드"),
      jobId,
      originalPath: String(file.originalPath || ""),
      size: Number(file.size || 0),
      time: Number(file.time) || Date.now(),
      brandIntegrity: file.brandIntegrity || null,
    },
    ...downloadedBrandFiles.filter((item) =>
      brandImportPathKey(item.path) !== pathKey
      && (!jobId || String(item.jobId || "").trim() !== jobId)
    ),
  ].slice(0, 500);
  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));
  renderDownloadedBrandFiles();
  renderBrandCards($("#brand-filter")?.value || "");
}
''',
)

replace_exact(
    renderer_path,
    '''  queuedBrandImportPaths.clear();
  completedBrandImportPaths.clear();
  brandWorkbenchProducts = [];''',
    '''  queuedBrandImportPaths.clear();
  completedBrandImportPaths.clear();
  completedBrandImportJobIds.clear();
  brandWorkbenchProducts = [];''',
)

replace_exact(
    renderer_path,
    '''  const savedByPath = new Map(downloadedBrandFiles.map((file) => [String(file.path || ""), file]));
  downloadedBrandFiles = result.files
    .map((file) => {
      const path = String(file.path || "");
      const saved = savedByPath.get(path) || {};
      return {
        ...saved,
        ...file,
        path,
        brandName: String(saved.brandName || file.brandName || "선택 브랜드"),
        jobId: String(saved.jobId || file.jobId || ""),
        time: Number(file.time || file.mtimeMs || saved.time || 0),
        brandIntegrity: file.brandIntegrity || saved.brandIntegrity || null,
      };
    })
    .filter((file) => file.path)
    .sort((a, b) => Number(b.time || 0) - Number(a.time || 0))
    .slice(0, 500);
  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));''',
    '''  const savedByPath = new Map(downloadedBrandFiles.map((file) => [brandImportPathKey(file.path), file]));
  downloadedBrandFiles = result.files
    .map((file) => {
      const path = String(file.path || "");
      const saved = savedByPath.get(brandImportPathKey(path)) || {};
      return {
        ...saved,
        ...file,
        path,
        brandName: String(file.brandName || saved.brandName || "선택 브랜드"),
        jobId: String(file.jobId || saved.jobId || ""),
        time: Number(file.time || file.mtimeMs || saved.time || 0),
        brandIntegrity: file.brandIntegrity || saved.brandIntegrity || null,
      };
    })
    .filter((file) => file.path)
    .sort((a, b) => Number(b.time || 0) - Number(a.time || 0))
    .slice(0, 500);
  completedBrandImportPaths.clear();
  completedBrandImportJobIds.clear();
  downloadedBrandFiles.forEach((file) => {
    const pathKey = brandImportPathKey(file.path);
    const jobId = String(file.jobId || "").trim();
    if (pathKey) completedBrandImportPaths.add(pathKey);
    if (jobId) completedBrandImportJobIds.add(jobId);
  });
  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));''',
)

replace_exact(
    renderer_path,
    '''async function importDetectedBrandExport(file, generation = brandWorkHistoryGeneration) {
  if (!acceptBrandWorkEvents || generation !== brandWorkHistoryGeneration) return false;
  const expectedBrand = String(file?.brandName || selectedBrandName || "").trim();
  retainSelectedBrandName(expectedBrand);''',
    '''async function importDetectedBrandExport(file, generation = brandWorkHistoryGeneration) {
  if (!acceptBrandWorkEvents || generation !== brandWorkHistoryGeneration) return false;
  const jobId = String(file?.jobId || "").trim();
  const registeredBrand = String(brandExportJobs.get(jobId)?.brandName || "").trim();
  const expectedBrand = String(registeredBrand || file?.brandName || "").trim();
  if (!jobId || !registeredBrand || !expectedBrand) return false;
  retainSelectedBrandName(expectedBrand);''',
)

replace_exact(
    renderer_path,
    '''  const remainingJobs = [...brandExportJobs.values()].filter((job) => !brandJobIsFinished(job.state)).length;
  $("#brand-status").textContent = remainingJobs
    ? `${expectedBrand || "선택 브랜드"} 확인완료${countLabel} · 남은 ${remainingJobs}개 브랜드 작업을 계속 감시합니다.`
    : `${expectedBrand || "선택 브랜드"} 확인완료${countLabel} · 받은 Excel 파일 메뉴에서 확인하세요.`;''',
    '''  const jobs = [...brandExportJobs.values()];
  const remainingJobs = jobs.filter((job) => !brandJobIsFinished(job.state)).length;
  const completedJobs = jobs.length - remainingJobs;
  const completionLabel = `완료 ${completedJobs}/${jobs.length}개`;
  $("#brand-status").textContent = remainingJobs
    ? `${expectedBrand} 확인완료${countLabel} · ${completionLabel} · 남은 ${remainingJobs}개 브랜드 작업을 계속 감시합니다.`
    : `${expectedBrand} 확인완료${countLabel} · ${completionLabel} · 받은 Excel 파일 메뉴에서 확인하세요.`;''',
)

replace_exact(
    renderer_path,
    '''async function drainDetectedBrandImports() {
  if (detectedBrandImportRunning) return;
  detectedBrandImportRunning = true;
  try {
    while (detectedBrandImportQueue.length) {
      const file = detectedBrandImportQueue.shift();
      const path = String(file?.path || "").trim();
      if (!path || completedBrandImportPaths.has(path)) {
        queuedBrandImportPaths.delete(path);
        continue;
      }
      updateBrandExportJob(file?.jobId, "5단계/5 · Excel 검증·프로그램 등록 중", file?.brandName);
      try {
        const generation = brandWorkHistoryGeneration;
        const imported = await importDetectedBrandExport(file, generation);
        if (imported) completedBrandImportPaths.add(path);
      } catch (error) {
        $("#brand-status").className = "status error";
        $("#brand-status").textContent = `원본 Excel 등록 실패: ${error?.message || "UNKNOWN_ERROR"}`;
      } finally {
        queuedBrandImportPaths.delete(path);
      }
    }
  } finally {
    detectedBrandImportRunning = false;
    if (detectedBrandImportQueue.length) void drainDetectedBrandImports();
  }
}

window.aroundG.onBrandExportDetected((file) => {
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
});''',
    '''async function drainDetectedBrandImports() {
  if (detectedBrandImportRunning) return;
  detectedBrandImportRunning = true;
  try {
    while (detectedBrandImportQueue.length) {
      const file = detectedBrandImportQueue.shift();
      const pathKey = brandImportPathKey(file?.path);
      const jobId = String(file?.jobId || "").trim();
      if (!pathKey || completedBrandImportPaths.has(pathKey) || completedBrandImportJobIds.has(jobId)) {
        queuedBrandImportPaths.delete(pathKey);
        continue;
      }
      updateBrandExportJob(jobId, "5단계/5 · Excel 검증·프로그램 등록 중", file?.brandName);
      try {
        const generation = brandWorkHistoryGeneration;
        const imported = await importDetectedBrandExport(file, generation);
        if (imported) {
          completedBrandImportPaths.add(pathKey);
          completedBrandImportJobIds.add(jobId);
        }
      } catch (error) {
        $("#brand-status").className = "status error";
        $("#brand-status").textContent = `원본 Excel 등록 실패: ${error?.message || "UNKNOWN_ERROR"}`;
      } finally {
        queuedBrandImportPaths.delete(pathKey);
      }
    }
  } finally {
    detectedBrandImportRunning = false;
    if (detectedBrandImportQueue.length) void drainDetectedBrandImports();
  }
}

window.aroundG.onBrandExportDetected((file) => {
  if (!acceptBrandWorkEvents) return;
  const pathKey = brandImportPathKey(file?.path);
  if (!pathKey || completedBrandImportPaths.has(pathKey) || queuedBrandImportPaths.has(pathKey)) return;
  const resolvedJobId = resolveRendererBrandJobId(file);
  if (!resolvedJobId || completedBrandImportJobIds.has(resolvedJobId)) return;
  const registeredBrand = String(brandExportJobs.get(resolvedJobId)?.brandName || "").trim();
  if (!registeredBrand) return;
  const normalizedFile = {
    ...file,
    jobId: resolvedJobId,
    brandName: registeredBrand,
  };
  updateBrandExportJob(normalizedFile.jobId, "5단계/5 · Excel 다운로드 완료 · 검증 대기", normalizedFile.brandName);
  queuedBrandImportPaths.add(pathKey);
  detectedBrandImportQueue.push(normalizedFile);
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `${normalizedFile.brandName} · 5단계/5 · Excel 검증·프로그램 등록 중`;
  void drainDetectedBrandImports();
});''',
)

replace_exact(
    main_path,
    '''    const folderBrand = newest.directory === folder ? "" : basename(newest.directory);
    const expectedBrand = folderBrand || brandFromExportFileName(newest.name) || pendingBrandExportName;
    const matchingJobs = [...brandExportJobs.entries()].filter(([_jobId, job]) =>
      normalizeBrandExportKey(job?.brandName) === normalizeBrandExportKey(expectedBrand)
      || normalizeBrandExportKey(job?.brandKo) === normalizeBrandExportKey(expectedBrand)
    );
    const matchedJobId = matchingJobs.length === 1 ? matchingJobs[0][0] : "";
    const brandIntegrity = await validateBrandExportFile(newest.path, [expectedBrand]).catch((error) => ({''',
    '''    const folderBrand = newest.directory === folder ? "" : basename(newest.directory);
    const expectedBrand = folderBrand || brandFromExportFileName(newest.name);
    if (!expectedBrand) return;
    const matchingJobs = [...brandExportJobs.entries()].filter(([_jobId, job]) =>
      normalizeBrandExportKey(job?.brandName) === normalizeBrandExportKey(expectedBrand)
      || normalizeBrandExportKey(job?.brandKo) === normalizeBrandExportKey(expectedBrand)
    );
    const matchedJobId = matchingJobs.length === 1 ? matchingJobs[0][0] : "";
    // Existing files can receive a new OneDrive modification timestamp after
    // startup. Only a file tied to one current POIZON job may emit a live
    // completion event; historical files are restored through list-files.
    if (!matchedJobId) return;
    const brandIntegrity = await validateBrandExportFile(newest.path, [expectedBrand]).catch((error) => ({''',
)

for path in [ROOT / "package.json", ROOT / "package-lock.json", *sorted((ROOT / "tests").glob("*.test.mjs"))]:
    source = path.read_text(encoding="utf-8")
    if "2.10.55" in source:
        path.write_text(source.replace("2.10.55", "2.10.56"), encoding="utf-8")

new_test = ROOT / "tests" / "duplicate-completion-v2.10.56.test.mjs"
new_test.write_text(
    '''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("restored Excel paths and job ids are registered as already completed", () => {
  assert.match(renderer, /function brandImportPathKey/);
  assert.match(renderer, /completedBrandImportPaths\.add\(pathKey\)/);
  assert.match(renderer, /completedBrandImportJobIds\.add\(jobId\)/);
  assert.match(renderer, /brandName: String\(file\.brandName \|\| saved\.brandName/);
});

test("one live job can complete only once even when the folder timestamp changes", () => {
  assert.match(renderer, /completedBrandImportJobIds\.has\(resolvedJobId\)/);
  assert.match(renderer, /if \(!resolvedJobId \|\| completedBrandImportJobIds\.has\(resolvedJobId\)\) return/);
  assert.match(renderer, /if \(!registeredBrand\) return/);
  assert.doesNotMatch(renderer, /file\?\.brandName \|\| selectedBrandName/);
});

test("folder polling never reports an unmatched historical file as live completion", () => {
  assert.match(main, /const expectedBrand = folderBrand \|\| brandFromExportFileName\(newest\.name\)/);
  assert.match(main, /if \(!matchedJobId\) return/);
  assert.doesNotMatch(main, /brandFromExportFileName\(newest\.name\) \|\| pendingBrandExportName/);
});

test("completion status exposes a unique completed count", () => {
  assert.match(renderer, /const completionLabel = `완료 \$\{completedJobs\}\/\$\{jobs\.length\}개`/);
});

test("release metadata is 2.10.56", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.56");
  assert.equal(JSON.parse(lockSource).version, "2.10.56");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.56");
});
''',
    encoding="utf-8",
)

print("Applied v2.10.56 duplicate completion patch")
