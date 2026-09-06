import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
function replace(source, before, after, label) {
  if (source.includes(after)) return source;
  const at = source.indexOf(before);
  if (at < 0) throw new Error(`Live cross-check patch target missing: ${label}`);
  return source.slice(0, at) + after + source.slice(at + before.length);
}
function section(source, from, to, transform) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  if (start < 0 || end <= start) throw new Error(`Live cross-check section missing: ${from}`);
  return source.slice(0, start) + transform(source.slice(start, end)) + source.slice(end);
}
let main = await read('main.mjs'), preload = await read('preload.cjs'), renderer = await read('src/renderer.js');
const imported = 'import { createPageCrossCheck, verificationConditionLabel, paintSellerVerification } from "./services/live-poizon-crosscheck.mjs";\n';
if (!main.includes(imported.trim())) main = imported + main;
main = section(main, 'async function captureSellerBrandSales', 'async function lookupSellerTransactionPrice', (capture) => {
  if (capture.includes('const liveVerifier =')) return capture;
  capture = capture.replaceAll('mainWindow?.webContents.send("explorer:brand-progress", {', 'reportCaptureProgress({');
  capture = replace(capture, '  const sellerPageDelayMs', `  const liveVerifier = input.verification?.runId ? createPageCrossCheck(input.verification) : null;
  const reportCaptureProgress = (progress) => {
    mainWindow?.webContents.send("explorer:brand-progress", progress);
    if (liveVerifier) mainWindow?.webContents.send("seller:verification-progress", {
      runId: input.verification.runId, phase: "capture-status", message: progress.message,
      conditions: liveVerifier.conditions, updatedAt: new Date().toISOString(),
    });
  };
  const sellerPageDelayMs`, 'main reporter');
  capture = replace(capture, '    const products = mergeSellerBrandPages(pages);', `    const products = mergeSellerBrandPages(pages);
    // Compare the actual current page against the unfiltered workbook BEFORE
    // the next pagination click. Only the view, never source capture, is filtered.
    if (liveVerifier) {
      const livePage = liveVerifier.acceptPage(mergeSellerBrandPages([capture.rows || []]), {
        pageNum: capture.currentPage, pageCount: capture.pageCount,
      });
      mainWindow?.webContents.send("seller:verification-progress", livePage);
      await sellerWindow.webContents.executeJavaScript(
        "(" + paintSellerVerification.toString() + ")(document," + JSON.stringify({
          ...livePage, label: "공통 검증 조건: " + verificationConditionLabel(liveVerifier.conditions),
        }) + ")", true,
      );
    }`, 'current page comparison');
  return capture;
});
// Remove only our own visual annotations when the split-window job ends.
main = replace(main, '  const saved = sellerExcelVerificationLayout;', `  if (sellerWindow && !sellerWindow.isDestroyed()) {
    void sellerWindow.webContents.executeJavaScript(\`(() => {
      document.getElementById("around-g-live-verification")?.remove();
      for (const row of document.querySelectorAll("[data-around-g-verification]")) {
        row.style.outline = ""; row.style.outlineOffset = ""; delete row.dataset.aroundGVerification;
      }
    })()\`, true).catch(() => {});
  }
  const saved = sellerExcelVerificationLayout;`, 'restore original Seller Center view');
preload = replace(preload,
  '  captureSellerBrandSales: (input = {}) => ipcRenderer.invoke("seller:capture-brand-sales", input),',
  `  onSellerVerificationProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("seller:verification-progress", handler);
    return () => ipcRenderer.removeListener("seller:verification-progress", handler);
  },
  captureSellerBrandSales: (input = {}) => ipcRenderer.invoke("seller:capture-brand-sales", input),`, 'live event bridge');

// Keep this helper outside source slices used by legacy category unit tests.
const helper = `async function prepareLivePoizonVerification(file, brandName, excelProducts, conditions) {
  const live = await import("./live-poizon-crosscheck.js");
  window.activateSearchServiceMode?.("files");
  await showPoizonExcelVerificationPair(file, brandName);
  return live.beginLiveVerification({ file, brandName, excelProducts, conditions });
}

async function finishLivePoizonVerification(live, brand, file, sellerResult, excelSync) {
  if (!live) return;
  const reread = await downloadedBrandSalesByArticle(brand);
  if (!reread.ok) throw new Error(reread.error || "저장 후 Excel 재읽기 실패");
  live.finish({ ok: true, changedRows: excelSync.changedRows, afterProducts: reread.products,
    screenProducts: sellerResult.products || [] });
}

`;
if (!renderer.includes('async function prepareLivePoizonVerification')) {
  renderer = replace(renderer, 'function salesByArticle(', helper + 'function salesByArticle(', 'renderer shared helper');
}
renderer = section(renderer, '$("#category-search").addEventListener', 'async function showPoizonExcelVerificationPair', (handler) => {
  if (handler.includes('let liveVerification = null;')) return handler;
  handler = replace(handler, '      try {\n        const excelSales =', '      let liveVerification = null;\n      try {\n        const excelSales =', 'category live handle');
  handler = replace(handler, '        const sellerResult = await window.aroundG.captureSellerBrandSales({', `        if (window.aroundG.onSellerVerificationProgress) {
          liveVerification = await prepareLivePoizonVerification(latestCompletedBrandDownload(brand), brandName,
            excelSales.products, { minimumChinaSales30, minimumLocalSales30 });
        }
        const sellerResult = await window.aroundG.captureSellerBrandSales({
          verification: liveVerification?.input,`, 'category snapshot');
  handler = replace(handler, '        const crossValidated = mergeExcelProductsWithSellerScreen', `        if (liveVerification) {
          liveVerification.saving();
          const verificationFile = latestCompletedBrandDownload(brand);
          const excelSync = await window.aroundG.syncExcelWithSellerScreen({ path: verificationFile.path, products: sellerResult.products || [] });
          if (!excelSync?.ok) throw new Error(excelSync?.message || "Excel 반영 실패");
          await finishLivePoizonVerification(liveVerification, brand, verificationFile, sellerResult, excelSync);
        }
        const crossValidated = mergeExcelProductsWithSellerScreen`, 'category save and reread');
  handler = replace(handler, '      } catch (error) {\n        if (runId !== categorySearchRunId)', '      } catch (error) {\n        liveVerification?.finish({ ok: false, message: error?.message || String(error) });\n        if (runId !== categorySearchRunId)', 'category error display');
  // A cancelled run must release the listener and the split layout too.
  handler = replace(handler, '      }\n      if (runId !== categorySearchRunId) return;\n      completedCount += 1;', '      } finally {\n        if (liveVerification?.running) liveVerification.finish({ ok: false, message: "사용자 중단" });\n      }\n      if (runId !== categorySearchRunId) return;\n      completedCount += 1;', 'category live cleanup');
  handler = replace(handler, '    if (runId === categorySearchRunId) button.disabled = false;', '    await window.aroundG.endSellerExcelVerification?.().catch(() => {});\n    if (runId === categorySearchRunId) button.disabled = false;', 'category layout cleanup');
  return handler;
});
renderer = section(renderer, '$("#import-button").addEventListener', '$("#export-button").addEventListener', (handler) => {
  if (handler.includes('const verificationConditions =')) return handler;
  handler = replace(handler, '    const brands = completedDownloadBrands();', `    const liveModule = await import("./live-poizon-crosscheck.js");
    const verificationConditions = liveModule.readVerificationConditions();
    const brands = completedDownloadBrands();`, 'freeze full-batch conditions');
  handler = replace(handler, '      try {\n        attempted += 1;', '      let liveVerification = null;\n      try {\n        attempted += 1;', 'download live handle');
  handler = replace(handler, '        await showPoizonExcelVerificationPair(file, brandName);', `        await showPoizonExcelVerificationPair(file, brandName);
        liveVerification = liveModule.beginLiveVerification({ file, brandName, excelProducts: excelSales.products,
          conditions: verificationConditions });`, 'download live panel');
  handler = replace(handler, '        const sellerResult = await window.aroundG.captureSellerBrandSales({', '        const sellerResult = await window.aroundG.captureSellerBrandSales({\n          verification: liveVerification.input,', 'download snapshot');
  handler = replace(handler, '        const excelSync = await window.aroundG.syncExcelWithSellerScreen({', '        liveVerification.saving();\n        const excelSync = await window.aroundG.syncExcelWithSellerScreen({', 'saving phase');
  handler = replace(handler, '        const saved = await window.aroundG.upsert("poizonSyncs", {', '        await finishLivePoizonVerification(liveVerification, brand, file, sellerResult, excelSync);\n        const saved = await window.aroundG.upsert("poizonSyncs", {', 'reread before completed record');
  handler = replace(handler, '          syncedAt: new Date().toISOString(),', '          verificationConditions,\n          syncedAt: new Date().toISOString(),', 'audit conditions');
  handler = replace(handler, '      } catch (error) {\n        const message =', '      } catch (error) {\n        liveVerification?.finish({ ok: false, message: error?.message || String(error) });\n        const message =', 'download failure state');
  return handler;
});
const startup = '\nvoid import("./live-poizon-crosscheck.js").then((live) => live.installVerificationControls()).catch(showRuntimeError);\n';
if (!renderer.includes(startup.trim())) renderer += startup;
// Make the new view available in the packaged application and catch bad hooks
// during installation rather than publishing a non-functional update.
for (const [path, content] of [['main.mjs', main], ['preload.cjs', preload], ['src/renderer.js', renderer]]) {
  if (content !== await read(path)) await writeFile(new URL(path, root), content, 'utf8');
}
console.log('Applied page-by-page POIZON/Excel comparison with shared recent-30-day conditions and visible progress.');
