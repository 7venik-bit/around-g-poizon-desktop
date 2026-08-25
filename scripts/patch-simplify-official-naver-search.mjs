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

const salesFilterPath = new URL("../services/poizon-sales-filter.mjs", import.meta.url);
let salesFilter = normalizeLf(await readFile(salesFilterPath, "utf8"));
salesFilter = replaceOnce(
  salesFilter,
  '  if (filters.rowLevel === true) {',
  '  // The Excel sourcing screen uses fixedTotalAnd=true. In that mode every\n  // visible row must itself satisfy both sales thresholds. A high-selling size\n  // in the same SPU must never pull <30, <5, --, or blank sibling rows back\n  // into the program list. The original workbook remains untouched.\n  if (filters.rowLevel === true || fixedTotalAnd) {',
  "row-level AND filter for all brand Excel previews",
);
await writeFile(salesFilterPath, salesFilter, "utf8");

console.log("official mall/Naver search simplified and Excel AND filter made row-level");
