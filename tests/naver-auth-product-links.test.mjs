import test from "node:test";
import assert from "node:assert/strict";
import { isDomesticNaverPriceCard } from "../services/naver-price.mjs";
import { isTrustedNaverFashionProductCard } from "../relay/domestic-search.mjs";

for (const productUrl of [
  "https://nid.naver.com/nidlogin.login",
  "https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fshopping.naver.com",
  "https://nid.naver.com/login/ext/deviceConfirm",
]) {
  test(`account link cannot become a product despite seller and article text: ${new URL(productUrl).pathname}`, () => {
    const card = { productUrl, title: "Adidas JH9977", text: "Adidas JH9977", officialBrandStoreLabelMatched: true };
    assert.equal(isDomesticNaverPriceCard(card), false);
    assert.equal(isTrustedNaverFashionProductCard(card), false);
  });
}

test("real Naver and external official product links remain eligible", () => {
  for (const productUrl of [
    "https://shopping.naver.com/window-products/brandfashion/12813318713",
    "https://www.adidas.co.kr/superstar/JH9977.html",
  ]) {
    const card = { productUrl, title: "Adidas JH9977", officialBrandStoreLabelMatched: true };
    assert.equal(isDomesticNaverPriceCard(card), true);
    assert.equal(isTrustedNaverFashionProductCard(card), true);
  }
});
