import test from "node:test";
import assert from "node:assert/strict";
import { parseSellerBrandRows } from "../services/seller-brand-sales.mjs";

const groupedHeaders = [
  "선택", "POIZON 상품 정보", "브랜드/카테고리", "상태", "중국 시장", "관심 상품", "입찰 완료 여부", "관리",
  "최근 30일 평균 거래가", "중국 구매자 페이지 노출", "최근 30일 판매량", "현지 판매자 최근 30일 판매량", "기타",
];

const row = ({ article, spu, china, local }) => ({
  headers: groupedHeaders,
  cells: [
    "",
    `상품 번호:${article}\n데상트 테스트 상품\nSPU_ID : ${spu}`,
    "데상트\n의류/상의",
    "입찰 가능",
    "₩98,000",
    "99",
    china,
    local,
    "☆",
    "--",
    "입찰 등록",
  ],
  text: `상품 번호:${article}\nSPU_ID : ${spu}`,
});

test("다단 그룹 헤더가 td보다 많아도 화면의 중국/현지 최근 30일 값을 읽는다", () => {
  const [product] = parseSellerBrandRows([row({ article: "SR123LDS12", spu: "8035797", china: "100+", local: "83" })]);
  assert.equal(product.articleNumber, "SR123LDS12");
  assert.equal(product.spuId, "8035797");
  assert.equal(product.sales30dRaw, "100+");
  assert.equal(product.localSales30dRaw, "83");
  assert.equal(product.sales30d, 100);
  assert.equal(product.localSales30d, 83);
  assert.equal(product.hasSalesData, true);
  assert.equal(product.hasLocalSalesData, true);
  assert.equal(product.source, "seller-center-visible-column-fallback");
});

test("<5와 일반 숫자를 원문 보존하면서 중국/현지를 독립 판정한다", () => {
  const [product] = parseSellerBrandRows([row({ article: "D6231TCT14", spu: "7544820", china: "<5", local: "95" })]);
  assert.equal(product.sales30dRaw, "<5");
  assert.equal(product.sales30d, 4);
  assert.equal(product.hasSalesData, true);
  assert.equal(product.localSales30dRaw, "95");
  assert.equal(product.localSales30d, 95);
  assert.equal(product.hasLocalSalesData, true);
});

test("한쪽 값이 --여도 다른 쪽의 화면 값은 미확인으로 같이 떨어지지 않는다", () => {
  const [product] = parseSellerBrandRows([row({ article: "SR321DPS72", spu: "7106297", china: "--", local: "40" })]);
  assert.equal(product.hasSalesData, false);
  assert.equal(product.sales30dRaw, "--");
  assert.equal(product.hasLocalSalesData, true);
  assert.equal(product.localSales30dRaw, "40");
  assert.equal(product.localSales30d, 40);
});

test("헤더와 td가 1:1인 기존 표는 헤더 이름 기준을 계속 사용한다", () => {
  const headers = ["선택", "POIZON 상품 정보", "브랜드/카테고리", "상태", "최근 30일 평균 거래가", "중국 구매자 페이지 노출", "최근 30일 판매량", "현지 판매자 최근 30일 판매량"];
  const [product] = parseSellerBrandRows([{
    headers,
    cells: ["", "상품 번호:TEST100\n테스트\nSPU_ID : 100", "데상트", "입찰 가능", "₩100,000", "20", "200+", "30"],
  }]);
  assert.equal(product.sales30dRaw, "200+");
  assert.equal(product.localSales30dRaw, "30");
  assert.equal(product.source, "seller-center-visible-aligned-headers");
});
