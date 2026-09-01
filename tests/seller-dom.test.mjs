import test from "node:test";
import assert from "node:assert/strict";
import { dedupeSellerProducts, parseSellerDomNodes, sellerRankFromLine } from "../services/seller-dom.mjs";

test("판매자센터 가상 행에서 품번, 상품명, 가격과 이미지를 복원한다", () => {
  const products = parseSellerDomNodes([{
    text: "1.\nJI0079\nAdidas Originals Superstar 2 Skate Shoes\n주간 대비\n91,720\n56,674\n153,302",
    imageUrl: "https://img.example/ji0079.jpg",
  }]);
  assert.equal(products.length, 1);
  assert.equal(products[0].articleNumber, "JI0079");
  assert.equal(products[0].averagePrice, 91720);
  assert.equal(products[0].logoUrl, "https://img.example/ji0079.jpg");
});

test("가격이 없는 메뉴 텍스트는 상품으로 오인하지 않는다", () => {
  const products = parseSellerDomNodes([{ text: "SPU 기준\nAQ1774-102\n검색 지수" }]);
  assert.equal(products.length, 0);
});

test("순위와 품번 및 품명이 있으면 가격 셀이 분리되어도 상품 슬롯을 유지한다", () => {
  const products = parseSellerDomNodes([{
    text: "20.\nAQ1774-102\nNike EBERNON Synthetic Leather Low Top",
    imageUrl: "",
  }]);
  assert.equal(products.length, 1);
  assert.equal(products[0].rank, 20);
  assert.equal(products[0].articleNumber, "AQ1774-102");
  assert.equal(products[0].averagePrice, 0);
});

test("순위와 상품 정보가 한 줄로 합쳐진 가상 행도 정확한 슬롯으로 복원한다", () => {
  const products = parseSellerDomNodes([{
    text: "23위 JI0079 Adidas Superstar 2\n91,720\n56,674\n153,302",
    imageUrl: "https://img.example/ji0079.jpg",
  }]);
  assert.equal(products.length, 1);
  assert.equal(products[0].rank, 23);
  assert.equal(products[0].rankDetected, true);
  assert.equal(products[0].articleNumber, "JI0079");
});

test("명시적 순위 표기만 1~200위 범위에서 허용한다", () => {
  assert.deepEqual(sellerRankFromLine("순위 7", 200), { rank: 7, remainder: "" });
  assert.deepEqual(sellerRankFromLine("108위 AQ1774-102", 200), { rank: 108, remainder: "AQ1774-102" });
  assert.equal(sellerRankFromLine("201위 AQ1774-102", 200), null);
  assert.equal(sellerRankFromLine("91720", 200), null);
});

test("같은 품번은 가장 앞선 순위 한 건만 남긴다", () => {
  const products = dedupeSellerProducts([
    { rank: 19, articleNumber: "JI0079", name: "중복" },
    { rank: 1, articleNumber: "ji0079", name: "원본" },
    { rank: 3, articleNumber: "B75806", name: "다른 상품" },
  ]);
  assert.equal(products.length, 2);
  assert.equal(products[0].articleNumber, "JI0079");
  assert.equal(products[0].name, "원본");
  assert.deepEqual(products.map((product) => product.rank), [1, 2]);
});
