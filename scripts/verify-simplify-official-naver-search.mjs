import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const relay = String(await readFile(new URL("../relay/domestic-search.mjs", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const salesFilter = String(await readFile(new URL("../services/poizon-sales-filter.mjs", import.meta.url), "utf8"));
// The release must preserve the canonical Naver implementation instead of
// validating the removed single-source build patch.
if (!main.includes("articleTextCardLinks")) throw new Error("canonical visible Naver card collector is missing");
if (!main.includes("Naver, SSG and Lotte are list-only sources")) throw new Error("Naver list-only result path is missing");
if (!relay.includes("cardCollectionMissed")) throw new Error("positive channel count can still become an absence");
for (const required of ["네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛"]) {
  if (!relay.includes(required)) throw new Error(required + " canonical source is missing");
}
if (relay.includes('{ store: "네이버 패션타운", linkOnly: true')) throw new Error("legacy single Naver source was reintroduced");
if (!salesFilter.includes('export const POIZON_MINIMUM_TOTAL_SALES = 30;')) throw new Error("global sales baseline is not 30");
if (!salesFilter.includes('if (filters.rowLevel === true || fixedTotalAnd) {')) throw new Error("fixed AND Excel preview is not filtered at row level");
console.log("canonical Naver card-list route and strict 30+ row-level AND filtering verified");
process.exit(0);
const fail = (message) => { throw new Error(`simplified official/Naver search verification failed: ${message}`); };

if (!main.includes('if (chinaRecentSales < 30 || localRecentSales < 30) return [];')) fail("low-selling size rows can still enter domestic search");
if (!main.includes('sanitizeDomesticQuery([title, articleNumber].filter(Boolean).join(" "))')) fail("official mall does not use product name plus product code only");
if (!relay.includes('{ store: "네이버 패션타운", linkOnly: true, fashionTown: "brand-store", renderCount: true }')) fail("single Naver Fashion Town source is missing");
const sourceBlock = relay.match(/const sources = \[[\s\S]*?\n  \];/)?.[0] || "";
if (!sourceBlock) fail("domestic source list was not found");
for (const removed of ["네이버 공식 브랜드스토어", "네이버 백화점", "네이버 아울렛"]) if (sourceBlock.includes(`store: "${removed}"`)) fail(`${removed} is still searched as a separate source`);
if (main.includes('directNaverFashionTownSource')) fail("Fashion Town still bypasses the visible Naver click route");
if (!main.includes('const initialUrl = naverPortalSource ? "https://www.naver.com/" : url;')) fail("Fashion Town does not start from Naver main");
if (!main.includes('const shoppingHomeOpened = await clickNaverShoppingHomeMenu(searchWindow);')) fail("Shopping button click is missing");
if (!main.includes('const fashionTownOpened = await clickNaverFashionTownMenu(searchWindow);')) fail("Fashion Town button click is missing");
if (!main.includes('? await submitNaverShoppingSearch(searchWindow, searchQuery)')) fail("Fashion Town product-code submission is missing");
const interactiveStart = main.indexOf('      if (interactiveSiteSearch) {');
const interactiveEnd = main.indexOf('    if (naverPortalSource && String(source.store || "") !== "네이버 패션타운") {', interactiveStart);
const interactiveBlock = interactiveStart >= 0 && interactiveEnd > interactiveStart
  ? main.slice(interactiveStart, interactiveEnd) : "";
if (!interactiveBlock.includes('if (naverPortalSource) {')) fail("Fashion Town click route is disabled by the channel-count gate");
if (interactiveBlock.includes('naverPortalSource && String(source.store || "") !== "네이버 패션타운"')) fail("Fashion Town still skips Shopping/Fashion Town clicks");
if (!relay.includes('https://shopping.naver.com/window/search/fashion-group?q=')) fail("Fashion Town search URL is not shopping.naver.com/window/search/fashion-group");
if (!main.includes('// The three Fashion Town totals are the authoritative routing decision.')) fail("Naver channel-count block is missing");
if (!main.includes('if (naverPortalSource && String(source.store || "") !== "네이버 패션타운") {\n      // The three Fashion Town totals')) fail("only the Naver channel-count block should be gated");
if (!main.includes('const trustedChannelEvidence = /브랜드직영몰')) fail("Fashion Town trusted-channel evidence is missing");
if (!main.includes('naverTrustedChannelEvidence: trustedChannelEvidence')) fail("Fashion Town trusted-channel evidence is not returned");
if (!main.includes('naverAllSearchVerdict: confirmed ? "confirmed" : (explicitEmpty ? "absent" : "pending")')) fail("Fashion Town final verdict is missing");
if (!main.includes('absenceConfirmed: explicitEmpty && !trustedChannelEvidence')) fail("Fashion Town absence can override trusted channel evidence");
if (!main.includes('detailVerificationPending: false')) fail("Fashion Town still requires detail verification after total search");
if (!main.includes('검색된\\s*상품이\\s*없습니다')) fail("Fashion Town explicit no-result text is not recognized");
if (!renderer.includes('return { label: "확인완료", className: "available" };')) fail("Fashion Town success label is not 확인완료");
if (!renderer.includes('return { label: "상품없음", className: "missing" };')) fail("Fashion Town absence label is not 상품없음");
if (main.includes('"네이버 패션타운" ? await ensureNaverOfficialBrandFilter')) fail("Naver Fashion Town still triggers official-brand channel filtering");
if (!salesFilter.includes('export const POIZON_MINIMUM_TOTAL_SALES = 30;')) fail("global sales baseline is not 30");
if (!salesFilter.includes('if (filters.rowLevel === true || fixedTotalAnd) {')) fail("fixed AND Excel preview is not filtered at row level");
if (!salesFilter.includes('const matchMode = fixedTotalAnd || filters.matchMode === "all" ? "all" : "any";')) fail("fixed Excel preview no longer guarantees AND matching");
if (!salesFilter.includes('if (totalSales < threshold || localTotalSales < threshold) continue;')) fail("processed workbook still allows one sales metric below the threshold");
if (!salesFilter.includes('matchMode: "all",')) fail("processed workbook does not report AND matching");
console.log("Naver Fashion Town visible click route, result verdict, and strict 30+ row-level AND filtering verified");
