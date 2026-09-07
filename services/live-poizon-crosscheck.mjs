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

function metricFromRaw(rawValue) {
  const raw = String(rawValue ?? '').normalize('NFKC').trim();
  const match = raw.replace(/,/g, '').match(/^(<|<=|≤|>|>=|≥)?\s*(\d+(?:\.\d+)?)\s*(\+)?$/);
  if (!match) return null;
  const value = Number(match[2]);
  const op = match[1] || (match[3] ? '>=' : '=');
  const min = op === '<' || op === '<=' || op === '≤' ? 0 : op === '>' ? value + 1 : value;
  const max = op === '<' ? Math.max(-1, value - 1) : op === '<=' || op === '≤' ? value
    : op === '>' || op === '>=' || op === '≥' ? Infinity : value;
  return { raw, min, max, signature: `${min}:${max}` };
}

export function recentMetric(product = {}, local = false) {
  const key = local ? 'localSales30d' : 'sales30d';
  const flag = local ? 'hasLocalSalesData' : 'hasSalesData';
  const explicitRaw = product[key + 'Raw'];
  const fallback = explicitRaw == null || explicitRaw === '' ? product[key] : explicitRaw;
  if (product[flag] === false && (explicitRaw == null || explicitRaw === '')) return null;
  return metricFromRaw(fallback);
}

function totalMetric(product = {}, local = false) {
  const key = local ? 'localTotalSales' : 'totalSales';
  const rawValue = product[key + 'Raw'];
  return metricFromRaw(rawValue == null || rawValue === '' ? product[key] : rawValue);
}

export function meetsVerificationConditions(product, conditions) {
  const c = normalizeVerificationConditions(conditions);
  const tests = [[c.minimumChinaSales30, recentMetric(product)], [c.minimumLocalSales30, recentMetric(product, true)]];
  return tests.every(([minimum, metric]) => minimum === null || (metric && metric.min >= minimum));
}

// POIZON_COMPOUND_RECENT30_NOT_MISSING
function compoundRecentMetric(rawValue) {
  const raw = String(rawValue ?? '').normalize('NFKC').trim();
  if (!raw) return null;
  const parts = raw.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const metrics = parts.map(metricFromRaw);
  if (metrics.some((metric) => !metric)) return null;
  const min = metrics.reduce((sum, metric) => sum + metric.min, 0);
  const max = metrics.some((metric) => metric.max === Infinity)
    ? Infinity
    : metrics.reduce((sum, metric) => sum + metric.max, 0);
  return { raw, min, max, signature: `AGG:${min}:${max}`, aggregate: true, componentCount: metrics.length };
}

function metricCompatible(excelEntry, sourceMetric) {
  if (!excelEntry?.metric || !sourceMetric) return false;
  if (excelEntry.state === 'resolved') return excelEntry.metric.signature === sourceMetric.signature;
  if (excelEntry.state !== 'aggregate') return false;
  const aggregate = excelEntry.metric;
  if (sourceMetric.max === Infinity) return aggregate.min >= sourceMetric.min;
  return aggregate.min <= sourceMetric.max && aggregate.max >= sourceMetric.min;
}

export function resolveExcelRecentMetric(products = [], local = false) {
  const observed = products.map((product) => recentMetric(product, local)).filter(Boolean);
  const bySignature = new Map();
  for (const metric of observed) {
    if (!bySignature.has(metric.signature)) bySignature.set(metric.signature, metric);
  }
  const totalValues = [...new Map(products.map((product) => totalMetric(product, local)).filter(Boolean).map((metric) => [metric.signature, metric])).values()];
  const key = local ? 'localSales30d' : 'sales30d';
  const rawRecentValues = [...new Set(products.map((product) => String(product?.[key + 'Raw'] ?? '').normalize('NFKC').trim()).filter(Boolean))];

  if (bySignature.size === 0 && rawRecentValues.length) {
    const compounds = rawRecentValues.map(compoundRecentMetric);
    if (compounds.every(Boolean)) {
      const min = compounds.reduce((sum, metric) => sum + metric.min, 0);
      const max = compounds.some((metric) => metric.max === Infinity)
        ? Infinity
        : compounds.reduce((sum, metric) => sum + metric.max, 0);
      const componentCount = compounds.reduce((sum, metric) => sum + metric.componentCount, 0);
      const metric = { raw: rawRecentValues.join(' / '), min, max, signature: `AGG:${min}:${max}`, aggregate: true, componentCount };
      const range = max === Infinity ? `${min}+` : min === max ? String(min) : `${min}~${max}`;
      return {
        state: 'aggregate', metric, metrics: compounds,
        raw: `옵션값 ${metric.raw} · 합계범위 ${range}`,
        diagnostic: `최근30일 옵션값 ${componentCount}개 판독 · 실제 누락 아님`,
      };
    }
  }

  if (bySignature.size === 0) {
    const diagnostic = rawRecentValues.length
      ? `최근30일 원본값 ${rawRecentValues.join(' / ')} · 값은 존재하지만 단일 상품값으로 확정 불가`
      : totalValues.length
        ? `최근30일 값 없음 · 총판매 ${totalValues.map((metric) => metric.raw).join(' / ')}`
        : '최근30일 값 없음';
    const state = rawRecentValues.length ? 'present-unparsed' : 'missing';
    return { state, metric: null, metrics: [], raw: rawRecentValues.length ? `원본값 존재 · ${rawRecentValues.join(' / ')}` : `값 없음 · ${diagnostic}`, diagnostic };
  }
  if (bySignature.size > 1) {
    const metrics = [...bySignature.values()];
    const diagnostic = `최근30일 복수값 ${metrics.map((metric) => metric.raw).join(' / ')}`;
    return { state: 'conflict', metric: null, metrics, raw: metrics.map((metric) => metric.raw).join(' / '), diagnostic };
  }
  const metric = [...bySignature.values()][0];
  return { state: 'resolved', metric, metrics: [metric], raw: metric.raw, diagnostic: '' };
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
      candidates = articleCandidates.filter((p) => !spu(product) || !spu(p) || spu(p) === spu(product));
      if (new Set(candidates.map(spu).filter(Boolean)).size > 1) candidates = [];
      if (articleCandidates.length && !candidates.length) matchBy = '식별자 충돌';
    }

    const source = [recentMetric(product), recentMetric(product, true)];
    const excelChina = resolveExcelRecentMetric(candidates, false);
    const excelLocal = resolveExcelRecentMetric(candidates, true);
    const excelResolved = [excelChina, excelLocal];
    const sourceAvailable = source.every(Boolean);
    const excelAvailable = excelResolved.every((entry) => ['resolved', 'aggregate'].includes(entry.state) && entry.metric);
    const hasConflict = excelResolved.some((entry) => entry.state === 'conflict');
    const hasPresentUnparsed = excelResolved.some((entry) => entry.state === 'present-unparsed');
    const aggregateOnly = excelResolved.some((entry) => entry.state === 'aggregate');
    const allAvailable = sourceAvailable && excelAvailable;
    const equal = candidates.length > 0 && allAvailable
      && excelResolved.every((entry, index) => metricCompatible(entry, source[index]));
    const missingSides = excelResolved.filter((entry) => entry.state === 'missing').length;
    let status = !identity(product) ? '식별자 없음 · 자동수정 보류'
      : !candidates.length ? matchBy === '식별자 충돌' ? '식별자 충돌 · 자동수정 보류' : 'Excel 상품 없음 · 자동수정 보류'
      : !sourceAvailable ? 'POIZON 화면값 미확인 · 자동수정 보류'
      : hasConflict ? 'Excel 값 충돌 · 자동수정 보류'
      : hasPresentUnparsed ? '상품 인식 완료 · Excel 원본값 존재 · 실제 누락 아님 · 파싱 확인 필요'
      : equal ? '상품 인식 완료 · 판매량 일치 · 수정 없음'
      : missingSides ? `상품 인식 완료 · 실제 판매량 누락 ${missingSides}개 · POIZON 값으로 수정 대상`
      : '상품 인식 완료 · 판매량 값 다름 · POIZON 값으로 수정 대상';
    if (candidates.length && sourceAvailable && aggregateOnly) {
      status = equal
        ? '상품 인식 완료 · 옵션 합계 기준 판매량 일치 · 실제 누락 아님'
        : '상품 인식 완료 · 옵션 합계 판독 · 실제 누락 아님 · 상품단위 값 재확인';
    }

    return {
      key: identity(product) || `UNREADABLE:${pageNum}:${position}`,
      articleNumber: String(product.articleNumber || product.productCode || ''), spuId: spu(product),
      title: String(product.name || product.title || ''), pageNum, matchBy, status,
      qualified: meetsVerificationConditions(product, frozenConditions),
      sourceChina: source[0]?.raw ?? 'POIZON 읽기 실패', sourceLocal: source[1]?.raw ?? 'POIZON 읽기 실패',
      excelChina: candidates.length ? excelChina.raw : '상품 없음',
      excelLocal: candidates.length ? excelLocal.raw : '상품 없음',
      excelChinaState: excelChina.state,
      excelLocalState: excelLocal.state,
      excelChinaDiagnostic: excelChina.diagnostic || '',
      excelLocalDiagnostic: excelLocal.diagnostic || '',
      excelRows: candidates.flatMap((p) => p.sourceRowNumbers || [p.sourceRowNumber]).filter((n) => Number.isInteger(Number(n)) && Number(n) > 0).map(Number),
      matched: candidates.length > 0, equal,
      autoCorrectionBlocked: aggregateOnly || hasPresentUnparsed,
      compoundRecent30: aggregateOnly,
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
    row.style.outline = match?.qualified ? '2px solid #78aaca' : '';
    row.style.outlineOffset = '-2px';
    row.dataset.aroundGVerification = match ? match.qualified ? 'qualified' : 'outside-condition' : 'pending';
  }
}
