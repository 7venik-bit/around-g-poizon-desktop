import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("a stalled domestic search stops after five minutes and closes its browser windows", () => {
  const start = renderer.indexOf("async function cachedDomesticSearch(");
  const end = renderer.indexOf("function domesticSearchInput(", start);
  const cachedSearch = renderer.slice(start, end);

  assert.match(renderer, /const DOMESTIC_SEARCH_MAX_WAIT_MS = 5 \* 60 \* 1000/);
  assert.match(cachedSearch, /Promise\.race\(/);
  assert.match(cachedSearch, /timedOut: true/);
  assert.match(cachedSearch, /await window\.aroundG\.cancelDomesticSearch\?\.\(\)/);
  assert.match(cachedSearch, /first\?\.timedOut/);
  assert.match(cachedSearch, /clearTimeout\(timeoutId\)/);
  assert.match(cachedSearch, /국내 판매처 검색이 5분을 초과해 중단되었습니다/);
});

test("each unresponsive retailer is skipped after one minute", async () => {
  const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  const start = main.indexOf("async function addRenderedSearchCounts(");
  const end = main.indexOf("async function verifyAllStoresWithMusinsaImage(", start);
  const renderedCounts = main.slice(start, end);

  assert.match(renderedCounts, /Promise\.race\(\[/);
  assert.match(renderedCounts, /60_000/);
  assert.match(renderedCounts, /renderedSearchFailure\("page_load_timeout"/);
  assert.match(renderedCounts, /verificationStage: "source_timeout"/);
  assert.match(renderedCounts, /activeDomesticSearchWindows\.clear\(\)/);
});
