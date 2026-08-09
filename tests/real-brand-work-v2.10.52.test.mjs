import assert from "node:assert/strict";
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
  assert.match(main, /1단계\/5 · 판매자센터 연결 시도/);
  assert.doesNotMatch(main, /EXPORT_CENTER_BASELINE_UNAVAILABLE/);
});

test("fallback job discovery requires the same unused job number twice", () => {
  assert.match(main, /unusedJobs = currentJobs\.filter/);
  assert.match(main, /fallbackCandidateStableReads >= 2/);
  assert.match(main, /새 미사용 작업번호를 확인합니다/);
});

test("UI reports activity only when actual product search starts", () => {
  assert.match(renderer, /판매자센터 연결 후 실제 상품검색 시작 중/);
  assert.match(renderer, /실제 상품검색 실행 중/);
});

test("release metadata is 2.10.116", () => {
  assert.equal(JSON.parse(pkg).version, "2.10.116");
  assert.equal(JSON.parse(lock).version, "2.10.116");
  assert.equal(JSON.parse(lock).packages[""].version, "2.10.116");
});
