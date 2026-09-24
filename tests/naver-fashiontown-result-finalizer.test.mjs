import assert from "node:assert/strict";
import test from "node:test";
import {
  createDomesticSearchLinkResult,
  createNaverFashionTownSearchLinkResult,
  finalizeNaverFashionTownResult,
  isNaverRenderedResultReady,
  retainNaverCardsOnDetailRestriction,
} from "../services/naver-fashiontown-result.mjs";

test("SSG and Lotte exact query URLs become direct result links", () => {
  for (const [store, resolvedSearchUrl] of [
    ["SSG", "https://www.ssg.com/search.ssg?target=all&query=SR123UPS11"],
    ["롯데온", "https://www.lotteon.com/csearch/search/search?render=search&q=SR123UPS11"],
  ]) {
    const result = createDomesticSearchLinkResult({ store, articleNumber: "SR123UPS11", resolvedSearchUrl });
    assert.equal(result.resultLinkOnly, true);
    assert.equal(result.verificationStage, "direct_result_link");
    assert.equal(result.verificationDiagnostics.store, store);
  }
});

test("official mall and parallel-import exact query URLs become direct result links", () => {
  for (const [store, resolvedSearchUrl] of [
    ["브랜드 공식몰", "https://dk-on.com/DESCENTE/search?keyword=SR123UPS11"],
    ["병행수입·편집샵", "https://search.naver.com/search.naver?where=shopping&query=DESCENTE%20SR123UPS11"],
  ]) {
    const result = createDomesticSearchLinkResult({ store, articleNumber: "SR123UPS11", resolvedSearchUrl });
    assert.equal(result.resultLinkOnly, true);
    assert.equal(result.searchSubmitted, true);
    assert.equal(result.verificationDiagnostics.store, store);
  }
});

test("Naver link helper remains available as a non-capture fallback", () => {
  const result = createNaverFashionTownSearchLinkResult({
    articleNumber: "SR123UPS11",
    resolvedSearchUrl: "https://shopping.naver.com/window/search/fashion-group?q=SR123UPS11",
  });
  assert.equal(result.resultLinkOnly, true);
  assert.equal(result.verificationPending, false);
  assert.equal(result.verificationStage, "naver_direct_result_link");
  assert.equal(result.resolvedSearchUrl.includes("SR123UPS11"), true);
});

test("a detail-only traffic restriction keeps captured Naver cards as link-only results", () => {
  const card = {
    store: "네이버 패션타운",
    title: "데상트 SR123UPS11",
    url: "https://shopping.naver.com/window-products/department/123",
    price: 80100,
    inStock: true,
    sizes: [{ label: "100", inStock: true }],
  };
  const retained = retainNaverCardsOnDetailRestriction({ products: [card] }, {
    products: [],
    rateLimited: true,
  });
  assert.equal(retained.length, 1);
  assert.equal(retained[0].url, card.url);
  assert.equal(retained[0].price, 80100);
  assert.equal(retained[0].linkOnly, true);
  assert.equal(retained[0].stockVerified, false);
  assert.equal(retained[0].inStock, null);
  assert.deepEqual(retained[0].sizes, []);
  assert.equal(retained[0].detailVerificationReason, "rate_limited");
});

test("visible positive total on the exact Naver result URL bypasses the legacy card gate", () => {
  assert.equal(isNaverRenderedResultReady({
    url: "https://shopping.naver.com/window/search/fashion-group?q=SR123UPS11",
    text: "'SR123UPS11'에 대한 패션타운 검색결과입니다.\n전체\n1개\n브랜드직영몰 1개",
    resultMatched: false,
  }, "SR123UPS11"), true);
});

test("exact result URL bypasses early failure and defers evidence to final capture", () => {
  assert.equal(isNaverRenderedResultReady({
    url: "https://shopping.naver.com/window/search/fashion-group?q=SR123UPS11",
    text: "'SR123UPS11'에 대한 패션타운 검색결과입니다.",
    resultMatched: false,
  }, "SR123UPS11"), true);
});

test("unrelated Naver page cannot bypass the search gate", () => {
  assert.equal(isNaverRenderedResultReady({
    url: "https://shopping.naver.com/home",
    text: "SR123UPS11",
  }, "SR123UPS11"), false);
});

test("the user's exact JH9976 URL requires a rendered result rather than a blank or security page", () => {
  const url = 'https://shopping.naver.com/window/search/fashion-group?q=JH9976&queryType=ac';
  assert.equal(isNaverRenderedResultReady({url,text:''},'JH9976'),false);
  assert.equal(isNaverRenderedResultReady({url,text:'보안 확인을 완료해 주세요.'},'JH9976'),false);
  assert.equal(isNaverRenderedResultReady({url,text:'JH9976 전체 1개',cards:1},'JH9976'),true);
});

test("Naver visible cards become link-only products without a second identity gate", () => {
  const result = finalizeNaverFashionTownResult({
    visibleResultCount: 2,
    visibleResultCountObserved: true,
    selectedChannelEmpty: false,
    productCards: [
      { productUrl: "https://shopping.naver.com/window-products/department/123?NaPm=one", title: "상품 A", price: "129,000원" },
      { productUrl: "https://shopping.naver.com/window-products/department/123?NaPm=two", title: "상품 A 중복" },
      { productUrl: "https://shopping.naver.com/window-products/outlet/456", title: "상품 B", price: "89,000원" },
    ],
  }, { articleNumber: "3ASXCA12N-50WHS", resolvedSearchUrl: "https://shopping.naver.com/window/search/fashion-group?q=3ASXCA12N-50WHS" });

  assert.equal(result.naverAllSearchVerdict, "confirmed");
  assert.equal(result.presenceConfirmed, true);
  assert.equal(result.absenceConfirmed, false);
  assert.equal(result.count, 2);
  assert.equal(result.products.length, 2);
  assert.equal(result.products.every((product) => product.linkOnly && product.linkVerified), true);
});

test("only an authoritative zero becomes Naver product absence", () => {
  const result = finalizeNaverFashionTownResult({
    visibleResultCount: 0,
    visibleResultCountObserved: true,
    productCards: [],
  }, { articleNumber: "LW7BG3S" });

  assert.equal(result.naverAllSearchVerdict, "absent");
  assert.equal(result.absenceConfirmed, true);
  assert.equal(result.count, 0);
});

test("Fashion Town navigation links cannot become detail candidates by borrowing card text", () => {
  const result = finalizeNaverFashionTownResult({productCards: [
    ...[
      'https://shopping.naver.com/window/brand-fashion/category',
      'https://shopping.naver.com/window/brand-fashion/store/100035097',
      'https://m.shopping.naver.com/window/brand-fashion/category',
      'https://shopping.naver.com/window/brand-fashion/category?next=/window-products/brandfashion/123',
    ].map(productUrl => ({productUrl,title:'데상트 SR123UPS11',price:84550,officialBrandStoreLabelMatched:true})),
    {productUrl:'https://shopping.naver.com/window-products/brandfashion/12842936435',title:'데상트 SR123UPS11'},
    {productUrl:'https://m.shopping.naver.com/window-products/brandfashion/123',title:'데상트 SR123UPS11'},
    {productUrl:'https://dk-on.com/DESCENTE/product/SR123UPS11',title:'데상트 SR123UPS11',officialBrandStoreLabelMatched:true},
  ]}, {articleNumber:'SR123UPS11'});
  assert.equal(result.products.length,3);
  assert.ok(result.products.every(product => !product.url.includes('/window/')));
  assert.equal(result.products[2].naverTrustedChannelEvidence,true);
});

test("Naver's explicit no-product message becomes 상품 없음 without a parsed count", () => {
  const result = finalizeNaverFashionTownResult({
    pageText: "'JWJJM26321'로 검색된 상품이 없습니다. 다른 검색어를 입력해보세요.",
    visibleResultCountObserved: false,
    productCards: [],
  }, {
    articleNumber: "JWJJM26321",
    resolvedSearchUrl: "https://shopping.naver.com/window/search/fashion-group?q=JWJJM26321",
  });

  assert.equal(result.naverAllSearchVerdict, "absent");
  assert.equal(result.absenceConfirmed, true);
  assert.equal(result.verificationPending, false);
  assert.equal(result.verificationReason, "naver_explicit_empty");
  assert.equal(result.verificationDiagnostics.explicitEmptyText, true);
  assert.equal(result.count, 0);
});

test("Naver's explicit empty search wins over unrelated popular-product links", () => {
  const result = finalizeNaverFashionTownResult({
    pageText: "'JWJJM26321'로 검색된 상품이 없습니다. 다른 검색어를 입력해보세요. 내 또래 남성 인기 브랜드",
    selectedChannelEmpty: true,
    productCards: [
      { productUrl: "https://shopping.naver.com/window-products/brandfashion/9024125489", title: "인기 정장", price: "129,000원" },
      { productUrl: "https://shopping.naver.com/window-products/brandfashion/13678768582", title: "인기 재킷", price: "89,000원" },
    ],
  }, {
    articleNumber: "JWJJM26321",
    resolvedSearchUrl: "https://shopping.naver.com/window/search/fashion-group?q=JWJJM26321",
  });

  assert.equal(result.naverAllSearchVerdict, "absent");
  assert.equal(result.absenceConfirmed, true);
  assert.equal(result.count, 0);
  assert.deepEqual(result.products, []);
});

test("a generic empty notice elsewhere does not hide a positive search result", () => {
  const result = finalizeNaverFashionTownResult({
    pageText: "전체 1개. 추천 상품이 없습니다.",
    visibleResultCount: 1,
    visibleResultCountObserved: true,
    productCards: [{ productUrl: "https://shopping.naver.com/window-products/brandfashion/9024125489",
      title: "JWJJM26321 남성 재킷", price: "129,000원" }],
  }, { articleNumber: "JWJJM26321" });
  assert.equal(result.naverAllSearchVerdict, "confirmed");
  assert.equal(result.products.length, 1);
});

test("a positive total never becomes failure when individual card links are late", () => {
  const result = finalizeNaverFashionTownResult({
    visibleResultCount: 2,
    visibleResultCountObserved: true,
    productCards: [],
  }, {
    articleNumber: "3ASXCA12N-50WHS",
    resolvedSearchUrl: "https://shopping.naver.com/window/search/fashion-group?q=3ASXCA12N-50WHS",
  });

  assert.equal(result.naverAllSearchVerdict, "confirmed");
  assert.equal(result.presenceConfirmed, true);
  assert.equal(result.absenceConfirmed, false);
  assert.equal(result.count, 2);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].searchResultFallback, true);
});

test("release patch loads Fashion Town and captures cards instead of returning early", async () => {
  const releasePatch = String(await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../scripts/patch-naver-result-link-finalizer.mjs", import.meta.url), "utf8")));
  const directResult = releasePatch.indexOf("const directNaverFashionResult =");
  const browserLoad = releasePatch.indexOf("const initialUrl = naverPortalSource");
  assert.ok(directResult > 0);
  assert.ok(browserLoad > directResult);
  assert.doesNotMatch(releasePatch, /if \(directNaverFashionResult\) \{\\n    return createDomesticSearchLinkResult/);
  assert.match(releasePatch, /const directNaverFashionResult = naverPortalSource/);
  assert.match(releasePatch, /const initialUrl = naverPortalSource \? "https:\/\/www\.naver\.com\/" : url/);
});
