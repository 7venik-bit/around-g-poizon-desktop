import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import readXlsxFile from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import pkg from "electron-updater";
import { JsonStore } from "./services/store.mjs";
import { queryPoizon } from "./services/poizon.mjs";
import { queryDomesticProducts } from "./relay/domestic-search.mjs";

let store;
const { autoUpdater } = pkg;
let mainWindow;

function sendUpdateStatus(status, message, extra = {}) {
  mainWindow?.webContents.send("update:status", { status, message, ...extra });
}

function configureUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking", "새 버전을 확인하고 있습니다."));
  autoUpdater.on("update-available", (info) => sendUpdateStatus("available", `새 버전 ${info.version}을 다운로드할 수 있습니다.`, { version: info.version }));
  autoUpdater.on("update-not-available", () => sendUpdateStatus("current", "현재 최신 버전입니다."));
  autoUpdater.on("download-progress", (info) => sendUpdateStatus("downloading", `업데이트 다운로드 ${Math.round(info.percent)}%`, { percent: info.percent }));
  autoUpdater.on("update-downloaded", (info) => sendUpdateStatus("downloaded", `버전 ${info.version} 다운로드가 완료되었습니다.`, { version: info.version }));
  autoUpdater.on("error", (error) => sendUpdateStatus("error", `업데이트 확인 실패: ${error.message}`));
}

function encrypted(value) {
  if (!value) return "";
  if (!safeStorage.isEncryptionAvailable()) throw new Error("WINDOWS_ENCRYPTION_UNAVAILABLE");
  return safeStorage.encryptString(value).toString("base64");
}

function decrypted(value) {
  if (!value) return "";
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

function publicConfig() {
  const settings = store.snapshot().settings;
  return {
    appKey: settings.appKey || "",
    apiBaseUrl: settings.apiBaseUrl || "https://open.poizon.com",
    hasAppSecret: Boolean(settings.appSecretEncrypted),
    hasAccessToken: Boolean(settings.accessTokenEncrypted)
  };
}

function secretConfig() {
  const settings = store.snapshot().settings;
  return {
    appKey: settings.appKey || "",
    appSecret: decrypted(settings.appSecretEncrypted),
    accessToken: decrypted(settings.accessTokenEncrypted),
    apiBaseUrl: settings.apiBaseUrl || "https://open.poizon.com"
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: "#f4f1ea",
    title: "Around G POIZON",
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = win;
  win.loadFile(join(import.meta.dirname, "src", "index.html"));
}

app.whenReady().then(async () => {
  store = new JsonStore(app.getPath("userData"));
  await store.load();

  ipcMain.handle("store:snapshot", () => store.snapshot());
  ipcMain.handle("store:upsert", (_event, collection, item) => store.upsert(collection, item));
  ipcMain.handle("store:remove", (_event, collection, id) => store.remove(collection, id));
  ipcMain.handle("collector:check", (_event, input) => store.updateCollector(input));
  ipcMain.handle("update:check", async () => {
    if (!app.isPackaged) return { ok: false, message: "개발 모드에서는 업데이트를 확인하지 않습니다." };
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.updateInfo?.version) return { ok: true, version: result.updateInfo.version };
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("update:install", async () => {
    try {
      if (!autoUpdater.updateInfoAndProvider) {
        const result = await autoUpdater.checkForUpdates();
        if (!result?.isUpdateAvailable) return { ok: false, message: "설치할 새 버전이 없습니다." };
      }
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("config:get", () => publicConfig());
  ipcMain.handle("config:save", async (_event, config) => {
    const next = {
      appKey: String(config.appKey || "").trim(),
      apiBaseUrl: String(config.apiBaseUrl || "https://open.poizon.com").trim()
    };
    if (config.appSecret) next.appSecretEncrypted = encrypted(config.appSecret);
    if (config.accessToken) next.accessTokenEncrypted = encrypted(config.accessToken);
    await store.setSettings(next);
    return publicConfig();
  });
  ipcMain.handle("poizon:query", (_event, input) => queryPoizon(secretConfig(), input));
  ipcMain.handle("domestic:query", (_event, input) => queryDomesticProducts(input));
  ipcMain.handle("external:open", async (_event, url) => {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("INVALID_URL");
    await shell.openExternal(parsed.href);
  });
  ipcMain.handle("excel:import", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Excel", extensions: ["xlsx"] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const sheet = await readXlsxFile(await readFile(filePath));
    const headers = (sheet[0] || []).map((value) => String(value || "").trim());
    const rows = sheet.slice(1).map((values) => Object.fromEntries(
      headers.flatMap((header, index) => header ? [[header, values[index] ?? ""]] : [])
    ));
    let imported = 0;
    for (const row of rows) {
      const articleNumber = String(row["상품번호"] || row.articleNumber || row["품번"] || "").trim();
      const name = String(row["상품명"] || row.name || "").trim();
      if (!articleNumber && !name) continue;
      await store.upsert("products", {
        articleNumber,
        name,
        brand: String(row["브랜드"] || row.brand || ""),
        spuId: String(row["SPU ID"] || row.spuId || ""),
        poizonPrice: Number(row["POIZON 가격"] || row.poizonPrice || 0),
        domesticPrice: Number(row["국내 가격"] || row.domesticPrice || 0),
        source: "excel"
      });
      imported += 1;
    }
    return { canceled: false, imported };
  });
  ipcMain.handle("excel:export", async () => {
    const result = await dialog.showSaveDialog({ defaultPath: `Around-G-${new Date().toISOString().slice(0, 10)}.xlsx`, filters: [{ name: "Excel", extensions: ["xlsx"] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const data = store.snapshot();
    const sheets = [];
    for (const [name, rows] of [["상품", data.products], ["장부", data.ledger], ["주문", data.orders], ["관심상품", data.favorites]]) {
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const cells = [
        columns.map((value) => ({ value, fontWeight: "bold", backgroundColor: "#EAE4D8" })),
        ...rows.map((row) => columns.map((key) => {
          const raw = row[key];
          const value = raw instanceof Date || ["string", "number", "boolean"].includes(typeof raw)
            ? raw
            : raw === null || raw === undefined ? null : JSON.stringify(raw);
          return { value };
        })),
      ];
      sheets.push({
        data: cells,
        sheet: name,
        stickyRowsCount: 1,
        columns: columns.map((key) => ({ width: Math.max(12, Math.min(36, key.length + 4)) })),
      });
    }
    await writeXlsxFile(sheets).toFile(result.filePath);
    return { canceled: false, path: result.filePath };
  });

  configureUpdater();
  createWindow();
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
