import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import {
  EXTERNAL_FACET_POINT_SCRIPT,
  EXTERNAL_FACET_UNCHECK_SCRIPT,
  EXTERNAL_PRODUCT_CARD_POINT_SCRIPT,
  EXTERNAL_SSG_DEPARTMENT_HREF_SCRIPT,
  EXTERNAL_SSG_DEPARTMENT_TAB_POINT_SCRIPT,
  EXTERNAL_GRID_ARTICLE_COUNT_SCRIPT,
  checkSearchFacets,
  clickSearchFacetsVisibly,
} from "../services/external-chrome-login.mjs";

const main = fs.readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const inline = fs.readFileSync(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

function visibleDom(html, url = "https://www.ssg.com/") {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  dom.window.Element.prototype.getBoundingClientRect = () => ({
    width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24, x: 0, y: 0, toJSON: () => ({}),
  });
  return dom;
}

function runScript(script, args, dom) {
  const expression = args === undefined ? script : `(${script})(${args.map((arg) => JSON.stringify(arg)).join(", ")})`;
  return vm.runInContext(expression, dom.getInternalVMContext());
}

test("facet points expose unchecked boxes for the visible mouse", () => {
  const dom = visibleDom([
    '<label><input type="checkbox" id="dept"> 롯데백화점</label>',
    '<input type="checkbox" id="brand" checked><label for="brand">나이키</label>',
  ].join(""), "https://www.lotteon.com/");
  const unchecked = runScript(EXTERNAL_FACET_POINT_SCRIPT, [["롯데백화점", "나이키"], false], dom);
  assert.equal(unchecked.length, 1);
  assert.equal(unchecked[0].label, "롯데백화점");
  assert.ok(Number.isFinite(unchecked[0].x) && Number.isFinite(unchecked[0].y));
  const checked = runScript(EXTERNAL_FACET_POINT_SCRIPT, [["롯데백화점", "나이키"], true], dom);
  assert.equal(checked.length, 1);
  assert.equal(checked[0].label, "나이키");
});

test("facet uncheck clicks only checked matches inside the page", () => {
  const dom = visibleDom([
    '<label><input type="checkbox" id="dept" checked> 롯데백화점</label>',
    '<label><input type="checkbox" id="other" checked> 무료배송</label>',
    '<label><input type="checkbox" id="brand"> 나이키</label>',
  ].join(""));
  const { unchecked } = runScript(EXTERNAL_FACET_UNCHECK_SCRIPT, [["롯데백화점", "나이키"]], dom);
  assert.deepEqual([...unchecked], ["롯데백화점"]);
  assert.equal(dom.window.document.getElementById("dept").checked, false);
  assert.equal(dom.window.document.getElementById("other").checked, true);
  assert.equal(dom.window.document.getElementById("brand").checked, false);
});

test("product card point prefers the article card without clicking", () => {
  const dom = visibleDom([
    '<ul><li><a href="https://www.lotteon.com/p/product/PD1?mall_no=1">나이키 W 덩크 로우 DD1503-101</a></li>',
    '<li><a href="https://www.lotteon.com/p/product/PD2?mall_no=1">나이키 에어 모나크 415445-102</a></li></ul>',
  ].join(""), "https://www.lotteon.com/");
  const clicked = [];
  for (const el of dom.window.document.querySelectorAll("a[href]")) {
    el.addEventListener("click", () => clicked.push(el.getAttribute("href")));
  }
  const found = runScript(EXTERNAL_PRODUCT_CARD_POINT_SCRIPT, ["DD1503-101"], dom);
  assert.ok(Number.isFinite(found.x) && Number.isFinite(found.y));
  assert.ok(String(found.url).includes("PD1"));
  assert.deepEqual(clicked, []);
  const missing = runScript(EXTERNAL_PRODUCT_CARD_POINT_SCRIPT, [""], dom);
  assert.equal(missing.reason, "missing");
});

test("department href and tab point stay inside the search filter", () => {
  const dom = visibleDom([
    '<header><nav><a href="https://www.ssg.com/department/main.ssg">백화점</a></nav></header>',
    '<section><h2>검색 필터</h2><div><button type="button">백화점</button></div></section>',
  ].join(""));
  assert.equal(runScript(EXTERNAL_SSG_DEPARTMENT_HREF_SCRIPT, undefined, dom), "");
  const point = runScript(EXTERNAL_SSG_DEPARTMENT_TAB_POINT_SCRIPT, undefined, dom);
  assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y));
});

test("grid article count separates card hits from page echoes", () => {
  const dom = visibleDom([
    '<h1>DD1503-101 검색결과</h1>',
    '<ul><li><a href="https://www.lotteon.com/p/product/PD1">W 덩크 로우 DD1503-101</a></li>',
    '<li><a href="https://www.lotteon.com/p/product/PD2">에어 모나크 415445-102</a></li></ul>',
  ].join(""), "https://www.lotteon.com/");
  assert.equal(runScript(EXTERNAL_GRID_ARTICLE_COUNT_SCRIPT, ["DD1503-101"], dom), 1);
  assert.equal(runScript(EXTERNAL_GRID_ARTICLE_COUNT_SCRIPT, ["없는품번-000"], dom), 0);
});

test("visible facet clicks drive the mouse, then verify with the settle pass", async () => {
  const calls = { points: 0, checks: 0, clicks: [] };
  const page = {
    async evaluate(expression) {
      if (String(expression).includes("wantChecked")) {
        calls.points += 1;
        return [{ x: 5, y: 6, label: "롯데백화점" }];
      }
      calls.checks += 1;
      return { checked: ["롯데백화점"], missing: [], settled: true };
    },
    async clickPoint(point) {
      calls.clicks.push(point);
    },
  };
  const result = await clickSearchFacetsVisibly({ page, labels: ["롯데백화점"], sleepImpl: async () => {} });
  assert.deepEqual(result, { checked: ["롯데백화점"], missing: [], settled: true });
  assert.deepEqual(calls.clicks, [{ x: 5, y: 6, label: "롯데백화점" }]);
  assert.ok(calls.checks >= 1);
});

test("facet verification retries when every label misses on the first pass", async () => {
  // A reused warm tab resolves its navigation before the filter panel
  // renders: the first pass misses everything, the settle retry finds it.
  let calls = 0;
  const page = {
    async evaluate() {
      calls += 1;
      if (calls === 1) return { checked: [], missing: ["롯데백화점"], settled: false };
      return { checked: ["롯데백화점"], missing: [], settled: true };
    },
  };
  const slept = [];
  const result = await checkSearchFacets({
    page,
    labels: ["롯데백화점"],
    sleepImpl: async (ms) => { slept.push(ms); },
    settleMs: 3000,
  });
  assert.deepEqual(result, { checked: ["롯데백화점"], missing: [], settled: true });
  assert.equal(calls, 2);
  assert.ok(slept.length >= 1);
});

test("visible facet clicks wait for a late-rendering filter panel", async () => {
  let probes = 0;
  const calls = { clicks: [] };
  const page = {
    async evaluate(expression) {
      const text = String(expression);
      if (text.includes("wantChecked")) {
        probes += 1;
        // The filter panel renders between the first and second probe.
        if (probes < 3) return [];
        return text.includes(", true)") ? [] : [{ x: 5, y: 6, label: "롯데백화점" }];
      }
      return { checked: ["롯데백화점"], missing: [], settled: true };
    },
    async clickPoint(point) {
      calls.clicks.push(point);
    },
  };
  const result = await clickSearchFacetsVisibly({ page, labels: ["롯데백화점"], sleepImpl: async () => {} });
  assert.deepEqual(result, { checked: ["롯데백화점"], missing: [], settled: true });
  assert.deepEqual(calls.clicks, [{ x: 5, y: 6, label: "롯데백화점" }]);
  assert.ok(probes >= 3);
});

test("mirror drives a visible mouse from scope to product click", () => {
  const start = main.indexOf("async function showRetailerSearchInWindow(");
  const end = main.indexOf("let shoppingAccountServicesCache;", start);
  const mirror = main.slice(start, end);
  assert.match(mirror, /articleNumber = ""\)/);
  assert.match(mirror, /clickSearchFacetsVisibly/);
  assert.match(mirror, /EXTERNAL_SSG_DEPARTMENT_HREF_SCRIPT/);
  assert.match(mirror, /EXTERNAL_SSG_DEPARTMENT_TAB_POINT_SCRIPT/);
  assert.match(mirror, /EXTERNAL_PRODUCT_CARD_POINT_SCRIPT/);
  assert.match(mirror, /EXTERNAL_GRID_ARTICLE_COUNT_SCRIPT/);
  assert.match(mirror, /EXTERNAL_FACET_UNCHECK_SCRIPT/);
  assert.match(mirror, /\.clickPoint\(/);
  assert.ok(mirror.indexOf("closeBlankTabs") < mirror.indexOf("EXTERNAL_PRODUCT_CARD_POINT_SCRIPT"),
    "the product must open after strays are swept");
});

test("collection reverts a scope that empties the grid", () => {
  const start = main.indexOf("async function renderedSearchSourceResult(");
  const end = main.indexOf("async function renderedSearchFailure(", start);
  const collection = main.slice(start, end);
  assert.match(collection, /scopeReverted/);
  assert.match(collection, /scopeArticleCards/);
  assert.match(collection, /EXTERNAL_GRID_ARTICLE_COUNT_SCRIPT/);
  assert.match(collection, /EXTERNAL_FACET_UNCHECK_SCRIPT/);
  assert.match(collection, /ssgPreScopeUrl/);
});

test("fallback rows name the filter state of that exact run", () => {
  assert.match(inline, /function filterStatusText\(source/);
  assert.match(inline, /체크 유지/);
  assert.match(inline, /체크 없음/);
  assert.match(inline, /백화점 상품 없음 · 병행수입으로 판단/);
  assert.match(inline, /domestic-inline-filter/);
  assert.match(inline, /const filterStatus = filterStatusText\(source\)/);
});

test("empty rows expose scope evidence in the diagnostics block", () => {
  assert.match(inline, /source\?\.verificationDiagnostics\?\.lotteCollectionEvidence/);
  assert.match(inline, /source\?\.verificationDiagnostics\?\.ssgCollectionEvidence/);
  assert.match(inline, /판매처 체크 적용/);
  assert.match(inline, /판매처 체크 누락/);
  assert.match(inline, /백화점 탭/);
  assert.match(inline, /범위 복원/);
  assert.match(inline, /품번 카드 수/);
  assert.match(inline, /수집 카드 수/);
  assert.match(inline, /백화점 상품/);
  assert.match(inline, /병행수입으로 판단/);
});
