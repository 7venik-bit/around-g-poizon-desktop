import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`known-good popular list verification failed: ${message}`); };

if (!main.includes('const SELLER_CENTER_URL = "https://seller.poizon.com/main/dataCenter/merchantRankBoard";')) fail("direct merchantRankBoard route missing");
if (!main.includes('String(element.innerText || element.textContent || "").trim() === "인기상품"')) fail("popular heading detector missing");
if (!main.includes('const hasTableHeaders = text.includes("SPU 기준")')) fail("original popular table detector missing");
if (!main.includes('text.includes("SKU 기준")')) fail("original SKU detector missing");
if (!main.includes('text.includes("상품정보")')) fail("original product-info detector missing");
if (!main.includes("const SELLER_SCROLL_SCRIPT")) fail("original scroll script missing");
if (!main.includes("const SELLER_ROW_SCROLL_SCRIPT")) fail("original row-scroll script missing");
if (!main.includes("AI 기준 누락 순위 표적 재수집")) fail("targeted missing-rank recovery missing");
if (!main.includes("const missingRanks = Array.from({ length: limit }, (_, index) => index + 1).filter((rank) => !rankSlots.has(rank));")) fail("missing rank calculation missing");
if (!main.includes("sellerJumpScript(Math.max(1, rank - 3), limit)")) fail("targeted jump recovery missing");
if (!main.includes("percent: rankSlots.size >= limit ? 100 : 99")) fail("100 percent completion is not gated by all 200 ranks");
if (!main.includes("200/200 수집 완료")) fail("complete 200/200 message missing");
if (!main.includes("누락 순위 재수집 필요")) fail("incomplete recovery message missing");
if (main.includes("video-confirmed popular ranking table")) fail("video scope rewrite still applied");
if (main.includes("POIZON 인기상품 표는 가상 스크롤")) fail("new full-scroll rewrite still applied");

console.log("merchantRankBoard capture plus targeted missing-rank recovery verification passed");
