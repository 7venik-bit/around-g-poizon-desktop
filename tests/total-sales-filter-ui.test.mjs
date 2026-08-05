import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("brand results expose separate China and local-seller total-sales filters", () => {
  assert.match(renderer, /id="brand-result-min-total"[^>]+value="50"[^>]+중국 총 판매량 최소/);
  assert.match(renderer, /id="brand-result-min-local-total"[^>]+value="50"[^>]+현지 판매자 총 판매량 최소/);
  assert.match(renderer, /id="brand-result-max-local-total"[^>]+현지 판매자 총 판매량 최대/);
  assert.match(renderer, /id="brand-result-sales-match"/);
  assert.match(renderer, /둘 중 하나 충족 \(OR\)/);
  assert.match(renderer, /두 조건 모두 충족 \(AND\)/);
});

test("local total-sales filter uses localTotalSales instead of local 30-day sales", () => {
  const start = renderer.indexOf("function renderBrandSellerResults");
  const end = renderer.indexOf("function clearExplorerResults", start);
  const source = renderer.slice(start, end);

  assert.match(source, /product\.hasLocalTotalSalesData/);
  assert.match(source, /Number\(product\.localTotalSales\) >= minimumLocalTotal/);
  assert.match(source, /activeMatches\.some\(Boolean\)/);
  assert.match(source, /activeMatches\.every\(Boolean\)/);
  assert.match(source, /현지 판매자 총 판매량 내림차순/);
  assert.match(source, /class="seller-local-total-sales"/);
});
