import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { findPoizonColumn, findPoizonRecentSalesColumns, findPoizonTotalSalesColumns } from "./poizon-xlsx.mjs";

const WORKSHEET_PATH = /^xl\/worksheets\/sheet\d+\.xml$/;

function decodeXml(value = "") {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function escapeXml(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function cellText(cellXml = "", sharedStrings = []) {
  if (/\bt="s"/.test(cellXml)) {
    const index = Number(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1]);
    return Number.isInteger(index) ? String(sharedStrings[index] || "") : "";
  }
  const text = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join("");
  return decodeXml(text || cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "");
}

function sharedStringValues(archive) {
  const bytes = archive["xl/sharedStrings.xml"];
  if (!bytes) return [];
  return [...strFromU8(bytes).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => cellText(match[1]));
}

function columnName(number) {
  let value = Math.max(1, Number(number) || 1);
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + value % 26) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function normalizedArticle(value = "") {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function screenIndexes(products = []) {
  const articles = new Map();
  const normalizedArticles = new Map();
  const spus = new Map();
  for (const product of products) {
    const article = String(product?.articleNumber || "").trim().toUpperCase();
    const normalized = normalizedArticle(article);
    const spu = String(product?.spuId || product?.globalSpuId || "").trim();
    if (article) articles.set(article, product);
    if (normalized) normalizedArticles.set(normalized, product);
    if (spu) spus.set(spu, product);
  }
  return { articles, normalizedArticles, spus };
}

function matchedProduct(article, spu, indexes) {
  const exactArticle = String(article || "").trim().toUpperCase();
  if (exactArticle) {
    return indexes.articles.get(exactArticle)
      || indexes.normalizedArticles.get(normalizedArticle(exactArticle))
      || null;
  }
  return indexes.spus.get(String(spu || "").trim()) || null;
}

function screenValue(product, local = false) {
  const verified = local ? product?.hasLocalSalesData === true : product?.hasSalesData === true;
  if (!verified) return null;
  const raw = String(local ? product?.localSales30dRaw ?? "" : product?.sales30dRaw ?? "").trim();
  if (raw) return raw;
  const numeric = Number(local ? product?.localSales30d : product?.sales30d);
  return Number.isFinite(numeric) ? String(numeric) : null;
}

function cellFor(rowXml, column, rowNumber) {
  if (!column) return "";
  const reference = `${column}${rowNumber}`;
  return rowXml.match(new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] || "";
}

function replaceCellValue(rowXml, column, rowNumber, value) {
  const reference = `${column}${rowNumber}`;
  const pattern = new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  const existing = rowXml.match(pattern)?.[0] || "";
  if (!existing) return rowXml;
  const style = existing.match(/\bs="([^"]+)"/)?.[1];
  const numeric = /^-?\d+(?:\.\d+)?$/.test(String(value));
  const replacement = numeric
    ? `<c r="${reference}"${style ? ` s="${style}"` : ""}><v>${value}</v></c>`
    : `<c r="${reference}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  return rowXml.replace(pattern, replacement);
}

export function applyPoizonScreenSalesToWorkbook(buffer, screenProducts = []) {
  const archive = unzipSync(new Uint8Array(buffer));
  const sheetPath = Object.keys(archive).filter((path) => WORKSHEET_PATH.test(path)).sort()[0];
  if (!sheetPath) return { ok: false, code: "EXCEL_WORKSHEET_MISSING", message: "Excel 워크시트를 찾지 못했습니다." };
  const xml = strFromU8(archive[sheetPath]);
  const sharedStrings = sharedStringValues(archive);
  const headerRow = xml.match(/<row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/row>/)?.[0] || "";
  const headerCells = [...headerRow.matchAll(/<c\b[^>]*\br="([A-Z]+)1"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)];
  const headers = [];
  const headerColumns = [];
  for (const match of headerCells) {
    const columnNumber = match[1].split("").reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0);
    headers[columnNumber - 1] = cellText(match[0], sharedStrings);
    headerColumns[columnNumber - 1] = match[1];
  }
  const recent = findPoizonRecentSalesColumns(headers);
  const totals = findPoizonTotalSalesColumns(headers);
  const articleIndex = findPoizonColumn(headers, "상품 번호", "상품번호", "상품코드", "품번");
  const spuIndex = findPoizonColumn(headers, "SPU ID", "SPU_ID", "SPUID");
  const chinaIndex = recent.china >= 0 ? recent.china : totals.china;
  const localIndex = recent.local >= 0 ? recent.local : totals.local;
  if (articleIndex < 0 && spuIndex < 0) return { ok: false, code: "EXCEL_PRODUCT_KEY_MISSING", message: "Excel에서 상품번호 또는 SPU ID 열을 찾지 못했습니다." };
  if (chinaIndex < 0 || localIndex < 0) return { ok: false, code: "EXCEL_SALES_COLUMNS_MISSING", message: "Excel에서 중국·현지 판매량 열을 찾지 못했습니다." };

  const indexes = screenIndexes(screenProducts);
  let matchedRows = 0;
  let changedRows = 0;
  let changedCells = 0;
  const updatedXml = xml.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (rowXml, rowText) => {
    const rowNumber = Number(rowText);
    if (rowNumber <= 1) return rowXml;
    const article = cellText(cellFor(rowXml, headerColumns[articleIndex] || columnName(articleIndex + 1), rowNumber), sharedStrings);
    const spu = cellText(cellFor(rowXml, headerColumns[spuIndex] || columnName(spuIndex + 1), rowNumber), sharedStrings);
    const product = matchedProduct(article, spu, indexes);
    if (!product) return rowXml;
    matchedRows += 1;
    let next = rowXml;
    for (const [index, value] of [[chinaIndex, screenValue(product, false)], [localIndex, screenValue(product, true)]]) {
      if (value === null) continue;
      const column = headerColumns[index] || columnName(index + 1);
      const before = cellText(cellFor(next, column, rowNumber), sharedStrings).trim();
      if (before === String(value).trim()) continue;
      const replaced = replaceCellValue(next, column, rowNumber, value);
      if (replaced !== next) changedCells += 1;
      next = replaced;
    }
    if (next !== rowXml) changedRows += 1;
    return next;
  });
  if (!changedRows) return { ok: true, changed: false, matchedRows, changedRows: 0, changedCells: 0, buffer: Buffer.from(buffer) };
  archive[sheetPath] = strToU8(updatedXml);
  return {
    ok: true,
    changed: true,
    matchedRows,
    changedRows,
    changedCells,
    usedRecentColumns: recent.china >= 0 && recent.local >= 0,
    buffer: Buffer.from(zipSync(archive, { level: 6 })),
  };
}
