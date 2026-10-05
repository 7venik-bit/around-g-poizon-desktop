import test from "node:test";
import assert from "node:assert/strict";
import {
  RETAILER_SEARCH_STAGES,
  hasRetailerBrandEvidence,
  runRetailerSearchPipeline,
  queryDomesticProducts,
} from "../relay/domestic-search.mjs";

const urlFor = (query) => `https://shop.test/search?q=${encodeURIComponent(query)}`;

test("pipeline follows the login-search-badge-identity-stock-data order", () => {
  assert.deepEqual(
    RETAILER_SEARCH_STAGES.map((stage) => stage.label),
    ["로그인", "상품검색", "로고확인", "상품인식", "재고확인", "데이터"],
  );
});

test("login gate blocks before any network request", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("MUST_NOT_FETCH"); };
  for (const source of [{ store: "무신사", loginRequired: true }, { store: "SSG", securityVerificationRequired: true }]) {
    const result = await runRetailerSearchPipeline({
      source,
      queryCandidates: ["JI0079"],
      candidateUrlFor: urlFor,
      parser: () => [{ id: "1" }],
      fetchImpl,
    });
    assert.equal(result.blocked, true);
    assert.equal(result.blockStage, "login");
    assert.deepEqual(result.products, []);
    assert.equal(result.searchSubmitted, false);
    assert.equal(result.absenceConfirmed, false);
  }
  assert.equal(calls, 0);
});

test("ordered candidates stop at the first hit without fabricating absence", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    const hit = String(url).includes(encodeURIComponent("TITLE JI0079"));
    return { ok: true, text: async () => (hit ? "<div>HIT</div>" : "<div>EMPTY</div>") };
  };
  const result = await runRetailerSearchPipeline({
    source: { store: "코오롱몰" },
    queryCandidates: ["JI0079", "TITLE JI0079", "TITLE JI0079 JI0079"],
    candidateUrlFor: urlFor,
    parser: (html) => (String(html).includes("HIT") ? [{ id: "1", price: 1000 }] : []),
    fetchImpl,
  });
  assert.deepEqual(result.attemptedQueries, ["JI0079", "TITLE JI0079"]);
  assert.equal(result.successfulQuery, "TITLE JI0079");
  assert.equal(result.searchSubmitted, true);
  assert.equal(result.searchCompleted, true);
  assert.equal(result.presenceConfirmed, true);
  assert.equal(result.absenceConfirmed, false);
  assert.equal(seen.length, 2);
});

test("empty candidates complete the search but never confirm absence", async () => {
  const result = await runRetailerSearchPipeline({
    source: { store: "코오롱몰" },
    queryCandidates: ["JI0079"],
    candidateUrlFor: urlFor,
    parser: () => [],
    fetchImpl: async () => ({ ok: true, text: async () => "<div>EMPTY</div>" }),
  });
  assert.deepEqual(result.products, []);
  assert.equal(result.searchSubmitted, true);
  assert.equal(result.searchCompleted, true);
  assert.equal(result.presenceConfirmed, false);
  assert.equal(result.absenceConfirmed, false);
});

test("logo evidence requires an official or department logo", () => {
  assert.equal(hasRetailerBrandEvidence([{ price: 1000 }]), false);
  assert.equal(hasRetailerBrandEvidence([{ brandVerifiedFromCard: false }]), false);
  // A bare brand-name match is not a logo: parallel importers print it too.
  assert.equal(hasRetailerBrandEvidence([{ brandVerifiedFromCard: true }]), false);
  assert.equal(hasRetailerBrandEvidence([{ officialStoreVerified: true }]), true);
  assert.equal(hasRetailerBrandEvidence([{ departmentStoreLabelMatched: true }]), true);
  assert.equal(hasRetailerBrandEvidence([{ naverTrustedChannelEvidence: true }]), true);
});

test("stock enrichment runs only after products are recognized", async () => {
  let enrichCalls = 0;
  const enriched = await runRetailerSearchPipeline({
    source: { store: "무신사" },
    queryCandidates: ["JI0079"],
    candidateUrlFor: urlFor,
    parser: () => [{ id: "1", price: 50000 }],
    fetchImpl: async () => ({ ok: true, text: async () => "<div>HIT</div>" }),
    enrichOptions: async (products) => {
      enrichCalls += 1;
      return products.map((product) => ({ ...product, stockVerified: true }));
    },
  });
  assert.equal(enrichCalls, 1);
  assert.equal(enriched.stockChecked, true);

  const empty = await runRetailerSearchPipeline({
    source: { store: "무신사" },
    queryCandidates: ["JI0079"],
    candidateUrlFor: urlFor,
    parser: () => [],
    fetchImpl: async () => ({ ok: true, text: async () => "<div>EMPTY</div>" }),
    enrichOptions: async (products) => { enrichCalls += 1; return products; },
  });
  assert.equal(empty.stockChecked, false);
  assert.equal(enrichCalls, 1);
});

test("queryDomesticProducts carries pipeline flags without changing the result shape", async () => {
  const emptyNextData = '<script id="__NEXT_DATA__" type="application/json">' +
    '{"props":{"pageProps":{"dehydratedState":{"queries":[]}}}}</script>';
  const data = await queryDomesticProducts({
    query: "JI0079",
    articleNumber: "JI0079",
    brand: "브랜드",
    title: "상품",
    enabledSourceGroups: ["musinsa"],
    fetchImpl: async () => ({ ok: true, text: async () => emptyNextData }),
  });
  const musinsa = data.sources.find((source) => source.store === "무신사");
  assert.ok(musinsa);
  assert.equal(musinsa.ok, true);
  assert.equal(musinsa.searchSubmitted, true);
  assert.equal(musinsa.searchCompleted, true);
  assert.equal(musinsa.absenceConfirmed ?? false, false);
  assert.deepEqual(data.products, []);
  assert.ok(Array.isArray(musinsa.searchAttempts) && musinsa.searchAttempts.length > 0);
});
