const NAVER_GENERIC_STORES = new Set([
  "네이버", "네이버패션타운", "네이버 패션타운", "브랜드직영몰", "백화점", "아울렛",
]);

function compact(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function compactCode(value = "") {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function compactTitle(value = "") {
  return compact(value)
    .replace(/(?:네이버\s*패션타운|브랜드\s*직영몰|백화점|아울렛|공식\s*(?:몰|스토어|관))/g, " ")
    .replace(/[^0-9a-z가-힣]+/gi, "")
    .trim();
}

function meaningfulRetailer(product = {}) {
  const value = String(product?.retailerName || "").trim();
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ");
  return NAVER_GENERIC_STORES.has(normalized.replace(/\s+/g, ""))
    || NAVER_GENERIC_STORES.has(normalized)
    ? ""
    : compactTitle(normalized);
}

function naverResult(product = {}) {
  const store = String(product?.store || "").trim();
  const sourceStore = String(product?.sourceStore || "").trim();
  const platform = String(product?.platform || product?.source || "").trim();
  if (/naver|네이버/i.test(`${store} ${sourceStore} ${platform}`)) return true;
  return [store, sourceStore].some((value) => NAVER_GENERIC_STORES.has(value));
}

function canonicalUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|napm|n_ad|n_campaign|n_query|n_rank|n_keyword|n_keyword_id|n_ad_group|n_match|n_network|ref|from)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return raw.replace(/#.*$/, "").replace(/\/$/, "");
  }
}

function fallbackIdentity(product = {}) {
  const article = compactCode(product?.articleNumber || product?.productCode || product?.detectedArticleNumber || "");
  const title = compactTitle(product?.title || product?.name || "");
  if (!article || !title) return "";
  const retailer = meaningfulRetailer(product);
  if (retailer) return `article-title-retailer:${article}|${title}|${retailer}`;
  const price = Number(product?.price || 0);
  return `article-title-price:${article}|${title}|${Number.isFinite(price) && price > 0 ? Math.round(price) : 0}`;
}

export function naverDuplicateIdentity(product = {}) {
  if (!naverResult(product)) return "";
  const url = canonicalUrl(product?.url || product?.productUrl || "");
  return url ? `url:${url}` : fallbackIdentity(product);
}

export function dedupeNaverOverlappingProducts(products = []) {
  const output = [];
  const seenUrl = new Set();
  const seenFallback = new Set();
  for (const product of Array.isArray(products) ? products : []) {
    if (!product || !naverResult(product)) {
      output.push(product);
      continue;
    }
    const url = canonicalUrl(product?.url || product?.productUrl || "");
    const fallback = fallbackIdentity(product);
    if ((url && seenUrl.has(url)) || (fallback && seenFallback.has(fallback))) continue;
    if (url) seenUrl.add(url);
    if (fallback) seenFallback.add(fallback);
    output.push(product);
  }
  return output;
}
