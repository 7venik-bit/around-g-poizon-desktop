import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
const preloadPath = new URL("../preload.cjs", import.meta.url);

let main = await readFile(mainPath, "utf8");
let preload = await readFile(preloadPath, "utf8");

const marker = '  ipcMain.handle("domestic-login:list", () => domesticLoginStatuses());';
if (!main.includes(marker)) throw new Error("main IPC marker not found");

const missingMainHandlers = [];
if (!main.includes('ipcMain.handle("musinsa-auto-purchase:set-enabled"')) {
  missingMainHandlers.push(`  ipcMain.handle("musinsa-auto-purchase:set-enabled", async (_event, enabled) => {\n    const settings = store.snapshot().settings || {};\n    if (enabled && !settings.musinsaPayPasswordEncrypted) return { ok: false, message: "먼저 무신사페이 결제 비밀번호를 등록해 주세요." };\n    await store.setSettings({ musinsaAutoPurchaseEnabled: enabled === true });\n    return { ok: true, enabled: enabled === true };\n  });\n`);
}
if (!main.includes('ipcMain.handle("musinsa-auto-purchase:validate"')) {
  missingMainHandlers.push(`  ipcMain.handle("musinsa-auto-purchase:validate", (_event, order = {}) => {\n    const settings = store.snapshot().settings || {};\n    const articleNumber = String(order.articleNumber || "").trim();\n    const size = String(order.size || "").trim();\n    const quantity = Math.max(1, Number(order.quantity || 1));\n    const maxPrice = Number(order.maxPrice || 0);\n    const currentPrice = Number(order.currentPrice || 0);\n    const valid = Boolean(settings.musinsaAutoPurchaseEnabled && settings.musinsaPayPasswordEncrypted && articleNumber && size && quantity === 1 && maxPrice > 0 && currentPrice > 0 && currentPrice <= maxPrice);\n    return { ok: valid, articleNumber, size, quantity, maxPrice, currentPrice, reason: valid ? "ready" : "conditions_not_met" };\n  });\n`);
}
if (missingMainHandlers.length) main = main.replace(marker, missingMainHandlers.join("") + marker);

const preloadMarker = '  listDomesticLogins: () => ipcRenderer.invoke("domestic-login:list"),';
if (!preload.includes(preloadMarker)) throw new Error("preload API marker not found");
const missingPreloadApis = [];
if (!preload.includes('setMusinsaAutoPurchaseEnabled:')) {
  missingPreloadApis.push('  setMusinsaAutoPurchaseEnabled: (enabled) => ipcRenderer.invoke("musinsa-auto-purchase:set-enabled", enabled),\n');
}
if (!preload.includes('validateMusinsaAutoPurchase:')) {
  missingPreloadApis.push('  validateMusinsaAutoPurchase: (order) => ipcRenderer.invoke("musinsa-auto-purchase:validate", order),\n');
}
if (missingPreloadApis.length) preload = preload.replace(preloadMarker, missingPreloadApis.join("") + preloadMarker);

await writeFile(mainPath, main, "utf8");
await writeFile(preloadPath, preload, "utf8");
console.log("Guarded Musinsa auto-purchase foundation applied without duplicating secure-pay handlers.");
