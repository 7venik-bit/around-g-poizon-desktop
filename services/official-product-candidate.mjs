// Also serialized into retailer frames: keep this function self-contained.
export function isOfficialProductCandidateUrl(value, resultsUrl = '') {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return false;
    url.hash = '';
    if (resultsUrl) {
      const results = new URL(resultsUrl);
      results.hash = '';
      if (url.href === results.href) return false;
    }
    // A query code is navigation evidence, never a product identifier.
    const path = decodeURIComponent(url.pathname);
    if (/(?:^|\/)(?:search(?:result|results)?|goodsSearch|productSearch|category|categories|login|cart)(?:[./_-]|$)/i.test(path)) return false;
    if (/(?:^|\/)(?:goods|product)[_-]?list(?:[./]|$)/i.test(path)) return false;
    if ([...url.searchParams.keys()].some(key => /^(?:keyword|searchText|searchWord|searchKeyword|query)$/i.test(key))
      && ![...url.searchParams.keys()].some(key => /^(?:goodsNo|goodsId|productId|productNo|product_no|itemId)$/i.test(key))) return false;
    return true;
  } catch { return false; }
}
