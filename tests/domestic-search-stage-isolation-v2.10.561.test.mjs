import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");
const handler = main.slice(
  main.indexOf('ipcMain.handle("domestic:search"'),
  main.indexOf('ipcMain.handle("domestic:cancel"'),
);

test("domestic search keeps core results when optional enrichment fails", () => {
  assert.match(handler, /const technicalWarnings = \[\]/);
  assert.match(handler, /rememberWarning\("search_cache_clear", error\)/);
  assert.match(handler, /rememberWarning\("match_confidence", error\)/);
  assert.match(handler, /rememberWarning\("rendered_search_counts", error\)/);
  assert.match(handler, /rememberWarning\("store_image_verification", error\)/);
  assert.match(handler, /rememberWarning\("search_learning_save", error\)/);
  assert.match(handler, /ok: true,[\s\S]*technicalWarnings/);
});

test("search-learning persistence reports failure without discarding products", () => {
  assert.match(handler, /let learningSaved = false/);
  assert.match(handler, /learningSaved = true/);
  assert.match(handler, /saved: learningSaved/);
  assert.match(handler, /const products = Array\.isArray\(matched\?\.products\)/);
});

test("inline rows reveal a core error and distinguish optional warnings", () => {
  assert.match(inline, /국내 검색 실패: \$\{safeText\(result\.error\)\}/);
  assert.match(inline, /일부 판매처 추가 확인 실패 · 확보된 검색 결과를 표시합니다/);
  assert.doesNotMatch(inline, /if \(result\.error\) return `<div class="domestic-inline-empty">국내 상품 검색 실패<\/div>`/);
});
