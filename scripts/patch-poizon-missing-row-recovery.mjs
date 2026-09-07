import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, value) => {
  const current = await read(path);
  if (current !== value) await writeFile(new URL(path, root), value, 'utf8');
};
function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Missing-row recovery patch target missing: ${label}`);
  return source.replace(before, after);
}

let crosscheck = await read('services/live-poizon-crosscheck.mjs');
crosscheck = replaceOnce(
  crosscheck,
  ": !candidates.length ? matchBy === '식별자 충돌' ? '식별자 충돌 · 자동수정 보류' : 'Excel 상품 없음 · 자동수정 보류'\n      : !sourceAvailable ? 'POIZON 화면값 미확인 · 자동수정 보류'",
  ": !candidates.length ? matchBy === '식별자 충돌' ? '식별자 충돌 · 자동수정 보류'\n        : !spu(product) ? 'Excel 상품 없음 · SPU 미확인으로 자동추가 보류'\n        : !sourceAvailable ? 'Excel 상품 없음 · POIZON 화면값 미확인으로 자동추가 보류'\n        : 'Excel 상품 없음 · POIZON 값으로 새 행 추가 대상'\n      : !sourceAvailable ? 'POIZON 화면값 미확인 · 자동수정 보류'",
  'missing Excel product verdict',
);
await save('services/live-poizon-crosscheck.mjs', crosscheck);

let session = await read('services/poizon-review-session.mjs');
session = replaceOnce(
  session,
  "      if (after.products.length !== snapshot.products.length) throw new Error('수정 후 Excel 행 수가 달라져 완료 처리하지 않았습니다.');",
  "      const expectedRowsAfterCorrection = snapshot.products.length + Number(saved.addedRows || 0);\n      if (after.products.length !== expectedRowsAfterCorrection) throw new Error(`수정/추가 후 Excel 행 수가 예상과 다릅니다. ${after.products.length}/${expectedRowsAfterCorrection}행`);",
  'post-write row count with appended products',
);
session = replaceOnce(
  session,
  "      report.changedRows = Number(saved.changedRows || 0);\n      report.changedCells = Number(saved.changedCells || 0);",
  "      report.changedRows = Number(saved.changedRows || 0);\n      report.addedRows = Number(saved.addedRows || 0);\n      report.addedProducts = Number(saved.addedProducts || 0);\n      report.changedCells = Number(saved.changedCells || 0);",
  'report appended row counters',
);
session = replaceOnce(
  session,
  "      view.finish({ ok: true, corrected: true, changedRows: report.changedRows, changedCells: report.changedCells,\n        verifiedCells: report.verifiedCells, report, afterProducts: after.products });",
  "      view.finish({ ok: true, corrected: true, changedRows: report.changedRows, addedRows: report.addedRows, addedProducts: report.addedProducts, changedCells: report.changedCells,\n        verifiedCells: report.verifiedCells, report, afterProducts: after.products });",
  'view appended row counters',
);
await save('services/poizon-review-session.mjs', session);

let view = await read('src/poizon-review-workspace.js');
view = view.replace('<span data-tone="missing">연결 불가</span>', '<span data-tone="missing">Excel 상품 없음/추가</span>');
view = replaceOnce(
  view,
  ".map((row) => result.corrected && reviewTone(row) === 'different' ? { ...row, equal: true, status: 'POIZON 값으로 수정 완료 · 저장 후 재검증 완료' } : row);",
  ".map((row) => result.corrected && (reviewTone(row) === 'different' || /새 행 추가 대상/.test(row.status || ''))\n          ? { ...row, matched: true, equal: true, status: /새 행 추가 대상/.test(row.status || '')\n            ? 'POIZON 값으로 새 행 추가 완료 · 저장 후 재검증 완료'\n            : 'POIZON 값으로 수정 완료 · 저장 후 재검증 완료' } : row);",
  'final row state for appended products',
);
view = replaceOnce(
  view,
  "get('.review-phase').textContent = result.ok ? `대조 완료 · POIZON 기준 Excel ${Number(result.changedRows || 0).toLocaleString('ko-KR')}행 수정 · 재검증 완료`",
  "get('.review-phase').textContent = result.ok ? `대조 완료 · 기존 ${Number(result.changedRows || 0).toLocaleString('ko-KR')}행 수정 · 누락 ${Number(result.addedRows || 0).toLocaleString('ko-KR')}행 추가 · 재검증 완료`",
  'final appended row status',
);
await save('src/poizon-review-workspace.js', view);

console.log('POIZON missing-product recovery enabled: confirmed SPUs append new Excel rows, then saved workbook is reread and reverified.');
