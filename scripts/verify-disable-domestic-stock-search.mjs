import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));

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

console.log("domestic stock-search disable verification passed");
