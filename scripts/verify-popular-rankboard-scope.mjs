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
const strictCaptureMarkers = [
  'const captureCompleteness = popularCompleteness([...rankSlots.values()], limit);',
  'const finalCompleteness = popularCompleteness([...preservedSlots.values()], limit);',
  'code: "POPULAR_CAPTURE_INCOMPLETE"',
  'message: `1~${limit}위 완전 수집 확인 · 상품 ${preservedSlots.size}개 · 누락 0개`',
];
for (const marker of strictCaptureMarkers) {
  if (!main.includes(marker)) fail(`strict completeness marker missing: ${marker}`);
}
if (main.includes('source: "seller-center-missing-slot"')) fail("missing rank placeholder remains");
if (main.includes("video-confirmed popular ranking table")) fail("video scope rewrite still applied");
if (main.includes("POIZON 인기상품 표는 가상 스크롤")) fail("new full-scroll rewrite still applied");

console.log("merchantRankBoard capture plus strict 1~200 completeness verification passed");
