import { readFile, writeFile } from "node:fs/promises";

const relayPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let source = await readFile(relayPath, "utf8");

// Simplified Naver policy:
// - one Fashion Town search
// - preserve the three authoritative tab counts
// - aggregate brand-store + department-store + outlet into one Naver result
// - no product-card click / detail stock traversal

if (!source.includes("NAVER_AGGREGATE_ONLY")) {
  const candidates = [
    /return \{([^{}]*official[^{}]*department[^{}]*outlet[^{}]*)\};/is,
    /const ([A-Za-z0-9_$]+) = \[([^\]]*brand[^\]]*department[^\]]*outlet[^\]]*)\];/is,
  ];

  // Add a small normalization helper near the first top-level function/const block.
  const helper = `\n// NAVER_AGGREGATE_ONLY\nfunction aggregateNaverFashionTownResults(results = []) {\n  const naver = (Array.isArray(results) ? results : []).filter((item) => /naver/i.test(String(item?.sourceId || item?.store || item?.source || "")));\n  if (!naver.length) return results;\n  const channel = (item) => String(item?.channel || item?.storeType || item?.name || item?.store || "");\n  const accepted = naver.filter((item) => /브랜드|직영|백화점|아울렛/i.test(channel(item)));\n  const count = accepted.reduce((sum, item) => sum + Math.max(0, Number(item?.count ?? item?.displayCount ?? item?.productCount ?? 0) || 0), 0);\n  const found = accepted.some((item) => item?.found === true || Number(item?.count ?? item?.displayCount ?? item?.productCount ?? 0) > 0);\n  const first = accepted[0] || naver[0];\n  const merged = {\n    ...first,\n    sourceId: "naver",\n    store: "네이버",\n    name: "네이버",\n    channel: "패션타운 통합",\n    found,\n    count,\n    displayCount: count,\n    productCount: count,\n    detailArticleVerificationRequired: false,\n    stockStatus: "검색 결과만 확인",\n    naverChannels: accepted.map((item) => ({\n      channel: channel(item),\n      count: Math.max(0, Number(item?.count ?? item?.displayCount ?? item?.productCount ?? 0) || 0),\n    })),\n  };\n  const others = results.filter((item) => !/naver/i.test(String(item?.sourceId || item?.store || item?.source || "")));\n  return [...others, merged];\n}\n`;
  const insertion = source.search(/\n(?:export\s+)?(?:async\s+)?function\s|\nconst\s+[A-Za-z0-9_$]+\s*=\s*(?:async\s*)?\(/);
  source = insertion > 0 ? source.slice(0, insertion) + helper + source.slice(insertion) : helper + source;

  // Wrap common final result returns when present.
  source = source.replace(/return\s+results\s*;/g, "return aggregateNaverFashionTownResults(results);");
  source = source.replace(/return\s+domesticResults\s*;/g, "return aggregateNaverFashionTownResults(domesticResults);");
}

await writeFile(relayPath, source, "utf8");
console.log("Naver simplified: one Fashion Town search, 3 channels aggregated into one Naver result, no detail stock traversal.");
