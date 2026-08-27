import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const start = main.indexOf('  ipcMain.handle("excel:import-brand-source"');
const end = main.indexOf('  ipcMain.handle("excel:export"', start);
if (start < 0 || end <= start) throw new Error("POIZON Excel import handler was not found");
const handler = main.slice(start, end);

if (!handler.includes('const sheet = sourceSheet;')) throw new Error("source workbook is not registered unfiltered");
if (handler.includes('filterPoizonRowsByTotalSales(sourceSheet')) throw new Error("sales filter still runs before registration");
if (handler.includes('filtered.')) throw new Error("filtered workbook state still exists in registration handler");
if (!handler.includes('filterApplied: false')) throw new Error("manual-only filter flag is missing");
if (!handler.includes('const processedPath = filePath;')) throw new Error("automatic filtered derivative workbook is still created");
if (!handler.includes('sourceRows: sourceRowCount') || !handler.includes('filteredRows: sourceRowCount')) {
  throw new Error("registration row counts do not preserve all source rows");
}

console.log("POIZON Excel registration is unfiltered; sales filtering is manual-only");
