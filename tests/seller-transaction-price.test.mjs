import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  highestQualifiedTransactionPrice,
  recentThirtyDaySales,
  transactionPrices,
} from "../services/seller-transaction-price.mjs";

test("거래내역은 최근 30일 판매량 30건 이상일 때 최고가격을 선택한다", () => {
  const rows = [
    { cells: ["₩95,000", "중국 일반판매", "225"] },
    { cells: ["₩118,000", "중국 일반판매", "240"] },
    { cells: ["₩103,000", "현지판매", "238"] },
  ];
  assert.deepEqual(transactionPrices(rows), [95000, 118000, 103000]);
  assert.deepEqual(highestQualifiedTransactionPrice({ sales30d: "300+", rows }), {
    eligible: true,
    sales30d: 300,
    price: 118000,
    transactionCount: 3,
  });
});

test("최근 30일 판매량이 30건 미만이면 거래 최고가격을 적용하지 않는다", () => {
  assert.equal(recentThirtyDaySales("<5"), 4);
  assert.deepEqual(highestQualifiedTransactionPrice({
    sales30d: "29",
    rows: [{ text: "₩200,000 중국 일반판매" }],
  }), { eligible: false, sales30d: 29, price: 0, transactionCount: 0 });
});

test("엑셀 상품 검색은 거래내역 검증 가격을 평균가격 필드에 표시한다", async () => {
  const [main, preload, renderer] = await Promise.all([
    readFile(new URL("../main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer.js", import.meta.url), "utf8"),
  ]);
  assert.match(main, /seller:lookup-transaction-price/);
  assert.match(main, /거래\\s\*내역\|거래\\s\*기록/);
  assert.match(main, /highestQualifiedTransactionPrice\(\{ sales30d: salesRaw, rows: capturedRows \}\)/);
  assert.match(preload, /lookupSellerTransactionPrice/);
  assert.match(renderer, /product\.averagePrice = Number\(poizonTransaction\.price\)/);
  assert.match(renderer, /<th>평균가격<\/th>/);
});
