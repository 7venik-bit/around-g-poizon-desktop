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
  `        const isSsgParallelImport = ssgClassification === "parallel_import";\n        const authenticity = classifyDomesticAuthenticity({\n          store: naverStore,\n          articleNumber,\n          text: rawCardText,\n          markup: String(card?.markup || ""),\n          ssgClassification,\n        });`,
  "classify domestic authenticity evidence",
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
  "surface authenticity guide label",
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
  `  const sourceStatus = (source, matchedProducts) => {\n    // Google Drive 포이즌 시트 계정정보 기준:\n    // 1) 네이버/SSG/롯데ON은 정확 상품 카드의 지정 공식 유통 라벨을 확인한다.\n    // 2) 시트에 직접 등록된 무신사/29CM/ABC마트/S.I.VILLAGE는 이미\n    //    matchedProducts 단계에서 정확 상품으로 검증된 경우 확인완료로 종료한다.\n    const sourceStore = String(source.store || "");\n    const trustedDistributionVerified = matchedProducts.some((product) => product?.officialDistributionVerified === true);\n    const accountSheetDirectStore = ["무신사", "29CM", "ABC마트", "S.I.VILLAGE"].includes(sourceStore);\n    if (trustedDistributionVerified || (accountSheetDirectStore && matchedProducts.length > 0)) {\n      return { label: "확인완료", className: "available" };\n    }\n    const musinsaSource = sourceStore === "무신사";\n    const available = matchedProducts.filter((product) => product.inStock === true).length;`,
  "finish account-sheet trusted distribution evidence as confirmed",
);
await writeFile(rendererPath, renderer, "utf8");

console.log("Domestic authenticity guide patch applied; account-sheet trusted retailers and exact-card labels finish as confirmed");
