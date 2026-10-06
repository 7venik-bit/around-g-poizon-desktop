import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

const fnStart = main.indexOf("async function renderedSearchSourceResult(");
const fnEnd = main.indexOf("async function renderedSearchFailure(", fnStart);
const collection = main.slice(fnStart, fnEnd);

test("lotte collection records facet outcome and card evidence for diagnosis", () => {
  const evidenceStart = collection.indexOf("lotteCollectionEvidence");
  assert.ok(evidenceStart >= 0, "lotte collection evidence missing");
  const evidence = collection.slice(evidenceStart, evidenceStart + 1200);
  assert.match(evidence, /facetChecked/);
  assert.match(evidence, /facetMissing/);
  assert.match(evidence, /facetSettled/);
  assert.match(evidence, /renderedCards/);
  assert.match(evidence, /badgeCards/);
  assert.match(evidence, /candidateCount/);
  assert.match(evidence, /noDepartmentGoods/);
  assert.match(evidence, /scopeReverted/);
  assert.match(evidence, /articleCards/);
  assert.match(evidence, /mirrorCards/);
  assert.match(collection, /departmentStoreLabelMatched === true/);
});

test("lotte evidence falls back to empty values when the seller check never ran", () => {
  assert.match(collection, /let lotteCheckedLabels = \[\]/);
  assert.match(collection, /let lotteMissingLabels = \[\]/);
  assert.match(collection, /facetChecked: \[\.\.\.lotteCheckedLabels\]/);
  assert.match(collection, /facetMissing: \[\.\.\.lotteMissingLabels\]/);
  assert.match(collection, /scopeArticleCards < 0 \? null : scopeArticleCards/);
  assert.match(collection, /mirrorCards: mirrorGridCards/);
});

test("empty lotte rows are included in the diagnostics block with the new fields", () => {
  assert.match(inline, /source\?\.verificationDiagnostics\?\.lotteCollectionEvidence/);
  assert.match(inline, /d\.lotteCollectionEvidence\?\.facetChecked/);
  assert.match(inline, /d\.lotteCollectionEvidence\?\.facetMissing/);
  assert.match(inline, /d\.lotteCollectionEvidence\?\.renderedCards \?\? d\.ssgCollectionEvidence\?\.renderedCards/);
  assert.match(inline, /d\.lotteCollectionEvidence\?\.badgeCards \?\? d\.ssgCollectionEvidence\?\.badgeCards/);
  assert.match(inline, /d\.lotteCollectionEvidence\?\.candidateCount \?\? d\.ssgCollectionEvidence\?\.candidateCount/);
});
