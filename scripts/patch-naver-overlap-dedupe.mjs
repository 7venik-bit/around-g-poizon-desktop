import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`naver dedupe patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`naver dedupe patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const relayPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let relay = normalizeLf(await readFile(relayPath, "utf8"));

relay = replaceOnce(
  relay,
  'import { brandSearchQueries } from "../services/brand-search-profile.mjs";',
  'import { brandSearchQueries } from "../services/brand-search-profile.mjs";\nimport { dedupeNaverOverlappingProducts } from "../services/naver-result-dedupe.mjs";',
  "import Naver overlap dedupe",
);

relay = replaceOnce(
  relay,
  "    products: results.flatMap((result) => result.products),",
  "    products: dedupeNaverOverlappingProducts(results.flatMap((result) => result.products)),",
  "dedupe final Naver product list",
);

await writeFile(relayPath, relay, "utf8");
console.log("Naver overlapping domestic product results are deduplicated before returning the final list");
