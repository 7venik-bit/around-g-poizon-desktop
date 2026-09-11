import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("a stalled domestic search stops after the main-process deadline", () => {
  const start = renderer.indexOf("async function cachedDomesticSearch(");
  const end = renderer.indexOf("function domesticSearchInput(", start);
  const cachedSearch = renderer.slice(start, end);

  assert.match(renderer, /const DOMESTIC_SEARCH_MAX_WAIT_MS = 2 \* 60 \* 1000 \+ 5_000/);
  assert.match(cachedSearch, /Promise\.race\(/);
  assert.match(cachedSearch, /timedOut: true/);
  assert.match(cachedSearch, /requestDomesticSearchCancel\(\)/);
  assert.doesNotMatch(cachedSearch, /await window\.aroundG\.cancelDomesticSearch/);
  assert.match(cachedSearch, /first\?\.timedOut/);
  assert.match(cachedSearch, /clearTimeout\(timeoutId\)/);
  assert.match(cachedSearch, /국내 판매처 검색 응답이 없어 강제 종료했습니다/);
});

test("each retailer shares one timeout budget across all accuracy fallbacks", () => {
  const start = main.indexOf("async function addRenderedSearchCounts(");
  const end = main.indexOf("async function verifyAllStoresWithMusinsaImage(", start);
  const renderedCounts = main.slice(start, end);

  assert.match(renderedCounts, /Promise\.race\(\[/);
  assert.match(renderedCounts, /const sourceDeadline = Date\.now\(\) \+ 30_000/);
  assert.match(renderedCounts, /remainingSourceMs = sourceDeadline - Date\.now\(\)/);
  assert.match(renderedCounts, /renderedSearchFailure\("page_load_timeout"/);
  assert.match(renderedCounts, /verificationStage: "source_timeout"/);
  assert.match(renderedCounts, /activeDomesticSearchWindows\.clear\(\)/);
});

test("domestic search IPC has a hard timeout before rendered verification", () => {
  assert.match(main, /const DOMESTIC_SEARCH_HARD_TIMEOUT_MS = 2 \* 60 \* 1000/);
  assert.match(main, /async function withDomesticSearchHardTimeout\(operation, generation\)/);
  assert.match(main, /Promise\.race\(\[operation, timeoutResult\]\)/);
  assert.match(main, /return withDomesticSearchHardTimeout\(operation, searchGeneration\)/);
  assert.match(main, /if \(!domesticSearchCanceled\(generation\)\) cancelDomesticSearches\(\)/);
});
