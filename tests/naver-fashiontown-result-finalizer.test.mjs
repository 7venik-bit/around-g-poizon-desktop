import assert from "node:assert/strict";
import test from "node:test";
import {
  createDomesticSearchLinkResult,
  createNaverFashionTownSearchLinkResult,
  finalizeNaverFashionTownResult,
  isNaverRenderedResultReady,
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

test("Naver exact search URL is returned as a link without a hidden browser", () => {
  const result = createNaverFashionTownSearchLinkResult({
    articleNumber: "SR123UPS11",
    resolvedSearchUrl: "https://shopping.naver.com/window/search/fashion-group?q=SR123UPS11",
  });
  assert.equal(result.resultLinkOnly, true);
  assert.equal(result.verificationPending, false);
  assert.equal(result.verificationStage, "naver_direct_result_link");
  assert.equal(result.resolvedSearchUrl.includes("SR123UPS11"), true);
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

test("main process uses the finalizer before the generic marketplace matcher", async () => {
  const main = String(await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../main.mjs", import.meta.url), "utf8")));
  const finalizer = main.indexOf("const finalized = finalizeNaverFashionTownResult(parsedContent");
  const sellerFilter = main.indexOf("const approvedProducts = await filterApprovedNaverDomesticProducts", finalizer);
  const genericMatcher = main.indexOf("const analyzed = analyzeRenderedChannelProducts", finalizer);
  assert.ok(finalizer > 0);
  assert.ok(sellerFilter > finalizer);
  assert.ok(genericMatcher > finalizer);
  assert.match(main, /visibleResultCountObserved/);
  assert.match(main, /presenceConfirmed: result\?\.presenceConfirmed === true/);
  assert.match(main, /naverAllSearchVerdict: result\?\.naverAllSearchVerdict \|\| null/);
  assert.match(main, /verificationDiagnostics: result\?\.verificationDiagnostics/);
  assert.match(main, /not the rejected promise or its error code/);
  assert.doesNotMatch(main, /const documentReady = aborted && \^\/https/);
  assert.match(main, /const directNaverFashionResult = naverPortalSource/);
  assert.match(main, /const initialUrl = directNaverFashionResult \? url/);
  assert.match(main, /if \(interactiveSiteSearch && !directNaverFashionResult\)/);
  assert.match(main, /return createNaverFashionTownSearchLinkResult/);
  assert.match(main, /return createDomesticSearchLinkResult/);
  assert.doesNotMatch(main, /const directOfficialResultLink/);
  assert.match(main, /const directParallelResultLink/);
  assert.ok(
    main.indexOf("if (isNaverRenderedResultReady(state, exactQuery)) return true;")
      < main.indexOf("return await waitForNaverSearchResultsStable(searchWindow, exactQuery);"),
    "visible positive evidence must be accepted before the legacy stability gate",
  );
});
