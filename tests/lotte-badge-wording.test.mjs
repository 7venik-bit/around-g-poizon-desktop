import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  analyzeRenderedChannelProducts,
  lotteServerSearchCard,
  parseLotteInitialDataProducts,
} from "../relay/domestic-search.mjs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

function payloadWithFlags(flags) {
  return `econJs.SearchApp.create('.srchResultWrap', {initialData: [{ "pdName": "W 덩크 로우 DD1503-101",
"pdLink": "/product/PD49741415?mall_no=1", "brandName": "나이키", "salesFlagList": ${JSON.stringify(flags)},
"priceInfo": { "original": "104300", "finalPrice": "81360" } }]});`;
}

test("lotte server flags accept every 백화점 wording variant", () => {
  assert.equal(parseLotteInitialDataProducts(payloadWithFlags(["롯데백화점"]))[0].departmentStore, true);
  assert.equal(parseLotteInitialDataProducts(payloadWithFlags(["백화점"]))[0].departmentStore, true);
  assert.equal(parseLotteInitialDataProducts(payloadWithFlags(["롯데백화점몰"]))[0].departmentStore, true);
  assert.equal(parseLotteInitialDataProducts(payloadWithFlags([]))[0].departmentStore, false);
  assert.equal(parseLotteInitialDataProducts(payloadWithFlags(["입점판매자"]))[0].departmentStore, false);
});

test("a 백화점-flagged server card reaches analysis even without 롯데 wording", () => {
  const items = parseLotteInitialDataProducts(payloadWithFlags(["백화점"]));
  assert.equal(items.length, 1);
  const card = lotteServerSearchCard(items[0]);
  assert.equal(card.departmentStoreLabelMatched, true);
  const rendered = JSON.stringify({ productCards: [card] });
  const result = analyzeRenderedChannelProducts(rendered, "롯데온", "DD1503-101", "나이키", "(W) 나이키 덩크 로우 블랙", "DD1503-101");
  assert.equal(result.products.length, 1);
  assert.ok(result.products[0].url.includes("PD49741415"));
});

test("cards without any 백화점 wording stay excluded", () => {
  const rendered = JSON.stringify({ productCards: [
    { productUrl: "https://www.lotteon.com/product/LO2598810463?mall_no=1",
      title: "화이트 블랙 덩크 로우탑 스니커즈 DD1503 101", text: "입점 판매자 화이트 블랙 덩크 DD1503 101" },
  ] });
  const result = analyzeRenderedChannelProducts(rendered, "롯데온", "DD1503-101", "나이키", "(W) 나이키 덩크 로우 블랙", "DD1503-101");
  assert.equal(result.products.length, 0);
});

test("lotte evidence records bare 백화점 wording apart from the flag", () => {
  const fnStart = main.indexOf("async function renderedSearchSourceResult(");
  const fnEnd = main.indexOf("async function renderedSearchFailure(", fnStart);
  const collection = main.slice(fnStart, fnEnd);
  const evidenceStart = collection.indexOf("lotteCollectionEvidence: {");
  assert.ok(evidenceStart >= 0, "lotte collection evidence missing");
  const evidence = collection.slice(evidenceStart, evidenceStart + 1600);
  assert.match(evidence, /badgeCards/);
  assert.match(evidence, /badgeWordCards/);
  assert.match(collection, /\/백화점\/i\.test\(/);
});

test("diagnostics show the bare wording count for empty lotte rows", () => {
  assert.match(inline, /백화점 문구 카드 수/);
  assert.match(inline, /d\.lotteCollectionEvidence\?\.badgeWordCards/);
});
