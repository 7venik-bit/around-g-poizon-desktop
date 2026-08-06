from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "main.mjs"
RENDERER = ROOT / "src" / "renderer.js"


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


replace_once(
    MAIN,
    '''async function listBrandExportFiles() {
  const folder = currentBrandExportFolder();
  await mkdir(folder, { recursive: true });
  const entries = await listBrandExportExcelEntries(folder);
  const files = [];
  for (const entry of entries
    .filter((entry) => !isProcessedBrandExportName(entry.name) && !isPartialBrandExportName(entry.name))) {
        const path = entry.path;
        const info = await stat(path);
        const folderBrand = entry.directory === folder ? "" : basename(entry.directory);
        const expectedBrand = folderBrand || brandFromExportFileName(entry.name);
        const brandIntegrity = await validateBrandExportFile(path, [expectedBrand]).catch((error) => ({
          ok: false,
          status: "invalid",
          expectedBrand,
          dominantBrand: "",
          ratio: 0,
          message: `Excel 브랜드 확인 실패: ${error instanceof Error ? error.message : String(error)}`,
        }));
        files.push({
          path,
          name: entry.name,
          brandName: expectedBrand,
          brandIntegrity,
          jobId: "",
          time: info.mtimeMs,
          mtimeMs: info.mtimeMs,
          size: info.size,
        });
  }
  const visibleFiles = files.filter((file) => !isProcessedBrandExportName(file.name));
  visibleFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { ok: true, folder, files: visibleFiles };
}''',
    '''async function listBrandExportFiles() {
  const folder = currentBrandExportFolder();
  await mkdir(folder, { recursive: true });
  const entries = await listBrandExportExcelEntries(folder);
  const preparedEntries = await Promise.all(entries
    .filter((entry) => !isProcessedBrandExportName(entry.name) && !isPartialBrandExportName(entry.name))
    .map(async (entry) => ({ entry, info: await stat(entry.path) })));
  preparedEntries.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);
  const usedJobIds = new Set();
  const files = [];
  for (const { entry, info } of preparedEntries) {
    const path = entry.path;
    const folderBrand = entry.directory === folder ? "" : basename(entry.directory);
    const expectedBrand = folderBrand || brandFromExportFileName(entry.name);
    const savedJob = savedBrandExportJobForFile({
      path,
      name: entry.name,
      brandName: expectedBrand,
      mtimeMs: info.mtimeMs,
    }, usedJobIds);
    const recoveredJobId = String(savedJob?.jobId || "").trim();
    if (recoveredJobId) usedJobIds.add(recoveredJobId);
    const brandIntegrity = await validateBrandExportFile(path, [expectedBrand]).catch((error) => ({
      ok: false,
      status: "invalid",
      expectedBrand,
      dominantBrand: "",
      ratio: 0,
      message: `Excel 브랜드 확인 실패: ${error instanceof Error ? error.message : String(error)}`,
    }));
    files.push({
      path,
      name: entry.name,
      brandName: expectedBrand,
      brandIntegrity,
      jobId: recoveredJobId,
      jobIdRecovered: Boolean(recoveredJobId),
      time: info.mtimeMs,
      mtimeMs: info.mtimeMs,
      size: info.size,
    });
  }
  const visibleFiles = files.filter((file) => !isProcessedBrandExportName(file.name));
  visibleFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { ok: true, folder, files: visibleFiles };
}''',
)

replace_once(
    MAIN,
    '''function savedBrandExportJobs() {
  const saved = store?.snapshot()?.settings?.brandExportJobCache;
  return Array.isArray(saved) ? saved : [];
}

function restorePendingBrandExportJobs() {''',
    '''function savedBrandExportJobs() {
  const saved = store?.snapshot()?.settings?.brandExportJobCache;
  return Array.isArray(saved) ? saved : [];
}

function normalizeSavedBrandExportPath(value = "") {
  return String(value || "")
    .trim()
    .replace(/[\\\\/]+/g, "\\\\")
    .toLocaleLowerCase();
}

function savedBrandExportJobForFile(input = {}, usedJobIds = new Set()) {
  const pathKey = normalizeSavedBrandExportPath(input.path);
  const fileNameKey = String(input.name || "").trim().toLocaleLowerCase();
  const brandKey = normalizeBrandExportKey(input.brandName);
  const mtimeMs = Number(input.mtimeMs || 0);
  const candidates = savedBrandExportJobs()
    .map((item) => ({
      ...item,
      jobId: String(item?.jobId || "").trim(),
      brandName: String(item?.brandName || "").trim(),
      brandKo: String(item?.brandKo || "").trim(),
      filePath: String(item?.filePath || "").trim(),
      fileName: String(item?.fileName || "").trim(),
      fileMtimeMs: Number(item?.fileMtimeMs || 0),
      lastDownloadedAt: Number(item?.lastDownloadedAt || 0),
      createdAt: Number(item?.createdAt || 0),
    }))
    .filter((item) => item.jobId && item.lastDownloadedAt > 0 && !usedJobIds.has(item.jobId));
  const exactPath = pathKey
    ? candidates.find((item) => normalizeSavedBrandExportPath(item.filePath) === pathKey)
    : null;
  if (exactPath) return exactPath;
  const brandMatches = (item) => {
    if (!brandKey) return false;
    return normalizeBrandExportKey(item.brandName) === brandKey
      || normalizeBrandExportKey(item.brandKo) === brandKey;
  };
  const exactNameMatches = fileNameKey
    ? candidates.filter((item) => item.fileName.toLocaleLowerCase() === fileNameKey && brandMatches(item))
    : [];
  if (exactNameMatches.length === 1) return exactNameMatches[0];
  const brandCandidates = candidates.filter(brandMatches);
  if (!brandCandidates.length) return null;
  const scored = brandCandidates.map((item) => {
    const referenceTime = item.fileMtimeMs || item.lastDownloadedAt || item.createdAt;
    return {
      item,
      difference: mtimeMs > 0 && referenceTime > 0
        ? Math.abs(mtimeMs - referenceTime)
        : Number.POSITIVE_INFINITY,
    };
  }).sort((left, right) => left.difference - right.difference);
  const nearest = scored[0];
  const second = scored[1];
  const maximumDifference = 24 * 60 * 60 * 1000;
  if (nearest && nearest.difference <= maximumDifference
    && (!second || second.difference - nearest.difference >= 30_000)) {
    return nearest.item;
  }
  return brandCandidates.length === 1 ? brandCandidates[0] : null;
}

function restorePendingBrandExportJobs() {''',
)

replace_once(
    MAIN,
    '''  const next = {
    jobId,
    brandName,
    brandKo,
    brandKey: normalizeBrandExportKey(brandName),
    createdAt: Number(input.createdAt) || Date.now(),
    lastDownloadedAt: Number(input.lastDownloadedAt) || 0,
    expectedProductCount: Number(input.expectedProductCount) || 0,
  };''',
    '''  const next = {
    jobId,
    brandName,
    brandKo,
    brandKey: normalizeBrandExportKey(brandName),
    createdAt: Number(input.createdAt) || Date.now(),
    lastDownloadedAt: Number(input.lastDownloadedAt) || 0,
    expectedProductCount: Number(input.expectedProductCount) || 0,
    filePath: String(input.filePath || "").trim(),
    fileName: String(input.fileName || "").trim(),
    fileMtimeMs: Number(input.fileMtimeMs) || 0,
  };''',
)

replace_once(
    MAIN,
    '''        await rememberBrandExportJob({
          jobId: downloadJobId,
          brandName: downloadJob.brandName,
          createdAt: downloadJob.createdAt,
          lastDownloadedAt: Date.now(),
          expectedProductCount,
          sessionGeneration,
        });''',
    '''        await rememberBrandExportJob({
          jobId: downloadJobId,
          brandName: downloadJob.brandName,
          createdAt: downloadJob.createdAt,
          lastDownloadedAt: Date.now(),
          expectedProductCount,
          filePath: finalPath,
          fileName: finalName,
          fileMtimeMs: info.mtimeMs,
          sessionGeneration,
        });''',
)

renderer_source = RENDERER.read_text(encoding="utf-8")
renderer_source = renderer_source.replace(
    'file.jobId ? `작업번호 ${text(file.jobId)}` : "작업번호 확인 불가"',
    'file.jobId ? `작업번호 ${text(file.jobId)}` : "과거 파일 · 작업번호 기록 없음"',
)
RENDERER.write_text(renderer_source, encoding="utf-8")

for path in [ROOT / "package.json", ROOT / "package-lock.json"]:
    data = json.loads(path.read_text(encoding="utf-8"))
    data["version"] = "2.10.59"
    if path.name == "package-lock.json":
        data.setdefault("packages", {}).setdefault("", {})["version"] = "2.10.59"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

for test_path in (ROOT / "tests").glob("*.test.mjs"):
    source = test_path.read_text(encoding="utf-8")
    source = source.replace("2.10.58", "2.10.59")
    test_path.write_text(source, encoding="utf-8")

new_test = ROOT / "tests" / "recover-file-job-ids-v2.10.59.test.mjs"
new_test.write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("restored Excel files recover job ids from persisted file metadata", () => {
  assert.match(main, /function savedBrandExportJobForFile/);
  assert.match(main, /normalizeSavedBrandExportPath\(item\.filePath\) === pathKey/);
  assert.match(main, /item\.fileName\.toLocaleLowerCase\(\) === fileNameKey/);
  assert.match(main, /jobId: recoveredJobId/);
  assert.doesNotMatch(main, /brandIntegrity,\s*jobId: "",\s*time: info\.mtimeMs/);
});

test("future downloads persist a direct file-to-job association", () => {
  assert.match(main, /filePath: String\(input\.filePath \|\| ""\)\.trim\(\)/);
  assert.match(main, /fileName: String\(input\.fileName \|\| ""\)\.trim\(\)/);
  assert.match(main, /fileMtimeMs: Number\(input\.fileMtimeMs\) \|\| 0/);
  assert.match(main, /filePath: finalPath/);
  assert.match(main, /fileName: finalName/);
  assert.match(main, /fileMtimeMs: info\.mtimeMs/);
});

test("legacy files without any surviving cache are labeled as historical records", () => {
  assert.match(renderer, /과거 파일 · 작업번호 기록 없음/);
  assert.doesNotMatch(renderer, /작업번호 확인 불가/);
});

test("release metadata is 2.10.59", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.59");
  assert.equal(JSON.parse(lockSource).version, "2.10.59");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.59");
});
''', encoding="utf-8")

print("Applied v2.10.59 file-to-job recovery patch")
