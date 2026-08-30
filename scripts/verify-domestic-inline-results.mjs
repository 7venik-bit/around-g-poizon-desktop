import { readFile } from "node:fs/promises";

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
const sourcing = String(await readFile(sourcingPath, "utf8"));

const required = [
  "data-domestic-inline-list-style",
  "국내 상품 검색 결과",
  "sourcing-domestic-cell",
  "domestic-inline-results",
  "domestic-inline-row",
  "renderExcelProductRows = inlineExcelRenderer",
  "renderDomestic = inlineRenderDomestic",
  "#excel-preview-grid .excel-product-search-detail{display:none!important}",
];

for (const token of required) {
  if (!sourcing.includes(token)) {
    throw new Error(`domestic inline-list verification failed: missing ${token}`);
  }
}

if (!sourcing.includes("<td class=\"sourcing-domestic-cell\"><div class=\"sourcing-domestic-cell-wrap\">")) {
  throw new Error("domestic results are not rendered inside the rightmost product cell");
}

console.log("domestic inline-list renderer verified");
