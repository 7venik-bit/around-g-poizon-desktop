import assert from "node:assert/strict";
import test from "node:test";
import { finalizeNaverFashionTownResult } from "../services/naver-fashiontown-result.mjs";

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
  const finalizer = main.indexOf("return finalizeNaverFashionTownResult(parsedContent");
  const genericMatcher = main.indexOf("const analyzed = analyzeRenderedChannelProducts", finalizer);
  assert.ok(finalizer > 0);
  assert.ok(genericMatcher > finalizer);
  assert.match(main, /visibleResultCountObserved/);
  assert.match(main, /presenceConfirmed: result\?\.presenceConfirmed === true/);
  assert.match(main, /naverAllSearchVerdict: result\?\.naverAllSearchVerdict \|\| null/);
});
