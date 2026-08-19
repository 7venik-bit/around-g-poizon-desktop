import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [renderer, store, domestic] = await Promise.all([
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../services/store.mjs", import.meta.url), "utf8"),
  readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8"),
]);

test("국내 재고 일괄 검색은 중지 위치를 저장하고 다음 실행에서 이어간다", () => {
  assert.match(renderer, /DOMESTIC_BATCH_PROGRESS_KEY/);
  assert.match(renderer, /readDomesticBatchProgress\(batchId\)/);
  assert.match(renderer, /searchableIndexes\.filter\(\(index\) => index >= resumeAt\)/);
  assert.match(renderer, /다시 누르면 이어서 검색합니다/);
  assert.doesNotMatch(renderer, /국내 재고 검색 완료 \$\{processed\}\/\$\{searchableIndexes\.length\}/);
});

test("재고가 확인된 결과는 즉시 저장되어 재개 후 복원된다", () => {
  assert.match(store, /domesticSearches: \[\]/);
  assert.match(renderer, /upsert\("domesticSearches"/);
  assert.match(renderer, /restoreDomesticStockResults\(batchId\)/);
});

test("상품번호가 있는 국내 검색 결과는 정확한 모델 일치만 통과한다", () => {
  assert.match(domestic, /products = products\.filter\(\(product\) => exactArticleIdentityMatch/);
  assert.match(domestic, /product\.articleNumber/);
  assert.match(domestic, /product\.url/);
});
