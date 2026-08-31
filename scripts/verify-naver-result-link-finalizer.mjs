import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const required = [
  'import { createDomesticSearchLinkResult, createNaverFashionTownSearchLinkResult, finalizeNaverFashionTownResult, isNaverRenderedResultReady } from "./services/naver-fashiontown-result.mjs";',
  "if (isNaverRenderedResultReady(state, exactQuery)) return true;",
  "verificationStage,",
  "verificationDiagnostics: {",
  "productCardCount: Number(result?.candidateCount || result?.products?.length || 0)",
  "not the rejected promise or its error code.",
  "errorMessage: String(details.errorMessage || \"\")",
  "const directNaverFashionResult = naverPortalSource",
  "const initialUrl = directNaverFashionResult ? url",
  "if (interactiveSiteSearch && !directNaverFashionResult)",
  "return createNaverFashionTownSearchLinkResult({ articleNumber, resolvedSearchUrl: url });",
  "resultLinkOnly: result?.resultLinkOnly === true",
  "return createDomesticSearchLinkResult({ store: source.store, articleNumber, resolvedSearchUrl: url });",
  "const directOfficialResultLink",
  "const directParallelResultLink",
  'String(source.store || "") === "네이버 패션타운"',
  "const finalized = finalizeNaverFashionTownResult(parsedContent, {",
  "const approvedProducts = await filterApprovedNaverDomesticProducts",
  "visibleResultCountObserved",
  "presenceConfirmed: result?.presenceConfirmed === true",
  "naverAllSearchVerdict: result?.naverAllSearchVerdict || null",
  String.raw`/[\\d,]+\\s*원/.test(nodeText)`,
];

for (const marker of required) {
  if (!source.includes(marker)) throw new Error(`Naver result-link verification failed: ${marker}`);
}

console.log("Naver result-link finalizer verified.");
