import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
let main = String(await readFile(mainPath, "utf8")).replace(/\r\n/g, "\n");

const handlerStart = main.indexOf('  ipcMain.handle("excel:import-brand-source"');
const handlerEnd = main.indexOf('  ipcMain.handle("excel:export"', handlerStart);
if (handlerStart < 0 || handlerEnd <= handlerStart) {
  throw new Error("POIZON Excel import handler was not found");
}

let handler = main.slice(handlerStart, handlerEnd);

const prefilterStart = handler.indexOf('    const filtered = filterPoizonRowsByTotalSales(sourceSheet, POIZON_MINIMUM_TOTAL_SALES);');
const sheetAssignment = '    const sheet = filtered.sheet;\n';
const sheetAssignmentIndex = handler.indexOf(sheetAssignment, prefilterStart);
if (prefilterStart >= 0) {
  if (sheetAssignmentIndex < 0) throw new Error("pre-registration sales-filter block end was not found");
  const replacement = [
    '    // Register the downloaded POIZON workbook exactly as received.',
    '    // Sales filtering is operator-controlled from the Excel viewer and must',
    '    // never run before registration/import.',
    '    const sheet = sourceSheet;',
    '    const sourceRowCount = Math.max(0, sourceSheet.length - 1);',
    '',
  ].join("\n");
  handler = handler.slice(0, prefilterStart)
    + replacement
    + handler.slice(sheetAssignmentIndex + sheetAssignment.length);
}

const processedStartMarker = '    const processedName = processedBrandExportName(basename(filePath));';
const processedStart = handler.indexOf(processedStartMarker);
const returnStart = handler.indexOf('    return {\n      canceled: false,\n      ok: true,', processedStart);
if (processedStart >= 0) {
  if (returnStart < 0) throw new Error("filtered derivative workbook block end was not found");
  const replacement = [
    '    // Do not create an automatically filtered derivative workbook.',
    '    // Keep the original workbook as the registered source; the user applies',
    '    // any sales thresholds manually from the visible filter controls.',
    '    const processedName = basename(filePath);',
    '    const processedPath = filePath;',
    '',
  ].join("\n");
  handler = handler.slice(0, processedStart)
    + replacement
    + handler.slice(returnStart);
}

handler = handler.replace(
  '      sourceRows: filtered.sourceRows,\n      filteredRows: filtered.filteredRows,',
  '      sourceRows: sourceRowCount,\n      filteredRows: sourceRowCount,',
);
handler = handler.replace(
  '      minimumSales: POIZON_MINIMUM_TOTAL_SALES,\n      products,',
  '      minimumSales: null,\n      filterApplied: false,\n      products,',
);

if (!handler.includes('    const sheet = sourceSheet;')) {
  throw new Error("unfiltered source-sheet registration was not applied");
}
if (handler.includes('filterPoizonRowsByTotalSales(sourceSheet')) {
  throw new Error("pre-registration sales filter is still present");
}
if (handler.includes('filtered.')) {
  throw new Error("filtered workbook state still leaks into registration handler");
}
if (!handler.includes('      filterApplied: false,')) {
  throw new Error("manual-only filter result flag is missing");
}
if (!handler.includes('    const processedPath = filePath;')) {
  throw new Error("registration still creates an automatic filtered workbook");
}

main = main.slice(0, handlerStart) + handler + main.slice(handlerEnd);
await writeFile(mainPath, main, "utf8");
console.log("POIZON Excel registration now preserves all source rows; sales filters are manual-only");
