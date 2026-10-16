import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
const inlineResults = await readFile(new URL("../src/domestic-inline-results.js", import.meta.url), "utf8");

test("verified brand results expand as a full-width list below the searched product", () => {
  const start = renderer.indexOf("function renderVerifiedSpuRows(");
  const end = renderer.indexOf("function mergeDomesticSearchProducts(", start);
  const verifiedRenderer = renderer.slice(start, end);

  assert.match(verifiedRenderer, /excel-verified-search-detail/);
  assert.match(verifiedRenderer, /<td colspan="10">/);
  assert.match(verifiedRenderer, /renderDomestic\(.*?, p, keys\[i\]\)/);
  assert.match(verifiedRenderer, /result && !result\.loading/);
  assert.doesNotMatch(verifiedRenderer, /renderRawExcelDomesticCell/);
});

test("successful original and verified searches keep the result cell slim; retry appears only on failure", () => {
  const originalStart = renderer.indexOf("function renderOriginalExcelRows(file, products = []) {");
  const originalEnd = renderer.indexOf("function renderOriginalSkuSales(", originalStart);
  const originalRows = renderer.slice(originalStart, originalEnd);
  assert.match(originalRows, /검색 실패/);
  assert.match(originalRows, /다시 검색/);
  assert.match(originalRows, /excel-pending-actions/);
  assert.doesNotMatch(originalRows, /검색 완료/);
  assert.doesNotMatch(originalRows, /일부 결과/);
  assert.doesNotMatch(originalRows, /상품검색/);
  assert.doesNotMatch(originalRows, /사이즈검색/);
  assert.doesNotMatch(originalRows, /포이즌 상품 보기/);

  const start = renderer.indexOf("function renderVerifiedSpuRows(");
  const end = renderer.indexOf("function mergeDomesticSearchProducts(", start);
  const verifiedRenderer = renderer.slice(start, end);
  assert.match(verifiedRenderer, /excel-pending-actions/);
  assert.match(verifiedRenderer, />검색<\/button>/);
  assert.doesNotMatch(verifiedRenderer, /검색 완료/);
  assert.doesNotMatch(verifiedRenderer, /일부 결과/);
  assert.doesNotMatch(verifiedRenderer, /상품검색/);
  assert.doesNotMatch(verifiedRenderer, /사이즈검색/);
  assert.doesNotMatch(verifiedRenderer, /포이즌 상품 보기/);
});

test("poizon action button uses the short macOS label", async () => {
  const poizonView = await readFile(new URL("../src/poizon-product-view.js", import.meta.url), "utf8");
  assert.match(poizonView, />포이즌<\/button>/);
  assert.doesNotMatch(poizonView, /포이즌 상품 보기/);
});

test("verified brand product row keeps only search state and retry control at the right edge", () => {
  const start = renderer.indexOf("function renderVerifiedSpuRows(");
  const end = renderer.indexOf("function mergeDomesticSearchProducts(", start);
  const verifiedRenderer = renderer.slice(start, end);

  assert.match(verifiedRenderer, /검색 실패/);
  assert.match(verifiedRenderer, /다시 검색/);
  assert.match(verifiedRenderer, /excel-raw-search-state loading">검색 중…/);
  assert.doesNotMatch(verifiedRenderer, /수달 사원이 검색 중/);
});

test("injected raw Excel renderer preserves verified SPU keys and result rows", () => {
  const start = inlineResults.indexOf("const inlineExcelRenderer = function inlineExcelProductRows(");
  const end = inlineResults.indexOf("inlineExcelRenderer.__aroundGSourcingView", start);
  const inlineRenderer = inlineResults.slice(start, end);

  assert.match(inlineRenderer, /products\.some\(\(product\) => Array\.isArray\(product\?\.verificationOptions\)\)/);
  assert.match(inlineRenderer, /return previousRenderer\(file, products\)/);
  assert.ok(
    inlineRenderer.indexOf("verificationOptions") < inlineRenderer.indexOf("const pageKeys"),
    "verified products must bypass the raw renderer before it generates different selection keys",
  );
});
