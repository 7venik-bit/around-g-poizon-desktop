import { readFile } from "node:fs/promises";

const main = String(await readFile(new URL("../main.mjs", import.meta.url), "utf8"));
const poizon = String(await readFile(new URL("../services/poizon-xlsx.mjs", import.meta.url), "utf8"));
const fail = (message) => { throw new Error(`fast Excel preview verification failed: ${message}`); };

if (!main.includes("readPoizonWorksheetRowsFast,")) fail("fast reader import missing");
if (!main.includes("let rows = readPoizonWorksheetRowsFast(fileBuffer);")) fail("preview fast reader call missing");
if (!main.includes("rows = await readFirstDataSheet(fileBuffer)")) fail("legacy fallback missing");
if (main.includes("const rows = await readFirstDataSheet(await readFile(filePath));")) fail("preview still reparses the workbook through the slow path");
if (!poizon.includes("export function readPoizonWorksheetRowsFast(buffer)")) fail("fast worksheet reader implementation missing");
if (!poizon.includes("unzipSync(new Uint8Array(buffer))")) fail("fast reader must unzip once without workbook rewrite");

console.log("fast in-app Excel preview verified: direct worksheet XML reader with legacy fallback");
