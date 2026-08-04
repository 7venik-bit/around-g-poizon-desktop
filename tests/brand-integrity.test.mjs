import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeBrandMatch,
  analyzeBrandValues,
  brandExportLabel,
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
  assert.equal(brandsMatch("Nike", "Jordan"), true);
  assert.equal(brandsMatch("나이키", "조던"), true);
  assert.equal(brandsMatch("Nike_Jordan", "Nike"), true);
  assert.equal(brandsMatch("Nike_Jordan", "Jordan"), true);
  assert.equal(brandsMatch("Jordan", "Nike"), false);
  assert.equal(brandsMatch("Crocs", "크록스"), true);
});

test("blocks a Jordan workbook downloaded for Crocs", () => {
  const result = analyzeBrandValues(["Crocs", "크록스"], Array.from({ length: 200 }, () => "조던"));
  assert.equal(result.ok, false);
  assert.equal(result.dominantBrand, "조던");
  assert.equal(result.ratio, 0);
  assert.match(brandMismatchMessage(result), /요청: Crocs/);
});

test("accepts Crocs localized workbook values at the 80 percent threshold", () => {
  const observed = [
    ...Array.from({ length: 8 }, () => "크록스"),
    ...Array.from({ length: 2 }, () => "Crocs Kids"),
  ];
  assert.equal(analyzeBrandValues(["Crocs", "크록스"], observed).ok, true);
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


test("uses separate export labels for Nike, Jordan, Adidas, and Adidas Originals", () => {
  assert.equal(brandExportLabel("Nike"), "Nike");
  assert.equal(brandExportLabel("나이키"), "Nike");
  assert.equal(brandExportLabel("Jordan"), "Jordan");
  assert.equal(brandExportLabel("조던"), "Jordan");
  assert.equal(brandExportLabel("Adidas"), "Adidas");
  assert.equal(brandExportLabel("아디다스클래식"), "Adidas_Originals");
  assert.equal(brandExportLabel("ADIDAS ORIGINALS"), "Adidas_Originals");
});

test("accepts Nike and Jordan workbooks for the Nike_Jordan bundle", () => {
  const mixed = [
    ...Array.from({ length: 2 }, () => ({ brandName: "나이키" })),
    ...Array.from({ length: 8 }, () => ({ brandName: "조던" })),
  ];
  assert.equal(analyzeBrandMatch("Nike_Jordan", mixed).ok, true);
  assert.equal(analyzeBrandMatch("Nike", Array.from({ length: 10 }, () => ({ brandName: "조던" }))).ok, true);
});
