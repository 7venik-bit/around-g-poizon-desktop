import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const bootstrap = String(await readFile(new URL("../bootstrap.mjs", import.meta.url), "utf8"));
const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));

const fail = (message) => { throw new Error(`domestic product-search verification failed: ${message}`); };

if (main.includes("          await openRenderedSizeOptions(searchWindow);")) fail("automatic size-option interaction is still enabled");
if (!main.includes('stockStatus: "manual_check"')) fail("manual inventory state is missing");
if (!main.includes("재고·사이즈 자동 확인 안 함")) fail("manual inventory policy marker is missing");
if (!bootstrap.includes('readFile(new URL("./src/sourcing-view.js", import.meta.url), "utf8")')) fail("sourcing view is not loaded by bootstrap");
if (!bootstrap.includes("executeJavaScript(sourcingViewSource, true)")) fail("sourcing view is not executed after renderer load");
if (!sourcing.includes("sourcing-price-comparison")) fail("domestic price-comparison renderer is missing");
if (!sourcing.includes("sourcing-price-row")) fail("retailer price rows are missing");
if (!sourcing.includes("재고는 판매처에서 직접 확인하세요")) fail("manual inventory guidance is missing");
if (!sourcing.includes("<th>POIZON 기준가</th>")) fail("POIZON reference-price column label is missing");
if (!sourcing.includes("<th>국내 상품</th>")) fail("domestic product column label is missing");
if (sourcing.includes("sourcing-stock")) fail("legacy stock-status button styling remains");
if (sourcing.includes("국내 상품 재고 검색")) fail("legacy stock-search wording remains in sourcing UI");

console.log("domestic product-only search verified: price comparison enabled and inventory automation hidden");
