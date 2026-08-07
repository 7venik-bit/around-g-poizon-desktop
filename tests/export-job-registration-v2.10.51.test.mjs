import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Final release regression checks for POIZON export registration and queue safety.
const [main, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("export uses one click and falls back to download-center job confirmation", () => {
  assert.match(main, /labelElement\?\.closest/);
  assert.match(main, /confirmationClickCount \+= 1/);
  assert.match(main, /remainingDialogs/);
  assert.match(main, /confirmationTimedOut: !requestAcknowledged/);
  assert.match(main, /실패 처리하지 않고 다운로드센터의 새 작업번호로 최종 확인합니다/);
  assert.doesNotMatch(main, /EXPORT_REQUEST_NOT_CONFIRMED/);
  assert.doesNotMatch(main, /exportRetried/);
});

test("download center discovers jobs by number across frames instead of one localized label", () => {
  assert.match(main, /firstCellText\.match/);
  assert.match(main, /const rowHint = cells\.length >= 2/);
  assert.match(main, /readSellerExportJobsFromWindow/);
  assert.match(main, /framesInSubtree/);
  assert.match(main, /\\d\{7,/);
  assert.doesNotMatch(main, /상품\\s\*검색\.\*내보내기/);
});

test("one failed brand does not delete the remaining automatic brand queue", () => {
  assert.match(renderer, /다음 \${remainingCount}개 브랜드 작업을 계속합니다/);
  assert.match(renderer, /setTimeout\(\(\) => exportNextSelectedBrand\(generation\), 900\)/);
  assert.doesNotMatch(renderer, /나머지 선택 브랜드 자동 실행을 중단했습니다/);
});

test("release metadata is 2.10.72", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.72");
  assert.equal(JSON.parse(lockSource).version, "2.10.72");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.72");
});
