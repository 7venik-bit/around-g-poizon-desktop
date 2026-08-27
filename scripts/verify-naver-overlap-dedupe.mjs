import { readFile } from "node:fs/promises";

const relay = String(await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`Naver overlap dedupe verification failed: ${message}`); };

if (!relay.includes('import { dedupeNaverOverlappingProducts } from "../services/naver-result-dedupe.mjs";')) {
  fail("dedupe helper import is missing");
}
if (!relay.includes("products: dedupeNaverOverlappingProducts(results.flatMap((result) => result.products)),")) {
  fail("final domestic result list is not deduplicated");
}
if (relay.includes("products: results.flatMap((result) => result.products),")) {
  fail("legacy unfiltered final product aggregation remains");
}

console.log("Naver overlap dedupe verification passed");
