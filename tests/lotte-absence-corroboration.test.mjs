import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeRenderedChannelProducts } from "../relay/domestic-search.mjs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const fnStart = main.indexOf("async function renderedSearchSourceResult(");
const fnEnd = main.indexOf("async function renderedSearchFailure(", fnStart);
const collection = main.slice(fnStart, fnEnd);

test("an empty lotte analysis never confirms an absence by itself", () => {
  const empty = analyzeRenderedChannelProducts(
    JSON.stringify({ productCards: [] }), "롯데온", "DD1503-101", "나이키", "(W) 나이키 덩크 로우 블랙", "DD1503-101");
  assert.equal(empty.products.length, 0);
  // Without corroboration the row must stay pending review, never a false
  // authoritative absence.
  assert.equal(empty.absenceConfirmed, false);
});

test("badged cards dropped on identity stay pending with counted drops", () => {
  const rendered = JSON.stringify({ productCards: [
    { productUrl: "https://www.lotteon.com/product/PD99999999?mall_no=1",
      title: "W 덩크 로우 DD1503-101", text: "롯데백화점 W 덩크 로우 DD1503-101",
      departmentStoreLabelMatched: true },
    { productUrl: "https://www.lotteon.com/product/PD88888888?mall_no=1",
      title: "다른 모델 AB1234-567", text: "롯데백화점 다른 모델 AB1234-567 DD1503-101 관련",
      departmentStoreLabelMatched: true },
  ] });
  const result = analyzeRenderedChannelProducts(
    rendered, "롯데온", "DD1503-101", "나이키", "(W) 나이키 덩크 로우 블랙", "DD1503-101");
  assert.ok(result.identityDrops.evaluated >= 1);
  assert.equal(result.absenceConfirmed, false);
});

test("absence forcing requires a rendered panel without department options", () => {
  const evidenceAt = collection.indexOf("lotteCollectionEvidence: {");
  assert.ok(evidenceAt >= 0, "lotte collection evidence missing");
  const forcing = collection.slice(Math.max(0, evidenceAt - 1400), evidenceAt);
  // The filter panel must have rendered (snapshot non-empty) yet offer no
  // department wording: a merely missed checkbox is a late panel, not proof.
  assert.match(forcing, /lotteMenuGenuinelyMissing = lotteMenuMissing/);
  assert.match(forcing, /lotteAvailableFacets\.length > 0/);
  assert.match(forcing, /!lotteAvailableFacets\.some\(\(label\) => \/백화점\/i\.test\(label\)\)/);
  assert.match(forcing, /const lotteNoDepartmentGoods = lotteMenuGenuinelyMissing && candidateCount === 0/);
});

test("absence forcing requires zero department wording in the grid", () => {
  const evidenceAt = collection.indexOf("lotteCollectionEvidence: {");
  const forcing = collection.slice(Math.max(0, evidenceAt - 1400), evidenceAt);
  assert.match(forcing, /lotteNoDepartmentWord = badgeWordCards === 0/);
  assert.match(forcing, /&& lotteRenderedGoods && lotteNoDepartmentWord/);
});
