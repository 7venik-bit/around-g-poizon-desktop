import { readFile, writeFile } from "node:fs/promises";

const targetPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let source = await readFile(targetPath, "utf8");

const listBlock = `const PARALLEL_IMPORT_SELLERS = [\n  "인퓨전프로젝트", "브릭맨션", "하하몰", "다옴스포츠", "한아아이앤티",\n  "스포츠커넥션", "풋팝", "럭스보이", "DLC", "대림코퍼레이션",\n  "구템즈", "디몬트", "까르피",\n];\n\nconst normalizeSellerIdentity = (value) => String(value || "")\n  .toLowerCase()\n  .replace(/\\s+/g, "")\n  .replace(/[()\\[\\]{}._\\-/]/g, "");\n\nfunction classifyMarketplaceSeller(evidence = "") {\n  const normalized = normalizeSellerIdentity(evidence);\n  const parallel = PARALLEL_IMPORT_SELLERS.find((name) => normalized.includes(normalizeSellerIdentity(name)));\n  if (parallel) return { distributionType: "병행수입", parallelImportSeller: parallel };\n  if (/(본사직영|브랜드직영|공식스토어|공식몰|공식브랜드|백화점|신세계백화점|롯데백화점)/i.test(String(evidence || ""))) {\n    return { distributionType: "공식유통", parallelImportSeller: "" };\n  }\n  return { distributionType: "기타", parallelImportSeller: "" };\n}\n`;

if (!source.includes('const PARALLEL_IMPORT_SELLERS = [')) {
  const anchor = source.indexOf("\nfunction ");
  if (anchor < 0) throw new Error("Could not find function anchor in domestic-search.mjs");
  source = source.slice(0, anchor) + "\n" + listBlock + source.slice(anchor);
}

const exactReturn = `          lotteSearchChecked: /^롯데온(?:\\s|$)/.test(String(store || "")),\n        };`;
const exactReturnPatched = `          lotteSearchChecked: /^롯데온(?:\\s|$)/.test(String(store || "")),\n          distributionSummary: [...matchingProducts.values()].reduce((summary, product) => {\n            const evidence = [product?.sellerName, product?.seller, product?.mallName, product?.storeName, product?.name, product?.title].filter(Boolean).join(" ");\n            const classified = classifyMarketplaceSeller(evidence);\n            summary[classified.distributionType] = (summary[classified.distributionType] || 0) + 1;\n            return summary;\n          }, { 공식유통: 0, 병행수입: 0, 기타: 0 }),\n          products: [...matchingProducts.values()].map((product) => {\n            const evidence = [product?.sellerName, product?.seller, product?.mallName, product?.storeName, product?.name, product?.title].filter(Boolean).join(" ");\n            return { ...product, ...classifyMarketplaceSeller(evidence) };\n          }),\n        };`;

if (source.includes(exactReturn) && !source.includes('distributionSummary: [...matchingProducts.values()]')) {
  source = source.replace(exactReturn, exactReturnPatched);
}

await writeFile(targetPath, source, "utf8");
console.log("Parallel-import seller classification enabled for SSG/Lotte marketplace results.");
