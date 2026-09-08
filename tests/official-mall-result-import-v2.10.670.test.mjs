import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const inline = await readFile(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");
const sourcing = await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8");

test("브랜드몰 검색 결과 상품명 가격 링크를 IPC 응답으로 가져온다", () => {
  assert.match(main, /async function collectOfficialMallSearchProducts/);
  assert.match(main, /return \{ ok: true, submitted, products, count: products\.length, resultsUrl:/);
});

test("공식몰 결과는 원래 상품 키에 결합되어 프로그램 전면에 표시된다", () => {
  assert.match(renderer, /data-official-result-key/);
  assert.match(renderer, /브랜드몰 상품 \$\{result\.products\.length\}개 가져오기 완료/);
  assert.match(renderer, /domesticResults\.set\(resultKey, mergeResult/);
  assert.match(renderer, /excelPreviewSearchResults\.set\(resultKey, mergeResult/);
  assert.match(inline, /data-official-result-key/);
  assert.match(sourcing, /data-official-result-key/);
});
