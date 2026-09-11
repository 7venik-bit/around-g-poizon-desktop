import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, preload, renderer] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);

test("single-product loading progress advances for every completed retailer", () => {
  assert.match(main, /onProgress\?\.\(\{ completed: 0, total: data\.sources\.length/);
  assert.match(main, /completed: sources\.length/);
  assert.match(main, /_event\.sender\.send\("domestic-search:progress"/);
  assert.match(preload, /onDomesticSearchProgress/);
  assert.match(preload, /ipcRenderer\.on\("domestic-search:progress"/);
  assert.match(renderer, /onDomesticSearchProgress\?\.\(\(payload = \{\}\)/);
  assert.match(renderer, /개 판매처/);
  assert.match(renderer, /progress\.value = percent/);
});
