import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, safeStorage, shell } from "electron";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import readXlsxFile from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import pkg from "electron-updater";
import { JsonStore } from "./services/store.mjs";
import { explorerMetadata, parsePopularProducts, queryExplorer } from "./services/poizon.mjs";
import { queryDomesticProducts } from "./relay/domestic-search.mjs";
import { scoreProductCandidate } from "./services/matcher.mjs";
import { parseSellerDomNodes } from "./services/seller-dom.mjs";
import { SELLER_POPULAR_CONDITIONS } from "./services/seller-conditions.mjs";

let store;
const { autoUpdater } = pkg;
nativeTheme.themeSource = "light";
let mainWindow;
let sellerWindow;
let updateReady = false;
const SELLER_CENTER_URL = "https://seller.poizon.com/main/dataCenter/merchantRankBoard";
const SELLER_CAPTURE_SCRIPT = `(async () => {
  const selector = "tr, [role='row'], li, [class*='row'], [class*='item'], [class*='product'], [class*='table']";
  const headings = [...document.querySelectorAll("h1, h2, h3, h4, strong, span, div")]
    .filter((element) => String(element.innerText || element.textContent || "").trim() === "인기상품");
  const scopes = [];
  for (const heading of headings) {
    let candidate = heading.parentElement;
    for (let depth = 0; candidate && depth < 12; depth += 1, candidate = candidate.parentElement) {
      const text = String(candidate.innerText || "");
      const hasTableHeaders = text.includes("SPU 기준")
        && text.includes("SKU 기준")
        && text.includes("상품정보")
        && /평균\\s*거래가/.test(text);
      if (hasTableHeaders) {
        const rowCount = candidate.querySelectorAll(selector).length;
        const articleCount = (text.match(/(?=[A-Z0-9._/-]{4,30}\\b)(?=[A-Z0-9._/-]*[A-Z])(?=[A-Z0-9._/-]*\\d)[A-Z0-9][A-Z0-9._/-]{3,29}/gi) || []).length;
        const priceCount = (text.match(/(?:\\d{1,3},)+\\d{3}/g) || []).length;
        if (rowCount >= 3 && articleCount >= 1 && priceCount >= 1) {
          scopes.push({ element: candidate, textLength: text.length, rowCount, articleCount, priceCount });
        }
      }
    }
  }
  scopes.sort((left, right) =>
    left.textLength - right.textLength
    || right.articleCount - left.articleCount
    || right.priceCount - left.priceCount
  );
  const scope = scopes[0]?.element;
  if (!scope) {
    return { text: "", title: document.title, url: location.href, nodes: [], scopeVerified: false };
  }
  const collected = new Map();
  const collectVisibleRows = () => {
    for (const element of scope.querySelectorAll(selector)) {
      const text = String(element.innerText || "").trim();
      if (!text || text.length > 3000) continue;
      const image = element.querySelector?.("img[src]");
      const imageUrl = image?.src || "";
      collected.set(text + "\\n" + imageUrl, { text, imageUrl });
    }
  };
  collectVisibleRows();
  const nodes = [...collected.values()].slice(0, 5000);
  return {
    text: nodes.map((node) => node.text).join("\\n").slice(0, 1000000),
    title: document.title,
    url: location.href,
    nodes,
    scopeVerified: true,
    scannedNodeCount: nodes.length
  };
})()`;
const SELLER_SCROLL_SCRIPT = `(() => {
  const root = document.scrollingElement || document.documentElement;
  const candidates = [root, ...document.querySelectorAll("div, section, main, article, [role='grid'], [role='table']")]
    .filter((element, index, all) => all.indexOf(element) === index)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      const visible = rect.width >= 280 && rect.height >= 160
        && rect.bottom > 0 && rect.top < innerHeight;
      const scrollStyle = /auto|scroll|overlay/i.test(style.overflowY);
      const text = String(element.innerText || "");
      const productTable = text.includes("SPU") && text.includes("SKU")
        && /상품정보|평균\\s*거래가/.test(text);
      const score = (productTable ? 1000000 : 0)
        + (scrollStyle ? 100000 : 0)
        + maximum
        + Math.min(rect.width * rect.height, 500000);
      return { element, maximum, visible, score };
    })
    .filter((candidate) => candidate.visible && candidate.maximum > 80)
    .sort((left, right) => right.score - left.score);
  const target = candidates[0];
  if (!target) return { found: false, moved: false, atEnd: true };
  const before = target.element.scrollTop;
  const step = Math.max(420, Math.floor(target.element.clientHeight * 0.82));
  target.element.scrollTop = Math.min(target.maximum, before + step);
  target.element.dispatchEvent(new Event("scroll", { bubbles: true }));
  const after = target.element.scrollTop;
  return {
    found: true,
    moved: after > before,
    atEnd: after >= target.maximum - 3,
    before,
    after,
    maximum: target.maximum
  };
})()`;
const sellerJumpScript = (rank, limit) => `(() => {
  const requestedRank = ${Number(rank)};
  const requestedLimit = ${Number(limit)};
  const root = document.scrollingElement || document.documentElement;
  const candidates = [root, ...document.querySelectorAll("div, section, main, article, [role='grid'], [role='table']")]
    .filter((element, index, all) => all.indexOf(element) === index)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      const text = String(element.innerText || "");
      const productTable = text.includes("SPU") && text.includes("SKU")
        && /상품정보|평균\\s*거래가/.test(text);
      const scrollStyle = /auto|scroll|overlay/i.test(style.overflowY);
      const visible = rect.width >= 280 && rect.height >= 160 && rect.bottom > 0 && rect.top < innerHeight;
      return {
        element,
        maximum,
        visible,
        score: (productTable ? 1000000 : 0) + (scrollStyle ? 100000 : 0) + maximum
      };
    })
    .filter((candidate) => candidate.visible && candidate.maximum > 80)
    .sort((left, right) => right.score - left.score);
  const target = candidates[0];
  if (!target) return { found: false };
  const ratio = Math.max(0, Math.min(1, (requestedRank - 1) / Math.max(1, requestedLimit - 1)));
  target.element.scrollTop = Math.round(target.maximum * ratio);
  target.element.dispatchEvent(new Event("scroll", { bubbles: true }));
  return { found: true, rank: requestedRank, position: target.element.scrollTop, maximum: target.maximum };
})()`;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function executeAcrossSellerFrames(script) {
  const mainFrame = sellerWindow.webContents.mainFrame;
  const frames = [mainFrame, ...(mainFrame.framesInSubtree || [])]
    .filter((frame, index, all) => all.findIndex((candidate) => candidate.routingId === frame.routingId) === index);
  for (const frame of frames) {
    try {
      const result = await frame.executeJavaScript(script, true);
      if (result?.found) return result;
    } catch {
      // 접근할 수 없는 외부 프레임은 건너뜁니다.
    }
  }
  return { found: false };
}

async function applySellerPopularConditions() {
  const results = [];
  for (const condition of SELLER_POPULAR_CONDITIONS) {
    const script = `(() => {
      const label = ${JSON.stringify(condition.label)};
      const action = ${JSON.stringify(condition.action)};
      if (action === "fullscreen") {
        const headings = [...document.querySelectorAll("h1, h2, h3, h4, strong, span, div")]
          .filter((element) => String(element.innerText || element.textContent || "").trim() === "인기상품");
        const panels = [];
        for (const heading of headings) {
          let panel = heading.parentElement;
          for (let depth = 0; panel && depth < 10; depth += 1, panel = panel.parentElement) {
            const text = String(panel.innerText || "");
            const controls = [...panel.querySelectorAll("button, [role='button'], svg, i, [class*='icon']")]
              .filter((control) => {
                const rect = control.getBoundingClientRect();
                return rect.width >= 8 && rect.height >= 8 && rect.width <= 64 && rect.height <= 64;
              });
            if (text.includes("SPU 기준") && text.includes("SKU 기준") && text.includes("상품정보") && controls.length >= 1) {
              panels.push({ panel, controls, heading, textLength: text.length });
            }
          }
        }
        panels.sort((left, right) => left.textLength - right.textLength);
        const match = panels[0];
        if (!match) return { found: false, label };
        const rect = match.panel.getBoundingClientRect();
        const alreadyFullscreen = rect.width >= window.innerWidth * 0.82 && rect.height >= window.innerHeight * 0.72;
        if (alreadyFullscreen) return { found: true, selected: true, alreadySelected: true, label };
        const headingRect = match.heading.getBoundingClientRect();
        const point = {
          x: Math.max(0, Math.floor(rect.right - 18)),
          y: Math.max(0, Math.floor((headingRect.top + headingRect.bottom) / 2)),
        };
        const target = document.elementFromPoint(point.x, point.y);
        return {
          found: Boolean(target),
          selected: false,
          requiresNativeClick: true,
          x: point.x,
          y: point.y,
          targetTag: target?.tagName || "",
          targetClass: String(target?.className?.baseVal || target?.className || "").slice(0, 120),
          label
        };
      }
      const elements = [...document.querySelectorAll("label, button, [role='radio'], [role='checkbox'], [role='tab'], span, div, h1, h2, h3, h4")]
        .filter((element) => String(element.innerText || element.textContent || "").trim() === label)
        .sort((left, right) => String(left.innerText || "").length - String(right.innerText || "").length);
      const ranked = elements.map((element) => {
        const control = element.matches("label,button,[role='radio'],[role='checkbox'],[role='tab']")
          ? element
          : element.closest("label,button,[role='radio'],[role='checkbox'],[role='tab']");
        const input = control?.querySelector?.("input") || (control?.matches?.("input") ? control : null);
        return { element, control, input, interactive: Boolean(control || input) };
      }).sort((left, right) => Number(right.interactive) - Number(left.interactive));
      const target = ranked[0];
      if (!target) return { found: false, label };
      if (action === "scroll") {
        target.element.scrollIntoView({ block: "center", behavior: "auto" });
        return { found: true, selected: true, label };
      }
      const selected = Boolean(
        target.input?.checked
        || target.control?.getAttribute?.("aria-checked") === "true"
        || target.control?.getAttribute?.("aria-selected") === "true"
        || /active|selected|checked/i.test(String(target.control?.className || ""))
      );
      if (!selected) (target.control || target.element).click();
      return { found: true, selected: true, alreadySelected: selected, label };
    })()`;
    let result = await executeAcrossSellerFrames(script);
    if (condition.action === "fullscreen" && result.found && result.requiresNativeClick) {
      sellerWindow.show();
      sellerWindow.focus();
      sellerWindow.webContents.sendInputEvent({ type: "mouseMove", x: result.x, y: result.y });
      sellerWindow.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x: result.x, y: result.y });
      await wait(120);
      sellerWindow.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: result.x, y: result.y });
    }
    if (condition.action === "fullscreen" && result.found) {
      await wait(1_200);
      const verified = await executeAcrossSellerFrames(`(() => {
        const headings = [...document.querySelectorAll("h1, h2, h3, h4, strong, span, div")]
          .filter((element) => String(element.innerText || element.textContent || "").trim() === "인기상품");
        for (const heading of headings) {
          let panel = heading.parentElement;
          for (let depth = 0; panel && depth < 10; depth += 1, panel = panel.parentElement) {
            const text = String(panel.innerText || "");
            const rect = panel.getBoundingClientRect();
            if (text.includes("SPU 기준") && text.includes("SKU 기준")
              && rect.width >= window.innerWidth * 0.82 && rect.height >= window.innerHeight * 0.72) {
              return { found: true, expanded: true };
            }
          }
        }
        return { found: false, expanded: false };
      })()`);
      result = { ...result, found: verified.found, expanded: verified.expanded };
    }
    results.push({ ...condition, ...result });
    await wait(condition.action === "fullscreen" ? 1_800 : condition.action === "scroll" ? 250 : 650);
  }
  await wait(1_800);
  return results;
}

async function imageFingerprint(url) {
  if (!url) return null;
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol)) return null;
  const response = await fetch(parsed.href, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) return null;
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 5_000_000) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5_000_000) return null;
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;
  const bitmap = image.resize({ width: 8, height: 8, quality: "good" }).toBitmap();
  const values = [];
  for (let index = 0; index + 3 < bitmap.length; index += 4) {
    values.push((bitmap[index] + bitmap[index + 1] + bitmap[index + 2]) / 3);
  }
  if (!values.length) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.map((value) => value >= average);
}

function fingerprintSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return null;
  const same = left.filter((value, index) => value === right[index]).length;
  return same / left.length;
}

async function addMatchConfidence(data, input) {
  const source = {
    articleNumber: String(input.articleNumber || ""),
    brand: String(input.brand || ""),
    title: String(input.title || ""),
  };
  let products = data.products.map((product) => ({
    ...product,
    ...scoreProductCandidate(source, product),
  }));
  const sourceFingerprint = await imageFingerprint(input.imageUrl).catch(() => null);
  if (sourceFingerprint) {
    const bestByStore = new Map();
    products.forEach((product, index) => {
      const previous = bestByStore.get(product.store);
      if (!previous || product.confidence > previous.confidence) bestByStore.set(product.store, { index, confidence: product.confidence });
    });
    await Promise.all([...bestByStore.values()].map(async ({ index }) => {
      const candidateFingerprint = await imageFingerprint(products[index].imageUrl).catch(() => null);
      const imageSimilarity = fingerprintSimilarity(sourceFingerprint, candidateFingerprint);
      products[index] = { ...products[index], ...scoreProductCandidate(source, products[index], imageSimilarity) };
    }));
  }
  const priorities = new Map(data.sources.map((sourceRow) => [sourceRow.store, sourceRow.priority]));
  products = products.sort((left, right) =>
    (priorities.get(left.store) || 99) - (priorities.get(right.store) || 99)
    || right.confidence - left.confidence
  );
  return { ...data, products };
}

// 이 앱은 GPU 가속이 필요하지 않으며 일부 Windows 그래픽 드라이버의
// GPU 프로세스 반복 종료를 피하기 위해 소프트웨어 렌더링을 사용합니다.
app.disableHardwareAcceleration();

function sendUpdateStatus(status, message, extra = {}) {
  mainWindow?.webContents.send("update:status", { status, message, ...extra });
}

function configureUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking", "새 버전을 확인하고 있습니다."));
  autoUpdater.on("update-available", (info) => sendUpdateStatus("available", `새 버전 ${info.version}을 다운로드할 수 있습니다.`, {
    version: info.version,
    releaseDate: info.releaseDate || ""
  }));
  autoUpdater.on("update-not-available", () => sendUpdateStatus("current", "현재 최신 버전입니다."));
  autoUpdater.on("download-progress", (info) => sendUpdateStatus("downloading", `업데이트 다운로드 ${Math.round(info.percent)}%`, { percent: info.percent }));
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    sendUpdateStatus("downloaded", `버전 ${info.version} 다운로드가 완료되었습니다.`, {
      version: info.version,
      releaseDate: info.releaseDate || ""
    });
    setTimeout(() => {
      if (updateReady) autoUpdater.quitAndInstall(true, true);
    }, 3_000);
  });
  autoUpdater.on("error", (error) => sendUpdateStatus("error", `업데이트 확인 실패: ${error.message}`));
}

function encrypted(value) {
  if (!value) return "";
  if (!safeStorage.isEncryptionAvailable()) throw new Error("WINDOWS_ENCRYPTION_UNAVAILABLE");
  return safeStorage.encryptString(value).toString("base64");
}

function decrypted(value) {
  if (!value) return "";
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

function publicConfig() {
  const settings = store.snapshot().settings;
  return {
    appKey: settings.appKey || "",
    apiBaseUrl: settings.apiBaseUrl || "https://open.poizon.com",
    hasAppSecret: Boolean(settings.appSecretEncrypted),
    hasAccessToken: Boolean(settings.accessTokenEncrypted)
  };
}

function secretConfig() {
  const settings = store.snapshot().settings;
  return {
    appKey: settings.appKey || "",
    appSecret: decrypted(settings.appSecretEncrypted),
    accessToken: decrypted(settings.accessTokenEncrypted),
    apiBaseUrl: settings.apiBaseUrl || "https://open.poizon.com"
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: "#f4f1ea",
    title: "Around G POIZON",
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = win;
  win.webContents.on("render-process-gone", (_event, details) => {
    const logLine = `${new Date().toISOString()} renderer-process-gone ${details.reason} exitCode=${details.exitCode}\n`;
    appendFile(join(app.getPath("userData"), "around-g-crash.log"), logLine, "utf8").catch(() => {});
    if (!win.isDestroyed() && details.reason !== "clean-exit") setTimeout(() => win.reload(), 800);
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.loadFile(join(import.meta.dirname, "src", "index.html"));
}

function openSellerCenterWindow() {
  if (sellerWindow && !sellerWindow.isDestroyed()) {
    sellerWindow.show();
    sellerWindow.focus();
    return;
  }
  sellerWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1000,
    minHeight: 700,
    title: "POIZON 판매자센터 · Around G 직접 연결",
    backgroundColor: "#ffffff",
    webPreferences: {
      partition: "persist:around-g-poizon-seller",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  sellerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  sellerWindow.on("closed", () => {
    sellerWindow = null;
  });
  sellerWindow.loadURL(SELLER_CENTER_URL);
}

async function captureSellerCenterProducts() {
  if (!sellerWindow || sellerWindow.isDestroyed()) {
    mainWindow?.webContents.send("seller:capture-progress", { percent: 2, count: 0, message: "판매자센터를 여는 중" });
    openSellerCenterWindow();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(500);
      if (sellerWindow && !sellerWindow.isDestroyed() && sellerWindow.webContents.getURL()) break;
    }
    if (!sellerWindow || sellerWindow.isDestroyed()) {
      return { ok: false, message: "판매자센터 창을 열지 못했습니다." };
    }
  }
  mainWindow?.webContents.send("seller:capture-progress", { percent: 5, count: 0, message: "로그인 세션 확인 중" });
  let currentUrl = sellerWindow.webContents.getURL();
  for (let attempt = 0; attempt < 20 && !currentUrl; attempt += 1) {
    await wait(500);
    currentUrl = sellerWindow.webContents.getURL();
  }
  if (!currentUrl.startsWith("https://seller.poizon.com/")) {
    return { ok: false, message: "판매자센터 인기상품 화면으로 이동해 주세요." };
  }
  if (!currentUrl.includes("/main/dataCenter/merchantRankBoard")) {
    await sellerWindow.loadURL(SELLER_CENTER_URL);
    await wait(1_800);
    currentUrl = sellerWindow.webContents.getURL();
    if (!currentUrl.includes("/main/dataCenter/merchantRankBoard")) {
      return { ok: false, message: "판매자센터 로그인을 완료해 주세요. 로그인 세션은 다음 실행부터 자동으로 유지됩니다." };
    }
  }
  sellerWindow.maximize();
  sellerWindow.show();
  sellerWindow.focus();
  await wait(700);
  const conditionResults = await applySellerPopularConditions();
  mainWindow?.webContents.send("seller:capture-progress", { percent: 12, count: 0, message: "인기상품 조건 적용 완료" });
  const fullscreenCondition = conditionResults.find((condition) => condition.key === "fullscreen");
  if (!fullscreenCondition?.found) {
    return {
      ok: false,
      message: `인기상품 전체화면 버튼을 누르지 못했습니다. 잘못된 9개 목록은 저장하지 않습니다.${fullscreenCondition?.x !== undefined ? ` 클릭 좌표 (${fullscreenCondition.x}, ${fullscreenCondition.y}), 대상 ${fullscreenCondition.targetTag || "없음"}` : ""}`,
      conditions: conditionResults,
    };
  }
  const frames = [sellerWindow.webContents.mainFrame, ...(sellerWindow.webContents.mainFrame.framesInSubtree || [])]
    .filter((frame, index, all) => all.findIndex((candidate) => candidate.routingId === frame.routingId) === index);
  const captures = [];
  const limit = Math.min(Number(store.snapshot().settings.popularLimit || 200), 200);
  const capturedNodes = new Map();
  const rankSlots = new Map();
  const articleSlots = new Map();
  const addNodesToSlots = (nodes) => {
    for (const product of parseSellerDomNodes(nodes, limit)) {
      const rank = Number(product.rank || 0);
      const articleNumber = String(product.articleNumber || "").toUpperCase();
      if (!product.rankDetected || rank < 1 || rank > limit || !articleNumber) continue;
      const previousRank = articleSlots.get(articleNumber);
      if (previousRank && previousRank !== rank) {
        if (previousRank < rank) continue;
        rankSlots.delete(previousRank);
      }
      rankSlots.set(rank, product);
      articleSlots.set(articleNumber, rank);
    }
  };
  const validProductCount = () => rankSlots.size;
  sellerWindow.show();
  sellerWindow.focus();
  const bounds = sellerWindow.getContentBounds();
  let inputPoint = { x: Math.floor(bounds.width * 0.55), y: Math.floor(bounds.height * 0.55) };
  sellerWindow.webContents.sendInputEvent({ type: "mouseMove", ...inputPoint });
  sellerWindow.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...inputPoint });
  sellerWindow.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...inputPoint });
  sellerWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "HOME" });
  sellerWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "HOME" });
  await wait(700);
  let stableRounds = 0;
  let previousCount = 0;
  for (let page = 0; page < 180; page += 1) {
    for (const frame of frames) {
      try {
        const captured = await frame.executeJavaScript(SELLER_CAPTURE_SCRIPT, true);
        if (!captured?.scopeVerified) continue;
        captures.push(captured);
        for (const node of captured.nodes || []) {
          capturedNodes.set(`${String(node.text || "")}\n${String(node.imageUrl || "")}`, node);
        }
        addNodesToSlots(captured.nodes || []);
      } catch {
        // 접근할 수 없는 광고/보안 프레임은 건너뜁니다.
      }
    }
    const currentCount = validProductCount();
    mainWindow?.webContents.send("seller:capture-progress", {
      percent: Math.min(96, Math.max(12, Math.round(12 + (currentCount / limit) * 84))),
      count: currentCount,
      target: limit,
      message: `인기상품 ${currentCount}/${limit}개 읽는 중`,
    });
    if (currentCount >= limit) break;
    stableRounds = currentCount === previousCount ? stableRounds + 1 : 0;
    previousCount = currentCount;
    const domScroll = await executeAcrossSellerFrames(SELLER_SCROLL_SCRIPT);
    if (stableRounds > 0 && stableRounds % 5 === 0) {
      inputPoint = { x: Math.floor(bounds.width * 0.82), y: Math.floor(bounds.height * 0.55) };
      sellerWindow.webContents.sendInputEvent({ type: "mouseMove", ...inputPoint });
      sellerWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "PAGEDOWN" });
      sellerWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "PAGEDOWN" });
    }
    if (stableRounds > 0 && stableRounds % 15 === 0) {
      sellerWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "END" });
      sellerWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "END" });
    }
    for (let wheel = 0; wheel < 3; wheel += 1) {
      sellerWindow.webContents.sendInputEvent({
        type: "mouseWheel",
        deltaX: 0,
        deltaY: domScroll?.moved ? 260 : 720,
        canScroll: true,
        ...inputPoint,
      });
      await wait(90);
    }
    await wait(domScroll?.moved ? 520 : 380);
  }
  for (let retryRound = 0; retryRound < 3 && rankSlots.size < limit; retryRound += 1) {
    const missingRanks = Array.from({ length: limit }, (_value, index) => index + 1)
      .filter((rank) => !rankSlots.has(rank));
    for (const rank of missingRanks) {
      await executeAcrossSellerFrames(sellerJumpScript(rank, limit));
      await wait(520 + retryRound * 180);
      for (const frame of frames) {
        try {
          const captured = await frame.executeJavaScript(SELLER_CAPTURE_SCRIPT, true);
          if (!captured?.scopeVerified) continue;
          captures.push(captured);
          for (const node of captured.nodes || []) {
            capturedNodes.set(`${String(node.text || "")}\n${String(node.imageUrl || "")}`, node);
          }
          addNodesToSlots(captured.nodes || []);
        } catch {
          // 접근할 수 없는 광고/보안 프레임은 건너뜁니다.
        }
      }
      mainWindow?.webContents.send("seller:capture-progress", {
        percent: Math.min(99, Math.round(12 + (rankSlots.size / limit) * 87)),
        count: rankSlots.size,
        target: limit,
        missing: limit - rankSlots.size,
        message: `누락 순위 재수집 ${rankSlots.size}/${limit}개`,
      });
      if (rankSlots.size >= limit) break;
    }
  }
  if (!captures.length) {
    return {
      ok: false,
      message: "판매자센터의 ‘인기상품’ 표 영역을 확인하지 못했습니다. ‘인기상품’ 제목과 SPU/SKU 기준이 함께 보이는 상태에서 다시 눌러 주세요.",
    };
  }
  let products = [];
  for (const captured of captures) {
    const parsed = parsePopularProducts({ text: captured.text });
    if (parsed.ok && parsed.products.length > products.length) products = parsed.products;
  }
  if (!products.length && captures.length > 1) {
    const combined = parsePopularProducts({ text: captures.map((capture) => capture.text).join("\n") });
    if (combined.ok) products = combined.products;
  }
  const nodes = [...capturedNodes.values()];
  const nodeProducts = parseSellerDomNodes(nodes, limit);
  if (nodeProducts.length > products.length) products = nodeProducts;
  const slotProducts = [...rankSlots.values()].sort((left, right) => left.rank - right.rank);
  if (slotProducts.length > products.length) products = slotProducts;
  const validProducts = products.filter((product) => {
    const articleNumber = String(product.articleNumber || "").trim();
    const name = String(product.name || "").trim();
    const hasRealArticle = /^(?=[A-Z0-9._/-]{4,30}$)(?=[A-Z0-9._/-]*[A-Z])(?=[A-Z0-9._/-]*\d)[A-Z0-9][A-Z0-9._/-]{3,29}$/i.test(articleNumber);
    const isHeader = /^(?:SPU 기준|SKU 기준|SPU 기준 SKU 기준|상품정보|평균 거래가(?:\\(KRW\\))?)$/i.test(name);
    return hasRealArticle && !isHeader && Number(product.averagePrice || 0) >= 1_000;
  });
  if (!validProducts.length) {
    const frameSummary = captures.map((capture) => `${capture.title || "frame"}:${capture.text.length}`).join(", ");
    return {
      ok: false,
      message: `인기상품 표는 확인했지만 실제 품번과 가격이 있는 상품 행을 찾지 못했습니다. 표의 1위 상품 행이 보이도록 스크롤한 뒤 다시 눌러 주세요.${frameSummary ? ` (확인한 화면 ${captures.length}개)` : ""}`,
    };
  }
  const preservedSlots = new Map();
  const preservedArticles = new Set();
  for (const product of validProducts.sort((left, right) => Number(left.rank) - Number(right.rank))) {
    const rank = Number(product.rank || 0);
    const articleNumber = String(product.articleNumber || "").toUpperCase();
    if (rank < 1 || rank > limit || preservedSlots.has(rank) || preservedArticles.has(articleNumber)) continue;
    preservedSlots.set(rank, { ...product, articleNumber });
    preservedArticles.add(articleNumber);
  }
  products = Array.from({ length: limit }, (_value, index) => {
    const rank = index + 1;
    return preservedSlots.get(rank) || {
      rank,
      articleNumber: "",
      name: `${rank}번 상품 수집 누락`,
      averagePrice: 0,
      lowestPrice: 0,
      highestPrice: 0,
      sales30d: 0,
      source: "seller-center-missing-slot",
      missingRank: true,
      sellerCenterDirect: true,
    };
  });
  mainWindow?.webContents.send("seller:capture-progress", {
    percent: 100,
    count: preservedSlots.size,
    target: limit,
    missing: limit - preservedSlots.size,
    message: `1~${limit}번 순위 유지 · 상품 ${preservedSlots.size}개 · 누락 ${limit - preservedSlots.size}개`,
  });
  const codes = products.map((product) => product.articleNumber).filter(Boolean);
  const imageMap = {};
  for (const code of codes) {
    const matchingNode = nodes
      .filter((node) => node.imageUrl && String(node.text || "").includes(code))
      .sort((left, right) => String(left.text || "").length - String(right.text || "").length)[0];
    if (matchingNode) imageMap[code] = matchingNode.imageUrl;
  }
  return {
    ok: true,
    source: "seller-center-direct",
    capturedAt: new Date().toISOString(),
    pageUrl: currentUrl,
    conditions: conditionResults,
    products: products.map((product) => ({
      ...product,
      logoUrl: imageMap[product.articleNumber] || "",
      sellerCenterDirect: true,
      apiMatched: undefined,
    })),
  };
}

app.whenReady().then(async () => {
  store = new JsonStore(app.getPath("userData"));
  await store.load();

  ipcMain.handle("store:snapshot", () => store.snapshot());
  ipcMain.handle("store:upsert", (_event, collection, item) => store.upsert(collection, item));
  ipcMain.handle("store:bulk-upsert", (_event, collection, items) => store.bulkUpsert(collection, items));
  ipcMain.handle("store:remove", (_event, collection, id) => store.remove(collection, id));
  ipcMain.handle("collector:check", (_event, input) => store.updateCollector(input));
  ipcMain.handle("update:check", async () => {
    if (!app.isPackaged) return { ok: false, message: "개발 모드에서는 업데이트를 확인하지 않습니다." };
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.updateInfo?.version) return { ok: true, version: result.updateInfo.version };
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("update:install", async () => {
    try {
      if (!autoUpdater.updateInfoAndProvider) {
        const result = await autoUpdater.checkForUpdates();
        if (!result?.isUpdateAvailable) return { ok: false, message: "설치할 새 버전이 없습니다." };
      }
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("update:restart", () => {
    if (!updateReady) return { ok: false, message: "설치할 업데이트 다운로드가 완료되지 않았습니다." };
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return { ok: true };
  });
  ipcMain.handle("config:get", () => publicConfig());
  ipcMain.handle("config:save", async (_event, config) => {
    const next = {
      appKey: String(config.appKey || "").trim(),
      apiBaseUrl: String(config.apiBaseUrl || "https://open.poizon.com").trim()
    };
    if (config.appSecret) next.appSecretEncrypted = encrypted(config.appSecret);
    if (config.accessToken) next.accessTokenEncrypted = encrypted(config.accessToken);
    await store.setSettings(next);
    return publicConfig();
  });
  ipcMain.handle("explorer:meta", () => explorerMetadata());
  ipcMain.handle("seller:open", () => {
    openSellerCenterWindow();
    return { ok: true };
  });
  ipcMain.handle("seller:capture", () => captureSellerCenterProducts());
  ipcMain.handle("popular:workflow-get", () => {
    const settings = store.snapshot().settings;
    return {
      period: settings.popularPeriod || "week",
      compare: settings.popularCompare || "week",
      unit: settings.popularUnit || "SPU",
      limit: Number(settings.popularLimit || 200),
      reminder: settings.popularReminder !== false,
      lastSyncAt: settings.popularLastSyncAt || "",
    };
  });
  ipcMain.handle("popular:workflow-save", async (_event, input) => {
    const allowed = {
      period: new Set(["day", "week", "month", "quarter"]),
      compare: new Set(["none", "year", "day", "week", "month"]),
      unit: new Set(["SPU", "SKU"]),
      limit: new Set([10, 30, 50, 100, 200]),
    };
    const next = {
      popularPeriod: allowed.period.has(input.period) ? input.period : "week",
      popularCompare: allowed.compare.has(input.compare) ? input.compare : "week",
      popularUnit: allowed.unit.has(input.unit) ? input.unit : "SPU",
      popularLimit: allowed.limit.has(Number(input.limit)) ? Number(input.limit) : 200,
      popularReminder: input.reminder !== false,
    };
    if (input.markSynced) next.popularLastSyncAt = new Date().toISOString();
    await store.setSettings(next);
    return {
      period: next.popularPeriod,
      compare: next.popularCompare,
      unit: next.popularUnit,
      limit: next.popularLimit,
      reminder: next.popularReminder,
      lastSyncAt: next.popularLastSyncAt || store.snapshot().settings.popularLastSyncAt || "",
    };
  });
  ipcMain.handle("domestic:search", async (_event, input) => {
    try {
      const data = await queryDomesticProducts({
        query: String(input?.query || "").trim(),
        articleNumber: String(input?.articleNumber || "").trim(),
        brand: String(input?.brand || "").trim(),
        title: String(input?.title || "").trim(),
      });
      return { ok: true, data: await addMatchConfidence(data, input || {}) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("explorer:query", (_event, input) => queryExplorer(secretConfig(), input));
  ipcMain.handle("external:open", async (_event, url) => {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("INVALID_URL");
    await shell.openExternal(parsed.href);
  });
  ipcMain.handle("excel:import", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Excel", extensions: ["xlsx"] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const sheet = await readXlsxFile(await readFile(filePath));
    const headers = (sheet[0] || []).map((value) => String(value || "").trim());
    const rows = sheet.slice(1).map((values) => Object.fromEntries(
      headers.flatMap((header, index) => header ? [[header, values[index] ?? ""]] : [])
    ));
    let imported = 0;
    for (const row of rows) {
      const articleNumber = String(row["상품번호"] || row.articleNumber || row["품번"] || "").trim();
      const name = String(row["상품명"] || row.name || "").trim();
      if (!articleNumber && !name) continue;
      await store.upsert("products", {
        articleNumber,
        name,
        brand: String(row["브랜드"] || row.brand || ""),
        spuId: String(row["SPU ID"] || row.spuId || ""),
        poizonPrice: Number(row["POIZON 가격"] || row.poizonPrice || 0),
        domesticPrice: Number(row["국내 가격"] || row.domesticPrice || 0),
        source: "excel"
      });
      imported += 1;
    }
    return { canceled: false, imported };
  });
  ipcMain.handle("excel:export", async () => {
    const result = await dialog.showSaveDialog({ defaultPath: `Around-G-${new Date().toISOString().slice(0, 10)}.xlsx`, filters: [{ name: "Excel", extensions: ["xlsx"] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const data = store.snapshot();
    const sheets = [];
    for (const [name, rows] of [["상품", data.products], ["장부", data.ledger], ["주문", data.orders], ["관심상품", data.favorites]]) {
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const cells = [
        columns.map((value) => ({ value, fontWeight: "bold", backgroundColor: "#EAE4D8" })),
        ...rows.map((row) => columns.map((key) => {
          const raw = row[key];
          const value = raw instanceof Date || ["string", "number", "boolean"].includes(typeof raw)
            ? raw
            : raw === null || raw === undefined ? null : JSON.stringify(raw);
          return { value };
        })),
      ];
      sheets.push({
        data: cells,
        sheet: name,
        stickyRowsCount: 1,
        columns: columns.map((key) => ({ width: Math.max(12, Math.min(36, key.length + 4)) })),
      });
    }
    await writeXlsxFile(sheets).toFile(result.filePath);
    return { canceled: false, path: result.filePath };
  });

  configureUpdater();
  createWindow();
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
