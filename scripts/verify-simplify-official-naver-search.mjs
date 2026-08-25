import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const relay = String(await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const salesFilter = String(await readFile(new URL("../services/poizon-sales-filter.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`simplified official/Naver search verification failed: ${message}`); };

if (!main.includes('sanitizeDomesticQuery([title, articleNumber].filter(Boolean).join(" "))')) {
  fail("official mall does not use product name plus product code only");
}
if (!relay.includes('{ store: "네이버 패션타운", linkOnly: true, fashionTown: "brand-store", renderCount: true }')) {
  fail("single Naver Fashion Town source is missing");
}
const sourceBlock = relay.match(/const sources = \[[\s\S]*?\n  \];/)?.[0] || "";
if (!sourceBlock) fail("domestic source list was not found");
for (const removed of ["네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛"]) {
  if (sourceBlock.includes(`store: "${removed}"`)) fail(`${removed} is still searched as a separate source`);
}
if (!main.includes('naverPortalSource && String(source.store || "") !== "네이버 패션타운"')) {
  fail("Fashion Town still depends on Naver channel-count routing");
}
if (!main.includes('naverAllSearchVerdict: confirmed ? "confirmed" : "absent"')) {
  fail("Fashion Town total-result verdict is missing");
}
if (!main.includes('detailVerificationPending: false')) {
  fail("Fashion Town still requires detail verification after total search");
}
if (!main.includes('검색된\\s*상품이\\s*없습니다')) {
  fail("Fashion Town explicit no-result text is not recognized");
}
if (!renderer.includes('return { label: "확인완료", className: "available" };')) {
  fail("Fashion Town success label is not 확인완료");
}
if (!renderer.includes('return { label: "상품없음", className: "missing" };')) {
  fail("Fashion Town absence label is not 상품없음");
}
if (main.includes('"네이버 패션타운" ? await ensureNaverOfficialBrandFilter')) {
  fail("Naver Fashion Town still triggers official-brand channel filtering");
}
if (!salesFilter.includes('if (filters.rowLevel === true || fixedTotalAnd) {')) {
  fail("fixed AND Excel preview is not filtered at row level");
}
if (!salesFilter.includes('const matchMode = fixedTotalAnd || filters.matchMode === "all" ? "all" : "any";')) {
  fail("fixed Excel filter no longer guarantees AND matching");
}
console.log("Naver Fashion Town total-result binary verdict and row-level Excel AND filter verification passed");
