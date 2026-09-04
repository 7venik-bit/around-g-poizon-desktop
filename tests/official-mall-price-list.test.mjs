import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeRenderedChannelProducts } from "../relay/domestic-search.mjs";

test("official mall rendered card keeps title, current price and product link", () => {
  const result = analyzeRenderedChannelProducts(JSON.stringify({
    productCards: [{
      productUrl: "https://official.example/products/SR123UTS15",
      title: "스몰 워딩 코튼 반팔 티셔츠",
      text: "스몰 워딩 코튼 반팔 티셔츠 97,000원",
      price: "97,000원",
      originalPrice: "119,000원",
    }],
    pageText: "SR123UTS15 검색 결과",
    selectedChannelEmpty: false,
  }), "브랜드 공식몰", "SR123UTS15", "데상트", "스몰 워딩 코튼 반팔 티셔츠");

  assert.equal(result.count, 1);
  assert.equal(result.products[0].title, "스몰 워딩 코튼 반팔 티셔츠");
  assert.equal(result.products[0].price, 97000);
  assert.equal(result.products[0].originalPrice, 119000);
  assert.equal(result.products[0].url, "https://official.example/products/SR123UTS15");
});

test("packaged path captures official price cards without opening stock details", async () => {
  const patchSource = await readFile(new URL("../scripts/patch-naver-result-link-finalizer.mjs", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../main.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(patchSource, /const directOfficialResultLink/);
  assert.match(mainSource, /브랜드 공식몰\$\|네이버/);
  assert.match(mainSource, /resultLinkOnly: officialMallSource && listProducts\.length === 0 && !explicitAbsence/);
  assert.match(mainSource, /if \(!submitted && !interactiveOfficialSearch\)/);
});

test("official mall price row uses the product title without failure wording", async () => {
  const patchSource = await readFile(new URL("../scripts/patch-official-naver-link-only.mjs", import.meta.url), "utf8");
  const sourcingSource = await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8");

  assert.match(patchSource, /sourceStore === "브랜드 공식몰" \? candidateName : "검색 결과 링크"/);
  assert.match(sourcingSource, /source\?\.absenceConfirmed === true[\s\S]*\? "상품 없음"[\s\S]*: officialMallSource[\s\S]*\? "검색 결과"/);
});
