import { readFile, writeFile } from "node:fs/promises";

const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`internal-result patch target missing: ${label}`);
  return source.slice(0, index) + after + source.slice(index + before.length);
};

const mainPath = new URL("../main.mjs", import.meta.url);
let main = await readFile(mainPath, "utf8");
const externalHandler = `  ipcMain.handle("external:open", async (_event, url) => {
    return openExternalInChromeTab(url);
  });`;
const internalHandler = `${externalHandler}
  ipcMain.handle("domestic:open-result", async (_event, rawUrl) => {
    const target = new URL(String(rawUrl || ""));
    if (target.protocol !== "https:" || !/(?:^|\\.)(?:naver\\.com|ssg\\.com|lotteon\\.com)$/i.test(target.hostname)) {
      throw new Error("INVALID_DOMESTIC_RESULT_URL");
    }
    const existing = BrowserWindow.getAllWindows().find((candidate) => {
      if (candidate.isDestroyed()) return false;
      try {
        const current = new URL(String(candidate.webContents.getURL() || ""));
        return current.hostname === target.hostname && current.pathname === target.pathname && current.search === target.search;
      } catch { return false; }
    });
    if (existing) {
      existing.show();
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return { ok: true, reused: true };
    }
    const resultWindow = new BrowserWindow({
      title: "국내 상품 검색 결과 · Around G", width: 1480, height: 900, show: true,
      autoHideMenuBar: false, icon: APP_ICON_PATH,
      webPreferences: { partition: DOMESTIC_SEARCH_PARTITION, sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    resultWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\\/\\//i.test(String(url || ""))) resultWindow.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    await resultWindow.loadURL(target.href);
    resultWindow.show();
    resultWindow.focus();
    return { ok: true, reused: false };
  });`;
main = replaceOnce(main, externalHandler, internalHandler, "internal domestic result IPC");
await writeFile(mainPath, main, "utf8");

const preloadPath = new URL("../preload.cjs", import.meta.url);
let preload = await readFile(preloadPath, "utf8");
preload = replaceOnce(preload,
  '  openExternal: (url) => ipcRenderer.invoke("external:open", url),',
  '  openExternal: (url) => ipcRenderer.invoke("external:open", url),\n  openDomesticResult: (url) => ipcRenderer.invoke("domestic:open-result", url),',
  "preload bridge");
await writeFile(preloadPath, preload, "utf8");

const rendererPath = new URL("../src/renderer.js", import.meta.url);
let renderer = await readFile(rendererPath, "utf8");
renderer = replaceOnce(renderer,
  '      <div class="domestic-result-actions"><button class="domestic-result-open" data-url="${encodeURIComponent(product?.url || source.searchUrl)}">${sourcingLabel || "판매처 열기"}</button>${stockWatchRegistrationButton(product, sourceProduct)}</div>',
  '      <div class="domestic-result-actions"><button class="domestic-result-open" ${/(?:naver\\.com|ssg\\.com|lotteon\\.com)/i.test(String(product?.url || source.searchUrl || "")) ? `data-domestic-result-url="${encodeURIComponent(product?.url || source.searchUrl)}"` : `data-url="${encodeURIComponent(product?.url || source.searchUrl)}"`}>${sourcingLabel || "판매처 열기"}</button>${stockWatchRegistrationButton(product, sourceProduct)}</div>',
  "product result button");
renderer = replaceOnce(renderer,
  '    return `<button class="source-platform-action" type="button" data-url="${encodeURIComponent(openUrl)}">${label}</button>`;',
  '    if (/(?:naver\\.com|ssg\\.com|lotteon\\.com)/i.test(openUrl)) {\n      return `<button class="source-platform-action" type="button" data-domestic-result-url="${encodeURIComponent(openUrl)}">${label}</button>`;\n    }\n    return `<button class="source-platform-action" type="button" data-url="${encodeURIComponent(openUrl)}">${label}</button>`;',
  "source result button");
renderer = replaceOnce(renderer,
  '    await window.aroundG.openExternal(resolvedUrl);\n  }',
  '    await window.aroundG.openExternal(resolvedUrl);\n  }\n  const domesticResultButton = event.target.closest("[data-domestic-result-url]");\n  if (domesticResultButton) {\n    let resultUrl = domesticResultButton.dataset.domesticResultUrl;\n    try { resultUrl = decodeURIComponent(resultUrl); } catch {}\n    await window.aroundG.openDomesticResult(resultUrl);\n  }',
  "internal result click");
await writeFile(rendererPath, renderer, "utf8");

console.log("domestic marketplace result buttons now reuse the controlled browser window");
