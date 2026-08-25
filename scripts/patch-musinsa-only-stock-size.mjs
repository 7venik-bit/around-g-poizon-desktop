import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`musinsa-only patch target missing: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`musinsa-only patch target duplicated: ${label}`);
  return source.slice(0, index) + after + source.slice(index + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
main = replaceOnce(
  main,
  "        let detailText = \"\";\n        let stockEvidence = normalizeRenderedStockEvidence();",
  "        let detailText = \"\";\n        let stockEvidence = {};\n        const verifyMusinsaInventory = String(source.store || \"\") === \"무신사\";",
  "inventory gate",
);
main = replaceOnce(
  main,
  "          await openRenderedSizeOptions(searchWindow);",
  "          if (verifyMusinsaInventory) await openRenderedSizeOptions(searchWindow);",
  "size options only for Musinsa",
);
const stockBlock = /          const rawStock = await searchWindow\.webContents\.executeJavaScript\(`\(\(\) => \{[\s\S]*?          if \(rawStock\) stockEvidence = normalizeRenderedStockEvidence\(rawStock\);\n/;
const match = main.match(stockBlock);
if (!match) throw new Error("musinsa-only patch target missing: stock extraction block");
if (!match[0].includes("verifyMusinsaInventory")) {
  const indented = match[0].split("\n").map((line) => line ? `  ${line}` : line).join("\n");
  main = main.replace(stockBlock, `          if (verifyMusinsaInventory) {\n${indented}          }\n`);
}
await writeFile(mainPath, main, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));
renderer = replaceOnce(
  renderer,
  "  if (!products.length) return { label: \"없음 확인\", className: \"missing\" };\n  if (!products.some((product) => product.inStock)) return { label: \"재고 없음\", className: \"soldout\" };\n  return { label: \"구매 가능\", className: \"available\" };",
  "  if (!products.length) return { label: \"없음 확인\", className: \"missing\" };\n  const musinsaProducts = products.filter((product) => String(product?.sourceStore || product?.store || \"\") === \"무신사\");\n  if (musinsaProducts.length && musinsaProducts.every((product) => product.inStock === false)) {\n    return { label: \"상품 확인 · 무신사 품절\", className: \"soldout\" };\n  }\n  return { label: \"상품 확인\", className: \"available\" };",
  "overall domestic status",
);
renderer = replaceOnce(
  renderer,
  "  const sourceStatus = (source, matchedProducts) => {\n    const available = matchedProducts.filter((product) => product.inStock === true).length;\n    if (available) return { label: `재고 ${available}개`, className: \"available\" };\n    if (matchedProducts.length && matchedProducts.every((product) => product.inStock === false)) {\n      return { label: \"재고 없음\", className: \"soldout\" };\n    }\n    if (matchedProducts.length) return { label: \"재고·사이즈 확인 필요\", className: \"pending\" };",
  "  const sourceStatus = (source, matchedProducts) => {\n    const musinsaSource = String(source.store || \"\") === \"무신사\";\n    if (!musinsaSource && matchedProducts.length) return { label: \"상품 확인됨\", className: \"available\" };\n    const available = matchedProducts.filter((product) => product.inStock === true).length;\n    if (available) return { label: `재고 ${available}개`, className: \"available\" };\n    if (musinsaSource && matchedProducts.length && matchedProducts.every((product) => product.inStock === false)) {\n      return { label: \"재고 없음\", className: \"soldout\" };\n    }\n    if (musinsaSource && matchedProducts.length) return { label: \"재고·사이즈 확인 필요\", className: \"pending\" };",
  "source status only uses inventory for Musinsa",
);
renderer = renderer.replaceAll("국내 재고만 보기", "무신사 재고만 보기");
renderer = renderer.replaceAll("전체 상품 보기 · 국내 재고", "전체 상품 보기 · 무신사 재고");
await writeFile(rendererPath, renderer, "utf8");

console.log("stock and size verification limited to Musinsa");
