import { indexProductIdentities, resolveProductIdentity, normalizedArticle, productSpu } from './poizon-product-identity.mjs';

// POIZON_METRIC_EVIDENCE_V2: absence, unreadable evidence and metric scope are distinct.
// Never infer a parent recent30 value by summing option rows or overlapping ranges.
export function normalizeVerificationConditions(input = {}) {
  const boundary = (value) => {
    if (value === '' || value == null) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
      throw new Error('판매량 조건은 0 이상의 정수여야 합니다.');
    }
    return number;
  };
  return Object.freeze({ period: 'recent30', matchMode: 'all',
    minimumChinaSales30: boundary(input.minimumChinaSales30),
    minimumLocalSales30: boundary(input.minimumLocalSales30) });
}

export function verificationConditionLabel(input = {}) {
  const c = normalizeVerificationConditions(input);
  const label = (value) => value === null ? '조건 없음' : `${value.toLocaleString('ko-KR')} 이상`;
  return `최근 30일 · 중국 ${label(c.minimumChinaSales30)} · 현지 판매자 ${label(c.minimumLocalSales30)} · AND`;
}

const cleanMetric = (value) => String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
function metricFromRaw(rawValue) {
  const raw = cleanMetric(rawValue);
  const match = raw.replace(/,/g, '').match(/^(<=|>=|<|≤|>|≥)?\s*(\d+(?:\.\d+)?)\s*(\+)?$/);
  if (!match || (match[1] && match[3])) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return null;
  const op = match[1] || (match[3] ? '>=' : '=');
  const min = op === '<' || op === '<=' || op === '≤' ? 0 : op === '>' ? value + 1 : value;
  const max = op === '<' ? Math.max(-1, value - 1) : op === '<=' || op === '≤' ? value
    : op === '>' || op === '>=' || op === '≥' ? Infinity : value;
  return { raw, min, max, signature: `${min}:${max}` };
}

export function recentMetric(product = {}, local = false) {
  if (product.salesScope === 'sku' || product.metricScope === 'sku') return null;
  const key = local ? 'localSales30d' : 'sales30d';
  const flag = local ? 'hasLocalSalesData' : 'hasSalesData';
  const explicitRaw = product[key + 'Raw'];
  if (product[flag] === false && cleanMetric(explicitRaw) === '') return null;
  return metricFromRaw(cleanMetric(explicitRaw) === '' ? product[key] : explicitRaw);
}

export function meetsVerificationConditions(product, conditions) {
  const c = normalizeVerificationConditions(conditions);
  const tests = [[c.minimumChinaSales30, recentMetric(product)], [c.minimumLocalSales30, recentMetric(product, true)]];
  return tests.every(([minimum, metric]) => minimum === null || (metric && metric.min >= minimum));
}

function excelMetricEvidence(product, local) {
  const side = local ? 'local' : 'china';
  const key = local ? 'localSales30d' : 'sales30d';
  const flag = local ? 'hasLocalSalesData' : 'hasSalesData';
  const cell = product.reviewMetricEvidence?.[side];
  const hasRaw = Object.prototype.hasOwnProperty.call(product, key + 'Raw');
  const raw = cell ? cleanMetric(cell.raw) : cleanMetric(product[key + 'Raw'])
    || (product[flag] === false ? '' : cleanMetric(product[key]));
  return {
    row: Number(product.sourceRowNumber) || 0,
    column: cell?.columnName || product.reviewColumnNames?.[side] || '',
    columnIndex: cell?.columnIndex ?? null,
    columnFound: cell ? cell.columnFound === true : hasRaw || product[flag] === true || product[key] != null,
    scope: cell?.scope || (product.salesScope === 'sku' || product.metricScope === 'sku' ? 'sku' : 'spu'),
    field: key + 'Raw', raw,
  };
}

export function resolveExcelRecentMetric(products = [], local = false) {
  const evidence = products.map((p) => excelMetricEvidence(p, local));
  const result = (state, reasonCode, raw, diagnostic, metric = null, metrics = []) =>
    ({ state, reasonCode, raw, diagnostic, metric, metrics, evidence });
  const values = (items) => [...new Set(items.map((item) => item.raw).filter(Boolean))].join(' / ');
  const parent = evidence.filter((item) => item.columnFound && item.scope === 'spu');
  const options = evidence.filter((item) => item.columnFound && item.scope === 'sku');
  if (!parent.length) {
    if (options.length) {
      const nonemptyOptions = options.filter((item) => item.raw !== '');
      const parsedOptions = nonemptyOptions.map((item) => metricFromRaw(item.raw));
      const optionMetrics = parsedOptions.every(Boolean)
        ? [...new Map(parsedOptions.map((metric) => [metric.signature, metric])).values()]
        : [];
      // Some POIZON exports repeat one SPU-level recent-30 value on every SKU
      // row. Accept only a complete, identical repetition; never sum options.
      const distinctSkuRows = new Set(products.map((product) => String(product.skuId || product.globalSkuId || '')).filter(Boolean));
      if (options.length >= 2 && distinctSkuRows.size >= 2
          && nonemptyOptions.length === options.length && optionMetrics.length === 1) {
        return result('resolved', '', optionMetrics[0].raw,
          '동일 SPU의 모든 옵션 행에 같은 상품 판매량이 반복되어 SPU 값으로 확인했습니다.', optionMetrics[0], optionMetrics);
      }
      return result('scope-mismatch', 'EXCEL_SKU_SPU_SCOPE_MISMATCH',
        `옵션 원본값 ${values(options) || '(공백)'}`, '옵션 행 값이 서로 다르거나 비어 있어 SPU 상품값으로 확정하지 않습니다. 합산하지 않고 현재 페이지에서 중단합니다.');
    }
    return result('unavailable', 'EXCEL_RECENT30_COLUMN_UNRESOLVED', '비교 열 미확정',
      '상품 최근 30일 판매량 열을 확인하지 못했습니다. 셀 공백으로 판정하지 않습니다.');
  }
  const nonempty = parent.filter((item) => item.raw !== '');
  const parsed = nonempty.map((item) => metricFromRaw(item.raw));
  // A value excluded by a scope/parse guard is NOT an empty cell.
  if (parsed.some((metric) => !metric)) {
    const placeholdersOnly = nonempty.every((item) => /^(?:--?|—|N\/A|null)$/i.test(item.raw));
    return result(placeholdersOnly ? 'unavailable' : 'present-unparsed',
      placeholdersOnly ? 'EXCEL_VALUE_NOT_DISCLOSED' : 'EXCEL_RECENT30_PARSE_FAILED',
      `원본값 존재 · ${values(nonempty)}`, '원본 표기는 있으나 단일 상품 판매량을 확정하지 못했습니다.');
  }
  const metrics = [...new Map(parsed.map((metric) => [metric.signature, metric])).values()];
  if (metrics.length > 1) return result('conflict', 'EXCEL_RECENT30_VALUES_CONFLICT', values(nonempty),
    '동일 SPU의 상품 단위 원본값이 서로 다릅니다. 원본 행·열을 재확인해야 합니다.', null, metrics);
  if (metrics.length === 1 && nonempty.length !== parent.length) return result('partial', 'EXCEL_RECENT30_PARTIAL_BLANK',
    `${metrics[0].raw} · 일부 원본 셀 공백`, '일부 값만 읽힌 상태를 전체 일치 또는 전체 누락으로 처리하지 않습니다.', null, metrics);
  if (!metrics.length) return result('missing', 'EXCEL_RECENT30_CELL_EMPTY', '값 없음 · 확인된 상품 판매량 셀 공백',
    '비교 대상 상품 단위 열을 찾았으며 해당 원본 셀이 비어 있습니다.');
  return result('resolved', '', metrics[0].raw, '', metrics[0], metrics);
}

const article = (p) => normalizedArticle(p?.articleNumber || p?.productCode || '');
const spu = (p) => productSpu(p || {});
const identity = (p) => spu(p) ? `SPU:${spu(p)}` : article(p) ? `ARTICLE:${article(p)}` : '';
const onlySkuScopeMismatch = (row = {}) => row.matched === true
  && row.identityConflict !== true
  && Boolean(metricFromRaw(row.sourceChina))
  && Boolean(metricFromRaw(row.sourceLocal))
  && row.autoCorrectionBlocked === true
  && Array.isArray(row.reasonCodes)
  && row.reasonCodes.length > 0
  && row.reasonCodes.every((code) => code === 'EXCEL_SKU_SPU_SCOPE_MISMATCH');

// Match evidence by identity, never by array position. Fail before any write if
// a page contains genuinely unresolved data. A SKU-vs-SPU scope mismatch must
// stop pagination; preserving bytes alone is not a completed page verification.
export function assertPoizonPageReadyForCorrection(products = [], rows = [], pageNum = 0) {
  if (!Array.isArray(products) || !Array.isArray(rows)) throw new Error('페이지 상품 목록과 대조 증거가 올바르지 않습니다.');
  const productKeys = products.map(identity);
  if (productKeys.some((key) => !key) || new Set(productKeys).size !== productKeys.length) {
    throw new Error('페이지 상품 식별자가 없거나 중복되어 Excel 수정을 중단했습니다.');
  }
  const byKey = new Map();
  for (const row of rows) {
    const key = identity(row);
    if (!key || byKey.has(key)) throw new Error('페이지 대조 식별자가 없거나 중복되어 Excel 수정을 중단했습니다.');
    byKey.set(key, row);
  }
  if (!products.length || products.length !== rows.length) throw new Error('페이지 상품 수와 대조 증거 수가 달라 Excel 수정을 중단했습니다.');
  const writable = [];
  let skippedSkuScope = 0;
  for (const product of products) {
    const row = byKey.get(identity(product));
    if (onlySkuScopeMismatch(row)) skippedSkuScope++;
    if (!row || row.autoCorrectionBlocked || /충돌|미확인|비교 보류|확인 필요/.test(row.status || '')) {
      throw new Error(`POIZON ${pageNum || '?'}페이지 · ${identity(product) || '식별자 없음'} · ${row?.status || '대조 증거 없음'} · 원본 수정 및 다음 페이지 이동을 보류합니다.`);
    }
    writable.push(product);
  }
  Object.defineProperty(writable, 'pageEvidence', {
    value: Object.freeze({ verified: true, sourceProducts: products.length, skippedSkuScope }),
    enumerable: false,
  });
  return writable;
}

// POIZON_SKU_SAFE_DEFER_V1: one policy for direct checkpoints and both UI entry points.
// Do not duplicate the evidence rules in an install-time patch. Validation happens
// before any writer is called; a deferred SKU page performs no filesystem writes.
export function selectPoizonPageCorrectionProducts(products = [], rows = [], pageNum = 0) {
  const writable = assertPoizonPageReadyForCorrection(products, rows, pageNum);
  const deferredRows = rows.filter(onlySkuScopeMismatch);
  return { products: writable, deferredRows, deferredProducts: deferredRows.length };
}

export function createPageCrossCheck({ runId, excelProducts = [], conditions = {}, brandName = '', fileName = '' } = {}) {
  if (!runId || !Array.isArray(excelProducts)) throw new Error('검증 실행번호와 Excel 상품 목록이 필요합니다.');
  const frozenConditions = normalizeVerificationConditions(conditions);
  const productIndex = indexProductIdentities(excelProducts), compared = new Map();
  let pageNum = 0, pageCount = 0;
  const compare = (product, position) => {
    const resolved = resolveProductIdentity(product, productIndex);
    const candidates = resolved.products;
    const matchBy = resolved.reason || resolved.matchBy;
    const source = [recentMetric(product), recentMetric(product, true)];
    const excelChina = resolveExcelRecentMetric(candidates, false);
    const excelLocal = resolveExcelRecentMetric(candidates, true);
    const excelResolved = [excelChina, excelLocal];
    const sourceAvailable = source.every(Boolean);
    const hasConflict = excelResolved.some((entry) => entry.state === 'conflict');
    const scopeMismatch = excelResolved.some((entry) => entry.state === 'scope-mismatch');
    const unresolved = excelResolved.some((entry) => !['resolved', 'missing'].includes(entry.state));
    const identityConflict = /충돌|식별자 없음/.test(matchBy || '');
    const equal = candidates.length > 0 && sourceAvailable
      && excelResolved.every((entry, i) => entry.state === 'resolved' && entry.metric.signature === source[i].signature);
    const missingSides = candidates.length ? excelResolved.filter((entry) => entry.state === 'missing').length : 0;
    const autoCorrectionBlocked = !identity(product) || identityConflict || !sourceAvailable || (candidates.length > 0 && unresolved);
    const status = !identity(product) ? '식별자 없음 · 자동수정 보류'
      : !candidates.length ? identityConflict ? '식별자 충돌 · 자동수정 보류' : 'Excel 상품 없음 · 누락 후보'
      : !sourceAvailable ? 'POIZON 화면값 미확인 · 자동수정 보류'
      : hasConflict ? 'Excel 값 충돌 · 자동수정 보류'
      : scopeMismatch ? '상품 인식 완료 · 옵션별 판매량 존재 · SPU 자동수정 제외 · 다음 페이지 진행 전 원본 보존 재검증'
      : unresolved ? '상품 인식 완료 · 원본값·비교 열 확인 필요 · 자동수정 보류'
      : equal ? '상품 인식 완료 · 판매량 일치 · 수정 없음'
      : missingSides ? `상품 인식 완료 · 판매량 누락 ${missingSides}개 · POIZON 값으로 수정 대상`
      : '상품 인식 완료 · 판매량 값 다름 · POIZON 값으로 수정 대상';
    return {
      key: identity(product) || `UNREADABLE:${pageNum}:${position}`,
      articleNumber: String(product.articleNumber || product.productCode || ''), spuId: spu(product),
      title: String(product.name || product.title || ''), pageNum, matchBy, status,
      qualified: meetsVerificationConditions(product, frozenConditions),
      sourceChina: source[0]?.raw ?? 'POIZON 읽기 실패', sourceLocal: source[1]?.raw ?? 'POIZON 읽기 실패',
      excelChina: candidates.length ? excelChina.raw : '상품 없음', excelLocal: candidates.length ? excelLocal.raw : '상품 없음',
      excelChinaState: excelChina.state, excelLocalState: excelLocal.state,
      excelChinaDiagnostic: excelChina.diagnostic, excelLocalDiagnostic: excelLocal.diagnostic,
      excelChinaEvidence: excelChina.evidence, excelLocalEvidence: excelLocal.evidence,
      reasonCodes: [...new Set(excelResolved.map((entry) => entry.reasonCode).filter(Boolean))],
      missingSalesCells: missingSides, identityConflict, autoCorrectionBlocked,
      excelRows: candidates.flatMap((p) => p.sourceRowNumbers || [p.sourceRowNumber]).filter((n) => Number.isInteger(Number(n)) && Number(n) > 0).map(Number),
      matched: candidates.length > 0, equal,
    };
  };
  const counts = () => {
    const rows = [...compared.values()];
    return { checkedProducts: rows.length, matchedProducts: rows.filter((r) => r.matched).length,
      equalProducts: rows.filter((r) => r.equal).length,
      differentProducts: rows.filter((r) => r.matched && !r.equal && !r.autoCorrectionBlocked).length,
      missingProducts: rows.filter((r) => !r.matched && !r.identityConflict).length,
      unconfirmedProducts: rows.filter((r) => r.autoCorrectionBlocked).length,
      deferredProducts: rows.filter(onlySkuScopeMismatch).length,
      missingSalesCells: rows.reduce((n, r) => n + r.missingSalesCells, 0),
      qualifiedProducts: rows.filter((r) => r.qualified).length };
  };
  return {
    conditions: frozenConditions,
    acceptPage(products, metadata = {}) {
      if (!Array.isArray(products)) throw new Error('검증할 페이지 상품 목록이 올바르지 않습니다.');
      pageNum = Number(metadata.pageNum || 0); pageCount = Number(metadata.pageCount || 0);
      for (const [key, row] of compared) if (row.pageNum === pageNum) compared.delete(key);
      const rows = products.map(compare);
      for (const row of rows) compared.set(row.key, row);
      return { runId, brandName, fileName, conditions: frozenConditions, phase: 'page-compared',
        pageNum, pageCount, updatedAt: new Date().toISOString(), ...counts(), rows,
        pageQualifiedProducts: rows.filter((row) => row.qualified).length };
    },
    snapshot() { return { runId, brandName, fileName, conditions: frozenConditions, pageNum, pageCount, ...counts(), rows: [...compared.values()] }; },
  };
}

export function paintSellerVerification(document, payload) {
  // Only annotate uniquely identified rows; never hide/remove source products.
  // Self-contained because this function is serialized into Seller Center.
  const normalize = (value) => String(value || '').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
  const evidence = Array.isArray(payload.rows) ? payload.rows : [];
  for (const element of document.querySelectorAll('table tbody tr')) {
    if (element.dataset.aroundGVerification === 'qualified') delete element.dataset.aroundGVerification;
    const text = String(element.innerText || '');
    const spuId = text.match(/SPU\s*[_\s]*ID\s*[:：]\s*([\d]+)/i)?.[1];
    const code = text.match(/(?:상품\s*번호|货号)\s*[:：]\s*([^\s]+)/)?.[1];
    const matches = spuId ? evidence.filter((row) => String(row.spuId) === spuId)
      : code ? evidence.filter((row) => normalize(row.articleNumber) === normalize(code)) : [];
    if (matches.length === 1 && matches[0].qualified === true) element.dataset.aroundGVerification = 'qualified';
  }
  const id = 'around-g-live-verification';
  let banner = document.getElementById(id);
  if (!banner) {
    banner = document.createElement('div'); banner.id = id;
    banner.style.cssText = 'position:sticky;top:0;z-index:2147483000;background:#eaf6ff;color:#122b45;padding:10px 12px;font:600 13px/1.6 sans-serif;border-bottom:2px solid #357ed5;white-space:normal;';
    document.body.prepend(banner);
  }
  banner.textContent = payload.label + ' · ' + (payload.pageNum ? `${payload.pageNum}/${payload.pageCount}페이지 대조 완료 · 조건 충족 ${payload.pageQualifiedProducts}개` : '화면 대조 준비');
  return true;
}
