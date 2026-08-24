import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeRenderedChannelProducts } from "../relay/domestic-search.mjs";

const exact = JSON.stringify({
  productCards: [{
    productUrl: "https://www.ssg.com/item/itemView.ssg?itemId=1000000001",
    title: "나이키 우먼스 덩크 로우 DD1503-101",
    text: "나이키 우먼스 덩크 로우 DD1503-101 89,400원 신세계백화점",
    markup: "<div>나이키 DD1503-101 신세계백화점</div>",
    imageUrl: "https://simg.ssgcdn.com/test.jpg",
    imageLinkedToProduct: true,
    departmentStoreLabelMatched: true,
    outletLabelMatched: false,
  }],
  pageBlocked: false,
  pageText: "'DD1503-101'(으)로 검색한 결과입니다.",
  selectedChannelEmpty: false,
  selectedChannelCount: null,
});
const exactResult = analyzeRenderedChannelProducts(exact, "SSG", "DD1503-101", "Nike", "덩크 로우");
assert.equal(exactResult?.count, 1, "SSG exact article must be counted");
assert.equal(exactResult?.absenceConfirmed, false, "SSG exact article must not be marked absent");
assert.equal(exactResult?.products?.[0]?.detectedArticleNumber, "DD1503101", "exact model identity must be retained");

const mismatch = JSON.stringify({
  productCards: [{
    productUrl: "https://www.ssg.com/item/itemView.ssg?itemId=1000000002",
    title: "나이키 우먼스 덩크 로우 DD1503-102",
    text: "나이키 우먼스 덩크 로우 DD1503-102 89,400원",
    markup: "<div>나이키 DD1503-102</div>",
    imageLinkedToProduct: true,
  }],
  pageBlocked: false,
  pageText: "'DD1503-101'(으)로 검색한 결과입니다.",
  selectedChannelEmpty: false,
  selectedChannelCount: null,
});
const mismatchResult = analyzeRenderedChannelProducts(mismatch, "SSG", "DD1503-101", "Nike", "덩크 로우");
assert.equal(mismatchResult?.count, 0, "nearby SSG model must not be counted");
assert.equal(mismatchResult?.absenceConfirmed, true, "parsed SSG grid with only a different model may confirm absence");

const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");
const ssgSourceRows = [...relay.matchAll(/\{ store: "SSG(?: 백화점| 아울렛)?", linkOnly: true, domesticChannel: "ssg-[^"]+", renderCount: true \}/g)];
assert.equal(ssgSourceRows.length, 1, "SSG must use one integrated search, not three duplicate searches");
assert.match(relay, /store: "SSG"[^\n]+domesticChannel: "ssg-general"/, "SSG integrated source must be general search");

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
assert.match(main, /show: naverPortalSource \|\| ssgChannelSource/, "SSG result window must be visible for real-page verification");
assert.match(main, /ssgChannelSource && securityRetry < 1/, "SSG blocked page must retry once before reporting verification failure");
assert.match(main, /pageBlocked && !parsedContent\?\.productCards\?\.length/, "a rendered product card must override generic page-block text");

console.log("SSG exact-verdict regression checks passed");
