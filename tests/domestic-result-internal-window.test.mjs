import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const keepPatch = await readFile(new URL("../scripts/patch-close-domestic-search-windows.mjs", import.meta.url), "utf8");

test("domestic marketplace result buttons reopen the controlled persistent window", () => {
  assert.match(main, /ipcMain\.handle\("domestic:open-result"/);
  assert.match(main, /partition: DOMESTIC_SEARCH_PARTITION/);
  assert.match(main, /existing\.show\(\)/);
  assert.match(main, /existing\.focus\(\)/);
  assert.match(preload, /openDomesticResult/);
  assert.match(renderer, /data-domestic-result-url/);
  assert.match(renderer, /window\.aroundG\.openDomesticResult/);
  assert.doesNotMatch(renderer, /data-domestic-result-url[^\n]+openExternal/);
  assert.match(keepPatch, /Naver result window remains available for in-app reopening/);
});
