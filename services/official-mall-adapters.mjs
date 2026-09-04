import { normalizeOfficialBrand } from "./official-domain-registry.mjs";

const ADAPTERS = Object.freeze([
  {
    id: "descente-dk-on",
    brands: ["데상트", "descente"],
    domains: ["dk-on.com"],
    directProductTemplates: ["https://dk-on.com/DESCENTE/product/{code}"],
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
  return adapter.directProductTemplates.map((template) =>
    template.replaceAll("{code}", encodeURIComponent(code)));
}

export function officialMallAdapterId(input = {}) {
  return officialMallAdapter(input)?.id || "";
}

export function officialMallAdapterRecord(record = {}) {
  const adapterId = officialMallAdapterId({
    brand: record.brandKo || record.brandName,
    domain: record.domain,
    homepageUrl: record.homepageUrl,
  });
  const status = String(record.status || "pending");
  const adapterStatus = adapterId ? "dedicated"
    : status === "verified" && record.searchTemplate ? "common"
      : status === "no_official_store" ? "unavailable"
        : "pending";
  return { ...record, adapterId, adapterStatus };
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
