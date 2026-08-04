import assert from "node:assert/strict";
import test from "node:test";
import { filterInventoryProducts, hasSalesMode } from "../services/inventory-filter.mjs";

const products = [{
  spuId: "1",
  hasSalesData: true,
  hasLocalSalesData: true,
  hasTotalSalesData: true,
  hasLocalTotalSalesData: true,
  variants: [
    { option: "A", sales30d: 40, localSales30d: 35, totalSales: 400, localTotalSales: 20 },
    { option: "B", sales30d: 20, localSales30d: 80, totalSales: 50, localTotalSales: 60 },
  ],
}];

test("inventory filters the same option row for recent and total sales", () => {
  assert.equal(filterInventoryProducts(products, { mode: "recent30", localMinimum: 30, chinaMinimum: 30 }).length, 1);
  assert.deepEqual(filterInventoryProducts(products, { mode: "recent30", localMinimum: 30, chinaMinimum: 30 })[0].filteredVariants.map((row) => row.option), ["A"]);
  assert.deepEqual(filterInventoryProducts(products, { mode: "total", localMinimum: 30, chinaMinimum: 30 })[0].filteredVariants.map((row) => row.option), ["B"]);
});

test("inventory supports independent minimum and maximum sales ranges", () => {
  const result = filterInventoryProducts(products, {
    mode: "total", localMinimum: 50, localMaximum: 70, chinaMinimum: 40, chinaMaximum: 60,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].filteredVariants[0].option, "B");
});

test("sales modes are available only when both matching columns exist", () => {
  assert.equal(hasSalesMode(products, "recent30"), true);
  assert.equal(hasSalesMode([{ hasSalesData: true }], "recent30"), false);
});
