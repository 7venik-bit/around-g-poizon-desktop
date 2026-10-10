import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { selectNaverSellingPrices } from "../services/naver-price.mjs";

test("Naver selling price excludes shipping fee", () => {
  const result = selectNaverSellingPrices("정상가 89,000원 판매가 84,550원 배송비 3,000원");
  assert.equal(result.price, 84_550);
  assert.equal(result.originalPrice, 89_000);
  assert.deepEqual(result.excludedShippingAmounts, [3_000]);
});

test("points and monthly installments are not treated as product prices", () => {
  const result = selectNaverSellingPrices("최대 적립 5,000원 월 7,900원 쿠폰적용가 84,550원");
  assert.equal(result.price, 84_550);
  assert.deepEqual(result.excludedOtherAmounts, [5_000, 7_900]);
});

test("shipping-only card does not produce a domestic purchase price", () => {
  const result = selectNaverSellingPrices("배송비 3,000원 제주지역 배송료 6,000원");
  assert.equal(result.price, 0);
  assert.equal(result.originalPrice, 0);
});

test("free-shipping badge before a price does not hide the product price", () => {
  const result = selectNaverSellingPrices("네이버 브랜드직영몰 무료배송 84,550원");
  assert.equal(result.price, 84_550);
});
