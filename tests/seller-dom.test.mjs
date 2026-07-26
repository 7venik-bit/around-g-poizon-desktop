import test from "node:test";
import assert from "node:assert/strict";
import { parseSellerDomNodes } from "../services/seller-dom.mjs";

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
