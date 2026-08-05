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
