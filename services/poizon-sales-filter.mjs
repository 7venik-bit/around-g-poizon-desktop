import { findPoizonColumn } from "./poizon-xlsx.mjs";

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
  const totalSalesColumn = findPoizonColumn(headers, "중국 총 판매량", "총 판매량");
  const localTotalSalesColumn = findPoizonColumn(
    headers,
    "현지 판매자 총 판매량",
    "현지판매자총판매량",
  );
  const minimumTotal = optionalSalesBoundary(filters.minimumTotal);
  const maximumTotal = optionalSalesBoundary(filters.maximumTotal);
  const minimumLocalTotal = optionalSalesBoundary(filters.minimumLocalTotal);
  const maximumLocalTotal = optionalSalesBoundary(filters.maximumLocalTotal);
  const matchMode = fixedTotalAnd || filters.matchMode === "all" ? "all" : "any";
  const chinaActive = totalSalesColumn >= 0 && (minimumTotal !== null || maximumTotal !== null);
  const localActive = localTotalSalesColumn >= 0
    && (minimumLocalTotal !== null || maximumLocalTotal !== null);

  const entries = (Array.isArray(rows) ? rows : []).map((row, index) => ({
    values: Array.isArray(row) ? row : [],
    sourceRowNumber: index + 2,
  }));
  const filteredEntries = entries.filter(({ values }) => {
    const matches = [];
    if (chinaActive) {
      const raw = values[totalSalesColumn];
      const value = parsePoizonSalesMetric(raw);
      matches.push(hasSalesMetric(raw)
        && (minimumTotal === null || value >= minimumTotal)
        && (maximumTotal === null || value <= maximumTotal));
    }
    if (localActive) {
      const raw = values[localTotalSalesColumn];
      const value = parsePoizonSalesMetric(raw);
      matches.push(hasSalesMetric(raw)
        && (minimumLocalTotal === null || value >= minimumLocalTotal)
        && (maximumLocalTotal === null || value <= maximumLocalTotal));
    }
    if (!matches.length) return true;
    return matchMode === "all" ? matches.every(Boolean) : matches.some(Boolean);
  });

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
