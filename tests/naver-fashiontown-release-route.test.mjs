import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const patch = await readFile(new URL("../scripts/patch-simplify-official-naver-search.mjs", import.meta.url), "utf8");
const verify = await readFile(new URL("../scripts/verify-simplify-official-naver-search.mjs", import.meta.url), "utf8");

test("release patch gates only channel counts, never the physical click route", () => {
  assert.doesNotMatch(patch, /replaceAllRequired\([\s\S]*?'    if \(naverPortalSource\) \{'/);
  assert.match(patch, /The three Fashion Town totals are the authoritative routing decision/);
  assert.match(patch, /replaceOnce\(/);
  assert.match(verify, /Fashion Town click route is disabled by the channel-count gate/);
  assert.match(verify, /interactiveBlock\.includes\('if \(naverPortalSource\) \{'\)/);
});
