import { normalizeOfficialBrand } from "./official-domain-registry.mjs";

const ADAPTERS = Object.freeze([
  {
    id: "adidas-kr",
    brands: ["아디다스", "adidas", "adidas originals"],
    domains: ["adidas.co.kr"],
    searchTemplate: "https://www.adidas.co.kr/search?q={query}",
  },
  {
    id: "nike-kr",
    brands: ["나이키", "nike", "jordan", "조던"],
    domains: ["nike.com"],
    searchTemplate: "https://www.nike.com/kr/w?q={query}&vst={query}",
  },
  {
    id: "new-balance-kr",
    brands: ["뉴발란스", "new balance", "newbalance"],
    domains: ["nbkorea.com"],
    searchTemplate: "https://www.nbkorea.com/product/searchResult.action?schWord={query}",
  },
  {
    id: "puma-kr",
    brands: ["푸마", "puma"],
    domains: ["puma.com"],
    searchTemplate: "https://kr.puma.com/kr/ko/search?q={query}",
  },
  {
    id: "under-armour-kr",
    brands: ["언더아머", "under armour", "underarmour"],
    domains: ["underarmour.co.kr"],
    searchTemplate: "https://www.underarmour.co.kr/ko-kr/search/?q={query}",
  },
  {
    id: "asics-kr",
    brands: ["아식스", "asics"],
    domains: ["asics.com"],
    searchTemplate: "https://www.asics.com/kr/ko-kr/search/?q={query}",
  },
  {
    id: "vans-kr",
    brands: ["반스", "vans"],
    domains: ["vans.co.kr"],
    searchTemplate: "https://www.vans.co.kr/search?query={query}",
  },
  {
    id: "crocs-kr",
    brands: ["크록스", "crocs"],
    domains: ["crocs.co.kr"],
    searchTemplate: "https://www.crocs.co.kr/search?q={query}",
  },
  {
    id: "descente-dk-on",
    brands: ["데상트", "descente"],
    domains: ["dk-on.com"],
    searchTemplate: "https://dk-on.com/DESCENTE/search?keyword={query}",
    directProductTemplates: ["https://dk-on.com/DESCENTE/product/{code}"],
  },
  {
    id: "mlb-korea",
    brands: ["MLB", "엠엘비"],
    domains: ["mlb-korea.com"],
    searchTemplate: "https://www.mlb-korea.com/search?searchText={query}&gf=A",
    interactiveSearch: true,
  },
  {
    id: "kolon-sport",
    brands: ["코오롱스포츠", "kolon sport", "kolonsport", "코오롱"],
    domains: ["kolonmall.com"],
    searchTemplate: "https://www.kolonmall.com/Search?keyword={query}",
  },
  {
    id: "on-running-kr",
    brands: ["온", "온러닝", "on", "on running", "onrunning"],
    domains: ["on.com"],
    searchTemplate: "https://www.on.com/ko-kr/search?q={query}",
  },
]);

function normalizedHost(value) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return String(value || "").toLowerCase().replace(/^www\./, "");
  }
}

export function officialMallAdapter({ brand = "", domain = "", homepageUrl = "" } = {}) {
  const brandKey = normalizeOfficialBrand(brand);
  const host = normalizedHost(domain || homepageUrl);
  return ADAPTERS.find((adapter) =>
    adapter.domains.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))
    || adapter.brands.some((candidate) => normalizeOfficialBrand(candidate) === brandKey)) || null;
}

export function officialMallDirectProductUrls(input = {}, articleNumber = "") {
  const adapter = officialMallAdapter(input);
  const code = String(articleNumber || "").trim();
  if (!adapter || !code) return [];
  return (adapter.directProductTemplates || []).map((template) =>
    template.replaceAll("{code}", encodeURIComponent(code)));
}

export function officialMallSearchTemplate(input = {}) {
  return String(officialMallAdapter(input)?.searchTemplate || "");
}

export function officialMallAdapterId(input = {}) {
  return officialMallAdapter(input)?.id || "";
}

export function officialMallAdapterRecord(record = {}) {
  const adapter = officialMallAdapter({
    brand: record.brandKo || record.brandName,
    domain: record.domain,
    homepageUrl: record.homepageUrl,
  });
  const adapterId = adapter?.id || "";
  const linkedSearchTemplate = String(record.searchTemplate || adapter?.searchTemplate || "");
  const status = adapterId && linkedSearchTemplate && record.status === "search_unsupported"
    ? "verified" : String(record.status || "pending");
  const adapterStatus = adapterId && status === "verified" && linkedSearchTemplate ? "dedicated"
    : status === "verified" && record.searchTemplate ? "common"
      : status === "no_official_store" ? "unavailable"
        : "pending";
  return {
    ...record,
    status,
    searchTemplate: linkedSearchTemplate,
    interactiveSearch: record.interactiveSearch === true || adapter?.interactiveSearch === true,
    adapterId,
    adapterStatus,
  };
}

export function officialMallAdapterSummary(registry = []) {
  const summary = { adapterDedicated: 0, adapterCommon: 0, adapterPending: 0, adapterUnavailable: 0 };
  for (const source of Array.isArray(registry) ? registry : []) {
    const record = officialMallAdapterRecord(source);
    if (record.adapterStatus === "dedicated") summary.adapterDedicated += 1;
    else if (record.adapterStatus === "common") summary.adapterCommon += 1;
    else if (record.adapterStatus === "unavailable") summary.adapterUnavailable += 1;
    else summary.adapterPending += 1;
  }
  return summary;
}
