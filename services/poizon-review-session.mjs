import { assertPoizonPageReadyForCorrection, selectPoizonPageCorrectionProducts } from './live-poizon-crosscheck.mjs';
import { normalizeVerificationConditions, recentMetric } from './live-poizon-crosscheck.mjs';
import { indexProductIdentities, resolveProductIdentity } from './poizon-product-identity.mjs';

export function reviewTone(row = {}) {
  if (row.autoCorrectionBlocked === true) return 'unknown';
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
  const rawRows = [...pages].sort((a, b) => a[0] - b[0]).flatMap(([, list]) => list);
  if (rawRows.some((row) => !row?.key)) return { ok: false, message: '상품 식별자가 없는 대조 결과가 있어 전체 결과를 확정하지 않았습니다.' };
  // Seller Center pagination can repeat a product at a page boundary. Keep one
  // identity and let the later visible page provide the final POIZON value.
  const byKey = new Map();
  let duplicateRows = 0;
  for (const row of rawRows) {
    const previous = byKey.get(row.key);
    if (!previous) { byKey.set(row.key, row); continue; }
    duplicateRows += 1;
    const duplicatePages = [...new Set([...(previous.duplicatePages || [previous.pageNum]), row.pageNum].filter(Boolean))];
    byKey.set(row.key, { ...previous, ...row, duplicateRows: Number(previous.duplicateRows || 0) + 1, duplicatePages });
  }
  const rows = [...byKey.values()];
  const expected = Number(captured.sourceTotal || 0);
  const expectedUnique = Number(captured.uniqueSourceTotal || Math.max(0, expected - duplicateRows) || 0);
  if ((expectedUnique > 0 && rows.length !== expectedUnique) || Number(captured.missingCount || 0) > 0) {
    return { ok: false, message: `POIZON 고유 상품 수 불일치 · 대조 ${rows.length}/${expectedUnique || '?'}` };
  }
  return { ok: true, rows, pageCount, duplicateRows };
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
  const lines = ['POIZON ↔ Excel 전체 대조 결과', 'POIZON 화면값 기준 Excel 자동 교정 · 저장 후 재검증',
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
  // 모든 원본을 먼저 읽어 작업 중 파일 변경 여부를 감지할 수 있게 고정한다.
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
      // 페이지 체크포인트가 원본 파일을 직접 저장하므로 그 변경을 외부 변경으로
      // 오인하면 안 된다. 체크포인트를 사용하지 않은 구형 흐름에서만 최초
      // revision을 검사하고, 체크포인트 흐름은 저장 페이지 수와 재검증 결과로 판정한다.
      const pageSaved = captured.checkpointSync?.enabled ? captured.checkpointSync : null;
      if (pageSaved) {
        if (pageSaved.reverified !== true || Number(pageSaved.pagesCompleted || 0) !== Number(coverage.pageCount || 0)) {
          throw new Error(`Excel 페이지 저장 미완료 · 저장 ${Number(pageSaved.pagesCompleted || 0)}/${Number(coverage.pageCount || 0)}페이지`);
        }
      } else {
        const unchanged = await api.checkPoizonReviewWorkbook({ path: snapshot.file.path, revision: snapshot.revision });
        if (!unchanged?.ok || !unchanged.unchanged) throw new Error('검증 중 Excel 원본이 변경되었습니다. 다시 불러온 후 대조해 주세요.');
      }

      // POIZON 화면이 최종 기준값이다. 전체 페이지 검증이 끝난 뒤 한 번만 원본 Excel을 교정한다.
      view.saving?.();
      // POIZON_STRICT_FINAL_EVIDENCE_GUARD: identity-keyed evidence, independent of result ordering.
      // POIZON_SKU_SAFE_FINAL_SELECTION: preserve SKU rows; only verified same-scope rows reach the writer.
      const finalSelection = selectPoizonPageCorrectionProducts(captured.products || [], coverage.rows);
      const finalSaved = finalSelection.products.length
        ? await api.syncExcelWithSellerScreen({ path: snapshot.file.path, products: finalSelection.products })
        : { ok:true, changedRows:0, changedCells:0, addedRows:0, addedProducts:0, verifiedCells:0, reverified:true, changes:[], backupPath:'' };
      finalSaved.deferredProducts = Number(finalSelection.deferredProducts || 0);
      if (!finalSaved?.ok) throw new Error(finalSaved?.message || 'POIZON 값으로 Excel 수정에 실패했습니다.');
      // POIZON_PAGE_CHECKPOINT_AGGREGATED: 페이지별 확정 결과와 마지막 전체 무변경 재검증을 하나의 저장 결과로 합친다.
      const saved = pageSaved ? {
        ...finalSaved,
        changedRows: Number(pageSaved.changedRows || 0) + Number(finalSaved.changedRows || 0),
        changedCells: Number(pageSaved.changedCells || 0) + Number(finalSaved.changedCells || 0),
        addedRows: Number(pageSaved.addedRows || 0) + Number(finalSaved.addedRows || 0),
        addedProducts: Number(pageSaved.addedProducts || 0) + Number(finalSaved.addedProducts || 0),
        verifiedCells: Number(pageSaved.verifiedCells || 0) + Number(finalSaved.verifiedCells || 0),
        changes: [...(pageSaved.changes || []), ...(finalSaved.changes || [])],
        backupPath: pageSaved.backupPath || finalSaved.backupPath || '',
        reverified: pageSaved.reverified === true && finalSaved.reverified === true,
        checkpointPages: Number(pageSaved.pagesCompleted || 0),
      } : finalSaved;
      if (saved.reverified !== true) throw new Error('Excel 수정 후 POIZON 값 재검증 결과를 확인하지 못했습니다.');

      // 실제 저장된 파일을 다시 읽는다. 신규 상품 행을 추가한 경우에는 그 수만큼 행 증가가 정상이다.
      const after = await api.readPoizonReviewWorkbook({ path: snapshot.file.path });
      if (!after?.ok || !Array.isArray(after.products)) throw new Error(after?.message || '수정 후 Excel 재읽기에 실패했습니다.');
      const expectedAfterRows = snapshot.products.length + Number(saved.addedRows || 0);
      if (after.products.length !== expectedAfterRows) {
        throw new Error('수정 후 Excel 행 수 검증 실패 · 예상 ' + expectedAfterRows + '행 / 실제 ' + after.products.length + '행');
      }

      // 신규 행은 단순히 행 수만 늘었다고 완료하지 않는다. 저장 후 실제 SPU가 다시 읽혀야 한다.
      const afterIndex = indexProductIdentities(after.products);
      const addedChanges = (saved.changes || []).filter((change) => change.reason === 'MISSING_PRODUCT_ROW');
      const addedVerificationFailures = [];
      for (const change of addedChanges) {
        const spuId = String(change.spuId || '').trim();
        if (!spuId) { addedVerificationFailures.push({ spuId: '', reason: 'ADDED_SPU_MISSING' }); continue; }
        const resolved = resolveProductIdentity({ spuId, articleNumber: change.articleNumber || '' }, afterIndex).products;
        if (!resolved.length) addedVerificationFailures.push({ spuId, articleNumber: change.articleNumber || '', reason: 'ADDED_ROW_NOT_READ_BACK' });
      }
      if (addedVerificationFailures.length) {
        throw new Error('신규 상품 행 저장 후 SPU 재검증 실패 ' + addedVerificationFailures.length + '건 · ' + addedVerificationFailures.slice(0, 5).map((item) => item.spuId || item.reason).join(', '));
      }

      const report = buildReviewReport(snapshot, coverage.rows);
      report.autoCorrection = 'POIZON_AUTO_CORRECTION_APPLIED';
      report.changedRows = Number(saved.changedRows || 0);
      report.changedCells = Number(saved.changedCells || 0);
      report.addedRows = Number(saved.addedRows || 0);
      report.addedProducts = Number(saved.addedProducts || 0);
      report.verifiedCells = Number(saved.verifiedCells || 0);
      report.backupPath = saved.backupPath || '';
      report.deferredProducts = Number(saved.deferredProducts || captured.checkpointSync?.deferredProducts || 0);
      report.checkpointPages = Number(saved.checkpointPages || 0);
      reports.push(report);
      view.finish({ ok: true, corrected: true, rows: coverage.rows, duplicateRows: coverage.duplicateRows,
        changedRows: report.changedRows, changedCells: report.changedCells,
        addedRows: report.addedRows, addedProducts: report.addedProducts, verifiedCells: report.verifiedCells, report, afterProducts: after.products });
    } catch (error) {
      const report = { file: snapshot.file.name || snapshot.file.path, complete: false, message: error.message, changes: [] };
      reports.push(report); view?.finish({ ok: false, message: error.message });
    }
  }
  const report = { complete: reports.every((r) => r.complete), files: reports, verifiedAt: new Date().toISOString(),
    autoCorrection: reports.every((r) => r.autoCorrection === 'POIZON_AUTO_CORRECTION_APPLIED') };
  await notify(report, lastView);
  return report;

}
