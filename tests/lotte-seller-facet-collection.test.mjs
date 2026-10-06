import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");

const start = main.indexOf("async function renderedSearchSourceResult(");
const end = main.indexOf("async function renderedSearchFailure(", start);
const collection = main.slice(start, end);

test("lotte collection applies the left-menu seller check before cards are captured", () => {
  const blockStart = collection.indexOf('if (source.store === "롯데온"');
  assert.ok(blockStart >= 0, "lotte seller facet block missing");
  const block = collection.slice(blockStart, collection.indexOf("let content = await searchWindow", blockStart));
  assert.match(block, /checkSearchFacets\(/);
  assert.match(block, /retailerFacetLabels\("lotte", brand\)/);
  assert.match(block, /waitForDomesticCaptureReady\(searchWindow/);
  assert.match(block, /Facets checks must never break|Facet checks must never break/);
});

test("lotte seller check is scoped and never blocks unfiltered collection", () => {
  const blockStart = collection.indexOf('if (source.store === "롯데온"');
  const captureStart = collection.indexOf("let content = await searchWindow", blockStart);
  assert.ok(blockStart < captureStart, "facet check must run before card capture");
  const revertStart = collection.indexOf("// A scope that empties the grid", blockStart);
  const block = collection.slice(blockStart, revertStart);
  assert.match(block, /!officialDirectDetail/);
  assert.match(block, /isDestroyed/);
  assert.match(block, /checked\.length/);
  assert.doesNotMatch(block, /네이버|무신사|SSG 백화점/);
});
