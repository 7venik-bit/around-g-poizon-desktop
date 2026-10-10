import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  analyzeRenderedChannelProducts,
  allowsConflictingArticleCard,
  naverFashionChannelSearchUrl,
  NAVER_FASHION_FALLBACK_CHANNELS,
} from "../relay/domestic-search.mjs";
import { finalizeNaverFashionTownResult } from "../services/naver-fashiontown-result.mjs";
import { isOfficialProductCandidateUrl } from "../services/official-product-candidate.mjs";
import {
  findConsentAcceptButton,
  isConsentAcceptLabel,
  isConsentDialogText,
} from "../services/official-consent.mjs";

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

test("choose-one bundle titles survive a sibling-code conflict", () => {
  assert.equal(
    allowsConflictingArticleCard({
      titleText: "[아디다스]신규입고 슈퍼스타 II 주니어/성인(JH9977/JH9976/JI0079)택1",
      rawCardText: "[아디다스]신규입고 슈퍼스타 II 주니어/성인(JH9977/JH9976/JI0079)택1 79,310원",
    }),
    true,
  );
  assert.equal(
    allowsConflictingArticleCard({
      titleText: "아디다스 파이어버드 트랙탑 KD8313",
      rawCardText: "아디다스 파이어버드 트랙탑 KD8313 함께 비교 AR1000-104",
    }),
    false,
  );
  assert.equal(allowsConflictingArticleCard({ titleText: "", rawCardText: "택1 JH9976" }), false);
  assert.equal(
    allowsConflictingArticleCard({ titleText: "슈퍼스타 II JH9976", rawCardText: "추천 상품 JH9977" }),
    false,
  );
});

test("bundle-titled exact cards become naver candidates despite sibling codes", () => {
  const snapshot = JSON.stringify({
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/outlet/13001191642",
      title: "[아디다스]신규입고 슈퍼스타 II 주니어/성인(JH9977/JH9976/JI0079)택1",
      text: "아디다스 주니어 슈퍼스타 II 택1 79,310원 무료배송",
      markup: "",
      imageUrl: "",
      price: "79,310원",
    }],
    pageText: "전체 10개 아울렛 10개",
    selectedChannelEmpty: false,
    resolvedSearchUrl: "https://shopping.naver.com/window/outlet/search?q=JH9976",
  });
  const analyzed = analyzeRenderedChannelProducts(
    snapshot, "네이버 패션타운", "JH9976", "아디다스",
    "(J) 아디다스 슈퍼스타 2 클라우드 화이트 코어 블랙 JH9976", "JH9976",
  );
  assert.equal(analyzed.products.length, 1);
  assert.notEqual(analyzed.absenceConfirmed, true);
});

test("ssg badged cards ignore overseas wording hidden in markup", () => {
  const snapshot = JSON.stringify({
    productCards: [{
      productUrl: "https://www.ssg.com/item/itemView.ssg?itemId=1000000002",
      title: "나이키 이니시에이터 IB4595-001",
      text: "공식수입 나이키 이니시에이터 IB4595-001 47% 56,768원",
      markup: '<div class="delivery-tabs"><span>해외직구</span></div>',
      imageUrl: "",
      price: "56,768원",
      departmentStoreLabelMatched: true,
    }],
    pageText: "전체 1개",
    selectedChannelEmpty: false,
    resolvedSearchUrl: "https://www.ssg.com/search.ssg?query=IB4595-001",
  });
  const analyzed = analyzeRenderedChannelProducts(
    snapshot, "SSG", "IB4595-001", "나이키", "나이키 이니시에이터", "IB4595-001",
  );
  assert.equal(analyzed.products.length, 1);
  assert.notEqual(analyzed.absenceConfirmed, true);
});

test("ssg cards with visible overseas fulfillment are still excluded", () => {
  const snapshot = JSON.stringify({
    productCards: [{
      productUrl: "https://www.ssg.com/item/itemView.ssg?itemId=1000000003",
      title: "나이키 이니시에이터 IB4595-001 해외직구",
      text: "해외직구 나이키 이니시에이터 IB4595-001 56,768원",
      markup: "",
      imageUrl: "",
      price: "56,768원",
      departmentStoreLabelMatched: true,
    }],
    pageText: "전체 1개",
    selectedChannelEmpty: false,
    resolvedSearchUrl: "https://www.ssg.com/search.ssg?query=IB4595-001",
  });
  const analyzed = analyzeRenderedChannelProducts(
    snapshot, "SSG", "IB4595-001", "나이키", "나이키 이니시에이터", "IB4595-001",
  );
  assert.equal(analyzed.products.length, 0);
});

test("adidas-style consent dialog resolves to its accept button only", () => {
  const dialogText = "쿠키를 통한 아디다스 맞춤형 서비스 제공 관련 안내 하단의 모두 동의합니다 버튼을 클릭하지";
  assert.equal(isConsentDialogText(dialogText), true);
  assert.equal(isConsentDialogText("오늘의 특가 상품을 만나보세요"), false);
  assert.equal(isConsentAcceptLabel("모두 동의합니다"), true);
  assert.equal(isConsentAcceptLabel("장바구니 담기"), false);
  assert.equal(isConsentAcceptLabel(""), false);
  const buttons = [
    { label: "장바구니 담기", dialogText: "오늘의 특가 상품을 만나보세요" },
    { label: "모두 동의합니다", dialogText },
  ];
  assert.equal(findConsentAcceptButton(buttons), 1);
  assert.equal(findConsentAcceptButton([{ label: "모두 동의합니다", dialogText: "일반 상품 설명" }]), -1);
  assert.equal(findConsentAcceptButton([]), -1);
});

test("consent dismissal runs before official search submission and capture", () => {
  const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /async function dismissOfficialMallConsent\(searchWindow\)/);
  const submitStart = main.indexOf("async function submitOfficialMallSearch(");
  assert.ok(submitStart >= 0);
  assert.ok(main.slice(submitStart, submitStart + 800).includes("dismissOfficialMallConsent(searchWindow)"));
  assert.match(main, /typeof dismissOfficialMallConsent === "function"\) \{\s+for \(let consent = 0; consent < 3/);
  assert.match(main, /framesInSubtree/);
  assert.match(main, /\[onclick\],\[tabindex\]/);
  assert.match(main, /getComputedStyle\(element\)\.cursor === "pointer"/);
  assert.match(main, /const captureContent = \(\) => searchWindow\.webContents\.mainFrame\.executeJavaScript/);
  assert.match(main, /firstCards === 0 && searchWindow\.__officialConsentDismissed !== true/);
});

test("naver channel-direct search urls cover the three domestic channels", () => {
  assert.deepEqual([...NAVER_FASHION_FALLBACK_CHANNELS], ["outlet", "brand-store", "department"]);
  assert.equal(
    naverFashionChannelSearchUrl("outlet", "JH9976"),
    "https://shopping.naver.com/window/outlet/search?q=JH9976&queryType=ac",
  );
  assert.equal(
    naverFashionChannelSearchUrl("brand-store", "JH9976"),
    "https://shopping.naver.com/window/brand-fashion/search?q=JH9976&queryType=ac",
  );
  assert.equal(
    naverFashionChannelSearchUrl("department", "JH9976"),
    "https://shopping.naver.com/window/department/search?q=JH9976&queryType=ac",
  );
});

test("overview explicit empty falls back to channel-direct pages before absence", () => {
  const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /async function loadNaverFashionChannelsFallback\(searchWindow, query\)/);
  assert.match(main, /loadNaverFashionChannelsFallback\(searchWindow, attemptQuery\)/);
  assert.match(main, /NAVER_FASHION_FALLBACK_CHANNELS/);
});

test("outlet exact-code cards survive analyze for a code-priority naver query", () => {
  const snapshot = JSON.stringify({
    productCards: [{
      productUrl: "https://shopping.naver.com/window-products/outlet/13001191641",
      title: "ABC마트 ADIDAS 슈퍼스타 II 주니어 JH9976",
      text: "ABC마트 ADIDAS 슈퍼스타 II 주니어 JH9976 119,000원 무료배송",
      markup: "",
      imageUrl: "",
      price: "119,000원",
    }],
    pageText: "전체 10개 아울렛 10개",
    selectedChannelEmpty: false,
    resolvedSearchUrl: "https://shopping.naver.com/window/outlet/search?q=JH9976",
  });
  const analyzed = analyzeRenderedChannelProducts(
    snapshot, "네이버 패션타운", "JH9976", "아디다스",
    "(U) 아디다스 슈퍼스타 2 클라우드 화이트 코어 블랙", "JH9976",
  );
  assert.equal(analyzed.products.length, 1);
  assert.notEqual(analyzed.absenceConfirmed, true);
});

test("login-blocked retailer rows open the real search and offer login", () => {
  const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /loginRequired === true \|\| result\?\.securityVerificationRequired === true/);
  const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(inline, /data-domestic-login-source="\$\{retailerLoginId\}"/);
  const sourcing = fs.readFileSync(new URL("../src/sourcing-view.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(sourcing, /data-domestic-login-source="\$\{sourcingRetailerLoginId\}"/);
});

test("official zero-candidate rows record collection evidence for diagnosis", () => {
  const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /officialCollectionEvidence: \{/);
  assert.match(main, /consentDismissed: searchWindow\.__officialConsentDismissed === true/);
  assert.match(main, /__officialConsentDismissed = true/);
  const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(inline, /officialCollectionEvidence\?\.renderedCards/);
  assert.match(inline, /공식몰 동의 해제/);
  assert.match(inline, /공식몰 페이지 제목/);
});
