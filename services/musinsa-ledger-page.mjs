// These functions run in the merchant frame. Return purchase evidence only;
// never return account fields, addresses or the complete order-page text.
export function captureMusinsaLedgerPage() {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const allowed = value => { try { const u = new URL(value, location.href); return u.protocol === 'https:' && /(^|\.)musinsa\.com$/i.test(u.hostname) && !u.username && !u.password; } catch { return false; } };
  const visible = element => {
    if (!element || element.closest('[hidden],[aria-hidden="true"]')) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  };
  const text = element => String(element?.innerText || '').trim();
  const imageSource = image => {
    if (!image) return '';
    const srcset = image.getAttribute('data-srcset') || image.getAttribute('srcset') || '';
    const candidates = [image.getAttribute('data-original'),image.getAttribute('data-src'),image.getAttribute('data-lazy-src'),
      ...srcset.split(',').reverse().map(part=>part.trim().split(/\s+/)[0]),image.currentSrc,image.getAttribute('src')];
    for (const candidate of candidates.filter(Boolean)) {
      try {
        const url=new URL(candidate,location.href);
        if (url.protocol==='https:' && !url.username && !url.password && !/placeholder|no[-_]?image|(?:^|\/)(?:blank|spacer|logo)(?:[._/-]|$)|\.svg$/i.test(url.pathname)) return url.href;
      } catch { /* An invalid or temporary image is not purchase evidence. */ }
    }
    return '';
  };
  const href = location.href;
  if (!allowed(href)) return {kind:'outside', href};
  const body = text(document.body), flat = clean(body);
  if (/비정상적인\s*접근|접근이?\s*제한|자동입력\s*방지|보안\s*(?:확인|문자)|access\s*denied|too\s*many\s*requests/i.test(flat)) return {kind:'blocked', href};
  if (/\/(?:auth\/)?login(?:[/?#]|$)/i.test(href) || [...document.querySelectorAll('input[type="password"]')].some(visible)) return {kind:'login', href};
  const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible).map(el => clean(text(el)));
  const controls = [...document.querySelectorAll('a,button,[role="button"]')].filter(visible);
  // The current My-page button includes a subtitle in its accessible text.
  // Accept that observed subtitle, while keeping cancellation and other order
  // actions out instead of matching every control that starts with "주문 내역".
  const orderEntry = controls.find(el => /^(?:주문\s*(?:내역|조회|배송|[\/·]\s*배송)(?:\s*(?:조회|내역))?)(?:\s*\d+)?(?:\s+온\s*[·ㆍ]\s*오프라인,\s*상품권,\s*티켓\s+주문\s*내역\s*모아보기)?$/.test(clean(text(el) || el.getAttribute('aria-label')))
    && (!el.href || allowed(el.href)));
  const orderAction = orderEntry ? (() => { const r = orderEntry.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })() : null;
  const detail = headings.some(value => /^주문\s*상세(?:\s*(?:내역|정보))?$/.test(value))
    || /\/(?:order|orders)(?:\/|[-_])detail(?:[/?#]|$)/i.test(href);
  if (!detail) return {kind:headings.some(value => /^주문\s*(?:내역|조회|[\/·]\s*배송)/.test(value)) ? 'orders' : 'my', href, orderAction};
  const numbers = [...new Set([...flat.matchAll(/주문\s*번호\s*[:：]?\s*([0-9A-Z][0-9A-Z-]{5,})/gi)].map(m => m[1]))];
  const detailLines=body.split(/\n+/).map(clean).filter(Boolean);
  let dateMatch = flat.match(/(?:주문|결제)\s*(?:일자|일시|일)\s*[:：]?\s*(20\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})/);
  // The current order detail shows "26.09.17(목)" immediately above its
  // order number, without an 주문일 label. Do not pick a delivery date elsewhere.
  if(!dateMatch && numbers.length===1) {
    const index=detailLines.findIndex(line=>/^주문\s*번호/.test(line) && line.includes(numbers[0]));
    const nearby=index>=0?detailLines.slice(Math.max(0,index-2),index):[];
    const dates=nearby.map(line=>line.match(/^((?:20)?\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})\s*(?:\([월화수목금토일]\))?$/)).filter(Boolean);
    if(dates.length===1){dateMatch=dates[0];if(dateMatch[1].length===2)dateMatch[1]='20'+dateMatch[1];}
  }
  const purchaseDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2,'0')}-${dateMatch[3].padStart(2,'0')}` : '';
  const parsedDate=new Date(`${purchaseDate}T00:00:00Z`);
  if (numbers.length !== 1 || !purchaseDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10)!==purchaseDate) return {kind:'detail', href, rows:[], code:'ORDER_IDENTITY_INCOMPLETE'};
  // Only the labeled payment method belongs to this order. Promotional card
  // names and masked card numbers elsewhere on the page are not evidence.
  const methodIndex=detailLines.findIndex(line=>/^결제\s*수단(?:\s|[:：]|$)/.test(line));
  const methodMatch=methodIndex<0?null:detailLines[methodIndex].match(/^결제\s*수단\s*[:：]?\s*(.*)$/);
  const method=clean(methodMatch?.[1] || (methodIndex>=0?detailLines[methodIndex+1]:''));
  const cardIssuer=method.match(/(?:^|[-–·\s])([A-Za-z가-힣]{2,16})\s*카드(?:\s*\(|\s|$)/)?.[1] || '';
  const productId = link => { try { const u = new URL(link.href, href); return allowed(u.href) ? u.pathname.match(/\/(?:products|app\/goods)\/(\d+)(?:\/|$)/)?.[1] || '' : ''; } catch { return ''; } };
  const unrelated = element => {
    for (let node=element; node && node!==document.body; node=node.parentElement) {
      if (node.matches('header,nav,footer')) return true;
      const hints=['id','class','aria-label','data-testid'].map(key=>node.getAttribute(key)||'').join(' ');
      if (/recommend|related[-_ ]?(?:goods|products)|추천\s*상품|함께\s*본/i.test(hints)) return true;
    }
    return false;
  };
  const links=[...document.querySelectorAll('a[href]')].filter(el=>visible(el) && !unrelated(el) && productId(el));
  const cards=new Map();
  for (const link of links) {
    const id=productId(link);
    for (let card=link.parentElement;card && !card.matches('body,main');card=card.parentElement) {
      const ids=new Set([...card.querySelectorAll('a[href]')].map(productId).filter(Boolean));
      if (ids.size>1) break;
      const value=text(card);
      if (/주문\s*번호|총\s*결제|결제\s*정보|배송지\s*정보/.test(value)) break;
      if (/(?:옵션|사이즈|수량)\s*[:：]?|\d+\s*개/.test(value) && /[\d,]+\s*원/.test(value)) {
        if (!cards.has(card)) cards.set(card,{id,link});
        break;
      }
    }
  }
  // The image link can find an outer card while the title link finds its
  // inner text panel. They are one ordered item. Keep the outer envelope only
  // when it contains one leaf card; never collapse two separate order lines,
  // even if their product, option, quantity and price happen to be identical.
  const candidates=[...cards.keys()];
  const leaves=candidates.filter(card=>!candidates.some(other=>other!==card && card.contains(other)));
  const orderCards=new Map();
  for (const leaf of leaves) {
    const envelopes=candidates.filter(card=>(card===leaf || card.contains(leaf))
      && leaves.filter(other=>card===other || card.contains(other)).length===1);
    const card=envelopes.find(card=>!envelopes.some(other=>other!==card && other.contains(card))) || leaf;
    orderCards.set(card,cards.get(card));
  }
  const rows=[];
  for (const [card,{id,link}] of orderCards) {
    const raw=text(card), value=clean(raw), lines=raw.split(/\n+/).map(clean).filter(Boolean);
    // Cancellation/refund lines cannot become a completed purchase.
    if (/취소\s*(?:완료|접수)|반품\s*(?:완료|접수|중)|환불\s*(?:완료|진행)/.test(value)) continue;
    const images=[...card.querySelectorAll('img')].filter(el=>visible(el) && !unrelated(el));
    // Prefer the thumbnail linked to this ordered product over brand logos or
    // another option's image. Only use an unlinked image inside this same card.
    const image=images.find(el=>productId(el.closest('a[href]') || {})===id && imageSource(el))
      || images.find(el=>!el.closest('a[href]') && !/로고|logo/i.test(el.alt || '') && imageSource(el));
    const imageUrl=imageSource(image);
    const labelValue=pattern => lines.map((line,i)=> { const m=line.match(pattern); return m ? clean(m[1] || lines[i+1]) : ''; }).find(Boolean) || '';
    const optionQuantity=lines.map(line=>line.match(/^(.+?)\s*\/\s*(\d+)\s*개$/)).find(Boolean);
    const option=labelValue(/^(?:옵션|사이즈)\s*[:：]?\s*(.*)$/) || clean(optionQuantity?.[1]);
    const qtyMatch=value.match(/수량\s*[:：]?\s*(\d+)\s*(?:개)?/) || value.match(/(?:^|\s)(\d+)\s*개(?:\s|$)/);
    const quantity=qtyMatch ? Number(qtyMatch[1]) : Number(optionQuantity?.[2] || 0);
    const amount=labelValue(/^(?:(?:상품별|상품|실제|최종)\s*)?(?:실\s*)?(?:결제|구매)\s*(?:금액|가격)\s*[:：]?\s*(.*)$/);
    const priceMatch=amount.match(/^([0-9][0-9,]*)\s*원(?:\s|$)/);
    // Current cards show one plain item payment below "BLACK · 105 / 3개".
    // Ambiguous multiple prices remain unknown; the order-total section is out
    // of this card and must never supply a line's payment.
    const cardPrices=optionQuantity?lines.map(line=>line.match(/^([0-9][0-9,]*)\s*원$/)).filter(Boolean):[];
    const amounts=[...new Set(cardPrices.map(match=>Number(match[1].replace(/,/g,''))))];
    const purchasePrice=priceMatch ? Number(priceMatch[1].replace(/,/g,'')) : amounts.length===1?amounts[0]:0;
    const articleNumber=labelValue(/^(?:품번|스타일\s*(?:번호|코드)|제품\s*코드)\s*[:：]?\s*(.*)$/).split(/\s/)[0];
    const brand=labelValue(/^브랜드\s*[:：]?\s*(.*)$/) || clean(card.querySelector('a[href*="/brand/"],a[href*="/brands/"]')?.innerText);
    const named=[...card.querySelectorAll('a[href]')].find(el=>productId(el)===id && clean(text(el)));
    const modelName=clean(named?.innerText) || clean(image?.alt);
    const missing=[];
    if (!articleNumber) missing.push('품번');
    if (!option) missing.push('옵션·사이즈');
    if (!purchasePrice) missing.push('상품별 실결제금액');
    if (!quantity) missing.push('수량');
    if (!imageUrl) missing.push('상품 사진');
    rows.push({platform:'무신사',orderNumber:numbers[0],purchaseDate,purchaseUrl:new URL(link.href,href).origin+new URL(link.href,href).pathname,
      productId:id,articleNumber,brand,modelName,krSize:option,optionText:option,purchasePrice,quantity,
      imageUrl,cardIssuer,status:'구매완료',missing,
      sourceOrderUrl:new URL(href).origin+new URL(href).pathname,orderLineId:card.getAttribute('data-order-item-id')
        || card.closest('[data-order-item-id]')?.getAttribute('data-order-item-id')
        || card.querySelector('[data-order-item-id]')?.getAttribute('data-order-item-id') || `${id}:${rows.length}`});
  }
  return {kind:'detail',href,orderNumber:numbers[0],purchaseDate,rows,code:rows.length ? '' : 'ORDER_PRODUCTS_NOT_FOUND'};
}

// Supplement identity and a missing photo only. Current catalog prices/stock never replace the
// purchased amount, quantity or selected option from the order detail.
export function captureMusinsaLedgerProductIdentity(expectedProductId) {
  const url=new URL(location.href);
  if (url.protocol!=='https:' || url.username || url.password || !/(^|\.)musinsa\.com$/i.test(url.hostname)
    || url.pathname.match(/\/(?:products|app\/goods)\/(\d+)(?:\/|$)/)?.[1]!==String(expectedProductId)) return null;
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const body=String(document.body?.innerText||'');
  if (/비정상적인\s*접근|접근이?\s*제한|자동입력\s*방지|보안\s*(?:확인|문자)|access\s*denied|too\s*many\s*requests/i.test(body)
    || document.querySelector('input[type="password"]')) return null;
  const lines=body.split(/\n+/).map(clean).filter(Boolean);
  let articleNumber='';
  for (let i=0;i<lines.length;i++) {
    const match=lines[i].match(/^(?:품번|스타일\s*(?:번호|코드)|제품\s*코드)\s*[:：]?\s*(.*)$/);
    if (match) { articleNumber=clean(match[1]||lines[i+1]);break; }
  }
  if (articleNumber===String(expectedProductId) || articleNumber.length>80 || !/[0-9]/.test(articleNumber)) articleNumber='';
  let imageUrl='';
  const canonical=document.querySelector('link[rel="canonical"]')?.href;
  let canonicalMatches=!canonical;
  if(canonical)try {const target=new URL(canonical,url);canonicalMatches=target.origin===url.origin && target.pathname.replace(/\/$/,'')===url.pathname.replace(/\/$/,'');}catch { /* Ignore invalid catalog metadata. */ }
  // Social metadata identifies the current product; never scan recommended
  // products for a replacement image when its main photo is unavailable.
  if (canonicalMatches) {
    for (const meta of document.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]')) {
      try {
        const image=new URL(meta.content,url);
        if (image.protocol==='https:' && !image.username && !image.password && !/placeholder|no[-_]?image|(?:^|\/)(?:blank|spacer|logo)(?:[._/-]|$)|\.svg$/i.test(image.pathname)) {imageUrl=image.href;break;}
      } catch { /* Keep a missing image explicit. */ }
    }
  }
  return articleNumber || imageUrl ? {...(articleNumber?{articleNumber}:{}),...(imageUrl?{imageUrl}:{})} : null;
}
