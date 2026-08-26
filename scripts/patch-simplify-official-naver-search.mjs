import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`simplified search patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`simplified search patch target duplicated: ${label}`);
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
  '  return entries.flatMap((entry) => {\n    const row = entry.values || [];\n    const spuId = raw(row, columns.spuId);',
  '  return entries.flatMap((entry) => {\n    const row = entry.values || [];\n    // Domestic sourcing is performed per size/SKU row. A product can have\n    // high total sales while the selected size has "<5" or another low recent\n    // sales value. Never put that size into the domestic-search queue. When\n    // both recent-sales columns are present, the row itself must satisfy the\n    // same strict 30+ AND rule. The source workbook remains untouched.\n    if (columns.sales30d >= 0 && columns.localSales30d >= 0) {\n      const chinaRecentSales = parsePoizonSalesMetric(cell(row, columns.sales30d));\n      const localRecentSales = parsePoizonSalesMetric(cell(row, columns.localSales30d));\n      if (chinaRecentSales < 30 || localRecentSales < 30) return [];\n    }\n    const spuId = raw(row, columns.spuId);',
  "exclude low-selling size rows from domestic search",
);
main = replaceOnce(
  main,
  '        const searchQuery = String(searchAttempt?.query || source.searchQuery || articleNumber || title || "").trim();',
  '        const searchQuery = interactiveOfficialSearch\n          ? sanitizeDomesticQuery([title, articleNumber].filter(Boolean).join(" "))\n          : String(searchAttempt?.query || source.searchQuery || articleNumber || title || "").trim();',
  "official mall title plus product-code query",
);
main = replaceOnce(
  main,
  '  const naverPortalSource = /^네이버\\s/.test(String(source.store || ""));',
  '  const naverPortalSource = /^네이버\\s/.test(String(source.store || ""));\n  // 네이버 패션타운은 네이버 메인/AI 검색을 경유하지 않는다.\n  // relay가 만든 shopping.naver.com/window/search/fashion-group URL을 바로 연다.\n  const directNaverFashionTownSource = String(source.store || "") === "네이버 패션타운";',
  "mark direct Naver Fashion Town source",
);
main = replaceOnce(
  main,
  '      const initialUrl = naverPortalSource ? "https://www.naver.com/" : url;',
  '      const initialUrl = directNaverFashionTownSource ? url\n        : naverPortalSource ? "https://www.naver.com/" : url;',
  "open Fashion Town result URL directly",
);
main = replaceOnce(
  main,
  '      if (interactiveSiteSearch) {\n        const searchQuery = interactiveOfficialSearch\n          ? sanitizeDomesticQuery([title, articleNumber].filter(Boolean).join(" "))\n          : String(searchAttempt?.query || source.searchQuery || articleNumber || title || "").trim();',
  '      // 패션타운은 이미 상품코드가 포함된 전용 검색 URL을 직접 열었으므로\n      // 네이버 메인에서 쇼핑/패션타운 메뉴를 클릭하거나 AI 검색창에 다시 입력하지 않는다.\n      if (interactiveSiteSearch && !directNaverFashionTownSource) {\n        const searchQuery = interactiveOfficialSearch\n          ? sanitizeDomesticQuery([title, articleNumber].filter(Boolean).join(" "))\n          : String(searchAttempt?.query || source.searchQuery || articleNumber || title || "").trim();',
  "skip Naver main and AI search for direct Fashion Town",
);
main = replaceAllRequired(
  main,
  '    if (naverPortalSource) {',
  '    // 네이버 패션타운은 전체 검색 결과 자체가 최종 판정이다.\n    // 브랜드직영몰/백화점/아울렛 숫자 인식이나 채널 선택은 하지 않는다.\n    if (naverPortalSource && String(source.store || "") !== "네이버 패션타운") {',
  "skip Naver channel counts for Fashion Town total results",
);
main = replaceAllRequired(
  main,
  '    const candidateCount = Array.isArray(analyzed.products) ? analyzed.products.length : 0;\n    let detailed = {',
  '    const candidateCount = Array.isArray(analyzed.products) ? analyzed.products.length : 0;\n    if (String(source.store || "") === "네이버 패션타운") {\n      const pageText = await searchWindow.webContents.executeJavaScript(\n        `String(document.body?.innerText || "").slice(0, 120000)`,\n        true,\n      ).catch(() => "");\n      const explicitEmpty = /검색된\\s*상품이\\s*없습니다|검색어에\\s*대한\\s*검색\\s*결과가\\s*없음|검색\\s*결과가\\s*없습니다|상품이\\s*없습니다|검색결과\\s*없음/i.test(pageText);\n      const trustedChannelEvidence = /브랜드직영몰\\s*[1-9]\\d*\\s*개|백화점\\s*[1-9]\\d*\\s*개|아울렛\\s*[1-9]\\d*\\s*개/i.test(pageText);\n      const allProducts = explicitEmpty ? [] : (Array.isArray(analyzed.products) ? analyzed.products : []);\n      const confirmed = allProducts.length > 0 || trustedChannelEvidence;\n      return {\n        ...analyzed,\n        count: allProducts.length,\n        products: allProducts,\n        presenceConfirmed: confirmed,\n        absenceConfirmed: explicitEmpty && !trustedChannelEvidence,\n        searchCompleted: true,\n        searchSubmitted: true,\n        resolvedSearchUrl,\n        candidateCount: allProducts.length,\n        naverChannelCounts: null,\n        naverTrustedChannelEvidence: trustedChannelEvidence,\n        naverAllSearchVerdict: confirmed ? "confirmed" : (explicitEmpty ? "absent" : "pending"),\n        detailVerificationPending: false,\n      };\n    }\n    let detailed = {',
  "treat Naver Fashion Town total result and trusted channel counts as final evidence",
);
await writeFile(mainPath, main, "utf8");

const relayPath = new URL("../relay/domestic-search.mjs", import.meta.url);
let relay = normalizeLf(await readFile(relayPath, "utf8"));
relay = replaceOnce(
  relay,
  '    { store: "네이버 공식 브랜드스토어", linkOnly: true, fashionTown: "brand-store", renderCount: true },\n    { store: "네이버 백화점", linkOnly: true, fashionTown: "department", renderCount: true },\n    { store: "네이버 아울렛", linkOnly: true, fashionTown: "outlet", renderCount: true },',
  '    { store: "네이버 패션타운", linkOnly: true, fashionTown: "brand-store", renderCount: true },',
  "single Naver Fashion Town source",
);
await writeFile(relayPath, relay, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = normalizeLf(await readFile(rendererPath, "utf8"));
renderer = replaceOnce(
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

console.log("official mall/Naver search simplified; Fashion Town opens direct shopping.naver.com search route; all Excel paths use strict row-level 30+ AND filtering");
