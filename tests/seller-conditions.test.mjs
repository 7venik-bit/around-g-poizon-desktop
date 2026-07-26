import test from "node:test";
import assert from "node:assert/strict";
import { SELLER_POPULAR_CONDITIONS } from "../services/seller-conditions.mjs";

test("판매자센터 인기상품 조건을 요청한 순서로 적용한다", () => {
  assert.deepEqual(SELLER_POPULAR_CONDITIONS.map((condition) => condition.label), [
    "일주일 전",
    "주간 대비",
    "판매 인기 높은 순",
    "인기상품",
    "SPU 기준",
    "인기상품 전체화면",
  ]);
});
