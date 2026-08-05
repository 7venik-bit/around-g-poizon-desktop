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
