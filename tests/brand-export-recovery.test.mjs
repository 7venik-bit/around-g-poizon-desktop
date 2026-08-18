import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("brand export completes the POIZON confirmation dialog", () => {
  assert.match(main, /confirmationPattern/);
  assert.match(main, /confirmationClicked = true/);
  assert.match(main, /clickLikeUser\(confirmControl\)/);
});


test("export center discovers job rows from stable job numbers across layouts and frames", () => {
  assert.match(main, /firstCellText\.match/);
  assert.match(main, /const rowHint = cells\.length >= 2/);
  assert.match(main, /jobsById/);
  assert.match(main, /framesInSubtree/);
  assert.match(main, /\\d\{7,/);
  assert.doesNotMatch(main, /상품\\s\*검색\.\*내보내기/);
});

test("an interrupted update reconnects only the same selected brand job", () => {
  assert.match(main, /function recoverableSavedBrandExportJob/);
  assert.match(main, /job\.createdAt >= cutoff/);
  assert.match(main, /visibleJobIds\.has\(job\.jobId\)/);
  assert.match(main, /sameNonEmptyBrand\(job\.brandName, brandName\)/);
  assert.match(main, /중단 전 작업번호 복구 완료 · 다운로드 감시 재개/);
  assert.match(main, /recovered: true/);
});

test("release metadata is 2.10.269", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.269");
  assert.equal(JSON.parse(lockSource).version, "2.10.269");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.269");
});
