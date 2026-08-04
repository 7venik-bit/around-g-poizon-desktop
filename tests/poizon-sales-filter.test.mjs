import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("keeps only rows where both total sales columns are at least 30", () => {
  const result = filterPoizonRowsByTotalSales([
    ["SPU ID", "상품명", "중국 총 판매량", "현지 판매자 총 판매량"],
    ["A", "keep exact", "30", 30],
    ["A", "keep plus", "5,800+", "100+"],
    ["B", "drop local", "100+", "29"],
    ["C", "drop china", "<5", "100+"],
    ["D", "drop missing", "--", "--"],
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.sourceRows, 5);
  assert.equal(result.filteredRows, 2);
  assert.equal(result.uniqueSpuCount, 1);
  assert.deepEqual(result.rows.map((row) => row[1]), ["keep exact", "keep plus"]);
  assert.equal(result.rows[1][2], 5800);
  assert.equal(result.rows[1][3], 100);
});

test("requires both POIZON total-sales columns", () => {
  const result = filterPoizonRowsByTotalSales([
    ["SPU ID", "중국 총 판매량"],
    ["A", 100],
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.code, "POIZON_TOTAL_SALES_COLUMNS_MISSING");
});
