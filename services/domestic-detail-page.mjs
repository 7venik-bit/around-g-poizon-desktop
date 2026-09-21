// Product identity must retain query IDs (SSG uses the same path for every item).
export function domesticProductUrlIdentity(value = "") {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    const ids = [...url.searchParams].filter(([key]) => /^(?:itemId|goodsNo|goodsId|productId|productNo|prdNo|prdtNo|goods_seq|product_no)$/i.test(key));
    if (ids.length) {
      url.search = "";
      const variants = [...new URL(value).searchParams].filter(([key]) => /^(?:color|colour|variant|option)(?:Id|Code|No)?$/i.test(key));
      for (const [key, value] of [...ids, ...variants].sort(([a], [b]) => a.localeCompare(b))) url.searchParams.set(key.toLowerCase(), value);
    } else {
      for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|NaPm$|n_media$|n_query$|n_rank$|n_ad$|from$|ref$)/i.test(key)) url.searchParams.delete(key);
      url.searchParams.sort();
    }
    return url.href;
  } catch { return ""; }
}

// Serialized into the retailer frame. Keep this function self-contained.
export function captureDomesticDetailPage(captureStock, selectors = []) {
  const visible = element => {
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const fullText = String(document.body?.innerText || "").slice(0, 80000);
  const lines = fullText.split(/\n+/).map(line => line.replace(/\s+/g, " ").trim());
  // Fashion Town's product heading is an h3 in its copyable title panel,
  // outside main. Its h1 is the site name, not product identity.
  const naverDetail = /^(?:m\.)?shopping\.naver\.com$/i.test(location.hostname)
    && location.pathname.startsWith('/window-products/');
  const naverTitles = naverDetail
    ? [...document.querySelectorAll('._copyable > h3')].filter(visible) : [];
  // The global Fashion Town menu contains "해외직구" on domestic products too.
  // Scope seller eligibility to this product's purchase, description and seller
  // sections. Keep fullText intact for access/login diagnostics.
  const naverProductPanel = naverTitles[0]?.closest('.vcontainer_item');
  const sellerDetailText = naverProductPanel
    ? [naverProductPanel, ...document.querySelectorAll('#DEFAULT, #SELLER')]
      .filter(visible).map(element => element.innerText || element.textContent || '').join('\n').slice(0, 80000)
    : fullText;
  const sellerEvidenceText = sellerDetailText.split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length >= 3 && line.length <= 240)
    .filter(line => /판매(?:중)?인?\s*상품|공식\s*판매처|브랜드\s*(?:공식|직영)|공식\s*(?:브랜드|스토어|온라인몰)|직영\s*(?:스토어|온라인몰)|관부가세|해외\s*직구|구매\s*대행/i.test(line)).slice(0, 20).join(" ");
  const titleElements = naverTitles.length ? naverTitles
    : [...document.querySelectorAll('h1,main h2,main h3,[itemprop="name"],[class*="product" i][class*="title" i],[class*="goods" i][class*="name" i]')];
  const visibleTitleText = titleElements
    .filter(visible).map(element => String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 8).join(" ").slice(0, 2000);
  const titleText = visibleTitleText
    || String(document.querySelector('meta[property="og:title"]')?.content || "")
    || String(document.title || "");
  const identityLabel = /품\s*번|상품\s*(?:번호|코드)|제품\s*(?:번호|코드)|모델\s*(?:명|번호|코드)?|스타일\s*(?:번호|코드)?|style\s*(?:no|number|code)?|model\s*(?:no|number|code)?|sku|mpn/i;
  const labeledText = lines.filter(line => identityLabel.test(line)).slice(0, 40).join("\n");
  const structuredCodes = [];
  const addCode = value => {
    if (Array.isArray(value)) return value.forEach(addCode);
    if (value != null && String(value).trim()) structuredCodes.push(String(value).trim());
  };
  for (const element of document.querySelectorAll('[itemprop="sku"],[itemprop="mpn"],[itemprop="model"]')) addCode(element.getAttribute("content") || element.textContent);
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = value => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) return value.forEach(walk);
        for (const [key, child] of Object.entries(value)) {
          if (/^(?:sku|mpn|model|styleNo|articleNumber)$/i.test(key)) addCode(child);
          else if (child && typeof child === "object") walk(child);
        }
      };
      walk(JSON.parse(script.textContent || "null"));
    } catch {}
  }
  const stockEvidence = captureStock(selectors);
  // Read only the presence of a login form, never its field values. Retailers
  // often redirect to a plain ID/password page without "login required" text.
  const loginFormVisible = [...document.querySelectorAll('input[type="password"]')]
    .filter(visible).filter(input => input.autocomplete !== 'new-password')
    .some(input => {
      const scope = input.closest('form') || document;
      return [...scope.querySelectorAll('button,input[type="submit"],[role="button"]')]
        .some(button => visible(button) && /로그인|log\s*in|sign\s*in/i.test(
          button.innerText || button.textContent || button.value || button.getAttribute('aria-label') || ''));
    });
  const hasOptions = [...document.querySelectorAll('select,[role="combobox"],button,[role="button"]')].filter(visible)
    .some(el => !el.closest('header,footer,nav') && /사이즈|옵션|size|option/i.test(`${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`));
  // Ignore only explicitly identified recommendation/advertisement regions.
  // Purchase panels may live in an aside. Unknown/global loaders still block.
  const unrelatedLoadingRegion = element => {
    for (let node = element; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (node.matches('main,[role="main"]')) break;
      const labels = ['id', 'class', 'aria-label', 'data-testid'].map(key => node.getAttribute(key) || '').join(' ');
      // Recommended sizes/options belong to commerce, not unrelated goods.
      if (/size|option|purchase|buy|사이즈|옵션|구매/i.test(labels)) return false;
      if (/recommend|related[-_ ]?(?:product|goods)|advert(?:isement|ising)?|(?:^|[\s_-])ads?(?:$|[\s_-])|추천|광고/i.test(labels)) return true;
    }
    return false;
  };
  const visibleLoading = element => {
    if (!visible(element)) return false;
    // A hidden ancestor must not turn a child spinner into a loading gate.
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const busy = [...document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')]
    .some(element => visibleLoading(element) && !unrelatedLoadingRegion(element));
  const commerce = stockEvidence.options?.length || stockEvidence.stockTexts?.length || stockEvidence.purchaseAvailable || hasOptions;
  return {
    href: String(location.href || ""), fullText, pageText: fullText, sellerEvidenceText, sellerDetailText,
    loginFormVisible, documentReadyState: document.readyState,
    titleText, visibleTitleText, labeledText, structuredCodes: [...new Set(structuredCodes)].slice(0, 30), stockEvidence,
    hasOptions, busy, ready: Boolean(titleText && commerce && !busy),
  };
}
