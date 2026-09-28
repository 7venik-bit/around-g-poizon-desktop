const compact = value => String(value || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const sameName = value => clean(value).replace(/[\s_-]/g, '').toUpperCase();
const words = {
  BLACK:'블랙', WHITE:'화이트', CHARCOAL:'차콜', GRAY:'그레이', GREY:'그레이',
  NAVY:'네이비', BLUE:'블루', GREEN:'그린', RED:'레드', PINK:'핑크', PURPLE:'퍼플',
  BEIGE:'베이지', IVORY:'아이보리', BROWN:'브라운', KHAKI:'카키', YELLOW:'옐로',
  ORANGE:'오렌지', CREAM:'크림', SILVER:'실버', GOLD:'골드', MINT:'민트', CORAL:'코랄',
  OLIVE:'올리브', BURGUNDY:'버건디', WINE:'와인', LAVENDER:'라벤더', VIOLET:'바이올렛',
  LIGHT:'라이트', DARK:'다크', DEEP:'딥', SOFT:'소프트', PALE:'페일',
  MELANGE:'멜란지', HEATHER:'헤더', INDIGO:'인디고', OATMEAL:'오트밀', SAND:'샌드',
};

// Translate observed names, never infer a colour from a retailer's private code.
export function readableColorName(value) {
  const raw = clean(value).replace(/[_-]+/g, ' ');
  if (!raw || raw.length > 48 || /[0-9<>/]/.test(raw)
    || /품절|선택|배송|사이즈|재고|상품|쿠폰|할인|SIZE|SELECT|SOLD OUT/i.test(raw)) return '';
  if (/^[가-힣\s]+$/.test(raw)) return raw;
  if (!/^[A-Z\s]+$/i.test(raw)) return '';
  const tokens = raw.toUpperCase().split(/\s+/);
  if (tokens.join(' ') === 'OFF WHITE') return '오프화이트';
  if (tokens.every(token => words[token])) return tokens.map(token => words[token]).join(' ');
  // A full unrecognised colour name is useful evidence too; keep its wording.
  // Short bare abbreviations remain unresolved (e.g. BLU or CHC).
  return raw.length > 4 ? raw : '';
}

export function descenteColorIdentity(product) {
  try {
    const url = new URL(String(product.url || ''));
    const match = url.pathname.match(/^\/DESCENTE\/product\/([^/]+)\/([A-Z0-9]+)\/?$/i);
    if (!/^(?:www\.)?dk-on\.com$/i.test(url.hostname) || !match) return null;
    return {article:compact(match[1]), code:match[2].toUpperCase()};
  } catch { return null; }
}

function codedName(value) {
  const match = clean(value).match(/^([A-Z0-9]{2,8})[_\s-]+(.+)$/i);
  const name = match && readableColorName(match[2]);
  return name ? {code:match[1].toUpperCase(), name, rawName:clean(value)} : null;
}

export function colorLabelHasCode(value, code) {
  return codedName(value)?.code === code;
}

function observedNames(product) {
  const names = (product.sizes || []).flatMap(option => {
    const first = option.optionPath?.[0] || String(option.label || '').split(' / ')[0];
    const parsed = codedName(first);
    return parsed ? [parsed] : [];
  });
  if (product.colorCode && !product.colorNameSource) {
    const name = readableColorName(product.colorName);
    if (name) names.push({code:String(product.colorCode).toUpperCase(), name, rawName:product.colorName});
  }
  return names;
}

function productOwnsArticle(product, article) {
  if (product.articleConflict || product.signals?.codeConflict || product.musinsaImageRejected
    || product.brandVerifiedFromCard === false) return false;
  const detected = compact(product.detectedArticleNumber);
  if (detected && detected !== article) return false;
  // articleNumber can be copied from the query: require product-owned evidence.
  const ownText = [product.title, product.name, product.apiTitle].filter(Boolean).join(' ');
  const codes = ownText.toUpperCase().match(/[A-Z0-9]+(?:[-_][A-Z0-9]+)*/g) || [];
  const articles = codes.filter(token => !codedName(token)).map(compact)
    .filter(code => code.length >= 8 && /[A-Z]/.test(code) && /\d/.test(code));
  if (articles.some(code => code !== article)) return false;
  return detected === article || articles.includes(article);
}

// One search result is the scope of the comparison; no global, cross-brand
// code dictionary is learned. Names never transfer another seller's stock.
export function descenteColorEvidence(products) {
  const wanted = new Set(products.map(descenteColorIdentity).filter(Boolean).map(value => value.article));
  const evidence = new Map();
  if (!wanted.size) return evidence;
  // A fresh stock checkpoint may omit a name learned earlier. Reuse only a
  // saved name bound to this exact official model/colour, regardless of order.
  for (const product of products) {
    const identity = descenteColorIdentity(product);
    const name = readableColorName(product.colorName);
    if (!identity || !name || compact(name) === identity.code
      || String(product.colorCode || '').toUpperCase() !== identity.code) continue;
    const key = `saved:${identity.article}:${identity.code}`;
    if (!evidence.has(key)) evidence.set(key, new Map());
    evidence.get(key).set(sameName(name), {name, source:product.colorNameSource});
  }
  for (const product of products) {
    let host;
    try { host = new URL(product.url).hostname.toLowerCase(); } catch { continue; }
    if (!/(^|\.)(?:musinsa\.com|naver\.com|ssg\.com|lotteon\.com)$/.test(host)) continue;
    if (!/(?:데상트|descente|迪桑特)/i.test([product.brand,product.title,product.name,product.apiTitle].join(' '))) continue;
    for (const article of wanted) {
      if (!productOwnsArticle(product, article)) continue;
      for (const color of observedNames(product)) {
        const key = `${article}:${color.code}`;
        if (!evidence.has(key)) evidence.set(key, new Map());
        evidence.get(key).set(sameName(color.name), {...color, article, url:product.url,
          store:product.sourceStore || product.store || host, kind:'retailer'});
      }
    }
  }
  return evidence;
}

export function resolveDescenteColor(product, identity, evidence) {
  const {article, code} = identity;
  // Keep an already observed name (including a prior checkpoint's evidence).
  const current = readableColorName(product.colorName);
  if (current && compact(product.colorName) !== code && String(product.colorCode || code).toUpperCase() === code) {
    return {name:current, source:product.colorNameSource};
  }
  const ownNames = new Map(observedNames(product).filter(value => value.code === code)
    .map(value => [sameName(value.name), value]));
  // A DK colour click can change the title without changing the URL. A title
  // alone therefore cannot establish which colour code that name belongs to.
  if (ownNames.size === 1) {
    const own = [...ownNames.values()][0];
    return {name:own.name, source:{kind:'official', article, code, url:product.url, rawName:own.rawName}};
  }
  const saved = evidence.get(`saved:${article}:${code}`);
  if (saved?.size === 1 && ownNames.size === 0) return [...saved.values()][0];
  const peers = evidence.get(`${article}:${code}`);
  if (peers?.size === 1 && ownNames.size === 0) {
    const peer = [...peers.values()][0];
    return {name:peer.name, source:{...peer, code}};
  }
  // Existing, brand-scoped labels remain available when peer sites are off.
  // CHC0 was confirmed as CHARCOAL GREY on SR323UTL71 (official + Musinsa).
  const known = {BLK0:'블랙', WHT0:'화이트', BLU0:'BLU', CHC0:'차콜 그레이'};
  return {name:known[code] || code};
}

export function replaceColorSuffix(value, previousNames, name) {
  let title = clean(value);
  for (const previous of previousNames.filter(Boolean)) {
    const suffix = ` [${previous}]`;
    if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
  }
  return title.endsWith(` [${name}]`) ? title : `${title} [${name}]`;
}
