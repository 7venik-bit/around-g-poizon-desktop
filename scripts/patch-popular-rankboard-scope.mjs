import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let main = String(await readFile(mainPath, "utf8")).replace(/\r\n/g, "\n");

const homeRoute = 'const SELLER_CENTER_URL = "https://seller.poizon.com/";';
const rankRoute = 'const SELLER_CENTER_URL = "https://seller.poizon.com/main/dataCenter/merchantRankBoard";';
if (main.includes(homeRoute)) main = main.replace(homeRoute, rankRoute);
if (!main.includes(rankRoute)) throw new Error("known-good popular list route restore failed");

// Restore the previously stable capture path. The repository source already
// contains the original SELLER_CAPTURE_SCRIPT / SELLER_SCROLL_SCRIPT /
// SELLER_ROW_SCROLL_SCRIPT logic. Do not rewrite the table scope at build time.
if (!main.includes('String(element.innerText || element.textContent || "").trim() === "인기상품"')) {
  throw new Error("known-good popular heading detector missing");
}
if (!main.includes('const hasTableHeaders = text.includes("SPU 기준")')) {
  throw new Error("known-good popular table detector missing");
}
if (main.includes("video-confirmed popular ranking table") || main.includes("POIZON 인기상품 표는 가상 스크롤")) {
  throw new Error("new popular-list scope rewrite is still present");
}

await writeFile(mainPath, main, "utf8");
console.log("popular list restored to known-good merchantRankBoard capture path");
