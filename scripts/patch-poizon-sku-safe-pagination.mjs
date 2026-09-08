import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, value) => { if (value !== await read(path)) await writeFile(new URL(path, root), value, 'utf8'); };
function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`SKU-safe pagination patch target missing: ${label}`);
  return source.replace(before, after);
}
function replaceCheckpointCall(source) {
  if (source.includes('POIZON_SKU_SAFE_PAGE_SELECTION')) return source;
  const productNeedle = 'products: assertPoizonPageReadyForCorrection(currentPageProducts, livePage.rows, capture.currentPage),';
  const productAt = source.indexOf(productNeedle);
  if (productAt < 0) throw new Error('SKU-safe pagination patch target missing: checkpoint guarded products');
  const start = source.lastIndexOf('        const checkpoint = await syncPoizonPageCheckpoint({', productAt);
  const endNeedle = '        });';
  const end = source.indexOf(endNeedle, productAt);
  if (start < 0 || end < 0) throw new Error('SKU-safe pagination patch target missing: checkpoint call bounds');
  const after = `        // POIZON_SKU_SAFE_PAGE_SELECTION: SKU-only Excel values are preserved and deferred.\n        // Only same-scope SPU evidence or true missing rows may be written on this page.\n        const pageCorrection = selectPoizonPageCorrectionProducts(currentPageProducts, livePage.rows, capture.currentPage);\n        const checkpoint = pageCorrection.products.length\n          ? await syncPoizonPageCheckpoint({\n              filePath: input.verification.filePath,\n              products: pageCorrection.products,\n              pageNum: capture.currentPage,\n              backupPath: checkpointSummary.backupPath,\n            })\n          : { ok: true, reverified: true, changedRows: 0, changedCells: 0, addedRows: 0, addedProducts: 0, verifiedCells: 0, changes: [], backupPath: checkpointSummary.backupPath };\n        checkpoint.deferredProducts = Number(pageCorrection.deferredProducts || 0);`;
  return source.slice(0, start) + after + source.slice(end + endNeedle.length);
}

const live = await read('services/live-poizon-crosscheck.mjs');
if (!live.includes('POIZON_SKU_SAFE_DEFER_V1')
    || !live.includes('const writable = assertPoizonPageReadyForCorrection(products, rows, pageNum);')
    || !live.includes('deferredProducts: rows.filter(onlySkuScopeMismatch).length')) {
  throw new Error('Canonical SKU-safe evidence policy is missing; refusing to generate a competing policy.');
}

let main = await read('main.mjs');
main = main.replace(
  'import { assertPoizonPageReadyForCorrection } from "./services/live-poizon-crosscheck.mjs";',
  'import { assertPoizonPageReadyForCorrection, selectPoizonPageCorrectionProducts } from "./services/live-poizon-crosscheck.mjs";'
);
main = replaceCheckpointCall(main);
if (!main.includes('deferredProducts: 0,')) {
  main = replaceOnce(
    main,
    "    pagesCompleted: 0, changedRows: 0, changedCells: 0, addedRows: 0, addedProducts: 0, verifiedCells: 0,",
    "    pagesCompleted: 0, changedRows: 0, changedCells: 0, addedRows: 0, addedProducts: 0, verifiedCells: 0, deferredProducts: 0,",
    'checkpoint deferred summary',
  );
}
if (!main.includes('checkpointSummary.deferredProducts +=')) {
  main = replaceOnce(
    main,
    "        checkpointSummary.verifiedCells += Number(checkpoint.verifiedCells || 0);",
    "        checkpointSummary.verifiedCells += Number(checkpoint.verifiedCells || 0);\n        checkpointSummary.deferredProducts += Number(checkpoint.deferredProducts || 0);",
    'checkpoint deferred accumulation',
  );
}
main = main.replace(
  "실제 누락 추가 ${Number(checkpoint.addedRows || 0)}행 · 저장 후 재검증 완료",
  "실제 누락 추가 ${Number(checkpoint.addedRows || 0)}행 · 옵션 비교 보류 ${Number(checkpoint.deferredProducts || 0)}개 · 저장 후 재검증 완료"
);
await save('main.mjs', main);

let review = await read('services/poizon-review-session.mjs');
review = review.replace(
  "import { assertPoizonPageReadyForCorrection } from './live-poizon-crosscheck.mjs';",
  "import { assertPoizonPageReadyForCorrection, selectPoizonPageCorrectionProducts } from './live-poizon-crosscheck.mjs';"
);
if (!review.includes('POIZON_SKU_SAFE_FINAL_SELECTION')) {
  const call = "const finalSaved = await api.syncExcelWithSellerScreen({ path: snapshot.file.path, products: assertPoizonPageReadyForCorrection(captured.products || [], coverage.rows) });";
  if (!review.includes(call)) throw new Error('SKU-safe pagination patch target missing: final guarded write');
  const after = "// POIZON_SKU_SAFE_FINAL_SELECTION: preserve SKU rows; only verified same-scope rows reach the writer.\n      const finalSelection = selectPoizonPageCorrectionProducts(captured.products || [], coverage.rows);\n      const finalSaved = finalSelection.products.length\n        ? await api.syncExcelWithSellerScreen({ path: snapshot.file.path, products: finalSelection.products })\n        : { ok:true, changedRows:0, changedCells:0, addedRows:0, addedProducts:0, verifiedCells:0, reverified:true, changes:[], backupPath:'' };\n      finalSaved.deferredProducts = Number(finalSelection.deferredProducts || 0);";
  review = review.replace(call, after);
}
if (!review.includes('report.deferredProducts =')) {
  review = replaceOnce(
    review,
    "      report.backupPath = saved.backupPath || '';",
    "      report.backupPath = saved.backupPath || '';\n      report.deferredProducts = Number(saved.deferredProducts || captured.checkpointSync?.deferredProducts || 0);",
    'report deferred count',
  );
}
await save('services/poizon-review-session.mjs', review);

let view = await read('src/poizon-review-workspace.js');
view = view.replace(
  "let state = { checkedProducts: 0, equalProducts: 0, differentProducts: 0, missingProducts: 0, pageNum: 0, pageCount: 0 };",
  "let state = { checkedProducts: 0, equalProducts: 0, differentProducts: 0, missingProducts: 0, deferredProducts: 0, pageNum: 0, pageCount: 0 };"
);
view = view.replace(
  "`누적 대조 ${number(state.checkedProducts)} · 일치 ${number(state.equalProducts)} · 차이/미확인 ${number(state.differentProducts)} · 연결 불가 ${number(state.missingProducts)}`",
  "`누적 대조 ${number(state.checkedProducts)} · 일치 ${number(state.equalProducts)} · 수정/확인 ${number(Math.max(0, state.differentProducts - state.deferredProducts))} · 옵션 비교 보류 ${number(state.deferredProducts)} · Excel 누락 ${number(state.missingProducts)}`"
);
await save('src/poizon-review-workspace.js', view);

let runner = await read('scripts/run-release-regressions.mjs');
if (!runner.includes('"tests/poizon-sku-safe-pagination.test.mjs"')) {
  const marker = 'const files = [...new Set([...process.argv.slice(2),';
  if (!runner.includes(marker)) throw new Error('Release regression runner target missing.');
  runner = runner.replace(marker, marker + ' "tests/poizon-sku-safe-pagination.test.mjs",');
}
await save('scripts/run-release-regressions.mjs', runner);

console.log('POIZON SKU-safe pagination applied: real export SKU rows are preserved, not mislabeled missing, and no longer stop later pages.');
