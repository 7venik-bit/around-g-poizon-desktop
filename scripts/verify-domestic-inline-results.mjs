import { readFile } from "node:fs/promises";

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
const sourcing = String(await readFile(sourcingPath, "utf8"));

const required = [
  "data-domestic-inline-list-style",
  "국내 검색 결과",
  "domestic-inline-detail-label",
  "domestic-inline-results",
  "domestic-inline-row",
  "renderExcelProductRows = inlineExcelRenderer",
  "renderDomestic = inlineRenderDomestic",
  ".excel-product-search-detail{display:table-row!important}",
];

for (const token of required) {
  if (!sourcing.includes(token)) {
    throw new Error(`domestic inline-list verification failed: missing ${token}`);
  }
}

if (!sourcing.includes("<td colspan=\"10\"><div class=\"domestic-inline-detail-label\">")) {
  throw new Error("domestic results are not rendered below the source product row");
}

console.log("domestic inline-list renderer verified");
