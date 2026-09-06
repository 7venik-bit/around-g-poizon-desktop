// Shared by the main process and the Excel comparison view. Never substitute
// lifetime totals for recent-30-day metrics, or prefilter stale Excel values.
export function normalizeVerificationConditions(input = {}) {
  const boundary = (value) => {
    if (value === '' || value == null) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
      throw new Error('판매량 조건은 0 이상의 정수여야 합니다.');
    }
    return number;
  };
  return Object.freeze({
    period: 'recent30', matchMode: 'all',
    minimumChinaSales30: boundary(input.minimumChinaSales30),
    minimumLocalSales30: boundary(input.minimumLocalSales30),
  });
}

export function verificationConditionLabel(input = {}) {
  const c = normalizeVerificationConditions(input);
  const label = (value) => value === null ? '조건 없음' : `${value.toLocaleString('ko-KR')} 이상`;
  return `최근 30일 · 중국 ${label(c.minimumChinaSales30)} · 현지 판매자 ${label(c.minimumLocalSales30)} · AND`;
}

export function recentMetric(product = {}, local = false) {
  const key = local ? 'localSales30d' : 'sales30d';
  const flag = local ? 'hasLocalSalesData' : 'hasSalesData';
  if (product[flag] === false) return null;
  const rawValue = product[key + 'Raw'];
  const raw = String(rawValue == null || rawValue === '' ? product[key] ?? '' : rawValue).normalize('NFKC').trim();
  const match = raw.replace(/,/g, '').match(/^(<|<=|≤|>|>=|≥)?\s*(\d+(?:\.\d+)?)\s*(\+)?$/);
  if (!match) return null;
  const value = Number(match[2]);
  const op = match[1] || (match[3] ? '>=' : '=');
  const min = op === '<' || op === '<=' || op === '≤' ? 0 : op === '>' ? value + 1 : value;
  const max = op === '<' ? Math.max(-1, value - 1) : op === '<=' || op === '≤' ? value
    : op === '>' || op === '>=' || op === '≥' ? Infinity : value;
  return { raw, min, max, signature: `${min}:${max}` };
}

export function meetsVerificationConditions(product, conditions) {
  const c = normalizeVerificationConditions(conditions);
  const tests = [[c.minimumChinaSales30, recentMetric(product)], [c.minimumLocalSales30, recentMetric(product, true)]];
  // Missing values are not zero; an uncertain bound cannot prove qualification.
  return tests.every(([minimum, metric]) => minimum === null || (metric && metric.min >= minimum));
}

// Resolve one recent-30-day metric across all Excel rows belonging to one SPU.
// Blank/unknown option rows do not poison an otherwise unambiguous parent value.
// We still refuse to guess when two distinct valid values exist.
export function resolveExcelRecentMetric(products = [], local = false) {
  const observed = products
    .map((product) => recentMetric(product, local))
    .filter(Boolean);
  const bySignature = new Map();
  for (const metric of observed) {
    if (!bySignature.has(metric.signature)) bySignature.set(metric.signature, metric);
  }
  if (bySignature.size === 0) {
    return { state: 'missing', metric: null, metrics: [], raw: '미확인' };
  }
  if (bySignature.size > 1) {
    const metrics = [...bySignature.values()];
    return { state: 'conflict', metric: null, metrics, raw: metrics.map((metric) => metric.raw).join(' / ') };
  }
  const metric = [...bySignature.values()][0];
  return { state: 'resolved', metric, metrics: [metric], raw: metric.raw };
}

const article = (p) => String(p?.articleNumber || p?.productCode || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
const spu = (p) => String(p?.spuId || p?.globalSpuId || '').trim();
const identity = (p) => spu(p) ? `SPU:${spu(p)}` : article(p) ? `ARTICLE:${article(p)}` : '';

export function createPageCrossCheck({ runId, excelProducts = [], conditions = {}, brandName = '', fileName = '' } = {}) {
  if (!runId || !Array.isArray(excelProducts)) throw new Error('검증 실행번호와 Excel 상품 목록이 필요합니다.');
  const frozenConditions = normalizeVerificationConditions(conditions);
  const bySpu = new Map(), byArticle = new Map(), compared = new Map();
  for (const product of excelProducts) {
    for (const [map, key] of [[bySpu, spu(product)], [byArticle, article(product)]]) {
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(product);
    }
  }
  let pageNum = 0, pageCount = 0;
  const compare = (product, position) => {
    let candidates = bySpu.get(spu(product)) || [];
    let matchBy = candidates.length ? 'SPU' : '상품번호';
    if (!candidates.length) {
      const articleCandidates = byArticle.get(article(product)) || [];
      // Never attach a same-code, different-SPU item to the wrong workbook row.
      candidates = articleCandidates.filter((p) => !spu(product) || !spu(p) || spu(p) === spu(product));
      if (new Set(candidates.map(spu).filter(Boolean)).size > 1) candidates = [];
      if (articleCandidates.length && !candidates.length) matchBy = '식별자 충돌';
    }

    const source = [recentMetric(product), recentMetric(product, true)];
    const excelChina = resolveExcelRecentMetric(candidates, false);
    const excelLocal = resolveExcelRecentMetric(candidates, true);
    const excelResolved = [excelChina, excelLocal];
    const sourceAvailable = source.every(Boolean);
    const excelAvailable = excelResolved.every((entry) => entry.state === 'resolved' && entry.metric);
    const hasConflict = excelResolved.some((entry) => entry.state === 'conflict');
    const allAvailable = sourceAvailable && excelAvailable;
    const equal = candidates.length > 0 && allAvailable
      && excelResolved.every((entry, index) => entry.metric.signature === source[index].signature);
    const status = !identity(product) ? '식별자 없음'
      : !candidates.length ? matchBy === '식별자 충돌' ? matchBy : 'Excel 상품 없음'
      : hasConflict ? 'Excel 최근 30일 값 충돌'
      : equal ? '일치'
      : !allAvailable ? '최근 30일 값 미확인'
      : '값 다름';

    return {
      key: identity(product) || `UNREADABLE:${pageNum}:${position}`,
      articleNumber: String(product.articleNumber || product.productCode || ''), spuId: spu(product),
      title: String(product.name || product.title || ''), pageNum, matchBy, status,
      qualified: meetsVerificationConditions(product, frozenConditions),
      sourceChina: source[0]?.raw ?? '미확인', sourceLocal: source[1]?.raw ?? '미확인',
      excelChina: candidates.length ? excelChina.raw : '상품 없음',
      excelLocal: candidates.length ? excelLocal.raw : '상품 없음',
      excelChinaState: excelChina.state,
      excelLocalState: excelLocal.state,
      excelRows: candidates.flatMap((p) => p.sourceRowNumbers || [p.sourceRowNumber]).filter((n) => Number.isInteger(Number(n)) && Number(n) > 0).map(Number),
      matched: candidates.length > 0, equal,
    };
  };
  const counts = () => {
    const rows = [...compared.values()];
    return {
      checkedProducts: rows.length,
      matchedProducts: rows.filter((r) => r.matched).length,
      equalProducts: rows.filter((r) => r.equal).length,
      differentProducts: rows.filter((r) => r.matched && !r.equal).length,
      missingProducts: rows.filter((r) => !r.matched).length,
      qualifiedProducts: rows.filter((r) => r.qualified).length,
    };
  };
  return {
    conditions: frozenConditions,
    acceptPage(products, metadata = {}) {
      if (!Array.isArray(products)) throw new Error('검증할 페이지 상품 목록이 올바르지 않습니다.');
      pageNum = Number(metadata.pageNum || 0);
      pageCount = Number(metadata.pageCount || 0);
      // Replacing a page prevents inflated counts after a retry or re-read.
      for (const [key, row] of compared) if (row.pageNum === pageNum) compared.delete(key);
      const rows = products.map(compare);
      for (const row of rows) compared.set(row.key, row);
      return { runId, brandName, fileName, conditions: frozenConditions,
        phase: 'page-compared', pageNum, pageCount, updatedAt: new Date().toISOString(),
        ...counts(), rows, pageQualifiedProducts: rows.filter((row) => row.qualified).length };
    },
    snapshot() { return { runId, brandName, fileName, conditions: frozenConditions, pageNum, pageCount, ...counts(), rows: [...compared.values()] }; },
  };
}

// Runs inside the controlled Seller Center page. Source rows stay available to
// the completeness collector even in the condition-filtered visual view.
export function paintSellerVerification(document, payload) {
  const id = 'around-g-live-verification';
  let banner = document.getElementById(id);
  if (!banner) {
    banner = document.createElement('div');
    banner.id = id;
    banner.style.cssText = 'position:sticky;top:0;z-index:2147483000;background:#eaf6ff;color:#122b45;padding:10px 12px;font:600 13px/1.6 sans-serif;border-bottom:2px solid #357ed5;white-space:normal;';
    document.body.prepend(banner);
  }
  banner.textContent = payload.label + ' · ' + (payload.pageNum ? `${payload.pageNum}/${payload.pageCount}페이지 대조 완료 · 조건 충족 ${payload.pageQualifiedProducts}개` : '화면 수집 준비 중');
  const normalize = (s) => String(s || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const row of document.querySelectorAll('table tbody tr')) {
    const code = String(row.innerText || '').match(/상품\s*번호\s*[:：]\s*([A-Za-z0-9._/-]+)/)?.[1];
    if (!code) continue;
    const match = (payload.rows || []).find((r) => normalize(r.articleNumber) === normalize(code));
    // Do not display:none the original rows: they are completeness evidence.
    row.style.outline = match?.qualified ? '2px solid #78aaca' : '';
    row.style.outlineOffset = '-2px';
    row.dataset.aroundGVerification = match ? match.qualified ? 'qualified' : 'outside-condition' : 'pending';
  }
}
