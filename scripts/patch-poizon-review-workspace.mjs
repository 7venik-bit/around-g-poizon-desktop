import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = async (p) => (await readFile(new URL(p, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (p, value) => { if (value !== await read(p)) await writeFile(new URL(p, root), value, 'utf8'); };
function once(s, a, b, label) { if (s.includes(b)) return s; if (!s.includes(a)) throw new Error('Review integration target missing: ' + label); return s.replace(a, b); }
function section(s, a, b, replacement) { const start = s.indexOf(a), end = s.indexOf(b, start + a.length); if (start < 0 || end < 0) throw new Error('Review section missing: ' + a); return s.slice(0, start) + replacement + s.slice(end); }

let main = await read('main.mjs');
if (!main.includes('readReviewWorkbook }')) {
  main = 'import { readReviewWorkbook, checkReviewWorkbookRevision } from "./services/poizon-review-workbook.mjs";\n' + main;
  main = once(main, 'import { createPageCrossCheck, verificationConditionLabel, paintSellerVerification } from "./services/live-poizon-crosscheck.mjs";',
    'import { createPageCrossCheck, verificationConditionLabel } from "./services/live-poizon-crosscheck.mjs";\nimport { paintReviewPage as paintSellerVerification } from "./services/poizon-review-paint.mjs";', 'shared row colors');
  main = once(main, '  ipcMain.handle("excel:preview",', '  ipcMain.handle("excel:review-snapshot", (_event, input = {}) => readReviewWorkbook(input, buildExcelPreviewProducts));\n  ipcMain.handle("excel:review-revision", (_event, input = {}) => checkReviewWorkbookRevision(input));\n  ipcMain.handle("excel:preview",', 'read-only snapshot IPC');
  main = once(main, '  const allProducts = mergeSellerBrandProducts(domProducts, networkSellerProducts);',
    '  const allProducts = input.verification?.screenOnly ? domProducts : mergeSellerBrandProducts(domProducts, networkSellerProducts);', 'screen-only evidence');
  main = once(main, '      mainBounds: mainWindow.getBounds(),', '      mainMinimum: mainWindow.getMinimumSize?.() || [1040, 700],\n      sellerMinimum: sellerWindow.getMinimumSize?.() || [1000, 700],\n      mainBounds: mainWindow.getBounds(),', 'preserve window minimum');
  main = once(main, '  sellerWindow.setBounds({ x: area.x,', '  mainWindow.setMinimumSize?.(360, 400);\n  sellerWindow.setMinimumSize?.(480, 400);\n  sellerWindow.setBounds({ x: area.x,', 'split windows may shrink');
  main = once(main, '    mainWindow.setBounds(saved.mainBounds);', '    mainWindow.setMinimumSize?.(...saved.mainMinimum);\n    mainWindow.setBounds(saved.mainBounds);', 'restore main minimum');
  main = once(main, '    sellerWindow.setBounds(saved.sellerBounds);', '    sellerWindow.setMinimumSize?.(...saved.sellerMinimum);\n    sellerWindow.setBounds(saved.sellerBounds);', 'restore seller minimum');
  main = once(main, '        row.style.outline = ""; row.style.outlineOffset = ""; delete row.dataset.aroundGVerification;',
    '        if (row.dataset.aroundGReviewStyle) { Object.assign(row.style, JSON.parse(row.dataset.aroundGReviewStyle)); delete row.dataset.aroundGReviewStyle; }\n        else { row.style.outline = ""; row.style.outlineOffset = ""; }\n        delete row.dataset.aroundGVerification; delete row.dataset.aroundGReviewKey;', 'restore real screen styles');
}
await save('main.mjs', main);
let preload = await read('preload.cjs');
preload = once(preload, '  previewExcelFile:', '  readPoizonReviewWorkbook: (input) => ipcRenderer.invoke("excel:review-snapshot", input),\n  checkPoizonReviewWorkbook: (input) => ipcRenderer.invoke("excel:review-revision", input),\n  previewExcelFile:', 'snapshot bridge');
await save('preload.cjs', preload);

let renderer = await read('src/renderer.js');
if (!renderer.includes('async function openReviewLocalBrandPreview')) {
  renderer = renderer.replaceAll('"./live-poizon-crosscheck.js"', '"./poizon-review-workspace.js"');
  renderer = section(renderer, 'async function prepareLivePoizonVerification(', 'async function finishLivePoizonVerification(', `async function prepareLivePoizonVerification(file, brandName, excelProducts, conditions) {
  const live = await import("./poizon-review-workspace.js");
  const snapshot = await window.aroundG.readPoizonReviewWorkbook({ path: file.path });
  if (!snapshot?.ok) throw new Error(snapshot?.message || "Excel 전체 읽기 실패");
  const result = live.beginLiveVerification({ file, brandName, snapshot, conditions });
  const layout = await window.aroundG.beginSellerExcelVerification({ brandName, fileName: file.name || "" });
  if (!layout?.ok) { result.finish({ ok: false, message: layout?.message }); throw new Error(layout?.message || "검증 창 열기 실패"); }
  return result;
}

`);
  renderer = section(renderer, 'async function openVerifiedCombinedBrandPreview(files, filters) {', 'async function openCombinedSelectedBrandPreview', `async function openReviewLocalBrandPreview(files, filters = {}) {
  const service = await import("../services/poizon-review-session.mjs");
  const snapshots = await service.loadReviewSnapshots(files, window.aroundG, (message) => { $("#brand-status").textContent = message; });
  const products = snapshots.flatMap((snapshot) => snapshot.products.map((p) => ({ ...p,
    _sourceFilePath: snapshot.file.path, _sourceBrandName: snapshot.file.brandName || "",
    _excelSelectionKey: snapshot.file.path.toLowerCase() + "::ROW:" + p.sourceRowNumber })));
  // Opening a brand list is local only. POIZON review is an explicit action.
  combinedBrandPreview = { products, files, brandCount: files.length, loadedCount: snapshots.length,
    filters: { minimumTotal: "", minimumLocalTotal: "" }, verified: false };
  await openIntegratedBrandExcel(files[0], false);
  selectedExcelPreviewProducts.clear(); excelPreviewProductCache.clear(); excelPreviewSearchResults.clear();
  excelPreviewIntegrated = true; renderCombinedBrandPreviewPage(0);
  $("#brand-status").textContent = "Excel 전체 " + products.length.toLocaleString("ko-KR") + "행 불러오기 완료 · POIZON 대조는 별도 버튼으로 시작합니다.";
}

async function openVerifiedCombinedBrandPreview(files, filters = {}) {
  const service = await import("../services/poizon-review-session.mjs");
  const live = await import("./poizon-review-workspace.js");
  if (live.reviewIsRunning() || downloadFileSyncActive || brandSelectionBusy) throw new Error("진행 중인 작업이 끝난 뒤 대조해 주세요.");
  const defaults = live.readVerificationConditions();
  const conditions = { minimumChinaSales30: filters.minimumTotal ?? defaults.minimumChinaSales30,
    minimumLocalSales30: filters.minimumLocalTotal ?? defaults.minimumLocalSales30 };
  return service.runPoizonReviewBatch({ files, conditions, api: window.aroundG,
    onProgress: (message) => { $("#brand-status").textContent = message; },
    createView: (snapshot, frozen) => live.beginLiveVerification({ file: snapshot.file, brandName: snapshot.file.brandName, snapshot, conditions: frozen }),
    notify: (report, view) => view ? view.showReport(report) : live.showReviewReport(report) });
}

`);
  renderer = once(renderer, '  return openVerifiedCombinedBrandPreview(files, filters);', '  return openReviewLocalBrandPreview(files, filters);', 'local brand list separated');
  // Replace the old cross-brand verification loop with a local file-list refresh.
  renderer = section(renderer, '$("#import-button").addEventListener("click", async () => {', '$("#export-button").addEventListener', `$("#import-button").addEventListener("click", async () => {
  if (downloadFileSyncActive) return;
  const live = await import("./poizon-review-workspace.js");
  if (live.reviewIsRunning()) return;
  downloadFileSyncActive = true; const button = $("#import-button"), previous = button.textContent;
  button.disabled = true; button.textContent = "파일 목록 확인 중";
  try {
    const result = await window.aroundG.listBrandExportFiles();
    if (!result?.ok) throw new Error(result?.message || "다운로드 파일 목록을 읽지 못했습니다.");
    downloadedBrandFiles = result.files || [];
    localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));
    renderDownloadedBrandFiles(); renderBrandCards($("#brand-filter")?.value || "");
    $("#excel-files-status").textContent = "파일 목록 동기화 완료 · " + downloadedBrandFiles.length + "개 · POIZON 대조는 실행하지 않았습니다.";
  } catch (error) { showRuntimeError(error); }
  finally { downloadFileSyncActive = false; button.disabled = false; button.textContent = previous; }
});

`);
  renderer += `
function installReviewEntryButtons() {
  const add = (id, label, host) => {
    if (!host || document.getElementById(id)) return;
    const button = document.createElement("button"); button.id = id; button.type = "button"; button.textContent = label; host.append(button);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const candidates = id === "poizon-review-brand-start"
          ? selectedBrandsForExport().map((brand) => latestCompletedBrandDownload(brand)).filter(Boolean)
          : downloadedBrandFiles.filter((file) => selectedDownloadedFilePaths.has(brandImportPathKey(file.path)));
        const files = [...new Map(candidates.map((file) => [brandImportPathKey(file.path), file])).values()];
        if (!files.length) throw new Error("대조할 다운로드 완료 브랜드 또는 Excel 파일을 선택해 주세요.");
        await openVerifiedCombinedBrandPreview(files);
      } catch (error) { showRuntimeError(error); }
      finally { button.disabled = false; }
    });
  };
  add("poizon-review-brand-start", "POIZON 대조", document.querySelector(".frequent-brand-heading-actions"));
  add("poizon-review-files-start", "선택 파일 POIZON 대조", document.getElementById("poizon-verification-controls"));
}
void import("./poizon-review-workspace.js").then((live) => { live.installVerificationControls(); installReviewEntryButtons(); }).catch(showRuntimeError);
`;
}
await save('src/renderer.js', renderer);
let html = await read('src/index.html');
if (!html.includes('id="poizon-review-styles"')) html = once(html, '</head>', '  <link id="poizon-review-styles" rel="stylesheet" href="./poizon-review-workspace.css">\n</head>', 'external CSP-safe CSS');
await save('src/index.html', html);
let regressions = await read('scripts/run-release-regressions.mjs');
regressions = once(regressions, 'const files = [...new Set([...process.argv.slice(2),', 'const files = [...new Set([...process.argv.slice(2), "tests/poizon-review-workspace.test.mjs",', 'mandatory review regression');
await save('scripts/run-release-regressions.mjs', regressions);
console.log('Dedicated POIZON review: full read-only Excel snapshot, source-order colors, explicit review entry, independent file-list synchronization.');
