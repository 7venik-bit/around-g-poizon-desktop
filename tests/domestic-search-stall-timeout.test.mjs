import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("a stalled domestic search stops after ten minutes and closes its browser windows", () => {
  const start = renderer.indexOf("async function cachedDomesticSearch(");
  const end = renderer.indexOf("function domesticSearchInput(", start);
  const cachedSearch = renderer.slice(start, end);

  assert.match(renderer, /const DOMESTIC_SEARCH_MAX_WAIT_MS = 10 \* 60 \* 1000/);
  assert.match(cachedSearch, /Promise\.race\(/);
  assert.match(cachedSearch, /timedOut: true/);
  assert.match(cachedSearch, /await window\.aroundG\.cancelDomesticSearch\?\.\(\)/);
  assert.match(cachedSearch, /first\?\.timedOut/);
  assert.match(cachedSearch, /clearTimeout\(timeoutId\)/);
  assert.match(cachedSearch, /국내 판매처 검색이 10분을 초과해 중단되었습니다/);
});
