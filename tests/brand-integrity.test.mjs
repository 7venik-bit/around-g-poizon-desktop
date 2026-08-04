import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeBrandMatch,
  brandMismatchMessage,
  brandsMatch,
  normalizeBrandName,
} from "../services/brand-integrity.mjs";

test("normalizes punctuation and spacing", () => {
  assert.equal(normalizeBrandName(" New Balance "), "newbalance");
});

test("matches known localized aliases", () => {
  assert.equal(brandsMatch("Adidas", "아디다스"), true);
  assert.equal(brandsMatch("PUMA", "푸마"), true);
  assert.equal(brandsMatch("PUMA", "彪马"), true);
  assert.equal(brandsMatch("PUMA", "Jordan"), false);
  assert.equal(brandsMatch("Adidas", "Jordan"), false);
});

test("blocks a Jordan workbook labeled as Adidas", () => {
  const result = analyzeBrandMatch("Adidas", Array.from({ length: 993 }, () => ({ brandName: "Jordan" })));
  assert.equal(result.ok, false);
  assert.equal(result.dominantBrand, "Jordan");
  assert.match(brandMismatchMessage(result), /요청: Adidas/);
  assert.match(brandMismatchMessage(result), /주요 브랜드: Jordan/);
});

test("accepts a workbook when at least 80 percent matches", () => {
  const products = [
    ...Array.from({ length: 8 }, () => ({ brandName: "Adidas" })),
    ...Array.from({ length: 2 }, () => ({ brandName: "ADIDAS ORIGINALS" })),
  ];
  assert.equal(analyzeBrandMatch("아디다스", products).ok, true);
});

test("blocks missing brand data when an expected brand is supplied", () => {
  assert.equal(analyzeBrandMatch("Adidas", [{ title: "shoe" }]).ok, false);
});


test("blocks a Jordan workbook labeled as PUMA", () => {
  const result = analyzeBrandMatch("PUMA", Array.from({ length: 993 }, () => ({ brandName: "Jordan" })));
  assert.equal(result.ok, false);
  assert.equal(result.dominantBrand, "Jordan");
  assert.match(brandMismatchMessage(result), /요청: PUMA/);
});
