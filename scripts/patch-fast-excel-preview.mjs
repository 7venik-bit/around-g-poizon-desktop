import { readFile, writeFile } from "node:fs/promises";

const normalizeLf = (value) => String(value || "").replace(/\r\n/g, "\n");
const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`fast Excel preview patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`fast Excel preview patch target duplicated: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = normalizeLf(await readFile(mainPath, "utf8"));
main = replaceOnce(
  main,
  `  repairPoizonWorksheetDimensions,\n} from "./services/poizon-xlsx.mjs";`,
  `  repairPoizonWorksheetDimensions,\n  readPoizonWorksheetRowsFast,\n} from "./services/poizon-xlsx.mjs";`,
  "import fast worksheet reader",
);
main = replaceOnce(
  main,
  `    const rows = await readFirstDataSheet(await readFile(filePath));\n    const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);`,
  `    const fileBuffer = await readFile(filePath);\n    // The in-app viewer must not repair/re-zip the full workbook before showing it.\n    // POIZON exports can contain tens of thousands of rows; parsing the worksheet\n    // XML directly is substantially faster and still preserves all visible cells.\n    let rows = readPoizonWorksheetRowsFast(fileBuffer);\n    if (!Array.isArray(rows) || rows.length === 0) rows = await readFirstDataSheet(fileBuffer);\n    const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);`,
  "use fast worksheet parser in preview",
);
await writeFile(mainPath, main, "utf8");
console.log("in-app Excel preview now uses fast worksheet XML parsing before legacy fallback");
