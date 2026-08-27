import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`official/naver link-only patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`official/naver link-only patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
main = replaceOnce(
  main,
  `        const detailArticleVerified = product.detailArticleVerificationRequired\n          ? exactArticleIdentityMatch(detailText, articleNumber) : false;\n        if (product.detailArticleVerificationRequired && !detailArticleVerified) continue;`,
  `        const linkOnlySource = String(product?.store || "") === "브랜드 공식몰"\n          || /^네이버\\s/.test(String(product?.store || ""));\n        const detailArticleVerified = product.detailArticleVerificationRequired\n          ? exactArticleIdentityMatch(detailText, articleNumber) : false;\n        if (product.detailArticleVerificationRequired && !detailArticleVerified && !linkOnlySource) continue;\n        if (product.detailArticleVerificationRequired && !detailArticleVerified && linkOnlySource) {\n          return {\n            ...product,\n            linkOnly: true,\n            linkVerified: /^https?:\\/\\//i.test(String(product?.url || "")),\n            inStock: null,\n            sizes: [],\n            stockStatus: "manual_check",\n            stockVerified: false,\n          };\n        }`,
  "retain official and Naver product URL when detail code is not repeated",
);
await writeFile(mainPath, main, "utf8");

const sourcingPath = new URL("../src/sourcing-view.js", import.meta.url);
let sourcing = normalizeLf(await readFile(sourcingPath, "utf8"));
sourcing = replaceOnce(
  sourcing,
  `        const productRows = products.map((product) => {\n          const source = sourceForProduct(product);\n          const candidateName = product?.title || product?.name || product?.articleNumber || "국내 상품";`,
  `        const productRows = products.map((product) => {\n          const source = sourceForProduct(product);\n          const sourceStore = String(source?.store || product?.store || "");\n          const simpleLinkResult = product?.linkOnly === true\n            || sourceStore === "브랜드 공식몰"\n            || /^네이버\\s/.test(sourceStore);\n          if (simpleLinkResult && /^https?:\\/\\//i.test(String(product?.url || ""))) {\n            return \`<div class="sourcing-source-fallback"><strong>\${text(sourceStore || "공식 판매처")}</strong><span>상품 있음</span>\${sourceAction(source, product, "상품 링크")}</div>\`;\n          }\n          const candidateName = product?.title || product?.name || product?.articleNumber || "국내 상품";`,
  "render official and Naver matches as product present plus link",
);
await writeFile(sourcingPath, sourcing, "utf8");

console.log("official mall and Naver exact search results now retain the real product URL and render only 상품 있음 + 상품 링크");
