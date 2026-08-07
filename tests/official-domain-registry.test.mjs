import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICIAL_DOMAIN_STATUS,
  VERIFIED_OFFICIAL_BRANDS,
  createOfficialDomainRegistry,
  auditedOfficialDomainRecord,
  failedOfficialDomainAuditRecord,
  officialDomainRecordForBrand,
  officialDomainDiscoveryUrl,
  officialDomainRegistrySummary,
  officialSearchUrlFromRecord,
  rankOfficialDomainCandidates,
  validateOfficialDomainCandidate,
} from "../services/official-domain-registry.mjs";

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

test("curated official stores are verified and build direct product searches", () => {
  assert.equal(VERIFIED_OFFICIAL_BRANDS.length, 10);
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
