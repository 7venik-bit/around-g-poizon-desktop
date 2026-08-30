import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sourcing = await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8");
const officialPatch = await readFile(new URL("../scripts/patch-official-naver-link-only.mjs", import.meta.url), "utf8");

test("product summary exposes POIZON and domestic price comparison columns", () => {
  for (const label of ["POIZON 기준가", "국내 최저가", "가격 차이", "예상 마진율"]) {
    assert.match(sourcing, new RegExp(label));
  }
  assert.match(sourcing, /domesticPriceComparison\(result, poizonPrice\)/);
  assert.match(sourcing, /difference = lowest\.price - basePrice/);
  assert.match(sourcing, /\(difference \/ lowest\.price\) \* 100/);
  assert.match(sourcing, /수수료·배송비 미반영/);
});

test("expanded result shows exact retailer price fields without inventing shipping", () => {
  for (const label of ["판매처", "상품명", "판매가", "배송비", "실구매가", "재고", "POIZON 대비", "링크"]) {
    assert.match(sourcing, new RegExp(label));
  }
  assert.match(sourcing, /domesticProductShipping/);
  assert.match(sourcing, /shipping\.known \? shipping\.amount \? money/);
  assert.match(sourcing, /shipping\.known \? price \+ shipping\.amount/);
  assert.match(sourcing, /"미확인"/);
});

test("only usable verified retailer prices enter the domestic minimum", () => {
  assert.match(sourcing, /domesticPriceEligibleProduct/);
  assert.match(sourcing, /product\.inStock !== false/);
  assert.match(sourcing, /product\.parallelRetailerVerified === true/);
  assert.match(sourcing, /\.sort\(\(left, right\) => left\.price - right\.price\)/);
});

test("link-only sources remain visible in the comparison table", () => {
  assert.match(sourcing, /source\?\.resultLinkOnly === true/);
  assert.match(sourcing, /검색 결과 링크/);
  assert.match(officialPatch, /render official and Naver links inside the price comparison/);
  assert.match(officialPatch, /sourcing-price-row/);
});
