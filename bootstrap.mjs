import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { readExcelColumnLayout } from "./services/excel-column-layout.mjs";

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

const [excelColumnLayoutSource, excelColumnLayoutCss, searchServiceMenuSource, searchServiceMenuCss] = await Promise.all([
  readFile(new URL("./src/excel-column-layout.js", import.meta.url), "utf8"),
  readFile(new URL("./src/excel-column-layout.css", import.meta.url), "utf8"),
  readFile(new URL("./src/search-service-menu.js", import.meta.url), "utf8"),
  readFile(new URL("./src/search-service-menu.css", import.meta.url), "utf8"),
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

function installRenderedProductCardFallback(window) {
  const contents = window?.webContents;
  if (!contents || contents.__aroundGProductCardFallbackInstalled) return;
  contents.__aroundGProductCardFallbackInstalled = true;

  const nativeExecuteJavaScript = contents.executeJavaScript.bind(contents);
  contents.executeJavaScript = async (code, userGesture) => {
    const source = String(code || "");
    const isRenderedProductCardLookup =
      source.includes('const links = [...document.querySelectorAll("a[href]")]')
      && source.includes('left.origin === right.origin && left.pathname === right.pathname')
      && source.includes('const expected = ');

    const originalResult = await nativeExecuteJavaScript(code, userGesture);
    if (!isRenderedProductCardLookup || originalResult) return originalResult;

    const isScrollLookup = source.includes('link.scrollIntoView({ block: "center", inline: "center" });');
    const isPointLookup = source.includes('Math.min(rect.height / 2, 180)');
    if (!isScrollLookup && !isPointLookup) return originalResult;

    const fallbackScript = `(() => {
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || 1) > 0
          && rect.width >= 60
          && rect.height >= 40
          && rect.bottom > 80
          && rect.top < innerHeight
          && rect.right > 0
          && rect.left < innerWidth;
      };
      const productLinkPattern = /window-products|\\/products?\\/|productId=|nvMid=|itemId=|goodsNo=/i;
      const candidates = [...document.querySelectorAll("a[href]")]
        .map((anchor) => {
          const image = anchor.querySelector("img, picture img")
            || anchor.closest("li, article, [class*='product' i], [class*='item' i]")?.querySelector("img, picture img");
          const card = anchor.closest("li, article, [class*='product' i], [class*='item' i]") || anchor;
          const rect = anchor.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          const imageRect = image?.getBoundingClientRect?.() || { width: 0, height: 0 };
          const text = String(card.innerText || anchor.innerText || "").trim();
          let score = 0;
          if (productLinkPattern.test(String(anchor.href || ""))) score += 1000;
          if (image && imageRect.width >= 70 && imageRect.height >= 70) score += 500;
          if (cardRect.width >= 120 && cardRect.height >= 100) score += 250;
          if (text.length >= 2 && text.length <= 1200) score += 100;
          if (cardRect.top >= 100) score += 80;
          score += Math.min(200, Math.round((imageRect.width * imageRect.height) / 500));
          return { anchor, card, rect, cardRect, image, score };
        })
        .filter((item) => visible(item.anchor) || visible(item.card))
        .filter((item) => item.image && item.score >= 700)
        .sort((left, right) => right.score - left.score || left.cardRect.top - right.cardRect.top);
      const selected = candidates[0];
      if (!selected) return ${isScrollLookup ? "false" : "null"};
      selected.anchor.scrollIntoView({ block: "center", inline: "center" });
      if (${isScrollLookup ? "true" : "false"}) return true;
      const rect = selected.anchor.getBoundingClientRect();
      const clickRect = rect.width > 0 && rect.height > 0 ? rect : selected.card.getBoundingClientRect();
      if (clickRect.width <= 0 || clickRect.height <= 0) return null;
      return {
        x: Math.round(clickRect.left + clickRect.width / 2),
        y: Math.round(clickRect.top + Math.min(clickRect.height / 2, 180)),
        fallback: true,
      };
    })()`;

    try {
      return await nativeExecuteJavaScript(fallbackScript, true);
    } catch (error) {
      console.error("Rendered product card fallback failed", error);
      return originalResult;
    }
  };
}

app.on("browser-window-created", (_event, window) => {
  installRenderedProductCardFallback(window);
  window.webContents.on("did-finish-load", async () => {
    const url = window.webContents.getURL();
    if (!/\/src\/index\.html(?:[?#]|$)/i.test(url)) return;
    try {
      await window.webContents.insertCSS(`${excelColumnLayoutCss}\n${searchServiceMenuCss}`);
      await window.webContents.executeJavaScript(excelColumnLayoutSource, true);
      await window.webContents.executeJavaScript(searchServiceMenuSource, true);
    } catch (error) {
      console.error("Renderer enhancement load failed", error);
    }
  });
});

await import("./main.mjs");
