import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");

test("brand results fix both total-sales filters to 30 and AND", () => {
  assert.match(renderer, /id="brand-result-min-total"[^>]+value="30"[^>]+readonly/);
  assert.match(renderer, /id="brand-result-min-local-total"[^>]+value="30"[^>]+readonly/);
  assert.match(renderer, /중국·현지 판매건수 각 30건 이상 \(AND\)/);
  assert.doesNotMatch(renderer, /id="brand-result-sales-match"/);
  assert.doesNotMatch(renderer, /둘 중 하나 충족 \(OR\)/);
});

test("fixed AND uses both total-sales metrics and compares source counts", () => {
  const start = renderer.indexOf("function renderBrandSellerResults");
  const end = renderer.indexOf("function clearExplorerResults", start);
  const source = renderer.slice(start, end);

  assert.match(renderer, /Boolean\(product\?\.hasTotalSalesData\)/);
  assert.match(renderer, /Boolean\(product\?\.hasLocalTotalSalesData\)/);
  assert.match(renderer, /Number\(product\.totalSales\) >= chinaMinimum/);
  assert.match(renderer, /Number\(product\.localTotalSales\) >= localMinimum/);
  assert.match(source, /판매자센터 AND/);
  assert.match(source, /프로그램 AND/);
});
