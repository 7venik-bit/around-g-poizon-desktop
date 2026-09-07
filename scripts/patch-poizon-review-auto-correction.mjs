import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = async (p) => (await readFile(new URL(p, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (p, v) => { if (v !== await read(p)) await writeFile(new URL(p, root), v, 'utf8'); };
function replaceOnce(s, a, b, label) {
  if (s.includes(b)) return s;
  if (!s.includes(a)) throw new Error('Auto-correction patch target missing: ' + label);
  return s.replace(a, b);
}
function replaceSection(s, startText, endText, replacement, label) {
  const start = s.indexOf(startText), end = s.indexOf(endText, start + startText.length);
  if (start < 0 || end < 0) throw new Error('Auto-correction section missing: ' + label);
  return s.slice(0, start) + replacement + s.slice(end);
}

let session = await read('services/poizon-review-session.mjs');
session = session.replace("const lines = ['POIZON ↔ Excel 전체 대조 결과', '원본 Excel 자동 수정 없음',", "const lines = ['POIZON ↔ Excel 전체 대조 결과', 'POIZON 화면값 기준 Excel 자동 교정 · 저장 후 재검증',");
const runStart = 'export async function runPoizonReviewBatch({ files, conditions = {}, api, createView, onProgress = () => {}, notify = () => {} }) {';
if (!session.includes('POIZON_AUTO_CORRECTION_APPLIED')) {
  session = replaceSection(session, runStart, '\n}', `${runStart}
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
      const unchanged = await api.checkPoizonReviewWorkbook({ path: snapshot.file.path, revision: snapshot.revision });
      if (!unchanged?.ok || !unchanged.unchanged) throw new Error('검증 중 Excel 원본이 변경되었습니다. 다시 불러온 후 대조해 주세요.');

      // POIZON 화면이 최종 기준값이다. 전체 페이지 검증이 끝난 뒤 한 번만 원본 Excel을 교정한다.
      view.saving?.();
      const saved = await api.syncExcelWithSellerScreen({ path: snapshot.file.path, products: captured.products || [] });
      if (!saved?.ok) throw new Error(saved?.message || 'POIZON 값으로 Excel 수정에 실패했습니다.');
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
      reports.push(report);
      view.finish({ ok: true, corrected: true, changedRows: report.changedRows, changedCells: report.changedCells,
        addedRows: report.addedRows, addedProducts: report.addedProducts, verifiedCells: report.verifiedCells, report, afterProducts: after.products });
    } catch (error) {
      const report = { file: snapshot.file.name || snapshot.file.path, complete: false, message: error.message, changes: [] };
      reports.push(report); view?.finish({ ok: false, message: error.message });
    }
  }
  const report = { complete: reports.every((r) => r.complete), files: reports, verifiedAt: new Date().toISOString(),
    autoCorrection: reports.every((r) => r.autoCorrection === 'POIZON_AUTO_CORRECTION_APPLIED') };
  await notify(report, lastView);
  return report;\n`, 'runPoizonReviewBatch');
}
await save('services/poizon-review-session.mjs', session);

let view = await read('src/poizon-review-workspace.js');
view = view.replace('<h3>전체 대조 결과 · 수동 수정</h3><p>Excel 원본은 변경하지 않았습니다.</p>', '<h3>전체 대조 결과 · 자동 교정</h3><p>POIZON 화면값을 기준으로 Excel을 수정하고 저장 후 재검증합니다.</p>');
view = view.replace('<small>원본 Excel 자동 수정 없음</small>', '<small>POIZON 기준 자동 교정</small>');
view = view.replace("saving() { get('.review-phase').textContent = '전체 대조 결과 정리 중 · 원본 Excel 자동 수정 없음'; },", "saving() { get('.review-phase').textContent = '전체 대조 완료 · POIZON 값으로 Excel 수정 및 저장 후 재검증 중'; },");
const oldFinish = "      finished = true; cumulative = [...pageEvents].sort((a, b) => a[0] - b[0]).flatMap(([, e]) => e.rows);\n      pageOffset = 0;\n      get('.review-phase').textContent = result.ok ? '대조 완료 · 원본 Excel 자동 수정 없음' : `검증 미완료 · ${result.message || '전체 페이지 확인 실패'}`;";
const newFinish = "      finished = true; cumulative = [...pageEvents].sort((a, b) => a[0] - b[0]).flatMap(([, e]) => e.rows)\n        .map((row) => result.corrected && reviewTone(row) === 'different' ? { ...row, equal: true, status: 'POIZON 값으로 수정 완료 · 저장 후 재검증 완료' } : row);\n      pageOffset = 0;\n      get('.review-phase').textContent = result.ok ? `대조 완료 · Excel ${Number(result.changedRows || 0).toLocaleString('ko-KR')}행 수정 · 신규 ${Number(result.addedRows || 0).toLocaleString('ko-KR')}행 추가 · 재검증 완료` : `검증 미완료 · ${result.message || '전체 페이지 확인 실패'}`;";
view = replaceOnce(view, oldFinish, newFinish, 'review finish status');
await save('src/poizon-review-workspace.js', view);

let tests = await read('tests/poizon-review-workspace.test.mjs');
tests = tests.replace("assert.match(reviewReportText({ complete:true, files:[report] }), /원본 Excel 자동 수정 없음/);", "assert.match(reviewReportText({ complete:true, files:[report] }), /POIZON 화면값 기준 Excel 자동 교정/);");
const testStart = "test('batch reads every workbook first, never writes, and emits exactly one alert after all brands'";
const testEnd = "test('incomplete capture never becomes an all-match or absence report'";
if (tests.includes(testStart)) {
  const start = tests.indexOf(testStart), end = tests.indexOf(testEnd, start);
  if (end < 0) throw new Error('batch auto-correction test end missing');
  const replacement = `test('batch reads every workbook first, then corrects Excel from POIZON and rereads before one final notification', async (t) => {
  const f = await fixture(t); let current, notifications = 0, writes = 0; const order = [];
  const files = [{ ...f, name:'A.xlsx' }, { ...f, name:'B.xlsx' }];
  const api = {
    readPoizonReviewWorkbook: async (file) => { order.push('read'); return readReviewWorkbook(file, build); },
    checkPoizonReviewWorkbook: checkReviewWorkbookRevision,
    beginSellerExcelVerification: async () => ({ ok:true }),
    captureSellerBrandSales: async (input) => { order.push('capture'); assert.equal(input.verification.screenOnly, true); current.eventsList.push(compared(current.snapshot.products, [source()])); return { ok:true, products:[source()], sourceTotal:1 }; },
    syncExcelWithSellerScreen: async ({ products }) => { writes++; order.push('write'); return { ok:true, changedRows:1, changedCells:1, addedRows:0, verifiedCells:2, reverified:true, backupPath:'backup.xlsx', products }; },
  };
  const report = await runPoizonReviewBatch({ files, api,
    createView: async (snapshot) => { current = { snapshot, input:{ screenOnly:true }, eventsList:[], events(){ return this.eventsList; }, saving(){ order.push('saving'); }, finish(){} }; return current; },
    notify: (r) => { notifications++; assert.equal(order.filter((s) => s === 'capture').length, 2); assert.equal(r.files.length, 2); } });
  assert.equal(report.complete, true); assert.equal(report.autoCorrection, true);
  assert.equal(writes, 2); assert.equal(notifications, 1);
  assert.equal(report.files.every((r) => r.autoCorrection === 'POIZON_AUTO_CORRECTION_APPLIED'), true);
  assert.ok(order.indexOf('write') > order.indexOf('capture'));
});

test('newly appended POIZON product rows increase the expected reread count and must resolve by SPU', async () => {
  const base = { products:[{ spuId:'1', articleNumber:'OLD', sourceRowNumber:2 }], sourceTotalRows:1, revision:'r1', ok:true, file:{ path:'A.xlsx', name:'A.xlsx' } };
  const added = { spuId:'2', articleNumber:'NEW', sales30dRaw:'100+', localSales30dRaw:'30', hasSalesData:true, hasLocalSalesData:true };
  let current, readCount = 0, finishResult;
  const api = {
    readPoizonReviewWorkbook: async () => {
      readCount++;
      if (readCount === 1) return base;
      return { ...base, products:[...base.products, { ...added, sourceRowNumber:3 }], sourceTotalRows:2 };
    },
    checkPoizonReviewWorkbook: async () => ({ ok:true, unchanged:true }),
    beginSellerExcelVerification: async () => ({ ok:true }),
    captureSellerBrandSales: async () => { current.eventsList.push({ phase:'page-compared', pageNum:1, pageCount:1, rows:[{ key:'SPU:2', spuId:'2', articleNumber:'NEW', matched:false, equal:false, status:'Excel 상품 없음' }] }); return { ok:true, products:[added], sourceTotal:1, missingCount:0 }; },
    syncExcelWithSellerScreen: async () => ({ ok:true, changedRows:0, changedCells:0, addedRows:1, addedProducts:1, verifiedCells:2, reverified:true,
      changes:[{ reason:'MISSING_PRODUCT_ROW', spuId:'2', articleNumber:'NEW' }] }),
  };
  const report = await runPoizonReviewBatch({ files:[base.file], api,
    createView: async () => { current = { input:{screenOnly:true}, eventsList:[], events(){return this.eventsList;}, saving(){}, finish(result){ finishResult = result; } }; return current; },
    notify: async () => {} });
  assert.equal(report.complete, true);
  assert.equal(report.files[0].addedRows, 1);
  assert.equal(finishResult.ok, true);
});

`;
  tests = tests.slice(0, start) + replacement + tests.slice(end);
}
await save('tests/poizon-review-workspace.test.mjs', tests);

let categoryTests = await read('tests/favorite-category-search-v2.10.294.test.mjs');
categoryTests = categoryTests.replace(
  "  // Full snapshot -> live capture -> coverage -> unchanged workbook -> one report.\n  const read = session.indexOf('const snapshots = await loadReviewSnapshots');\n  const capture = session.indexOf('await api.captureSellerBrandSales', read);\n  const coverage = session.indexOf('reviewCoverage(view.events(), captured)', capture);\n  const revision = session.indexOf('await api.checkPoizonReviewWorkbook', coverage);\n  const report = session.indexOf('buildReviewReport(snapshot, coverage.rows)', revision);\n  const notify = session.indexOf('await notify(report, lastView)', report);\n  assert.ok(read >= 0 && capture > read && coverage > capture && revision > coverage && report > revision && notify > report);\n  assert.doesNotMatch(session, /syncExcelWithSellerScreen|\\.upsert\\(|writeFile\\(/);",
  "  // Explicit POIZON review only: full snapshot -> capture -> coverage -> unchanged check -> Excel correction -> reread -> report.\n  const read = session.indexOf('const snapshots = await loadReviewSnapshots');\n  const capture = session.indexOf('await api.captureSellerBrandSales', read);\n  const coverage = session.indexOf('reviewCoverage(view.events(), captured)', capture);\n  const revision = session.indexOf('await api.checkPoizonReviewWorkbook', coverage);\n  const correction = session.indexOf('await api.syncExcelWithSellerScreen', revision);\n  const reread = session.indexOf('await api.readPoizonReviewWorkbook', correction);\n  const report = session.indexOf('buildReviewReport(snapshot, coverage.rows)', reread);\n  const notify = session.indexOf('await notify(report, lastView)', report);\n  assert.ok(read >= 0 && capture > read && coverage > capture && revision > coverage && correction > revision && reread > correction && report > reread && notify > report);\n  assert.doesNotMatch(session, /\\.upsert\\(|writeFile\\(/);"
);
await save('tests/favorite-category-search-v2.10.294.test.mjs', categoryTests);

let smoke = await read('tests/fixtures/poizon-review-smoke.cjs');
smoke = smoke.replace("view.finish({ ok:true, manualReview:true });", "view.finish({ ok:true, corrected:true, changedRows:49, changedCells:98, addedRows:0, verifiedCells:100 });");
smoke = smoke.replace("value.includes('원본 Excel 자동 수정 없음')", "value.includes('POIZON 화면값 기준 Excel 자동 교정')");
await save('tests/fixtures/poizon-review-smoke.cjs', smoke);

console.log('Dedicated POIZON review accepts verified appended rows, validates reread row counts using addedRows, and confirms each new SPU after disk reread.');
