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

// 재고/사이즈 자동 확인은 무신사에서만 유지한다. 다른 국내 판매처는
// 정확 상품/가격 확인에만 집중하고 재고 상태 때문에 실패하지 않는다.
main = replaceOnce(
  main,
  "          await openRenderedSizeOptions(searchWindow);",
  "          const verifyMusinsaInventory = String(source.store || \"\") === \"무신사\";\n          if (verifyMusinsaInventory) await openRenderedSizeOptions(searchWindow);",
  "gate rendered size-option interaction to Musinsa",
);

const stockPattern = /          const rawStock = await searchWindow\.webContents\.executeJavaScript\(`\(\(\) => \{[\s\S]*?          if \(rawStock\) stockEvidence = normalizeRenderedStockEvidence\(rawStock\);\n/;
const stockMatch = main.match(stockPattern);
if (!stockMatch) throw new Error("stock-search patch target missing: stock extraction block");
const indentedStock = stockMatch[0].split("\n").map((line) => line ? `  ${line}` : line).join("\n");
main = main.replace(
  stockPattern,
  `          if (verifyMusinsaInventory) {\n${indentedStock}          } else {\n            stockEvidence = { inStock: null, sizes: [], stockStatus: "not_searched", stockVerified: false };\n          }\n`,
);

await writeFile(mainPath, main, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));

renderer = replaceOnce(
  renderer,
  "    const sizes = product?.sizes || [];",
  "    const musinsaInventory = String(product?.sourceStore || product?.store || \"\") === \"무신사\";\n    const sizes = musinsaInventory ? (product?.sizes || []) : [];",
  "show retailer size chips only for Musinsa",
);
renderer = replaceOnce(
  renderer,
  "    const sourceState = product.inStock === true ? \"available\" : product.inStock === false ? \"soldout\" : \"pending\";",
  "    const sourceState = musinsaInventory\n      ? (product.inStock === true ? \"available\" : product.inStock === false ? \"soldout\" : \"pending\")\n      : \"pending\";",
  "neutralize non-Musinsa stock state",
);
renderer = replaceOnce(
  renderer,
  "    const sourceLabel = product.stockStatus === \"login_required\" ? \"로그인 필요\" : product.inStock === true ? \"재고 있음\" : product.inStock === false ? \"품절\" : \"확인 필요\";",
  "    const sourceLabel = musinsaInventory\n      ? (product.stockStatus === \"login_required\" ? \"로그인 필요\" : product.inStock === true ? \"재고 있음\" : product.inStock === false ? \"품절\" : \"확인 필요\")\n      : \"재고 확인 안 함\";",
  "show non-Musinsa inventory as not checked",
);
renderer = replaceOnce(
  renderer,
  "  if (!products.length) return { label: \"없음 확인\", className: \"missing\" };\n  if (!products.some((product) => product.inStock)) return { label: \"재고 없음\", className: \"soldout\" };\n  return { label: \"구매 가능\", className: \"available\" };",
  "  if (!products.length) return { label: \"없음 확인\", className: \"missing\" };\n  const musinsaProducts = products.filter((product) => String(product?.sourceStore || product?.store || \"\") === \"무신사\");\n  if (musinsaProducts.length && musinsaProducts.every((product) => product.inStock === false)) {\n    return { label: \"상품 확인 · 무신사 품절\", className: \"soldout\" };\n  }\n  return { label: \"상품 확인\", className: \"available\" };",
  "overall result should not require non-Musinsa stock",
);
renderer = replaceOnce(
  renderer,
  "  const sourceStatus = (source, matchedProducts) => {\n    const available = matchedProducts.filter((product) => product.inStock === true).length;\n    if (available) return { label: `재고 ${available}개`, className: \"available\" };\n    if (matchedProducts.length && matchedProducts.every((product) => product.inStock === false)) {\n      return { label: \"재고 없음\", className: \"soldout\" };\n    }\n    if (matchedProducts.length) return { label: \"재고·사이즈 확인 필요\", className: \"pending\" };",
  "  const sourceStatus = (source, matchedProducts) => {\n    const musinsaSource = String(source.store || \"\") === \"무신사\";\n    if (!musinsaSource && matchedProducts.length) return { label: \"상품 확인됨\", className: \"available\" };\n    const available = matchedProducts.filter((product) => product.inStock === true).length;\n    if (available) return { label: `재고 ${available}개`, className: \"available\" };\n    if (musinsaSource && matchedProducts.length && matchedProducts.every((product) => product.inStock === false)) {\n      return { label: \"재고 없음\", className: \"soldout\" };\n    }\n    if (musinsaSource && matchedProducts.length) return { label: \"재고·사이즈 확인 필요\", className: \"pending\" };",
  "source result should use stock only for Musinsa",
);
renderer = renderer.replaceAll("국내 재고만 보기", "무신사 재고만 보기");
renderer = renderer.replaceAll("전체 상품 보기 · 국내 재고", "전체 상품 보기 · 무신사 재고");

await writeFile(rendererPath, renderer, "utf8");

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
let sourcing = normalizeLf(await readFile(sourcingPath, "utf8"));

const displayStart = sourcing.indexOf("  function displaySizeSales(product) {");
const stockStart = sourcing.indexOf("  function stockPresentation(result, outcome) {", displayStart);
if (displayStart < 0 || stockStart < 0) throw new Error("stock-search patch target missing: sourcing display helpers");
const displayReplacement = `  function sourcingSizeSalesValue(product) {\n    const chinaRaw = String(product?.sales30dRaw || \"\").trim();\n    const localRaw = String(product?.localSales30dRaw || \"\").trim();\n    const raw = chinaRaw || localRaw;\n    if (/^<\\s*5$/i.test(raw)) return 4;\n    const rawNumber = Number(raw.replace(/[^0-9]/g, \"\"));\n    if (raw && Number.isFinite(rawNumber)) return rawNumber;\n    const chinaValue = Number(product?.sales30d);\n    const localValue = Number(product?.localSales30d);\n    return Number.isFinite(chinaValue) ? chinaValue : Number.isFinite(localValue) ? localValue : 0;\n  }\n\n  function displaySizeSales(product) {\n    const value = sourcingSizeSalesValue(product);\n    return value > 0 ? \`판매량 \${Math.round(value).toLocaleString(\"ko-KR\")}\` : \"판매량 -\";\n  }\n\n  function sourcingProductIdentity(product) {\n    return String(product?.articleNumber || product?.spuId || product?.key || \"\").trim().toUpperCase();\n  }\n\n  function highestQualifiedSizeReference(products = []) {\n    const minimumSales = 30;\n    const best = new Map();\n    for (const product of Array.isArray(products) ? products : []) {\n      const sales = sourcingSizeSalesValue(product);\n      const price = Number(product?.averagePrice || 0);\n      if (sales < minimumSales || price <= 0) continue;\n      const identity = sourcingProductIdentity(product);\n      if (!identity) continue;\n      const current = best.get(identity);\n      if (!current || price > Number(current?.averagePrice || 0)) best.set(identity, product);\n    }\n    return best;\n  }\n\n`;
sourcing = sourcing.slice(0, displayStart) + displayReplacement + sourcing.slice(stockStart);

const stockFunctionStart = sourcing.indexOf("  function stockPresentation(result, outcome) {");
const stockFunctionEnd = sourcing.indexOf("\n\n  function installProductRenderer()", stockFunctionStart);
if (stockFunctionStart < 0 || stockFunctionEnd < 0) throw new Error("stock-search patch target missing: stock presentation");
const productPresentation = `  function stockPresentation(result, outcome) {\n    if (result?.loading) return { label: \"검색 중…\", className: \"loading\" };\n    if (result?.error) return { label: \"검색 실패\", className: \"error\" };\n    if (!result) return { label: \"상품 검색\", className: \"pending\" };\n    const count = Array.isArray(result?.products) ? result.products.length : 0;\n    if (count > 0) return { label: \`상품 \${count.toLocaleString(\"ko-KR\")}개\`, className: \"available\" };\n    if (String(outcome?.className || \"\").toLowerCase() === \"missing\") return { label: \"국내 없음\", className: \"missing\" };\n    return { label: \"확인 완료\", className: \"pending\" };\n  }`;
sourcing = sourcing.slice(0, stockFunctionStart) + productPresentation + sourcing.slice(stockFunctionEnd);

sourcing = replaceOnce(
  sourcing,
  "      const sourcingRenderer = function sourcingRenderExcelProductRows(file, products = []) {\n        try {\n          const pageKeys = products.map((product) => `${brandImportPathKey(file.path)}::${product.key || product.articleNumber || product.spuId}`);",
  "      const sourcingRenderer = function sourcingRenderExcelProductRows(file, products = []) {\n        try {\n          const highestSizeByIdentity = highestQualifiedSizeReference(products);\n          const pageKeys = products.map((product) => `${brandImportPathKey(file.path)}::${product.key || product.articleNumber || product.spuId}`);",
  "prepare size-price references without filtering rows",
);
sourcing = replaceOnce(
  sourcing,
  "            const key = pageKeys[index];\n            const result = excelPreviewSearchResults.get(key);\n            const poizonPrice = verifiedExcelProductPoizonPrice(product);",
  "            const key = pageKeys[index];\n            const result = excelPreviewSearchResults.get(key);\n            const referenceProduct = highestSizeByIdentity.get(sourcingProductIdentity(product)) || product;\n            const poizonPrice = verifiedExcelProductPoizonPrice(referenceProduct);",
  "use highest size price as display reference",
);
sourcing = replaceOnce(
  sourcing,
  "              <td class=\"sourcing-size\">${text(product.option || \"-\")}</td>\n              <td><span class=\"sourcing-size-sales\">${text(displaySizeSales(product))}</span></td>",
  "              <td class=\"sourcing-size\">${text(referenceProduct.option || product.option || \"-\")}</td>\n              <td><span class=\"sourcing-size-sales\">${text(displaySizeSales(referenceProduct))}</span></td>",
  "show referenced size and sales",
);
sourcing = replaceOnce(
  sourcing,
  "<th>평균가격</th><th>중국 총판매</th><th>현지 총판매</th><th>재고</th>",
  "<th>사이즈 최고가</th><th>중국 총판매</th><th>현지 총판매</th><th>국내 상품</th>",
  "rename sourcing price and product columns",
);
sourcing = replaceOnce(
  sourcing,
  "            const searchTitle = result ? `국내 검색 결과 ${resultCount.toLocaleString(\"ko-KR\")}개` : \"국내 상품 재고 검색\";",
  "            const searchTitle = result ? `국내 정확 상품 검색 결과 ${resultCount.toLocaleString(\"ko-KR\")}개` : \"국내 정확 상품 검색\";",
  "remove stock wording from search title",
);

await writeFile(sourcingPath, sourcing, "utf8");
console.log("domestic stock-size verification kept only for Musinsa; other retailers use exact product search only");
