import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));

const fail = (message) => { throw new Error(`domestic stock-search verification failed: ${message}`); };

if (main.includes("await openRenderedSizeOptions(searchWindow);")) {
  fail("rendered size-option interaction is still enabled");
}
if (!main.includes('stockStatus: "not_searched"')) {
  fail("stock results are not forced to not_searched");
}
if (!main.includes("sizes: []")) {
  fail("domestic stock-size results are not cleared");
}
if (!renderer.includes('const sourceLabel = "재고 검색 안 함";')) {
  fail("UI does not explain that stock search is disabled");
}
if (!renderer.includes("const sizes = [];")) {
  fail("retailer stock-size chips are still rendered");
}
if (!sourcing.includes("function highestQualifiedSizeRows(products = [])")) {
  fail("highest qualified size-price selector is missing");
}
if (!sourcing.includes("products = highestQualifiedSizeRows(products);")) {
  fail("sourcing rows are not filtered to one highest qualified size price");
}
if (!sourcing.includes("const minimumSales = 30;")) {
  fail("size sales minimum is not fixed at 30");
}
if (!sourcing.includes("<th>사이즈 최고가</th>")) {
  fail("highest size-price column label is missing");
}
if (!sourcing.includes("<th>국내 상품</th>")) {
  fail("stock column was not replaced by domestic product search");
}
if (sourcing.includes("국내 상품 재고 검색")) {
  fail("stock-search wording remains in sourcing view");
}

console.log("domestic stock-search disable and highest-size-price sourcing verification passed");
