import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

test("인기리스트와 브랜드 Excel 상품검색은 공통 검색 엔진을 사용한다", () => {
  const previewStart = renderer.indexOf('$("#excel-preview-search-selected")');
  const previewEnd = renderer.indexOf('$("#excel-preview-clear-selection")', previewStart);
  const previewSearch = renderer.slice(previewStart, previewEnd);

  assert.match(renderer, /#popular-product-search[\s\S]*openIntegratedPopularExcel/);
  assert.match(renderer, /combined:\/\/selected-brands/);
  assert.match(previewSearch, /await cachedDomesticSearch\(product, true\)/);
});

test("브랜드 결과와 카테고리 결과는 같은 순차 검색 배치를 사용한다", () => {
  const batchStart = renderer.indexOf("async function runDomesticBatch");
  const batchEnd = renderer.indexOf('$("#domestic-search-all").addEventListener', batchStart);
  const batch = renderer.slice(batchStart, batchEnd);

  assert.match(renderer, /#brand-selected-domestic[\s\S]*runDomesticBatch\(\{ selectedOnly: true \}\)/);
  assert.match(renderer, /#search-selected-domestic[\s\S]*runDomesticBatch\(\{ selectedOnly: true \}\)/);
  assert.match(batch, /for \(const index of pendingIndexes\)/);
  assert.match(batch, /await searchDomesticAt\(index, batchProducts\)/);
});

test("모든 화면의 네이버 요청은 DOM 준비형 공통 main 검색기로 합류한다", () => {
  assert.match(renderer, /window\.aroundG\.searchDomestic\(input\)/);
  assert.match(main, /ipcMain\.handle\("domestic:search"/);
  assert.match(main, /renderedSearchSourceResult\(source, articleNumber, brand, title/);
  assert.match(main, /isNaverRenderedResultReady\(\{ url: state\.href, text: state\.text \}, expectedQuery\)/);
});
