import { normalizeStockQuantity } from './retailer-stock-strategies.mjs';

// This function runs in the retailer's rendered document. Keep it self-contained
// so serializing it does not introduce template-string regex escaping bugs.
export function captureRenderedStockEvidence(selectors = [], root = document) {
  const statusPattern = /품절|매진|솔드\s*아웃|재고(?:\s*수량)?\s*[:：]?\s*(?:없|소진|있|[\d,]+)|남은\s*(?:재고|수량)\s*[:：]?\s*[\d,]+|SOLD[\s_-]*OUT|OUT[\s_-]*OF[\s_-]*STOCK|구매\s*(?:불가|할\s*수\s*없|가능)|판매\s*(?:종료|중지)|재입고/i;
  const unavailablePattern = /품절(?!\s*임박)|매진|솔드\s*아웃|재고(?:\s*수량)?\s*[:：]?\s*(?:없|소진|0(?:개|\s|$|\)))|남은\s*(?:재고|수량)\s*[:：]?\s*0(?:개|\s|$|\))|SOLD[\s_-]*OUT|OUT[\s_-]*OF[\s_-]*STOCK|구매\s*(?:불가|할\s*수\s*없)|판매\s*(?:종료|중지)/i;
  const excluded = 'header,footer,nav,[role="navigation"],[class*="recommend" i],[class*="related" i],[class*="review" i],[class*="shipping" i],[class*="delivery" i],[class*="policy" i],[class*="sizeguide" i],[class*="size-guide" i],[class*="sizetable" i],[class*="size-chart" i],.header_gnb';
  const visible = el => {
    if (!el || el.closest('[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const rawText = el => String(el?.labels?.[0]?.innerText || el?.labels?.[0]?.textContent || el?.innerText || el?.textContent || el?.value || '').replace(/\s+/g,' ').trim();
  const purchasePattern = /^(?:바로\s*)?구매(?:하기)?$|^장바구니(?:에?\s*담기)?$|^BUY(?:\s*NOW)?$|^ADD\s*TO\s*(?:CART|BAG)$/i;
  let scope = root;
  if (root === document) {
    const heading = [...root.querySelectorAll('.cdtl_info_tit,.pd-widget1__product-name'), ...(/(^|\.)naver\.com$/i.test(location.hostname) ? root.querySelectorAll('h3') : []), ...root.querySelectorAll('h1,[itemprop="name"],[class*="product" i][class*="title" i],[class*="goods" i][class*="name" i]')]
      .find(el => visible(el) && !el.closest(excluded));
    for (let node = heading?.parentElement, depth = 0; node && node !== document.body && depth < 8; node = node.parentElement, depth++) {
      const action = [...node.querySelectorAll('button,a,[role="button"],input[type="submit"]')]
        .some(el => visible(el) && !el.closest(excluded) && (purchasePattern.test(rawText(el)) || unavailablePattern.test(rawText(el))));
      if (action) { scope = node; break; }
    }
    if (scope === root) scope = root.querySelector('main') || root.body || root;
  }
  const optionSelectors = [...new Set([...selectors, 'select option', '[role="option"]', '[data-size]', '[data-option]'])];
  const optionCandidates = [...new Set(optionSelectors.flatMap(selector => [...scope.querySelectorAll(selector)]))]
    .filter(el => (visible(el) || (el.tagName === 'OPTION' && visible(el.parentElement)) || (el.tagName === 'INPUT' && visible(el.labels?.[0]))) && !el.closest(excluded))
    .filter(el => {
      const select = el.closest('select');
      const controlText = select ? [select.name, select.id, select.getAttribute('aria-label'), select.closest('label')?.textContent].join(' ') : '';
      return !/quantity|qty|구매\s*수량|주문\s*수량|^수량$/i.test(controlText.trim())
        && !/사이즈\s*(?:가이드|안내|표)|SIZE\s*(?:GUIDE|CHART)/i.test(rawText(el));
    });
  // Broad store selectors can match an entire size list. Keep individual choices.
  const optionNodes = optionCandidates.filter(el => !optionCandidates.some(child => child !== el && el.contains(child)));
  const options = optionNodes.map(el => {
    const label = rawText(el);
    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled|sold.?out|품절/i.test(String(el.className || ''))
      || (el.tagName === 'INPUT' && /disabled|sold.?out/i.test(String(el.parentElement?.className || '')));
    return {label, inStock:!disabled && !unavailablePattern.test(label), stockText:label};
  }).filter(option => option.label && option.label.length <= 80);
  const isOption = el => optionNodes.some(option => option === el || option.contains(el) || el.contains(option));
  const nodes = [...scope.querySelectorAll('p,div,span,strong,b,em,button,a,label')]
    .filter(el => visible(el) && !el.closest(excluded) && !isOption(el));
  const candidates = nodes.filter(el => { const value = rawText(el); return value && value.length <= 240 && statusPattern.test(value); });
  const stockTexts = [...new Set(candidates.filter(el => !candidates.some(child => child !== el && el.contains(child))).map(rawText))];
  const purchaseAvailable = [...scope.querySelectorAll('button,a,[role="button"],input[type="submit"]')]
    .some(el => visible(el) && !el.closest(excluded) && !el.disabled && el.getAttribute('aria-disabled') !== 'true'
      && !/disabled/i.test(String(el.className || '')) && purchasePattern.test(rawText(el)));
  const accessText = [...scope.querySelectorAll('button,[role="button"]')]
    .filter(el => visible(el) && !el.closest(excluded)).map(rawText)
    .find(text => /^(?:회원 전용|로그인 후 (?:구매|이용)|로그인하고 구매)/.test(text)) || '';
  return {stockTexts, purchaseAvailable, options, ...(accessText && !options.length ? {loginRequired:true,accessText} : {})};
}

export function normalizeRenderedStockEvidence({ pageText = '', stockTexts, purchaseAvailable = false, options = [], loginRequired = false, accessText = "" } = {}) {
  if (loginRequired) return {inStock:null,sizes:[],stockStatus:'login_required',stockText:accessText || '로그인 필요',stockVerified:false};
  const unavailable = /(?:일시\s*)?품절(?!\s*임박)|매진|솔드\s*아웃|재고(?:\s*수량)?\s*[:：]?\s*(?:없|소진|0(?:개|\s|$|\)))|남은\s*(?:재고|수량)\s*[:：]?\s*0(?:개|\s|$|\))|SOLD[\s_-]*OUT|OUT[\s_-]*OF[\s_-]*STOCK|구매\s*(?:불가|할\s*수\s*없)|판매\s*(?:종료|중지)/i;
  const unique = new Map();
  for (const option of Array.isArray(options) ? options : []) {
    const label = String(option?.label ?? option?.name ?? option ?? '').replace(/\s+/g,' ').trim();
    if (!label || label.length > 80 || /선택(?:해\s*주세요|하세요|해주세요)?$|^(?:옵션|수량|컬러|색상|사이즈)$/i.test(label)) continue;
    const rawStockText = typeof option === 'object' ? String(option.stockText || option.statusText || '').replace(/\s+/g,' ').trim() : '';
    const rawQuantity = (rawStockText || label).match(/(?:재고(?:\s*수량)?|남은\s*(?:재고|수량))\s*[:：]?\s*([\d,]+)|([\d,]+)\s*개\s*남(?:음|았)/);
    const quantity = normalizeStockQuantity(option?.quantity ?? option?.stockQuantity ?? rawQuantity?.[1] ?? rawQuantity?.[2]);
    const inStock = unavailable.test(rawStockText || label) || option?.inStock === false || quantity === 0 ? false
      : option?.inStock === true || quantity > 0 ? true : null;
    const key = label.toUpperCase();
    if (!unique.has(key) || inStock === true) unique.set(key,{label,inStock,stockText:rawStockText,...(quantity !== null ? {quantity} : {})});
  }
  const lines = (Array.isArray(stockTexts) ? stockTexts : String(pageText || '').split(/\n+/))
    .map(line => String(line || '').replace(/\s+/g,' ').trim());
  const purchaseLimit = /(?:ID|아이디|회원|계정|1인|인당).{0,20}구매.{0,20}(?:수량|한도|최대|제한)|구매\s*(?:가능\s*)?(?:수량|한도|제한)|최대\s*[\d,]+\s*개.{0,12}구매/i;
  const purchaseLimitText = [...new Set(lines.filter(line => line.length <= 240 && purchaseLimit.test(line)))].join('\n');
  const notices = [...new Set(lines.map(line => String(line || '').replace(/\s+/g,' ').trim())
    .filter(line => line && line.length <= 240 && /품절|매진|솔드\s*아웃|재고(?:\s*수량)?\s*[:：]?\s*(?:없|소진|있|[\d,]+)|남은\s*(?:재고|수량)\s*[:：]?\s*[\d,]+|SOLD[\s_-]*OUT|OUT[\s_-]*OF[\s_-]*STOCK|구매\s*(?:불가|할\s*수\s*없|가능)|판매\s*(?:종료|중지)|재입고/i.test(line))
    .filter(line => !purchaseLimit.test(line) && !/품절\s*임박|완판\s*임박|SOLD[\s_-]*OUT\s*SOON/i.test(line))
    .filter(line => !/(?:품절|재고).{0,40}(?:경우|시\s*(?:에는|에|취소|환불|연락))|(?:교환|환불|반품).{0,25}품절/.test(line)))];
  const stockText = notices.join('\n');
  const sizes = [...unique.values()];
  const explicitQuantity = stockText.match(/(?:재고(?:\s*수량)?|남은\s*(?:재고|수량))\s*[:：]?\s*([\d,]+)/);
  const explicitlyAvailable = /재고\s*있|구매\s*가능/i.test(stockText) || Number(explicitQuantity?.[1]?.replace(/,/g,'')) > 0;
  const inStock = unavailable.test(stockText) ? false
    : sizes.some(size => size.inStock) ? true
      : sizes.length && sizes.every(size => size.inStock === false) ? false : purchaseAvailable || explicitlyAvailable ? true : null;
  if (unavailable.test(stockText)) for (const size of sizes) size.inStock = false;
  return {inStock,sizes,stockStatus:inStock === true ? 'available' : inStock === false ? 'soldout' : 'unknown',stockText,...(purchaseLimitText ? {purchaseLimitText} : {}),stockVerified:inStock !== null};
}
