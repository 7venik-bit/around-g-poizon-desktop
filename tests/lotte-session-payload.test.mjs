import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

const fnStart = main.indexOf("async function renderedSearchSourceResult(");
const fnEnd = main.indexOf("async function renderedSearchFailure(", fnStart);
const collection = main.slice(fnStart, fnEnd);

test("lotte server payload is read from the logged-in session window first", () => {
  const blockStart = collection.indexOf('String(source.store || "") === "롯데온"');
  assert.ok(blockStart >= 0, "lotte server fallback block missing");
  const block = collection.slice(blockStart, collection.indexOf("const analyzed = analyzeRenderedChannelProducts(content", blockStart));
  assert.match(block, /document\.documentElement \? document\.documentElement\.outerHTML/);
  assert.match(block, /parseLotteInitialDataProducts\(String\(sessionHtml/);
  assert.match(block, /origin: "session-dom"/);
  const sessionAt = block.indexOf("session-dom");
  const fetchAt = block.indexOf('origin: "direct-fetch"');
  assert.ok(sessionAt >= 0 && fetchAt > sessionAt, "session DOM must precede the session-less fetch");
  assert.match(block, /if \(!lotteServerAnalyzed\)/);
});

test("lotte server payload is consulted when DOM cards carry no department badge", () => {
  // The badge gate sits just before the fallback condition, outside the
  // session-payload block slice, so anchor on the gate itself.
  const gateAt = collection.indexOf("lotteDomBadgeCards");
  assert.ok(gateAt >= 0, "lotte badge gate missing");
  const gate = collection.slice(Math.max(0, gateAt - 600), gateAt + 400);
  // Marketplace cards without the badge never become candidates, so a DOM
  // grid full of them must not suppress the flagged server payload.
  assert.match(gate, /departmentStoreLabelMatched === true/);
  assert.match(gate, /lotteDomBadgeCards === 0/);
});

test("lotte session-less fetch identifies as a desktop browser", () => {
  const blockStart = collection.indexOf('String(source.store || "") === "롯데온"');
  assert.ok(blockStart >= 0, "lotte server fallback block missing");
  const block = collection.slice(blockStart, collection.indexOf("const analyzed = analyzeRenderedChannelProducts(content", blockStart));
  const fetchAt = block.indexOf('origin: "direct-fetch"');
  assert.ok(fetchAt > 0, "direct-fetch fallback missing");
  assert.match(block, /user-agent/);
  assert.match(block, /Chrome\/151\.0\.0\.0/);
  assert.match(block, /accept-language/);
});

test("lotte confirms an absence only with corroborating evidence", () => {
  const facetAt = collection.indexOf('labels: retailerFacetLabels("lotte", brand)');
  assert.ok(facetAt >= 0, "lotte facet check missing");
  assert.match(collection.slice(facetAt, facetAt + 600), /lotteMissingLabels = \[\.\.\.facetResult\.missing/);
  const evidenceAt = collection.indexOf("lotteCollectionEvidence: {");
  assert.ok(evidenceAt >= 0, "lotte collection evidence missing");
  const evidence = collection.slice(evidenceAt, evidenceAt + 1600);
  assert.match(evidence, /facetMissing: \[\.\.\.lotteMissingLabels\]/);
  assert.match(evidence, /noDepartmentGoods/);
  assert.match(evidence, /identityDrops/);
  // A missed checkbox alone never confirms: the panel must have rendered
  // without any department option and the grid must carry no department
  // wording. Otherwise the row stays pending review with its evidence.
  const forcing = collection.slice(Math.max(0, evidenceAt - 1400), evidenceAt);
  assert.match(forcing, /lotteMenuGenuinelyMissing/);
  assert.match(forcing, /lotteAvailableFacets\.length > 0/);
  assert.match(forcing, /lotteNoDepartmentWord/);
  assert.match(forcing, /badgeWordCards === 0/);
  assert.match(forcing, /absenceConfirmed = true/);
  assert.match(forcing, /detailVerificationPending = false/);
});

test("lotte facet settlement is recorded truthfully", () => {
  const facetAt = collection.indexOf('labels: retailerFacetLabels("lotte", brand)');
  assert.ok(facetAt >= 0, "lotte facet check missing");
  assert.match(collection.slice(facetAt, facetAt + 800), /lotteFacetSettled = facetResult\.settled === true/);
  const evidenceAt = collection.indexOf("lotteCollectionEvidence: {");
  assert.ok(evidenceAt >= 0, "lotte collection evidence missing");
  assert.match(collection.slice(evidenceAt, evidenceAt + 1200), /facetSettled: lotteFacetSettled/);
});

test("lotte detail exclusion gates read chrome-free scope text", () => {
  assert.match(main, /detailScopeText = String\(identitySnapshot\.scopeText/);
  assert.match(main, /const gateEvidence = /);
  assert.match(main, /isOverseasPurchaseProduct\(gateEvidence\)/);
  assert.match(main, /isConsignmentOperatedProduct\(gateEvidence\)/);
  assert.match(main, /isParallelImportProductDetail\(gateEvidence\)/);
});

test("lotte server evidence records which document it came from", () => {
  assert.match(inline, /서버 검색 출처/);
  assert.match(inline, /origin === "session-dom" \? "세션 화면"/);
  assert.match(inline, /origin === "direct-fetch" \? "직접 조회"/);
});
