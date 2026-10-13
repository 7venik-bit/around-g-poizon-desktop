import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const script = readFileSync(new URL("../src/excel-size-filter.js", import.meta.url), "utf8");

const PRODUCTS = [
  { title: "A", url: "https://example.test/a", sizes: [{ label: "220", inStock: true }] },
  { title: "B", url: "https://example.test/b", sizes: [{ label: "230", inStock: true }, { label: "M", inStock: true }] },
  { title: "C", url: "https://example.test/c", sizes: [] },
];

function setup(t) {
  const dom = new JSDOM(`<body><table>
    <tr class="excel-product-row"><td><div class="excel-raw-search-summary">
      <button type="button" data-excel-search-product="k1">다시 검색</button><button type="button" class="excel-size-filter" data-excel-size-filter="k1">사이즈검색</button>
    </div></td></tr>
    <tr class="excel-product-search-detail"><td><div class="domestic-inline-detail-label">old</div></td></tr>
  </table></body>`, { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.excelPreviewSearchResults = new Map([["k1", { products: PRODUCTS, sources: [] }]]);
  window.excelPreviewProductCache = new Map([["k1", { title: "T" }]]);
  const calls = [];
  window.renderDomestic = (view, product, key) => {
    calls.push({ products: view.products.map((item) => item.title), key });
    return '<div class="mock-results"></div>';
  };
  window.eval(script);
  return { window, calls, document: window.document };
}

const click = (element) => element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent("click", { bubbles: true }));

test("size panel opens with shoe sizes and switches to clothing", (t) => {
  const { document } = setup(t);
  click(document.querySelector("[data-excel-size-filter]"));
  const panel = document.querySelector(".excel-size-panel");
  assert.ok(panel);
  assert.ok(panel.querySelector('[data-size-chip="220"]'));
  assert.equal(panel.querySelector('[data-size-chip="XS"]'), null);
  click(panel.querySelector('[data-size-category="clothing"]'));
  const reopened = document.querySelector(".excel-size-panel");
  assert.ok(reopened.querySelector('[data-size-chip="XS"]'));
  assert.ok(reopened.querySelector('[data-size-chip="M"]'));
});

test("applying sizes narrows the rendered products", (t) => {
  const { document, calls } = setup(t);
  click(document.querySelector("[data-excel-size-filter]"));
  const panel = document.querySelector(".excel-size-panel");
  click(panel.querySelector('[data-size-chip="220"]'));
  click(panel.querySelector("[data-size-apply]"));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].products, ["A"]);
  assert.equal(document.querySelector("[data-excel-size-filter]").textContent, "사이즈(1)");
  assert.match(document.querySelector(".excel-product-search-detail td").innerHTML, /mock-results/);
});

test("clothing alpha sizes match by token", (t) => {
  const { document, calls } = setup(t);
  click(document.querySelector("[data-excel-size-filter]"));
  click(document.querySelector('[data-size-category="clothing"]'));
  click(document.querySelector('[data-size-chip="M"]'));
  click(document.querySelector("[data-size-apply]"));
  assert.deepEqual(calls[0].products, ["B"]);
});

test("clearing restores the full list", (t) => {
  const { document, calls } = setup(t);
  click(document.querySelector("[data-excel-size-filter]"));
  click(document.querySelector('[data-size-chip="220"]'));
  click(document.querySelector("[data-size-apply]"));
  click(document.querySelector("[data-excel-size-filter]"));
  click(document.querySelector("[data-size-clear]"));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].products, ["A", "B", "C"]);
  assert.equal(document.querySelector("[data-excel-size-filter]").textContent, "사이즈검색");
});

test("filter globals narrow results and label the button", (t) => {
  const { window } = setup(t);
  assert.equal(typeof window.excelSizeFilterButton, "function");
  assert.equal(typeof window.excelSizeFilteredResult, "function");
  assert.match(window.excelSizeFilterButton("k1"), /사이즈검색/);
  const view = window.excelSizeFilteredResult("k1", { products: PRODUCTS, sources: [] });
  assert.deepEqual(view.products.map((item) => item.title), ["A", "B", "C"]);
});

const HATS = [
  { title: "H1", url: "https://example.test/h1", sizes: [{ label: "S/M", inStock: true }] },
  { title: "H2", url: "https://example.test/h2", sizes: [{ label: "M/L", inStock: true }] },
  { title: "H3", url: "https://example.test/h3", sizes: [{ label: "프리", inStock: true }] },
];

test("headwear ranges match by parts and free sizes by alias", (t) => {
  const { document, calls, window } = setup(t);
  window.excelPreviewSearchResults.set("k1", { products: HATS, sources: [] });
  click(document.querySelector("[data-excel-size-filter]"));
  click(document.querySelector('[data-size-category="headwear"]'));
  assert.ok(document.querySelector('[data-size-chip="S/M"]'));
  assert.ok(document.querySelector('[data-size-chip="57"]'));
  click(document.querySelector('[data-size-chip="S/M"]'));
  click(document.querySelector("[data-size-apply]"));
  assert.deepEqual(calls[0].products, ["H1"]);
  click(document.querySelector("[data-excel-size-filter]"));
  click(document.querySelector("[data-size-clear]"));
  click(document.querySelector("[data-excel-size-filter]"));
  click(document.querySelector('[data-size-category="headwear"]'));
  click(document.querySelector('[data-size-chip="FREE"]'));
  click(document.querySelector("[data-size-apply]"));
  assert.deepEqual(calls[2].products, ["H3"]);
});

test("plain M matches any range carrying it", (t) => {
  const { document, calls, window } = setup(t);
  window.excelPreviewSearchResults.set("k1", { products: [
    { title: "H1", url: "https://example.test/h1", sizes: [{ label: "S/M", inStock: true }] },
    { title: "H2", url: "https://example.test/h2", sizes: [{ label: "L/XL", inStock: true }] },
  ], sources: [] });
  click(document.querySelector("[data-excel-size-filter]"));
  click(document.querySelector('[data-size-category="clothing"]'));
  click(document.querySelector('[data-size-chip="M"]'));
  click(document.querySelector("[data-size-apply]"));
  assert.deepEqual(calls[0].products, ["H1"]);
});

test("hat rows open the panel on headwear", (t) => {
  const { document, window } = setup(t);
  window.categoryGroupFromProduct = () => "모자";
  window.excelPreviewProductCache.set("k1", { title: "MLB 볼캡" });
  click(document.querySelector("[data-excel-size-filter]"));
  const panel = document.querySelector(".excel-size-panel");
  assert.ok(panel.querySelector('[data-size-chip="S/M"]'));
  assert.equal(panel.querySelector('[data-size-category="headwear"]').getAttribute("aria-pressed"), "true");
  delete window.categoryGroupFromProduct;
});

test("applying before any search starts the product search", (t) => {
  const dom = new JSDOM(`<body><table>
    <tr class="excel-product-row"><td>
      <button type="button" class="excel-product-search" data-excel-search-product="k9">상품검색</button><button type="button" class="excel-size-filter" data-excel-size-filter="k9">사이즈검색</button>
    </td></tr>
  </table></body>`, { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  const script = readFileSync(new URL("../src/excel-size-filter.js", import.meta.url), "utf8");
  window.excelPreviewSearchResults = new Map();
  window.excelPreviewProductCache = new Map();
  let searches = 0;
  window.document.querySelector("[data-excel-search-product]").addEventListener("click", () => { searches += 1; });
  window.eval(script);
  const { document } = window;
  const fire = (element) => element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  fire(document.querySelector("[data-excel-size-filter]"));
  fire(document.querySelector('[data-size-chip="225"]'));
  fire(document.querySelector("[data-size-apply]"));
  assert.equal(searches, 1);
  assert.equal(document.querySelector("[data-excel-size-filter]").textContent, "사이즈검색");
});
