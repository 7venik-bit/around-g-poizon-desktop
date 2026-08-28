import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
const inventory = fs.readFileSync(new URL("../src/inventory.js", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../preload.cjs", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");

test("all domestic search stop buttons cancel the main-process search immediately", () => {
  assert.match(preload, /cancelDomesticSearch: \(\) => ipcRenderer\.invoke\("domestic:cancel"\)/);
  assert.match(main, /ipcMain\.handle\("domestic:cancel", \(\) => cancelDomesticSearches\(\)\)/);
  assert.match(main, /activeDomesticSearchWindows/);
  assert.match(renderer, /window\.aroundG\.cancelDomesticSearch\?\.\(\)/);
  assert.match(inventory, /window\.aroundG\.cancelDomesticSearch\?\.\(\)/);
});

test("a canceled request cannot publish results or continue to another source", () => {
  assert.match(main, /domesticSearchCanceled\(searchGeneration\)/);
  assert.match(main, /DOMESTIC_SEARCH_CANCELED/);
  assert.match(renderer, /response\?\.canceled \|\| domesticBatchStopRequested/);
});
