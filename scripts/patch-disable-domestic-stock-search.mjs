import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`stock-search patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`stock-search patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));

// Domestic sourcing only needs product identity and price. Do not open size
// selectors or derive inventory availability from detail pages; those clicks
// are fragile and were causing repeated failures across retailers.
main = replaceOnce(
  main,
  "          await openRenderedSizeOptions(searchWindow);",
  "          // 재고/사이즈 옵션 자동 확인은 사용하지 않습니다.",
  "disable rendered size-option interaction",
);

main = replaceOnce(
  main,
  "          if (rawStock) stockEvidence = normalizeRenderedStockEvidence(rawStock);",
  "          if (rawStock?.pageText) detailText = String(rawStock.pageText || detailText || \"\");\n          stockEvidence = { inStock: null, sizes: [], stockStatus: \"not_searched\", stockVerified: false };",
  "ignore domestic stock evidence",
);

await writeFile(mainPath, main, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));

renderer = replaceOnce(
  renderer,
  "    const sizes = product?.sizes || [];",
  "    const sizes = [];",
  "hide retailer stock-size chips",
);
renderer = replaceOnce(
  renderer,
  "    const sourceState = product.inStock === true ? \"available\" : product.inStock === false ? \"soldout\" : \"pending\";",
  "    const sourceState = \"pending\";",
  "neutralize retailer stock state",
);
renderer = replaceOnce(
  renderer,
  "    const sourceLabel = product.stockStatus === \"login_required\" ? \"로그인 필요\" : product.inStock === true ? \"재고 있음\" : product.inStock === false ? \"품절\" : \"확인 필요\";",
  "    const sourceLabel = \"재고 검색 안 함\";",
  "show stock search disabled label",
);

await writeFile(rendererPath, renderer, "utf8");
console.log("domestic stock-search disable patch applied");
