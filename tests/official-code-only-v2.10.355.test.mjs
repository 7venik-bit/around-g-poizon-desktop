import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");

test("every official mall tries the exact product code first", () => {
  assert.match(relay, /sanitizeDomesticQuery\(articleNumber \|\| productCode \|\| preferredQuery\)/);
  assert.match(relay, /const orderedProductQueries = \[\s*exactProductCode,\s*exactProductTitle/s);
  assert.match(relay, /searchAttempts: queryCandidates\.map/);
});

test("official search opens and submits with physical mouse events", () => {
  assert.match(main, /prepared\?\.openTarget/);
  assert.match(main, /prepared\.target && frame === searchWindow\.webContents\.mainFrame/);
  assert.match(main, /sendInputEvent\(\{ type: "mouseDown"/);
  assert.match(main, /sendInputEvent\(\{ type: "mouseUp"/);
});

test("text left in the input is not accepted as an executed search", () => {
  assert.match(main, /Merely seeing the code in the search input\/suggestion is not proof/);
  assert.match(main, /state\.pageMatched && \(state\.resultCount \|\| state\.productLinks > 0\)/);
  assert.doesNotMatch(main, /return Boolean\([^\n]*state\.inputMatched/);
});
