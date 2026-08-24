import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
const preloadPath = new URL("../preload.cjs", import.meta.url);

async function patchMain() {
  let source = await readFile(mainPath, "utf8");
  if (!source.includes("function readMusinsaPayPassword()")) {
    const anchor = "app.whenReady().then(async () => {";
    if (!source.includes(anchor)) throw new Error("main.mjs app.whenReady anchor not found");
    const helper = `function musinsaPayPasswordStatus() {\n  const encryptedValue = String(store?.snapshot?.().settings?.musinsaPayPasswordEncrypted || \"\");\n  return { configured: Boolean(encryptedValue), encryptionAvailable: safeStorage.isEncryptionAvailable() };\n}\n\nfunction readMusinsaPayPassword() {\n  const encryptedValue = String(store?.snapshot?.().settings?.musinsaPayPasswordEncrypted || \"\");\n  if (!encryptedValue) return \"\";\n  if (!safeStorage.isEncryptionAvailable()) throw new Error(\"WINDOWS_SECURE_STORAGE_UNAVAILABLE\");\n  return safeStorage.decryptString(Buffer.from(encryptedValue, \"base64\"));\n}\n\nasync function saveMusinsaPayPassword(value) {\n  const password = String(value || \"\").trim();\n  if (!password) throw new Error(\"MUSINSA_PAY_PASSWORD_REQUIRED\");\n  if (password.length > 64) throw new Error(\"MUSINSA_PAY_PASSWORD_TOO_LONG\");\n  if (!safeStorage.isEncryptionAvailable()) throw new Error(\"WINDOWS_SECURE_STORAGE_UNAVAILABLE\");\n  await store.setSettings({ musinsaPayPasswordEncrypted: safeStorage.encryptString(password).toString(\"base64\") });\n  return musinsaPayPasswordStatus();\n}\n\nasync function clearMusinsaPayPassword() {\n  await store.setSettings({ musinsaPayPasswordEncrypted: \"\" });\n  return musinsaPayPasswordStatus();\n}\n\n`;
    source = source.replace(anchor, helper + anchor);
  }
  if (!source.includes('ipcMain.handle("musinsa-pay:status"')) {
    const anchor = '  ipcMain.handle("domestic-login:clear", (_event, sourceId) => clearDomesticLogin(sourceId));';
    if (!source.includes(anchor)) throw new Error("main.mjs domestic-login handler anchor not found");
    source = source.replace(anchor, `${anchor}\n  ipcMain.handle(\"musinsa-pay:status\", () => musinsaPayPasswordStatus());\n  ipcMain.handle(\"musinsa-pay:save-password\", async (_event, password) => {\n    try { return { ok: true, ...(await saveMusinsaPayPassword(password)) }; }\n    catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }\n  });\n  ipcMain.handle(\"musinsa-pay:clear-password\", async () => ({ ok: true, ...(await clearMusinsaPayPassword()) }));`);
  }
  await writeFile(mainPath, source, "utf8");
}

async function patchPreload() {
  let source = await readFile(preloadPath, "utf8");
  if (!source.includes("getMusinsaPayStatus:")) {
    const anchor = '  clearDomesticLogin: (sourceId) => ipcRenderer.invoke("domestic-login:clear", sourceId),';
    if (!source.includes(anchor)) throw new Error("preload domestic login anchor not found");
    source = source.replace(anchor, `${anchor}\n  getMusinsaPayStatus: () => ipcRenderer.invoke(\"musinsa-pay:status\"),\n  saveMusinsaPayPassword: (password) => ipcRenderer.invoke(\"musinsa-pay:save-password\", password),\n  clearMusinsaPayPassword: () => ipcRenderer.invoke(\"musinsa-pay:clear-password\"),`);
  }
  if (!source.includes("data-musinsa-pay-settings")) {
    const anchor = 'window.addEventListener("DOMContentLoaded", () => {';
    if (!source.includes(anchor)) throw new Error("preload DOMContentLoaded anchor not found");
    source = source.replace(anchor, `${anchor}\n  if (!document.querySelector('script[data-musinsa-pay-settings=\"true\"]')) {\n    const paymentScript = document.createElement(\"script\");\n    paymentScript.src = \"./musinsa-pay-settings.js\";\n    paymentScript.dataset.musinsaPaySettings = \"true\";\n    document.head.appendChild(paymentScript);\n  }`);
  }
  await writeFile(preloadPath, source, "utf8");
}

await patchMain();
await patchPreload();
console.log("Musinsa Pay secure password storage patch applied.");
