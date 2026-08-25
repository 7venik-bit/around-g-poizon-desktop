import test from "node:test";
import assert from "node:assert/strict";
import {
  POIZON_MINIMUM_TOTAL_SALES,
  filterPoizonPreviewRows,
  filterPoizonRowsByTotalSales,
} from "../services/poizon-sales-filter.mjs";

const headers = ["SPU ID", "상품 번호", "중국 총 판매량", "현지 판매자 총 판매량"];
const rows = [
  ["spu-a", "A-001", "100", "100"],
  ["spu-a", "A-001", "100", "6"],
  ["spu-a", "A-001", "6", "100"],
  ["spu-b", "B-001", "100", "<5"],
  ["spu-c", "C-001", "--", "100"],
  ["spu-d", "D-001", "30", "30"],
  ["spu-e", "E-001", "29", "300"],
];

test("all brand Excel previews keep only rows where both sales metrics are at least 30", () => {
  assert.equal(POIZON_MINIMUM_TOTAL_SALES, 30);
  const result = filterPoizonPreviewRows(headers, rows, {
    fixedTotalAnd: true,
    minimumTotal: 30,
    minimumLocalTotal: 30,
  });
  assert.equal(result.matchMode, "all");
  assert.deepEqual(
    result.entries.map((entry) => entry.values[1]),
    ["A-001", "D-001"],
  );
});

test("processed workbook uses the same strict AND rule without mutating source rows", () => {
  const sourceSheet = [headers, ...rows.map((row) => [...row])];
  const snapshot = structuredClone(sourceSheet);
  const result = filterPoizonRowsByTotalSales(sourceSheet);
  assert.equal(result.ok, true);
  assert.equal(result.minimum, 30);
  assert.equal(result.matchMode, "all");
  assert.deepEqual(result.rows.map((row) => row[1]), ["A-001", "D-001"]);
  assert.deepEqual(sourceSheet, snapshot);
});
