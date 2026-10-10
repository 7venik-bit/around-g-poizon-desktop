import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeRenderedChannelProducts } from "../relay/domestic-search.mjs";
import { finalizeNaverFashionTownResult } from "../services/naver-fashiontown-result.mjs";
import { isOfficialProductCandidateUrl } from "../services/official-product-candidate.mjs";

// Regression: 실세 상품이 검색되지만 "상품 없음"으로 표시되던 오탐.
// 빈 문구/0 카운트가 수집된 카드를 덮어쓰지 않아야 한다.

test("explicit empty text never discards collected Naver trusted cards", () => {
  const productUrl = "https://shopping.naver.com/window-products/brandfashion/13615365121";
  const snapshot = {
    productCards: [{
      productUrl,
      title: "[데상트] 터프 스몰 워딩 폴로 반팔 티셔츠 SR323UPS74",
      text: "데상트 브랜드직영몰 84,550원",
      markup: "브랜드직영몰",
      imageUrl: "https://shop-phinf.pstatic.net/product.jpg",
      price: "84,550원",
      officialBrandStoreLabelMatched: true,
    }],
    pageText: "검색된 상품이 없습니다. 다른 검색어를 입력해보세요.",
    pageHeaderText: "",
    visibleResultCount: 1,
    visibleResultCountObserved: true,
  };
  const finalized = finalizeNaverFashionTownResult(snapshot, {
    articleNumber: "SR323UPS74",
    resolvedSearchUrl: "https://shopping.naver.com/window/search/fashion-group?q=SR323UPS74",
  });
  assert.equal(finalized.products.length, 1);
  assert.equal(finalized.absenceConfirmed, false);
  assert.equal(finalized.naverAllSearchVerdict, "confirmed");
});

test("zero channel count never discards collected official cards", () => {
  const article = "SR123UPS11";
  const productUrl = "https://dk-on.com/DESCENTE/product/SR123UPS11/WHT0";
  const snapshot = JSON.stringify({
    productCards: [{
      productUrl,
      title: "데상트 카라 셔츠 SR123UPS11",
      text: "데상트 카라 셔츠 SR123UPS11",
      markup: "",
      imageUrl: "",
      price: "84,550원",
    }],
    pageText: "브랜드직영몰 0개 검색된 상품이 없습니다",
    selectedChannelEmpty: false,
    selectedChannelCount: 0,
    resolvedSearchUrl: "https://dk-on.com/DESCENTE/search?keyword=SR123UPS11",
  });
  const analyzed = analyzeRenderedChannelProducts(
    snapshot, "브랜드 공식몰", article, "데상트", "카라 셔츠", article,
  );
  assert.ok(analyzed.products.length > 0, JSON.stringify(analyzed));
  assert.notEqual(analyzed.absenceConfirmed, true);
});

test("empty page text never discards collected domestic cards", () => {
  const article = "SR123UPS11";
  const snapshot = JSON.stringify({
    productCards: [{
      productUrl: "https://www.musinsa.com/products/4693116",
      title: "데상트 SR123UPS11 카라 셔츠",
      text: "데상트 SR123UPS11 카라 셔츠",
      markup: "",
      imageUrl: "",
      price: "84,550원",
    }],
    pageText: "검색 결과가 없습니다",
    selectedChannelEmpty: true,
    resolvedSearchUrl: "https://www.musinsa.com/search/goods?keyword=SR123UPS11",
  });
  const analyzed = analyzeRenderedChannelProducts(
    snapshot, "무신사", article, "데상트", "카라 셔츠", article,
  );
  assert.ok(analyzed.products.length > 0, JSON.stringify(analyzed));
  assert.notEqual(analyzed.absenceConfirmed, true);
});

test("Nike base-code query still reaches colour-variant product URLs", () => {
  const full = "https://www.nike.com/kr/t/에어-포스-1-07-남성-신발/DV0991-100";
  assert.equal(isOfficialProductCandidateUrl(full, "", "DV0991-100"), true);
  assert.equal(isOfficialProductCandidateUrl(full, "", "DV0991"), true);
  const otherColour = "https://www.nike.com/kr/t/에어-포스-1-07-남성-신발/DV0991-101";
  assert.equal(isOfficialProductCandidateUrl(otherColour, "", "DV0991-100"), false);
  assert.equal(isOfficialProductCandidateUrl("https://www.nike.com/kr/w/new arrivals", "", "DV0991-100"), false);
});

test("official mall keeps every distinct query instead of only the code", () => {
  const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.doesNotMatch(main, /브랜드 공식몰.*slice\(0,\s*1\)/);
  assert.match(main, /const queryAttempts = allQueryAttempts/);
});
