import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Excel import uses deduplicated 500-item bulk writes", async () => {
  const patch = String(await readFile(new URL("../scripts/patch-excel-import-bulk-save.mjs", import.meta.url), "utf8"));
  const verify = String(await readFile(new URL("../scripts/verify-excel-import-bulk-save.mjs", import.meta.url), "utf8"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(patch, /importItemsByIdentity = new Map\(\)/);
  assert.match(patch, /start \+= 500/);
  assert.match(patch, /store\.bulkUpsert\("products", importItems\.slice\(start, start \+ 500\)\)/);
  assert.match(patch, /Excel 불러오는 중…/);
  assert.doesNotMatch(verify, /allow row-by-row/i);
  assert.match(pkg.scripts.postinstall, /patch-excel-import-bulk-save\.mjs/);
  assert.match(pkg.scripts.postinstall, /verify-excel-import-bulk-save\.mjs/);
});
