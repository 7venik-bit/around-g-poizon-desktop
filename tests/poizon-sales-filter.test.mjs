import assert from "node:assert/strict";
import test from "node:test";
import {
  filterPoizonPreviewRows,
  filterPoizonRowsByTotalSales,
  parsePoizonSalesMetric,
} from "../services/poizon-sales-filter.mjs";

test("normalizes POIZON sales values", () => {
  assert.equal(parsePoizonSalesMetric(92), 92);
  assert.equal(parsePoizonSalesMetric("100+"), 100);
  assert.equal(parsePoizonSalesMetric("5,800+"), 5800);
  assert.equal(parsePoizonSalesMetric("<5"), 4);
  assert.equal(parsePoizonSalesMetric("--"), 0);
  assert.equal(parsePoizonSalesMetric(""), 0);
});

test("keeps rows where either total sales column is at least 50", () => {
  const result = filterPoizonRowsByTotalSales([
    ["SPU ID", "상품명", "중국 총 판매량", "현지 판매자 총 판매량"],
    ["A", "keep china exact", "50", 12],
    ["A", "keep plus", "5,800+", "100+"],
    ["B", "keep china", "100+", "29"],
    ["C", "keep local", "<5", "100+"],
    ["E", "drop below", "49", "49"],
    ["D", "drop missing", "--", "--"],
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.sourceRows, 6);
  assert.equal(result.filteredRows, 4);
  assert.equal(result.uniqueSpuCount, 3);
  assert.deepEqual(result.rows.map((row) => row[1]), [
    "keep china exact", "keep plus", "keep china", "keep local",
  ]);
  assert.equal(result.rows[1][2], 5800);
  assert.equal(result.rows[1][3], 100);
  assert.equal(result.minimum, 50);
  assert.equal(result.matchMode, "any");
});

test("requires both POIZON total-sales columns", () => {
  const result = filterPoizonRowsByTotalSales([
    ["SPU ID", "중국 총 판매량"],
    ["A", 100],
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.code, "POIZON_TOTAL_SALES_COLUMNS_MISSING");
});

test("filters the complete Excel preview by either total-sales column and preserves source row numbers", () => {
  const result = filterPoizonPreviewRows(
    ["SPU ID", "중국 총 판매량", "현지 판매자 총 판매량"],
    [
      ["A", "49", "50"],
      ["B", "5,800+", "12"],
      ["C", "49", "49"],
      ["D", "--", "100+"],
    ],
    { minimumTotal: 50, minimumLocalTotal: 50, matchMode: "any" },
  );

  assert.equal(result.sourceRows, 4);
  assert.equal(result.filteredRows, 3);
  assert.deepEqual(result.entries.map((entry) => entry.values[0]), ["A", "B", "D"]);
  assert.deepEqual(result.entries.map((entry) => entry.sourceRowNumber), [2, 3, 5]);
  assert.equal(result.filterApplied, true);
});

test("supports AND and minimum/maximum ranges in the Excel preview", () => {
  const result = filterPoizonPreviewRows(
    ["SPU ID", "중국 총 판매량", "현지 판매자 총 판매량"],
    [
      ["A", 50, 50],
      ["B", 100, 49],
      ["C", 101, 100],
      ["D", "--", 80],
    ],
    {
      minimumTotal: 50,
      maximumTotal: 100,
      minimumLocalTotal: 50,
      maximumLocalTotal: 100,
      matchMode: "all",
    },
  );

  assert.deepEqual(result.entries.map((entry) => entry.values[0]), ["A"]);
});

test("fixed total-sales preview requires both China and local values", () => {
  const headers = ["SPU ID", "중국 총 판매량", "현지 판매자 총 판매량"];
  const rows = [
    ["A", "30+", "30+"],
    ["B", "100+", "--"],
    ["C", "29", "80+"],
  ];
  const result = filterPoizonPreviewRows(headers, rows, {
    fixedTotalAnd: true,
    minimumTotal: 30,
    minimumLocalTotal: 30,
  });
  assert.equal(result.matchMode, "all");
  assert.deepEqual(result.entries.map((entry) => entry.values[0]), ["A"]);
});
