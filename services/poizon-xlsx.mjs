import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const WORKSHEET_PATH = /^xl\/worksheets\/sheet\d+\.xml$/;
const CELL_REFERENCE = /<c\b[^>]*\br="([A-Z]+)(\d+)"/g;

function decodeXmlText(value = "") {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function cellText(cellXml = "", sharedStrings = []) {
  if (/\bt="s"/.test(cellXml)) {
    const index = Number(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1]);
    return Number.isInteger(index) ? String(sharedStrings[index] || "") : "";
  }
  const textNodes = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
  if (textNodes.length) return decodeXmlText(textNodes.map((match) => match[1]).join(""));
  return decodeXmlText(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "");
}

function sharedStringValues(archive) {
  const bytes = archive["xl/sharedStrings.xml"];
  if (!bytes) return [];
  const xml = strFromU8(bytes);
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map((match) => cellText(match[1]));
}

function columnNameToNumber(name) {
  let number = 0;
  for (const character of name) {
    number = number * 26 + character.charCodeAt(0) - 64;
  }
  return number;
}

function columnNumberToName(number) {
  let name = "";
  while (number > 0) {
    number -= 1;
    name = String.fromCharCode(65 + (number % 26)) + name;
    number = Math.floor(number / 26);
  }
  return name || "A";
}

export function normalizePoizonHeader(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function findPoizonColumn(headers, ...names) {
  const normalizedHeaders = (headers || []).map(normalizePoizonHeader);
  const aliases = names.map(normalizePoizonHeader).filter(Boolean);

  for (const alias of aliases) {
    const exactIndex = normalizedHeaders.indexOf(alias);
    if (exactIndex >= 0) return exactIndex;
  }

  for (const alias of aliases) {
    if (alias.length < 4) continue;
    const candidates = normalizedHeaders
      .map((header, index) => (header.includes(alias) ? index : -1))
      .filter((index) => index >= 0);
    if (candidates.length === 1) return candidates[0];
  }

  return -1;
}

export function getPoizonWorksheetRows(workbookResult) {
  if (Array.isArray(workbookResult?.[0]?.data)) {
    return (
      workbookResult.find(
        (entry) => Array.isArray(entry?.data) && entry.data.length > 0,
      )?.data || []
    );
  }

  if (
    Array.isArray(workbookResult) &&
    (workbookResult.length === 0 || Array.isArray(workbookResult[0]))
  ) {
    return workbookResult;
  }

  return [];
}

export function readPoizonColumnValues(buffer, ...headerNames) {
  const archive = unzipSync(new Uint8Array(buffer));
  const sheetPath = Object.keys(archive).find((path) => WORKSHEET_PATH.test(path));
  if (!sheetPath) return { column: -1, header: "", values: [] };
  const xml = strFromU8(archive[sheetPath]);
  const firstRow = xml.match(/<row\b[^>]*\br="1"[^>]*>([\s\S]*?)<\/row>/)?.[1] || "";
  const sharedStrings = /\bt="s"/.test(xml) ? sharedStringValues(archive) : [];
  const headers = [];
  for (const match of firstRow.matchAll(/<c\b[^>]*\br="([A-Z]+)1"[^>]*>([\s\S]*?)<\/c>/g)) {
    headers.push({ column: match[1], value: cellText(match[0], sharedStrings) });
  }
  const aliases = headerNames.map(normalizePoizonHeader).filter(Boolean);
  const header = headers.find((item) => aliases.includes(normalizePoizonHeader(item.value)));
  if (!header) return { column: -1, header: "", values: [] };
  const values = [];
  const cellPattern = new RegExp(`<c\\b[^>]*\\br="${header.column}(\\d+)"[^>]*>([\\s\\S]*?)<\\/c>`, "g");
  let match;
  while ((match = cellPattern.exec(xml))) {
    if (Number(match[1]) <= 1) continue;
    const value = cellText(match[0], sharedStrings).trim();
    if (value) values.push(value);
  }
  return { column: columnNameToNumber(header.column) - 1, header: header.value, values };
}

export function repairPoizonWorksheetDimensions(buffer) {
  const archive = unzipSync(new Uint8Array(buffer));
  let repaired = false;

  for (const [path, bytes] of Object.entries(archive)) {
    if (!WORKSHEET_PATH.test(path)) continue;
    const xml = strFromU8(bytes);
    const declared = xml.match(/<dimension\b[^>]*\bref="([^"]+)"/i)?.[1] || "";
    if (declared && declared !== "A1") continue;

    let lastColumnNumber = 1;
    let lastRow = 1;
    let match;
    CELL_REFERENCE.lastIndex = 0;
    while ((match = CELL_REFERENCE.exec(xml))) {
      const row = Number(match[2]);
      lastRow = Math.max(lastRow, row);
      lastColumnNumber = Math.max(lastColumnNumber, columnNameToNumber(match[1]));
    }
    if (lastRow <= 1 && lastColumnNumber === 1) continue;

    const lastColumn = columnNumberToName(lastColumnNumber);
    const dimension = `A1:${lastColumn}${lastRow}`;
    const updated = /<dimension\b[^>]*\bref="[^"]+"[^>]*\/?>/i.test(xml)
      ? xml.replace(/<dimension\b[^>]*\bref="[^"]+"[^>]*\/?>/i, `<dimension ref="${dimension}"/>`)
      : xml.replace(/<worksheet\b([^>]*)>/i, `<worksheet$1><dimension ref="${dimension}"/>`);
    archive[path] = strToU8(updated);
    repaired = true;
  }

  return repaired ? Buffer.from(zipSync(archive, { level: 6 })) : Buffer.from(buffer);
}
