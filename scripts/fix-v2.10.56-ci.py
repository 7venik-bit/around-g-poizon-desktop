from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_exact(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


renderer = ROOT / "src" / "renderer.js"
test_file = ROOT / "tests" / "duplicate-completion-v2.10.56.test.mjs"

replace_exact(
    renderer,
    '''function brandJobIsFinished(state = "") {
  return /확인완료|완료됨|실패|오류|중단|취소/.test(String(state || ""));
}
''',
    '''function brandJobIsFinished(state = "") {
  return /확인완료|완료됨|실패|오류|중단|취소/.test(String(state || ""));
}

function brandJobIsDownloaded(state = "") {
  return /확인완료/.test(String(state || ""));
}
''',
)

replace_exact(
    renderer,
    '''  const registeredBrand = String(brandExportJobs.get(jobId)?.brandName || "").trim();
  const expectedBrand = String(registeredBrand || file?.brandName || "").trim();
  if (!jobId || !registeredBrand || !expectedBrand) return false;''',
    '''  const registeredBrand = String(brandExportJobs.get(jobId)?.brandName || "").trim();
  const expectedBrand = registeredBrand;
  if (!jobId || !expectedBrand) return false;''',
)

replace_exact(
    renderer,
    '''  const jobs = [...brandExportJobs.values()];
  const remainingJobs = jobs.filter((job) => !brandJobIsFinished(job.state)).length;
  const completedJobs = jobs.length - remainingJobs;
  const completionLabel = `완료 ${completedJobs}/${jobs.length}개`;''',
    '''  const jobs = [...brandExportJobs.values()];
  const remainingJobs = jobs.filter((job) => !brandJobIsFinished(job.state)).length;
  const completedJobs = jobs.filter((job) => brandJobIsDownloaded(job.state)).length;
  const completionLabel = `다운로드 완료 ${completedJobs}/${jobs.length}개`;''',
)

source = test_file.read_text(encoding="utf-8")
source = source.replace(
    '''test("one live job can complete only once even when the folder timestamp changes", () => {
  assert.match(renderer, /completedBrandImportJobIds\\.has\\(resolvedJobId\\)/);
  assert.match(renderer, /if \\(!resolvedJobId \\|\\| completedBrandImportJobIds\\.has\\(resolvedJobId\\)\\) return/);
  assert.match(renderer, /if \\(!registeredBrand\\) return/);
  assert.doesNotMatch(renderer, /file\\?\\.brandName \\|\\| selectedBrandName/);
});''',
    '''test("one live job can complete only once even when the folder timestamp changes", () => {
  assert.match(renderer, /completedBrandImportJobIds\\.has\\(resolvedJobId\\)/);
  assert.match(renderer, /if \\(!resolvedJobId \\|\\| completedBrandImportJobIds\\.has\\(resolvedJobId\\)\\) return/);
  assert.match(renderer, /if \\(!registeredBrand\\) return/);
  const importBlock = renderer.match(
    /async function importDetectedBrandExport[\\s\\S]*?\\n}\\n\\nasync function drainDetectedBrandImports/
  )?.[0] || "";
  assert.match(importBlock, /const expectedBrand = registeredBrand/);
  assert.doesNotMatch(importBlock, /selectedBrandName/);
});''',
)
source = source.replace(
    '''test("completion status exposes a unique completed count", () => {
  assert.match(renderer, /const completionLabel = `완료 \\$\\{completedJobs\\}\\/\\$\\{jobs\\.length\\}개`/);
});''',
    '''test("completion status counts only downloaded jobs", () => {
  assert.match(renderer, /function brandJobIsDownloaded/);
  assert.match(renderer, /const completedJobs = jobs\\.filter\\(\\(job\\) => brandJobIsDownloaded\\(job\\.state\\)\\)\\.length/);
  assert.match(renderer, /const completionLabel = `다운로드 완료 \\$\\{completedJobs\\}\\/\\$\\{jobs\\.length\\}개`/);
});''',
)
test_file.write_text(source, encoding="utf-8")

print("Corrected v2.10.56 completion counting and CI scope")
