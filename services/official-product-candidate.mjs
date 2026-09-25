// Also serialized into retailer frames: keep this function self-contained.
export function isOfficialProductCandidateUrl(value, resultsUrl = '', articleNumber = '') {
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
    // DK's navigation can inherit a nearby card's code/price from its ancestor.
    // Keep product/detail-shaped routes; BEST, newArrival, events and the brand
    // home must never enter the detail/stock queue.
    if (url.hostname.replace(/^www\./i, '').toLowerCase() === 'dk-on.com') {
      return /^\/[^/]+\/(?:product|goods(?:\/detail)?)\/[^/]+(?:\/[^/]+)?\/?$/i.test(path);
    }
    // Nike search results contain category/filter links and recommended items.
    // Its Korean product route ends with the manufacturer's full style code;
    // only that product-owned code can establish a match for an exact search.
    if (url.hostname.replace(/^www\./i, '').toLowerCase() === 'nike.com') {
      const nikeProduct = path.match(/^\/kr\/t\/[^/]+(?:\/[^/]+)?\/([A-Z0-9]+(?:[-_][A-Z0-9]+)*)\/?$/i);
      if (!nikeProduct) return false;
      const expected = String(articleNumber || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      return !expected || nikeProduct[1].replace(/[^A-Z0-9]/gi, '').toUpperCase() === expected;
    }
    return true;
  } catch { return false; }
}
