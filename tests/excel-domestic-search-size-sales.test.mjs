import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const patchScript = await readFile(new URL("../scripts/patch-simplify-official-naver-search.mjs", import.meta.url), "utf8");
const verifyScript = await readFile(new URL("../scripts/verify-simplify-official-naver-search.mjs", import.meta.url), "utf8");

test("Excel product conversion preserves every row that passed the explicit filters", () => {
  assert.doesNotMatch(main, /if \(chinaRecentSales < 30 \|\| localRecentSales < 30\) return \[\];/);
  assert.match(main, /Do not apply an invisible recent-sales threshold here/);
  assert.match(patchScript, /remove hidden recent-sales threshold/);
  assert.match(verifyScript, /hidden recent-sales threshold still removes qualified Excel rows/);
});
