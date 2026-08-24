import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`AUTHENTICITY patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`AUTHENTICITY patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const relayPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let relay = normalizeLf(await readFile(relayPath, "utf8"));
relay = replaceOnce(
  relay,
  'import { brandSearchQueries } from "../services/brand-search-profile.mjs";',
  'import { brandSearchQueries } from "../services/brand-search-profile.mjs";\nimport { classifyDomesticAuthenticity } from "../services/domestic-authenticity.mjs";',
  "import domestic authenticity guide",
);
relay = replaceOnce(
  relay,
  '        const isSsgParallelImport = ssgClassification === "parallel_import";',
  `        const isSsgParallelImport = ssgClassification === "parallel_import";\n        const authenticity = classifyDomesticAuthenticity({\n          store: naverStore,\n          text: rawCardText,\n          markup: String(card?.markup || ""),\n          ssgClassification,\n        });`,
  "classify SSG/Lotte authenticity evidence",
);
relay = replaceOnce(
  relay,
  '            id: productKey,',
  `            authenticityStatus: authenticity.status,\n            authenticityLabel: authenticity.label,\n            authenticityEvidence: authenticity.evidence,\n            officialDistributionVerified: authenticity.officialDistributionVerified,\n            platformAuthenticityPolicy: authenticity.platformAuthenticityPolicy,\n            id: productKey,`,
  "attach authenticity verdict to product result",
);
await writeFile(relayPath, relay, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));
renderer = replaceOnce(
  renderer,
  `    const confidenceLabel = officialVerified\n      ? text(product.sourceTrustLabel || "공식몰 확인완료")\n      : \`신뢰도 \${Number(product.confidence || 0)}%\`;`,
  `    const authenticityLabel = text(product?.authenticityLabel || "");\n    const confidenceLabel = officialVerified\n      ? text(product.sourceTrustLabel || "공식몰 확인완료")\n      : authenticityLabel\n        ? \`\${authenticityLabel} · 신뢰도 \${Number(product.confidence || 0)}%\`\n        : \`신뢰도 \${Number(product.confidence || 0)}%\`;`,
  "surface SSG/Lotte authenticity guide label",
);
renderer = replaceOnce(
  renderer,
  `      : \`<span>코드 \${text(product.signals?.code)}</span><span>상품명 \${text(product.signals?.title)}</span><span>이미지 \${text(product.signals?.image)}</span>\`;`,
  `      : \`<span>코드 \${text(product.signals?.code)}</span><span>상품명 \${text(product.signals?.title)}</span><span>이미지 \${text(product.signals?.image)}</span>\${product?.authenticityEvidence ? \`<span>유통근거 \${text(product.authenticityEvidence)}</span>\` : ""}\`;`,
  "surface authenticity evidence detail",
);
await writeFile(rendererPath, renderer, "utf8");

console.log("Domestic authenticity guide patch applied");
