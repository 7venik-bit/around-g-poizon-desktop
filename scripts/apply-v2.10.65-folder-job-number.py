from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

main = ROOT / "main.mjs"
source = main.read_text(encoding="utf-8")

safe_label_match = re.search(
    r'function safeBrandExportLabel\(value = ""\) \{[\s\S]*?\n\}',
    source,
)
if not safe_label_match:
    raise RuntimeError("safeBrandExportLabel function not found")
helpers = '''

function brandExportFolderName(brandName = "", jobId = "") {
  const safeBrand = safeBrandExportLabel(brandName);
  const safeJobId = String(jobId || "").replace(/[^0-9]/g, "").trim();
  return safeJobId ? `${safeBrand}_${safeJobId}` : safeBrand;
}

function parseBrandExportFolderName(folderName = "") {
  const normalized = String(folderName || "").trim();
  const matched = normalized.match(/^(.*)_([0-9]{7,})$/);
  return matched
    ? { brandName: String(matched[1] || "").trim(), jobId: matched[2] }
    : { brandName: normalized, jobId: "" };
}
'''
source = source[:safe_label_match.end()] + helpers + source[safe_label_match.end():]

old_list = '''    const path = entry.path;
    const folderBrand = entry.directory === folder ? "" : basename(entry.directory);
    const expectedBrand = folderBrand || brandFromExportFileName(entry.name);
    const savedJob = savedBrandExportJobForFile({
      path,
      name: entry.name,
      brandName: expectedBrand,
      mtimeMs: info.mtimeMs,
    }, usedJobIds);
    const recoveredJobId = String(savedJob?.jobId || "").trim();
'''
new_list = '''    const path = entry.path;
    const folderMeta = entry.directory === folder
      ? { brandName: "", jobId: "" }
      : parseBrandExportFolderName(basename(entry.directory));
    const expectedBrand = folderMeta.brandName || brandFromExportFileName(entry.name);
    const savedJob = savedBrandExportJobForFile({
      path,
      name: entry.name,
      brandName: expectedBrand,
      mtimeMs: info.mtimeMs,
    }, usedJobIds);
    const recoveredJobId = String(folderMeta.jobId || savedJob?.jobId || "").trim();
'''
if source.count(old_list) != 1:
    raise RuntimeError(f"listBrandExportFiles folder block found {source.count(old_list)} times")
source = source.replace(old_list, new_list, 1)

old_scan = '''    const folderBrand = newest.directory === folder ? "" : basename(newest.directory);
    const expectedBrand = folderBrand || brandFromExportFileName(newest.name);
    if (!expectedBrand) return;
    const matchingJobs = [...brandExportJobs.entries()].filter(([_jobId, job]) =>
      normalizeBrandExportKey(job?.brandName) === normalizeBrandExportKey(expectedBrand)
      || normalizeBrandExportKey(job?.brandKo) === normalizeBrandExportKey(expectedBrand)
    );
    const matchedJobId = matchingJobs.length === 1 ? matchingJobs[0][0] : "";
'''
new_scan = '''    const folderMeta = newest.directory === folder
      ? { brandName: "", jobId: "" }
      : parseBrandExportFolderName(basename(newest.directory));
    const expectedBrand = folderMeta.brandName || brandFromExportFileName(newest.name);
    if (!expectedBrand) return;
    const matchingJobs = [...brandExportJobs.entries()].filter(([_jobId, job]) =>
      normalizeBrandExportKey(job?.brandName) === normalizeBrandExportKey(expectedBrand)
      || normalizeBrandExportKey(job?.brandKo) === normalizeBrandExportKey(expectedBrand)
    );
    const folderJobId = folderMeta.jobId && brandExportJobs.has(folderMeta.jobId)
      ? folderMeta.jobId
      : "";
    const matchedJobId = folderJobId || (matchingJobs.length === 1 ? matchingJobs[0][0] : "");
'''
if source.count(old_scan) != 1:
    raise RuntimeError(f"scanBrandExportFolder folder block found {source.count(old_scan)} times")
source = source.replace(old_scan, new_scan, 1)

old_download_folder = '''    const exportBrand = safeBrandExportLabel(downloadJob.brandName);
    const brandFolder = join(folder, exportBrand);
'''
new_download_folder = '''    const exportBrand = safeBrandExportLabel(downloadJob.brandName);
    const brandFolder = join(folder, brandExportFolderName(exportBrand, downloadJobId));
'''
if source.count(old_download_folder) != 1:
    raise RuntimeError(f"download folder block found {source.count(old_download_folder)} times")
source = source.replace(old_download_folder, new_download_folder, 1)

old_detected_folder = '''          const detectedFolder = join(folder, detectedBrand);
'''
new_detected_folder = '''          const detectedFolder = join(folder, brandExportFolderName(detectedBrand, downloadJobId));
'''
if source.count(old_detected_folder) != 1:
    raise RuntimeError(f"detected folder block found {source.count(old_detected_folder)} times")
source = source.replace(old_detected_folder, new_detected_folder, 1)

main.write_text(source, encoding="utf-8")

for relative in ["package.json", "package-lock.json"]:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    if '"version": "2.10.64"' not in text:
        raise RuntimeError(f"{relative}: 2.10.64 version not found")
    path.write_text(text.replace('"version": "2.10.64"', '"version": "2.10.65"'), encoding="utf-8")

for path in sorted((ROOT / "tests").glob("*.test.mjs")):
    text = path.read_text(encoding="utf-8")
    if "2.10.64" in text:
        path.write_text(text.replace("2.10.64", "2.10.65"), encoding="utf-8")

new_test = ROOT / "tests" / "brand-folder-job-number-v2.10.65.test.mjs"
new_test.write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("new downloads use brand and POIZON job number in the folder name", () => {
  assert.match(main, /function brandExportFolderName/);
  assert.match(main, /return safeJobId \? `\$\{safeBrand\}_\$\{safeJobId\}` : safeBrand/);
  assert.match(main, /join\(folder, brandExportFolderName\(exportBrand, downloadJobId\)\)/);
  assert.match(main, /join\(folder, brandExportFolderName\(detectedBrand, downloadJobId\)\)/);
});

test("folder job number is restored before the legacy cache and old brand-only folders remain supported", () => {
  assert.match(main, /function parseBrandExportFolderName/);
  assert.match(main, /normalized\.match\(\/\^\(\.\*\)_\(\[0-9\]\{7,\}\)\$\//);
  assert.match(main, /folderMeta\.jobId \|\| savedJob\?\.jobId/);
  assert.match(main, /folderMeta\.brandName \|\| brandFromExportFileName/);
  assert.match(main, /folderJobId \|\| \(matchingJobs\.length === 1/);
});

test("release metadata is 2.10.65", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.65");
  assert.equal(JSON.parse(lockSource).version, "2.10.65");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.65");
});
''', encoding="utf-8")

print("Applied v2.10.65 brand-job folder naming patch")
