import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`known-good popular capture verification failed: ${message}`); };

if (!main.includes('const SELLER_CENTER_URL = "https://seller.poizon.com/main/dataCenter/merchantRankBoard";')) fail("historical direct rank-board route missing");
if (!main.includes("const SELLER_CAPTURE_SCRIPT")) fail("seller capture script missing");
if (!main.includes("const SELLER_SCROLL_SCRIPT")) fail("seller scroll script missing");
if (!main.includes("const SELLER_ROW_SCROLL_SCRIPT")) fail("seller row-scroll script missing");
if (!main.includes('const hasTableHeaders = text.includes("SPU 기준")')) fail("historical table scope missing");
if (main.includes("video-confirmed popular ranking table")) fail("video table rewrite remains");

const strictCaptureMarkers = [
  'code: "POPULAR_CAPTURE_INCOMPLETE"',
  'const captureCompleteness = popularCompleteness([...rankSlots.values()], limit);',
  'const finalCompleteness = popularCompleteness([...preservedSlots.values()], limit);',
  'message: `1~${limit}위 완전 수집 확인 · 상품 ${preservedSlots.size}개 · 누락 0개`',
];
for (const marker of strictCaptureMarkers) {
  if (!main.includes(marker)) fail(`strict completeness marker missing: ${marker}`);
}
if (main.includes('source: "seller-center-missing-slot"')) fail("missing rank placeholder remains");

console.log("popular list capture requires verified 1~200 ranks with no placeholders");
