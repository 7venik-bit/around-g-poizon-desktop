import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const patch = await readFile(new URL("../scripts/patch-naver-result-link-finalizer.mjs", import.meta.url), "utf8");

test("네이버 패션타운은 검색 링크에서 조기 종료하지 않고 상품 카드와 가격을 수집한다", () => {
  assert.doesNotMatch(patch, /return createNaverFashionTownSearchLinkResult/);
  assert.match(patch, /Naver Fashion Town must continue into the rendered-card capture/);
  assert.match(patch, /const initialUrl = directNaverFashionResult \? url/);
  assert.match(patch, /const finalized = finalizeNaverFashionTownResult/);
  assert.match(patch, /const approval = await verifyApprovedNaverDomesticProducts/);
});

test("네이버 상세페이지는 판매처와 상품 정체성을 함께 검증한다", () => {
  assert.match(main, /async function verifyApprovedNaverDomesticProducts/);
  assert.match(main, /const articleVerified = strictProductArticleIdentityMatch/);
  assert.match(main, /observedBrandTokens\.some\(\(token\) => brandsMatch\(brand, token\)\)/);
  assert.match(main, /titleIdentityMatch\(observedIdentityText, title\)/);
  assert.match(main, /domesticSellerVerified: true/);
  assert.match(main, /matchBasis: articleVerified \? "article" : "brand_title"/);
});

test("검증된 네이버 상품은 캠페인 이미지가 달라도 결과에서 제거하지 않는다", () => {
  assert.match(main, /const verifiedNaverIdentity =/);
  assert.match(main, /if \(verifiedNaverIdentity\) return true/);
  assert.match(main, /imageVerificationLabel: "네이버 상세 품번 확인"/);
});
