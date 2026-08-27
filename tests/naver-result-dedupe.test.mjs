import test from "node:test";
import assert from "node:assert/strict";
import { dedupeNaverOverlappingProducts } from "../services/naver-result-dedupe.mjs";

const base = {
  articleNumber: "B75806",
  title: "아디다스 삼바 OG B75806",
  price: 149000,
};

test("same Naver product URL is shown once even across channels", () => {
  const products = dedupeNaverOverlappingProducts([
    { ...base, store: "브랜드직영몰", url: "https://shopping.naver.com/product/123?utm_source=a" },
    { ...base, store: "백화점", url: "https://shopping.naver.com/product/123?utm_source=b" },
    { ...base, store: "아울렛", url: "https://shopping.naver.com/product/123" },
  ]);
  assert.equal(products.length, 1);
  assert.equal(products[0].store, "브랜드직영몰");
});

test("different Naver URLs still collapse when article title and price are the same generic-channel result", () => {
  const products = dedupeNaverOverlappingProducts([
    { ...base, store: "브랜드직영몰", url: "https://shopping.naver.com/window/a/111" },
    { ...base, store: "백화점", url: "https://shopping.naver.com/window/b/222" },
  ]);
  assert.equal(products.length, 1);
});

test("different actual retailers are preserved", () => {
  const products = dedupeNaverOverlappingProducts([
    { ...base, store: "네이버 패션타운", retailerName: "신세계백화점", url: "https://example.com/1" },
    { ...base, store: "네이버 패션타운", retailerName: "롯데백화점", url: "https://example.com/2" },
  ]);
  assert.equal(products.length, 2);
});

test("different prices are preserved when no actual retailer name is available", () => {
  const products = dedupeNaverOverlappingProducts([
    { ...base, store: "백화점", price: 149000, url: "https://example.com/1" },
    { ...base, store: "아울렛", price: 129000, url: "https://example.com/2" },
  ]);
  assert.equal(products.length, 2);
});

test("non-Naver sources are not collapsed by the Naver dedupe helper", () => {
  const products = dedupeNaverOverlappingProducts([
    { ...base, store: "무신사", url: "https://www.musinsa.com/products/1" },
    { ...base, store: "무신사", url: "https://www.musinsa.com/products/1" },
  ]);
  assert.equal(products.length, 2);
});
