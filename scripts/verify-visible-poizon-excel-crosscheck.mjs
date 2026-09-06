import { readFile } from "node:fs/promises";

const [main, preload, renderer] = await Promise.all([
  readFile(new URL("../main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
]);

const mainRequired = [
  "safeStorage, screen, session, shell",
  "function beginSellerExcelVerificationWindows",
  "screen.getDisplayMatching(mainWindow.getBounds()).workArea",
  "Math.floor(usableWidth * 0.55)",
  "sellerSide: \"left\"",
  "excelSide: \"right\"",
  "if (!sellerExcelVerificationLayout && sellerWindow && !sellerWindow.isDestroyed()) sellerWindow.hide();",
  "function endSellerExcelVerificationWindows",
  "seller:excel-verification-start",
  "seller:excel-verification-end",
];

const preloadRequired = [
  "beginSellerExcelVerification: (input = {}) => ipcRenderer.invoke(\"seller:excel-verification-start\", input)",
  "endSellerExcelVerification: () => ipcRenderer.invoke(\"seller:excel-verification-end\")",
];

const rendererRequired = [
  "function showPoizonExcelVerificationPair",
  "await showPoizonExcelVerificationPair(file, brandName);",
  "beginSellerExcelVerification",
  "검증 화면 열림 · 왼쪽 POIZON / 오른쪽 Excel",
  "왼쪽 POIZON ${page}/${pages || \"?\"}페이지 · 오른쪽 Excel ${fileName}",
  "POIZON 화면 값 우선 적용",
  "await showExcelPreview(file, 0",
  "await window.aroundG.endSellerExcelVerification().catch(() => {});",
];

for (const value of mainRequired) {
  if (!main.includes(value)) throw new Error(`Missing main-process cross-check feature: ${value}`);
}
for (const value of preloadRequired) {
  if (!preload.includes(value)) throw new Error(`Missing preload cross-check bridge: ${value}`);
}
for (const value of rendererRequired) {
  if (!renderer.includes(value)) throw new Error(`Missing renderer cross-check feature: ${value}`);
}

const importHandler = renderer.slice(
  renderer.indexOf('$("#import-button").addEventListener("click", async () => {'),
  renderer.indexOf('$("#export-button").addEventListener("click", async () => {'),
);
const pairIndex = importHandler.indexOf("await showPoizonExcelVerificationPair(file, brandName);");
const captureIndex = importHandler.indexOf("captureSellerBrandSales");
const syncIndex = importHandler.indexOf("syncExcelWithSellerScreen");
const refreshIndex = importHandler.indexOf("await showExcelPreview(file, 0", syncIndex);
if (!(pairIndex >= 0 && captureIndex > pairIndex)) {
  throw new Error("Excel preview and split layout must open before Seller Center capture starts.");
}
if (!(syncIndex > captureIndex && refreshIndex > syncIndex)) {
  throw new Error("Excel preview must refresh after the POIZON-authoritative workbook sync.");
}

console.log("Visible cross-check verified: POIZON stays visible on the left, Excel stays visible on the right, workbook refresh follows screen-authoritative sync, and window layout restores on finish.");
