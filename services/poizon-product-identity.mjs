// One identity resolver for comparison, workbook writes and search results.
// SPU metrics never identify an individual size. SKU-level callers must opt in.
export const cleanId = (value) => String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
export const normalizedArticle = (value) => cleanId(value).toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
export const normalizedSpu = (value) => {
  const raw = cleanId(value).replace(/\s+/g, '');
  if (/^\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, '');
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(raw)) {
    const n = Number(raw);
    if (Number.isSafeInteger(n) && n >= 0) return String(n);
  }
  return raw;
};
export const productSpu = (p = {}) => normalizedSpu(p.spuId || p.globalSpuId);
export const productSku = (p = {}) => cleanId(p.skuId || p.globalSkuId);
const article = (p) => normalizedArticle(p.articleNumber || p.productCode);
const brandId = (p) => cleanId(p.brandId || p.brandCode);
const compatibleBrand = (a, b) => !brandId(a) || !brandId(b) || brandId(a) === brandId(b);

export function indexProductIdentities(products = []) {
  if (!Array.isArray(products)) throw new TypeError('상품 목록이 배열이 아닙니다.');
  const bySpu = new Map(), bySku = new Map(), byArticle = new Map();
  for (const product of products) {
    if (!product || typeof product !== 'object') continue;
    for (const [map, key] of [[bySpu, productSpu(product)], [bySku, productSku(product)], [byArticle, article(product)]]) {
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(product);
    }
  }
  return { bySpu, bySku, byArticle };
}

export function resolveProductIdentity(query = {}, index, { level = 'spu' } = {}) {
  const fail = (reason) => ({ products: [], matchBy: reason, reason });
  const decide = (candidates, matchBy) => {
    if (!candidates.length) return fail('상품 없음');
    const compatible = candidates.filter((p) => compatibleBrand(query, p));
    if (!compatible.length) return fail('브랜드 식별자 충돌');
    return { products: compatible, matchBy, reason: '' };
  };
  if (level === 'sku') {
    if (!productSku(query)) return fail('SKU 식별자 없음');
    const candidates = index.bySku.get(productSku(query)) || [];
    if (candidates.some((p) => productSpu(query) && productSpu(p) && productSpu(query) !== productSpu(p))) return fail('식별자 충돌');
    return decide(candidates, 'SKU');
  }
  if (productSpu(query)) {
    const candidates = index.bySpu.get(productSpu(query)) || [];
    if (candidates.length) {
      const compatible = candidates.filter((p) => compatibleBrand(query, p));
      // SPU is the primary product identity. Excel can legitimately contain
      // several SKU/option rows for one SPU and can be in any row order.
      if (compatible.length) return { products: compatible, matchBy: 'SPU', reason: '' };
      return fail('브랜드 식별자 충돌');
    }
  }
  const code = article(query);
  if (!code) return fail('식별자 없음');
  const candidates = index.byArticle.get(code) || [];
  if (!candidates.length) return fail('상품 없음');
  // A known but different SPU is never repaired by falling back to a code.
  if (candidates.some((p) => productSpu(query) && productSpu(p) && productSpu(query) !== productSpu(p))) return fail('식별자 충돌');
  if (new Set(candidates.map(productSpu).filter(Boolean)).size > 1) return fail('식별자 충돌');
  const compatible = candidates.filter((p) => compatibleBrand(query, p));
  if (!compatible.length) return fail('브랜드 식별자 충돌');
  // Do not reject a valid product merely because another Excel row with the
  // same article belongs to a different brand. The compatible rows are the
  // only rows eligible for comparison/writes.
  const compatibleBrands = new Set(compatible.map(brandId).filter(Boolean));
  if (compatibleBrands.size > 1) return fail('브랜드 식별자 충돌');
  return { products: compatible, matchBy: '상품번호', reason: '' };
}

export const VERIFIED_PARENT_HEADERS = Object.freeze({
  china: 'POIZON 상품 최근 30일 판매량',
  local: 'POIZON 상품 현지 판매자 최근 30일 판매량',
});

export function verifiedParentMetric(product = {}, local = false) {
  if (product.salesScope === 'sku' || product.metricScope === 'sku') return null;
  const key = local ? 'localSales30d' : 'sales30d';
  const flag = local ? 'hasLocalSalesData' : 'hasSalesData';
  if (product[flag] !== true) return null;
  const raw = cleanId(product[key + 'Raw'] === '' || product[key + 'Raw'] == null ? product[key] : product[key + 'Raw']);
  // Preserve range notation; never convert 1,400+ to an exact 1400.
  return /^(?:(?:<=|>=|[<>≤≥])\s*)?\d[\d,]*(?:\.\d+)?\s*\+?$/.test(raw) ? raw : null;
}

export function consistentParentProduct(products = []) {
  if (!products.length) return null;
  const eligible = products.filter((p) => !productSku(p) && p.salesScope !== 'sku' && p.metricScope !== 'sku');
  if (!eligible.length) return null;
  const result = { ...eligible[0], salesScope: 'spu' };
  for (const local of [false, true]) {
    const key = local ? 'localSales30d' : 'sales30d';
    const flag = local ? 'hasLocalSalesData' : 'hasSalesData';
    const values = [...new Set(eligible.map((p) => verifiedParentMetric(p, local)).filter((v) => v !== null))];
    if (values.length > 1) return null; // Conflicting source records need a fresh read.
    result[key + 'Raw'] = values[0] ?? '';
    result[flag] = values.length === 1;
    result[key] = values.length ? Number(values[0].replace(/[^\d.]/g, '')) : 0;
  }
  return result;
}
