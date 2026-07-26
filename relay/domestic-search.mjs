const MAX_QUERY_LENGTH = 120;
const MAX_PRODUCTS_PER_STORE = 8;

export const DOMESTIC_SEARCH_LINKS = {
  "공식 홈페이지": (query) => `https://search.naver.com/search.naver?query=${encodeURIComponent(`${query} 공식몰`)}`,
  "무신사": (query) => `https://www.musinsa.com/search/goods?keyword=${encodeURIComponent(query)}`,
  "네이버 패션타운": (query) => `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(query)}`,
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

export async function queryDomesticProducts({ query, fetchImpl = fetch }) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) throw new Error("DOMESTIC_QUERY_REQUIRED");
  if (normalizedQuery.length > MAX_QUERY_LENGTH) throw new Error("DOMESTIC_QUERY_TOO_LONG");

  const sources = [
    { store: "공식 홈페이지", linkOnly: true },
    { store: "무신사", parser: parseMusinsaSearch },
    { store: "네이버 패션타운", linkOnly: true },
    { store: "SSG", parser: parseSsgSearch },
    { store: "코오롱몰", parser: (html) => parseKolonSearch(html, normalizedQuery) },
  ];
  const results = await Promise.all(sources.map(async (source) => {
    const searchUrl = DOMESTIC_SEARCH_LINKS[source.store](normalizedQuery);
    if (source.linkOnly) return { store: source.store, ok: true, linkOnly: true, searchUrl, products: [] };
    try {
      const html = await fetchSearchPage(searchUrl, fetchImpl);
      const products = source.parser(html);
      return { store: source.store, ok: true, linkOnly: false, searchUrl, products };
    } catch {
      return { store: source.store, ok: false, linkOnly: false, searchUrl, products: [] };
    }
  }));

  return {
    query: normalizedQuery,
    products: results.flatMap((result) => result.products),
    sources: results.map(({ store, ok, linkOnly, searchUrl, products }, priority) => ({
      store,
      ok,
      linkOnly,
      priority: priority + 1,
      count: products.length,
      searchUrl,
    })),
  };
}
