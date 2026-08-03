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

const OFFICIAL_BRAND_SEARCH = [
  { name: "아디다스", aliases: ["adidas", "adidas originals", "아디다스"], productUrl: (query) => `https://www.adidas.co.kr/search?q=${encodeURIComponent(query)}` },
  { name: "나이키", aliases: ["nike", "jordan", "나이키", "조던"], productUrl: (query) => `https://www.nike.com/kr/w?q=${encodeURIComponent(query)}&vst=${encodeURIComponent(query)}` },
  { name: "뉴발란스", aliases: ["new balance", "뉴발란스"], productUrl: (query) => `https://www.nbkorea.com/product/searchResult.action?schWord=${encodeURIComponent(query)}` },
  { name: "푸마", aliases: ["puma", "푸마"], productUrl: (query) => `https://kr.puma.com/kr/ko/search?q=${encodeURIComponent(query)}` },
  { name: "언더아머", aliases: ["under armour", "언더아머"], productUrl: (query) => `https://www.underarmour.co.kr/ko-kr/search/?q=${encodeURIComponent(query)}` },
  { name: "아식스", aliases: ["asics", "아식스"], productUrl: (query) => `https://www.asics.com/kr/ko-kr/search/?q=${encodeURIComponent(query)}` },
  { name: "반스", aliases: ["vans", "반스"], productUrl: (query) => `https://www.vans.co.kr/search?query=${encodeURIComponent(query)}` },
  { name: "크록스", aliases: ["crocs", "크록스"], productUrl: (query) => `https://www.crocs.co.kr/search?q=${encodeURIComponent(query)}` },
  { name: "데상트", aliases: ["descente", "데상트"], productUrl: (query) => `https://dk-on.com/DESCENTE/search?keyword=${encodeURIComponent(query)}` },
];

function officialBrandEntry(brandOrQuery) {
  const normalized = sanitizeDomesticQuery(brandOrQuery).toLowerCase();
  return normalized && OFFICIAL_BRAND_SEARCH.find((entry) =>
    entry.aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized))
  );
}

export function officialBrandSearchUrl(brand, query) {
  const match = officialBrandEntry(brand || query);
  const brandQuery = match?.name || sanitizeDomesticQuery(brand);
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(
    brandQuery
  )}`;
}

export function officialBrandProductSearchUrl(brand, query) {
  const match = officialBrandEntry(brand || query);
  const cleanedQuery = sanitizeDomesticQuery(query);
  return match?.productUrl && cleanedQuery ? match.productUrl(cleanedQuery) : "";
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

export function countRenderedChannelProducts(content, store = "", articleNumber = "") {
  const source = String(content || "");
  const articleCode = sanitizeDomesticQuery(articleNumber)
    .split(/\s+/)[0]
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
  if (source.startsWith('{"productCards":')) {
    try {
      const cards = JSON.parse(source).productCards || [];
      if (!articleCode) return 0;
      const matchingProducts = new Set();
      for (const card of cards) {
        const cardText = String(card?.text || "")
          .replace(/[^A-Z0-9]/gi, "")
          .toUpperCase();
        if (!cardText.includes(articleCode)) continue;
        const productKey = String(card?.productUrl || card?.text || "");
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
  const response = await fetchImpl(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`DOMESTIC_HTTP_${response.status}`);
  return response.text();
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

  const sources = [
    { store: "브랜드 공식몰", linkOnly: true, officialBrand: true },
    { store: "무신사", parser: parseMusinsaSearch },
    { store: "네이버 브랜드직영몰", linkOnly: true, fashionTown: "brand-store" },
    { store: "네이버 백화점", linkOnly: true, fashionTown: "department" },
    { store: "네이버 아울렛", linkOnly: true, fashionTown: "outlet" },
    { store: "SSG", parser: parseSsgSearch },
    { store: "코오롱몰", parser: (html) => parseKolonSearch(html, articleNumber) },
  ];
  const results = await Promise.all(sources.map(async (source) => {
    const preferredQuery = queryCandidates[0] || normalizedQuery;
    const searchUrl = source.officialBrand
      ? officialBrandSearchUrl(brand || title || normalizedQuery, preferredQuery)
      : source.fashionTown
        ? naverFashionTownUrl(source.fashionTown, brand || title, preferredQuery)
        : DOMESTIC_SEARCH_LINKS[source.store](preferredQuery);
    const officialProductUrl = source.officialBrand
      ? officialBrandProductSearchUrl(brand || title || normalizedQuery, preferredQuery)
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
      return { store: source.store, ok: true, linkOnly: true, searchUrl, officialProductUrl, count, products: [] };
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
      return { store: source.store, ok: true, linkOnly: false, searchUrl, products };
    } catch {
      return { store: source.store, ok: false, linkOnly: false, searchUrl, officialProductUrl, products: [] };
    }
  }));

  return {
    query: normalizedQuery,
    products: results.flatMap((result) => result.products),
    sources: results.map(({ store, ok, linkOnly, searchUrl, officialProductUrl, count, products }, priority) => ({
      store,
      ok,
      linkOnly,
      priority: priority + 1,
      count: Number.isFinite(count) ? count : products.length,
      searchUrl,
      officialProductUrl,
    })),
  };
}
