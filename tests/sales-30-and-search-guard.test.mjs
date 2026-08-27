import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  filterPoizonRowsByTotalSales,
  POIZON_MINIMUM_TOTAL_SALES,
} from "../services/poizon-sales-filter.mjs";

test("POIZON total-sales cleanup requires both China and local sales >= 30", () => {
  assert.equal(POIZON_MINIMUM_TOTAL_SALES, 30);
  const sheet = [
    ["SPU ID", "상품 번호", "중국 총 판매량", "현지 판매자 총 판매량"],
    ["A", "A-100-20", "100+", "20"],
    ["B", "B-20-100", "20", "100+"],
    ["C", "C-30-30", "30", "30"],
    ["D", "D-31-29", "31", "29"],
    ["E", "E-100-100", "100+", "100+"],
  ];

  const result = filterPoizonRowsByTotalSales(sheet);
  assert.equal(result.ok, true);
  assert.equal(result.minimum, 30);
  assert.equal(result.matchMode, "all");
  assert.deepEqual(result.rows.map((row) => row[1]), ["C-30-30", "E-100-100"]);
});

test("domestic search is guarded against size sales below 30", async () => {
  const sourcing = String(await readFile(new URL("../src/sourcing-view.js", import.meta.url), "utf8"));
  assert.match(sourcing, /data-around-g-sales-30-search-guard/);
  assert.match(sourcing, /SALES_BELOW_30/);
  assert.match(sourcing, /sizeSalesValue\(product\) >= 30/);
  assert.match(sourcing, /referenceProduct !== product/);
  assert.doesNotMatch(sourcing, /highestSizeByIdentity\.get\(sourcingProductIdentity\(product\)\) \|\| product/);
});
