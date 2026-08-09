import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [bootstrap, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../bootstrap.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("startup asks before restoring unfinished POIZON downloads", () => {
  assert.match(bootstrap, /channel !== "brand-export:pending-jobs"/);
  assert.match(bootstrap, /미다운로드 작업 \$\{pending\.length\}개가 있습니다/);
  assert.match(bootstrap, /buttons: \["작업 재개", "나중에"\]/);
  assert.match(bootstrap, /defaultId: 1/);
  assert.match(bootstrap, /cancelId: 1/);
});

test("choosing later preserves jobs but prevents automatic monitor startup", () => {
  assert.match(bootstrap, /pendingBrandResumeDecision === "resume" \? jobs : \[\]/);
  assert.match(bootstrap, /업데이트를 먼저 설치할 수 있습니다/);
  assert.match(bootstrap, /미다운로드 작업 기록은 삭제되지 않습니다/);
  const restore = renderer.match(/async function restorePendingBrandExportJobs[\s\S]*?\n}/)?.[0] || "";
  assert.match(restore, /if \(!pending\.length\) return/);
  assert.match(restore, /await window\.aroundG\.startSellerBrandExportMonitor\(\)/);
});

test("release metadata is 2.10.103", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.103");
  assert.equal(JSON.parse(lockSource).version, "2.10.103");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.103");
});
