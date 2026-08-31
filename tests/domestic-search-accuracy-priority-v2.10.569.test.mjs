import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  analyzeRenderedChannelProducts,
  strictProductArticleIdentityMatch,
  titleIdentityMatch,
} from "../relay/domestic-search.mjs";

test("숫자형 POIZON 코드가 페이지 공통영역에만 있으면 상품코드 불일치다", () => {
  assert.equal(strictProductArticleIdentityMatch({
    titleText: "스포츠 슬링백 가방 VIBRANT BG5922",
    labeledText: "검색어 45478",
    structuredCodes: [],
  }, "45478"), false);
});

test("숫자형 코드도 상품 제목·품번 라벨·구조화 SKU에서만 인정한다", () => {
  assert.equal(strictProductArticleIdentityMatch({ titleText: "파타고니아 티셔츠 45478" }, "45478"), true);
  assert.equal(strictProductArticleIdentityMatch({ labeledText: "품번: 45478" }, "45478"), true);
  assert.equal(strictProductArticleIdentityMatch({ structuredCodes: ["45478"] }, "45478"), true);
});

test("2순위 상품명은 브랜드와 핵심 상품명이 함께 맞아야 한다", () => {
  assert.equal(titleIdentityMatch("파타고니아 맨즈 73 스카이라인 티셔츠", "파타고니아 맨즈 73 스카이라인 티셔츠"), true);
  assert.equal(titleIdentityMatch("스포츠 슬링백 가방 VIBRANT BG5922", "파타고니아 맨즈 73 스카이라인 티셔츠"), false);
});

test("코드 불일치 완료는 다음 검색순위로 진행하고 미검증 품번을 복사하지 않는다", async () => {
  const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
  assert.match(main, /authoritativeIdentityMismatch[\s\S]*absenceConfirmed: analyzed\.absenceConfirmed === true \|\| authoritativeIdentityMismatch/);
  assert.match(main, /articleNumber: detailArticleVerified \|\| product\.articleNumberVerified === true \? articleNumber : ""/);
  assert.match(main, /titleFallbackVerified[\s\S]*titleIdentityMatch/);
  assert.match(main, /queryAttemptIndex > 0[\s\S]*sharedNaverSession\.window\.destroy\(\)/);
});

test("무신사 추천 카드만 나오면 1순위 상품코드 검색은 불일치로 완료된다", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    pageText: "45478 검색 결과",
    selectedChannelEmpty: false,
    productCards: [
      {
        productUrl: "https://www.musinsa.com/products/45478?keyword=45478",
        title: "스포츠 슬링백 가방 VIBRANT BG5922",
        text: "스포츠 슬링백 가방 VIBRANT BG5922 40,500원",
      },
      {
        productUrl: "https://www.musinsa.com/products/99999?keyword=45478",
        title: "아틀라스 엘리트 GTX 8인치 부츠",
        text: "아틀라스 엘리트 GTX 8인치 부츠 366,000원",
      },
    ],
  }), "무신사", "45478", "파타고니아", "파타고니아 맨즈 73 스카이라인 티셔츠");
  assert.equal(result.count, 0);
  assert.deepEqual(result.products, []);
  assert.equal(result.absenceConfirmed, true);
});
