import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { readExcelColumnLayout } from "./services/excel-column-layout.mjs";

// Single startup/bootstrap layer only. Product search, Naver card selection,
// physical mouse movement, detail navigation, and stock collection are owned
// exclusively by main.mjs. Do not intercept webContents.executeJavaScript here.
const nativeIpcHandle = ipcMain.handle.bind(ipcMain);
let pendingBrandResumeDecision = "unasked";

ipcMain.handle = (channel, listener) => {
  if (channel !== "brand-export:pending-jobs") return nativeIpcHandle(channel, listener);
  return nativeIpcHandle(channel, async (event, ...args) => {
    const jobs = await listener(event, ...args);
    const pending = Array.isArray(jobs)
      ? jobs.filter((job) => String(job?.jobId || "").trim() && String(job?.brandName || "").trim())
      : [];
    if (!pending.length) return jobs;
    if (pendingBrandResumeDecision === "unasked") {
      const visibleJobs = pending.slice(0, 8).map((job) =>
        `• ${String(job.brandName).trim()} · 작업번호 ${String(job.jobId).trim()}`
      );
      if (pending.length > visibleJobs.length) {
        visibleJobs.push(`• 그 외 ${pending.length - visibleJobs.length}개 작업`);
      }
      const options = {
        type: "question",
        title: "이전 미다운로드 작업",
        message: `미다운로드 작업 ${pending.length}개가 있습니다.`,
        detail: `${visibleJobs.join("\n")}\n\n이전 작업의 다운로드 감시를 다시 시작할까요?\n‘나중에’를 선택하면 이번 실행에서는 재개하지 않아 업데이트를 먼저 설치할 수 있습니다. 미다운로드 작업 기록은 삭제되지 않습니다.`,
        buttons: ["작업 재개", "나중에"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const parent = BrowserWindow.fromWebContents(event.sender);
      const result = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      pendingBrandResumeDecision = result.response === 0 ? "resume" : "later";
    }
    return pendingBrandResumeDecision === "resume" ? jobs : [];
  });
};

const [
  excelColumnLayoutSource,
  excelColumnLayoutCss,
  searchServiceMenuSource,
  searchServiceMenuCss,
  sourcingViewSource,
  domesticResultVerdictSource,
  domesticInlineResultsSource,
  domesticInlineResultsCss,
] = await Promise.all([
  readFile(new URL("./src/excel-column-layout.js", import.meta.url), "utf8"),
  readFile(new URL("./src/excel-column-layout.css", import.meta.url), "utf8"),
  readFile(new URL("./src/search-service-menu.js", import.meta.url), "utf8"),
  readFile(new URL("./src/search-service-menu.css", import.meta.url), "utf8"),
  readFile(new URL("./src/sourcing-view.js", import.meta.url), "utf8"),
  readFile(new URL("./src/domestic-result-verdict.js", import.meta.url), "utf8"),
  readFile(new URL("./src/domestic-inline-results.js", import.meta.url), "utf8"),
  readFile(new URL("./src/domestic-inline-results.css", import.meta.url), "utf8"),
]);

function excelPath(input = {}) {
  const filePath = String(input?.path || "").trim();
  if (!filePath) throw new Error("파일 경로가 없습니다.");
  if (!/\.xlsx$/i.test(filePath)) throw new Error("Excel(.xlsx) 파일만 수정할 수 있습니다.");
  return filePath;
}

ipcMain.handle("excel:get-column-layout", async (_event, input = {}) => {
  try {
    const filePath = excelPath(input);
    const buffer = await readFile(filePath);
    return {
      ok: true,
      path: filePath,
      columnLayout: readExcelColumnLayout(buffer, Number(input.columnCount) || 256),
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("excel:update-column-layout", async (_event, input = {}) => {
  try {
    const filePath = excelPath(input);
    return {
      ok: true,
      path: filePath,
      columnLayout: Array.isArray(input.columnLayout) ? input.columnLayout : [],
      displayOnly: true,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
});

app.on("browser-window-created", (_event, window) => {
  window.webContents.on("did-finish-load", async () => {
    const url = window.webContents.getURL();
    if (!/\/src\/index\.html(?:[?#]|$)/i.test(url)) return;
    try {
      await window.webContents.insertCSS(`${excelColumnLayoutCss}\n${searchServiceMenuCss}\n${domesticInlineResultsCss}`);
      await window.webContents.executeJavaScript(excelColumnLayoutSource, true);
      await window.webContents.executeJavaScript(searchServiceMenuSource, true);
      await window.webContents.executeJavaScript(domesticResultVerdictSource, true);
      await window.webContents.executeJavaScript(sourcingViewSource, true);
      // Load the rightmost-cell retailer list from its canonical source. Build
      // installation no longer injects a second copy into sourcing-view.js.
      await window.webContents.executeJavaScript(domesticInlineResultsSource, true);
    } catch (error) {
      console.error("Renderer enhancement load failed", error);
    }
  });
});

await import("./main.mjs");
