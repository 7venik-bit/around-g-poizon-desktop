import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const popularRuntime = await readFile(new URL("../services/popular-table-runtime.mjs", import.meta.url), "utf8");
const fail = (message) => { throw new Error(`known-good popular list verification failed: ${message}`); };

if (!main.includes('const SELLER_CENTER_URL = "https://seller.poizon.com/main/dataCenter/merchantRankBoard";')) fail("direct merchantRankBoard route missing");
if (!popularRuntime.includes('textOf(element).trim() === "인기상품"')) fail("popular heading detector missing");
if (!popularRuntime.includes('const hasTableHeaders = text.includes("SPU 기준")')) fail("original popular table detector missing");
if (!popularRuntime.includes('text.includes("SKU 기준")')) fail("original SKU detector missing");
if (!popularRuntime.includes('text.includes("상품정보")')) fail("original product-info detector missing");
if (!main.includes("const SELLER_SCROLL_SCRIPT")) fail("original scroll script missing");
if (!main.includes("const SELLER_ROW_SCROLL_SCRIPT")) fail("original row-scroll script missing");
const captureMarkers = [
  'const captureCompleteness = popularCompleteness([...rankSlots.values()], limit);',
  'const finalCompleteness = popularCompleteness([...preservedSlots.values()], limit);',
  'products = createPopularSlots([...preservedSlots.values()], limit);',
  'partial: !finalCompleteness.complete',
];
for (const marker of captureMarkers) {
  if (!main.includes(marker)) fail(`partial persistence marker missing: ${marker}`);
}
if (main.includes('code: "POPULAR_CAPTURE_INCOMPLETE"')) fail("incomplete capture still discards confirmed products");
if (main.includes('source: "seller-center-missing-slot"')) fail("missing rank placeholder remains");
if (main.includes("video-confirmed popular ranking table")) fail("video scope rewrite still applied");
if (main.includes("POIZON 인기상품 표는 가상 스크롤")) fail("new full-scroll rewrite still applied");

console.log("merchantRankBoard capture plus missing-rank partial persistence verification passed");
