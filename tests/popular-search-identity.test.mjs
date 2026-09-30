import test from "node:test";
import assert from "node:assert/strict";
import { popularSearchBrand, popularSearchArticle } from "../services/popular-search-identity.mjs";
import { queryDomesticProducts } from "../relay/domestic-search.mjs";

test("popular Crocs export supplies a searchable brand and exact article without changing the raw workbook", async () => {
  const raw = "207521-0 01 BLACK";
  const brand = popularSearchBrand("Crocs Crush Clog 5.2cm Unisex Black");
  const article = popularSearchArticle(raw, brand);
  assert.equal(brand, "크록스");
  assert.equal(article, "207521-001");
  assert.equal(raw, "207521-0 01 BLACK");
  const result = await queryDomesticProducts({
    query: `${brand} ${article}`, articleNumber: article, brand,
    title: "Crocs Crush Clog 5.2cm Unisex Black",
    enabledSourceGroups: ["official", "naver"],
  });
  assert.equal(result.queryCandidates[0], "207521-001");
  assert.ok(result.sources.some((source) => source.store === "브랜드 공식몰"
    && source.officialSearchUrl === "https://www.crocs.co.kr/search?q=207521-001"));
});

test("popular search identity does not guess a brand inside an unrelated title or rewrite another brand code", () => {
  assert.equal(popularSearchBrand("Inspired by Crocs Crush Clog"), "");
  assert.equal(popularSearchArticle("KE3526 BLACK", "아디다스"), "KE3526 BLACK");
});
