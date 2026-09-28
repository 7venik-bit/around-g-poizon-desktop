// Serialized into the merchant frame. Read the selected product's visible
// purchase price only; an unverified price must not fall back to a page minimum.
export function captureOfficialProductPrice(expectedUrl, articleNumber, urlIdentity) {
  const href = String(location.href || '');
  const pending = reason => ({price:0, originalPrice:0, priceVerified:false,
    priceVerificationVersion:1, priceStatus:'unverified', priceReason:reason, priceUrl:href});
  if (!expectedUrl || !urlIdentity(expectedUrl) || urlIdentity(href) !== urlIdentity(expectedUrl)) return pending('product_url_mismatch');
  const visible = element => {
    if (!element) return false;
    for (let node=element; node; node=node.parentElement) {
      const style=getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    const rect=element.getBoundingClientRect();
    return rect.width>0 && rect.height>0;
  };
  const clean = value => String(value || '').replace(/\s+/g,' ').trim();
  const exactCode = value => clean(value).toUpperCase().split(/[^A-Z0-9-]+/).includes(String(articleNumber || '').toUpperCase());
  const amount = value => {
    const text=clean(value);
    // One whole won amount, never a percentage, range, coupon deduction or sum.
    if (!/^(?:[₩￦]\s*)?\d[\d,]*(?:\s*원)?$/.test(text)) return 0;
    const number=Number(text.replace(/[^\d]/g,''));
    return Number.isSafeInteger(number) && number>0 ? number : 0;
  };
  const unrelated = 'header,footer,nav,[class*="recommend" i],[id*="recommend" i],[class*="related" i],[id*="related" i],[class*="cross-sell" i],[class*="upsell" i],[class*="review" i],[class*="tooltip" i],[class*="coupon" i],[class*="shipping" i],[class*="delivery" i],[class*="point" i],[class*="installment" i],[class*="total-price" i]';
  const struck = element => {
    for(let node=element; node; node=node.parentElement) {
      if(node.matches('del,s,strike') || /line-through/.test(getComputedStyle(node).textDecorationLine || getComputedStyle(node).textDecoration || '')) return true;
    }
    return false;
  };
  const unique = values => [...new Set(values.filter(value=>value>0))];
  const verified = (price, originalPrice, source, basis='') => ({price, originalPrice,
    priceVerified:true, priceVerificationVersion:1, priceStatus:'verified', priceReason:'',
    priceSource:source, priceBasis:basis, priceUrl:href});

  const dk= /^(?:www\.)?dk-on\.com$/i.test(location.hostname)
    ? location.pathname.match(/^\/DESCENTE\/product\/([^/]+)\/([^/]+)\/?$/i) : null;
  if (dk) {
    const title=document.querySelector('#prod-title');
    const code=title?.parentElement?.querySelector('.prod-code');
    if (!visible(title) || !clean(title.textContent) || !visible(code)
      || clean(code.textContent).toUpperCase()!==dk[1].toUpperCase()
      || !exactCode(dk[1])) return pending('product_not_ready');
    // DK changes the selected product without updating the address. Both the
    // top and sticky colour selectors must still describe the requested row.
    const selected=[...document.querySelectorAll('input[name="rdoProdColor1"]:checked,input[name="rdoProdColor2"]:checked')];
    if (!selected.length || selected.some(input=>input.value.toUpperCase()!==dk[2].toUpperCase())) return pending('selected_color_mismatch');
    const selling=[...document.querySelectorAll('[id="prod-price"].prod-price > .price-group:not(.origin)')]
      .filter(element=>visible(element) && !element.closest(unrelated) && !struck(element));
    const prices=unique(selling.map(element=>amount(element.textContent)));
    if (prices.length!==1) return pending(prices.length?'conflicting_purchase_prices':'purchase_price_missing');
    const originals=unique([...document.querySelectorAll('[id="prod-price"].prod-price > .price-group.origin')]
      .filter(visible).map(element=>amount(element.textContent)));
    const member=[...document.querySelectorAll('[id="prod-price"] .opt-title')].some(element=>visible(element) && /회원가/.test(element.textContent));
    return verified(prices[0], originals.length===1 && originals[0]>prices[0]?originals[0]:0, 'descente_purchase_panel', member?'회원가':'판매가');
  }

  // Generic stores need an identifiable product heading and purchase controls
  // within one product container. Missing ownership is unknown, not a guess.
  const titles=[...document.querySelectorAll('h1,[itemprop="name"],[class*="product" i][class*="title" i],[class*="goods" i][class*="name" i]')]
    .filter(element=>visible(element) && !element.closest(unrelated) && clean(element.textContent));
  const ownPath=exactCode(decodeURIComponent(location.pathname));
  const expectedColor=[...new URL(expectedUrl).searchParams].find(([key])=>/^(?:color|colour)(?:Id|Code)?$/i.test(key))?.[1];
  if (expectedColor) {
    const colors=[...document.querySelectorAll('input[type="radio"]:checked,select')]
      .filter(element=>/color|colour/i.test(element.name || '') && (visible(element) || visible(element.labels?.[0])));
    if(colors.some(element=>element.value && element.value.toUpperCase()!==expectedColor.toUpperCase())) return pending('selected_color_mismatch');
  }
  const scopes=[];
  for (const title of titles) {
    for(let scope=title.parentElement; scope && scope!==document.body; scope=scope.parentElement) {
      const labeledCode=[...scope.querySelectorAll('[itemprop="sku"],[itemprop="mpn"],[class*="product-code" i],[class*="prod-code" i]')]
        .some(element=>visible(element) && !element.closest(unrelated) && exactCode(element.textContent));
      if (!ownPath && !exactCode(title.textContent) && !labeledCode) continue;
      const commerce=[...scope.querySelectorAll('button,[role="button"],select')].some(element=>visible(element)
        && !element.closest(unrelated) && /장바구니|구매|담기|add\s*to\s*(?:cart|bag)|buy|사이즈|size/i.test(clean(element.textContent)+' '+(element.getAttribute('aria-label')||'')));
      if (!commerce) continue;
      // Multiple product headings in the scope indicate a list, not ownership.
      if (titles.some(other=>other!==title && scope.contains(other) && !title.contains(other) && !other.contains(title))) break;
      scopes.push(scope); break;
    }
  }
  if (!scopes.length) return pending('purchase_scope_missing');
  const candidates=[];
  const originalSelector='del,s,strike,[class*="original" i],[class*="origin" i],[class*="regular" i],[class*="list-price" i],[class*="retail-price" i]';
  for (const scope of new Set(scopes)) {
    for (const element of scope.querySelectorAll('[itemprop="price"],[class*="price" i],[data-testid*="price" i]')) {
      if (!visible(element) || element.closest(unrelated) || struck(element) || element.closest(originalSelector)) continue;
      // Related cards may have generated class names. A link to a different
      // product inside the nearest card is contrary ownership evidence.
      const card=element.closest('li,article,a[href],[data-product-id]');
      if(card && card!==scope && scope.contains(card)) {
        const links=card.matches('a[href]')?[card]:[...card.querySelectorAll('a[href]')];
        if(links.some(link=>/^https?:/i.test(link.href) && urlIdentity(link.href)!==urlIdentity(href))) continue;
      }
      const text=clean(element.innerText || element.textContent);
      const value=amount(text);
      if (!value) continue;
      const label=[element.className,element.getAttribute('data-testid'),element.getAttribute('itemprop')].join(' ');
      if(/discount[-_ ]?(?:amount|rate)|saving|benefit|할인액|적립/i.test(label)) continue;
      const rank=/sale|selling|current|final/i.test(label)?2:1;
      candidates.push({value,rank});
    }
  }
  if (!candidates.length) return pending('purchase_price_missing');
  const rank=Math.max(...candidates.map(item=>item.rank));
  const prices=unique(candidates.filter(item=>item.rank===rank).map(item=>item.value));
  if(prices.length!==1) return pending('conflicting_purchase_prices');
  return verified(prices[0],0,'visible_purchase_panel','판매가');
}
