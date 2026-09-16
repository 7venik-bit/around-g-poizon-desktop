const OVERSEAS_PATTERN = /(?:해외\s*(?:직구|배송|구매\s*대행|상품)|구매\s*대행|병행\s*수입|international\s*shipping|overseas\s*shipping)/i;
const NAVIGATION_TITLE_PATTERN = /^(?:메인\s*컨텐츠로\s*건너뛰기|본문(?:으로)?\s*바로가기|skip\s*to\s*(?:main\s*)?content)$/i;
const ERROR_PAGE_PATTERN = /(?:페이지를\s*찾을\s*수\s*없습니다|해당\s*페이지를\s*찾을\s*수\s*없습니다|page\s*not\s*found|\b404\b)/i;

export function normalizedArticleToken(value = "") {
  return String(value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function officialSearchErrorText(value = "") {
  return ERROR_PAGE_PATTERN.test(String(value || ""));
}

// Runs inside the retailer renderer. It deliberately reads only visible card
// text and real anchors; it never fabricates stock or a purchase state.
export function captureVisibleExactRetailerCards(articleNumber, store = "") {
  const normalize = (value) => String(value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const expected = normalize(articleNumber);
  const variant = String(articleNumber || "").normalize("NFKC").toUpperCase().match(/^([A-Z0-9]{5,})[-_ ]([A-Z0-9]{1,6})$/);
  const base = variant ? normalize(variant[1]) : "";
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect?.();
    const s = getComputedStyle(el);
    return Boolean(r && r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden");
  };
  const priceFrom = (text) => {
    const compact = String(text || "").replace(/\s+/g, " ");
    const final = [...compact.matchAll(/최종가\s*([0-9]{1,3}(?:,[0-9]{3})+)/g)]
      .map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n >= 1000);
    if (final.length) return final[final.length - 1];
    const won = [...compact.matchAll(/(?:₩\s*)?([0-9]{1,3}(?:,[0-9]{3})+)\s*원?/g)]
      .map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n >= 1000 && n <= 100000000);
    return won.length ? Math.min(...won) : 0;
  };
  const hrefMatchesStore = (href) => {
    const value = String(href || "");
    if (/네이버/.test(store)) return /shopping\.naver\.com\/window-products\//i.test(value);
    if (/롯데온/.test(store)) return /lotteon\.com\/(?:p\/product|productDetail\.action)/i.test(value);
    if (/브랜드\s*공식몰/.test(store)) return /^https:\/\//i.test(value) && !/\/(?:customer-service|store-locator|website-accessibility|size-chart|news|login|account)(?:\/|\?|$)/i.test(value);
    return /^https:\/\//i.test(value);
  };
  const anchors = [...document.querySelectorAll("a[href]")].filter((a) => visible(a) && hrefMatchesStore(a.href));
  const result = [];
  const seen = new Set();
  for (const anchor of anchors) {
    let node = anchor;
    let best = null;
    for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
      const text = String(node.innerText || "").trim();
      if (!text || text.length > 2200) continue;
      const normalized = normalize(text);
      const hrefNormalized = normalize(anchor.href);
      const exact = Boolean(expected && (normalized.includes(expected) || hrefNormalized.includes(expected)));
      const officialBase = /브랜드\s*공식몰/.test(store) && Boolean(base && (normalized.includes(base) || hrefNormalized.includes(base)));
      const price = priceFrom(text);
      if ((exact || officialBase) && price > 0) {
        best = { text, price, exact, officialBase };
        break;
      }
    }
    if (!best || /(?:해외\s*(?:직구|배송|구매\s*대행|상품)|구매\s*대행|병행\s*수입)/i.test(best.text)) continue;
    const lines = best.text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const title = lines.find((line) => {
      const n = normalize(line);
      return line.length >= 5 && line.length <= 240 && (n.includes(expected) || (best.officialBase && base && n.includes(base)))
        && !/^(?:정상가|최종가|할인율|무료배송|좋아요|찜하기)/.test(line);
    }) || lines.find((line) => line.length >= 5 && line.length <= 240 && !/[0-9]{1,3}(?:,[0-9]{3})/.test(line)) || "";
    if (!title || /^(?:메인\s*컨텐츠로\s*건너뛰기|본문(?:으로)?\s*바로가기|skip\s*to)/i.test(title)) continue;
    const url = String(anchor.href || "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({ url, title, price: best.price, text: best.text.slice(0, 1800), exactArticle: best.exact, baseArticle: best.officialBase });
    if (result.length >= 30) break;
  }
  return { pageText: String(document.body?.innerText || "").slice(0, 30000), cards: result };
}

export function visibleRetailerCardsToProducts(capture, { store = "", articleNumber = "", brand = "" } = {}) {
  if (!capture || officialSearchErrorText(capture.pageText)) return [];
  const expected = normalizedArticleToken(articleNumber);
  if (!expected) return [];
  const products = [];
  const seen = new Set();
  for (const card of Array.isArray(capture.cards) ? capture.cards : []) {
    const url = String(card?.url || "").trim();
    const title = String(card?.title || "").trim();
    const evidence = `${title} ${String(card?.text || "")}`.trim();
    const price = Number(card?.price || 0);
    if (!/^https:\/\//i.test(url) || !title || price <= 0 || seen.has(url)) continue;
    if (NAVIGATION_TITLE_PATTERN.test(title) || ERROR_PAGE_PATTERN.test(evidence) || OVERSEAS_PATTERN.test(evidence)) continue;
    if (card?.exactArticle !== true && !(store === "브랜드 공식몰" && card?.baseArticle === true)) continue;
    seen.add(url);
    products.push({
      store,
      sourceStore: store,
      retailerName: "",
      id: url,
      url,
      title,
      articleNumber,
      detectedArticleNumber: articleNumber,
      articleNumberVerified: card?.exactArticle === true,
      articleConflict: false,
      brandVerifiedFromCard: Boolean(brand),
      detailArticleVerificationRequired: false,
      imageUrl: "",
      imageVerifiedFromCard: false,
      price,
      originalPrice: 0,
      inStock: null,
      sizes: [],
      stockStatus: "unknown",
      stockText: "재고 확인 필요",
      stockVerified: false,
      stockCoverage: "unknown",
      confidence: card?.exactArticle === true ? 95 : 80,
      officialStoreVerified: store === "브랜드 공식몰",
      parallelRetailerVerified: false,
      matchBasis: card?.exactArticle === true ? "card_article" : "official_style",
      signals: { code: card?.exactArticle === true ? "일치" : "스타일 일치", title: "판매처 화면 확인", image: "확인 불가" },
      liveSearchCardVerified: true,
    });
  }
  return products;
}
