import { ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { applyExcelColumnLayout, readExcelColumnLayout } from "./services/excel-column-layout.mjs";

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

await import("./main.mjs");
