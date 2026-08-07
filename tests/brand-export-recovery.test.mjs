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

test("new export job discovery waits without constant reloads", () => {
  assert.match(main, /verificationTimeoutMs = 180000/);
  assert.match(main, /elapsedMs >= 15000/);
  assert.match(main, /화면을 반복 초기화하지 않고 기다립니다/);
  assert.doesNotMatch(main, /verificationStartedAt < 45000/);
});

test("export center discovers job rows from stable job numbers across layouts and frames", () => {
  assert.match(main, /firstCellText\.match/);
  assert.match(main, /const rowHint = cells\.length >= 2/);
  assert.match(main, /jobsById/);
  assert.match(main, /framesInSubtree/);
  assert.match(main, /\\d\{7,/);
  assert.doesNotMatch(main, /상품\\s\*검색\.\*내보내기/);
});

test("release metadata is 2.10.73", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.73");
  assert.equal(JSON.parse(lockSource).version, "2.10.73");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.73");
});
