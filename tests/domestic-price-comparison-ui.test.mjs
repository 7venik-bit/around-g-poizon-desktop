import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sourcing = await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8");
const officialPatch = await readFile(new URL("../scripts/patch-official-naver-link-only.mjs", import.meta.url), "utf8");

test("product summary exposes POIZON and domestic price comparison columns", () => {
  for (const label of ["POIZON 기준가", "국내 최저가", "가격 차이", "예상 마진율"]) {
    assert.match(sourcing, new RegExp(label));
  }
  assert.match(sourcing, /domesticPriceComparison\(result, poizonPrice\)/);
  assert.match(sourcing, /difference = lowest\.price - basePrice/);
  assert.match(sourcing, /\(difference \/ lowest\.price\) \* 100/);
  assert.match(sourcing, /수수료·배송비 미반영/);
  assert.match(sourcing, /function sourcingPoizonPrice\(product = \{\}\)/);
  assert.doesNotMatch(sourcing, /verifiedExcelProductPoizonPrice/);
});

test("price comparison renderer supersedes an already-installed legacy sourcing renderer", () => {
  assert.match(sourcing, /renderDomestic\.__aroundGPriceComparison/);
  assert.match(sourcing, /renderExcelProductRows\.__aroundGPriceComparison/);
  assert.doesNotMatch(sourcing, /renderDomestic\.__aroundGMusinsaList\) return/);
  assert.doesNotMatch(sourcing, /renderExcelProductRows\.__aroundGSourcingView\) return/);
});

test("price comparison executes and renders its 14-column summary and expanded values", async () => {
  const columns = { innerHTML: "" };
  const rows = { innerHTML: "" };
  const inertNode = { innerHTML: "", hidden: false, classList: { add() {} }, setAttribute() {} };
  const document = {
    head: { appendChild() {} },
    documentElement: { hasAttribute: () => false, setAttribute() {} },
    createElement: () => ({ dataset: {}, textContent: "", setAttribute() {} }),
    querySelector(selector) {
      if (selector === "#excel-preview-columns") return columns;
      if (selector === "#excel-preview-rows") return rows;
      if (selector === "#explorer-results") return inertNode;
      return null;
    },
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    console,
    document,
    MutationObserver: class { observe() {} },
    HTMLImageElement: class {},
    Element: class {},
    queueMicrotask,
    Map,
    Number,
    String,
  });
  vm.runInContext(`
    var excelPreviewProductCache = new Map();
    var excelPreviewSearchResults = new Map();
    var domesticStatus = function () { return { label: "기존", className: "pending" }; };
    var renderDomestic = function () { return "기존 펼침"; };
    renderDomestic.__aroundGMusinsaList = true;
    var renderExcelProductRows = function () { return "기존 표"; };
    renderExcelProductRows.__aroundGSourcingView = true;
    var updateExplorerSelectionUi = function () {};
    var updateDomesticStockFilter = function () {};
    var text = function (value) { return String(value ?? ""); };
    var money = function (value) { return Number(value).toLocaleString("ko-KR") + "원"; };
    var brandImportPathKey = function (value) { return String(value || ""); };
    var excelProductMetric = function (_raw, value) { return String(value || 0); };
  `, context);
  vm.runInContext(String(sourcing), context);
  vm.runInContext(`
    excelPreviewSearchResults.set("sample.xlsx::IQ4937-161", {
      products: [{ store: "무신사", name: "나이키 에어 포스", price: 129000, shippingFee: 0, inStock: true, url: "https://example.com/product" }],
      sources: [{ store: "무신사", count: 1 }]
    });
    renderExcelProductRows({ path: "sample.xlsx" }, [{
      key: "IQ4937-161", articleNumber: "IQ4937-161", title: "나이키 에어 포스", brandName: "나이키",
      option: "KR 240", sales30d: 34, averagePrice: 114000, totalSales: 100, localTotalSales: 34
    }]);
  `, context);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.match(columns.innerHTML, /POIZON 기준가/);
  assert.match(columns.innerHTML, /국내 최저가/);
  assert.match(columns.innerHTML, /예상 마진율/);
  assert.match(rows.innerHTML, /판매처별 가격 비교/);
  assert.match(rows.innerHTML, /배송비/);
  assert.match(rows.innerHTML, /129,000원/);
  assert.match(rows.innerHTML, /\+15,000원/);
});

test("expanded result shows exact retailer price fields without inventing shipping", () => {
  for (const label of ["판매처", "상품명", "판매가", "배송비", "실구매가", "재고", "POIZON 대비", "링크"]) {
    assert.match(sourcing, new RegExp(label));
  }
  assert.match(sourcing, /domesticProductShipping/);
  assert.match(sourcing, /shipping\.known \? shipping\.amount \? money/);
  assert.match(sourcing, /shipping\.known \? price \+ shipping\.amount/);
  assert.match(sourcing, /"미확인"/);
});

test("only usable verified retailer prices enter the domestic minimum", () => {
  assert.match(sourcing, /domesticPriceEligibleProduct/);
  assert.match(sourcing, /product\.inStock !== false/);
  assert.match(sourcing, /product\.parallelRetailerVerified === true/);
  assert.match(sourcing, /\.sort\(\(left, right\) => left\.price - right\.price\)/);
});

test("link-only sources remain visible in the comparison table", () => {
  assert.match(sourcing, /source\?\.resultLinkOnly === true/);
  assert.match(sourcing, /검색 결과 링크/);
  assert.match(officialPatch, /render official and Naver links inside the price comparison/);
  assert.match(officialPatch, /sourcing-price-row/);
});
