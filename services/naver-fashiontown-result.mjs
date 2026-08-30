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

  // Reaching the exact query result URL proves that the input and magnifier
  // action succeeded. The final capture owns the product/empty decision; an
  // older card selector must not terminate the search before that capture.
  return exactResultUrl && (queryVisible || positiveVisibleCount || compact(decodedUrl).includes(expected));
}

const priceNumber = (value) => {
  const amount = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
};

export function createNaverFashionTownSearchLinkResult({
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
    verificationStage: "naver_direct_result_link",
    verificationDiagnostics: {
      stage: "naver_direct_result_link",
      reason: "",
      resolvedUrl: url,
      articleNumber: String(articleNumber || ""),
      visibleResultCount: null,
      productCardCount: null,
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
  const explicitEmpty = snapshot?.selectedChannelEmpty === true
    || snapshot?.visibleResultCountObserved === true && visibleCount === 0;
  const verificationDiagnostics = {
    stage: "naver_result_capture",
    resolvedUrl: String(resolvedSearchUrl || ""),
    visibleResultCount: visibleCount,
    visibleResultCountObserved: snapshot?.visibleResultCountObserved === true,
    productCardCount: cards.length,
    extractedProductCount: products.length,
  };

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
