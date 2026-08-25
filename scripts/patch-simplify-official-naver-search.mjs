import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`simplified search patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`simplified search patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
main = replaceOnce(
  main,
  '        const searchQuery = String(searchAttempt?.query || source.searchQuery || articleNumber || title || "").trim();',
  '        const searchQuery = interactiveOfficialSearch\n          ? sanitizeDomesticQuery([title, articleNumber].filter(Boolean).join(" "))\n          : String(searchAttempt?.query || source.searchQuery || articleNumber || title || "").trim();',
  "official mall title plus product-code query",
);
main = replaceOnce(
  main,
  '    if (naverPortalSource) {',
  '    // 네이버 패션타운은 전체 검색 결과 자체가 최종 판정이다.\n    // 브랜드직영몰/백화점/아울렛 숫자 인식이나 채널 선택은 하지 않는다.\n    if (naverPortalSource && String(source.store || "") !== "네이버 패션타운") {',
  "skip Naver channel counts for Fashion Town total results",
);
main = replaceOnce(
  main,
  '    const candidateCount = Array.isArray(analyzed.products) ? analyzed.products.length : 0;\n    let detailed = {',
  '    const candidateCount = Array.isArray(analyzed.products) ? analyzed.products.length : 0;\n    if (String(source.store || "") === "네이버 패션타운") {\n      const pageText = await searchWindow.webContents.executeJavaScript(\n        `String(document.body?.innerText || "").slice(0, 120000)`,\n        true,\n      ).catch(() => "");\n      const explicitEmpty = /검색된\\s*상품이\\s*없습니다|검색어에\\s*대한\\s*검색\\s*결과가\\s*없음|검색\\s*결과가\\s*없습니다|상품이\\s*없습니다|검색결과\\s*없음/i.test(pageText);\n      const allProducts = explicitEmpty ? [] : (Array.isArray(analyzed.products) ? analyzed.products : []);\n      const confirmed = allProducts.length > 0;\n      return {\n        ...analyzed,\n        count: allProducts.length,\n        products: allProducts,\n        presenceConfirmed: confirmed,\n        absenceConfirmed: !confirmed,\n        searchCompleted: true,\n        searchSubmitted: true,\n        resolvedSearchUrl,\n        candidateCount: allProducts.length,\n        naverChannelCounts: null,\n        naverAllSearchVerdict: confirmed ? "confirmed" : "absent",\n        detailVerificationPending: false,\n      };\n    }\n    let detailed = {',
  "treat Naver Fashion Town total result as final verdict",
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
  '    if (String(source.store || "") === "네이버 패션타운") {\n      if (source.presenceConfirmed || matchedProducts.length) return { label: "확인완료", className: "available" };\n      if (source.absenceConfirmed) return { label: "상품없음", className: "missing" };\n    }\n    if (!musinsaSource && matchedProducts.length) return { label: "상품 확인됨", className: "available" };',
  "binary Naver Fashion Town status label",
);
await writeFile(rendererPath, renderer, "utf8");

const salesFilterPath = new URL("../services/poizon-sales-filter.mjs", import.meta.url);
let salesFilter = normalizeLf(await readFile(salesFilterPath, "utf8"));
salesFilter = replaceOnce(
  salesFilter,
  '  if (filters.rowLevel === true) {',
  '  // The Excel sourcing screen uses fixedTotalAnd=true. In that mode every\n  // visible row must itself satisfy both sales thresholds. A high-selling size\n  // in the same SPU must never pull <30, <5, --, or blank sibling rows back\n  // into the program list. The original workbook remains untouched.\n  if (filters.rowLevel === true || fixedTotalAnd) {',
  "row-level AND filter for all brand Excel previews",
);
await writeFile(salesFilterPath, salesFilter, "utf8");

console.log("official mall/Naver search simplified; Fashion Town total result is final; Excel AND filter is row-level");
