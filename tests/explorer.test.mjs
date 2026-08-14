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

test("상품정보 셀의 품번과 상품명이 줄바꿈되어도 인식한다", () => {
  const rows = parsePopularTable([
    "No.\t상품정보\t검색 지수\t즐겨찾기 지수\t평균 거래가(KRW)\t최저 거래가(KRW)\t최고 거래가(KRW)",
    "1.\tJI0079",
    "Adidas Originals Samba\t주간 대비\t주간 대비\t91,720\t56,674\t153,302",
    "2.\tB75806 Adidas Originals\t주간 대비\t주간 대비\t85,699\t52,029\t193,949",
  ].join("\n"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].articleNumber, "JI0079");
  assert.match(rows[0].name, /Adidas Originals/);
  assert.equal(rows[0].averagePrice, 91720);
});

test("판매자센터 세로형 복사 텍스트를 상품 행으로 복원한다", () => {
  const rows = parsePopularTable([
    "No.\t상품정보\t",
    "검색 지수",
    "즐겨찾기 지수",
    "평균 거래가(KRW)",
    "최저 거래가(KRW)",
    "최고 거래가(KRW)",
    "최근 7일 검색 추세",
    "1.\t",
    "",
    "JI0079",
    "Adidas Originals Superstar 2 Skate Shoes",
    "주간 대비",
    "주간 대비",
    "91,720",
    "주간 대비",
    "56,674",
    "153,302",
    "2.\t",
    "",
    "B75806",
    "adidas originals Samba OG",
    "주간 대비",
    "주간 대비",
    "85,699",
    "52,029",
    "193,949",
  ].join("\n"));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.articleNumber), ["JI0079", "B75806"]);
  assert.equal(rows[0].averagePrice, 91720);
  assert.match(rows[1].name, /Samba/);
});

test("상품의 한글 카테고리를 탐색 그룹으로 분류한다", () => {
  assert.equal(categoryGroup({ level1CategoryName: "신발", categoryName: "스니커즈" }), "신발");
  assert.equal(categoryGroup({ level1CategoryName: "의류", categoryName: "다운 재킷" }), "아우터");
  assert.equal(categoryGroup({ categoryName: "백팩" }), "가방");
});

test("POIZON 영문 카테고리와 상품명도 탐색 그룹으로 분류한다", () => {
  assert.equal(categoryGroup({ level1CategoryName: "Footwear", productNameEn: "Air Max Shoes" }), "신발");
  assert.equal(categoryGroup({ categoryName: "Sneakers", title: "Running Trainer" }), "신발");
  assert.equal(categoryGroup({ categoryName: "Apparel", productName: "Down Jacket" }), "아우터");
  assert.equal(categoryGroup({ productNameEn: "Nike Crew Socks Combo Set Teenagers" }), "액세서리");
  assert.equal(categoryGroup({ level2CategoryName: "Baseball Caps" }), "모자");
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
