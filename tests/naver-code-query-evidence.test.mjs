import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import * as matcher from "../services/matcher.mjs";
import * as relay from "../relay/domestic-search.mjs";
import { analyzeRenderedChannelProducts } from "../relay/domestic-search.mjs";
import { finalizeNaverFashionTownResult } from "../services/naver-fashiontown-result.mjs";
import { domesticProductUrlIdentity } from "../services/domestic-detail-page.mjs";

// Reported 2026-10-02: KD8313 (Adidas Originals Firebird Jacket Men's) shows
// real Naver results for a code-only search, but the app kept the diluted
// title+code fallback verdict ("naver_explicit_empty") and reported no match.
const ARTICLE = "KD8313";
const BRAND = "아디다스";
const TITLE = "Adidas Originals Firebird Jacket Men's";
const CODE_URL = `https://shopping.naver.com/window/search/fashion-group?q=${ARTICLE}&queryType=ac`;
const LONG_QUERY = `${TITLE} ${ARTICLE}`;
const LONG_URL = `https://shopping.naver.com/window/search/fashion-group?q=${encodeURIComponent(LONG_QUERY)}&queryType=ac`;

function koreanCard(index) {
  const productUrl = `https://smartstore.naver.com/adidas_official/products/${9000000000 + index}`;
  return {
    productUrl,
    url: productUrl,
    title: "아디다스 파이어버드 트랙탑",
    text: "아디다스 파이어버드 트랙탑 119,000원 무료배송 리뷰 12",
    imageUrl: "",
  };
}

function codeSnapshot(cards) {
  return JSON.stringify({
    productCards: cards,
    pageText: "전체 10개 브랜드직영몰 3개 백화점 2개 아울렛 5개 아디다스 파이어버드 트랙탑",
    selectedChannelEmpty: false,
    resolvedSearchUrl: CODE_URL,
  });
}

test("code-query Naver cards with matching brand and no conflicting code become provisional candidates", () => {
  const analyzed = analyzeRenderedChannelProducts(
    codeSnapshot([koreanCard(1), koreanCard(2)]),
    "네이버 패션타운",
    ARTICLE,
    BRAND,
    TITLE,
    ARTICLE,
  );
  assert.equal(analyzed.products.length, 2);
  for (const product of analyzed.products) {
    assert.equal(product.detailArticleVerificationRequired, true);
    assert.equal(product.brandVerifiedFromCard, true);
  }
});

test("provisional acceptance stays off for title queries, conflicting codes, and unknown brands", () => {
  const conflicting = {
    ...koreanCard(3),
    title: "아디다스 파이어버드 트랙탑 KD8313",
    text: "아디다스 파이어버드 트랙탑 KD8313 함께 비교 AR1000-104",
  };
  assert.equal(
    analyzeRenderedChannelProducts(codeSnapshot([koreanCard(1)]), "네이버 패션타운", ARTICLE, BRAND, TITLE, LONG_QUERY).products.length,
    0,
  );
  assert.equal(
    analyzeRenderedChannelProducts(codeSnapshot([conflicting]), "네이버 패션타운", ARTICLE, BRAND, TITLE, ARTICLE).products.length,
    0,
  );
  const conflictOnly = analyzeRenderedChannelProducts(
    codeSnapshot([{ ...koreanCard(4), title: "아디다스 슈퍼스타 JI0079", text: "아디다스 슈퍼스타 JI0079" }]),
    "네이버 패션타운",
    ARTICLE,
    BRAND,
    TITLE,
    ARTICLE,
  );
  assert.equal(conflictOnly.products.length, 0);
  assert.equal(
    analyzeRenderedChannelProducts(codeSnapshot([koreanCard(5)]), "네이버 패션타운", ARTICLE, "", TITLE, ARTICLE).products.length,
    0,
  );
});

const LOTTE_CODE = "SR123UPS11";
const LOTTE_SNAPSHOT = (cards) => JSON.stringify({
  productCards: cards,
  pageText: "68개의 [sr123ups11] 검색결과 입니다.",
  selectedChannelEmpty: false,
  resolvedSearchUrl: `https://www.lotteon.com/csearch/search/search?render=search&platform=pc&q=${LOTTE_CODE}&sort=ranking`,
});
const lotteCard = (index, title = "데상트 티프 폴로 반팔 티셔츠 블랙") => ({
  productUrl: `https://www.lotteon.com/product/PD0000000${index}?mall_no=1`,
  url: `https://www.lotteon.com/product/PD0000000${index}?mall_no=1`,
  title: `롯데백화점 ${title}`,
  text: `롯데백화점 데상트 ${title} 95,130원 무료배송`,
  imageUrl: "",
});

test("code-query Lotte cards with matching brand and no conflicting code become provisional candidates", () => {
  const analyzed = analyzeRenderedChannelProducts(
    LOTTE_SNAPSHOT([lotteCard(1), lotteCard(2)]),
    "롯데온",
    `${LOTTE_CODE}-服`,
    "데상트",
    "데상트 남녀공용 카라 셔츠",
    LOTTE_CODE,
  );
  assert.equal(analyzed.products.length, 2);
  for (const product of analyzed.products) {
    assert.equal(product.detailArticleVerificationRequired, true);
    assert.equal(product.brandVerifiedFromCard, true);
  }
});

test("Lotte provisional acceptance stays off for title queries and conflicting codes", () => {
  assert.equal(
    analyzeRenderedChannelProducts(
      LOTTE_SNAPSHOT([lotteCard(3)]), "롯데온", `${LOTTE_CODE}-服`, "데상트",
      "데상트 남녀공용 카라 셔츠", "데상트 남녀공용 카라 셔츠",
    ).products.length,
    0,
  );
  assert.equal(
    analyzeRenderedChannelProducts(
      LOTTE_SNAPSHOT([{ ...lotteCard(4), title: "데상트 슈퍼스타 JI0079", text: "데상트 슈퍼스타 JI0079" }]),
      "롯데온", LOTTE_CODE, "데상트", "데상트 남녀공용 카라 셔츠", LOTTE_CODE,
    ).products.length,
    0,
  );
});

test("explicit-empty Naver pages never become provisional candidates", () => {
  const snapshot = JSON.stringify({
    productCards: [],
    pageText: "검색된 상품이 없습니다.",
    selectedChannelEmpty: true,
    resolvedSearchUrl: CODE_URL,
  });
  const analyzed = analyzeRenderedChannelProducts(snapshot, "네이버 패션타운", ARTICLE, BRAND, TITLE, ARTICLE);
  assert.equal(analyzed.products.length, 0);
  assert.equal(analyzed.absenceConfirmed, true);
  const finalized = finalizeNaverFashionTownResult(
    { productCards: [], pageText: "검색된 상품이 없습니다.", pageHeaderText: "" },
    { articleNumber: ARTICLE, resolvedSearchUrl: LONG_URL },
  );
  assert.equal(finalized.naverAllSearchVerdict, "absent");
});

const main = readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const production = (name) => {
  const start = main.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  return main.slice(start, main.indexOf("\n}\n", start) + 2);
};

function loopFixture(collect) {
  const calls = [];
  const attempts = [ARTICLE, TITLE, LONG_QUERY].map((query) => ({
    query,
    url: `https://shopping.naver.com/window/search/fashion-group?q=${encodeURIComponent(query)}&queryType=ac`,
  }));
  const source = {
    store: "네이버 패션타운",
    renderCount: true,
    linkOnly: true,
    searchAttempts: attempts,
    manualSearchUrl: attempts[0].url,
    searchQuery: attempts[0].query,
  };
  const context = createContext({
    ...matcher,
    ...relay,
    domesticProductUrlIdentity,
    URL,
    console,
    setTimeout,
    clearTimeout,
    domesticSearchGeneration: 0,
    domesticSearchCanceled: () => false,
    activeDomesticSearchWindows: new Set(),
    DOMESTIC_RETAILER_HARD_TIMEOUT_MS: 90000,
    NAVER_COLLECTION_GRACE_MS: 45000,
    OFFICIAL_DOMAIN_STATUS: { NO_OFFICIAL_STORE: "no_official_store", VERIFIED: "verified", SEARCH_UNSUPPORTED: "unsupported" },
    imageFingerprint: async () => null,
    wait: async () => {},
    recoverOfficialCollection: async (options) => options.collect(options.source),
    renderedSearchSourceResult: async (s, _code, _brand, _title, _retry, attempt) => {
      calls.push(attempt.query);
      return collect(calls.length, attempt);
    },
  });
  for (const name of ["addMatchConfidence", "addRenderedSearchCounts"]) runInContext(production(name), context);
  runInContext(readFileSync(new URL("../src/domestic-result-verdict.js", import.meta.url), "utf8"), context);
  return {
    context,
    calls,
    run: () => context.addRenderedSearchCounts(
      { products: [], sources: [{ ...source }] },
      ARTICLE,
      BRAND,
      TITLE,
      0,
      () => {},
      null,
      { articleNumber: ARTICLE, brand: BRAND, title: TITLE },
    ),
  };
}

const emptyAbsent = (attempt) => ({
  products: [],
  count: 0,
  absenceConfirmed: true,
  searchCompleted: true,
  searchSubmitted: true,
  resolvedSearchUrl: attempt.url,
  naverAllSearchVerdict: "absent",
  verificationReason: "naver_explicit_empty",
  verificationStage: "naver_result_capture",
  verificationDiagnostics: { stage: "naver_result_capture", reason: "naver_explicit_empty" },
});

test("code-attempt candidate evidence is kept instead of the diluted title+code empty verdict", async () => {
  const card = { ...koreanCard(7), store: "네이버 패션타운" };
  const f = loopFixture((n, attempt) => (n === 1
    ? { products: [card], count: 1, searchCompleted: true, searchSubmitted: true, resolvedSearchUrl: attempt.url }
    : emptyAbsent(attempt)));
  const r = await f.run();
  assert.deepEqual(f.calls, [ARTICLE, TITLE, LONG_QUERY]);
  assert.equal(r.sources[0].searchQuery, ARTICLE);
  assert.equal(r.sources[0].searchUrl, CODE_URL);
  assert.equal(r.sources[0].manualSearchUrl, CODE_URL);
  assert.equal(r.sources[0].absenceConfirmed, true);
  assert.equal(r.sources[0].verificationReason, "product_identity_mismatch");
  assert.equal(f.context.AroundGDomesticVerdict.sourceVerdict(r.sources[0]).label, "일치 상품 없음");
});

test("a later exact hit still wins over earlier code-attempt evidence", async () => {
  const exact = {
    ...koreanCard(8),
    store: "네이버 패션타운",
    title: "아디다스 파이어버드 트랙탑 KD8313",
    text: "아디다스 파이어버드 트랙탑 KD8313 119,000원",
    articleNumberVerified: true,
    detectedArticleNumber: ARTICLE,
    brandVerifiedFromCard: true,
    imageUrl: "",
  };
  const card = { ...koreanCard(9), store: "네이버 패션타운" };
  const f = loopFixture((n, attempt) => (n < 3
    ? { products: [card], count: 1, searchCompleted: true, searchSubmitted: true, resolvedSearchUrl: attempt.url }
    : { products: [exact], count: 1, searchCompleted: true, searchSubmitted: true, resolvedSearchUrl: attempt.url }));
  const r = await f.run();
  assert.equal(r.products.length, 1);
  assert.equal(r.sources[0].searchQuery, LONG_QUERY);
});
