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

test("export uses the clickable control and completes every confirmation dialog", () => {
  assert.match(main, /labelElement\?\.closest/);
  assert.match(main, /confirmationClickCount \+= 1/);
  assert.match(main, /remainingDialogs/);
  assert.match(main, /if \(!requestAcknowledged\)/);
  assert.match(main, /EXPORT_REQUEST_NOT_CONFIRMED/);
  assert.match(main, /exportRetried = true/);
});

test("download center discovers jobs by number across frames instead of one localized label", () => {
  assert.match(main, /firstCellText\.match/);
  assert.match(main, /const rowHint = cells\.length >= 2/);
  assert.match(main, /readSellerExportJobsFromWindow/);
  assert.match(main, /framesInSubtree/);
  assert.match(main, /\\d\{7,/);
  assert.doesNotMatch(main, /상품\\s\*검색\.\*내보내기/);
});

test("one failed brand stops the remaining automatic brand queue", () => {
  assert.match(renderer, /brandExportQueue = \[\]/);
  assert.match(renderer, /나머지 선택 브랜드 자동 실행을 중단했습니다/);
  assert.match(renderer, /이미 등록된 작업만 계속 감시 중/);
});

test("release metadata is 2.10.52", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.52");
  assert.equal(JSON.parse(lockSource).version, "2.10.52");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.52");
});
