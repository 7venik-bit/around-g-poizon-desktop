import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.lastIndexOf(before);
  if (first < 0) throw new Error(`simplified search patch target missing: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};
const replaceAllRequired = (source, before, after, label) => {
  if (source.includes(after) && !source.includes(before)) return source;
  const count = source.split(before).length - 1;
  if (count < 1) throw new Error(`simplified search patch target missing: ${label}`);
  return source.split(before).join(after);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
main = replaceOnce(
  main,
  'import { createDomesticSearchLinkResult, finalizeNaverFashionTownResult, isNaverRenderedResultReady } from "./services/naver-fashiontown-result.mjs";',
  'import { createDomesticSearchLinkResult, finalizeNaverFashionTownResult, isNaverRenderedResultReady } from "./services/naver-fashiontown-result.mjs";\nimport { captureVisibleExactRetailerCards, visibleRetailerCardsToProducts, officialSearchErrorText } from "./services/live-retailer-card-fallback.mjs";',
  "import live retailer card fallback",
);
main = replaceOnce(
  main,
  '    // Domestic sourcing is performed per size/SKU row. A product can have\n    // high total sales while the selected size has "<5" or another low recent\n    // sales value. Never put that size into the domestic-search queue. When\n    // both recent-sales columns are present, the row itself must satisfy the\n    // same strict 30+ AND rule. The source workbook remains untouched.\n    if (columns.sales30d >= 0 && columns.localSales30d >= 0) {\n      const chinaRecentSales = parsePoizonSalesMetric(cell(row, columns.sales30d));\n      const localRecentSales = parsePoizonSalesMetric(cell(row, columns.localSales30d));\n      if (chinaRecentSales < 30 || localRecentSales < 30) return [];\n    }',
  '    // Do not apply an invisible recent-sales threshold here. Filtering has\n    // already been completed against the user\'s explicit Excel conditions;\n    // dropping low recent-sales SKU rows at conversion time made qualified\n    // results disappear from the list.',
  "remove hidden recent-sales threshold",
);
main = replaceOnce(
  main,
  '        const searchQuery = interactiveOfficialSearch\n          ? sanitizeDomesticQuery([title, articleNumber].filter(Boolean).join(" "))\n          : String(searchAttempt?.query || source.searchQuery || articleNumber || title || "").trim();',
  '        const searchQuery = interactiveOfficialSearch\n          ? sanitizeDomesticProductCode(articleNumber) || sanitizeDomesticQuery(title)\n          : String(searchAttempt?.query || source.searchQuery || articleNumber || title || "").trim();',
  "official mall exact product-code query",
);

// Naver Fashion Town is already an exact rendered query page. When the exact
// model and price are visibly present, publish that card immediately and keep
// stock unknown instead of discarding the price because a later detail page is
// rate-limited or slow. Stock is never invented.
main = replaceOnce(
  main,
  '      const attemptedQuery = sanitizeDomesticQuery(searchAttempt?.query || source.searchQuery || articleNumber || title);\n      const exactCodeQuery = sanitizeDomesticProductCode(articleNumber);',
  '      const liveCardCapture = await searchWindow.webContents.mainFrame.executeJavaScript(\n        `(${captureVisibleExactRetailerCards.toString()})(${JSON.stringify(articleNumber)}, ${JSON.stringify(String(source.store || ""))})`, true,\n      ).catch(() => null);\n      const liveCardProducts = visibleRetailerCardsToProducts(liveCardCapture, { store: String(source.store || "네이버 패션타운"), articleNumber, brand });\n      if (liveCardProducts.length) {\n        await onActivity?.({ products: liveCardProducts, completedProducts: 0, totalProducts: liveCardProducts.length, detailVerified: false, searchCardsObserved: true });\n        return {\n          ...finalized, count: liveCardProducts.length, products: liveCardProducts,\n          presenceConfirmed: true, absenceConfirmed: false, naverAllSearchVerdict: "confirmed",\n          detailVerificationPending: true, verificationPending: true, verificationReason: "",\n          searchCompleted: true, searchSubmitted: true, candidateCount: liveCardProducts.length,\n          verificationDiagnostics: { ...(finalized.verificationDiagnostics || {}), stage: "visible_search_card", liveCardCount: liveCardProducts.length },\n        };\n      }\n      const attemptedQuery = sanitizeDomesticQuery(searchAttempt?.query || source.searchQuery || articleNumber || title);\n      const exactCodeQuery = sanitizeDomesticProductCode(articleNumber);',
  "preserve exact Naver visible card prices before detail verification",
);

// If the platform analyzer misses a visibly rendered exact product card (the
// observed LotteON failure), recover the card from the actual DOM. Official
// malls use the same path only when the page is not an error page. These are
// price/link results only; inventory stays unknown.
main = replaceOnce(
  main,
  '    const analyzed = analyzeRenderedChannelProducts(content, source.store, articleNumber, brand, title);\n    if (officialSearchResultVerified && Array.isArray(analyzed?.products)) {',
  '    let analyzed = analyzeRenderedChannelProducts(content, source.store, articleNumber, brand, title);\n    if (["롯데온", "브랜드 공식몰"].includes(String(source.store || "")) && (!Array.isArray(analyzed?.products) || analyzed.products.length === 0)) {\n      const liveCardCapture = await searchWindow.webContents.mainFrame.executeJavaScript(\n        `(${captureVisibleExactRetailerCards.toString()})(${JSON.stringify(articleNumber)}, ${JSON.stringify(String(source.store || ""))})`, true,\n      ).catch(() => null);\n      const liveCardProducts = visibleRetailerCardsToProducts(liveCardCapture, { store: String(source.store || ""), articleNumber, brand });\n      if (liveCardProducts.length) {\n        return {\n          ...(analyzed || {}), count: liveCardProducts.length, products: liveCardProducts,\n          presenceConfirmed: true, absenceConfirmed: false, detailVerificationPending: true, verificationPending: true,\n          verificationReason: "", searchCompleted: true, searchSubmitted: interactiveSiteSearch || true,\n          resolvedSearchUrl: String(searchWindow.webContents.getURL() || url), candidateCount: liveCardProducts.length,\n          verificationDiagnostics: { stage: "visible_search_card", liveCardCount: liveCardProducts.length, resolvedUrl: String(searchWindow.webContents.getURL() || url) },\n        };\n      }\n    }\n    if (officialSearchResultVerified && Array.isArray(analyzed?.products)) {',
  "recover Lotte and official exact visible cards",
);

// The source watchdog should return visible exact-card prices instead of an
// empty collection_stalled row. This covers a page that becomes usable after
// the original capture but before the detail verifier finishes.
main = replaceOnce(
  main,
  '          expire = () => {\n            const remaining = sourceDeadlineAt - Date.now();',
  '          expire = async () => {\n            const remaining = sourceDeadlineAt - Date.now();',
  "make retailer inactivity watchdog async",
);
main = replaceOnce(
  main,
  '            const diagnosticWindow = [...activeDomesticSearchWindows].find((window) => window.domesticDiagnostics);\n            const failure = renderedSearchFailure("collection_stalled", diagnosticWindow, {',
  '            const diagnosticWindow = [...activeDomesticSearchWindows].find((window) => window.domesticDiagnostics);\n            const liveCardCapture = diagnosticWindow && !diagnosticWindow.isDestroyed()\n              ? await diagnosticWindow.webContents.mainFrame.executeJavaScript(\n                `(${captureVisibleExactRetailerCards.toString()})(${JSON.stringify(articleNumber)}, ${JSON.stringify(String(source.store || ""))})`, true,\n              ).catch(() => null) : null;\n            const liveCardProducts = visibleRetailerCardsToProducts(liveCardCapture, { store: String(source.store || ""), articleNumber, brand });\n            if (liveCardProducts.length) {\n              const resolvedSearchUrl = String(diagnosticWindow?.webContents?.getURL?.() || queryAttempt.url || source.searchUrl || "");\n              for (const searchWindow of [...activeDomesticSearchWindows]) {\n                if (searchWindow && !searchWindow.isDestroyed()) searchWindow.destroy();\n              }\n              activeDomesticSearchWindows.clear();\n              return resolve({\n                count: liveCardProducts.length, products: liveCardProducts, presenceConfirmed: true, absenceConfirmed: false,\n                searchCompleted: true, searchSubmitted: true, verificationPending: true, detailVerificationPending: true,\n                verificationReason: "", resolvedSearchUrl, candidateCount: liveCardProducts.length,\n                verificationDiagnostics: { stage: "visible_search_card_timeout", liveCardCount: liveCardProducts.length, ...detailProgress },\n              });\n            }\n            const failure = renderedSearchFailure("collection_stalled", diagnosticWindow, {',
  "return exact visible cards on collection stall",
);

// Do not promote navigation/error links from a brand mall to products.
main = replaceOnce(
  main,
  '      const currentUrl = String(searchWindow.webContents.getURL() || "");\n      const expectedQuery = sanitizeDomesticProductCode(articleNumber) || sanitizeDomesticQuery(title);',
  '      const currentUrl = String(searchWindow.webContents.getURL() || "");\n      const officialPageText = String(parsedContent?.pageText || parsedContent?.bodyText || "");\n      if (officialSearchErrorText(officialPageText)) {\n        parsedContent.productCards = [];\n      }\n      const expectedQuery = sanitizeDomesticProductCode(articleNumber) || sanitizeDomesticQuery(title);',
  "reject official mall error pages",
);

// The canonical application now owns Naver's visible card-list flow. Keep the
// legacy single-source transformations disabled so release builds cannot
// replace the tested main/relay/renderer implementation.
if (false) {
main = replaceOnce(
  main,
  '    if (naverPortalSource) {\n      // The three Fashion Town totals are the authoritative routing decision.',
  '    // 단일 네이버 패션타운 소스는 쇼핑/패션타운 클릭과 상품코드 입력을\n    // 반드시 실행하고, 기존 3개 채널 숫자 분기만 건너뛴다.\n    if (naverPortalSource && String(source.store || "") !== "네이버 패션타운") {\n      // The three Fashion Town totals are the authoritative routing decision.',
  "skip Naver channel counts for Fashion Town total results",
);
main = replaceAllRequired(
  main,
  '    const candidateCount = Array.isArray(analyzed.products) ? analyzed.products.length : 0;\n    let detailed = {',
  '    const candidateCount = Array.isArray(analyzed.products) ? analyzed.products.length : 0;\n    if (String(source.store || "") === "네이버 패션타운") {\n      const pageText = await searchWindow.webContents.executeJavaScript(\n        `String(document.body?.innerText || "").slice(0, 120000)`,\n        true,\n      ).catch(() => "");\n      const explicitEmpty = /검색된\\s*상품이\\s*없습니다|검색어에\\s*대한\\s*검색\\s*결과가\\s*없음|검색\\s*결과가\\s*없습니다|상품이\\s*없습니다|검색결과\\s*없음/i.test(pageText);\n      const trustedChannelEvidence = /브랜드직영몰\\s*[1-9]\\d*\\s*개|백화점\\s*[1-9]\\d*\\s*개|아울렛\\s*[1-9]\\d*\\s*개/i.test(pageText);\n      const allProducts = explicitEmpty ? [] : (Array.isArray(analyzed.products) ? analyzed.products : []);\n      const confirmed = allProducts.length > 0 || trustedChannelEvidence;\n      return {\n        ...analyzed,\n        count: allProducts.length,\n        products: allProducts,\n        presenceConfirmed: confirmed,\n        absenceConfirmed: explicitEmpty && !trustedChannelEvidence,\n        searchCompleted: true,\n        searchSubmitted: true,\n        resolvedSearchUrl,\n        candidateCount: allProducts.length,\n        naverChannelCounts: null,\n        naverTrustedChannelEvidence: trustedChannelEvidence,\n        naverAllSearchVerdict: confirmed ? "confirmed" : (explicitEmpty ? "absent" : "pending"),\n        detailVerificationPending: false,\n      };\n    }\n    let detailed = {',
  "treat Naver Fashion Town total result and trusted channel counts as final evidence",
);
}
await writeFile(mainPath, main, "utf8");

const relayPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let relay = normalizeLf(await readFile(relayPath, "utf8"));
if (false) relay = replaceOnce(
  relay,
  '    { store: "네이버 공식 브랜드스토어", linkOnly: true, fashionTown: "brand-store", renderCount: true },\n    { store: "네이버 백화점", linkOnly: true, fashionTown: "department", renderCount: true },\n    { store: "네이버 아울렛", linkOnly: true, fashionTown: "outlet", renderCount: true },',
  '    { store: "네이버 패션타운", linkOnly: true, fashionTown: "brand-store", renderCount: true },',
  "single Naver Fashion Town source",
);
// An official result must be a product, never an accessibility/navigation link
// or an error-page anchor. This prevents '메인 컨텐츠로 건너뛰기' from becoming
// a zero-price Crocs product.
relay = replaceOnce(
  relay,
  '        if (!articleMatched) continue;\n        if (requiresBrandMatch) {',
  '        if (!articleMatched) continue;\n        if (trustedOfficialCard && /^(?:메인\\s*컨텐츠로\\s*건너뛰기|본문(?:으로)?\\s*바로가기|skip\\s*to)/i.test(rawCardText)) continue;\n        if (trustedOfficialCard && /(?:페이지를\\s*찾을\\s*수\\s*없습니다|page\\s*not\\s*found|\\b404\\b)/i.test(rawCardText)) continue;\n        if (requiresBrandMatch) {',
  "reject official navigation and error links",
);
await writeFile(relayPath, relay, "utf8");

const registryPath = new URL("../services/official-domain-registry.mjs", import.meta.url);
let registry = normalizeLf(await readFile(registryPath, "utf8"));
registry = replaceOnce(
  registry,
  '{ name: "크록스", aliases: ["crocs", "크록스"], domain: "crocs.co.kr", homepageUrl: "https://www.crocs.co.kr/", searchTemplate: "https://www.crocs.co.kr/search?q={query}" },',
  '{ name: "크록스", aliases: ["crocs", "크록스"], domain: "crocs.co.kr", homepageUrl: "https://www.crocs.co.kr/", searchTemplate: "", interactiveSearch: true },',
  "use Crocs visible site search instead of obsolete 404 route",
);
await writeFile(registryPath, registry, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));
if (false) renderer = replaceOnce(
  renderer,
  '    if (!musinsaSource && matchedProducts.length) return { label: "상품 확인됨", className: "available" };',
  '    if (String(source.store || "") === "네이버 패션타운") {\n      if (source.presenceConfirmed || source.naverTrustedChannelEvidence || source.naverAllSearchVerdict === "confirmed" || matchedProducts.length) return { label: "확인완료", className: "available" };\n      if (source.absenceConfirmed || source.naverAllSearchVerdict === "absent") return { label: "상품없음", className: "missing" };\n    }\n    if (!musinsaSource && matchedProducts.length) return { label: "상품 확인됨", className: "available" };',
  "binary Naver Fashion Town status label",
);
await writeFile(rendererPath, renderer, "utf8");

const salesFilterPath = new URL("../services/poizon-sales-filter.mjs", import.meta.url);
let salesFilter = normalizeLf(await readFile(salesFilterPath, "utf8"));
salesFilter = replaceOnce(salesFilter, 'export const POIZON_MINIMUM_TOTAL_SALES = 50;', 'export const POIZON_MINIMUM_TOTAL_SALES = 30;', "use the operator's 30-sale baseline everywhere");
salesFilter = replaceOnce(salesFilter, '  if (filters.rowLevel === true) {', '  // The Excel sourcing screen uses fixedTotalAnd=true. In that mode every\n  // visible row must itself satisfy both sales thresholds. A high-selling size\n  // in the same SPU must never pull <30, <5, --, or blank sibling rows back\n  // into the program list. The original workbook remains untouched.\n  if (filters.rowLevel === true || fixedTotalAnd) {', "row-level AND filter for all brand Excel previews");
salesFilter = replaceOnce(salesFilter, '    if (totalSales < threshold && localTotalSales < threshold) continue;', '    // Processed/imported workbook rows obey the same strict AND rule as the\n    // on-screen preview: both China total sales and local seller total sales\n    // must meet the threshold. The source workbook is never changed.\n    if (totalSales < threshold || localTotalSales < threshold) continue;', "strict AND filter for processed workbook rows");
salesFilter = replaceOnce(salesFilter, '    matchMode: "any",', '    matchMode: "all",', "report processed workbook filter as AND");
await writeFile(salesFilterPath, salesFilter, "utf8");

console.log("official mall, live retailer visible-card recovery, and Excel filtering patched");
