import { readFile, writeFile } from "node:fs/promises";

const mainPath = new URL("../main.mjs", import.meta.url);
const preloadPath = new URL("../preload.cjs", import.meta.url);
const rendererPath = new URL("../src/renderer.js", import.meta.url);

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
  const before = `let mainWindow;\nlet sellerWindow;\nlet sellerMonitorWindow;`;
  const after = `let mainWindow;\nlet sellerWindow;\nlet sellerExcelVerificationLayout = null;\n\nfunction beginSellerExcelVerificationWindows(input = {}) {\n  if (!mainWindow || mainWindow.isDestroyed()) {\n    return { ok: false, message: "Around G 메인 창을 찾지 못했습니다." };\n  }\n  if (!sellerWindow || sellerWindow.isDestroyed()) {\n    openSellerCenterWindow(SELLER_CENTER_URL, { visible: true, activate: false });\n  }\n  if (!sellerWindow || sellerWindow.isDestroyed()) {\n    return { ok: false, message: "POIZON 판매자센터 창을 열지 못했습니다." };\n  }\n  if (!sellerExcelVerificationLayout) {\n    sellerExcelVerificationLayout = {\n      mainBounds: mainWindow.getBounds(),\n      mainMaximized: mainWindow.isMaximized(),\n      sellerBounds: sellerWindow.getBounds(),\n      sellerMaximized: sellerWindow.isMaximized(),\n      sellerVisible: sellerWindow.isVisible(),\n    };\n  }\n  const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea;\n  const gap = 8;\n  const usableWidth = Math.max(2, area.width - gap);\n  const sellerWidth = Math.max(1, Math.floor(usableWidth * 0.55));\n  const excelWidth = Math.max(1, usableWidth - sellerWidth);\n  if (mainWindow.isMaximized()) mainWindow.unmaximize();\n  if (sellerWindow.isMaximized()) sellerWindow.unmaximize();\n  sellerWindow.setBounds({ x: area.x, y: area.y, width: sellerWidth, height: area.height });\n  mainWindow.setBounds({ x: area.x + sellerWidth + gap, y: area.y, width: excelWidth, height: area.height });\n  mainWindow.show();\n  sellerWindow.show();\n  return {\n    ok: true,\n    sellerSide: "left",\n    excelSide: "right",\n    brandName: String(input.brandName || ""),\n    fileName: String(input.fileName || ""),\n  };\n}\n\nfunction endSellerExcelVerificationWindows() {\n  const saved = sellerExcelVerificationLayout;\n  sellerExcelVerificationLayout = null;\n  if (!saved) {\n    if (mainWindow && !mainWindow.isDestroyed()) {\n      mainWindow.show();\n      mainWindow.focus();\n    }\n    return { ok: true, restored: false };\n  }\n  if (mainWindow && !mainWindow.isDestroyed()) {\n    if (mainWindow.isMaximized()) mainWindow.unmaximize();\n    mainWindow.setBounds(saved.mainBounds);\n    if (saved.mainMaximized) mainWindow.maximize();\n    mainWindow.show();\n  }\n  if (sellerWindow && !sellerWindow.isDestroyed()) {\n    if (sellerWindow.isMaximized()) sellerWindow.unmaximize();\n    sellerWindow.setBounds(saved.sellerBounds);\n    if (saved.sellerMaximized) sellerWindow.maximize();\n    if (saved.sellerVisible) sellerWindow.show();\n    else sellerWindow.hide();\n  }\n  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();\n  return { ok: true, restored: true };\n}\n\nlet sellerMonitorWindow;`;
  const result = replaceOnce(main, before, after, "verification split-window helpers");
  main = result.source;
  mainChanged ||= result.changed;
}

{
  const before = `  ipcMain.handle("seller:capture-brand-sales", (_event, input = {}) => captureSellerBrandSales(input));`;
  const after = `  ipcMain.handle("seller:excel-verification-start", (_event, input = {}) => beginSellerExcelVerificationWindows(input));\n  ipcMain.handle("seller:excel-verification-end", () => endSellerExcelVerificationWindows());\n  ipcMain.handle("seller:capture-brand-sales", (_event, input = {}) => captureSellerBrandSales(input));`;
  const result = replaceOnce(main, before, after, "verification IPC handlers");
  main = result.source;
  mainChanged ||= result.changed;
}

{
  const before = `  captureSellerBrandSales: (input = {}) => ipcRenderer.invoke("seller:capture-brand-sales", input),`;
  const after = `  beginSellerExcelVerification: (input = {}) => ipcRenderer.invoke("seller:excel-verification-start", input),\n  endSellerExcelVerification: () => ipcRenderer.invoke("seller:excel-verification-end"),\n  captureSellerBrandSales: (input = {}) => ipcRenderer.invoke("seller:capture-brand-sales", input),`;
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
  const before = `$("#import-button").addEventListener("click", async () => {`;
  const after = `async function showPoizonExcelVerificationPair(file, brandName = "브랜드") {\n  if (!file?.path) throw new Error("검증할 Excel 파일 경로가 없습니다.");\n  await showExcelPreview(file, 0, {\n    minimumTotal: "",\n    minimumLocalTotal: "",\n    fixedTotalAnd: true,\n    matchMode: "all",\n    productView: false,\n  }, { preserveFilters: false, productView: false });\n  const layout = await window.aroundG.beginSellerExcelVerification({\n    brandName,\n    fileName: file.name || file.path.split(/[\\\\/]/).pop() || "Excel",\n  });\n  if (!layout?.ok) throw new Error(layout?.message || "POIZON·Excel 검증 화면을 나란히 열지 못했습니다.");\n  const status = $("#excel-files-status");\n  if (status) {\n    status.className = "status";\n    status.textContent = \`검증 화면 열림 · 왼쪽 POIZON / 오른쪽 Excel · \${brandName}\`;\n  }\n  return layout;\n}\n\n$("#import-button").addEventListener("click", async () => {`;
  const result = replaceOnce(renderer, before, after, "visible verification helper");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

{
  const before = `        const excelSales = await downloadedBrandSalesByArticle(brand);\n        if (!excelSales.ok) throw new Error(excelSales.error || "EXCEL_READ_FAILED");\n        const sellerResult = await window.aroundG.captureSellerBrandSales({`;
  const after = `        const excelSales = await downloadedBrandSalesByArticle(brand);\n        if (!excelSales.ok) throw new Error(excelSales.error || "EXCEL_READ_FAILED");\n        await showPoizonExcelVerificationPair(file, brandName);\n        if (syncProgress) {\n          syncProgress.querySelector("span").textContent = \`검증 중 · 왼쪽 POIZON / 오른쪽 Excel · \${brandName}\`;\n          syncProgress.title = \`\${brandName} · POIZON 화면과 \${file?.name || "Excel"}을 동시에 비교합니다.\`;\n        }\n        const sellerResult = await window.aroundG.captureSellerBrandSales({`;
  const result = replaceOnce(renderer, before, after, "open pair before Seller Center capture");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

{
  const before = `        if (!excelSync?.ok) throw new Error(excelSync?.message || "원본 Excel에 POIZON 화면 값을 반영하지 못했습니다.");\n        updatedExcelRows += Number(excelSync.changedRows || 0);`;
  const after = `        if (!excelSync?.ok) throw new Error(excelSync?.message || "원본 Excel에 POIZON 화면 값을 반영하지 못했습니다.");\n        updatedExcelRows += Number(excelSync.changedRows || 0);\n        await showExcelPreview(file, 0, {\n          minimumTotal: "",\n          minimumLocalTotal: "",\n          fixedTotalAnd: true,\n          matchMode: "all",\n          productView: false,\n        }, { preserveFilters: true, productView: false });\n        if (syncProgress) {\n          syncProgress.classList.remove("error", "complete");\n          syncProgress.querySelector("span").textContent = \`\${brandName} 검증 완료 · POIZON 화면 값 우선 적용 · 일치 \${crossValidated.matchedExcelCount.toLocaleString("ko-KR")}행 · Excel 수정 \${Number(excelSync.changedRows || 0).toLocaleString("ko-KR")}행\`;\n          syncProgress.title = \`왼쪽 POIZON과 오른쪽 Excel 비교 완료 · \${file?.name || "Excel"}\`;\n        }\n        await new Promise((resolve) => setTimeout(resolve, 2_000));`;
  const result = replaceOnce(renderer, before, after, "refresh Excel after screen-authoritative sync");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

{
  const before = `      const brandName = downloadFileSyncState.brandName || progress.brandName || "브랜드";\n      if (loading) {\n        loading.hidden = false;\n        loading.querySelector("i").style.width = \`${percent}%\`;\n        loading.querySelector("span").textContent = \`전체 \${percent}% · \${brandName} \${page}/\${pages || "?"}페이지 · \${Number(progress.count || 0).toLocaleString("ko-KR")}개\`;\n        loading.title = \`\${brandName} 동기화 진행 중 · \${page}/\${pages || "?"}페이지 · \${Number(progress.count || 0).toLocaleString("ko-KR")}개 상품 확인\`;\n      }\n      if (status) {\n        status.className = "status";\n        status.textContent = \`\${brandName} 동기화 진행 중 · \${page}/\${pages || "?"}페이지 · \${Number(progress.count || 0).toLocaleString("ko-KR")}개 상품 확인\`;\n      }`;
  const after = `      const brandName = downloadFileSyncState.brandName || progress.brandName || "브랜드";\n      const fileName = downloadFileSyncState.fileName || "Excel";\n      if (loading) {\n        loading.hidden = false;\n        loading.querySelector("i").style.width = \`${percent}%\`;\n        loading.querySelector("span").textContent = \`전체 \${percent}% · 왼쪽 POIZON \${page}/\${pages || "?"}페이지 · 오른쪽 Excel \${fileName}\`;\n        loading.title = \`\${brandName} 교차 검증 중 · POIZON \${page}/\${pages || "?"}페이지 · \${Number(progress.count || 0).toLocaleString("ko-KR")}개 상품 · Excel \${fileName}\`;\n      }\n      if (status) {\n        status.className = "status";\n        status.textContent = \`\${brandName} 교차 검증 중 · 왼쪽 POIZON \${page}/\${pages || "?"}페이지 · 오른쪽 Excel \${fileName}\`;\n      }`;
  const result = replaceOnce(renderer, before, after, "visible left/right progress wording");
  renderer = result.source;
  rendererChanged ||= result.changed;
}

{
  const before = `  } finally {\n    downloadFileSyncActive = false;\n    button.disabled = false;\n    button.textContent = "다운로드 파일 동기화";\n  }\n});\n$("#export-button").addEventListener("click", async () => {`;
  const after = `  } finally {\n    await window.aroundG.endSellerExcelVerification().catch(() => {});\n    downloadFileSyncActive = false;\n    button.disabled = false;\n    button.textContent = "다운로드 파일 동기화";\n  }\n});\n$("#export-button").addEventListener("click", async () => {`;
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
