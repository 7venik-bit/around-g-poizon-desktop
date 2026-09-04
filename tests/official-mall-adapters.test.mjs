import test from "node:test";
import assert from "node:assert/strict";

import {
  officialMallAdapterId,
  officialMallAdapterRecord,
  officialMallAdapterSummary,
  officialMallDirectProductUrls,
  officialMallSearchTemplate,
} from "../services/official-mall-adapters.mjs";
import { queryDomesticProducts } from "../relay/domestic-search.mjs";

test("Descente adapter builds a direct official product candidate", () => {
  assert.equal(officialMallAdapterId({ brand: "데상트", domain: "dk-on.com" }), "descente-dk-on");
  assert.deepEqual(
    officialMallDirectProductUrls({ brand: "데상트", domain: "dk-on.com" }, "SR123UPS11"),
    ["https://dk-on.com/DESCENTE/product/SR123UPS11"],
  );
});

test("official-mall linkage batches register seventeen Korean adapters", () => {
  const cases = [
    ["아디다스", "adidas.co.kr", "adidas-kr"],
    ["나이키", "nike.com", "nike-kr"],
    ["뉴발란스", "nbkorea.com", "new-balance-kr"],
    ["푸마", "kr.puma.com", "puma-kr"],
    ["언더아머", "underarmour.co.kr", "under-armour-kr"],
    ["아식스", "asics.com", "asics-kr"],
    ["반스", "vans.co.kr", "vans-kr"],
    ["크록스", "crocs.co.kr", "crocs-kr"],
    ["데상트", "dk-on.com", "descente-dk-on"],
    ["MLB", "mlb-korea.com", "mlb-korea"],
    ["코오롱스포츠", "kolonmall.com", "kolon-sport"],
    ["온러닝", "on.com", "on-running-kr"],
    ["Keen", "keenfootwear.kr", "keen-kr"],
    ["New Era", "neweracapkorea.com", "new-era-kr"],
    ["Salomon", "salomon.co.kr", "salomon-kr"],
    ["Dickies", "dickieskr.com", "dickies-kr"],
    ["Discovery Expedition", "discovery-expedition.com", "discovery-expedition-kr"],
  ];
  for (const [brand, domain, adapterId] of cases) {
    assert.equal(officialMallAdapterId({ brand, domain }), adapterId, brand);
    if (brand !== "Dickies") assert.match(officialMallSearchTemplate({ brand, domain }), /\{query\}/, brand);
  }
});

test("Discovery adapter builds its exact official product-detail candidate", () => {
  assert.deepEqual(
    officialMallDirectProductUrls({ brand: "디스커버리", domain: "discovery-expedition.com" }, "DMRL39064-BKS"),
    ["https://www.discovery-expedition.com/product-detail/DMRL39064-BKS"],
  );
});

test("verified domain audit attaches a known search adapter even when the page hides its search form", () => {
  const linked = officialMallAdapterRecord({
    brandKo: "푸마", domain: "kr.puma.com", homepageUrl: "https://kr.puma.com/kr/ko/",
    status: "search_unsupported", searchTemplate: "",
  });
  assert.equal(linked.status, "verified");
  assert.equal(linked.adapterStatus, "dedicated");
  assert.equal(linked.adapterId, "puma-kr");
  assert.equal(linked.searchTemplate, "https://kr.puma.com/kr/ko/search?q={query}");
});

test("interactive Dickies linkage is dedicated without inventing a fixed search URL", () => {
  const linked = officialMallAdapterRecord({
    brandKo: "Dickies", domain: "dickieskr.com", homepageUrl: "https://dickieskr.com/online-store.html",
    status: "verified", searchTemplate: "", interactiveSearch: true,
  });
  assert.equal(linked.adapterStatus, "dedicated");
  assert.equal(linked.adapterId, "dickies-kr");
  assert.equal(linked.searchTemplate, "");
  assert.equal(linked.interactiveSearch, true);
});

test("full verification classifies dedicated, common, and pending linkage", () => {
  const dedicated = officialMallAdapterRecord({
    brandKo: "데상트", domain: "dk-on.com", homepageUrl: "https://dk-on.com/DESCENTE",
    status: "verified", searchTemplate: "https://dk-on.com/DESCENTE/search?keyword={query}",
  });
  const common = officialMallAdapterRecord({
    brandKo: "테스트", domain: "example.com", homepageUrl: "https://example.com",
    status: "verified", searchTemplate: "https://example.com/search?q={query}",
  });
  const pending = officialMallAdapterRecord({ brandKo: "대기", status: "pending" });
  assert.equal(dedicated.adapterStatus, "dedicated");
  assert.equal(common.adapterStatus, "common");
  assert.equal(pending.adapterStatus, "pending");
  assert.deepEqual(officialMallAdapterSummary([dedicated, common, pending]), {
    adapterDedicated: 1, adapterCommon: 1, adapterPending: 1, adapterUnavailable: 0,
  });
});

test("unknown official malls remain on the existing generic search path", () => {
  assert.equal(officialMallAdapterId({ brand: "테스트", domain: "example.com" }), "");
  assert.deepEqual(officialMallDirectProductUrls({ brand: "테스트", domain: "example.com" }, "ABC123"), []);
});

test("domestic search carries the sanitized Descente direct candidate", async () => {
  const result = await queryDomesticProducts({
    query: "데상트 SR123UPS11-服",
    articleNumber: "SR123UPS11-服",
    brand: "데상트",
    fetchImpl: async () => ({ ok: true, text: async () => "" }),
  });
  const official = result.sources.find((source) => source.store === "브랜드 공식몰");
  assert.equal(official.adapterId, "descente-dk-on");
  assert.deepEqual(official.directProductUrls, ["https://dk-on.com/DESCENTE/product/SR123UPS11"]);
  assert.equal(result.sources.find((source) => source.store === "무신사")?.adapterId, "");
});
