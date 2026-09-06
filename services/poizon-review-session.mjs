import { normalizeVerificationConditions, recentMetric } from './live-poizon-crosscheck.mjs';
import { indexProductIdentities, resolveProductIdentity } from './poizon-product-identity.mjs';

export function reviewTone(row = {}) {
  if (row.matched === false) return 'missing';
  if (row.equal === true) return 'equal';
  return /미확인|기준|없음/.test(row.status || '') ? 'unknown' : 'different';
}

export async function loadReviewSnapshots(files, api, onProgress = () => {}) {
  if (!Array.isArray(files) || !files.length) throw new Error('다운로드 완료 브랜드를 선택해 주세요.');
  const snapshots = [];
  for (const file of files) {
    onProgress(`Excel 전체 읽기 ${snapshots.length + 1}/${files.length} · ${file.brandName || file.name}`);
    const snapshot = await api.readPoizonReviewWorkbook({ path: file.path });
    if (!snapshot?.ok || !Array.isArray(snapshot.products)) throw new Error(snapshot?.message || 'Excel 전체 읽기 실패');
    if (snapshot.products.length !== snapshot.sourceTotalRows) throw new Error('Excel 원본 행 수가 일치하지 않아 검증을 시작하지 않았습니다.');
    const rows = snapshot.products.map((p) => Number(p.sourceRowNumber));
    if (rows.some((n, i) => n !== i + 2)) throw new Error('Excel 원본 행 번호가 누락되거나 중복되었습니다.');
    snapshots.push({ file, ...snapshot });
  }
  return snapshots;
}

export function reviewCoverage(events = [], captured = {}) {
  const pages = new Map();
  let pageCount = 0;
  for (const event of events) {
    if (event.phase !== 'page-compared') continue;
    const n = Number(event.pageNum), count = Number(event.pageCount);
    if (!Number.isInteger(n) || n < 1 || !Number.isInteger(count) || count < n || !Array.isArray(event.rows)) return { ok: false, message: '페이지 대조 증거가 올바르지 않습니다.' };
    pageCount = Math.max(pageCount, count); pages.set(n, event.rows);
  }
  if (captured.ok !== true) return { ok: false, message: captured.message || 'POIZON 전체 수집 미완료' };
  if (!pageCount || pages.size !== pageCount || Array.from({ length: pageCount }, (_, i) => i + 1).some((n) => !pages.has(n))) {
    return { ok: false, message: `전체 대조 미완료 · 확인 ${pages.size}/${pageCount || '?'}페이지` };
  }
  const rows = [...pages].sort((a, b) => a[0] - b[0]).flatMap(([, list]) => list);
  const keys = new Set(rows.map((r) => r.key));
  if (keys.size !== rows.length) return { ok: false, message: '서로 다른 페이지에서 동일 상품이 반복되어 전체 결과를 확정하지 않았습니다.' };
  const expected = Number(captured.sourceTotal || 0);
  if ((expected > 0 && rows.length !== expected) || Number(captured.missingCount || 0) > 0) {
    return { ok: false, message: `POIZON 원본 상품 수 불일치 · 대조 ${rows.length}/${expected || '?'}` };
  }
  return { ok: true, rows, pageCount };
}

// Reports compare like-for-like metrics only. Raw SKU totals remain visible,
// but are never suggested as replacement targets for a parent recent30 value.
export function buildReviewReport(snapshot, rows, { complete = true, message = '' } = {}) {
  const index = indexProductIdentities(snapshot.products);
  const foundRows = new Set(), changes = [];
  const summary = { checked: rows.length, equal: 0, different: 0, unknown: 0, missing: 0, absentRows: 0 };
  for (const row of rows) {
    summary[reviewTone(row)]++;
    const matched = resolveProductIdentity({ spuId: row.spuId, articleNumber: row.articleNumber }, index).products;
    matched.forEach((p) => foundRows.add(p.sourceRowNumber));
    const base = { fileName: snapshot.file.name || snapshot.file.path, brandName: snapshot.file.brandName || '',
      articleNumber: row.articleNumber, spuId: row.spuId, excelRows: matched.map((p) => p.sourceRowNumber), pageNum: row.pageNum };
    if (!matched.length) { changes.push({ ...base, type: 'missing', status: row.status || 'Excel에서 찾지 못함' }); continue; }
    for (const local of [false, true]) {
      const field = local ? '현지 판매자 상품 최근 30일 판매량' : '중국 상품 최근 30일 판매량';
      const source = local ? row.sourceLocal : row.sourceChina;
      const expected = recentMetric({ sales30dRaw: source });
      for (const p of matched) {
        const old = recentMetric(p, local);
        if (expected && old && expected.signature === old.signature) continue;
        const comparable = Boolean(expected && old && p.salesScope !== 'sku' && p.metricScope !== 'sku');
        const oldRaw = local ? p.localSales30dRaw : p.sales30dRaw;
        changes.push({ ...base, excelRows: [p.sourceRowNumber], field,
          type: comparable ? 'value' : 'unknown', status: comparable ? '값 다름' : '비교 기준 또는 최근 30일 값 확인 필요',
          excelValue: old?.raw ?? (oldRaw ? `원본 옵션 값 ${oldRaw} (상품 값과 비교하지 않음)` : '동일 항목 없음'),
          poizonValue: expected?.raw ?? '미확인',
          columnName: p.reviewColumnNames?.[local ? 'local' : 'china'] || '동일 기준 열 없음 · 기존 총판매량/사이즈 열은 수정하지 마세요',
        });
      }
    }
  }
  if (complete) {
    for (const p of snapshot.products) {
      if (foundRows.has(p.sourceRowNumber)) continue;
      summary.absentRows++;
      changes.push({ type: 'missing', fileName: snapshot.file.name || snapshot.file.path,
        brandName: snapshot.file.brandName || '', articleNumber: p.articleNumber, spuId: p.spuId,
        excelRows: [p.sourceRowNumber], status: p.identityReadable === false ? 'Excel 상품 식별자 확인 필요' : '전체 대조 후 POIZON에서 찾지 못함' });
    }
  }
  return { file: snapshot.file.name || snapshot.file.path, complete, message, summary, changes };
}

export function reviewReportText(report = {}) {
  const lines = ['POIZON ↔ Excel 전체 대조 결과', '원본 Excel 자동 수정 없음',
    report.complete ? '전체 대조 완료' : '검증 미완료 · 부분 결과를 전체 일치로 확정하지 않습니다.', ''];
  for (const file of report.files || []) {
    lines.push(`[${file.file}] ${file.complete ? '전체 완료' : '미완료'}${file.message ? ' · ' + file.message : ''}`);
    if (file.summary) lines.push(`대조 ${file.summary.checked} · 일치 ${file.summary.equal} · 값 다름 ${file.summary.different} · 기준/값 미확인 ${file.summary.unknown} · 연결 불가 ${file.summary.missing} · POIZON 미발견 원본행 ${file.summary.absentRows}`);
    for (const item of file.changes || []) {
      lines.push(`상품 ${item.articleNumber || '-'} · SPU ${item.spuId || '-'} · Excel 행 ${(item.excelRows || []).join(', ') || '없음'} · POIZON ${item.pageNum || '-'}페이지`);
      lines.push(`${item.status}${item.field ? ' · ' + item.field : ''}`);
      if (item.poizonValue != null) lines.push(`Excel ${item.excelValue} → POIZON ${item.poizonValue}`);
      if (item.columnName) lines.push(`원본 열: ${item.columnName}`);
    }
    if (file.complete && !file.changes?.length) lines.push('확인된 비교 항목 전체 일치');
    lines.push('');
  }
  return lines.join('\n');
}

export async function runPoizonReviewBatch({ files, conditions = {}, api, createView, onProgress = () => {}, notify = () => {} }) {
  const frozen = normalizeVerificationConditions(conditions), reports = [];
  // Read every selected workbook before opening the Seller Center collector.
  const snapshots = await loadReviewSnapshots(files, api, onProgress);
  let lastView;
  for (const snapshot of snapshots) {
    let view;
    try {
      view = await createView(snapshot, frozen); lastView = view;
      const layout = await api.beginSellerExcelVerification({ brandName: snapshot.file.brandName || '', fileName: snapshot.file.name || '' });
      if (!layout?.ok) throw new Error(layout?.message || '검증 화면을 열지 못했습니다.');
      const captured = await api.captureSellerBrandSales({ brandName: snapshot.file.brandName || '', verification: view.input });
      const coverage = reviewCoverage(view.events(), captured);
      if (!coverage.ok) throw new Error(coverage.message);
      const unchanged = await api.checkPoizonReviewWorkbook({ path: snapshot.file.path, revision: snapshot.revision });
      if (!unchanged?.ok || !unchanged.unchanged) throw new Error('검증 중 Excel 원본이 변경되었습니다. 다시 불러온 후 대조해 주세요.');
      const report = buildReviewReport(snapshot, coverage.rows); reports.push(report);
      view.finish({ ok: true, manualReview: true, report });
    } catch (error) {
      const report = { file: snapshot.file.name || snapshot.file.path, complete: false, message: error.message, changes: [] };
      reports.push(report); view?.finish({ ok: false, message: error.message });
    }
  }
  const report = { complete: reports.every((r) => r.complete), files: reports, verifiedAt: new Date().toISOString() };
  // One notification after the entire selected batch, never per page or row.
  await notify(report, lastView);
  return report;
}
