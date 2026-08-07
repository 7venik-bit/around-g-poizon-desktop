import {
  OFFICIAL_DOMAIN_STATUS,
  VERIFIED_OFFICIAL_BRANDS,
  normalizeOfficialBrand,
  officialSearchUrlFromRecord,
  verifiedOfficialBrand,
} from "../services/official-domain-registry.mjs";

const MAX_QUERY_LENGTH = 120;
const MAX_PRODUCTS_PER_STORE = 8;

export function sanitizeDomesticQuery(value) {
  return String(value || "")
    .replace(/주간\s*대비(?:\s*[↑↓]?\s*\d+(?:\.\d+)?%)?/gi, " ")
    .replace(/검색\s*지수|즐겨찾기\s*지수|평균\s*거래가|최저\s*거래가|최고\s*거래가|최근\s*7일\s*검색\s*추세/gi, " ")
    .replace(/\b(?:KRW|SPU\s*기준|SKU\s*기준)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const naverSearch = (query) => {
  const cleaned = sanitizeDomesticQuery(query);
  return `https://search.naver.com/search.naver?where=shopping&query=${encodeURIComponent(cleaned)}`;
};

export const OFFICIAL_BRAND_SEARCH = VERIFIED_OFFICIAL_BRANDS.map((entry) => ({
  ...entry,
  productUrl: (query) => String(entry.searchTemplate).replaceAll("{query}", encodeURIComponent(query)),
}));

function officialBrandEntry(brandOrQuery) {
  return verifiedOfficialBrand(sanitizeDomesticQuery(brandOrQuery));
}

export function officialBrandSearchUrl(brand, query) {
  return naverFashionTownUrl("brand-store", brand, query);
}

export function officialBrandProductSearchUrl(brand, query, officialBrandRecord = null) {
  const cleanedQuery = sanitizeDomesticQuery(query);
  if (!cleanedQuery) return "";
  if (officialBrandRecord) return officialSearchUrlFromRecord(officialBrandRecord, cleanedQuery);
  const match = officialBrandEntry(brand || query);
  return match?.searchTemplate ? String(match.searchTemplate).replaceAll("{query}", encodeURIComponent(cleanedQuery)) : "";
}

const NAVER_BRAND_STORES = [
  { aliases: ["adidas", "adidas originals", "아디다스"], slug: "adidas" },
  { aliases: ["nike", "나이키"], slug: "nike" },
  { aliases: ["new balance", "newbalance", "뉴발란스"], slug: "nbkorea" },
  { aliases: ["puma", "푸마"], slug: "puma" },
  { aliases: ["asics", "아식스"], slug: "asics" },
  { aliases: ["crocs", "크록스"], slug: "crocs" },
];

function naverBrandStore(brandOrQuery) {
  const normalized = sanitizeDomesticQuery(brandOrQuery).toLowerCase();
  return NAVER_BRAND_STORES.find((entry) =>
    entry.aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized))
  );
}

export function naverFashionTownUrl(channel, brand, query) {
  const cleanedBrand = sanitizeDomesticQuery(brand);
  const cleanedQuery = sanitizeDomesticQuery(query);
  const matchedStore = naverBrandStore(cleanedBrand || cleanedQuery);
  const searchBrand = matchedStore?.aliases[0] || cleanedBrand;
  if (channel === "brand-store") {
    if (matchedStore?.slug) {
      return `https://brand.naver.com/${matchedStore.slug}/search?q=${encodeURIComponent(cleanedQuery)}`;
    }
    return `https://shopping.naver.com/window/search/fashion-group?q=${encodeURIComponent(
      [searchBrand, cleanedQuery].filter(Boolean).join(" ")
    )}`;
  }
  const section = channel === "department" ? "department" : "outlet";
  return `https://shopping.naver.com/window/${section}/search?q=${encodeURIComponent(
    [searchBrand, cleanedQuery].filter(Boolean).join(" ")
  )}`;
}

export function domesticChannelUrl(channel, brand, query) {
  const terms = sanitizeDomesticQuery([brand, query].filter(Boolean).join(" "));
  if (channel === "ssg-department") {
    return `https://department.ssg.com/search.ssg?query=${encodeURIComponent(terms)}`;
  }
  if (channel === "ssg-outlet") {
    return `https://www.ssg.com/search.ssg?target=all&siteNo=7008&query=${encodeURIComponent(terms)}`;
  }
  if (channel === "lotte-department" || channel === "lotte-outlet") {
    const area = channel === "lotte-department" ? "백화점" : "아울렛";
    return `https://www.lotteon.com/search/search/search.ecn?render=search&platform=pc&q=${encodeURIComponent(terms)}&mallFilter=${encodeURIComponent(area)}`;
  }
  return "";
}

export const DOMESTIC_SEARCH_LINKS = {
  "브랜드 공식몰": (query) => naverSearch(query),
  "무신사": (query) => `https://www.musinsa.com/search/goods?keyword=${encodeURIComponent(query)}`,
  "네이버 패션타운": (query) => naverSearch(query),
  "브랜드직영몰": (query) => naverSearch(query),
  "백화점": (query) => naverSearch(query),
  "아울렛": (query) => naverSearch(query),
  "SSG": (query) => `https://www.ssg.com/search.ssg?query=${encodeURIComponent(query)}`,
  "코오롱몰": (query) => `https://www.kolonmall.com/Search?keyword=${encodeURIComponent(query)}`,
};

function nextData(html) {
  const match = String(html || "").match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error("DOMESTIC_SEARCH_DATA_NOT_FOUND");
  return JSON.parse(match[1]);
}

function safeNumber(value) {
  const normalized = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : undefined;
}

function absoluteUrl(value, origin, fallback) {
  try {
    return new URL(String(value || fallback), origin).href;
  } catch {
    return fallback;
  }
}

function uniqueProducts(products) {
  const seen = new Set();
  return products.filter((product) => {
    const key = `${product.store}:${product.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function countLinkedSearchProducts(html, articleNumber = "") {
  const source = String(html || "");
  const ids = new Set();
  const patterns = [
    /\/products\/(\d{5,})/g,
    /"productId"\s*:\s*"?([A-Z0-9_-]{5,})"?/gi,
    /"nvMid"\s*:\s*"?(\d{8,})"?/g,
    /"goodsNo"\s*:\s*"?([A-Z0-9_-]{5,})"?/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) ids.add(match[1]);
  }
  if (ids.size) return Math.min(ids.size, 99);
  const code = sanitizeDomesticQuery(articleNumber);
  if (!code || /상품이 없습니다|검색 결과가 없습니다|검색결과 없음/i.test(source)) return 0;
  const occurrences = source.toLowerCase().split(code.toLowerCase()).length - 1;
  return occurrences >= 2 ? 1 : 0;
}

export function countRenderedChannelProducts(content, store = "", articleNumber = "", brand = "") {
  const source = String(content || "");
  const articleCode = sanitizeDomesticQuery(articleNumber)
    .split(/\s+/)[0]
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
  if (source.trimStart().startsWith("{")) {
    try {
      const rendered = JSON.parse(source);
      if (!Array.isArray(rendered?.productCards)) throw new Error("RENDERED_PRODUCT_CARDS_MISSING");
      const cards = rendered.productCards || [];
      const pageText = String(rendered.pageText || "");
      const scopedLabels = String(store || "").includes("공식 브랜드스토어")
        ? ["브랜드직영몰", "공식브랜드", "브랜드스토어"]
        : String(store || "").includes("백화점") ? ["백화점"]
          : String(store || "").includes("아울렛") ? ["아울렛"] : [];
      for (const label of scopedLabels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const scoped = pageText.match(new RegExp(`${escaped}\\s*([\\d,]+)\\s*개`, "i"));
        if (scoped) return Math.min(Number(scoped[1].replace(/,/g, "")) || 0, 9999);
      }
      if (scopedLabels.length && /검색된\s*상품이\s*없습니다|검색\s*결과가\s*없습니다|상품이\s*없습니다/i.test(pageText)) return 0;
      if (!articleCode) return 0;
      const seed = verifiedOfficialBrand(brand);
      const brandKeys = [brand, ...(seed?.aliases || [])].map(normalizeOfficialBrand).filter(Boolean);
      const requiresBrandMatch = /^(?:네이버|SSG|롯데온)/.test(String(store || "")) && brandKeys.length > 0;
      const matchingProducts = new Set();
      for (const card of cards) {
        const productUrl = String(card?.productUrl || "");
        const rawCardText = `${String(card?.text || "")} ${String(card?.markup || "")} ${productUrl}`;
        const cardText = rawCardText
          .replace(/[^A-Z0-9]/gi, "")
          .toUpperCase();
        let articleMatched = cardText.includes(articleCode);
        const variantStyle = sanitizeDomesticQuery(articleNumber).toUpperCase().match(/^([A-Z0-9]{5,})[-_]([A-Z0-9]{1,6})$/);
        if (!articleMatched && variantStyle && productUrl) {
          const [, baseCode, colorCode] = variantStyle;
          const decodedUrl = decodeURIComponent(productUrl).replace(/&amp;/gi, "&");
          const escapedBase = baseCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const escapedColor = colorCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          articleMatched = new RegExp(`${escapedBase}[^#\\s]{0,160}(?:color|colour|variant)[^=]{0,24}=${escapedColor}(?:&|$)`, "i").test(decodedUrl);
        }
        if (!articleMatched) continue;
        if (requiresBrandMatch) {
          const evidence = normalizeOfficialBrand(rawCardText);
          const tokens = rawCardText.toLowerCase().split(/[^a-z0-9가-힣]+/).map(normalizeOfficialBrand).filter(Boolean);
          const brandMatched = brandKeys.some((key) => key.length <= 3 ? tokens.includes(key) : evidence.includes(key));
          if (!brandMatched) continue;
        }
        const productKey = String(productUrl || card?.text || "");
        if (productKey) matchingProducts.add(productKey);
      }
      return matchingProducts.size;
    } catch {
      return 0;
    }
  }
  const channelLabel = String(store || "")
    .replace(/^네이버\s*/, "")
    .replace(/브랜드직영몰/, "브랜드직영몰");
  if (channelLabel) {
    const escaped = channelLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const labelled = source.match(new RegExp(`${escaped}\\s*([\\d,]+)\\s*개`, "i"));
    if (labelled) return Math.min(Number(labelled[1].replace(/,/g, "")) || 0, 9999);
  }
  const total = source.match(/(?:총|전체|검색결과)\s*([0-9,]+)\s*(?:개|건)/i);
  if (total) return Math.min(Number(total[1].replace(/,/g, "")) || 0, 9999);
  return countLinkedSearchProducts(source, articleNumber);
}

function normalizeSizes(...candidates) {
  const source = candidates.find((candidate) => Array.isArray(candidate)) || [];
  return source.flatMap((option) => {
    if (typeof option === "string" || typeof option === "number") {
      return [{ label: String(option), inStock: true }];
    }
    if (!option || typeof option !== "object") return [];
    const label = option.sizeName || option.optionName || option.name || option.label || option.value;
    if (!label) return [];
    const quantity = safeNumber(option.stockQuantity ?? option.stock ?? option.quantity);
    return [{
      label: String(label),
      inStock: option.isSoldOut !== true && option.soldOutYn !== "Y" && quantity !== 0,
    }];
  });
}

export function parseMusinsaSearch(html) {
  const document = nextData(html);
  const queries = document?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) return [];

  const products = [];
  for (const query of queries) {
    const pages = query?.state?.data?.pages;
    if (!Array.isArray(pages)) continue;
    for (const page of pages) {
      if (!Array.isArray(page?.items)) continue;
      for (const item of page.items) {
        if (!item?.goodsNo || !item?.goodsName) continue;
        products.push({
          store: "무신사",
          id: String(item.goodsNo),
          name: String(item.goodsName),
          brand: String(item.brandName || item.brand || ""),
          price: safeNumber(item.finalPrice ?? item.couponPrice ?? item.price),
          originalPrice: safeNumber(item.normalPrice),
          imageUrl: String(item.thumbnail || ""),
          url: absoluteUrl(item.goodsLinkUrl, "https://www.musinsa.com", `https://www.musinsa.com/products/${item.goodsNo}`),
          inStock: item.isSoldOut !== true,
          sizes: normalizeSizes(item.optionList, item.options, item.sizes, item.stockList),
        });
      }
    }
  }
  return uniqueProducts(products).slice(0, MAX_PRODUCTS_PER_STORE);
}

export function parseSsgSearch(html) {
  const document = nextData(html);
  const queries = document?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) return [];

  const products = [];
  for (const query of queries) {
    const areas = query?.state?.data?.areaList;
    if (!Array.isArray(areas)) continue;
    for (const area of areas) {
      if (area?.unitType !== "ITEM_UNIT_LIST" || !Array.isArray(area?.dataList)) continue;
      for (const item of area.dataList) {
        if (!item?.itemId || !item?.itemName) continue;
        products.push({
          store: "SSG",
          id: String(item.itemId),
          name: String(item.itemName),
          brand: String(item.brandName || ""),
          price: safeNumber(item.finalPrice ?? item.priceInfo?.primaryPrice),
          originalPrice: safeNumber(item.strikeOutPrice ?? item.priceInfo?.strikeOutPrice),
          imageUrl: String(item.itemImgUrl || ""),
          url: absoluteUrl(item.itemUrl || item.itemDetailLink, "https://www.ssg.com", DOMESTIC_SEARCH_LINKS.SSG("")),
          inStock: !item.soldOutMessage,
          sizes: normalizeSizes(item.optionList, item.options, item.sizes, item.stockList),
        });
      }
    }
  }
  return uniqueProducts(products).slice(0, MAX_PRODUCTS_PER_STORE);
}

export function parseKolonSearch(html, requestedQuery = "") {
  const decoded = String(html || "")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
  const products = [];
  const pattern = /"__typename":"productResult","code":"([^"]+)"[^{}]*?"name":"([^"]+)"[^{}]*?"supplierBrandName":"([^"]*)"[^{}]*?"representationImage":"([^"]*)"[^{}]*?"soldOutYn":"([^"]*)"[^{}]*?"price":\{[^{}]*?"price":(\d+)[^{}]*?"wishPrice":(\d+)/g;
  let match;
  while ((match = pattern.exec(decoded)) !== null) {
    const [, code, name, brand, imageUrl, soldOutYn, price, originalPrice] = match;
    if (requestedQuery && !name.toLowerCase().includes(requestedQuery.toLowerCase())) continue;
    products.push({
      store: "코오롱몰",
      id: code,
      name,
      brand,
      price: safeNumber(price),
      originalPrice: safeNumber(originalPrice),
      imageUrl,
      url: `https://www.kolonmall.com/Product/${encodeURIComponent(code)}`,
      inStock: soldOutYn !== "Y",
      sizes: [],
    });
  }
  return uniqueProducts(products).slice(0, MAX_PRODUCTS_PER_STORE);
}

async function fetchSearchPage(url, fetchImpl) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(18_000),
      });
      if (!response.ok) {
        const error = new Error(`DOMESTIC_HTTP_${response.status}`);
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else return response.text();
    } catch (error) {
      lastError = error;
      if (/DOMESTIC_HTTP_(?:4\d\d)/.test(String(error?.message || "")) && !/DOMESTIC_HTTP_429/.test(String(error?.message || ""))) throw error;
    }
  }
  throw lastError || new Error("DOMESTIC_SEARCH_FAILED");
}

async function enrichMusinsaOptions(products, fetchImpl) {
  return Promise.all(products.map(async (product) => {
    try {
      const response = await fetchImpl(`https://api.musinsa.com/api2/dp/v1/plp/goods/${encodeURIComponent(product.id)}/options`, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "ko-KR,ko;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) return product;
      const document = await response.json();
      const flatten = (options) => (options || []).flatMap((option) => {
        const children = flatten(option.goodsOptions);
        if (children.length) return children;
        if (!option.name && !option.code) return [];
        return [{ label: String(option.name || option.code), inStock: option.outOfStock !== true }];
      });
      const sizes = flatten(document?.data?.goodsOptions);
      return {
        ...product,
        sizes,
        inStock: sizes.length ? sizes.some((size) => size.inStock) : product.inStock,
      };
    } catch {
      return product;
    }
  }));
}

export async function queryDomesticProducts({
  query,
  articleNumber = "",
  brand = "",
  title = "",
  preferTitle = false,
  verifyLinkCounts = false,
  officialBrandRecord = null,
  fetchImpl = fetch,
}) {
  const normalizedQuery = sanitizeDomesticQuery(query);
  if (!normalizedQuery) throw new Error("DOMESTIC_QUERY_REQUIRED");
  if (normalizedQuery.length > MAX_QUERY_LENGTH) throw new Error("DOMESTIC_QUERY_TOO_LONG");
  const codeQueries = [
    sanitizeDomesticQuery(articleNumber),
    sanitizeDomesticQuery([brand, articleNumber].filter(Boolean).join(" ")),
  ];
  const titleQueries = [
    sanitizeDomesticQuery([brand, title].filter(Boolean).join(" ")),
    sanitizeDomesticQuery(title),
    normalizedQuery,
  ];
  const queryCandidates = [...new Set(
    (preferTitle ? [...titleQueries, ...codeQueries] : [...codeQueries, ...titleQueries]).filter(Boolean)
  )];

  const knownOfficial = officialBrandEntry(brand || title || normalizedQuery);
  const officialStatus = officialBrandRecord?.status || (knownOfficial ? OFFICIAL_DOMAIN_STATUS.VERIFIED : OFFICIAL_DOMAIN_STATUS.PENDING);
  const officialStoreLabel = officialStatus === OFFICIAL_DOMAIN_STATUS.VERIFIED ? "브랜드 공식몰"
    : officialStatus === OFFICIAL_DOMAIN_STATUS.NO_OFFICIAL_STORE ? "공식몰 없음"
      : officialStatus === OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED ? "공식몰 검색 미지원"
        : "공식몰 검증 대기";
  const sources = [
    { store: officialStoreLabel, linkOnly: true, officialBrand: true, renderCount: officialStatus === OFFICIAL_DOMAIN_STATUS.VERIFIED, officialStatus },
    { store: "무신사", parser: parseMusinsaSearch, renderCount: true },
    { store: "네이버 공식 브랜드스토어", linkOnly: true, fashionTown: "brand-store", renderCount: true },
    { store: "네이버 백화점", linkOnly: true, fashionTown: "department", renderCount: true },
    { store: "네이버 아울렛", linkOnly: true, fashionTown: "outlet", renderCount: true },
    { store: "SSG 백화점", linkOnly: true, domesticChannel: "ssg-department", renderCount: true },
    { store: "SSG 아울렛", linkOnly: true, domesticChannel: "ssg-outlet", renderCount: true },
    { store: "롯데온 백화점", linkOnly: true, domesticChannel: "lotte-department", renderCount: true },
    { store: "롯데온 아울렛", linkOnly: true, domesticChannel: "lotte-outlet", renderCount: true },
    { store: "SSG", parser: parseSsgSearch },
    { store: "코오롱몰", parser: (html) => parseKolonSearch(html, articleNumber) },
  ];
  const results = await Promise.all(sources.map(async (source) => {
    const preferredQuery = queryCandidates[0] || normalizedQuery;
    const searchUrl = source.officialBrand
      ? officialBrandSearchUrl(brand || title || normalizedQuery, preferredQuery)
      : source.fashionTown
        ? naverFashionTownUrl(source.fashionTown, brand || title, preferredQuery)
        : source.domesticChannel
          ? domesticChannelUrl(source.domesticChannel, brand || title, preferredQuery)
        : DOMESTIC_SEARCH_LINKS[source.store](preferredQuery);
    const officialProductUrl = source.officialBrand
      ? officialBrandProductSearchUrl(brand || title || normalizedQuery, preferredQuery, officialBrandRecord)
      : "";
    if (source.linkOnly) {
      let count = 0;
      if (verifyLinkCounts) {
        try {
          const html = await fetchSearchPage(officialProductUrl || searchUrl, fetchImpl);
          count = countLinkedSearchProducts(html, articleNumber || preferredQuery);
        } catch {
          count = 0;
        }
      }
      return { store: source.store, ok: true, linkOnly: true, renderCount: source.renderCount, officialStatus: source.officialStatus, searchUrl, officialProductUrl, count, products: [] };
    }
    try {
      let products = [];
      for (const candidate of queryCandidates) {
        const candidateUrl = DOMESTIC_SEARCH_LINKS[source.store](candidate);
        const html = await fetchSearchPage(candidateUrl, fetchImpl);
        products = source.parser(html);
        if (products.length) break;
      }
      if (source.store === "무신사" && products.length) {
        products = await enrichMusinsaOptions(products, fetchImpl);
      }
      return { store: source.store, ok: true, linkOnly: false, renderCount: source.renderCount, searchUrl, products };
    } catch {
      return { store: source.store, ok: false, linkOnly: false, renderCount: source.renderCount, searchUrl, officialProductUrl, products: [] };
    }
  }));

  return {
    query: normalizedQuery,
    products: results.flatMap((result) => result.products),
    sources: results.map(({ store, ok, linkOnly, renderCount, officialStatus, searchUrl, officialProductUrl, count, products }, priority) => ({
      store,
      ok,
      linkOnly,
      renderCount: Boolean(renderCount),
      officialStatus: officialStatus || "",
      priority: priority + 1,
      count: Number.isFinite(count) ? count : products.length,
      searchUrl,
      officialProductUrl,
    })),
  };
}
