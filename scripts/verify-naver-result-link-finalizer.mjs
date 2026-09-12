import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const required = [
  "recoveryProducts: source.recoveryProducts, recoveryOptions: source.recoveryOptions",
  "const technicalPending = approval.failedCount > 0 || approvedProducts.some(product => !stockObservationComplete(product));",
  'import { createDomesticSearchLinkResult, finalizeNaverFashionTownResult, isNaverRenderedResultReady } from "./services/naver-fashiontown-result.mjs";',
  "if (isNaverRenderedResultReady(state, exactQuery)) return true;",
  "verificationStage,",
  "verificationDiagnostics: {",
  "productCardCount: Number(result?.candidateCount || result?.products?.length || 0)",
  "not the rejected promise or its error code.",
  "errorMessage: String(details.errorMessage || \"\")",
  "const directNaverFashionResult = naverPortalSource",
  'const initialUrl = naverPortalSource ? "https://www.naver.com/" : url',
  "const resultPage = await loadNaverFashionTownResultPage",
  "if (interactiveSiteSearch && !directNaverFashionResult)",
  "resultLinkOnly: result?.resultLinkOnly === true",
  "const directParallelResultLink",
  'String(source.store || "") === "네이버 패션타운"',
  "const finalized = finalizeNaverFashionTownResult(parsedContent, {",
  "const approval = await verifyApprovedNaverDomesticProducts",
  "identityMode: requireArticleIdentity ? \"article\" : \"brand_title\"",
  "visibleResultCountObserved",
  "presenceConfirmed: result?.presenceConfirmed === true",
  "naverAllSearchVerdict: result?.naverAllSearchVerdict || null",
  String.raw`/[\\d,]+\\s*원/.test(nodeText)`,
];

for (const marker of required) {
  if (!source.includes(marker)) throw new Error(`Naver result-link verification failed: ${marker}`);
}

if (source.includes("const directOfficialResultLink")) {
  throw new Error("Official malls must reach rendered-card price capture instead of returning link-only.");
}
if (source.includes("return createNaverFashionTownSearchLinkResult")) {
  throw new Error("Naver Fashion Town must capture cards and prices instead of returning early as a link.");
}
if (source.includes("const directRetailResultLink")) {
  throw new Error("SSG and LotteON must capture visible product cards instead of returning a link only.");
}
if (/if \(directNaverFashionResult\) \{\s*return createDomesticSearchLinkResult/.test(source)) {
  throw new Error("Naver Fashion Town must load and capture visible result cards.");
}

console.log("Naver result-link finalizer verified.");
