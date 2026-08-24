import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`SSG defer patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`SSG defer patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));

// SSG's own access-limited page explicitly says an automated environment was
// detected. Do not hammer that page with the old immediate eight-second retry.
// Lotte keeps its one same-page retry, while SSG is queued for one later pass
// after the remaining domestic sources have had time to run.
main = replaceOnce(
  main,
  "        if ((ssgChannelSource || lotteChannelSource) && securityRetry < 1) {",
  "        if (lotteChannelSource && securityRetry < 1) {",
  "remove immediate SSG security retry",
);

const functionStart = main.indexOf("async function addRenderedSearchCounts(");
const functionEnd = main.indexOf("\nfunction brandsWithOfficialDomainStatus", functionStart);
if (functionStart < 0 || functionEnd < 0) throw new Error("SSG defer patch target missing: addRenderedSearchCounts");
let renderedCounts = main.slice(functionStart, functionEnd);
renderedCounts = replaceOnce(
  renderedCounts,
  "  const discoveredProducts = [];\n  const sources = [];",
  "  const discoveredProducts = [];\n  const sources = [];\n  const deferredSsgRetries = [];",
  "declare deferred SSG queue",
);
renderedCounts = replaceOnce(
  renderedCounts,
  "    sources.push(resolvedSource);",
  `    const resolvedSourceIndex = sources.length;\n    sources.push(resolvedSource);\n    const blockedSsg = /^SSG(?:\\s|$)/.test(String(source.store || \"\"))\n      && (resolvedSource.securityVerificationRequired === true\n        || String(resolvedSource.verificationReason || \"\") === \"security_verification_required\");\n    if (blockedSsg) deferredSsgRetries.push({ source, index: resolvedSourceIndex });`,
  "queue blocked SSG source",
);
renderedCounts = replaceOnce(
  renderedCounts,
  "  const products = [...(data.products || []), ...discoveredProducts].filter((product, index, all) =>",
  `  // A blocked SSG source gets exactly one later retry. By this point the\n  // remaining sources (including retailer discovery/Kolon) have completed, so\n  // SSG receives a natural backoff window without repeated refreshes. A second\n  // block remains a verification failure and is never converted to 상품 없음.\n  for (const deferred of deferredSsgRetries) {\n    const source = deferred.source;\n    const allQueryAttempts = Array.isArray(source.searchAttempts) && source.searchAttempts.length\n      ? source.searchAttempts : [{ query: source.searchQuery || articleNumber || title || \"\", url: source.searchUrl || \"\" }];\n    const queryAttempt = allQueryAttempts[0];\n    const retryResult = await renderedSearchSourceResult(\n      source, articleNumber, brand, title, 1, queryAttempt, sharedNaverSession,\n    );\n    if (Array.isArray(retryResult?.products)) discoveredProducts.push(...retryResult.products);\n    const retryCount = retryResult?.count;\n    const retryAbsenceConfirmed = retryResult?.absenceConfirmed === true;\n    const retryVerifiedProductUrl = String((retryResult?.products || [])\n      .find((product) => /^https?:\\/\\//i.test(String(product?.url || \"\")))?.url || \"\");\n    sources[deferred.index] = {\n      ...sources[deferred.index],\n      searchUrl: String(retryResult?.resolvedSearchUrl || source.searchUrl || \"\"),\n      count: Number.isFinite(retryCount) ? Number(retryCount) : 0,\n      countVerified: Number.isFinite(retryCount) && (Number(retryCount) > 0 || retryAbsenceConfirmed),\n      verificationFailed: !Number.isFinite(retryCount),\n      verificationPending: retryResult?.detailVerificationPending === true\n        || (Number.isFinite(retryCount) && Number(retryCount) === 0 && !retryAbsenceConfirmed),\n      absenceConfirmed: retryAbsenceConfirmed,\n      searchCompleted: retryResult?.searchCompleted === true,\n      searchSubmitted: retryResult?.searchSubmitted === true,\n      verificationReason: retryResult?.securityVerificationRequired === true\n        ? \"ssg_access_limited_deferred\"\n        : String(retryResult?.verificationReason || \"\"),\n      securityVerificationRequired: retryResult?.securityVerificationRequired === true,\n      candidateCount: Number(retryResult?.candidateCount || 0),\n      verifiedProductUrl: retryVerifiedProductUrl,\n      deferredRetryAttempted: true,\n    };\n  }\n  const products = [...(data.products || []), ...discoveredProducts].filter((product, index, all) =>`,
  "run deferred SSG retry",
);
main = main.slice(0, functionStart) + renderedCounts + main.slice(functionEnd);
await writeFile(mainPath, main, "utf8");

const relayPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let relay = normalizeLf(await readFile(relayPath, "utf8"));
const ssgStart = relay.indexOf("    // SSG 통합검색 한 번에서 정확 품번 카드를 판정한다.");
const lotteStart = relay.indexOf("    // 롯데온 통합검색 한 번에서 정확 품번 카드를 판정한다.");
if (ssgStart < 0 || lotteStart < 0 || lotteStart <= ssgStart) {
  throw new Error("SSG defer patch target missing: SSG/Lotte source order");
}
const lotteLine = '    { store: "롯데온", linkOnly: true, domesticChannel: "lotte-general", renderCount: true },';
const lotteLineStart = relay.indexOf(lotteLine, lotteStart);
if (lotteLineStart < 0) throw new Error("SSG defer patch target missing: Lotte integrated source");
const lotteEnd = relay.indexOf("\n", lotteLineStart + lotteLine.length) + 1;
const ssgChunk = relay.slice(ssgStart, lotteStart);
const lotteChunk = relay.slice(lotteStart, lotteEnd);
relay = relay.slice(0, ssgStart) + lotteChunk + ssgChunk + relay.slice(lotteEnd);
await writeFile(relayPath, relay, "utf8");

console.log("SSG deferred-search patch applied");
