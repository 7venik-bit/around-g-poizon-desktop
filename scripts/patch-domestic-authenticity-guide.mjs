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
renderer = replaceOnce(
  renderer,
  `  const sourceStatus = (source, matchedProducts) => {\n    const available = matchedProducts.filter((product) => product.inStock === true).length;`,
  `  const sourceStatus = (source, matchedProducts) => {\n    // SSG/롯데ON 상품 카드의 백화점 판매처 라벨은 정품 유통 근거로 충분하다.\n    // 신세계백화점/롯데백화점 라벨을 분류기가 확인한 상품은 재고 상태와 무관하게 확인완료로 종료한다.\n    const departmentStoreVerified = matchedProducts.some((product) => product?.officialDistributionVerified === true\n      && /신세계백화점|롯데백화점/.test(String(product?.authenticityLabel || "") + " " + String(product?.authenticityEvidence || "")));\n    if (departmentStoreVerified) return { label: "확인완료", className: "available" };\n    const available = matchedProducts.filter((product) => product.inStock === true).length;`,
  "finish SSG/Lotte department-store label evidence as confirmed",
);
await writeFile(rendererPath, renderer, "utf8");

console.log("Domestic authenticity guide patch applied; SSG/Lotte department-store labels finish as confirmed");
