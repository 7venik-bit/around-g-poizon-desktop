import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { analyzeRenderedChannelProducts } from "../relay/domestic-search.mjs";

const verdictSource = await readFile(new URL("../src/domestic-result-verdict.js", import.meta.url), "utf8");
const verdictContext = vm.createContext({ Intl, Number, Object, Array });
vm.runInContext(verdictSource, verdictContext);
const { sourceVerdict } = verdictContext.AroundGDomesticVerdict;

const ssgCard = (itemId, title, text) => ({
  productUrl: `https://www.ssg.com/item/itemView.ssg?itemId=${itemId}`,
  title,
  text,
  departmentStoreLabelMatched: true,
});

test("all-dropped SSG badged cards report the rejected count", () => {
  const rendered = JSON.stringify({
    productCards: [
      ssgCard("1000111111", "신세계백화점 조던 1 로우 DC0774-100", "신세계백화점 조던 1 로우 DC0774-100 139,000원"),
      ssgCard("1000222222", "신세계백화점 조던 1 로우 DC0774-101", "신세계백화점 조던 1 로우 DC0774-101 139,000원"),
      ssgCard("1000333333", "신세계백화점 조던 1 로우 DD1503-101", "신세계백화점 조던 1 로우 DD1503-101 129,000원"),
    ],
    pageText: "SSG 검색 결과",
  });
  const result = analyzeRenderedChannelProducts(rendered, "SSG", "DC0774-105", "나이키", "(W) 조던 1 로우 화이트 울프 그레이", "DC0774-105");
  assert.equal(result.products.length, 0);
  assert.deepEqual(result.identityDrops, { evaluated: 3, noArticle: 0, brand: 0, conflict: 3, filtered: 0 });
  assert.equal(result.identityRejectedCount, 3);
  assert.equal(result.absenceConfirmed, true);
  const verdict = sourceVerdict({ store: "SSG", searchSubmitted: true, searchCompleted: true, absenceConfirmed: true, identityRejectedCount: result.identityRejectedCount });
  assert.equal(verdict.label, "일치 상품 없음");
});

test("a brand-dropped Lotte badged card reports the rejected count", () => {
  const rendered = JSON.stringify({
    productCards: [{
      productUrl: "https://www.lotteon.com/p/product/LE1219586328",
      title: "롯데백화점 덩크 로우 범고래 DD1503-101",
      text: "롯데백화점 덩크 로우 범고래 DD1503-101 129,000원",
    }],
    pageText: "롯데온 검색 결과",
  });
  const result = analyzeRenderedChannelProducts(rendered, "롯데온", "DD1503-101", "나이키", "(W) 나이키 덩크 로우 블랙", "DD1503-101");
  assert.equal(result.products.length, 0);
  assert.deepEqual(result.identityDrops, { evaluated: 1, noArticle: 0, brand: 1, conflict: 0, filtered: 0 });
  assert.equal(result.identityRejectedCount, 1);
});

test("matched badged cards report no rejections", () => {
  const rendered = JSON.stringify({
    productCards: [
      ssgCard("1000612345", "여성 나이키 덩크 로우 DD1503-101", "신세계백화점 여성 나이키 덩크 로우 DD1503-101"),
      {
        productUrl: "https://www.ssg.com/item/itemView.ssg?itemId=1000999888",
        title: "여성 나이키 덩크 로우 DD1503-101",
        text: "여성 나이키 덩크 로우 DD1503-101",
      },
    ],
  });
  const result = analyzeRenderedChannelProducts(rendered, "SSG", "DD1503-101", "나이키", "여성 나이키 덩크 로우", "DD1503-101");
  assert.equal(result.products.length, 1);
  assert.equal(result.identityRejectedCount, 0);
});

test("non-badged stores never report rejections", () => {
  const rendered = JSON.stringify({
    productCards: [{
      productUrl: "https://www.musinsa.com/products/2311096",
      title: "무신사 나이키 덩크 로우 DD1503-101",
      text: "무신사 나이키 덩크 로우 DD1503-101",
    }],
  });
  const result = analyzeRenderedChannelProducts(rendered, "무신사", "DD1503-999", "나이키");
  assert.equal(result.products.length, 0);
  assert.equal(result.identityRejectedCount, 0);
});
