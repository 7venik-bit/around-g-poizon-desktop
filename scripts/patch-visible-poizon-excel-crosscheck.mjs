import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
const preloadPath = new URL("../preload.cjs", import.meta.url);
const rendererPath = new URL("../src/renderer.js", import.meta.url);
const block = (...lines) => lines.join("\n");

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return { source, changed: false };
  if (!source.includes(before)) {
    throw new Error(`Visible POIZON/Excel patch target not found (${label}): ${before.slice(0, 140)}`);
  }
  return { source: source.replace(before, after), changed: true };
}

function importHandlerBounds(source) {
  const start = source.indexOf('$("#import-button").addEventListener("click", async () => {');
  const end = source.indexOf('$("#export-button").addEventListener("click", async () => {', start);
  if (start < 0 || end <= start) throw new Error("Downloaded-file sync handler not found.");
  return { start, end };
}

function insertInImportHandler(source, marker, insertedText, placement, label) {
  if (source.includes(insertedText.trim())) return { source, changed: false };
  const { start, end } = importHandlerBounds(source);
  const index = source.indexOf(marker, start);
  if (index < 0 || index >= end) {
    throw new Error(`Visible POIZON/Excel import-handler target not found (${label}): ${marker}`);
  }
  const insertionIndex = placement === "after" ? index + marker.length : index;
  return {
    source: source.slice(0, insertionIndex) + insertedText + source.slice(insertionIndex),
    changed: true,
  };
}

let main = (await readFile(mainPath, "utf8")).replace(/\r\n/g, "\n");
let preload = (await readFile(preloadPath, "utf8")).replace(/\r\n/g, "\n");
let renderer = (await readFile(rendererPath, "utf8")).replace(/\r\n/g, "\n");
let mainChanged = false;
let preloadChanged = false;
let rendererChanged = false;

{
  const result = replaceOnce(
    main,
    'import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, nativeTheme, Notification, safeStorage, session, shell } from "electron";',
    'import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, nativeTheme, Notification, safeStorage, screen, session, shell } from "electron";',
    "Electron screen import",
  );
  main = result.source;
  mainChanged ||= result.changed;
}

{
  const before = block("let mainWindow;", "let sellerWindow;", "let sellerMonitorWindow;");
  const after = block(
    "let mainWindow;",
    "let sellerWindow;",
    "let sellerExcelVerificationLayout = null;",
    "",
    "function beginSellerExcelVerificationWindows(input = {}) {",
    '  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, message: "Around G 메인 창을 찾지 못했습니다." };',
    "  if (!sellerWindow || sellerWindow.isDestroyed()) {",
    "    openSellerCenterWindow(SELLER_CENTER_URL, { visible: true, activate: false });",
    "  }",
    '  if (!sellerWindow || sellerWindow.isDestroyed()) return { ok: false, message: "POIZON 판매자센터 창을 열지 못했습니다." };',
    "  if (!sellerExcelVerificationLayout) {",
    "    sellerExcelVerificationLayout = {",
    "      mainBounds: mainWindow.getBounds(),",
    "      mainMaximized: mainWindow.isMaximized(),",
    "      sellerBounds: sellerWindow.getBounds(),",
    "      sellerMaximized: sellerWindow.isMaximized(),",
    "      sellerVisible: sellerWindow.isVisible(),",
    "    };",
    "  }",
    "  const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea;",
    "  const gap = 8;",
    "  const usableWidth = Math.max(2, area.width - gap);",
    "  const sellerWidth = Math.max(1, Math.floor(usableWidth * 0.55));",
    "  const excelWidth = Math.max(1, usableWidth - sellerWidth);",
    "  if (mainWindow.isMaximized()) mainWindow.unmaximize();",
    "  if (sellerWindow.isMaximized()) sellerWindow.unmaximize();",
    "  sellerWindow.setBounds({ x: area.x, y: area.y, width: sellerWidth, height: area.height });",
    "  mainWindow.setBounds({ x: area.x + sellerWidth + gap, y: area.y, width: excelWidth, height: area.height });",
    "  mainWindow.show();",
    "  sellerWindow.show();",
    "  return {",
    "    ok: true,",
    '    sellerSide: "left",',
    '    excelSide: "right",',
    '    brandName: String(input.brandName || ""),',
    '    fileName: String(input.fileName || ""),',
    "  };",
    "}",
    "",
    "function endSellerExcelVerificationWindows() {",
    "  const saved = sellerExcelVerificationLayout;",
    "  sellerExcelVerificationLayout = null;",
    "  if (!saved) {",
    "    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }",
    "    return { ok: true, restored: false };",
    "  }",
    "  if (mainWindow && !mainWindow.isDestroyed()) {",
    "    if (mainWindow.isMaximized()) mainWindow.unmaximize();",
    "    mainWindow.setBounds(saved.mainBounds);",
    "    if (saved.mainMaximized) mainWindow.maximize();",
    "    mainWindow.show();",
    "  }",
    "  if (sellerWindow && !sellerWindow.isDestroyed()) {",
    "    if (sellerWindow.isMaximized()) sellerWindow.unmaximize();",
    "    sellerWindow.setBounds(saved.sellerBounds);",
    "    if (saved.sellerMaximized) sellerWindow.maximize();",
    "    if (saved.sellerVisible) sellerWindow.show();",
    "    else sellerWindow.hide();",
    "  }",
    "  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();",
    "  return { ok: true, restored: true };",
    "}",
    "",
    "let sellerMonitorWindow;",
  );
  const result = replaceOnce(main, before, after, "verification split-window helpers");
  main = result.source;
  mainChanged ||= result.changed;
}

{
  const before = '  ipcMain.handle("seller:capture-brand-sales", (_event, input = {}) => captureSellerBrandSales(input));';
  const after = block(
    '  ipcMain.handle("seller:excel-verification-start", (_event, input = {}) => beginSellerExcelVerificationWindows(input));',
    '  ipcMain.handle("seller:excel-verification-end", () => endSellerExcelVerificationWindows());',
    '  ipcMain.handle("seller:capture-brand-sales", (_event, input = {}) => captureSellerBrandSales(input));',
  );
  const result = replaceOnce(main, before, after, "verification IPC handlers");
  main = result.source;
  mainChanged ||= result.changed;
}

{
  const before = "  if (sellerWindow && !sellerWindow.isDestroyed()) sellerWindow.hide();\n  mainWindow?.show();\n  mainWindow?.focus();";
  const after = "  if (!sellerExcelVerificationLayout && sellerWindow && !sellerWindow.isDestroyed()) sellerWindow.hide();\n  mainWindow?.show();\n  mainWindow?.focus();";
  const captureStart = main.indexOf("async function captureSellerBrandSales");
  const captureEnd = main.indexOf("async function lookupSellerTransactionPrice", captureStart);
  const existing = main.indexOf(after, captureStart);
  if (!(existing >= captureStart && existing < captureEnd)) {
    const index = main.indexOf(before, captureStart);
    if (captureStart < 0 || captureEnd <= captureStart || index < captureStart || index >= captureEnd) {
      throw new Error("Seller capture visibility target not found.");
    }
    main = main.slice(0, index) + after + main.slice(index + before.length);
    mainChanged = true;
  }
}

{
  const before = '  captureSellerBrandSales: (input = {}) => ipcRenderer.invoke("seller:capture-brand-sales", input),';
  const after = block(
    '  beginSellerExcelVerification: (input = {}) => ipcRenderer.invoke("seller:excel-verification-start", input),',
    '  endSellerExcelVerification: () => ipcRenderer.invoke("seller:excel-verification-end"),',
    '  captureSellerBrandSales: (input = {}) => ipcRenderer.invoke("seller:capture-brand-sales", input),',
  );
  const result = replaceOnce(preload, before, after, "verification preload bridge");
  preload = result.source;
  preloadChanged ||= result.changed;
}

for (const [before, after, label] of [
  [
    'let downloadFileSyncState = { brandName: "", brandIndex: 0, brandCount: 0 };',
    'let downloadFileSyncState = { brandName: "", fileName: "", brandIndex: 0, brandCount: 0 };',
    "sync state file name",
  ],
  [
    '  downloadFileSyncState = { brandName: "", brandIndex: 0, brandCount: 0 };',
    '  downloadFileSyncState = { brandName: "", fileName: "", brandIndex: 0, brandCount: 0 };',
    "sync reset file name",
  ],
  [
    '      downloadFileSyncState = { brandName, brandIndex: brandPosition, brandCount: brands.length };',
    '      downloadFileSyncState = { brandName, fileName: file?.name || "", brandIndex: brandPosition, brandCount: brands.length };',
    "sync active file name",
  ],
]) {
  const result = replaceOnce(renderer, before, after, label);
  renderer = result.source;
  rendererChanged ||= result.changed;
}

{
  const before = '$("#import-button").addEventListener("click", async () => {';
  const after = block(
    'async function showPoizonExcelVerificationPair(file, brandName = "브랜드") {',
    '  if (!file?.path) throw new Error("검증할 Excel 파일 경로가 없습니다.");',
    "  await showExcelPreview(file, 0, {",
    '    minimumTotal: "",',
    '    minimumLocalTotal: "",',
    "    fixedTotalAnd: true,",
    '    matchMode: "all",',
    "    productView: false,",
    "  }, { preserveFilters: false, productView: false });",
    "  const layout = await window.aroundG.beginSellerExcelVerification({",
    "    brandName,",
    '    fileName: file.name || file.path.split(/[\\\\/]/).pop() || "Excel",',
    "  });",
    '  if (!layout?.ok) throw new Error(layout?.message || "POIZON·Excel 검증 화면을 나란히 열지 못했습니다.");',
    '  const status = $("#excel-files-status");',
    "  if (status) {",
    '    status.className = "status";',
    '    status.textContent = `검증 화면 열림 · 왼쪽 POIZON / 오른쪽 Excel · ${brandName}`;',
    "  }",
    "  return layout;",
    "}",
    "",
    '$("#import-button").addEventListener("click", async () => {',
  );
  const result = replaceOnce(renderer, before, after, "visible verification helper");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

{
  const marker = "        const sellerResult = await window.aroundG.captureSellerBrandSales({";
  const inserted = block(
    "        await showPoizonExcelVerificationPair(file, brandName);",
    "        if (syncProgress) {",
    '          syncProgress.querySelector("span").textContent = `검증 중 · 왼쪽 POIZON / 오른쪽 Excel · ${brandName}`;',
    '          syncProgress.title = `${brandName} · POIZON 화면과 ${file?.name || "Excel"}을 동시에 비교합니다.`;',
    "        }",
    "",
  );
  const result = insertInImportHandler(renderer, marker, inserted, "before", "open pair before Seller Center capture");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

{
  const marker = '        const saved = await window.aroundG.upsert("poizonSyncs", {';
  const inserted = block(
    "        await showExcelPreview(file, 0, {",
    '          minimumTotal: "",',
    '          minimumLocalTotal: "",',
    "          fixedTotalAnd: true,",
    '          matchMode: "all",',
    "          productView: false,",
    "        }, { preserveFilters: true, productView: false });",
    "        if (syncProgress) {",
    '          syncProgress.classList.remove("error", "complete");',
    '          syncProgress.querySelector("span").textContent = `${brandName} 검증 완료 · POIZON 화면 값 우선 적용 · 일치 ${crossValidated.matchedExcelCount.toLocaleString("ko-KR")}행 · Excel 수정 ${Number(excelSync.changedRows || 0).toLocaleString("ko-KR")}행`;',
    '          syncProgress.title = `왼쪽 POIZON과 오른쪽 Excel 비교 완료 · ${file?.name || "Excel"}`;',
    "        }",
    "        await new Promise((resolve) => setTimeout(resolve, 2_000));",
    "",
  );
  const result = insertInImportHandler(renderer, marker, inserted, "before", "refresh Excel after screen-authoritative sync");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

{
  const brandLine = '      const brandName = downloadFileSyncState.brandName || progress.brandName || "브랜드";';
  const fileLine = '\n      const fileName = downloadFileSyncState.fileName || "Excel";';
  if (!renderer.includes('const fileName = downloadFileSyncState.fileName || "Excel";')) {
    const result = replaceOnce(renderer, brandLine, brandLine + fileLine, "progress Excel file name");
    renderer = result.source;
    rendererChanged ||= result.changed;
  }
  const replacements = [
    [
      '        loading.querySelector("span").textContent = `전체 ${percent}% · ${brandName} ${page}/${pages || "?"}페이지 · ${Number(progress.count || 0).toLocaleString("ko-KR")}개`;',
      '        loading.querySelector("span").textContent = `전체 ${percent}% · 왼쪽 POIZON ${page}/${pages || "?"}페이지 · 오른쪽 Excel ${fileName}`;',
      "loading cross-check progress",
    ],
    [
      '        loading.title = `${brandName} 동기화 진행 중 · ${page}/${pages || "?"}페이지 · ${Number(progress.count || 0).toLocaleString("ko-KR")}개 상품 확인`;',
      '        loading.title = `${brandName} 교차 검증 중 · POIZON ${page}/${pages || "?"}페이지 · ${Number(progress.count || 0).toLocaleString("ko-KR")}개 상품 · Excel ${fileName}`;',
      "loading cross-check title",
    ],
    [
      '        status.textContent = `${brandName} 동기화 진행 중 · ${page}/${pages || "?"}페이지 · ${Number(progress.count || 0).toLocaleString("ko-KR")}개 상품 확인`;',
      '        status.textContent = `${brandName} 교차 검증 중 · 왼쪽 POIZON ${page}/${pages || "?"}페이지 · 오른쪽 Excel ${fileName}`;',
      "status cross-check progress",
    ],
  ];
  for (const [before, after, label] of replacements) {
    const result = replaceOnce(renderer, before, after, label);
    renderer = result.source;
    rendererChanged ||= result.changed;
  }
}

{
  const marker = "  } finally {";
  const inserted = "\n    await window.aroundG.endSellerExcelVerification().catch(() => {});";
  const result = insertInImportHandler(renderer, marker, inserted, "after", "restore windows after verification");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

if (mainChanged) await writeFile(mainPath, main, "utf8");
if (preloadChanged) await writeFile(preloadPath, preload, "utf8");
if (rendererChanged) await writeFile(rendererPath, renderer, "utf8");

console.log(mainChanged || preloadChanged || rendererChanged
  ? "Applied visible POIZON-left / Excel-right cross-check workflow."
  : "Visible POIZON/Excel cross-check workflow already patched.");
