import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Release regression guard.
const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("every release workflow preserves the canonical Naver implementation", async () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    ".github/workflows/windows-package-test.yml",
  ]) {
    const workflow = await read(path);
    assert.doesNotMatch(workflow, /patch-official-trust-and-search-result/);
    assert.doesNotMatch(workflow, /verify-official-trust-and-search-result/);
  }
});

test("the remaining build patch preserves the canonical Naver overview flow", async () => {
  const patchSource = await read("scripts/patch-simplify-official-naver-search.mjs");
  assert.match(patchSource, /canonical application now owns Naver's visible card-list flow/);
  assert.match(patchSource, /if \(false\) relay = replaceOnce/);
  assert.match(patchSource, /if \(false\) renderer = replaceOnce/);
  assert.match(patchSource, /canonical Naver card-list logic preserved/);
});

test("the packaged-source verifier rejects duplicate Naver source rows", async () => {
  const verifier = await read("scripts/verify-simplify-official-naver-search.mjs");
  assert.match(verifier, /articleTextCardLinks/);
  assert.match(verifier, /cardCollectionMissed/);
  assert.match(verifier, /still runs as a duplicate Naver search/);
});
