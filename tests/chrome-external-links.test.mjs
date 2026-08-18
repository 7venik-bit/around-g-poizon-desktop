import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("program links open in a new Chrome tab on Windows", () => {
  assert.match(mainSource, /async function openExternalInChromeTab/);
  assert.match(mainSource, /Google\\Chrome\\Application\\chrome\.exe/);
  assert.match(mainSource, /'--new-tab'/);
  assert.match(mainSource, /ipcMain\.handle\("external:open"[\s\S]*?return openExternalInChromeTab\(url\)/);
});

test("official verification opens both pages through Chrome tabs", () => {
  assert.match(mainSource, /await openExternalInChromeTab\(discovery\.href\)/);
  assert.match(mainSource, /await openExternalInChromeTab\(product\.href\)/);
});

test("official mall automation clicks a magnifier before entering the article", () => {
  assert.match(mainSource, /header button,header a,button,a,\[role="button"\]/);
  assert.match(mainSource, /search\|검색\|magnif\|ico\[_-\]\?sch/);
});

test("Naver security verification shows the window and resumes in the same session", () => {
  assert.match(mainSource, /waitForNaverSecurityVerification\(searchWindow\)/);
  assert.match(mainSource, /searchWindow\.setAlwaysOnTop\(true\)/);
  assert.match(mainSource, /searchWindow\.show\(\)/);
  assert.match(mainSource, /10 \* 60_000/);
  assert.match(mainSource, /securityRetry \+ 1/);
  assert.match(mainSource, /for \(const source of data\.sources\)/);
  assert.doesNotMatch(mainSource, /Promise\.all\(data\.sources\.map/);
});
