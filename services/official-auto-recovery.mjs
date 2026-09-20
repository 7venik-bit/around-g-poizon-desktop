import { isOfficialProductCandidateUrl } from './official-product-candidate.mjs';

const blocked = result => result?.rateLimited || result?.loginRequired || result?.securityVerificationRequired
  || /login|captcha|access.?denied|blocked|rate.?limit|cooldown|next_day|search_canceled/i.test([
    result?.verificationReason, result?.verificationDiagnostics?.lastDetailFailure,
  ].filter(Boolean).join(' ')) || result?.verificationDiagnostics?.lastDetailState?.loginFormVisible
  || result?.products?.some(p => p.stockStatus === 'login_required');
const utility = /공유하기|장바구니|사이즈\s*비교|\d+개씩\s*보기|share|size\s*guide/i;
const normalizeCode = value => String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

export function diagnoseOfficialCollection(result = {}, code = '') {
  if (blocked(result)) return ['interaction_required'];
  if (result.absenceConfirmed && !result.products?.length) return [];
  const issues = new Set();
  if (!result.products?.length) issues.add('product_not_collected');
  for (const product of result.products || []) {
    if (!(Number(product.price) > 0)) issues.add('price_missing');
    if (!product.stockVerified || ['partial', 'unknown'].includes(product.stockCoverage)
      || (product.sizes || []).some(s => typeof s.inStock !== 'boolean')) issues.add('stock_incomplete');
    if ((product.sizes || []).some(s => utility.test(s.label || ''))) issues.add('non_product_option');
    const labels = (product.sizes || []).map(s => String(s.label || '').trim());
    if (new Set(labels).size !== labels.length) issues.add('duplicate_options');
    const actual = product.detectedArticleNumber || product.articleNumber;
    if (actual && code && normalizeCode(actual) !== normalizeCode(code)) issues.add('identity_mismatch');
  }
  if (result.verificationReason || result.detailVerificationPending) issues.add('collection_incomplete');
  return [...issues];
}

function eligibleUrl(value, source, code) {
  try {
    const url = new URL(value), home = new URL(source.homepageUrl);
    if (url.protocol !== 'https:' || url.username || url.password
      || url.hostname.replace(/^www\./, '') !== home.hostname.replace(/^www\./, '')
      || !isOfficialProductCandidateUrl(url.href) || url.pathname === '/') return '';
    // A URL-only fallback must own the requested code. Never guess a product
    // address from the brand or follow a recommendation/search page.
    const tokens = decodeURIComponent(url.pathname + ' ' + url.search).toUpperCase().split(/[^A-Z0-9-]+/);
    if (!code || !tokens.some(token => normalizeCode(token) === normalizeCode(code))) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

// This runs inside the existing source watchdog. Each known detail is visited
// at most once; restrictions abort the whole fallback, never trigger login.
export async function recoverOfficialCollection({source, code, collect, canceled = () => false, onProgress = () => {}}) {
  let result = await collect(source);
  if (source.store !== '브랜드 공식몰' || !result) return result;
  const issues = diagnoseOfficialCollection(result, code);
  if (!issues.length) return result;
  const history = {version: 1, issues, attempts: [], status: 'manual', checkedAt: new Date().toISOString()};
  if (blocked(result) || blocked(source)) return {...result, autoRecovery: {...history, status: 'blocked'}};
  const candidates = [...(result.products || []).filter(p => diagnoseOfficialCollection({products:[p]}, code).length).map(p => p.url),
    source.verifiedProductUrl, source.officialProductUrl, result.resolvedSearchUrl,
    result.verificationDiagnostics?.lastDetailUrl];
  const urls = [...new Set(candidates.map(url => eligibleUrl(url, source, code)).filter(Boolean))]
    .filter(url => !source.directProductUrls?.includes(url));
  let products = (result.products || []).filter(p => !diagnoseOfficialCollection({products:[p]}, code).includes('identity_mismatch'))
    .map(p => {
      const invalid = diagnoseOfficialCollection({products:[p]}, code).some(issue => ['non_product_option','duplicate_options'].includes(issue));
      return invalid ? {...p, sizes:[], stockVerified:false, inStock:null, stockCoverage:'unknown', stockText:'옵션 정보 확인 필요'} : p;
    });
  for (const url of urls) {
    if (canceled()) throw new Error('DOMESTIC_SEARCH_CANCELED');
    onProgress({phase:'recovering', message:'공식몰 상세 정보를 자동 복구하고 있습니다.'});
    let next;
    try { next = await collect({...source, officialProductUrl:url, directProductUrls:[url]}); }
    catch (error) {
      if (canceled() || /CANCELED/.test(error.message)) throw error;
      history.attempts.push({strategy:'known_detail', url, issues:['detail_read_failed']});
      continue;
    }
    const remaining = diagnoseOfficialCollection(next || {}, code);
    history.attempts.push({strategy:'known_detail', url, issues:remaining});
    if (blocked(next)) {
      return {...result, ...next, products, detailVerificationPending:true,
        autoRecovery:{...history, status:'blocked'}};
    }
    // Do not overwrite known observations with a partial or mismatched read.
    const accepted = (next?.products || []).filter(p => !diagnoseOfficialCollection({products:[p]}, code).length);
    products = [...products.filter(old => !accepted.some(p => p.url === old.url)), ...accepted];
  }
  const unresolved = diagnoseOfficialCollection({products}, code);
  const recovered = history.attempts.length > 0 && history.attempts.every(a => !a.issues.length) && !unresolved.length;
  history.status = recovered ? 'recovered' : history.attempts.length ? 'partial' : 'manual';
  return {...result, products, count:products.length, absenceConfirmed:false,
    detailVerificationPending:!recovered,
    ...(recovered ? {verificationReason:'', verificationFailed:false} : {}), autoRecovery:history};
}
