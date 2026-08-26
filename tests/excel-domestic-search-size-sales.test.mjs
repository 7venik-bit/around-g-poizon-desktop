import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const patchScript = await readFile(new URL("../scripts/patch-simplify-official-naver-search.mjs", import.meta.url), "utf8");
const verifyScript = await readFile(new URL("../scripts/verify-simplify-official-naver-search.mjs", import.meta.url), "utf8");

test("domestic product search excludes size rows below both recent-sales thresholds", () => {
  assert.match(main, /columns\.sales30d >= 0 && columns\.localSales30d >= 0/);
  assert.match(main, /if \(chinaRecentSales < 30 \|\| localRecentSales < 30\) return \[\];/);
  assert.match(patchScript, /exclude low-selling size rows from domestic search/);
  assert.match(verifyScript, /low-selling size rows can still enter domestic search/);
});
