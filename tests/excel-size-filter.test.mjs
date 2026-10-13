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
