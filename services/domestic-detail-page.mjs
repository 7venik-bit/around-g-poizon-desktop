// Product identity must retain query IDs (SSG uses the same path for every item).
export function domesticProductUrlIdentity(value = "") {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    // Fashion Town's numeric path is the product identity. Its query string
    // changes between a search card and the opened detail, even for one item.
    if (/^(?:shopping|m\.shopping)\.naver\.com$/i.test(url.hostname)
      && /^\/window-products\/(?:brandfashion|department|outlet)\/\d+\/?$/i.test(url.pathname)) {
      url.search = "";
      return url.href;
    }
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

// Naver window-products pages embed the product record (price, model code and
// per-size quantities) as JSON. Reading it needs no option-widget clicks and
// stays exact when the rendered title only shows the store name.
// Serialized into the retailer frame with captureDomesticDetailPage: keep it
// self-contained with no module references.
export function parseNaverWindowProductData(html = "", productId = "") {
  const source = String(html || "");
  const pid = String(productId || "").match(/\d{5,}/)?.[0] || "";
  if (!pid || source.indexOf('"product"') < 0) return null;
  const starts = [];
  const key = '"product"';
  let from = 0;
  while (starts.length < 60) {
    const keyAt = source.indexOf(key, from);
    if (keyAt < 0) break;
    let cursor = keyAt + key.length;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (source[cursor] !== ":") { from = cursor + 1; continue; }
    cursor += 1;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (source[cursor] !== "{") { from = cursor + 1; continue; }
    starts.push(cursor);
    from = cursor + 1;
  }
  const balance = (openAt) => {
    let depth = 0, inStr = false, esc = false, quote = "";
    for (let i = openAt; i < source.length && i - openAt < 500000; i++) {
      const ch = source[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === quote) inStr = false;
        continue;
      }
      if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(openAt, i + 1);
      }
    }
    return "";
  };
  const asText = (value) => (value === null || value === undefined ? "" : String(value).trim());
  for (const openAt of starts) {
    let product = null;
    try { product = JSON.parse(balance(openAt) || "null"); } catch { product = null; }
    if (!product || typeof product !== "object" || Array.isArray(product)) continue;
    if (String(product.id || "") !== pid) continue;
    const combos = Array.isArray(product.optionCombinations) ? product.optionCombinations : [];
    const options = [];
    for (const combo of combos.slice(0, 200)) {
      if (!combo || typeof combo !== "object") continue;
      const label = [combo.optionName1, combo.optionName2, combo.optionName3]
        .map(asText).filter(Boolean).join(" / ");
      if (!label) continue;
      const quantity = Number.isSafeInteger(combo.stockQuantity) ? combo.stockQuantity : null;
      options.push({ label, inStock: quantity === null ? null : quantity > 0,
        ...(quantity === null ? {} : { quantity }) });
    }
    return {
      id: String(product.id || pid),
      name: asText(product.name),
      modelCode: asText(product?.naverShoppingSearchInfo?.modelName || product?.manufactureDefineNo),
      salePrice: Number.isSafeInteger(product.salePrice) ? product.salePrice
        : Number.isSafeInteger(product.dispSalePrice) ? product.dispSalePrice : 0,
      channelName: asText(product?.channel?.channelName),
      options,
    };
  }
  return null;
}

// Serialized into the retailer frame. Keep this function self-contained.
export function captureDomesticDetailPage(captureStock, selectors = [], parseEmbedded = null) {
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
  const ownTitles = titleElements
    .filter(visible).map(element => String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  // Naver outlet/brand pages can render only the store name in the visible
  // title while the embedded product record carries the real product name
  // with its model code. Prefer the embedded name only when the visible
  // title has no code-like token, so working pages keep their exact headings.
  const codeLike = /[A-Z]{2,}[0-9]|[0-9][A-Z]{2,}/i;
  let embeddedNaverProduct = null;
  try {
    if (naverDetail && typeof parseEmbedded === "function") {
      const productNumericId = (location.pathname.match(/\/window-products\/\w+\/(\d+)/) || [])[1] || "";
      embeddedNaverProduct = parseEmbedded(document.documentElement.outerHTML, productNumericId) || null;
    }
  } catch { embeddedNaverProduct = null; }
  const embeddedName = String(embeddedNaverProduct?.name || "").replace(/\s+/g, " ").trim();
  const useEmbeddedName = Boolean(embeddedName) && !codeLike.test(ownTitles.join(" ")) && codeLike.test(embeddedName);
  const visibleTitleText = [...(useEmbeddedName ? [embeddedName] : []), ...ownTitles].slice(0, 8).join(" ").slice(0, 2000);
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
  const embeddedCode = String(embeddedNaverProduct?.modelCode || "").trim();
  if (embeddedCode) structuredCodes.push(embeddedCode);
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
  // Seller-eligibility gates (overseas/consignment/parallel-import) must not
  // read global chrome: every commerce header carries menu words like
  // "해외직구" that would condemn genuine department goods. Collect visible
  // text outside header/nav/footer once; hidden filter drawers may still
  // contribute, so this narrows but never replaces the card-stage wording.
  let scopeText = "";
  try {
    const accept = (node) => {
      const parent = node.parentElement;
      if (!parent) return false;
      const tag = String(parent.tagName || "").toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") return false;
      return !parent.closest('header,nav,footer,[role="banner"],[role="contentinfo"],[role="navigation"]');
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    let node = walker.nextNode();
    let size = 0;
    while (node) {
      if (size < 80000) {
        const text = String(node.nodeValue || "").replace(/\s+/g, " ").trim();
        if (text && accept(node)) {
          parts.push(text);
          size += text.length + 1;
        }
      }
      node = walker.nextNode();
    }
    scopeText = parts.join(" ").slice(0, 80000);
  } catch {
    scopeText = "";
  }
  return {
    href: String(location.href || ""), fullText, pageText: fullText, sellerEvidenceText, sellerDetailText, scopeText,
    loginFormVisible, documentReadyState: document.readyState,
    titleText, visibleTitleText, labeledText, structuredCodes: [...new Set(structuredCodes)].slice(0, 30), stockEvidence,
    hasOptions, busy, ready: Boolean(titleText && commerce && !busy), embeddedNaverProduct,
  };
}
