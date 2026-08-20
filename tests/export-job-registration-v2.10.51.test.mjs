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


test("download center discovers jobs by number across frames instead of one localized label", () => {
  assert.match(main, /firstCellText\.match/);
  assert.match(main, /const rowHint = cells\.length >= 2/);
  assert.match(main, /readSellerExportJobsFromWindow/);
  assert.match(main, /framesInSubtree/);
  assert.match(main, /\\d\{7,/);
  assert.doesNotMatch(main, /상품\\s\*검색\.\*내보내기/);
});


test("release metadata is 2.10.304", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.304");
  assert.equal(JSON.parse(lockSource).version, "2.10.304");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.304");
});
