import test from "node:test";
import assert from "node:assert/strict";
import {
  BRAND_CATALOG,
  categoryGroup,
  normalizeBrandResult,
  parsePopularTable,
} from "../services/explorer.mjs";

test("검증된 주요 브랜드 카탈로그를 제공한다", () => {
  assert.ok(BRAND_CATALOG.some((brand) => brand.id === 144 && brand.ko === "나이키"));
  assert.ok(BRAND_CATALOG.some((brand) => brand.id === 3 && brand.ko === "아디다스"));
});

test("판매자센터 탭 구분 표를 인기상품으로 변환한다", () => {
  const rows = parsePopularTable([
    "No.\t상품정보\t상품번호\t평균 거래가\t최근 30일 판매량",
    "1\t나이키 에어포스 1\tDD1391-100\t129,000원\t42건",
    "2\t아디다스 삼바\tB75806\t110000\t18",
  ].join("\n"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].articleNumber, "DD1391-100");
  assert.equal(rows[0].averagePrice, 129000);
  assert.equal(rows[0].sales30d, 42);
});

test("상품의 한글 카테고리를 탐색 그룹으로 분류한다", () => {
  assert.equal(categoryGroup({ level1CategoryName: "신발", categoryName: "스니커즈" }), "신발");
  assert.equal(categoryGroup({ level1CategoryName: "의류", categoryName: "다운 재킷" }), "아우터");
  assert.equal(categoryGroup({ categoryName: "백팩" }), "가방");
});

test("POIZON 상품과 판매자센터 30일 판매량을 품번으로 결합한다", () => {
  const rows = normalizeBrandResult({
    contents: [{
      brandName: "나이키",
      articleNumber: "DD1391-100",
      title: "에어포스 1",
      level1CategoryName: "신발",
    }],
  }, { "DD1391-100": 42 });
  assert.equal(rows[0].sales30d, 42);
  assert.equal(rows[0].hasSalesData, true);
  assert.equal(rows[0].categoryGroup, "신발");
});
