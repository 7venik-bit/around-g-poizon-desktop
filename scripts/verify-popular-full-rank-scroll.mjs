import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`known-good popular capture verification failed: ${message}`); };

if (!main.includes('const SELLER_CENTER_URL = "https://seller.poizon.com/main/dataCenter/merchantRankBoard";')) fail("historical direct rank-board route missing");
if (!main.includes("const SELLER_CAPTURE_SCRIPT")) fail("seller capture script missing");
if (!main.includes("const SELLER_SCROLL_SCRIPT")) fail("seller scroll script missing");
if (!main.includes("const SELLER_ROW_SCROLL_SCRIPT")) fail("seller row-scroll script missing");
if (!main.includes('const hasTableHeaders = text.includes("SPU 기준")')) fail("historical table scope missing");
if (main.includes("video-confirmed popular ranking table")) fail("video table rewrite remains");
if (main.includes("POIZON 인기상품 표는 가상 스크롤")) fail("custom full-scroll rewrite remains");

console.log("historically working popular list capture preserved without rewrite");
