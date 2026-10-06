import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { findSsgDepartmentTab } from "../services/external-chrome-login.mjs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

const fnStart = main.indexOf("async function renderedSearchSourceResult(");
const fnEnd = main.indexOf("async function renderedSearchFailure(", fnStart);
const collection = main.slice(fnStart, fnEnd);

test("ssg collection applies the left-menu seller check before cards are captured", () => {
  const blockStart = collection.indexOf('source.store === "SSG" || source.store === "SSG 백화점"');
  assert.ok(blockStart >= 0, "ssg seller facet block missing");
  const block = collection.slice(blockStart, collection.indexOf("let content = await searchWindow", blockStart));
  assert.match(block, /checkSearchFacets\(/);
  assert.match(block, /retailerFacetLabels\("ssg", brand\)/);
  assert.match(block, /waitForDomesticCaptureReady\(searchWindow/);
  assert.match(block, /Facet checks must never break/);
});

test("ssg seller check keeps the outlet channel scope and never blocks collection", () => {
  const blockStart = collection.indexOf('source.store === "SSG" || source.store === "SSG 백화점"');
  const captureStart = collection.indexOf("let content = await searchWindow", blockStart);
  assert.ok(blockStart < captureStart, "facet check must run before card capture");
  const block = collection.slice(blockStart, captureStart);
  assert.match(block, /!officialDirectDetail/);
  assert.match(block, /isDestroyed/);
  assert.match(block, /checked\.length/);
  assert.match(block, /아울렛.*제외|의도적으로 제외|intentionally excluded/i);
  assert.match(block, /source\.store === "SSG" \|\| source\.store === "SSG 백화점"/);
});

test("ssg collection follows the top-menu department tab before the brand check", () => {
  const blockStart = collection.indexOf('source.store === "SSG" || source.store === "SSG 백화점"');
  const captureStart = collection.indexOf("let content = await searchWindow", blockStart);
  const block = collection.slice(blockStart, captureStart);
  assert.match(block, /shpp=department/);
  assert.match(block, /findSsgDepartmentTab/);
  assert.match(block, /loadURL\(deptAction\)/);
  assert.match(block, /DeptTab/);
  const tabIndex = block.indexOf("findSsgDepartmentTab");
  const facetIndex = block.indexOf('retailerFacetLabels("ssg", brand)');
  assert.ok(tabIndex < facetIndex, "department tab must precede the brand check");
});

test("ssg collection records facet outcome and card evidence for diagnosis", () => {
  assert.match(collection, /ssgCollectionEvidence/);
  const evidenceStart = collection.indexOf("ssgCollectionEvidence");
  const evidence = collection.slice(evidenceStart, evidenceStart + 1200);
  assert.match(evidence, /facetChecked/);
  assert.match(evidence, /facetMissing/);
  assert.match(evidence, /facetSettled/);
  assert.match(evidence, /deptTab/);
  assert.match(evidence, /renderedCards/);
  assert.match(evidence, /badgeCards/);
  assert.match(evidence, /candidateCount/);
});

test("empty ssg rows are included in the diagnostics block", () => {
  assert.match(inline, /source\?\.verificationDiagnostics\?\.ssgCollectionEvidence/);
  assert.match(inline, /판매처 체크 적용/);
  assert.match(inline, /판매처 체크 누락/);
  assert.match(inline, /백화점 탭/);
  assert.match(inline, /수집 카드 수/);
  assert.match(inline, /백화점 카드 수/);
});

function runDepartmentTab(html) {
  const dom = new JSDOM(html, { url: "https://www.ssg.com/search.ssg?query=CW2288-001" });
  dom.window.Element.prototype.getBoundingClientRect = () => ({
    width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24, x: 0, y: 0, toJSON: () => ({}),
  });
  const clicked = [];
  for (const el of dom.window.document.querySelectorAll("a,button")) {
    el.addEventListener("click", () => clicked.push(el.textContent.trim()));
  }
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    return { result: findSsgDepartmentTab(), clicked };
  } finally {
    globalThis.document = previous;
  }
}

test("department tab prefers its scoped link over the header navigation", () => {
  const { result, clicked } = runDepartmentTab([
    '<header><nav><a href="https://www.ssg.com/department/main.ssg">백화점</a></nav></header>',
    '<section><h2>검색 필터</h2><a href="https://www.ssg.com/search.ssg?query=CW2288-001&shpp=department">백화점</a></section>',
  ].join(""));
  assert.ok(String(result).includes("shpp=department"));
  assert.deepEqual(clicked, []);
});

test("a href-less filter tab is clicked, never the header navigation", () => {
  const { result, clicked } = runDepartmentTab([
    '<header><nav><a href="https://www.ssg.com/department/main.ssg">백화점</a></nav></header>',
    '<section><h2>검색 필터</h2><div><button type="button">백화점</button></div></section>',
  ].join(""));
  assert.equal(result, "clicked");
  assert.deepEqual(clicked, ["백화점"]);
});

test("no filter tab means no click anywhere", () => {
  const { result, clicked } = runDepartmentTab(
    '<header><nav><a href="https://www.ssg.com/department/main.ssg">백화점</a></nav></header><section><h2>검색 필터</h2></section>',
  );
  assert.equal(result, "");
  assert.deepEqual(clicked, []);
});
