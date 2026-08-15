import assert from "node:assert/strict";
import test from "node:test";
import {
  brandSearchProfileKey,
  brandSearchQueries,
  recordBrandSearchOutcome,
  selectBrandSearchStrategy,
} from "../services/brand-search-profile.mjs";

test("브랜드별 정확 일치 검색방식을 저장하고 다음 검색에서 우선 사용한다", () => {
  let profiles = {};
  profiles = recordBrandSearchOutcome(profiles, {
    brand: "Nike", brandId: 144, strategy: "brand_code", exactMatch: true, resultCount: 2,
    now: "2026-08-15T10:00:00.000Z",
  });
  const profile = profiles[brandSearchProfileKey("Nike", 144)];
  assert.equal(profile.strategies.brand_code.exactMatches, 1);
  assert.equal(profile.lastResultCount, 2);
  assert.equal(selectBrandSearchStrategy(profile), "brand_code");
});

test("정확 일치가 없으면 다음 검색방식으로 순환하고 거짓 성공을 학습하지 않는다", () => {
  const profiles = recordBrandSearchOutcome({}, {
    brand: "MLB", strategy: "brand_code", exactMatch: false, resultCount: 4,
  });
  const profile = profiles[brandSearchProfileKey("MLB")];
  assert.equal(profile.strategies.brand_code.exactMatches, 0);
  assert.equal(profile.strategies.brand_code.failures, 1);
  assert.equal(selectBrandSearchStrategy(profile), "code_only");
});

test("검색전략에 따라 첫 검색어만 바꾸고 나머지 교차검색 후보도 보존한다", () => {
  const queries = brandSearchQueries({
    strategy: "brand_title", brand: "Descente", articleNumber: "SR123UTS11",
    title: "티프 폴로 반팔 티셔츠", query: "Descente SR123UTS11 티프 폴로 반팔 티셔츠",
  });
  assert.equal(queries[0], "Descente 티프 폴로 반팔 티셔츠");
  assert.ok(queries.includes("Descente SR123UTS11"));
  assert.ok(queries.includes("SR123UTS11"));
});

test("저장 프로필은 최근 사용 브랜드 500개까지만 유지한다", () => {
  let profiles = {};
  for (let index = 0; index < 510; index += 1) {
    profiles = recordBrandSearchOutcome(profiles, {
      brand: `Brand ${index}`, strategy: "brand_code", exactMatch: index % 2 === 0,
      now: new Date(Date.UTC(2026, 7, 15, 0, 0, index)).toISOString(),
    });
  }
  assert.equal(Object.keys(profiles).length, 500);
});
