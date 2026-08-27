import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeRenderedChannelProducts } from "../relay/domestic-search.mjs";
import { imageEvidenceAllowsExactProduct } from "../services/matcher.mjs";

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

assert.equal(imageEvidenceAllowsExactProduct({
  store: "롯데백화점",
  hasSourceImage: true,
  candidateImageUrl: "https://contents.lotteon.com/panda.jpg",
  imageCompared: true,
  imageScore: 84,
}), true, "matching Lotte image must support an exact-code result");
assert.equal(imageEvidenceAllowsExactProduct({
  store: "롯데백화점",
  hasSourceImage: true,
  candidateImageUrl: "https://contents.lotteon.com/wrong-color.jpg",
  imageCompared: true,
  imageScore: 43,
}), false, "visually different Lotte card must be rejected even when its text repeats the exact code");
assert.equal(imageEvidenceAllowsExactProduct({
  store: "롯데온",
  hasSourceImage: true,
  candidateImageUrl: "",
  imageCompared: false,
  imageScore: null,
}), true, "missing image evidence must not become a false absence");

const relay = await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8");
const lotteSourceRows = [...relay.matchAll(/\{ store: "롯데온(?: 백화점| 아울렛)?", linkOnly: true, domesticChannel: "lotte-[^"]+", renderCount: true \}/g)];
assert.equal(lotteSourceRows.length, 1, "Lotte must use one integrated search, not three duplicate searches");
assert.match(relay, /store: "롯데온"[^\n]+domesticChannel: "lotte-general"/, "Lotte integrated source must be general search");
assert.match(relay, /lotteDepartmentStore/, "Lotte department-store card classification must exist");
assert.match(relay, /exactPortalSearchChecked/, "Lotte absence must require a parsed exact-result grid");

const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
assert.ok(main.includes("const lotteChannelSource ="), "Lotte rendered channel must be detected");
assert.ok(main.includes("show: naverPortalSource || ssgChannelSource || lotteChannelSource"), "Lotte result window must be visible for real-page verification");
assert.ok(main.includes("(ssgChannelSource || lotteChannelSource) && securityRetry < 1"), "blocked Lotte page must retry once before verification failure");
if (main.includes("domesticProductIdentityAccepted")) {
  assert.ok(main.includes("await Promise.all(products.map(async (_product, index) =>"), "accuracy-first mode must compare every captured candidate image");
  assert.ok(main.includes("products = products.filter((product) => domesticProductIdentityAccepted(product, { hasSourceImage }))"), "Lotte/SSG filtering must use the image+title identity gate");
} else {
  assert.ok(main.includes("portalStore && exactCode && product.imageUrl"), "every exact SSG/Lotte card image must be queued for comparison");
  assert.ok(main.includes("imageEvidenceAllowsExactProduct"), "exact-code Lotte/SSG filtering must include image evidence");
}

console.log("Lotte exact-verdict regression checks passed under accuracy-first image+title matching");
