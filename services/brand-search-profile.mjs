export const BRAND_SEARCH_STRATEGIES = [
  "brand_code",
  "code_only",
  "brand_title",
  "title_only",
  "combined",
];

export function brandSearchProfileKey(brand = "", brandId = "") {
  const id = String(brandId || "").trim();
  if (id) return `id:${id}`;
  return `name:${String(brand || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]/g, "")}`;
}

function strategyStats(profile, strategy) {
  const value = profile?.strategies?.[strategy] || {};
  return {
    attempts: Math.max(0, Number(value.attempts || 0)),
    exactMatches: Math.max(0, Number(value.exactMatches || 0)),
    failures: Math.max(0, Number(value.failures || 0)),
  };
}

export function selectBrandSearchStrategy(profile = {}) {
  const proven = BRAND_SEARCH_STRATEGIES
    .map((strategy, order) => ({ strategy, order, ...strategyStats(profile, strategy) }))
    .filter((row) => row.exactMatches > 0)
    .sort((left, right) =>
      (right.exactMatches / Math.max(1, right.attempts)) - (left.exactMatches / Math.max(1, left.attempts))
      || right.exactMatches - left.exactMatches
      || left.order - right.order
    );
  if (proven.length) return proven[0].strategy;
  const attempts = BRAND_SEARCH_STRATEGIES.reduce((sum, strategy) =>
    sum + strategyStats(profile, strategy).attempts, 0);
  return BRAND_SEARCH_STRATEGIES[attempts % BRAND_SEARCH_STRATEGIES.length];
}

export function recordBrandSearchOutcome(profiles = {}, {
  brand = "",
  brandId = "",
  strategy = "brand_code",
  exactMatch = false,
  resultCount = 0,
  now = new Date().toISOString(),
} = {}) {
  const key = brandSearchProfileKey(brand, brandId);
  if (key === "name:") return profiles;
  const safeStrategy = BRAND_SEARCH_STRATEGIES.includes(strategy) ? strategy : BRAND_SEARCH_STRATEGIES[0];
  const current = profiles[key] || {};
  const stats = strategyStats(current, safeStrategy);
  const next = {
    ...profiles,
    [key]: {
      ...current,
      brand: String(brand || current.brand || ""),
      brandId: String(brandId || current.brandId || ""),
      preferredStrategy: exactMatch ? safeStrategy : selectBrandSearchStrategy(current),
      lastResultCount: Math.max(0, Number(resultCount || 0)),
      lastVerifiedAt: exactMatch ? now : String(current.lastVerifiedAt || ""),
      updatedAt: now,
      strategies: {
        ...(current.strategies || {}),
        [safeStrategy]: {
          attempts: stats.attempts + 1,
          exactMatches: stats.exactMatches + (exactMatch ? 1 : 0),
          failures: stats.failures + (exactMatch ? 0 : 1),
        },
      },
    },
  };
  const entries = Object.entries(next).sort((left, right) =>
    String(right[1]?.updatedAt || "").localeCompare(String(left[1]?.updatedAt || ""))
  ).slice(0, 500);
  return Object.fromEntries(entries);
}

export function brandSearchQueries({ strategy = "brand_code", brand = "", articleNumber = "", title = "", query = "" } = {}) {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

  // 모든 국내 쇼핑몰은 사용자 지정 고정 우선순위를 사용한다.
  // 1순위: 상품명 + 상품코드
  // 2순위: 상품명
  // 3순위: 상품코드
  // 이전 검색 성공률(profile)이나 strategy 값으로 순서를 변경하지 않는다.
  // 호출부는 현재 검색 결과가 확정적으로 없을 때에만 다음 검색어로 진행한다.
  const fixedPriority = [
    clean([title, articleNumber].filter(Boolean).join(" ")),
    clean(title),
    clean(articleNumber),
  ];

  return [...new Set(fixedPriority.filter(Boolean))];
}
