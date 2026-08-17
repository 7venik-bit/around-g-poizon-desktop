import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, renderer, packageSource, lockSource] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);

test("the workbook brand repairs a wrongly connected POIZON job", () => {
  assert.match(main, /const resolvedBrandName = detectedMatchesRequested/);
  assert.match(main, /brandName: resolvedBrandName/);
  assert.match(main, /detectedBrandName: detectedMatchesRequested \? "" : detectedBrand \|\| ""/);
  assert.match(renderer, /const workbookBrand = String\(file\?\.brandName \|\| file\?\.detectedBrandName/);
  assert.match(renderer, /brandName: resolvedBrandName/);
  assert.match(renderer, /brandNameCorrected: corrected/);
  assert.match(renderer, /\{ replaceBrand: true \}/);
  assert.match(renderer, /Excel 실제 브랜드로 생성 목록을 자동 교정했습니다/);
  assert.match(renderer, /updateBrandBatchState\([\s\S]*normalizedFile\.brandName[\s\S]*normalizedFile\.jobId/);
});

test("startup file discovery repairs an older wrong brand cache", () => {
  assert.match(main, /const resolvedBrandName = detectedBrand \|\| expectedBrand/);
  assert.match(main, /!brandsMatch\(resolvedBrandName, savedJob\?\.brandName\)/);
  assert.match(main, /jobId: recoveredJobId/);
});

test("release metadata is 2.10.257", () => {
  assert.equal(JSON.parse(packageSource).version, "2.10.257");
  assert.equal(JSON.parse(lockSource).version, "2.10.257");
  assert.equal(JSON.parse(lockSource).packages[""].version, "2.10.257");
});
