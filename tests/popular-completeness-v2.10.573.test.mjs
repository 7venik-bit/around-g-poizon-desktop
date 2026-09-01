import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { popularCompleteness } from "../services/popular-excel.mjs";

const completeProducts = (limit = 200) => Array.from({ length: limit }, (_value, index) => ({
  rank: index + 1,
  articleNumber: `CODE-${index + 1}`,
  name: `상품 ${index + 1}`,
  averagePrice: 10_000 + index,
}));

test("1~200위가 모두 존재할 때만 인기리스트를 완전 수집으로 판정한다", () => {
  const result = popularCompleteness(completeProducts(), 200);
  assert.equal(result.complete, true);
  assert.equal(result.captured, 200);
  assert.deepEqual(result.missingRanks, []);
});

test("한 순위라도 없거나 중복되면 완전 수집을 거부한다", () => {
  const missing = completeProducts().filter((product) => product.rank !== 83);
  assert.equal(popularCompleteness(missing, 200).complete, false);
  assert.deepEqual(popularCompleteness(missing, 200).missingRanks, [83]);

  const duplicated = [...completeProducts(), {
    rank: 83,
    articleNumber: "OTHER",
    name: "중복",
    averagePrice: 99_000,
  }];
  const duplicateResult = popularCompleteness(duplicated, 200);
  assert.equal(duplicateResult.complete, false);
  assert.deepEqual(duplicateResult.duplicateRanks, [83]);
});

test("품번·상품명·평균 거래가 중 하나라도 비면 해당 순위를 미완성으로 재수집한다", () => {
  const incomplete = completeProducts();
  incomplete[41] = { ...incomplete[41], averagePrice: 0 };
  const result = popularCompleteness(incomplete, 200);
  assert.equal(result.complete, false);
  assert.equal(result.captured, 199);
  assert.deepEqual(result.missingRanks, [42]);
  assert.deepEqual(result.incompleteRanks, [42]);
});

test("배포 경로는 불완전 목록 저장을 차단하고 완료율 100%만 반환한다", async () => {
  const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  assert.match(main, /code: "POPULAR_CAPTURE_INCOMPLETE"/);
  assert.match(main, /code: "POPULAR_EXCEL_INCOMPLETE"/);
  assert.match(main, /1~\$\{limit\}위 완전 수집 확인/);
  assert.doesNotMatch(main, /source: "seller-center-missing-slot"/);
});
