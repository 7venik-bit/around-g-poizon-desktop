import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`image-title primary patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`image-title primary patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const matcherPath = new URL("../services/matcher.mjs", import.meta.url);
let matcher = normalizeLf(await readFile(matcherPath, "utf8"));
matcher = replaceOnce(
  matcher,
  `  // Exact article number remains the primary identity. For SSG/Lotte, when\n  // both images were actually compared, use the image as a secondary veto\n  // against an obviously different colourway/model. Missing or unfetchable\n  // images never become a false product-absence verdict.`,
  `  // Product identity is image + product name first. Manufacturer article\n  // numbers are supporting evidence and an explicit conflicting article is a\n  // veto. Marketplace-internal product IDs are never treated as manufacturer\n  // identity. Missing/unfetchable images fall back to strict title+article.`,
  "matcher policy comment",
);
matcher = replaceOnce(
  matcher,
  `  const identityText = [candidate.detectedArticleNumber, candidate.id, candidate.name, candidate.title]\n    .filter(Boolean).join(" ");\n  const candidateText = normalized([\n    candidate.detectedArticleNumber,\n    candidate.id,\n    candidate.name,\n    candidate.title,\n    candidate.url,\n  ].filter(Boolean).join(" "));`,
  `  // Do not let Naver/SSG/Lotte internal product IDs or URLs impersonate a\n  // manufacturer model number. Only visible manufacturer-facing fields count.\n  const identityText = [candidate.detectedArticleNumber, candidate.name, candidate.title]\n    .filter(Boolean).join(" ");\n  const candidateText = normalized([\n    candidate.detectedArticleNumber,\n    candidate.name,\n    candidate.title,\n  ].filter(Boolean).join(" "));`,
  "ignore marketplace internal IDs",
);
matcher = replaceOnce(
  matcher,
  `  const titleScore = tokenSimilarity(\n    [source.brand, source.title, source.articleNumber].filter(Boolean).join(" "),\n    [candidate.brand, candidate.name, candidate.title, candidate.id].filter(Boolean).join(" "),\n  );`,
  `  const productTitleScore = tokenSimilarity(\n    source.title,\n    [candidate.name, candidate.title].filter(Boolean).join(" "),\n  );\n  const brandedTitleScore = tokenSimilarity(\n    [source.brand, source.title].filter(Boolean).join(" "),\n    [candidate.brand, candidate.name, candidate.title].filter(Boolean).join(" "),\n  );\n  const titleScore = Math.max(productTitleScore, brandedTitleScore);`,
  "product-name-first similarity",
);
matcher = replaceOnce(
  matcher,
  `  const confidence = Math.round(\n    codeScore * 55\n    + titleScore * 30\n    + (imageScore ?? 0) * 15,\n  );`,
  `  // Image and product name carry 90% of the confidence. Article number is\n  // deliberately only a 10% confirmation signal; it can never rescue a bad\n  // visual/title match.\n  const confidence = Math.round(\n    codeScore * 10\n    + titleScore * 45\n    + (imageScore ?? 0) * 45,\n  );`,
  "image-title primary confidence",
);
if (!matcher.includes("export function domesticProductIdentityAccepted")) {
  matcher = `${matcher.trimEnd()}\n\nexport function domesticProductIdentityAccepted(product = {}, { hasSourceImage = false } = {}) {\n  const codeMatched = Number(product?.signals?.codeScore || 0) === 1;\n  const codeConflict = product?.articleConflict === true || product?.signals?.codeConflict === true;\n  const titleScore = Number(product?.signals?.titleScore || 0);\n  const rawImageScore = product?.signals?.imageScore;\n  const imageCompared = Number.isFinite(Number(rawImageScore));\n  const imageScore = imageCompared ? Number(rawImageScore) : null;\n\n  // An explicitly different manufacturer model always wins over visual similarity.\n  if (codeConflict) return false;\n\n  // Primary rule: POIZON image + product name. Brand text is helpful but not\n  // mandatory because many portal cards omit the brand even for the correct item.\n  if (hasSourceImage && imageCompared) {\n    return titleScore >= 65 && imageScore >= 82;\n  }\n\n  // If either side's image cannot be compared, do not guess from a loose title.\n  // Fall back to an exact manufacturer article plus a very strong name match.\n  if (product?.brandVerifiedFromCard === false) return false;\n  return codeMatched && titleScore >= 80;\n}\n`;
}
await writeFile(matcherPath, matcher, "utf8");

const relayPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let relay = normalizeLf(await readFile(relayPath, "utf8"));
relay = replaceOnce(
  relay,
  `        let detailArticleVerificationRequired = false;\n        let allowProvisionalArticleConflict = false;`,
  `        let detailArticleVerificationRequired = false;\n        let allowProvisionalArticleConflict = false;\n        let visualIdentityPending = false;`,
  "visual identity flag",
);
relay = replaceOnce(
  relay,
  `        // Musinsa search cards commonly omit the manufacturer's article number`,
  `        // Naver/SSG/Lotte often hide the manufacturer article number on the\n        // result card. Preserve a strong product-name candidate so the main\n        // process can compare its actual image with the POIZON image. This is\n        // not acceptance yet: the final image+title gate runs after capture.\n        const visualPriorityPortal = /^(?:네이버\\s|SSG(?:\\s|$)|롯데온(?:\\s|$))/.test(String(store || ""));\n        if (!conflictingArticle && !articleMatched && visualPriorityPortal\n          && titleIdentityMatch(rawCardText, expectedTitle)\n          && isPlatformShoppingProductUrl(productUrl)) {\n          articleMatched = true;\n          visualIdentityPending = true;\n        }\n        // Musinsa search cards commonly omit the manufacturer's article number`,
  "preserve visual portal candidates",
);
relay = replaceOnce(
  relay,
  `        if (requiresBrandMatch) {\n          if (!brandMatched) continue;\n        }`,
  `        if (requiresBrandMatch) {\n          // Image+name candidates may legitimately omit the brand label on the\n          // shopping card. Final visual verification happens in main.mjs.\n          if (!brandMatched && !visualIdentityPending) continue;\n        }`,
  "allow brandless visual candidates",
);
relay = replaceOnce(
  relay,
  `            brandVerifiedFromCard: brandMatched,\n            detailArticleVerificationRequired,`,
  `            brandVerifiedFromCard: brandMatched,\n            visualIdentityPending,\n            detailArticleVerificationRequired,`,
  "retain visual candidate marker",
);
await writeFile(relayPath, relay, "utf8");

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
main = replaceOnce(
  main,
  `import { scoreProductCandidate } from "./services/matcher.mjs";`,
  `import { domesticProductIdentityAccepted, scoreProductCandidate } from "./services/matcher.mjs";`,
  "import image-title decision",
);
main = replaceOnce(
  main,
  `    const bestByStore = new Map();\n    products.forEach((product, index) => {\n      const previous = bestByStore.get(product.store);\n      if (!previous || product.confidence > previous.confidence) bestByStore.set(product.store, { index, confidence: product.confidence });\n    });\n    await Promise.all([...bestByStore.values()].map(async ({ index }) => {`,
  `    // Accuracy is more important than speed: compare every captured candidate\n    // image, not only the pre-ranked first candidate from each store.\n    await Promise.all(products.map(async (_product, index) => {`,
  "compare every candidate image",
);
main = replaceOnce(
  main,
  `  products = products.filter((product) => {\n    const codeMatched = Number(product.signals?.codeScore || 0) === 1;\n    const codeConflict = product.articleConflict === true || product.signals?.codeConflict === true;\n    const titleScore = Number(product.signals?.titleScore || 0);\n    const imageScore = product.signals?.imageScore;\n    if (codeConflict) return false;\n    if (product.brandVerifiedFromCard === false) return false;\n    if (codeMatched) return true;\n    if (product.store === "브랜드 공식몰") return false;\n    if (!hasSourceImage) return titleScore >= 80;\n    return titleScore >= 70 && Number(imageScore || 0) >= 95;\n  });`,
  `  products = products.filter((product) => domesticProductIdentityAccepted(product, { hasSourceImage }));`,
  "use image-title acceptance gate",
);
main = replaceOnce(
  main,
  `      const exactMatch = matched.products.some((product) =>\n        Number(product.signals?.codeScore || 0) === 1\n        && product.articleConflict !== true\n        && product.signals?.codeConflict !== true\n      );`,
  `      // The accepted list has already passed the accuracy-first identity gate.\n      // Treat a verified image+title match as exact for search-strategy learning.\n      const exactMatch = matched.products.length > 0;`,
  "visual match counts as exact outcome",
);
await writeFile(mainPath, main, "utf8");

console.log("domestic product identity now prioritizes image + product name; marketplace IDs are ignored and every candidate image is compared");
