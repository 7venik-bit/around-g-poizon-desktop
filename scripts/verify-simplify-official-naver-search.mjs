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
if (!main.includes('const trustedChannelEvidence = /브랜드직영몰')) {
  fail("Fashion Town trusted-channel evidence is missing");
}
if (!main.includes('naverTrustedChannelEvidence: trustedChannelEvidence')) {
  fail("Fashion Town trusted-channel evidence is not returned");
}
if (!main.includes('naverAllSearchVerdict: confirmed ? "confirmed" : (explicitEmpty ? "absent" : "pending")')) {
  fail("Fashion Town final verdict is missing");
}
if (!main.includes('absenceConfirmed: explicitEmpty && !trustedChannelEvidence')) {
  fail("Fashion Town absence can override trusted channel evidence");
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
if (!renderer.includes('네이버 패션타운에서 상품코드 검색 결과와 공식 유통 채널이 확인되어 정품 유통 근거가 충분합니다.')) {
  fail("Fashion Town authenticity evidence wording is missing");
}
if (main.includes('"네이버 패션타운" ? await ensureNaverOfficialBrandFilter')) {
  fail("Naver Fashion Town still triggers official-brand channel filtering");
}
if (!salesFilter.includes('export const POIZON_MINIMUM_TOTAL_SALES = 30;')) {
  fail("global sales baseline is not 30");
}
if (!salesFilter.includes('if (filters.rowLevel === true || fixedTotalAnd) {')) {
  fail("fixed AND Excel preview is not filtered at row level");
}
if (!salesFilter.includes('const matchMode = fixedTotalAnd || filters.matchMode === "all" ? "all" : "any";')) {
  fail("fixed Excel preview no longer guarantees AND matching");
}
if (!salesFilter.includes('if (totalSales < threshold || localTotalSales < threshold) continue;')) {
  fail("processed workbook still allows one sales metric below the threshold");
}
if (!salesFilter.includes('matchMode: "all",')) {
  fail("processed workbook does not report AND matching");
}
console.log("Naver Fashion Town trusted-channel verdict, authenticity wording, and strict 30+ row-level AND filtering verification passed");
