import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeRenderedChannelProducts } from "../relay/domestic-search.mjs";

const exactDepartment = JSON.stringify({
  productCards: [{
    productUrl: "https://www.lotteon.com/p/product/PD49741415",
    title: "나이키 덩크 로우 (여성) DD1503-101",
    text: "롯데백화점 나이키 덩크 로우 (여성) DD1503-101 87,170원",
    markup: "<div>롯데백화점 나이키 DD1503-101</div>",
    imageUrl: "https://contents.lotteon.com/test.jpg",
    imageLinkedToProduct: true,
    departmentStoreLabelMatched: true,
    outletLabelMatched: false,
  }],
  pageBlocked: false,
  pageText: "DD1503-101 검색결과",
  selectedChannelEmpty: false,
  selectedChannelCount: null,
});
const exactResult = analyzeRenderedChannelProducts(exactDepartment, "롯데온", "DD1503-101", "Nike", "덩크 로우");
assert.equal(exactResult?.count, 1, "Lotte exact article must be counted");
assert.equal(exactResult?.absenceConfirmed, false, "Lotte exact article must not be marked absent");
assert.equal(exactResult?.products?.[0]?.detectedArticleNumber, "DD1503101", "Lotte exact model identity must be retained");
assert.equal(exactResult?.products?.[0]?.store, "롯데백화점", "Lotte department-store card must be classified from its card label");

const mismatch = JSON.stringify({
  productCards: [{
    productUrl: "https://www.lotteon.com/p/product/PD49741416",
    title: "나이키 덩크 로우 DD1503-102",
    text: "나이키 덩크 로우 DD1503-102 87,170원",
    markup: "<div>나이키 DD1503-102</div>",
    imageLinkedToProduct: true,
  }],
  pageBlocked: false,
  pageText: "DD1503-101 검색결과",
  selectedChannelEmpty: false,
  selectedChannelCount: null,
});
const mismatchResult = analyzeRenderedChannelProducts(mismatch, "롯데온", "DD1503-101", "Nike", "덩크 로우");
assert.equal(mismatchResult?.count, 0, "nearby Lotte model must not be counted");
assert.equal(mismatchResult?.absenceConfirmed, true, "parsed Lotte grid with only a different model may confirm absence");

const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");
const lotteSourceRows = [...relay.matchAll(/\{ store: "롯데온(?: 백화점| 아울렛)?", linkOnly: true, domesticChannel: "lotte-[^"]+", renderCount: true \}/g)];
assert.equal(lotteSourceRows.length, 1, "Lotte must use one integrated search, not three duplicate searches");
assert.match(relay, /store: "롯데온"[^\n]+domesticChannel: "lotte-general"/, "Lotte integrated source must be general search");
assert.match(relay, /lotteDepartmentStore/, "Lotte department-store card classification must exist");
assert.match(relay, /exactPortalSearchChecked/, "Lotte absence must require a parsed exact-result grid");

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
assert.match(main, /const lotteChannelSource = \^\/롯데온/, "Lotte rendered channel must be detected");
assert.match(main, /show: naverPortalSource \|\| ssgChannelSource \|\| lotteChannelSource/, "Lotte result window must be visible for real-page verification");
assert.match(main, /\(ssgChannelSource \|\| lotteChannelSource\) && securityRetry < 1/, "blocked Lotte page must retry once before verification failure");

console.log("Lotte exact-verdict regression checks passed");
