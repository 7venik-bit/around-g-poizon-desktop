export const OFFICIAL_DOMAIN_STATUS = Object.freeze({
  VERIFIED: "verified",
  PENDING: "pending",
  NO_OFFICIAL_STORE: "no_official_store",
  SEARCH_UNSUPPORTED: "search_unsupported",
});

export const VERIFIED_OFFICIAL_BRANDS = Object.freeze([
  { name: "아디다스", aliases: ["adidas", "adidas originals", "아디다스"], domain: "adidas.co.kr", homepageUrl: "https://www.adidas.co.kr/", searchTemplate: "https://www.adidas.co.kr/search?q={query}" },
  { name: "나이키", aliases: ["nike", "jordan", "나이키", "조던"], domain: "nike.com", homepageUrl: "https://www.nike.com/kr/", searchTemplate: "https://www.nike.com/kr/w?q={query}&vst={query}" },
  { name: "뉴발란스", aliases: ["new balance", "newbalance", "뉴발란스"], domain: "nbkorea.com", homepageUrl: "https://www.nbkorea.com/", searchTemplate: "https://www.nbkorea.com/product/searchResult.action?schWord={query}" },
  { name: "푸마", aliases: ["puma", "푸마"], domain: "puma.com", homepageUrl: "https://kr.puma.com/kr/ko/", searchTemplate: "https://kr.puma.com/kr/ko/search?q={query}" },
  { name: "언더아머", aliases: ["under armour", "underarmour", "언더아머"], domain: "underarmour.co.kr", homepageUrl: "https://www.underarmour.co.kr/ko-kr/", searchTemplate: "https://www.underarmour.co.kr/ko-kr/search/?q={query}" },
  { name: "아식스", aliases: ["asics", "아식스"], domain: "asics.com", homepageUrl: "https://www.asics.com/kr/ko-kr/", searchTemplate: "https://www.asics.com/kr/ko-kr/search/?q={query}" },
  { name: "반스", aliases: ["vans", "반스"], domain: "vans.co.kr", homepageUrl: "https://www.vans.co.kr/", searchTemplate: "https://www.vans.co.kr/search?query={query}" },
  { name: "크록스", aliases: ["crocs", "크록스"], domain: "crocs.co.kr", homepageUrl: "https://www.crocs.co.kr/", searchTemplate: "https://www.crocs.co.kr/search?q={query}" },
  { name: "데상트", aliases: ["descente", "데상트"], domain: "dk-on.com", homepageUrl: "https://dk-on.com/DESCENTE", searchTemplate: "https://dk-on.com/DESCENTE/search?keyword={query}" },
  { name: "MLB", aliases: ["mlb", "엠엘비"], domain: "mlb-korea.com", homepageUrl: "https://www.mlb-korea.com/?gf=A", searchTemplate: "https://www.mlb-korea.com/search?searchText={query}&gf=A", interactiveSearch: true },
  { name: "온", aliases: ["on", "on running", "onrunning", "온", "온러닝"], domain: "on.com", homepageUrl: "https://www.on.com/ko-kr/", searchTemplate: "https://www.on.com/ko-kr/search?q={query}" },
]);

const BLOCKED_CANDIDATE_HOSTS = [
  "naver.com", "musinsa.com", "ssg.com", "coupang.com", "11st.co.kr", "gmarket.co.kr",
  "auction.co.kr", "lotteon.com", "kream.co.kr", "stockx.com", "amazon.com", "ebay.com",
  "wikipedia.org", "instagram.com", "facebook.com", "youtube.com", "tiktok.com",
];

export function normalizeOfficialBrand(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "")
    .trim();
}

export function verifiedOfficialBrand(value) {
  const normalized = normalizeOfficialBrand(value);
  if (!normalized) return null;
  return VERIFIED_OFFICIAL_BRANDS.find((entry) => entry.aliases.some((alias) => {
    const normalizedAlias = normalizeOfficialBrand(alias);
    return normalized === normalizedAlias || normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized);
  })) || null;
}

function brandRegistryId(brand) {
  const id = String(brand?.id ?? brand?.brandId ?? "").trim();
  return id ? `id:${id}` : `name:${normalizeOfficialBrand(brand?.ko || brand?.name)}`;
}

export function createOfficialDomainRegistry(brands, existing = []) {
  const previous = Array.isArray(existing) ? existing : [];
  const previousById = new Map(previous.map((record) => [record.registryId, record]));
  const previousByName = new Map(previous.flatMap((record) =>
    [record.brandName, record.brandKo]
      .map(normalizeOfficialBrand)
      .filter(Boolean)
      .map((name) => [name, record])));
  return (Array.isArray(brands) ? brands : []).map((brand) => {
    const saved = previousById.get(brandRegistryId(brand))
      || previousByName.get(normalizeOfficialBrand(brand?.name))
      || previousByName.get(normalizeOfficialBrand(brand?.ko))
      || null;
    const seed = verifiedOfficialBrand(brand?.ko || brand?.name) || verifiedOfficialBrand(brand?.name);
    const base = {
      registryId: brandRegistryId(brand),
      brandId: Number(brand?.id ?? brand?.brandId) || 0,
      brandName: String(brand?.name || "").trim(),
      brandKo: String(brand?.ko || brand?.name || "").trim(),
      brandLogoUrl: String(brand?.logoUrl || "").trim(),
      status: OFFICIAL_DOMAIN_STATUS.PENDING,
      domain: "",
      homepageUrl: "",
      searchTemplate: "",
      interactiveSearch: false,
      candidateUrl: "",
      verificationSource: "",
      verifiedAt: "",
      verifiedAliases: [],
    };
    if (saved) Object.assign(base, saved, {
      registryId: brandRegistryId(brand),
      brandId: Number(brand?.id ?? brand?.brandId) || saved.brandId || 0,
      brandName: String(brand?.name || saved.brandName || "").trim(),
      brandKo: String(brand?.ko || brand?.name || saved.brandKo || "").trim(),
      brandLogoUrl: String(brand?.logoUrl || saved.brandLogoUrl || "").trim(),
    });
    if (seed && base.status !== OFFICIAL_DOMAIN_STATUS.VERIFIED) {
      Object.assign(base, {
        status: OFFICIAL_DOMAIN_STATUS.VERIFIED,
        domain: seed.domain,
        homepageUrl: seed.homepageUrl,
        searchTemplate: seed.searchTemplate,
        interactiveSearch: seed.interactiveSearch === true,
        verificationSource: "curated",
        verifiedAt: "2026-08-07T00:00:00.000Z",
        verifiedAliases: [...seed.aliases],
      });
    }
    return base;
  });
}

export function officialDomainRecordForBrand(registry, brand) {
  const normalized = normalizeOfficialBrand(brand);
  if (!normalized) return null;
  const rows = Array.isArray(registry) ? registry : [];
  const exact = rows.find((record) =>
    [record.brandName, record.brandKo].map(normalizeOfficialBrand).some((name) => name === normalized));
  if (exact) return exact;
  if (normalized.length < 4) return null;
  return rows.find((record) =>
    [record.brandName, record.brandKo].map(normalizeOfficialBrand).some((name) =>
      name.length >= 4 && (name.includes(normalized) || normalized.includes(name)))) || null;
}

export function officialDomainSearchAliases(record) {
  if (![OFFICIAL_DOMAIN_STATUS.VERIFIED, OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED].includes(record?.status)) return [];
  return [...new Set([
    record?.brandName,
    record?.brandKo,
    ...(Array.isArray(record?.verifiedAliases) ? record.verifiedAliases : []),
  ].map((value) => String(value || "").trim()).filter(Boolean))];
}

export function officialSearchUrlFromRecord(record, query) {
  if (record?.status !== OFFICIAL_DOMAIN_STATUS.VERIFIED || !record.searchTemplate) return "";
  return String(record.searchTemplate).replaceAll("{query}", encodeURIComponent(String(query || "").trim()));
}

export function officialDomainRegistrySummary(registry) {
  const summary = { total: 0, inspected: 0, unchecked: 0, checked: 0, remaining: 0, verified: 0, pending: 0, noOfficialStore: 0, searchUnsupported: 0 };
  for (const record of Array.isArray(registry) ? registry : []) {
    summary.total += 1;
    if (record.verifiedAt || record.lastCheckedAt) summary.inspected += 1;
    if (record.status === OFFICIAL_DOMAIN_STATUS.VERIFIED) summary.verified += 1;
    else if (record.status === OFFICIAL_DOMAIN_STATUS.NO_OFFICIAL_STORE) summary.noOfficialStore += 1;
    else if (record.status === OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED) summary.searchUnsupported += 1;
    else summary.pending += 1;
  }
  summary.checked = summary.verified + summary.noOfficialStore + summary.searchUnsupported;
  summary.remaining = Math.max(0, summary.total - summary.checked);
  summary.unchecked = Math.max(0, summary.total - summary.inspected);
  return summary;
}

export function officialDomainAuditQueue(registry) {
  const rows = Array.isArray(registry) ? registry : [];
  const pending = rows.map((record, index) => ({ record, index }))
    .filter(({ record }) => record?.status === OFFICIAL_DOMAIN_STATUS.PENDING);
  const unchecked = pending.filter(({ record }) => !record.lastCheckedAt);
  const attempted = pending.filter(({ record }) => record.lastCheckedAt)
    .sort((left, right) =>
      Number(left.record.verificationAttempts || 0) - Number(right.record.verificationAttempts || 0)
      || Date.parse(left.record.lastCheckedAt || 0) - Date.parse(right.record.lastCheckedAt || 0));
  // Finish one complete pass before retrying unresolved brands. This prevents
  // every resume from starting again at the first unresolved record.
  return [...unchecked, ...attempted].map(({ index }) => index);
}

export function officialDomainDiscoveryUrl(brand, alternateBrand = "") {
  const names = [...new Set([brand, alternateBrand].map((value) => String(value || "").trim()).filter(Boolean))];
  const terms = [...names, "공식 홈페이지"].join(" ");
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(terms)}`;
}

function candidateHost(url) {
  try {
    return new URL(String(url || "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function rankOfficialDomainCandidates(candidates, brand) {
  const unique = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const url = String(candidate?.url || "").trim();
    const title = String(candidate?.title || "").trim();
    const validation = validateOfficialDomainCandidate({
      brand,
      candidateUrl: url,
      pageTitle: title,
      logoSimilarity: candidate?.logoSimilarity,
    });
    if (!validation.valid) continue;
    const host = candidateHost(url);
    if (!host || unique.has(host)) continue;
    const brandKey = normalizeOfficialBrand(brand);
    const hostKey = normalizeOfficialBrand(host);
    const titleKey = normalizeOfficialBrand(title);
    const score = (hostKey.includes(brandKey) ? 60 : 0)
      + (titleKey.includes(brandKey) ? 30 : 0)
      + (/공식|official|official site|공식 홈페이지/i.test(title) ? 25 : 0)
      + (Number(candidate?.logoSimilarity || 0) >= 0.88 ? 45 : 0)
      + (String(candidate?.rel || "").includes("noopener") ? 1 : 0);
    if (score >= 50) unique.set(host, {
      url, title, host, score,
      imageUrl: String(candidate?.imageUrl || ""),
      logoSimilarity: Number(candidate?.logoSimilarity || 0),
    });
  }
  return [...unique.values()].sort((left, right) => right.score - left.score).slice(0, 5);
}

export function rankNaverOfficialStoreCandidates(candidates, brand) {
  const brandKey = normalizeOfficialBrand(brand);
  if (!brandKey) return [];
  const unique = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    let parsed;
    try { parsed = new URL(String(candidate?.url || "")); } catch { continue; }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "brand.naver.com") continue;
    const evidence = normalizeOfficialBrand(`${candidate?.title || ""} ${parsed.pathname}`);
    if (!evidence.includes(brandKey)) continue;
    const slug = parsed.pathname.split("/").filter(Boolean)[0];
    if (!slug || unique.has(slug)) continue;
    unique.set(slug, {
      url: `https://brand.naver.com/${slug}`,
      title: String(candidate?.title || ""),
      slug,
      score: /공식|official|브랜드스토어/i.test(String(candidate?.title || "")) ? 100 : 70,
    });
  }
  return [...unique.values()].sort((a, b) => b.score - a.score);
}

export function naverOfficialStoreRecord(record, candidate, now = new Date().toISOString()) {
  const slug = String(candidate?.slug || "").trim();
  if (!slug) return failedOfficialDomainAuditRecord(record, "NAVER_OFFICIAL_STORE_INVALID", now);
  return {
    ...record,
    status: OFFICIAL_DOMAIN_STATUS.VERIFIED,
    domain: "brand.naver.com",
    homepageUrl: `https://brand.naver.com/${slug}`,
    searchTemplate: `https://brand.naver.com/${slug}/search?q={query}`,
    candidateUrl: `https://brand.naver.com/${slug}`,
    verificationSource: "naver-official-brand-store",
    verifiedAt: now,
    verificationAttempts: Number(record?.verificationAttempts || 0) + 1,
    lastCheckedAt: now,
    lastVerificationError: "",
  };
}

export function noOfficialStoreRecord(record, now = new Date().toISOString()) {
  return {
    ...record,
    status: OFFICIAL_DOMAIN_STATUS.NO_OFFICIAL_STORE,
    domain: "",
    homepageUrl: "",
    searchTemplate: "",
    verificationSource: "domestic-homepage-and-naver-store-not-found",
    verificationAttempts: Number(record?.verificationAttempts || 0) + 1,
    lastCheckedAt: now,
    lastVerificationError: "",
  };
}

export function auditedOfficialDomainRecord(record, evidence, now = new Date().toISOString()) {
  const validation = validateOfficialDomainCandidate({
    brand: record?.brandKo || record?.brandName,
    candidateUrl: evidence?.finalUrl || evidence?.candidateUrl,
    pageTitle: evidence?.pageTitle,
    pageText: evidence?.pageText,
    logoSimilarity: evidence?.logoSimilarity,
  });
  const attempts = Number(record?.verificationAttempts || 0) + 1;
  if (!validation.valid) {
    return {
      ...record,
      status: OFFICIAL_DOMAIN_STATUS.PENDING,
      candidateUrl: String(evidence?.candidateUrl || ""),
      verificationAttempts: attempts,
      lastCheckedAt: now,
      lastVerificationError: validation.reason,
    };
  }
  let searchTemplate = String(evidence?.searchTemplate || "").trim();
  try {
    const searchHost = new URL(searchTemplate.replace("{query}", "test")).hostname.toLowerCase().replace(/^www\./, "");
    const verifiedHost = validation.domain.toLowerCase().replace(/^www\./, "");
    const related = searchHost === verifiedHost
      || searchHost.endsWith(`.${verifiedHost}`)
      || verifiedHost.endsWith(`.${searchHost}`);
    if (!related) searchTemplate = "";
  } catch {
    searchTemplate = "";
  }
  return {
    ...record,
    status: searchTemplate ? OFFICIAL_DOMAIN_STATUS.VERIFIED : OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED,
    domain: validation.domain,
    homepageUrl: validation.homepageUrl,
    searchTemplate,
    candidateUrl: String(evidence?.candidateUrl || evidence?.finalUrl || ""),
    verificationSource: "automatic-page-evidence",
    verifiedAt: now,
    verificationAttempts: attempts,
    lastCheckedAt: now,
    lastVerificationError: "",
    verifiedAliases: [...new Set([
      record?.brandName,
      record?.brandKo,
      ...(Array.isArray(record?.verifiedAliases) ? record.verifiedAliases : []),
      evidence?.verifiedAlias,
    ].map((value) => String(value || "").trim()).filter(Boolean))],
    evidence: {
      finalUrl: String(evidence?.finalUrl || ""),
      pageTitle: String(evidence?.pageTitle || "").slice(0, 300),
      hasBrandEvidence: true,
      logoCompared: Boolean(evidence?.logoCompared),
      logoSimilarity: Number(evidence?.logoSimilarity || 0),
      hasSearchForm: Boolean(searchTemplate),
    },
  };
}

export function failedOfficialDomainAuditRecord(record, errorCode, now = new Date().toISOString()) {
  return {
    ...record,
    status: OFFICIAL_DOMAIN_STATUS.PENDING,
    verificationAttempts: Number(record?.verificationAttempts || 0) + 1,
    lastCheckedAt: now,
    lastVerificationError: String(errorCode || "OFFICIAL_DOMAIN_NOT_FOUND"),
  };
}

export function validateOfficialDomainCandidate({ brand, candidateUrl, pageTitle = "", pageText = "", logoSimilarity = 0 } = {}) {
  let parsed;
  try {
    parsed = new URL(String(candidateUrl || ""));
  } catch {
    return { valid: false, reason: "INVALID_URL" };
  }
  if (!["https:", "http:"].includes(parsed.protocol)) return { valid: false, reason: "INVALID_PROTOCOL" };
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (BLOCKED_CANDIDATE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
    return { valid: false, reason: "MARKETPLACE_OR_SOCIAL_DOMAIN" };
  }
  const seed = verifiedOfficialBrand(brand);
  const brandKeys = [brand, ...(seed?.aliases || [])].map(normalizeOfficialBrand).filter(Boolean);
  const rawEvidence = `${host} ${pageTitle} ${String(pageText).slice(0, 5000)}`;
  const evidence = normalizeOfficialBrand(rawEvidence);
  const evidenceTokens = rawEvidence.toLowerCase().split(/[^a-z0-9가-힣]+/).map(normalizeOfficialBrand).filter(Boolean);
  const matchesBrand = Number(logoSimilarity || 0) >= 0.88 || brandKeys.some((brandKey) => brandKey.length <= 3
    ? evidenceTokens.includes(brandKey)
    : evidence.includes(brandKey));
  if (!brandKeys.length || !matchesBrand) {
    return { valid: false, reason: "BRAND_EVIDENCE_MISSING" };
  }
  return { valid: true, domain: host, homepageUrl: `${parsed.protocol}//${parsed.host}/` };
}
