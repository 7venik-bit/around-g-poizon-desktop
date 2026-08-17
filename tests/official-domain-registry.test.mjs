import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICIAL_DOMAIN_STATUS,
  VERIFIED_OFFICIAL_BRANDS,
  createOfficialDomainRegistry,
  auditedOfficialDomainRecord,
  failedOfficialDomainAuditRecord,
  officialDomainRecordForBrand,
  officialDomainSearchAliases,
  officialDomainDiscoveryUrl,
  officialDomainAuditQueue,
  officialDomainRegistrySummary,
  officialSearchUrlFromRecord,
  rankOfficialDomainCandidates,
  rankNaverOfficialStoreCandidates,
  naverOfficialStoreRecord,
  noOfficialStoreRecord,
  validateOfficialDomainCandidate,
} from "../services/official-domain-registry.mjs";

test("audit resumes with unchecked brands before retrying unresolved brands", () => {
  const registry = [
    { status: OFFICIAL_DOMAIN_STATUS.PENDING, lastCheckedAt: "2026-08-08T01:00:00.000Z", verificationAttempts: 1 },
    { status: OFFICIAL_DOMAIN_STATUS.VERIFIED, verifiedAt: "2026-08-08T01:01:00.000Z" },
    { status: OFFICIAL_DOMAIN_STATUS.PENDING, lastCheckedAt: "", verificationAttempts: 0 },
    { status: OFFICIAL_DOMAIN_STATUS.PENDING, lastCheckedAt: "2026-08-08T02:00:00.000Z", verificationAttempts: 2 },
    { status: OFFICIAL_DOMAIN_STATUS.PENDING, lastCheckedAt: "", verificationAttempts: 0 },
  ];
  assert.deepEqual(officialDomainAuditQueue(registry), [2, 4, 0, 3]);
});

test("국내 공식 홈페이지 다음으로 네이버 공식 브랜드스토어만 연결한다", () => {
  const candidates = rankNaverOfficialStoreCandidates([
    { url: "https://brand.naver.com/salomon/search?q=shoe", title: "살로몬 공식 브랜드스토어" },
    { url: "https://smartstore.naver.com/random", title: "살로몬 판매점" },
    { url: "https://brand.naver.com/other", title: "다른 브랜드 공식몰" },
  ], "살로몬");
  assert.equal(candidates.length, 1);
  const [base] = createOfficialDomainRegistry([{ id: 1, name: "Salomon", ko: "살로몬" }]);
  const linked = naverOfficialStoreRecord(base, candidates[0]);
  assert.equal(linked.homepageUrl, "https://brand.naver.com/salomon");
  assert.equal(linked.searchTemplate, "https://brand.naver.com/salomon/search?q={query}");
  assert.equal(linked.verificationSource, "naver-official-brand-store");
});

test("국내 공식 홈페이지와 네이버 공식스토어가 모두 없으면 공식몰 없음이다", () => {
  const [base] = createOfficialDomainRegistry([{ id: 2, name: "No Store", ko: "공식몰없는브랜드" }]);
  const missing = noOfficialStoreRecord(base);
  assert.equal(missing.status, OFFICIAL_DOMAIN_STATUS.NO_OFFICIAL_STORE);
  assert.equal(missing.verificationSource, "domestic-homepage-and-naver-store-not-found");
});

test("the complete POIZON catalog gets an explicit official-domain status", () => {
  const brands = Array.from({ length: 3388 }, (_value, index) => ({
    id: index + 1,
    name: index === 0 ? "Nike" : `Brand ${index + 1}`,
    ko: index === 0 ? "나이키" : `브랜드 ${index + 1}`,
  }));
  const registry = createOfficialDomainRegistry(brands);
  const summary = officialDomainRegistrySummary(registry);
  assert.equal(registry.length, brands.length);
  assert.equal(summary.total, brands.length);
  assert.equal(summary.verified, 1);
  assert.equal(summary.pending, brands.length - 1);
  assert.equal(registry.every((record) => Object.values(OFFICIAL_DOMAIN_STATUS).includes(record.status)), true);
});

test("official-domain discovery ranks brand evidence and rejects marketplace noise", () => {
  assert.match(decodeURIComponent(officialDomainDiscoveryUrl("살로몬")), /살로몬 공식 홈페이지/);
  const candidates = rankOfficialDomainCandidates([
    { url: "https://search.naver.com/search.naver?query=살로몬", title: "네이버" },
    { url: "https://www.instagram.com/salomon/", title: "Salomon Instagram" },
    { url: "https://salomon.co.kr/", title: "살로몬 코리아 공식 홈페이지" },
  ], "살로몬");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].host, "salomon.co.kr");
});

test("a visited official page is checked separately from search support", () => {
  const [record] = createOfficialDomainRegistry([{ id: 77, name: "Salomon", ko: "살로몬" }]);
  const verified = auditedOfficialDomainRecord(record, {
    candidateUrl: "https://salomon.co.kr/",
    finalUrl: "https://salomon.co.kr/",
    pageTitle: "살로몬 코리아 공식 홈페이지",
    pageText: "살로몬 공식 온라인 스토어",
    searchTemplate: "https://salomon.co.kr/search?q={query}",
  }, "2026-08-07T03:00:00.000Z");
  assert.equal(verified.status, OFFICIAL_DOMAIN_STATUS.VERIFIED);
  assert.equal(verified.evidence.hasSearchForm, true);
  assert.deepEqual(
    officialDomainSearchAliases({ ...verified, verifiedAliases: ["Salomon", "살로몬"] }),
    ["Salomon", "살로몬"],
  );

  const unsupported = auditedOfficialDomainRecord(record, {
    candidateUrl: "https://salomon.co.kr/",
    pageTitle: "살로몬 코리아 공식 홈페이지",
    pageText: "살로몬 공식 온라인 스토어",
  });
  assert.equal(unsupported.status, OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED);

  const externalSearch = auditedOfficialDomainRecord(record, {
    candidateUrl: "https://salomon.co.kr/",
    pageTitle: "살로몬 코리아 공식 홈페이지",
    pageText: "살로몬 공식 온라인 스토어",
    searchTemplate: "https://www.google.com/search?q={query}",
  });
  assert.equal(externalSearch.status, OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED);

  const failed = failedOfficialDomainAuditRecord(record, "CANDIDATE_NOT_FOUND");
  assert.equal(failed.status, OFFICIAL_DOMAIN_STATUS.PENDING);
  assert.equal(failed.verificationAttempts, 1);
});

test("short ambiguous names require an exact POIZON-to-Naver registry match", () => {
  const registry = createOfficialDomainRegistry([
    { id: 1, name: "DKNY", ko: "디케이엔와이" },
    { id: 2, name: "DK", ko: "디케이" },
  ]);
  assert.equal(officialDomainRecordForBrand(registry, "DK")?.brandId, 2);
  assert.equal(officialDomainRecordForBrand(registry.slice(0, 1), "DK"), null);
});

test("curated official stores are verified and build direct product searches", () => {
  assert.equal(VERIFIED_OFFICIAL_BRANDS.length, 11);
  const registry = createOfficialDomainRegistry(VERIFIED_OFFICIAL_BRANDS.map((entry, index) => ({
    id: index + 1,
    name: entry.aliases[0],
    ko: entry.name,
  })));
  for (const record of registry) {
    assert.equal(record.status, OFFICIAL_DOMAIN_STATUS.VERIFIED);
    assert.equal(new URL(officialSearchUrlFromRecord(record, "STYLE 001")).protocol, "https:");
    assert.match(officialSearchUrlFromRecord(record, "STYLE 001"), /STYLE%20001/);
  }
});

test("MLB is linked to the Korean official mall internal search", () => {
  const mlb = VERIFIED_OFFICIAL_BRANDS.find((entry) => entry.name === "MLB");
  assert.equal(mlb.homepageUrl, "https://www.mlb-korea.com/?gf=A");
  assert.equal(mlb.interactiveSearch, true);
  assert.equal(mlb.searchTemplate, "https://www.mlb-korea.com/search?searchText={query}&gf=A");
});

test("On is linked to its Korean official homepage and exact article search", () => {
  const [record] = createOfficialDomainRegistry([{
    id: 555,
    name: "On",
    ko: "온",
    logoUrl: "https://poizon.example/on-logo.png",
  }]);
  assert.equal(record.status, OFFICIAL_DOMAIN_STATUS.VERIFIED);
  assert.equal(record.domain, "on.com");
  assert.equal(record.brandLogoUrl, "https://poizon.example/on-logo.png");
  assert.match(officialSearchUrlFromRecord(record, "3ME10100264"), /on\.com\/ko-kr\/search/);
});

test("strong logo evidence can recover a candidate whose short brand name is ambiguous", () => {
  const validation = validateOfficialDomainCandidate({
    brand: "온",
    candidateUrl: "https://official.example/",
    pageTitle: "Swiss performance running shoes",
    logoSimilarity: 0.92,
  });
  assert.equal(validation.valid, true);
});

test("existing reviewed records survive a catalog refresh", () => {
  const brands = [{ id: 77, name: "Salomon", ko: "살로몬" }];
  const registry = createOfficialDomainRegistry(brands, [{
    registryId: "id:77",
    brandId: 77,
    brandName: "Salomon",
    brandKo: "살로몬",
    status: OFFICIAL_DOMAIN_STATUS.VERIFIED,
    domain: "salomon.co.kr",
    homepageUrl: "https://salomon.co.kr/",
    searchTemplate: "https://salomon.co.kr/search?q={query}",
    verificationSource: "manual",
    verifiedAt: "2026-08-07T01:00:00.000Z",
  }]);
  const record = officialDomainRecordForBrand(registry, "살로몬");
  assert.equal(record.domain, "salomon.co.kr");
  assert.equal(record.verificationSource, "manual");
});

test("marketplaces cannot be promoted to an official domain", () => {
  assert.deepEqual(
    validateOfficialDomainCandidate({ brand: "푸마", candidateUrl: "https://search.naver.com/search.naver?query=푸마" }),
    { valid: false, reason: "MARKETPLACE_OR_SOCIAL_DOMAIN" }
  );
  const accepted = validateOfficialDomainCandidate({
    brand: "푸마",
    candidateUrl: "https://kr.puma.com/kr/ko/",
    pageTitle: "PUMA Korea 공식 온라인 스토어",
  });
  assert.equal(accepted.valid, true);
  assert.equal(accepted.domain, "kr.puma.com");
  assert.deepEqual(
    validateOfficialDomainCandidate({ brand: "On", candidateUrl: "https://shop.example.com/", pageTitle: "Online shoe store" }),
    { valid: false, reason: "BRAND_EVIDENCE_MISSING" }
  );
});
