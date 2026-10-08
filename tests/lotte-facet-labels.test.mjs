import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { EXTERNAL_FACET_LABELS_SCRIPT } from "../services/external-chrome-login.mjs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const VISIBLE_RECT = {
  width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}),
};
const HIDDEN_RECT = {
  width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
};

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function runLabels(html) {
  const dom = new JSDOM(html, { url: "https://www.lotteon.com/", runScripts: "outside-only" });
  dom.window.Element.prototype.getBoundingClientRect = () => ({ ...VISIBLE_RECT });
  return plain(vm.runInContext(EXTERNAL_FACET_LABELS_SCRIPT, dom.getInternalVMContext()));
}

test("facet label snapshot lists visible filter labels with check state", () => {
  const result = runLabels(`<form>
    <label><input type="checkbox" checked> 롯데백화점</label>
    <input type="checkbox" id="seller"><label for="seller">입점 판매자 (12)</label>
    <input type="checkbox" aria-label="무료배송">
  </form>`);
  assert.deepEqual(result, [
    { label: "롯데백화점", checked: true },
    { label: "입점 판매자 (12)", checked: false },
    { label: "무료배송", checked: false },
  ]);
});

test("facet label snapshot skips hidden boxes and dedupes", () => {
  const dom = new JSDOM(`<form>
    <label><input type="checkbox" id="shown"> 롯데백화점</label>
    <label><input type="checkbox" id="hidden"> 숨은필터</label>
    <label><input type="checkbox" id="dup"> 롯데백화점 </label>
  </form>`, { url: "https://www.lotteon.com/", runScripts: "outside-only" });
  dom.window.Element.prototype.getBoundingClientRect = () => ({ ...VISIBLE_RECT });
  dom.window.document.getElementById("hidden").getBoundingClientRect = () => ({ ...HIDDEN_RECT });
  const result = plain(vm.runInContext(EXTERNAL_FACET_LABELS_SCRIPT, dom.getInternalVMContext()));
  assert.deepEqual(result.map((entry) => entry.label), ["롯데백화점"]);
});

test("facet label snapshot caps entries and truncates long labels", () => {
  const boxes = Array.from({ length: 45 }, (_, index) => `<label><input type="checkbox"> 필터${index}</label>`).join("");
  const result = runLabels(`<form>${boxes}<label><input type="checkbox"> ${"가".repeat(50)}</label></form>`);
  assert.equal(result.length, 40);
  assert.ok(result.every((entry) => entry.label.length <= 40));
});

test("lotte collection snapshots the real filter menu when the label misses", () => {
  assert.match(main, /EXTERNAL_FACET_LABELS_SCRIPT,\n/);
  const blockStart = main.indexOf("let lotteAvailableFacets = [];");
  assert.ok(blockStart >= 0, "available facets variable missing");
  const block = main.slice(blockStart, blockStart + 5000);
  assert.match(block, /if \(Array\.isArray\(lotteMissingLabels\) && lotteMissingLabels\.length\)/);
  assert.match(block, /facetPage\.evaluate\(EXTERNAL_FACET_LABELS_SCRIPT\)/);
  assert.match(block, /\.slice\(0, 20\)/);
  assert.match(main, /availableFacets: \[\.\.\.lotteAvailableFacets\]/);
});

test("lotte retries a missed seller check after the grid settles", () => {
  const blockStart = main.indexOf("let lotteFacetRetried = false;");
  assert.ok(blockStart >= 0, "facet retry flag missing");
  const block = main.slice(blockStart, blockStart + 3500);
  // One bounded retry only: settle the grid, re-check the same labels, and
  // adopt the second outcome. Collection never waits on filters.
  assert.match(block, /await waitForDomesticCaptureReady\(searchWindow, 15_000\)/);
  assert.match(block, /lotteFacetRetried = true/);
  assert.match(block, /const retry = await checkSearchFacets\(\{/);
  assert.match(block, /labels: retailerFacetLabels\("lotte", brand\)/);
  assert.match(block, /if \(Array\.isArray\(retry\.missing\)\) lotteMissingLabels = \[\.\.\.retry\.missing\]/);
  assert.match(main, /availableFacets: \[\.\.\.lotteAvailableFacets\]/);
  assert.match(main, /facetRetried: lotteFacetRetried/);
});

test("diagnostics show the real filter menu for empty lotte rows", () => {
  assert.match(inline, /판매처 필터 목록/);
  assert.match(inline, /d\.lotteCollectionEvidence\?\.availableFacets/);
  assert.match(inline, /판매처 재확인/);
  assert.match(inline, /d\.lotteCollectionEvidence\?\.facetRetried === true/);
});
