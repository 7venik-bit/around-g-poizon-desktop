import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));

test("Naver search waits for stable rendered cards before accepting results", () => {
  assert.match(main, /async function waitForNaverSearchResultsStable\(searchWindow, query\)/);
  assert.match(main, /stableSamples >= 4/);
  assert.match(main, /return await waitForNaverSearchResultsStable\(searchWindow, exactQuery\);/);
  assert.doesNotMatch(main, /queryVisibleInPage\)\)\) return true;/);
});

test("shared Naver result window closes only after capture grace", () => {
  assert.match(main, /post-capture grace period/);
  assert.match(main, /await wait\(2_000\);\s*sharedNaverSession\.window\.destroy\(\);/);
});
