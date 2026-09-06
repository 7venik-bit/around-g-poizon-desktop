import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, content) => { if (content !== await read(path)) await writeFile(new URL(path, root), content, 'utf8'); };
function once(source, before, after, label) {
  if (source.includes(after)) return source;
  const at = source.indexOf(before);
  if (at < 0) throw new Error(`Manual review patch target missing: ${label}`);
  return source.slice(0, at) + after + source.slice(at + before.length);
}
function replaceSection(source, startText, endText, replacement, label) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  if (start < 0 || end < 0) throw new Error(`Manual review section missing: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

// 1) Central safety gate: calculate proposed changes, but never write the workbook.
let main = await read('main.mjs');
if (!main.includes('writeMode: "manual-review"')) {
  const handlerStart = main.indexOf('  ipcMain.handle("excel:sync-seller-screen"');
  const handlerEnd = main.indexOf('  ipcMain.handle(', handlerStart + 40);
  if (handlerStart < 0 || handlerEnd < 0) throw new Error('Manual review workbook handler not found');
  let handler = main.slice(handlerStart, handlerEnd);
  handler = once(handler,
    '      const { buffer, ...summary } = applied;\n      if (!applied.ok || !applied.changed) return { ...summary, path: filePath };',
    `      const { buffer, ...summary } = applied;
      if (!applied.ok) return { ...summary, path: filePath };
      // Manual-review policy: POIZON is authoritative evidence, but this app no longer
      // edits the operator workbook. Return a copyable change plan instead.
      return {
        ...summary,
        changed: false,
        changedRows: 0,
        changedCells: 0,
        proposedChangedRows: Number(summary.changedRows || 0),
        proposedChangedCells: Number(summary.changedCells || 0),
        manualChanges: Array.isArray(summary.changes) ? summary.changes : [],
        writeMode: "manual-review",
        path: filePath,
      };`,
    'dry-run workbook write gate');
  main = main.slice(0, handlerStart) + handler + main.slice(handlerEnd);
}
await save('main.mjs', main);

// 2) Combined verification: compare everything first, never call the write IPC,
// and return a structured manual-change report.
let service = await read('services/verified-combined-search.mjs');
if (!service.includes('export function manualReviewChanges')) {
  const helper = `
export function manualReviewChanges(screen, before, file = {}) {
  const index = indexProductIdentities(before);
  const changes = [];
  const display = (metrics) => {
    const values = [...new Set(metrics.filter(Boolean).map((metric) => metric.raw))];
    return values.length ? values.join(' / ') : '값 없음';
  };
  for (const { key, product } of sourceGroups(screen)) {
    const match = resolveProductIdentity(product, index);
    const rows = match.products.flatMap((p) => p.sourceRowNumbers || [p.sourceRowNumber])
      .filter((n) => Number.isInteger(Number(n)) && Number(n) > 0).map(Number);
    if (!match.products.length) {
      changes.push({ type: 'missing', status: match.reason || 'Excel에서 찾지 못함', key,
        brandName: file.brandName || product.brandName || '', fileName: file.name || file.path || '',
        spuId: productSpu(product), articleNumber: String(product.articleNumber || ''), excelRows: [] });
      continue;
    }
    for (const local of [false, true]) {
      const sourceMetric = recentMetric(product, local);
      if (!sourceMetric) continue;
      const excelMetrics = match.products.map((p) => recentMetric(p, local));
      const known = excelMetrics.filter(Boolean);
      const equal = known.length === excelMetrics.length && known.length > 0
        && known.every((metric) => metric.signature === sourceMetric.signature);
      if (equal) continue;
      changes.push({ type: 'value', status: known.length ? '값 다름' : 'Excel 동일 항목 값 없음', key,
        brandName: file.brandName || product.brandName || '', fileName: file.name || file.path || '',
        spuId: productSpu(product), articleNumber: String(product.articleNumber || ''), excelRows: [...new Set(rows)].sort((a, b) => a - b),
        field: local ? '현지 판매자 상품 최근 30일 판매량' : '중국 상품 최근 30일 판매량',
        excelValue: display(excelMetrics), poizonValue: sourceMetric.raw });
    }
  }
  return changes;
}

`;
  service = once(service, '// Dependencies are injected so the exact production sequence can be simulated.\n', helper + '// Dependencies are injected so the exact production sequence can be simulated.\n', 'manual change helper');
}
service = service.replace(
  '  const products = [], failures = [], audits = []; let loadedCount = 0;',
  '  const products = [], failures = [], audits = [], manualChanges = []; let loadedCount = 0;');
if (!service.includes("writeMode: 'manual-review'")) {
  const start = '      sourceGroups(captured.products); // Reject conflicting identities before any write.\n';
  const end = '      products.push(...grouped); loadedCount++;\n';
  const replacement = `      sourceGroups(captured.products); // Reject conflicting identities before any action.
      const reviewChanges = manualReviewChanges(captured.products, before, file);
      manualChanges.push(...reviewChanges);
      // Do not persist POIZON values. The operator requested copyable manual corrections.
      live.finish({ ok: true, changedRows: 0, screenProducts: captured.products, afterProducts: before, manualReview: true });
      const grouped = groupedVerifiedProducts(captured.products, before, before, frozen, file)
        .map((product) => ({ ...product, verificationStatus: '수동 수정 검토' }));
      products.push(...grouped); loadedCount++;
`;
  service = replaceSection(service, start, end, replacement, 'combined no-write sequence');
  service = service.replace('        excelRows: before.length, qualifiedProducts: grouped.length, changedRows: saved.changedRows || 0,',
    '        excelRows: before.length, qualifiedProducts: grouped.length, changedRows: 0, manualChangeCount: reviewChanges.length,');
  service = service.replace('  return { products, loadedCount, brandCount: files.length, files, conditions: frozen, failures, audits,\n    verified: true, complete: failures.length === 0 };',
    "  return { products, loadedCount, brandCount: files.length, files, conditions: frozen, failures, audits, manualChanges,\n    writeMode: 'manual-review', verified: true, complete: failures.length === 0 };" );
}
await save('services/verified-combined-search.mjs', service);

// 3) Copyable in-app notification dialog. It appears after a completed comparison,
// not on every Seller Center page.
let renderer = await read('src/renderer.js');
if (!renderer.includes('function showPoizonManualReviewDialog')) {
  const helper = `
function poizonManualReviewText(result = {}) {
  const changes = Array.isArray(result.manualChanges) ? result.manualChanges : [];
  const failures = Array.isArray(result.failures) ? result.failures : [];
  const lines = [
    'POIZON ↔ Excel 교차 검증 결과',
    'Excel 자동 수정: 사용 안 함 (수동 수정 모드)',
    '수정/확인 필요: ' + changes.length + '건 · 검증 실패: ' + failures.length + '건',
    '',
  ];
  changes.forEach((change, index) => {
    lines.push('[' + (index + 1) + '] ' + (change.brandName || '브랜드') + ' · ' + (change.articleNumber || '상품번호 없음') + ' · SPU ' + (change.spuId || '-'));
    if (change.excelRows?.length) lines.push('Excel 행: ' + change.excelRows.join(', '));
    if (change.type === 'value') {
      lines.push(change.field || '판매량');
      lines.push('Excel: ' + (change.excelValue ?? '값 없음') + ' → POIZON: ' + (change.poizonValue ?? '미확인'));
    } else {
      lines.push('확인 필요: ' + (change.status || 'Excel에서 찾지 못함'));
    }
    if (change.fileName) lines.push('파일: ' + change.fileName);
    lines.push('');
  });
  failures.forEach((failure) => lines.push('[검증 실패] ' + (failure.file || '') + ' · ' + (failure.message || '원인 미확인')));
  if (!changes.length && !failures.length) lines.push('POIZON과 Excel에서 수동 수정이 필요한 차이를 찾지 못했습니다.');
  return lines.join('\n');
}

function showPoizonManualReviewDialog(result = {}) {
  let dialog = document.getElementById('poizon-manual-review-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'poizon-manual-review-dialog';
    dialog.style.cssText = 'width:min(820px,92vw);max-height:86vh;border:0;border-radius:14px;padding:0;box-shadow:0 18px 60px #0005';
    const wrap = document.createElement('div'); wrap.style.cssText = 'padding:18px;background:#fff;color:#172033';
    const title = document.createElement('h3'); title.textContent = 'POIZON 교차 검증 · 수동 수정 목록'; title.style.margin = '0 0 8px';
    const summary = document.createElement('p'); summary.className = 'manual-review-summary';
    const area = document.createElement('textarea'); area.className = 'manual-review-text'; area.readOnly = true;
    area.style.cssText = 'width:100%;height:52vh;box-sizing:border-box;white-space:pre;font:13px/1.55 ui-monospace,Consolas,monospace;padding:12px';
    const actions = document.createElement('div'); actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '전체 복사'; copy.className = 'manual-review-copy';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '닫기';
    copy.onclick = async () => { const textValue = area.value; try { await navigator.clipboard.writeText(textValue); copy.textContent = '복사 완료'; } catch { area.focus(); area.select(); document.execCommand('copy'); copy.textContent = '복사 완료'; } setTimeout(() => { copy.textContent = '전체 복사'; }, 1500); };
    close.onclick = () => dialog.close(); actions.append(copy, close); wrap.append(title, summary, area, actions); dialog.append(wrap); document.body.append(dialog);
  }
  const changes = Array.isArray(result.manualChanges) ? result.manualChanges : [];
  const failures = Array.isArray(result.failures) ? result.failures : [];
  dialog.querySelector('.manual-review-summary').textContent = '수정/확인 필요 ' + changes.length + '건 · 실패 ' + failures.length + '건 · Excel은 자동으로 수정하지 않았습니다.';
  dialog.querySelector('.manual-review-text').value = poizonManualReviewText(result);
  if (!dialog.open) dialog.showModal();
}

`;
  renderer = once(renderer, 'async function openVerifiedCombinedBrandPreview(files, filters) {', helper + 'async function openVerifiedCombinedBrandPreview(files, filters) {', 'copyable review dialog');
}
if (!renderer.includes('showPoizonManualReviewDialog(result);')) {
  renderer = once(renderer,
    "    combinedBrandPreview = { ...result, filters: { minimumTotal: result.conditions.minimumChinaSales30 ?? '', minimumLocalTotal: result.conditions.minimumLocalSales30 ?? '' } };",
    "    combinedBrandPreview = { ...result, filters: { minimumTotal: result.conditions.minimumChinaSales30 ?? '', minimumLocalTotal: result.conditions.minimumLocalSales30 ?? '' } };\n    showPoizonManualReviewDialog(result);",
    'show combined review dialog');
}
// Existing non-combined verification paths still call the central sync IPC. It is
// now dry-run only, so show those proposed cell changes in the same copy dialog.
renderer = renderer.replaceAll(
  'if (!excelSync?.ok) throw new Error(excelSync?.message || "Excel 반영 실패");',
  'if (!excelSync?.ok) throw new Error(excelSync?.message || "Excel 검증 실패");\n          if (excelSync.writeMode === "manual-review") showPoizonManualReviewDialog({ manualChanges: excelSync.manualChanges || [], failures: [] });');
await save('src/renderer.js', renderer);

// 4) Update the old production tests so they enforce the new no-write policy.
let testSource = await read('tests/poizon-value-integrity.test.mjs');
if (!testSource.includes("actual main IPC returns a manual change plan and leaves the workbook byte-identical")) {
  const start = "test('actual main IPC creates backup and audit, validates bytes, then atomically replaces the workbook'";
  const end = "test('production combined workflow reads all rows before filtering, saves/rereads and groups sizes into one SPU'";
  const replacement = `test('actual main IPC returns a manual change plan and leaves the workbook byte-identical', async (t) => {
  const f = await fixture(t); const original = await readFile(f.path);
  const from = main.indexOf('  const screenSyncFilesInProgress =');
  const to = main.indexOf('  ipcMain.handle(', main.indexOf('  ipcMain.handle("excel:sync-seller-screen"', from) + 30);
  assert.ok(from > 0 && to > from); let handler;
  const sandbox = { ipcMain: { handle: (_name, fn) => { handler = fn; } }, resolve, readFile, writeFile, rename, unlink, stat, applyPoizonScreenSalesToWorkbook, readFirstDataSheet, excelPreviewCache: new Map() };
  runInContext(main.slice(from, to), createContext(sandbox));
  const result = await handler(null, { path: f.path, products: [screen()] });
  assert.equal(result.ok, true, result.message); assert.equal(result.writeMode, 'manual-review');
  assert.ok(result.proposedChangedRows > 0); assert.ok(result.manualChanges.length > 0);
  assert.deepEqual(await readFile(f.path), original);
  assert.equal((await readdir(f.folder)).some((p) => p.includes('.before-poizon-screen-sync-') || p.endsWith('.tmp')), false);
});

test('production combined workflow reads all rows, compares POIZON, never writes, and returns copyable changes', async (t) => {
  const f = await fixture(t, [row(), row('11', '112', '20'), row('12', '121', '999')]);
  const data = f.buffer; const order = []; let seen; let writes = 0;
  const api = {
    previewExcelFile: async (_path, offset, _limit, filter) => { assert.equal(filter.minimumLocalTotal, ''); order.push('read'); const p = await products(data); return { ok: true, products: p, offset, totalRows: p.length }; },
    captureSellerBrandSales: async (input) => { seen = input; order.push('capture'); return { ok: true, products: [screen('11', '83'), screen('12', '29')] }; },
    syncExcelWithSellerScreen: async () => { writes++; throw new Error('write must not be called'); },
  };
  let done;
  const result = await runVerifiedCombinedSearch({ files: [{ path: f.path, name: 'test.xlsx', brandName: 'TEST' }], conditions: { minimumLocalSales30: 30 }, api,
    openVerification: async (_f, before, c) => { assert.equal(before.length, 3); return { input: { runId: 'r', conditions: c, excelProducts: before }, finish: (x) => { done = x; }, running: false }; } });
  assert.deepEqual(order, ['read', 'capture']); assert.equal(writes, 0); assert.equal(seen.verification.conditions.minimumLocalSales30, 30);
  assert.equal(result.complete, true); assert.equal(result.writeMode, 'manual-review'); assert.equal(done.ok, true);
  assert.equal(result.products.length, 1); assert.ok(result.manualChanges.some((c) => c.poizonValue === '83'));
  assert.deepEqual(await readFile(f.path), f.buffer);
});

`;
  testSource = replaceSection(testSource, start, end, replacement, 'manual policy production tests');
}
await save('tests/poizon-value-integrity.test.mjs', testSource);
console.log('Manual POIZON review mode applied: no workbook writes, copyable change dialog enabled.');
