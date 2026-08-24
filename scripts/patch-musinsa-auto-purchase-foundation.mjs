import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
const preloadPath = new URL("../preload.cjs", import.meta.url);

let main = await readFile(mainPath, "utf8");
let preload = await readFile(preloadPath, "utf8");

const marker = '  ipcMain.handle("domestic-login:list", () => domesticLoginStatuses());';
const handlers = `  ipcMain.handle("musinsa-pay:status", () => {\n    const settings = store.snapshot().settings || {};\n    return { registered: Boolean(settings.musinsaPayPasswordEncrypted), autoPurchaseEnabled: settings.musinsaAutoPurchaseEnabled === true };\n  });\n  ipcMain.handle("musinsa-pay:save", async (_event, input = {}) => {\n    const password = String(input.password || "");\n    if (!password) return { ok: false, message: "결제 비밀번호를 입력해 주세요." };\n    if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: "Windows 보안 저장소를 사용할 수 없습니다." };\n    await store.setSettings({ musinsaPayPasswordEncrypted: safeStorage.encryptString(password).toString("base64") });\n    return { ok: true, registered: true };\n  });\n  ipcMain.handle("musinsa-pay:remove", async () => {\n    await store.setSettings({ musinsaPayPasswordEncrypted: "", musinsaAutoPurchaseEnabled: false });\n    return { ok: true, registered: false };\n  });\n  ipcMain.handle("musinsa-auto-purchase:set-enabled", async (_event, enabled) => {\n    const settings = store.snapshot().settings || {};\n    if (enabled && !settings.musinsaPayPasswordEncrypted) return { ok: false, message: "먼저 무신사페이 결제 비밀번호를 등록해 주세요." };\n    await store.setSettings({ musinsaAutoPurchaseEnabled: enabled === true });\n    return { ok: true, enabled: enabled === true };\n  });\n  ipcMain.handle("musinsa-auto-purchase:validate", (_event, order = {}) => {\n    const settings = store.snapshot().settings || {};\n    const articleNumber = String(order.articleNumber || "").trim();\n    const size = String(order.size || "").trim();\n    const quantity = Math.max(1, Number(order.quantity || 1));\n    const maxPrice = Number(order.maxPrice || 0);\n    const currentPrice = Number(order.currentPrice || 0);\n    const valid = Boolean(settings.musinsaAutoPurchaseEnabled && settings.musinsaPayPasswordEncrypted && articleNumber && size && quantity === 1 && maxPrice > 0 && currentPrice > 0 && currentPrice <= maxPrice);\n    return { ok: valid, articleNumber, size, quantity, maxPrice, currentPrice, reason: valid ? "ready" : "conditions_not_met" };\n  });\n`;
if (!main.includes('ipcMain.handle("musinsa-pay:status"')) {
  if (!main.includes(marker)) throw new Error("main IPC marker not found");
  main = main.replace(marker, handlers + marker);
}

const preloadMarker = '  listDomesticLogins: () => ipcRenderer.invoke("domestic-login:list"),';
const preloadApi = `  getMusinsaPayStatus: () => ipcRenderer.invoke("musinsa-pay:status"),\n  saveMusinsaPayPassword: (password) => ipcRenderer.invoke("musinsa-pay:save", { password }),\n  removeMusinsaPayPassword: () => ipcRenderer.invoke("musinsa-pay:remove"),\n  setMusinsaAutoPurchaseEnabled: (enabled) => ipcRenderer.invoke("musinsa-auto-purchase:set-enabled", enabled),\n  validateMusinsaAutoPurchase: (order) => ipcRenderer.invoke("musinsa-auto-purchase:validate", order),\n`;
if (!preload.includes('getMusinsaPayStatus:')) {
  if (!preload.includes(preloadMarker)) throw new Error("preload API marker not found");
  preload = preload.replace(preloadMarker, preloadApi + preloadMarker);
}

await writeFile(mainPath, main, "utf8");
await writeFile(preloadPath, preload, "utf8");
console.log("Musinsa Pay secure storage and guarded auto-purchase foundation applied.");
