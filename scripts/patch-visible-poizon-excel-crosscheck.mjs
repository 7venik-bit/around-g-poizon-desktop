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

let main = await readFile(mainPath, "utf8");
let preload = await readFile(preloadPath, "utf8");
let renderer = await readFile(rendererPath, "utf8");
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
  const before = block(
    "let mainWindow;",
    "let sellerWindow;",
    "let sellerMonitorWindow;",
  );
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
    "    status.textContent = `검증 화면 열림 · 왼쪽 POIZON / 오른쪽 Excel · ${brandName}`;",
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
  const before = block(
    "        const excelSales = await downloadedBrandSalesByArticle(brand);",
    '        if (!excelSales.ok) throw new Error(excelSales.error || "EXCEL_READ_FAILED");',
    "        const sellerResult = await window.aroundG.captureSellerBrandSales({",
  );
  const after = block(
    "        const excelSales = await downloadedBrandSalesByArticle(brand);",
    '        if (!excelSales.ok) throw new Error(excelSales.error || "EXCEL_READ_FAILED");',
    "        await showPoizonExcelVerificationPair(file, brandName);",
    "        if (syncProgress) {",
    '          syncProgress.querySelector("span").textContent = `검증 중 · 왼쪽 POIZON / 오른쪽 Excel · ${brandName}`;',
    '          syncProgress.title = `${brandName} · POIZON 화면과 ${file?.name || "Excel"}을 동시에 비교합니다.`;',
    "        }",
    "        const sellerResult = await window.aroundG.captureSellerBrandSales({",
  );
  const result = replaceOnce(renderer, before, after, "open pair before Seller Center capture");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

{
  const before = block(
    '        if (!excelSync?.ok) throw new Error(excelSync?.message || "원본 Excel에 POIZON 화면 값을 반영하지 못했습니다.");',
    "        updatedExcelRows += Number(excelSync.changedRows || 0);",
  );
  const after = block(
    '        if (!excelSync?.ok) throw new Error(excelSync?.message || "원본 Excel에 POIZON 화면 값을 반영하지 못했습니다.");',
    "        updatedExcelRows += Number(excelSync.changedRows || 0);",
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
  );
  const result = replaceOnce(renderer, before, after, "refresh Excel after screen-authoritative sync");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

{
  const before = block(
    '      const brandName = downloadFileSyncState.brandName || progress.brandName || "브랜드";',
    "      if (loading) {",
    "        loading.hidden = false;",
    '        loading.querySelector("i").style.width = `${percent}%`;',
    '        loading.querySelector("span").textContent = `전체 ${percent}% · ${brandName} ${page}/${pages || "?"}페이지 · ${Number(progress.count || 0).toLocaleString("ko-KR")}개`;',
    '        loading.title = `${brandName} 동기화 진행 중 · ${page}/${pages || "?"}페이지 · ${Number(progress.count || 0).toLocaleString("ko-KR")}개 상품 확인`;',
    "      }",
    "      if (status) {",
    '        status.className = "status";',
    '        status.textContent = `${brandName} 동기화 진행 중 · ${page}/${pages || "?"}페이지 · ${Number(progress.count || 0).toLocaleString("ko-KR")}개 상품 확인`;',
    "      }",
  );
  const after = block(
    '      const brandName = downloadFileSyncState.brandName || progress.brandName || "브랜드";',
    '      const fileName = downloadFileSyncState.fileName || "Excel";',
    "      if (loading) {",
    "        loading.hidden = false;",
    '        loading.querySelector("i").style.width = `${percent}%`;',
    '        loading.querySelector("span").textContent = `전체 ${percent}% · 왼쪽 POIZON ${page}/${pages || "?"}페이지 · 오른쪽 Excel ${fileName}`;',
    '        loading.title = `${brandName} 교차 검증 중 · POIZON ${page}/${pages || "?"}페이지 · ${Number(progress.count || 0).toLocaleString("ko-KR")}개 상품 · Excel ${fileName}`;',
    "      }",
    "      if (status) {",
    '        status.className = "status";',
    '        status.textContent = `${brandName} 교차 검증 중 · 왼쪽 POIZON ${page}/${pages || "?"}페이지 · 오른쪽 Excel ${fileName}`;',
    "      }",
  );
  const result = replaceOnce(renderer, before, after, "visible left/right progress wording");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

{
  const before = block(
    "  } finally {",
    "    downloadFileSyncActive = false;",
    "    button.disabled = false;",
    '    button.textContent = "다운로드 파일 동기화";',
    "  }",
    "});",
    '$("#export-button").addEventListener("click", async () => {',
  );
  const after = block(
    "  } finally {",
    "    await window.aroundG.endSellerExcelVerification().catch(() => {});",
    "    downloadFileSyncActive = false;",
    "    button.disabled = false;",
    '    button.textContent = "다운로드 파일 동기화";',
    "  }",
    "});",
    '$("#export-button").addEventListener("click", async () => {',
  );
  const result = replaceOnce(renderer, before, after, "restore windows after verification");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

if (mainChanged) await writeFile(mainPath, main, "utf8");
if (preloadChanged) await writeFile(preloadPath, preload, "utf8");
if (rendererChanged) await writeFile(rendererPath, renderer, "utf8");

console.log(mainChanged || preloadChanged || rendererChanged
  ? "Applied visible POIZON-left / Excel-right cross-check workflow."
  : "Visible POIZON/Excel cross-check workflow already patched.");
