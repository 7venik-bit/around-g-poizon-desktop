function stableUrlIdentity(value = "") {
  try {
    const url = new URL(String(value || ""));
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    if (/\.naver\.com$/i.test(url.hostname)) return `${url.origin}${url.pathname}`;
    return url.href;
  } catch {
    return "";
  }
}

export function isNaverRenderedResultReady(state = {}, query = "") {
  const compact = (value) => String(value || "").replace(/[^A-Z0-9가-힣]/gi, "").toUpperCase();
  const expected = compact(query);
  if (!expected) return false;

  const url = String(state?.url || "");
  const text = String(state?.text || "");
  let decodedUrl = url;
  try { decodedUrl = decodeURIComponent(url); } catch {}

  const exactResultUrl = /shopping\.naver\.com\/window\/search\//i.test(url)
    && compact(decodedUrl).includes(expected);
  const queryVisible = compact(text).includes(expected);
  const positiveVisibleCount = /(?:전체|검색\s*결과)\s*[1-9][\d,]*\s*개/i.test(text);

  return exactResultUrl && (queryVisible || positiveVisibleCount || compact(decodedUrl).includes(expected));
}

const priceNumber = (value) => {
  const amount = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
};

function naverChannelCount(text = "", label = "") {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text || "").match(new RegExp(`${escaped}\\s*([\\d,]+)\\s*개`, "i"));
  if (!match) return null;
  const value = Number(String(match[1] || "0").replace(/,/g, ""));
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

export function createDomesticSearchLinkResult({
  store = "",
  articleNumber = "",
  resolvedSearchUrl = "",
} = {}) {
  const url = String(resolvedSearchUrl || "");
  return {
    count: 0,
    products: [],
    resultLinkOnly: true,
    presenceConfirmed: false,
    absenceConfirmed: false,
    searchCompleted: true,
    searchSubmitted: true,
    resolvedSearchUrl: url,
    naverAllSearchVerdict: "link",
    verificationPending: false,
    verificationStage: "direct_result_link",
    verificationDiagnostics: {
      stage: "direct_result_link",
      reason: "",
      resolvedUrl: url,
      store: String(store || ""),
      articleNumber: String(articleNumber || ""),
      visibleResultCount: null,
      productCardCount: null,
    },
  };
}

export function createNaverFashionTownSearchLinkResult(options = {}) {
  const result = createDomesticSearchLinkResult({ ...options, store: "네이버 패션타운" });
  return {
    ...result,
    verificationStage: "naver_direct_result_link",
    verificationDiagnostics: {
      ...result.verificationDiagnostics,
      stage: "naver_direct_result_link",
    },
  };
}

export function finalizeNaverFashionTownResult(snapshot = {}, {
  articleNumber = "",
  resolvedSearchUrl = "",
} = {}) {
  const cards = Array.isArray(snapshot?.productCards) ? snapshot.productCards : [];
  const seen = new Set();
  const products = [];
  for (const card of cards) {
    const url = String(card?.productUrl || "").split("#")[0];
    const identity = stableUrlIdentity(url);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    products.push({
      store: "네이버 패션타운",
      sourceStore: "네이버 패션타운",
      retailerName: "네이버 패션타운",
      id: identity,
      url,
      title: String(card?.title || card?.text || "네이버 패션타운 검색 결과").trim().slice(0, 240),
      articleNumber,
      imageUrl: String(card?.imageUrl || ""),
      imageVerifiedFromCard: Boolean(card?.imageUrl),
      price: priceNumber(card?.price),
      originalPrice: priceNumber(card?.originalPrice),
      inStock: null,
      sizes: [],
      linkOnly: true,
      linkVerified: true,
      confidence: 100,
      signals: { code: "검색 결과", title: "패션타운 결과", image: card?.imageUrl ? "확인" : "없음" },
    });
  }

  const visibleCount = Number.isFinite(Number(snapshot?.visibleResultCount))
    ? Math.max(0, Number(snapshot.visibleResultCount)) : null;
  const channelText = [snapshot?.pageHeaderText, snapshot?.pageText].filter(Boolean).join("\n");
  const totalChannelCount = naverChannelCount(channelText, "전체");
  const overseasDirectCount = naverChannelCount(channelText, "해외직구");
  const effectiveTotalCount = totalChannelCount ?? visibleCount;
  const overseasOnly = Number.isFinite(effectiveTotalCount)
    && effectiveTotalCount > 0
    && Number.isFinite(overseasDirectCount)
    && overseasDirectCount >= effectiveTotalCount;
  const explicitEmpty = snapshot?.selectedChannelEmpty === true
    || snapshot?.visibleResultCountObserved === true && visibleCount === 0
    || overseasOnly;
  const verificationDiagnostics = {
    stage: "naver_result_capture",
    resolvedUrl: String(resolvedSearchUrl || ""),
    visibleResultCount: visibleCount,
    visibleResultCountObserved: snapshot?.visibleResultCountObserved === true,
    totalChannelCount,
    overseasDirectCount,
    overseasOnly,
    productCardCount: cards.length,
    extractedProductCount: products.length,
  };

  // 해외직구 결과는 국내 판매처 상품으로 인정하지 않는다. 예: 전체 1개 / 해외직구 1개.
  // 카드가 화면에 보여도 국내 소싱 기준에서는 상품없음으로 확정한다.
  if (overseasOnly) {
    return {
      count: 0,
      products: [],
      presenceConfirmed: false,
      absenceConfirmed: true,
      searchCompleted: true,
      searchSubmitted: true,
      resolvedSearchUrl,
      naverAllSearchVerdict: "absent",
      verificationPending: false,
      verificationReason: "overseas_direct_only",
      verificationStage: "naver_result_capture",
      verificationDiagnostics,
    };
  }

  if (products.length > 0) {
    return {
      count: Math.max(products.length, visibleCount || 0),
      products,
      presenceConfirmed: true,
      absenceConfirmed: false,
      searchCompleted: true,
      searchSubmitted: true,
      resolvedSearchUrl,
      naverAllSearchVerdict: "confirmed",
      verificationPending: false,
      verificationStage: "naver_result_capture",
      verificationDiagnostics,
    };
  }

  if (explicitEmpty) {
    return {
      count: 0,
      products: [],
      presenceConfirmed: false,
      absenceConfirmed: true,
      searchCompleted: true,
      searchSubmitted: true,
      resolvedSearchUrl,
      naverAllSearchVerdict: "absent",
      verificationPending: false,
      verificationStage: "naver_result_capture",
      verificationDiagnostics,
    };
  }

  if (visibleCount > 0) {
    const fallbackUrl = stableUrlIdentity(resolvedSearchUrl) ? String(resolvedSearchUrl) : "";
    return {
      count: visibleCount,
      products: fallbackUrl ? [{
        store: "네이버 패션타운",
        sourceStore: "네이버 패션타운",
        retailerName: "네이버 패션타운",
        id: stableUrlIdentity(fallbackUrl),
        url: fallbackUrl,
        title: `네이버 패션타운 전체 검색 결과 · ${visibleCount}개`,
        articleNumber,
        imageUrl: "",
        price: 0,
        originalPrice: 0,
        inStock: null,
        sizes: [],
        linkOnly: true,
        linkVerified: true,
        searchResultFallback: true,
        confidence: 100,
        signals: { code: "검색 결과", title: "패션타운 전체 결과", image: "없음" },
      }] : [],
      presenceConfirmed: true,
      absenceConfirmed: false,
      searchCompleted: true,
      searchSubmitted: true,
      resolvedSearchUrl,
      naverAllSearchVerdict: "confirmed",
      verificationPending: false,
      individualLinksPending: true,
      verificationStage: "naver_result_capture",
      verificationDiagnostics,
    };
  }

  return {
    count: null,
    products: [],
    presenceConfirmed: false,
    absenceConfirmed: false,
    searchCompleted: false,
    searchSubmitted: true,
    resolvedSearchUrl,
    naverAllSearchVerdict: "pending",
    verificationPending: true,
    verificationReason: "naver_result_not_settled",
    visibleResultCount: visibleCount,
    verificationStage: "naver_result_capture",
    verificationDiagnostics,
  };
}
