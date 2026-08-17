import {
  OFFICIAL_DOMAIN_STATUS,
  VERIFIED_OFFICIAL_BRANDS,
  normalizeOfficialBrand,
  officialSearchUrlFromRecord,
  verifiedOfficialBrand,
} from "../services/official-domain-registry.mjs";
import { brandSearchQueries } from "../services/brand-search-profile.mjs";

const MAX_QUERY_LENGTH = 120;
const MAX_PRODUCTS_PER_STORE = 8;

export const DOMESTIC_RETAILER_GROUPS = {
  "온라인 편집샵": [
    "OK몰", "카시나", "S.I.VILLAGE", "ABC마트", "그랜드스테이지", "온더스팟", "폴더",
    "슈마커", "웍스아웃", "튠", "플랫폼샵", "훕시티", "29CM", "무신사", "아이엠샵",
    "W컨셉", "EQL", "하이츠스토어",
  ],
  "병행수입 정품업체": [
    "인퓨전프로젝트", "브릭맨션", "하하몰", "다움스포츠", "한아이엔티", "스포츠커넥션",
    "풋팝", "럭스보이", "대림코퍼레이션", "업셋", "가방팝", "베이지2", "슈텐커머스",
    "리앤한", "꼬르소밀라노", "트렌드메카", "밀라니즈", "오보화", "넥스트젠팩", "비블루",
    "소호몰", "아르떼모아", "디몬트", "바이스트", "라벨루쏘", "구템즈", "비비아노",
    "까르피", "FABSTYLE",
  ],
};


export const SSG_OFFICIAL_BRAND_HALLS = Object.freeze([
  { name: "데상트", aliases: ["descente", "데상트"] },
]);

export function isSsgOfficialBrandHall({ brand = "", url = "", text = "" } = {}) {
  let host = "";
  try { host = new URL(String(url || "")).hostname.toLowerCase(); } catch {}
  if (!(host === "ssg.com" || host.endsWith(".ssg.com"))) return false;
  const curated = SSG_OFFICIAL_BRAND_HALLS.find((entry) =>
    entry.aliases.some((alias) => normalizeOfficialBrand(alias) === normalizeOfficialBrand(brand))
  );
  const official = verifiedOfficialBrand(brand);
  const aliases = [...new Set([brand, ...(curated?.aliases || []), ...(official?.aliases || [])].filter(Boolean))];
  if (!aliases.length) return false;
  const evidence = String(text || "");
  const brandMentioned = aliases.some((alias) =>
    normalizeOfficialBrand(evidence).includes(normalizeOfficialBrand(alias))
  );
  const officialMarker = /본사\s*직영|공식\s*수입|공식\s*브랜드관|브랜드관|\[[^\]]*(?:코리아)?\s*공식\]|(?:코리아|KOREA)\s*공식|공식\s*(?:몰|스토어|판매처)/i.test(evidence);
  return brandMentioned && officialMarker;
}

export function classifySsgProductEvidence({ brand = "", url = "", text = "" } = {}) {
  if (isSsgOfficialBrandHall({ brand, url, text })) return "official_brand";
  if (detectedRetailer(text) || /병행\s*수입|해외\s*직구|구매\s*대행/i.test(String(text || ""))) return "parallel_import";
  return "marketplace";
}

const RETAILER_ALIASES = [
  ["OK몰", /okmall|오케이몰|ok몰/i], ["카시나", /kasina|카시나/i], ["S.I.VILLAGE", /s\.?i\.?\s*village|에스아이빌리지/i],
  ["ABC마트", /abc\s*mart|abc마트/i], ["그랜드스테이지", /grand\s*stage|그랜드스테이지/i], ["온더스팟", /on\s*the\s*spot|온더스팟/i],
  ["폴더", /folderstyle|폴더스타일|\b폴더\b/i], ["슈마커", /shoemarker|슈마커/i], ["웍스아웃", /worksout|웍스아웃/i],
  ["튠", /\btune\b|\b튠\b/i], ["플랫폼샵", /platformshop|플랫폼샵/i], ["훕시티", /hoopcity|훕시티/i],
  ["29CM", /29cm/i], ["무신사", /musinsa|무신사/i], ["아이엠샵", /iamshop|아이엠샵/i],
  ["W컨셉", /w\.?concept|w컨셉/i], ["EQL", /\beql\b/i], ["하이츠스토어", /heights[- ]?store|하이츠스토어/i],
  ...DOMESTIC_RETAILER_GROUPS["병행수입 정품업체"].map((name) => [name, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")]),
];

function detectedRetailer(value = "") {
  const matched = RETAILER_ALIASES.find(([, pattern]) => pattern.test(String(value || "")));
  if (!matched) return "";
  const [name] = matched;
  const group = DOMESTIC_RETAILER_GROUPS["온라인 편집샵"].includes(name) ? "온라인 편집샵" : "병행수입 정품업체";
  return `${group} · ${name}`;
}

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
  if (channel === "ssg-general") {
    return `https://www.ssg.com/search.ssg?target=all&query=${encodeURIComponent(terms)}`;
  }
  if (channel === "lotte-general") {
    return `https://www.lotteon.com/search/search/search.ecn?render=search&platform=pc&q=${encodeURIComponent(terms)}`;
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

export function exactArticleIdentityMatch(value, articleNumber = "") {
  const expected = sanitizeDomesticQuery(articleNumber).trim().toUpperCase();
  const parts = expected.split(/[^A-Z0-9]+/).filter(Boolean);
  if (!parts.length) return false;
  const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const separator = parts.length > 1 ? "[-_\\s./]+" : "";
  const pattern = escaped.join(separator);
  return new RegExp(`(?:^|[^A-Z0-9])${pattern}(?=$|[^A-Z0-9])`, "i").test(String(value || ""));
}

function articleIdentityTokens(value = "") {
  return [...new Set((String(value || "").toUpperCase().match(/[A-Z0-9]+(?:[-_][A-Z0-9]+)*/g) || [])
    .map((token) => token.replace(/[^A-Z0-9]/g, ""))
    .filter((token) => token.length >= 6 && token.length <= 28 && /[A-Z]/.test(token) && /\d/.test(token)))];
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
  // A query string is commonly repeated in page metadata and recommendation
  // widgets.  It is not product evidence unless it is attached to a known
  // product identifier/link shape.
  return 0;
}

function titleIdentityMatch(candidate = "", expected = "") {
  const ignored = new Set(["남성", "여성", "공용", "정품", "공식", "신상", "상품"]);
  const tokens = (value) => String(value || "").toLocaleLowerCase()
    .split(/[^a-z0-9가-힣]+/)
    .filter((token) => token.length >= 2 && !ignored.has(token));
  const candidateTokens = new Set(tokens(candidate));
  const expectedTokens = [...new Set(tokens(expected))];
  const shared = expectedTokens.filter((token) => candidateTokens.has(token));
  return shared.length >= 2 && shared.length / Math.max(1, Math.min(expectedTokens.length, candidateTokens.size)) >= 0.4;
}

const CONTENT_ONLY_HOSTS = new Set([
  "blog.naver.com", "m.blog.naver.com", "cafe.naver.com", "m.cafe.naver.com",
  "kin.naver.com", "news.naver.com", "post.naver.com", "tv.naver.com", "in.naver.com",
]);

export function isPlatformShoppingProductUrl(value = "") {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch { return false; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = (parsed.pathname + parsed.search).toLowerCase();
  if (CONTENT_ONLY_HOSTS.has(host)) return false;
  if (["smartstore.naver.com", "m.smartstore.naver.com", "brand.naver.com"].includes(host)) return /\/products\/\d+/.test(path);
  if (["shopping.naver.com", "search.shopping.naver.com"].includes(host)) return /\/(?:catalog|window-products|products?)\//.test(path);
  if (host === "ssg.com" || host.endsWith(".ssg.com")) return /\/item\//.test(path) || /itemview\.ssg/.test(path);
  if (host === "lotteon.com" || host.endsWith(".lotteon.com")) return /\/p\/product\//.test(path);
  if (host === "coupang.com" || host.endsWith(".coupang.com")) return /\/vp\/products\//.test(path);
  if (host === "musinsa.com" || host.endsWith(".musinsa.com")) return /\/products?\//.test(path);
  if (host === "29cm.co.kr" || host.endsWith(".29cm.co.kr")) return /\/product\//.test(path);
  if (host.endsWith("wconcept.co.kr")) return /\/product\//.test(path);
  if (host.endsWith("11st.co.kr")) return /\/products?\//.test(path) || /productno=\d+/.test(path);
  if (host.endsWith("gmarket.co.kr") || host.endsWith("auction.co.kr")) return /item|goods/.test(path);
  return false;
}

export function analyzeRenderedChannelProducts(content, store = "", articleNumber = "", brand = "", expectedTitle = "") {
  const source = String(content || "");
  const articleCode = sanitizeDomesticQuery(articleNumber).trim();
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
        // Channel totals are useful only as an authoritative zero. Positive
        // tab totals can include recommendations or the unfiltered channel.
        if (scoped && Number(scoped[1].replace(/,/g, "")) === 0) return { count: 0, products: [], absenceConfirmed: true };
      }
      if (/검색된\s*상품이\s*없습니다|검색\s*결과가\s*없습니다|상품이\s*없습니다|검색결과\s*없음/i.test(pageText)) {
        return { count: 0, products: [], absenceConfirmed: true };
      }
      if (!articleCode) return { count: 0, products: [], absenceConfirmed: false };
      const seed = verifiedOfficialBrand(brand);
      const brandKeys = [brand, ...(seed?.aliases || [])].map(normalizeOfficialBrand).filter(Boolean);
      const requiresBrandMatch = /^(?:네이버|SSG|롯데온|병행수입·편집샵)/.test(String(store || "")) && brandKeys.length > 0;
      const matchingProducts = new Map();
      for (const card of cards) {
        const productUrl = String(card?.productUrl || "");
        const titleText = String(card?.title || "").trim();
        const cardBodyText = String(card?.text || "").trim();
        const trustedOfficialCard = String(store || "") === "브랜드 공식몰";
        const identityText = trustedOfficialCard
          ? `${titleText} ${cardBodyText} ${String(card?.markup || "")} ${productUrl}`.trim()
          : titleText || cardBodyText;
        const rawCardText = `${titleText} ${cardBodyText}`.trim();
        const expectedCompact = articleCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const detectedArticleNumbers = articleIdentityTokens(rawCardText);
        const exactDetectedArticle = detectedArticleNumbers.find((code) => code === expectedCompact) || "";
        const conflictingArticle = detectedArticleNumbers.some((code) => code !== expectedCompact);
        let articleMatched = exactArticleIdentityMatch(identityText, articleCode);
        const variantStyle = sanitizeDomesticQuery(articleNumber).toUpperCase().match(/^([A-Z0-9]{5,})[-_]([A-Z0-9]{1,6})$/);
        const numericOnlyVariant = variantStyle && /^\d+$/.test(variantStyle[1]) && /^\d+$/.test(variantStyle[2]);
        if (!articleMatched && variantStyle && (!numericOnlyVariant || trustedOfficialCard) && productUrl) {
          const [, baseCode, colorCode] = variantStyle;
          const decodedUrl = decodeURIComponent(productUrl).replace(/&amp;/gi, "&");
          const escapedBase = baseCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const escapedColor = colorCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          articleMatched = new RegExp(`${escapedBase}[^#\\s]{0,160}(?:color|colour|variant)[^=]{0,24}=${escapedColor}(?:&|$)`, "i").test(decodedUrl);
        }
        const evidence = normalizeOfficialBrand(rawCardText);
        const tokens = rawCardText.toLowerCase().split(/[^a-z0-9가-힣]+/).map(normalizeOfficialBrand).filter(Boolean);
        const brandMatched = !requiresBrandMatch
          || brandKeys.some((key) => key.length <= 3 ? tokens.includes(key) : evidence.includes(key));
        // Naver Fashion Town often omits the model number from the visible
        // product title.  A single result may still be accepted when its brand
        // and descriptive title both match the POIZON row.  This deliberately
        // excludes generic/multiple-result pages, preserving exact-code checks.
        if (!conflictingArticle && !articleMatched && /^네이버\s/.test(String(store || "")) && cards.length === 1
          && brandMatched && titleIdentityMatch(rawCardText, expectedTitle)) {
          articleMatched = true;
        }
        if (conflictingArticle) articleMatched = false;
        if (!articleMatched) continue;
        if (requiresBrandMatch) {
          if (!brandMatched) continue;
        }
        // A text-only search suggestion is not a purchasable product.  Keep
        // official results only when the card owns a real product-detail URL.
        if (!/^https?:\/\//i.test(productUrl)) continue;
        // Editing-shop and parallel-import results must be real shopping-platform product pages.
        if (String(store || "") === "병행수입·편집샵" && !isPlatformShoppingProductUrl(productUrl)) continue;
        const productKey = productUrl;
        const ssgEvidence = `${rawCardText} ${String(card?.markup || "")}`;
        const ssgClassification = /:\/\/(?:[^/]+\.)?ssg\.com\//i.test(productUrl)
          ? classifySsgProductEvidence({ brand, url: productUrl, text: ssgEvidence })
          : "";
        const ssgOfficialBrandHall = ssgClassification === "official_brand";
        const parallelRetailer = detectedRetailer(rawCardText);
        const isSsgParallelImport = ssgClassification === "parallel_import";
        if (!matchingProducts.has(productKey)) {
          matchingProducts.set(productKey, {
            store: ssgOfficialBrandHall ? "SSG 브랜드 공식관" : isSsgParallelImport ? "SSG 병행수입" : store,
            retailerName: ssgOfficialBrandHall
              ? "브랜드 공식관 · 본사직영"
              : isSsgParallelImport ? (parallelRetailer || "병행수입 상품")
                : store === "병행수입·편집샵" ? parallelRetailer : "",
            id: productKey,
            url: productUrl,
            title: String(card?.title || card?.text || `${store} 검색 결과`).trim().slice(0, 240),
            articleNumber,
            detectedArticleNumber: exactDetectedArticle || detectedArticleNumbers[0] || "",
            articleConflict: conflictingArticle,
            imageUrl: String(card?.imageUrl || ""),
            imageVerifiedFromCard: card?.imageLinkedToProduct === true,
            price: safeNumber(card?.price),
            originalPrice: safeNumber(card?.originalPrice),
            inStock: true,
            sizes: [],
            confidence: ssgOfficialBrandHall ? 100 : exactDetectedArticle ? 95 : 75,
            officialStoreVerified: ssgOfficialBrandHall,
            ssgClassification,
            signals: { code: exactDetectedArticle ? "일치" : "정보 없음", title: "판매처 결과", image: card?.imageUrl ? "확인" : "없음" },
          });
        }
      }
      const exactSsgSearchChecked = /^SSG(?:\s|$)/.test(String(store || "")) && cards.length > 0;
      return {
        count: matchingProducts.size,
        products: [...matchingProducts.values()],
        absenceConfirmed: matchingProducts.size === 0 && exactSsgSearchChecked,
        ssgSearchChecked: /^SSG(?:\s|$)/.test(String(store || "")),
      };
    } catch {
      return null;
    }
  }
  const channelLabel = String(store || "")
    .replace(/^네이버\s*/, "")
    .replace(/브랜드직영몰/, "브랜드직영몰");
  if (channelLabel) {
    const escaped = channelLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const labelled = source.match(new RegExp(`${escaped}\\s*([\\d,]+)\\s*개`, "i"));
    if (labelled) return { count: Math.min(Number(labelled[1].replace(/,/g, "")) || 0, 9999), products: [] };
  }
  const total = source.match(/(?:총|전체|검색결과)\s*([0-9,]+)\s*(?:개|건)/i);
  if (total) return { count: Math.min(Number(total[1].replace(/,/g, "")) || 0, 9999), products: [] };
  return { count: countLinkedSearchProducts(source, articleNumber), products: [] };
}

export function countRenderedChannelProducts(content, store = "", articleNumber = "", brand = "") {
  return analyzeRenderedChannelProducts(content, store, articleNumber, brand)?.count ?? null;
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
  searchStrategy = "brand_code",
  fetchImpl = fetch,
}) {
  const normalizedQuery = sanitizeDomesticQuery(query);
  if (!normalizedQuery) throw new Error("DOMESTIC_QUERY_REQUIRED");
  if (normalizedQuery.length > MAX_QUERY_LENGTH) throw new Error("DOMESTIC_QUERY_TOO_LONG");
  const queryCandidates = brandSearchQueries({
    strategy: preferTitle && searchStrategy === "brand_code" ? "brand_title" : searchStrategy,
    brand,
    articleNumber,
    title,
    query: normalizedQuery,
  }).map(sanitizeDomesticQuery).filter(Boolean);

  const knownOfficial = officialBrandEntry(brand || title || normalizedQuery);
  const officialStatus = officialBrandRecord?.status || (knownOfficial ? OFFICIAL_DOMAIN_STATUS.VERIFIED : OFFICIAL_DOMAIN_STATUS.PENDING);
  const officialStoreLabel = officialStatus === OFFICIAL_DOMAIN_STATUS.VERIFIED ? "브랜드 공식몰"
    : officialStatus === OFFICIAL_DOMAIN_STATUS.NO_OFFICIAL_STORE ? "국내 공식몰 없음 확인"
      : officialStatus === OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED ? "브랜드 공식몰"
        : "공식몰 추가 확인 필요";
  const sources = [
    {
      store: officialStoreLabel,
      linkOnly: true,
      officialBrand: true,
      renderCount: [OFFICIAL_DOMAIN_STATUS.VERIFIED, OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED].includes(officialStatus)
        && Boolean(String(officialBrandRecord?.homepageUrl || knownOfficial?.homepageUrl || "")),
      officialStatus,
      homepageUrl: String(officialBrandRecord?.homepageUrl || knownOfficial?.homepageUrl || ""),
    },
    { store: "네이버 공식 브랜드스토어", linkOnly: true, fashionTown: "brand-store", renderCount: true },
    { store: "네이버 백화점", linkOnly: true, fashionTown: "department", renderCount: true },
    { store: "네이버 아울렛", linkOnly: true, fashionTown: "outlet", renderCount: true },
    { store: "무신사", parser: parseMusinsaSearch, renderCount: true },
    { store: "SSG", linkOnly: true, domesticChannel: "ssg-general", renderCount: true },
    { store: "SSG 백화점", linkOnly: true, domesticChannel: "ssg-department", renderCount: true },
    { store: "SSG 아울렛", linkOnly: true, domesticChannel: "ssg-outlet", renderCount: true },
    { store: "롯데온", linkOnly: true, domesticChannel: "lotte-general", renderCount: true },
    { store: "롯데온 백화점", linkOnly: true, domesticChannel: "lotte-department", renderCount: true },
    { store: "롯데온 아울렛", linkOnly: true, domesticChannel: "lotte-outlet", renderCount: true },
    { store: "병행수입·편집샵", linkOnly: true, retailerDiscovery: true, renderCount: true },
    { store: "코오롱몰", parser: (html) => parseKolonSearch(html, articleNumber) },
  ];
  // Keep the source order observable and deterministic. Each brand/product is
  // checked from the official mall through the domestic channels one at a
  // time, so a blocked source cannot hide which step failed.
  const results = [];
  for (const source of sources) {
    const preferredQuery = queryCandidates[0] || normalizedQuery;
    const searchUrl = source.officialBrand
      ? officialBrandSearchUrl(brand || title || normalizedQuery, preferredQuery)
      : source.fashionTown
        ? naverFashionTownUrl(source.fashionTown, brand || title, preferredQuery)
        : source.retailerDiscovery
          ? naverSearch([brand, preferredQuery].filter(Boolean).join(" "))
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
      results.push({
        store: source.store,
        ok: true,
        linkOnly: true,
        renderCount: source.renderCount,
        officialStatus: source.officialStatus,
        homepageUrl: source.homepageUrl || "",
        searchUrl,
        officialSearchUrl: source.officialBrand ? officialProductUrl : "",
        officialProductUrl,
        count,
        products: [],
      });
      continue;
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
      results.push({ store: source.store, ok: true, linkOnly: false, renderCount: source.renderCount, searchUrl, products });
    } catch {
      results.push({ store: source.store, ok: false, linkOnly: false, renderCount: source.renderCount, searchUrl, officialProductUrl, products: [] });
    }
  }

  return {
    query: normalizedQuery,
    searchStrategy,
    queryCandidates,
    products: results.flatMap((result) => result.products),
    parallelImportCompanies: DOMESTIC_RETAILER_GROUPS["병행수입 정품업체"].map((name) => ({
      name,
      searchUrl: naverSearch([brand, queryCandidates[0] || normalizedQuery, name].filter(Boolean).join(" ")),
    })),
    sources: results.map(({ store, ok, linkOnly, renderCount, officialStatus, homepageUrl, searchUrl, officialSearchUrl, officialProductUrl, count, products }, priority) => ({
      store,
      ok,
      linkOnly,
      renderCount: Boolean(renderCount),
      officialStatus: officialStatus || "",
      homepageUrl: homepageUrl || "",
      priority: priority + 1,
      count: Number.isFinite(count) ? count : products.length,
      searchUrl,
      officialSearchUrl: officialSearchUrl || "",
      officialProductUrl,
    })),
  };
}
