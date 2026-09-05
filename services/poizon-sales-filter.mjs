import { findPoizonColumn, findPoizonTotalSalesColumns } from "./poizon-xlsx.mjs";

export const POIZON_MINIMUM_TOTAL_SALES = 50;

export function parsePoizonSalesMetric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").normalize("NFKC").trim();
  if (!raw || raw === "--" || raw === "-") return 0;

  const lessThan = raw.match(/^<\s*([\d,]+(?:\.\d+)?)/);
  if (lessThan) {
    const ceiling = Number(lessThan[1].replace(/,/g, ""));
    return Number.isFinite(ceiling) ? Math.max(0, ceiling - 1) : 0;
  }

  const match = raw.match(/-?[\d,]+(?:\.\d+)?/);
  if (!match) return 0;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalSalesBoundary(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function hasSalesMetric(value) {
  if (typeof value === "number") return Number.isFinite(value);
  return /\d/.test(String(value ?? ""));
}

export function filterPoizonPreviewRows(headers = [], rows = [], filters = {}) {
  const fixedTotalAnd = filters.fixedTotalAnd === true;
  const totalSalesColumns = findPoizonTotalSalesColumns(headers);
  const totalSalesColumn = totalSalesColumns.china;
  const localTotalSalesColumn = totalSalesColumns.local;
  const minimumTotal = optionalSalesBoundary(filters.minimumTotal);
  const maximumTotal = optionalSalesBoundary(filters.maximumTotal);
  const minimumLocalTotal = optionalSalesBoundary(filters.minimumLocalTotal);
  const maximumLocalTotal = optionalSalesBoundary(filters.maximumLocalTotal);
  const matchMode = fixedTotalAnd || filters.matchMode === "all" ? "all" : "any";
  const chinaActive = totalSalesColumn >= 0 && (minimumTotal !== null || maximumTotal !== null);
  const localActive = localTotalSalesColumn >= 0
    && (minimumLocalTotal !== null || maximumLocalTotal !== null);
  const spuIdColumn = findPoizonColumn(headers, "SPU ID", "SPU_ID", "SPUID");
  const articleNumberColumn = findPoizonColumn(headers, "상품 번호", "상품번호", "품번");

  const entries = (Array.isArray(rows) ? rows : []).map((row, index) => ({
    values: Array.isArray(row) ? row : [],
    sourceRowNumber: index + 2,
  }));
  if (filters.rowLevel === true) {
    const inRange = (value, minimum, maximum) => value !== null
      && (minimum === null || value >= minimum)
      && (maximum === null || value <= maximum);
    const rowMetrics = entries.map((entry) => {
      const chinaRaw = totalSalesColumn >= 0 ? entry.values[totalSalesColumn] : "";
      const localRaw = localTotalSalesColumn >= 0 ? entry.values[localTotalSalesColumn] : "";
      return {
        entry,
        chinaValue: hasSalesMetric(chinaRaw) ? parsePoizonSalesMetric(chinaRaw) : null,
        localValue: hasSalesMetric(localRaw) ? parsePoizonSalesMetric(localRaw) : null,
      };
    });
    const filteredEntries = rowMetrics.filter(({ chinaValue, localValue }) => {
      const matches = [];
      if (chinaActive) matches.push(inRange(chinaValue, minimumTotal, maximumTotal));
      if (localActive) matches.push(inRange(localValue, minimumLocalTotal, maximumLocalTotal));
      if (!matches.length) return true;
      return matchMode === "all" ? matches.every(Boolean) : matches.some(Boolean);
    }).map(({ entry }) => entry);
    return {
      entries: filteredEntries,
      sourceRows: entries.length,
      filteredRows: filteredEntries.length,
      totalSalesColumn,
      localTotalSalesColumn,
      chinaActive,
      localActive,
      filterApplied: chinaActive || localActive,
      matchMode,
      sourceProducts: entries.length,
      filteredProducts: filteredEntries.length,
      chinaQualifiedProducts: rowMetrics.filter(({ chinaValue }) => !chinaActive || inRange(chinaValue, minimumTotal, maximumTotal)).length,
      localQualifiedProducts: rowMetrics.filter(({ localValue }) => !localActive || inRange(localValue, minimumLocalTotal, maximumLocalTotal)).length,
      missingChinaProducts: rowMetrics.filter(({ chinaValue }) => chinaValue === null).length,
      missingLocalProducts: rowMetrics.filter(({ localValue }) => localValue === null).length,
      spuIdColumn,
      articleNumberColumn,
    };
  }
  const groups = new Map();
  for (const entry of entries) {
    const spuId = spuIdColumn >= 0 ? String(entry.values[spuIdColumn] ?? "").trim() : "";
    const articleNumber = articleNumberColumn >= 0 ? String(entry.values[articleNumberColumn] ?? "").trim().toUpperCase() : "";
    const key = spuId ? `SPU:${spuId}` : articleNumber ? `ARTICLE:${articleNumber}` : `ROW:${entry.sourceRowNumber}`;
    const group = groups.get(key) || {
      key,
      entries: [],
      chinaValues: [],
      localValues: [],
    };
    group.entries.push(entry);
    const chinaRaw = totalSalesColumn >= 0 ? entry.values[totalSalesColumn] : "";
    const localRaw = localTotalSalesColumn >= 0 ? entry.values[localTotalSalesColumn] : "";
    if (hasSalesMetric(chinaRaw)) group.chinaValues.push(parsePoizonSalesMetric(chinaRaw));
    if (hasSalesMetric(localRaw)) group.localValues.push(parsePoizonSalesMetric(localRaw));
    groups.set(key, group);
  }
  const productGroups = [...groups.values()].map((group) => ({
    ...group,
    chinaValue: group.chinaValues.length ? Math.max(...group.chinaValues) : null,
    localValue: group.localValues.length ? Math.max(...group.localValues) : null,
  }));
  const inRange = (value, minimum, maximum) => value !== null
    && (minimum === null || value >= minimum)
    && (maximum === null || value <= maximum);
  const chinaQualifiedProducts = productGroups.filter((group) =>
    !chinaActive || inRange(group.chinaValue, minimumTotal, maximumTotal)).length;
  const localQualifiedProducts = productGroups.filter((group) =>
    !localActive || inRange(group.localValue, minimumLocalTotal, maximumLocalTotal)).length;
  const missingChinaProducts = productGroups.filter((group) => group.chinaValue === null).length;
  const missingLocalProducts = productGroups.filter((group) => group.localValue === null).length;
  const matchedGroups = productGroups.filter((group) => {
    const matches = [];
    if (chinaActive) {
      matches.push(inRange(group.chinaValue, minimumTotal, maximumTotal));
    }
    if (localActive) {
      matches.push(inRange(group.localValue, minimumLocalTotal, maximumLocalTotal));
    }
    if (!matches.length) return true;
    return matchMode === "all" ? matches.every(Boolean) : matches.some(Boolean);
  });
  const filteredEntries = matchedGroups.flatMap((group) => group.entries);

  return {
    entries: filteredEntries,
    sourceRows: entries.length,
    filteredRows: filteredEntries.length,
    totalSalesColumn,
    localTotalSalesColumn,
    chinaActive,
    localActive,
    filterApplied: chinaActive || localActive,
    matchMode,
    sourceProducts: productGroups.length,
    filteredProducts: matchedGroups.length,
    chinaQualifiedProducts,
    localQualifiedProducts,
    missingChinaProducts,
    missingLocalProducts,
    spuIdColumn,
    articleNumberColumn,
  };
}

function populated(row = []) {
  return row.some((value) => String(value ?? "").trim());
}

export function filterPoizonRowsByTotalSales(sheet = [], minimum = POIZON_MINIMUM_TOTAL_SALES) {
  if (!Array.isArray(sheet) || sheet.length < 2) {
    return {
      ok: false,
      code: "POIZON_EXCEL_EMPTY",
      message: "Excel 파일에 상품 데이터가 없습니다.",
    };
  }

  const headers = sheet[0] || [];
  const totalSalesColumn = findPoizonColumn(headers, "중국 총 판매량", "총 판매량");
  const localTotalSalesColumn = findPoizonColumn(
    headers,
    "현지 판매자 총 판매량",
    "현지판매자총판매량",
  );
  const spuIdColumn = findPoizonColumn(headers, "SPU ID", "SPU_ID");

  if (totalSalesColumn < 0 || localTotalSalesColumn < 0) {
    return {
      ok: false,
      code: "POIZON_TOTAL_SALES_COLUMNS_MISSING",
      message: "중국 총 판매량과 현지 판매자 총 판매량 열을 모두 찾을 수 있어야 자동 정리가 가능합니다.",
      totalSalesColumn,
      localTotalSalesColumn,
    };
  }

  const threshold = Number.isFinite(Number(minimum)) ? Number(minimum) : POIZON_MINIMUM_TOTAL_SALES;
  const filteredRows = [];
  const uniqueSpuIds = new Set();
  let sourceRows = 0;

  for (const sourceRow of sheet.slice(1)) {
    const row = Array.isArray(sourceRow) ? [...sourceRow] : [];
    if (!populated(row)) continue;
    sourceRows += 1;
    const totalSales = parsePoizonSalesMetric(row[totalSalesColumn]);
    const localTotalSales = parsePoizonSalesMetric(row[localTotalSalesColumn]);
    if (totalSales < threshold && localTotalSales < threshold) continue;

    // The processed workbook should sort/filter as numbers instead of text such as
    // "100+" or "5,800+". The original workbook remains untouched.
    row[totalSalesColumn] = totalSales;
    row[localTotalSalesColumn] = localTotalSales;
    filteredRows.push(row);

    const spuId = spuIdColumn >= 0 ? String(row[spuIdColumn] ?? "").trim() : "";
    if (spuId) uniqueSpuIds.add(spuId);
  }

  return {
    ok: true,
    headers,
    rows: filteredRows,
    sheet: [headers, ...filteredRows],
    sourceRows,
    filteredRows: filteredRows.length,
    uniqueSpuCount: uniqueSpuIds.size,
    minimum: threshold,
    totalSalesColumn,
    localTotalSalesColumn,
    matchMode: "any",
  };
}
