import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("a stalled domestic search stops after the main-process deadline", () => {
  const start = renderer.indexOf("async function cachedDomesticSearch(");
  const end = renderer.indexOf("function domesticSearchInput(", start);
  const cachedSearch = renderer.slice(start, end);

  assert.match(renderer, /const DOMESTIC_SEARCH_MAX_WAIT_MS = 4 \* 60 \* 1000 \+ 5_000/);
  assert.match(cachedSearch, /Promise\.race\(/);
  assert.match(cachedSearch, /timedOut: true/);
  assert.match(cachedSearch, /requestDomesticSearchCancel\(\)/);
  assert.doesNotMatch(cachedSearch, /await window\.aroundG\.cancelDomesticSearch/);
  assert.match(cachedSearch, /first\?\.timedOut/);
  assert.match(cachedSearch, /clearTimeout\(timeoutId\)/);
  assert.match(cachedSearch, /확인된 결과를 저장하고 다음 상품으로 이동합니다/);
  assert.match(cachedSearch, /activeDomesticCheckpoint/);
});

test("fallbacks share an inactivity deadline renewed for completed search or unseen stock work", () => {
  const start = main.indexOf("async function addRenderedSearchCounts(");
  const end = main.indexOf("async function verifyAllStoresWithMusinsaImage(", start);
  const renderedCounts = main.slice(start, end);

  assert.match(renderedCounts, /Promise\.race\(\[/);
  assert.match(main, /const DOMESTIC_RETAILER_HARD_TIMEOUT_MS = 90 \* 1000/);
  assert.match(renderedCounts, /let sourceDeadlineAt = Date\.now\(\) \+ DOMESTIC_RETAILER_HARD_TIMEOUT_MS/);
  assert.match(renderedCounts, /sourceTimeoutId = setTimeout\(expire, Math\.max\(0, sourceDeadlineAt - Date\.now\(\)\)\)/);
  assert.ok(renderedCounts.indexOf('const timeoutResult') > renderedCounts.indexOf('for (let queryAttemptIndex'));
  assert.match(renderedCounts, /const activity = async update =>/);
  assert.doesNotMatch(renderedCounts, /clearTimeout\(sourceTimeoutId\);\s*sourceTimeoutId = setTimeout/);
  assert.match(renderedCounts, /products: \[\.\.\.pendingProducts\]/);
  assert.match(renderedCounts, /!observedWork\.has\(work\)/);
  assert.match(renderedCounts, /renderedSearchFailure\("collection_stalled"/);
  assert.match(renderedCounts, /verificationStage: lastWork/);
  assert.match(renderedCounts, /activeDomesticSearchWindows\.clear\(\)/);
});

test("domestic search IPC has a hard timeout before rendered verification", () => {
  assert.match(main, /const DOMESTIC_SEARCH_HARD_TIMEOUT_MS = 4 \* 60 \* 1000/);
  assert.match(main, /async function withDomesticSearchHardTimeout\(operation, generation, progressState/);
  assert.match(main, /Promise\.race\(\[operation, timeoutResult\]\)/);
  assert.match(main, /return withDomesticSearchHardTimeout\(operation, searchGeneration, progressState\)/);
  assert.match(main, /if \(!domesticSearchCanceled\(generation\)\) cancelDomesticSearches\(\)/);
});
