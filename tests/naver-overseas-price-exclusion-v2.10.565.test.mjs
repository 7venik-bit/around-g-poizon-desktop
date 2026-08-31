import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isDomesticNaverPriceCard, selectNaverSellingPrices } from "../services/naver-price.mjs";

test("Naver benefit amounts after the number are not treated as selling prices", () => {
  const result = selectNaverSellingPrices(
    "149,000원 12% 131,000원 최대 적립 포인트 19,800원 최대 5% 추가 적립 5,240원 멤버십 카드 최대 13,100원 적립 포인트 무료배송",
  );
  assert.equal(result.price, 131_000);
  assert.equal(result.originalPrice, 149_000);
  assert.deepEqual(result.sellingAmounts, [131_000, 149_000]);
  assert.deepEqual(result.excludedOtherAmounts, [19_800, 5_240, 13_100]);
});

test("Naver foreign window product URL is excluded even when it has a valid price", () => {
  assert.equal(isDomesticNaverPriceCard({
    productUrl: "https://shopping.naver.com/window-products/foreign/135628828612",
    text: "아디다스 슈퍼스타 JI0079 131,000원",
  }), false);
});

test("overseas labels and customs-included products are excluded", () => {
  for (const marker of ["해외직구", "해외 상품", "해외배송", "구매대행", "관부가세가 포함된 상품"]) {
    assert.equal(isDomesticNaverPriceCard({
      productUrl: "https://shopping.naver.com/window-products/outlet/123",
      text: `${marker} 아디다스 슈퍼스타 131,000원`,
    }), false, marker);
  }
});

test("domestic Naver outlet card remains eligible", () => {
  assert.equal(isDomesticNaverPriceCard({
    productUrl: "https://shopping.naver.com/window-products/outlet/12460382307",
    text: "아디다스 슈퍼스타 JI0079 131,000원 무료배송",
  }), true);
});

test("isolated price lookup rejects overseas cards before price analysis", () => {
  const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
  const exclusion = main.indexOf("filter(isDomesticNaverPriceCard).map");
  const classification = main.indexOf("selectNaverSellingPrices(card?.text", exclusion);
  const analysis = main.indexOf("const analyzed = analyzeRenderedChannelProducts", classification);
  assert.ok(exclusion > 0);
  assert.ok(classification > exclusion);
  assert.ok(analysis > classification);
});
