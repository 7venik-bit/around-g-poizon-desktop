import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  highestQualifiedOptionPrice,
  highestQualifiedTransactionPrice,
  optionRowsFromSellerResponses,
  qualifiedOptionPrices,
  recentThirtyDaySales,
  transactionPrices,
} from "../services/seller-transaction-price.mjs";

test("판매자센터 내부 응답에서 옵션 가격과 판매량을 직접 추출한다", () => {
  const responses = [{ body: JSON.stringify({ data: { skuList: [
    { sizeName: "285", buyerPrice: 73000, salesCount: 96 },
    { sizeName: "290", buyerPrice: 75000, salesCount: 56 },
    { sizeName: "300", buyerPrice: 79000, salesCount: 21 },
  ] } }) }];
  const rows = optionRowsFromSellerResponses(responses);
  assert.equal(rows.length, 3);
  const result = highestQualifiedOptionPrice({ rows, minimumSales: 30 });
  assert.equal(result.price, 75000);
  assert.equal(result.option, "290");
});

test("분리된 중첩 응답에서도 옵션, 가격, 30일 판매량을 결합한다", () => {
  const rows = optionRowsFromSellerResponses([{ body: JSON.stringify({
    data: {
      skuList: [{
        sizeName: "블랙 KR 100",
        statistics: { saleNum30Days: 83 },
        quote: { bidPrice: 68000 },
      }],
    },
  }) }]);
  assert.deepEqual(rows, [{
    option: "블랙 KR 100",
    price: 68000,
    sales: 83,
    text: "블랙 KR 100 68000 83",
  }]);
});

test("전체 거래내역에서 판매량 30건 이상인 옵션 중 최고가를 선택한다", () => {
  const rows = [
    { option: "ALL", price: 82000, sales: "300+" },
    { option: "블랙 KR 90", price: 55000, sales: "40" },
    { option: "블랙 KR 95", price: 76000, sales: "29" },
    { option: "블랙 KR 100", price: 68000, sales: "100+" },
  ];
  assert.deepEqual(qualifiedOptionPrices(rows), [
    { option: "블랙 KR 90", price: 55000, sales: 40 },
    { option: "블랙 KR 100", price: 68000, sales: 100 },
  ]);
  assert.deepEqual(qualifiedOptionPrices(rows, 0), [
    { option: "블랙 KR 90", price: 55000, sales: 40 },
    { option: "블랙 KR 95", price: 76000, sales: 29 },
    { option: "블랙 KR 100", price: 68000, sales: 100 },
  ]);
  assert.deepEqual(highestQualifiedOptionPrice({ rows }), {
    eligible: true,
    price: 68000,
    option: "블랙 KR 100",
    optionSales: 100,
    qualifiedOptionCount: 2,
    options: [
      { option: "블랙 KR 90", price: 55000, sales: 40 },
      { option: "블랙 KR 100", price: 68000, sales: 100 },
    ],
  });
});

test("BD7632 실제 옵션 표에서는 300 사이즈를 제외하고 290 사이즈 75,000원을 선택한다", () => {
  const rows = [
    { option: "270", price: 70000, sales: "400+" },
    { option: "275", price: 70000, sales: "400+" },
    { option: "280", price: 64000, sales: "300+" },
    { option: "285", price: 73000, sales: "96" },
    { option: "290", price: 75000, sales: "56" },
    { option: "295", price: 73000, sales: "45" },
    { option: "300", price: 79000, sales: "21" },
  ];
  const result = highestQualifiedOptionPrice({ rows, minimumSales: 30 });
  assert.equal(result.price, 75000);
  assert.equal(result.option, "290");
  assert.equal(result.optionSales, 56);
});

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
  assert.match(main, /sellerWindowFrames\(\)/);
  assert.match(main, /sellerProductFrameRoutingId = productFrame\.routingId/);
  assert.match(main, /await productFrame\.executeJavaScript/);
  assert.match(main, /target\.click\(\)/);
  assert.match(main, /\^거래\\s\*내역/);
  assert.match(main, /tr,\[role=row\],li,div,section,article/);
  assert.match(main, /normalizedArticle/);
  assert.match(main, /상품\\s\*데이터/);
  assert.match(main, /attempt < 120/);
  assert.match(main, /single visible/);
  assert.match(main, /label\?\.closest\("\[role=tab\],button,a"\) \|\| label/);
  assert.match(main, /PRODUCT_DATA_PANEL_NOT_OPENED/);
  assert.match(main, /TRANSACTION_HISTORY_TAB_NOT_OPENED/);
  assert.match(main, /sendInputEvent\(\{ type: "mouseDown"/);
  assert.match(main, /판매량\\s\*\[:：\]\?/);
  assert.match(main, /__aroundGOptionResponses/);
  assert.match(main, /Network\.getResponseBody/);
  assert.match(main, /transactionNetworkResponses/);
  assert.match(main, /pendingTransactionRequests/);
  assert.match(main, /\.\.\.transactionNetworkResponses/);
  assert.match(main, /\.\.\.sellerResponses/);
  assert.match(main, /\[\.\.\.uniqueRows, \.\.\.responseRows\]/);
  assert.match(main, /seller-product-transaction-history-options\+api/);
  assert.match(main, /뒤로가기/);
  assert.match(main, /OPTION_CONTROL_NOT_FOUND/);
  assert.match(main, /highestQualifiedOptionPrice\(\{ rows: priceRows, minimumSales: 30 \}\)/);
  assert.match(main, /content\.includes\(article\)/);
  assert.match(preload, /lookupSellerTransactionPrice/);
  assert.match(renderer, /product\.averagePrice = Number\(poizonTransaction\.price\)/);
  assert.match(renderer, /product\.transactionOptionSales = Number\(poizonTransaction\.optionSales/);
  assert.match(renderer, /verifiedExcelProductPoizonPrice\(product\)/);
  assert.match(renderer, /<th>사이즈별 가격·판매량<\/th>/);
  assert.match(renderer, /transactionSizeOptions/);
  assert.match(renderer, /renderPoizonSizeOptions/);
  assert.match(renderer, /사이즈<\/span><span>가격<\/span><span>판매량/);
  assert.match(main, /qualifiedOptionPrices\(priceRows, 0\)/);
  assert.match(main, /sizeOptions/);
  assert.match(renderer, /PRODUCT_DATA_PANEL_NOT_OPENED: "상품 데이터 전환 실패"/);
  assert.match(renderer, /QUALIFIED_OPTION_PRICE_NOT_FOUND: "판매 30건 이상 없음"/);
});
