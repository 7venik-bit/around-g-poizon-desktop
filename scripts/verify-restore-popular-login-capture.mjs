import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const index = String(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
const renderer = String(await readFile(new URL("../src/renderer.js", import.meta.url), "utf8"));
const preload = String(await readFile(new URL("../preload.cjs", import.meta.url), "utf8"));

const fail = (message) => { throw new Error(`popular restore verification failed: ${message}`); };

if (!index.includes('data-explorer="popular"')) fail("popular-list navigation button missing");
if (!index.includes('id="explorer-popular" class="panel explorer-panel">')) fail("popular-list panel is still permanently hidden");
if (!index.includes('id="popular-capture"')) fail("popular capture button missing");
if (!renderer.includes('async function capturePopularProducts(options = {})')) fail("popular capture workflow missing from renderer");
if (!renderer.includes('window.aroundG.captureSellerCenter()')) fail("renderer no longer invokes seller capture");
if (!renderer.includes('window.aroundG.stagePopularProductsInExcel(result.products)')) fail("captured popular products are not staged to Excel");
if (!renderer.includes('$("#popular-capture").addEventListener("click"')) fail("popular capture button is not wired");
if (!preload.includes('captureSellerCenter: () => ipcRenderer.invoke("seller:capture")')) fail("seller capture IPC bridge missing");
if (!preload.includes('stagePopularProductsInExcel: (products) => ipcRenderer.invoke("excel:stage-popular-products", products)')) fail("popular Excel staging IPC bridge missing");
if (!main.includes('ipcMain.handle("seller:capture", () => captureSellerCenterProducts())')) fail("seller capture IPC handler missing");
if (!main.includes('ipcMain.handle("excel:stage-popular-products"')) fail("popular Excel staging handler missing");
if (!main.includes('const automaticLogin = await submitStoredSellerCredentials();')) fail("stored-account auto login is not used by popular capture");
if (!main.includes('https://seller.poizon.com/main/dataCenter/merchantRankBoard')) fail("popular rank-board destination missing");
if (!main.includes('parsePopularProducts')) fail("popular-product parser missing");
if (!main.includes('SELLER_CAPTURE_SCRIPT')) fail("popular table capture script missing");

console.log("popular list auto login, rank-board capture, parsing, Excel staging, and UI wiring verification passed");
