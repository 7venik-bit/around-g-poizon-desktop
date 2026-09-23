import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mergeSellerProductsByRank, parseSellerDomNodes } from "../services/seller-dom.mjs";

// Exercise the actual IPC response projection, after row parsing and rank
// merging have normalized the article label to uppercase.
const main = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const capture = main.slice(main.indexOf("async function captureSellerCenterProducts()"), main.indexOf("async function captureSellerBrandSales("));
const response = capture.slice(capture.lastIndexOf("\n  return {"), capture.lastIndexOf("}"));
const projectResponse = new Function("products", "imageMap", "finalCompleteness", "currentUrl", "conditionResults", response);

test("popular IPC keeps the verified row photo after descriptive article labels are uppercased", () => {
  const observed = ["Pink Lipstick Tube", "VN0009QC6BT1( White Lining )", "416175"].map((article, index) => ({
    text: `${index + 1}.\n${article}\nProduct name\n44,327\n42,893\n58,177`,
    imageUrl: `https://images.example/${index + 1}.jpg`,
    tableFields: { rank: `${index + 1}.`, product: [article, "Product name"],
      averagePrice: ["44,327"], lowestPrice: ["42,893"], highestPrice: ["58,177"] },
  }));
  const products = mergeSellerProductsByRank([parseSellerDomNodes(observed)]);
  assert.equal(products[0].articleNumber, "PINK LIPSTICK TUBE");
  const result = projectResponse(products, {}, { complete: true, missingRanks: [] }, "https://seller.poizon.com/", []);
  assert.deepEqual(result.products.map(p => p.logoUrl), observed.map(p => p.imageUrl));
  assert.deepEqual(result.products.map(p => p.averagePrice), [44327, 44327, 44327]);
});

test("popular IPC prefers the matching row photo and retains the existing fallback for rows without one", () => {
  const result = projectResponse([
    { rank: 1, articleNumber: "SKU-1", logoUrl: "https://images.example/verified.jpg" },
    { rank: 2, articleNumber: "SKU-2", logoUrl: "" },
    { rank: 3, articleNumber: "SKU-3" },
  ], { "SKU-1": "https://images.example/other.jpg", "SKU-2": "https://images.example/fallback.jpg" },
  { complete: true, missingRanks: [] }, "https://seller.poizon.com/", []);
  assert.deepEqual(result.products.map(p => p.logoUrl), ["https://images.example/verified.jpg", "https://images.example/fallback.jpg", ""]);
});
