import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, value) => { if (value !== await read(path)) await writeFile(new URL(path, root), value, 'utf8'); };

function section(source, startText, endText, transform, label) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  if (start < 0 || end < 0) throw new Error(`Page checkpoint section missing: ${label}`);
  return source.slice(0, start) + transform(source.slice(start, end)) + source.slice(end);
}

let main = await read('main.mjs');
const checkpointImport = 'import { syncPoizonPageCheckpoint } from "./services/poizon-page-checkpoint.mjs";\n';
if (!main.includes(checkpointImport.trim())) main = checkpointImport + main;

main = section(main, 'async function captureSellerBrandSales', 'async function lookupSellerTransactionPrice', (capture) => {
  if (capture.includes('POIZON_PAGE_CHECKPOINT_BEFORE_NAVIGATION')) return capture;

  const delayMarker = '  const sellerPageDelayMs = 12_000;';
  if (!capture.includes(delayMarker)) throw new Error('Page checkpoint target missing: sellerPageDelayMs');
  capture = capture.replace(delayMarker, `  // POIZON_PAGE_CHECKPOINT_BEFORE_NAVIGATION\n  const checkpointSummary = {\n    enabled: Boolean(liveVerifier && input.verification?.filePath),\n    pagesCompleted: 0, changedRows: 0, changedCells: 0, addedRows: 0, addedProducts: 0, verifiedCells: 0,\n    reverified: true, backupPath: '', changes: [],\n  };\n  const checkpointPages = new Set();\n  const sellerPageDelayMs = 12_000;`);

  const livePageBefore = '      const livePage = liveVerifier.acceptPage(mergeSellerBrandPages([capture.rows || []]), {';
  const livePageAfter = `      const currentPageProducts = mergeSellerBrandPages([capture.rows || []]);\n      const livePage = liveVerifier.acceptPage(currentPageProducts, {`;
  if (!capture.includes(livePageBefore)) throw new Error('Page checkpoint target missing: current live page');
  capture = capture.replace(livePageBefore, livePageAfter);

  const paintNeedle = '      await sellerWindow.webContents.executeJavaScript(\n        "(" + paintSellerVerification.toString() + ")(document," + JSON.stringify({';
  const paintStart = capture.indexOf(paintNeedle);
  if (paintStart < 0) throw new Error('Page checkpoint target missing: Seller Center paint');
  const paintEnd = capture.indexOf('      );', paintStart);
  if (paintEnd < 0) throw new Error('Page checkpoint target missing: Seller Center paint end');
  const insertAt = paintEnd + '      );'.length;
  const checkpointCode = `\n      if (typeof checkpointSummary !== 'undefined' && checkpointSummary.enabled) {\n        mainWindow?.webContents.send("seller:verification-progress", {\n          runId: input.verification.runId, phase: "page-checkpoint",\n          message: \`POIZON \${capture.currentPage}/\${capture.pageCount}페이지 · Excel 반영 및 저장 후 재검증 중\`,\n        });\n        const checkpoint = await syncPoizonPageCheckpoint({\n          filePath: input.verification.filePath,\n          products: currentPageProducts,\n          pageNum: capture.currentPage,\n          backupPath: checkpointSummary.backupPath,\n        });\n        if (!checkpoint?.ok || checkpoint.reverified !== true) {\n          throw new Error(checkpoint?.message || \`POIZON \${capture.currentPage}페이지 Excel 체크포인트에 실패했습니다.\`);\n        }\n        checkpointSummary.backupPath = checkpoint.backupPath || checkpointSummary.backupPath;\n        checkpointSummary.changedRows += Number(checkpoint.changedRows || 0);\n        checkpointSummary.changedCells += Number(checkpoint.changedCells || 0);\n        checkpointSummary.addedRows += Number(checkpoint.addedRows || 0);\n        checkpointSummary.addedProducts += Number(checkpoint.addedProducts || 0);\n        checkpointSummary.verifiedCells += Number(checkpoint.verifiedCells || 0);\n        checkpointSummary.changes.push(...(checkpoint.changes || []));\n        checkpointPages.add(Number(capture.currentPage));\n        checkpointSummary.pagesCompleted = checkpointPages.size;\n        mainWindow?.webContents.send("seller:verification-progress", {\n          runId: input.verification.runId, phase: "page-checkpoint-complete",\n          message: \`POIZON \${capture.currentPage}/\${capture.pageCount}페이지 확정 · 상품 \${currentPageProducts.length}개 · 수정 \${Number(checkpoint.changedRows || 0)}행 · 실제 누락 추가 \${Number(checkpoint.addedRows || 0)}행 · 저장 후 재검증 완료\`,\n        });\n      }`;
  capture = capture.slice(0, insertAt) + checkpointCode + capture.slice(insertAt);

  const missingLine = /    missingCount: Math\.max\(0, \(sellerSourceTotal \|\| products\.length\) - products\.length\),\n/;
  if (!missingLine.test(capture)) throw new Error('Page checkpoint target missing: capture success return');
  capture = capture.replace(missingLine, (line) => line + '    checkpointSync: { ...checkpointSummary, changes: [...checkpointSummary.changes] },\n');
  return capture;
}, 'captureSellerBrandSales');
await save('main.mjs', main);

let view = await read('src/poizon-review-workspace.js');
if (!view.includes('filePath: file.path ||')) {
  const before = "  const input = { runId, brandName, fileName: file.name || '', screenOnly: true, conditions: frozen,";
  const after = "  const input = { runId, brandName, fileName: file.name || '', filePath: file.path || '', screenOnly: true, conditions: frozen,";
  if (!view.includes(before)) throw new Error('Page checkpoint target missing: review input file path');
  view = view.replace(before, after);
}
await save('src/poizon-review-workspace.js', view);

let reviewSession = await read('services/poizon-review-session.mjs');
if (!reviewSession.includes('POIZON_PAGE_CHECKPOINT_AGGREGATED')) {
  const before = `      const saved = await api.syncExcelWithSellerScreen({ path: snapshot.file.path, products: captured.products || [] });\n      if (!saved?.ok) throw new Error(saved?.message || 'POIZON 값으로 Excel 수정에 실패했습니다.');\n      if (saved.reverified !== true) throw new Error('Excel 수정 후 POIZON 값 재검증 결과를 확인하지 못했습니다.');`;
  const after = `      const finalSaved = await api.syncExcelWithSellerScreen({ path: snapshot.file.path, products: captured.products || [] });\n      if (!finalSaved?.ok) throw new Error(finalSaved?.message || 'POIZON 값으로 Excel 수정에 실패했습니다.');\n      const pageSaved = captured.checkpointSync?.enabled ? captured.checkpointSync : null;\n      // POIZON_PAGE_CHECKPOINT_AGGREGATED: 페이지별 확정 결과와 마지막 전체 무변경 재검증을 하나의 저장 결과로 합친다.\n      const saved = pageSaved ? {\n        ...finalSaved,\n        changedRows: Number(pageSaved.changedRows || 0) + Number(finalSaved.changedRows || 0),\n        changedCells: Number(pageSaved.changedCells || 0) + Number(finalSaved.changedCells || 0),\n        addedRows: Number(pageSaved.addedRows || 0) + Number(finalSaved.addedRows || 0),\n        addedProducts: Number(pageSaved.addedProducts || 0) + Number(finalSaved.addedProducts || 0),\n        verifiedCells: Number(pageSaved.verifiedCells || 0) + Number(finalSaved.verifiedCells || 0),\n        changes: [...(pageSaved.changes || []), ...(finalSaved.changes || [])],\n        backupPath: pageSaved.backupPath || finalSaved.backupPath || '',\n        reverified: pageSaved.reverified === true && finalSaved.reverified === true,\n        checkpointPages: Number(pageSaved.pagesCompleted || 0),\n      } : finalSaved;\n      if (saved.reverified !== true) throw new Error('Excel 수정 후 POIZON 값 재검증 결과를 확인하지 못했습니다.');`;
  if (!reviewSession.includes(before)) throw new Error('Page checkpoint target missing: final review save');
  reviewSession = reviewSession.replace(before, after);

  reviewSession = reviewSession.replace(
    "      report.backupPath = saved.backupPath || '';",
    "      report.backupPath = saved.backupPath || '';\n      report.checkpointPages = Number(saved.checkpointPages || 0);"
  );
}
await save('services/poizon-review-session.mjs', reviewSession);

let tests = await read('tests/poizon-review-workspace.test.mjs');
if (!tests.includes("page checkpoint counts are preserved")) {
  const marker = "test('incomplete capture never becomes an all-match or absence report'";
  const at = tests.indexOf(marker);
  if (at < 0) throw new Error('Page checkpoint test insertion target missing');
  const test = `test('page checkpoint counts are preserved and reread row count includes rows added before the next page', async () => {\n  const base = { products:[{ spuId:'1', articleNumber:'OLD', sourceRowNumber:2 }], sourceTotalRows:1, revision:'r1', ok:true, file:{ path:'A.xlsx', name:'A.xlsx' } };\n  const added = { spuId:'2', articleNumber:'NEW', sales30dRaw:'100+', localSales30dRaw:'30', hasSalesData:true, hasLocalSalesData:true };\n  let current, reads = 0;\n  const api = {\n    readPoizonReviewWorkbook: async () => { reads++; return reads === 1 ? base : { ...base, products:[...base.products, { ...added, sourceRowNumber:3 }] }; },\n    checkPoizonReviewWorkbook: async () => ({ ok:true, unchanged:true }),\n    beginSellerExcelVerification: async () => ({ ok:true }),\n    captureSellerBrandSales: async () => {\n      current.eventsList.push({ phase:'page-compared', pageNum:1, pageCount:1, rows:[{ key:'SPU:2', spuId:'2', articleNumber:'NEW', matched:false, equal:false, status:'Excel 상품 없음' }] });\n      return { ok:true, products:[added], sourceTotal:1, checkpointSync:{ enabled:true, pagesCompleted:1, changedRows:0, changedCells:0, addedRows:1, addedProducts:1, verifiedCells:2, reverified:true, backupPath:'page.bak', changes:[{ reason:'MISSING_PRODUCT_ROW', spuId:'2', articleNumber:'NEW' }] } };\n    },\n    syncExcelWithSellerScreen: async () => ({ ok:true, changedRows:0, changedCells:0, addedRows:0, addedProducts:0, verifiedCells:2, reverified:true, changes:[] }),\n  };\n  const report = await runPoizonReviewBatch({ files:[base.file], api,\n    createView: async () => { current = { input:{screenOnly:true}, eventsList:[], events(){return this.eventsList;}, saving(){}, finish(){} }; return current; },\n    notify: async () => {} });\n  assert.equal(report.complete, true);\n  assert.equal(report.files[0].addedRows, 1);\n  assert.equal(report.files[0].checkpointPages, 1);\n  assert.equal(report.files[0].backupPath, 'page.bak');\n});\n\n`;
  tests = tests.slice(0, at) + test + tests.slice(at);
}
await save('tests/poizon-review-workspace.test.mjs', tests);

console.log('POIZON page checkpoint applied: each page is recognized, corrected if needed, reread from disk, and only then pagination may continue.');
