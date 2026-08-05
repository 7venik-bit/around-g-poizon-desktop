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

test("export center recognizes localized product-search export rows", () => {
  assert.match(main, /내보내기\.\*상품/);
  assert.match(main, /商品\.\*导出/);
});

test("release metadata is 2.10.49", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.49");
  assert.equal(JSON.parse(lockSource).version, "2.10.49");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.49");
});
