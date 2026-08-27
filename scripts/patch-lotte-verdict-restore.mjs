import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`LOTTE patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`LOTTE patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
const imageTitlePrimary = main.includes("domesticProductIdentityAccepted");
if (!imageTitlePrimary) {
  main = replaceOnce(
    main,
    'import { scoreProductCandidate } from "./services/matcher.mjs";',
    'import { imageEvidenceAllowsExactProduct, scoreProductCandidate } from "./services/matcher.mjs";',
    "import exact-product image gate",
  );
}
main = replaceOnce(
  main,
  '  const ssgChannelSource = /^SSG(?:\\s|$)/.test(String(source.store || ""));',
  '  const ssgChannelSource = /^SSG(?:\\s|$)/.test(String(source.store || ""));\n  const lotteChannelSource = /^롯데온(?:\\s|$)/.test(String(source.store || ""));',
  "declare Lotte rendered channel",
);
main = replaceOnce(
  main,
  "        show: naverPortalSource || ssgChannelSource,",
  "        show: naverPortalSource || ssgChannelSource || lotteChannelSource,",
  "show Lotte result window",
);
main = replaceOnce(
  main,
  "      if (naverPortalSource || ssgChannelSource) searchWindow.maximize();",
  "      if (naverPortalSource || ssgChannelSource || lotteChannelSource) searchWindow.maximize();",
  "maximize Lotte result window",
);
main = replaceOnce(
  main,
  "    if (naverPortalSource || ssgChannelSource) {",
  "    if (naverPortalSource || ssgChannelSource || lotteChannelSource) {",
  "avoid scrolling exact Lotte results",
);
main = replaceOnce(
  main,
  "        if (ssgChannelSource && securityRetry < 1) {",
  "        if ((ssgChannelSource || lotteChannelSource) && securityRetry < 1) {",
  "retry blocked Lotte page without false absence",
);
if (!imageTitlePrimary) {
  main = replaceOnce(
    main,
    `  if (sourceFingerprint) {\n    const bestByStore = new Map();\n    products.forEach((product, index) => {\n      const previous = bestByStore.get(product.store);\n      if (!previous || product.confidence > previous.confidence) bestByStore.set(product.store, { index, confidence: product.confidence });\n    });\n    await Promise.all([...bestByStore.values()].map(async ({ index }) => {\n      const candidateFingerprint = await imageFingerprint(products[index].imageUrl).catch(() => null);\n      const imageSimilarity = fingerprintSimilarity(sourceFingerprint, candidateFingerprint);\n      products[index] = { ...products[index], ...scoreProductCandidate(source, products[index], imageSimilarity) };\n    }));\n  }`,
    `  if (sourceFingerprint) {\n    const imageCheckIndexes = new Set();\n    const bestByStore = new Map();\n    products.forEach((product, index) => {\n      const exactCode = Number(product.signals?.codeScore || 0) === 1;\n      const portalStore = /^(?:SSG|롯데)/.test(String(product.store || ""));\n      // The screenshot-backed SSG/Lotte rule compares every exact-code card\n      // that owns an image, not only the single top-ranked card for the store.\n      if (portalStore && exactCode && product.imageUrl) imageCheckIndexes.add(index);\n      const previous = bestByStore.get(product.store);\n      if (!previous || product.confidence > previous.confidence) bestByStore.set(product.store, { index, confidence: product.confidence });\n    });\n    for (const { index } of bestByStore.values()) imageCheckIndexes.add(index);\n    await Promise.all([...imageCheckIndexes].slice(0, 24).map(async (index) => {\n      const candidateFingerprint = await imageFingerprint(products[index].imageUrl).catch(() => null);\n      const imageSimilarity = fingerprintSimilarity(sourceFingerprint, candidateFingerprint);\n      products[index] = {\n        ...products[index],\n        imageCompared: Number.isFinite(imageSimilarity),\n        ...scoreProductCandidate(source, products[index], imageSimilarity),\n      };\n    }));\n  }`,
    "compare every exact SSG/Lotte result image",
  );
  main = replaceOnce(
    main,
    "    if (codeMatched) return true;",
    `    if (codeMatched) {\n      return imageEvidenceAllowsExactProduct({\n        store: product.store,\n        hasSourceImage,\n        candidateImageUrl: String(product.imageUrl || ""),\n        imageCompared: product.imageCompared === true,\n        imageScore,\n      });\n    }`,
    "use image as exact-code SSG/Lotte search criterion",
  );
}
await writeFile(mainPath, main, "utf8");

const relayPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let relay = normalizeLf(await readFile(relayPath, "utf8"));
relay = replaceOnce(
  relay,
  `    { store: "롯데온", linkOnly: true, domesticChannel: "lotte-general", renderCount: true },\n    { store: "롯데온 백화점", linkOnly: true, domesticChannel: "lotte-department", renderCount: true },\n    { store: "롯데온 아울렛", linkOnly: true, domesticChannel: "lotte-outlet", renderCount: true },`,
  `    // 롯데온 통합검색 한 번에서 정확 품번 카드를 판정한다. 백화점/아울렛은\n    // 같은 결과 카드의 판매처 라벨로 분류하며 동일 품번을 세 번 재검색하지 않는다.\n    { store: "롯데온", linkOnly: true, domesticChannel: "lotte-general", renderCount: true },`,
  "single Lotte integrated search",
);
relay = replaceOnce(
  relay,
  `        const ssgOfficialBrandHall = ssgClassification === "official_brand";\n        const parallelRetailer = detectedRetailer(rawCardText);`,
  `        const ssgOfficialBrandHall = ssgClassification === "official_brand";\n        const lotteEvidence = \`${'${rawCardText}'} ${'${String(card?.markup || "")}'}\`;\n        const lotteDepartmentStore = naverStore === "롯데온" && /롯데\\s*백화점|롯데백화점/i.test(lotteEvidence);\n        const lotteOutlet = naverStore === "롯데온" && /롯데.{0,12}아울렛|아울렛|outlet/i.test(lotteEvidence);\n        const parallelRetailer = detectedRetailer(rawCardText);`,
  "classify Lotte card seller label",
);
relay = replaceOnce(
  relay,
  `            store: ssgOfficialBrandHall ? "SSG 브랜드 공식관" : isSsgParallelImport ? "SSG 병행수입" : store,`,
  `            store: ssgOfficialBrandHall ? "SSG 브랜드 공식관"\n              : isSsgParallelImport ? "SSG 병행수입"\n                : lotteDepartmentStore ? "롯데백화점"\n                  : lotteOutlet ? "롯데 아울렛" : store,`,
  "surface Lotte seller classification",
);
relay = replaceOnce(
  relay,
  `      const exactSsgSearchChecked = /^SSG(?:\\s|$)/.test(String(store || "")) && cards.length > 0;`,
  `      const exactPortalSearchChecked = /^(?:SSG|롯데온)(?:\\s|$)/.test(String(store || "")) && cards.length > 0;`,
  "confirm absence only after parsed exact portal grid",
);
relay = replaceOnce(
  relay,
  `        absenceConfirmed: matchingProducts.size === 0 && exactSsgSearchChecked,\n        ssgSearchChecked: /^SSG(?:\\s|$)/.test(String(store || "")),`,
  `        absenceConfirmed: matchingProducts.size === 0 && exactPortalSearchChecked,\n        ssgSearchChecked: /^SSG(?:\\s|$)/.test(String(store || "")),\n        lotteSearchChecked: /^롯데온(?:\\s|$)/.test(String(store || "")),`,
  "Lotte exact-grid absence verdict",
);
await writeFile(relayPath, relay, "utf8");

console.log(imageTitlePrimary
  ? "Lotte verdict restore patch applied; accuracy-first image+title matcher preserved"
  : "Lotte verdict restore patch applied");
