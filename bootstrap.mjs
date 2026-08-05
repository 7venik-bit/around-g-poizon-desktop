import { app, ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { applyExcelColumnLayout, readExcelColumnLayout } from "./services/excel-column-layout.mjs";

const [excelColumnLayoutSource, excelColumnLayoutCss, searchServiceMenuSource, searchServiceMenuCss] = await Promise.all([
  readFile(new URL("./src/excel-column-layout.js", import.meta.url), "utf8"),
  readFile(new URL("./src/excel-column-layout.css", import.meta.url), "utf8"),
  readFile(new URL("./src/search-service-menu.js", import.meta.url), "utf8"),
  readFile(new URL("./src/search-service-menu.css", import.meta.url), "utf8"),
]);

function excelPath(input = {}) {
  const filePath = String(input?.path || "").trim();
  if (!filePath) throw new Error("파일 경로가 없습니다.");
  if (!/\.xlsx$/i.test(filePath)) throw new Error("Excel(.xlsx) 파일만 수정할 수 있습니다.");
  return filePath;
}

ipcMain.handle("excel:get-column-layout", async (_event, input = {}) => {
  try {
    const filePath = excelPath(input);
    const buffer = await readFile(filePath);
    return {
      ok: true,
      path: filePath,
      columnLayout: readExcelColumnLayout(buffer, Number(input.columnCount) || 256),
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("excel:update-column-layout", async (_event, input = {}) => {
  try {
    const filePath = excelPath(input);
    const original = await readFile(filePath);
    const updated = applyExcelColumnLayout(original, input.columnLayout || []);
    await writeFile(filePath, updated);
    return {
      ok: true,
      path: filePath,
      columnLayout: readExcelColumnLayout(updated, Number(input.columnCount) || 256),
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
});

app.on("browser-window-created", (_event, window) => {
  window.webContents.on("did-finish-load", async () => {
    const url = window.webContents.getURL();
    if (!/\/src\/index\.html(?:[?#]|$)/i.test(url)) return;
    try {
      await window.webContents.insertCSS(`${excelColumnLayoutCss}\n${searchServiceMenuCss}`);
      await window.webContents.executeJavaScript(excelColumnLayoutSource, true);
      await window.webContents.executeJavaScript(searchServiceMenuSource, true);
    } catch (error) {
      console.error("Renderer enhancement load failed", error);
    }
  });
});

await import("./main.mjs");
