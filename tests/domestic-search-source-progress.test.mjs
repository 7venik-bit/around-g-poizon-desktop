import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, preload, renderer] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);

test("retailer progress updates the guide without replacing product-batch progress", () => {
  assert.match(main, /const progressTotal = data\.sources\.length \+ 2/);
  assert.match(main, /onProgress\?\.\(\{ completed: 0, total: progressTotal/);
  assert.match(main, /completed: sources\.length/);
  assert.match(main, /source: "결과 일치도 확인"/);
  assert.match(main, /source: "이미지 교차검증"/);
  assert.match(main, /_event\.sender\.send\("domestic-search:progress"/);
  assert.match(preload, /onDomesticSearchProgress/);
  assert.match(preload, /ipcRenderer\.on\("domestic-search:progress"/);
  assert.match(renderer, /onDomesticSearchProgress\?\.\(\(payload = \{\}\)/);
  const progressHandler = renderer.slice(renderer.indexOf('window.aroundG.onDomesticSearchProgress'), renderer.indexOf('function renderRawExcelDomesticCell'));
  assert.match(progressHandler, /payload\.phase === "checkpoint"/);
  assert.doesNotMatch(progressHandler, /count\.innerHTML/);
  assert.doesNotMatch(progressHandler, /progress\.value/);
  assert.match(renderer, /showDomesticSearchOverlay\(batchStartedAt, completed, keys\.length/);
});

test("image fingerprints are reused across matching and final verification", () => {
  assert.match(main, /const domesticImageFingerprintCache = new Map\(\)/);
  assert.match(main, /domesticImageFingerprintCache\.has\(cacheKey\)/);
  assert.match(main, /domesticImageFingerprintCache\.set\(cacheKey, fingerprintTask\)/);
});
