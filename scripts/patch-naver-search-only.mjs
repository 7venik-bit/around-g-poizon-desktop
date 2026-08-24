import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let source = await readFile(mainPath, "utf8");

// Naver is discovery-only: never click/open a Naver product card for detail stock verification.
// Musinsa stock/detail flow remains untouched.
source = source.replace(
  /if \(product\.detailArticleVerificationRequired\) \{/g,
  'if (product.detailArticleVerificationRequired && !String(product.store || "").startsWith("네이버")) {'
);
source = source.replace(
  /if \(candidate\.detailArticleVerificationRequired\) \{/g,
  'if (candidate.detailArticleVerificationRequired && !String(candidate.store || "").startsWith("네이버")) {'
);

// If a generic product-card click helper is reached with a Naver result URL, stop at discovery.
const clickMarker = 'async function clickRenderedProductCard(searchWindow, productUrl, searchResultsUrl = "") {';
if (source.includes(clickMarker) && !source.includes('NAVER_SEARCH_ONLY_GUARD')) {
  source = source.replace(clickMarker, `${clickMarker}\n  // NAVER_SEARCH_ONLY_GUARD: search/result detection only; no product-card click or stock detail traversal.\n  if (/naver\\.com/i.test(String(searchResultsUrl || productUrl || ""))) return true;`);
}

await writeFile(mainPath, source, "utf8");
console.log("Naver limited to product discovery; Musinsa stock flow preserved.");
