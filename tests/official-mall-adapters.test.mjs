import test from "node:test";
import assert from "node:assert/strict";

import {
  officialMallAdapterId,
  officialMallAdapterRecord,
  officialMallAdapterSummary,
  officialMallDirectProductUrls,
} from "../services/official-mall-adapters.mjs";
import { queryDomesticProducts } from "../relay/domestic-search.mjs";

test("Descente adapter builds a direct official product candidate", () => {
  assert.equal(officialMallAdapterId({ brand: "데상트", domain: "dk-on.com" }), "descente-dk-on");
  assert.deepEqual(
    officialMallDirectProductUrls({ brand: "데상트", domain: "dk-on.com" }, "SR123UPS11"),
    ["https://dk-on.com/DESCENTE/product/SR123UPS11"],
  );
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
