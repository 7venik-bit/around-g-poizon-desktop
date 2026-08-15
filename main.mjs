import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, nativeTheme, Notification, safeStorage, shell } from "electron";
import { mkdirSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { readSheet } from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import { readFirstDataSheet } from "./services/excel-reader.mjs";
import {
  findPoizonColumn,
  getPoizonWorksheetRows,
  summarizePoizonRows,
  readPoizonColumnValues,
  repairPoizonWorksheetDimensions,
} from "./services/poizon-xlsx.mjs";
import {
  filterPoizonPreviewRows,
  filterPoizonRowsByTotalSales,
  parsePoizonSalesMetric,
  POIZON_MINIMUM_TOTAL_SALES,
} from "./services/poizon-sales-filter.mjs";
import {
  analyzeBrandMatch,
  analyzeBrandValues,
  brandExportLabel,
  brandMismatchMessage,
  brandsMatch,
} from "./services/brand-integrity.mjs";
import {
  createPopularSlots,
  excelRowsToPopularProducts,
  popularSlotsToExcelData,
} from "./services/popular-excel.mjs";
import pkg from "electron-updater";
import { JsonStore } from "./services/store.mjs";
import {
  FULL_BRAND_CATALOG_MINIMUM,
  brandCatalogNeedsSync,
  mergeLocalizedBrandCatalog,
  parseKrPoizonBrandData,
  parsePublicBrandProducts,
  prioritizeBrandCatalog,
  publicBrandPageCount,
  publicBrandPath,
  salesRankedBrands,
} from "./services/brand-catalog.mjs";
import {
  OFFICIAL_DOMAIN_STATUS,
  auditedOfficialDomainRecord,
  createOfficialDomainRegistry,
  failedOfficialDomainAuditRecord,
  officialDomainDiscoveryUrl,
  officialDomainRecordForBrand,
  officialDomainSearchAliases,
  officialDomainRegistrySummary,
  officialDomainAuditQueue,
  rankOfficialDomainCandidates,
  rankNaverOfficialStoreCandidates,
  naverOfficialStoreRecord,
  noOfficialStoreRecord,
} from "./services/official-domain-registry.mjs";
import {
  naverOfficialStoreNotFoundRows,
  naverOfficialStoreNotFoundWorkbookData,
} from "./services/official-domain-not-found.mjs";
import { explorerMetadata, parsePopularProducts, queryExplorer } from "./services/poizon.mjs";
import {
  extractSellerBrandApiProducts,
  mergeSellerBrandPages,
  mergeSellerBrandProducts,
  sellerBrandDiagnostics,
} from "./services/seller-brand-sales.mjs";
import { analyzeRenderedChannelProducts, queryDomesticProducts } from "./relay/domestic-search.mjs";
import { scoreProductCandidate } from "./services/matcher.mjs";
import { mergeSellerProductsByRank, parseSellerDomNodes } from "./services/seller-dom.mjs";
import { highestQualifiedOptionPrice, optionRowsFromSellerResponses, qualifiedOptionPrices } from "./services/seller-transaction-price.mjs";
import { SELLER_POPULAR_CONDITIONS } from "./services/seller-conditions.mjs";
import { findNewSellerExportJob } from "./services/brand-export-jobs.mjs";
import {
  SITE_HEALTH_TARGETS,
  nextWeeklySiteHealthAt,
  weeklySiteHealthSummary,
} from "./services/weekly-site-health.mjs";

let store;
const { autoUpdater } = pkg;
nativeTheme.themeSource = "light";
let mainWindow;
let sellerWindow;
let sellerMonitorWindow;
const inventoryWindows = new Set();
let updateReady = false;
let updateCheckTimer;
let updateInstallTimer;
let updateCheckInFlight = false;
let oneDriveBackupStatus = { state: "checking", message: "OneDrive 연결을 확인하고 있습니다." };
let brandExportPollTimer;
let lastBrandExportSignature = "__BASELINE_EXISTING_FILES__";
let pendingBrandExportName = "";
let pendingBrandExportJobId = "";
let brandExportJobPending = false;
let brandDownloadStarted = false;
const brandExportJobs = new Map();
const sellerDownloadSessions = new WeakSet();
const brandExportValidationCache = new Map();
const excelPreviewCache = new Map();
let brandExportMonitorRunning = false;
let brandExportMonitorRestartTimer;
let sellerTransactionLookupQueue = Promise.resolve();
let officialDomainAuditRunning = false;
let officialDomainAuditStopRequested = false;
let officialDomainAuditWindow = null;
let officialDomainAuditResumeTimer = null;
let weeklySiteHealthTimer = null;
let weeklySiteHealthRunning = false;
let officialDomainAuditAbortCurrent = null;
let brandExportAllCompleteSent = false;
let activeBrandDownloadJobId = "";
const brandDownloadPathsInProgress = new Set();
let brandWorkSessionGeneration = 0;
let brandExportAttemptGeneration = 0;
let sellerProductFrameRoutingId = null;
const SELLER_CENTER_URL = "https://seller.poizon.com/main/dataCenter/merchantRankBoard";
const SELLER_PRODUCT_SEARCH_URL = "https://seller.poizon.com/main/goods/search";
const SELLER_EXPORT_CENTER_URL = "https://seller.poizon.com/main/exportCenter";
const SELLER_BRAND_EXPORT_HARD_TIMEOUT_MS = 20 * 60 * 1000;
const KR_POIZON_BRAND_LIST_URL = "https://kr.poizon.com/brand/list";
const EN_POIZON_BRAND_LIST_URL = "https://www.poizon.com/brand/list";
const APP_ICON_PATH = join(import.meta.dirname, "build", "icon.png");
const SITE_HEALTH_TIMEOUT_MS = 25_000;
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
const SELLER_ROW_SCROLL_SCRIPT = `(() => {
  const root = document.scrollingElement || document.documentElement;
  const candidates = [root, ...document.querySelectorAll("div, section, main, article, [role='grid'], [role='table']")]
    .filter((element, index, all) => all.indexOf(element) === index)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      const text = String(element.innerText || "");
      const productTable = text.includes("SPU") && text.includes("SKU")
        && /상품정보|평균\\s*거래가/.test(text);
      return {
        element,
        maximum,
        visible: rect.width >= 280 && rect.height >= 160 && rect.bottom > 0 && rect.top < innerHeight,
        score: (productTable ? 1000000 : 0) + maximum,
      };
    })
    .filter((candidate) => candidate.visible && candidate.maximum > 80)
    .sort((left, right) => right.score - left.score);
  const target = candidates[0];
  if (!target) return { found: false, atEnd: true };
  const rowHeights = [...target.element.querySelectorAll("tr, [role='row']")]
    .map((row) => row.getBoundingClientRect().height)
    .filter((height) => height >= 20 && height <= 180)
    .sort((left, right) => left - right);
  const medianHeight = rowHeights.length
    ? rowHeights[Math.floor(rowHeights.length / 2)]
    : 48;
  // Move by less than one row so no virtualized row can pass between captures.
  const step = Math.max(12, Math.min(48, Math.floor(medianHeight * 0.55)));
  const before = target.element.scrollTop;
  target.element.scrollTop = Math.min(target.maximum, before + step);
  target.element.dispatchEvent(new Event("scroll", { bubbles: true }));
  const after = target.element.scrollTop;
  return {
    found: true,
    moved: after > before,
    atEnd: after >= target.maximum - 2,
    before,
    after,
    maximum: target.maximum,
    step,
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
const sellerScrollbarInfoScript = (ratio) => `(() => {
  const requestedRatio = Math.max(0, Math.min(1, ${Number(ratio)}));
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
        rect,
        maximum,
        visible,
        score: (productTable ? 1000000 : 0) + (scrollStyle ? 100000 : 0) + maximum
      };
    })
    .filter((candidate) => candidate.visible && candidate.maximum > 80)
    .sort((left, right) => right.score - left.score);
  const target = candidates[0];
  if (!target) return { found: false };
  const thumbHeight = Math.max(28, target.rect.height * (target.element.clientHeight / target.element.scrollHeight));
  const travel = Math.max(1, target.rect.height - thumbHeight);
  const currentRatio = target.element.scrollTop / target.maximum;
  return {
    found: true,
    x: Math.max(1, Math.floor(target.rect.right - 7)),
    startY: Math.floor(target.rect.top + thumbHeight / 2 + travel * currentRatio),
    endY: Math.floor(target.rect.top + thumbHeight / 2 + travel * requestedRatio),
    ratio: requestedRatio
  };
})()`;
const SELLER_SELECTION_INFO_SCRIPT = `(() => {
  const root = document.scrollingElement || document.documentElement;
  const candidates = [root, ...document.querySelectorAll("div, section, main, article, [role='grid'], [role='table']")]
    .filter((element, index, all) => all.indexOf(element) === index)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      const text = String(element.innerText || "");
      const productTable = text.includes("SPU") && text.includes("SKU")
        && /상품정보|평균\\s*거래가/.test(text);
      return {
        element,
        rect,
        maximum,
        score: (productTable ? 1000000 : 0) + maximum,
      };
    })
    .filter(({ rect, maximum }) =>
      maximum > 80 && rect.width >= 280 && rect.height >= 160
      && rect.bottom > 0 && rect.top < innerHeight
    )
    .sort((left, right) => right.score - left.score);
  const target = candidates[0];
  if (!target) return { found: false };
  target.element.scrollTop = 0;
  target.element.dispatchEvent(new Event("scroll", { bubbles: true }));
  const rect = target.rect;
  return {
    found: true,
    startX: Math.floor(rect.left + Math.min(120, rect.width * 0.12)),
    startY: Math.floor(rect.top + Math.min(100, rect.height * 0.16)),
    endX: Math.floor(rect.right - Math.min(100, rect.width * 0.08)),
    endY: Math.floor(rect.bottom - 8),
    maximum: target.maximum,
  };
})()`;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function physicalSellerPointClick(point, settleMilliseconds = 900) {
  if (!sellerWindow || sellerWindow.isDestroyed()) return false;
  const x = Math.round(Number(point?.x));
  const y = Math.round(Number(point?.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  sellerWindow.show();
  sellerWindow.focus();
  const bounds = sellerWindow.getContentBounds();
  const moved = await moveWindowsCursorAndClick(bounds.x + x, bounds.y + y).catch(() => ({ ok: false }));
  if (!moved?.ok) {
    sellerWindow.webContents.sendInputEvent({ type: "mouseMove", x, y });
    await wait(80);
    sellerWindow.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x, y });
    await wait(100);
    sellerWindow.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x, y });
  }
  await wait(settleMilliseconds);
  return true;
}

function extractSellerApiProducts(document, limit = 200) {
  const products = [];
  const visited = new Set();
  const first = (value, keys) => keys.map((key) => value?.[key]).find((item) => item !== undefined && item !== null && item !== "");
  const walk = (value, depth = 0) => {
    if (!value || depth > 12 || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (!Array.isArray(value)) {
      const rank = Number(first(value, ["rank", "ranking", "rankNo", "sortNo", "orderNo", "no"]));
      const articleNumber = String(first(value, [
        "articleNumber", "articleNo", "articleCode", "styleNo", "spuCode", "spuNo",
        "productCode", "productNo", "goodsCode", "goodsNo", "skuCode", "skuNo"
      ]) || "").replace(/\s+/g, " ").trim();
      const name = String(first(value, [
        "productName", "goodsName", "spuName", "spuTitle", "title", "name"
      ]) || "").trim();
      const averagePrice = Number(String(first(value, [
        "averagePrice", "avgPrice", "transactionPrice", "dealPrice", "price"
      ]) || "").replace(/[^0-9.]/g, ""));
      if (rank >= 1 && rank <= limit && (articleNumber || name)) {
        products.push({
          rank,
          rankDetected: true,
          articleNumber,
          name,
          averagePrice,
          lowestPrice: Number(first(value, ["lowestPrice", "minPrice", "lowPrice"])) || 0,
          highestPrice: Number(first(value, ["highestPrice", "maxPrice", "highPrice"])) || 0,
          logoUrl: String(first(value, ["imageUrl", "logoUrl", "cover", "picUrl", "imgUrl"]) || ""),
          sales30d: 0,
          source: "seller-center-network",
          sellerCenterDirect: true,
        });
      }
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, depth + 1);
  };
  walk(document);
  return products;
}

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

async function dragSellerScrollbarToRatio(ratio) {
  const info = await executeAcrossSellerFrames(sellerScrollbarInfoScript(ratio));
  if (!info?.found || !sellerWindow || sellerWindow.isDestroyed()) return false;
  sellerWindow.webContents.sendInputEvent({ type: "mouseMove", x: info.x, y: info.startY });
  sellerWindow.webContents.sendInputEvent({
    type: "mouseDown", button: "left", clickCount: 1, x: info.x, y: info.startY
  });
  const steps = Math.max(4, Math.min(18, Math.ceil(Math.abs(info.endY - info.startY) / 24)));
  for (let step = 1; step <= steps; step += 1) {
    const y = Math.round(info.startY + ((info.endY - info.startY) * step) / steps);
    sellerWindow.webContents.sendInputEvent({ type: "mouseMove", x: info.x, y, movementX: 0, movementY: y - info.startY });
    await wait(18);
  }
  sellerWindow.webContents.sendInputEvent({
    type: "mouseUp", button: "left", clickCount: 1, x: info.x, y: info.endY
  });
  showCollectorWindow();
  return true;
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
    if (condition.action === "select" && result.found) {
      await wait(500);
      const verification = await executeAcrossSellerFrames(`(() => {
        const label = ${JSON.stringify(condition.label)};
        const normalizedLabel = label.replace(/\\s+/g, "");
        const elements = [...document.querySelectorAll(
          "label, button, [role='radio'], [role='checkbox'], [role='tab'], span, div"
        )].filter((element) =>
          String(element.innerText || element.textContent || "").trim().replace(/\\s+/g, "") === normalizedLabel
        );
        for (const element of elements) {
          const candidates = [];
          let candidate = element;
          for (let depth = 0; candidate && depth < 8; depth += 1, candidate = candidate.parentElement) {
            candidates.push(candidate);
          }
          for (const control of candidates) {
            const input = control.querySelector?.("input[type='radio'], input[type='checkbox'], input");
            const stateText = [
              control.className?.baseVal || control.className || "",
              control.getAttribute?.("data-state") || "",
              control.getAttribute?.("data-checked") || "",
            ].join(" ");
            const selected = Boolean(
              input?.checked
              || control.getAttribute?.("aria-checked") === "true"
              || control.getAttribute?.("aria-selected") === "true"
              || /active|selected|checked|on|true/i.test(stateText)
            );
            if (selected) return { found: true, verifiedSelected: true, label };
          }
        }
        return { found: false, verifiedSelected: false, label };
      })()`);
      result = {
        ...result,
        ...verification,
        found: verification.found || result.found,
        // POIZON 사용자 정의 라디오는 선택 상태를 표준 DOM 속성으로 노출하지
        // 않는 경우가 있어, 정확한 레이블의 클릭 성공을 보조 검증으로 인정합니다.
        verifiedSelected: verification.verifiedSelected || Boolean(result.found && result.selected),
        verificationMode: verification.verifiedSelected ? "dom-state" : "label-click",
      };
    }
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
  let bytes;
  if (/^data:image\//i.test(String(url))) {
    const encoded = String(url).split(",", 2)[1] || "";
    bytes = Buffer.from(encoded, /;base64,/i.test(String(url)) ? "base64" : "utf8");
  } else {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
    const response = await fetch(parsed.href, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 5_000_000) return null;
    bytes = Buffer.from(await response.arrayBuffer());
  }
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
  products = products.map((product) => {
    const exactOfficialProduct = product.store === "브랜드 공식몰"
      && /^https?:\/\//i.test(String(product.url || ""))
      && Number(product.signals?.codeScore || 0) === 1
      && product.articleConflict !== true
      && product.signals?.codeConflict !== true;
    if (!exactOfficialProduct) return product;
    return {
      ...product,
      confidence: 95,
      productMatchConfidence: 95,
      officialStoreVerified: true,
      sourceTrustLabel: "공식몰 확인완료",
      imageVerificationLabel: product.imageVerifiedFromDetail
        ? "상세 이미지 확인완료"
        : product.imageVerifiedFromCard ? "공식몰 이미지 확인" : "이미지 확인 필요",
    };
  });
  const priorities = new Map(data.sources.map((sourceRow) => [sourceRow.store, sourceRow.priority]));
  products = products.sort((left, right) =>
    (priorities.get(left.store) || 99) - (priorities.get(right.store) || 99)
    || right.confidence - left.confidence
  );
  const hasSourceImage = Boolean(String(input.imageUrl || "").trim());
  products = products.filter((product) => {
    const codeMatched = Number(product.signals?.codeScore || 0) === 1;
    const codeConflict = product.articleConflict === true || product.signals?.codeConflict === true;
    const titleScore = Number(product.signals?.titleScore || 0);
    const imageScore = product.signals?.imageScore;
    if (codeConflict) return false;
    if (codeMatched) return true;
    if (product.store === "브랜드 공식몰") return false;
    if (!hasSourceImage) return titleScore >= 80;
    return titleScore >= 70 && Number(imageScore || 0) >= 95;
  });
  const uniqueProducts = new Map();
  for (const product of products) {
    let urlIdentity = "";
    try {
      const parsed = new URL(String(product.url || ""));
      parsed.search = "";
      parsed.hash = "";
      urlIdentity = parsed.href.toLocaleLowerCase();
    } catch {}
    const exactCode = String(product.detectedArticleNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const identity = exactCode
      ? `${product.store}:code:${exactCode}`
      : `${product.store}:url:${urlIdentity}`;
    const previous = uniqueProducts.get(identity);
    if (!previous || Number(product.confidence || 0) > Number(previous.confidence || 0)) uniqueProducts.set(identity, product);
  }
  products = [...uniqueProducts.values()];
  const verifiedCounts = products.reduce((counts, product) => {
    const store = String(product.store || "");
    if (store) counts.set(store, (counts.get(store) || 0) + 1);
    return counts;
  }, new Map());
  const sources = data.sources.map((sourceRow) => ({
    ...sourceRow,
    count: sourceRow.linkOnly
      ? Number(sourceRow.count || 0)
      : verifiedCounts.get(sourceRow.store) || 0,
  }));
  return { ...data, products, sources };
}

async function officialDetailImage(searchWindow, productUrl, officialPageUrl = "", linkedSearchImageUrl = "") {
  try {
    const target = new URL(String(productUrl || ""));
    const official = new URL(String(officialPageUrl || productUrl || ""));
    const sameOfficialHost = target.hostname === official.hostname
      || target.hostname.endsWith(`.${official.hostname}`)
      || official.hostname.endsWith(`.${target.hostname}`);
    if (target.protocol !== "https:" || !sameOfficialHost) return "";
    await Promise.race([
      searchWindow.loadURL(target.href).catch((error) => {
        if (!/ERR_ABORTED/i.test(String(error?.message || ""))) throw error;
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("OFFICIAL_DETAIL_TIMEOUT")), 20_000)),
    ]);
    await wait(1_200);
    const detailImageUrl = String(await searchWindow.webContents.executeJavaScript(`(() => {
      const absolute = (value) => {
        try { return new URL(String(value || "").trim(), location.href).href; } catch { return ""; }
      };
      const usable = (value) => {
        const url = absolute(value);
        return /^https:\\/\\//i.test(url) && !/logo|icon|sprite|badge|banner|placeholder|loading|no[-_]?image|\\.svg(?:$|\\?)/i.test(url) ? url : "";
      };
      const productJsonImages = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => {
        try {
          const parsed = JSON.parse(node.textContent || "null");
          const values = Array.isArray(parsed) ? parsed : [parsed];
          return values.flatMap((value) => {
            const entries = Array.isArray(value?.['@graph']) ? value['@graph'] : [value];
            return entries.filter((entry) => String(entry?.['@type'] || "").toLowerCase().includes("product"))
              .flatMap((entry) => Array.isArray(entry?.image) ? entry.image : [entry?.image]);
          });
        } catch { return []; }
      }).map((value) => typeof value === "string" ? value : value?.url || value?.contentUrl).map(usable).filter(Boolean);
      if (productJsonImages[0]) return productJsonImages[0];
      const metaImage = usable(document.querySelector('meta[property="og:image"]')?.content)
        || usable(document.querySelector('meta[name="twitter:image"]')?.content);
      if (metaImage) return metaImage;
      const candidates = [...document.querySelectorAll('main img, [itemprop="image"], [class*="product" i] img, [class*="goods" i] img')]
        .map((image) => {
          const srcset = String(image.srcset || image.getAttribute("data-srcset") || "").split(",").pop()?.trim().split(/\\s+/)[0];
          const url = usable(image.currentSrc || image.getAttribute("data-original") || image.getAttribute("data-src") || srcset || image.src);
          const rect = image.getBoundingClientRect();
          const label = [image.alt, image.className, image.id, image.closest('a')?.href].join(" ");
          const score = (rect.width >= 180 && rect.height >= 180 ? 80 : 0)
            + (image.naturalWidth >= 500 || image.naturalHeight >= 500 ? 60 : 0)
            + (/main|대표|detail|product|goods/i.test(label) ? 30 : 0)
            - (/logo|icon|swatch|color|thumb|banner/i.test(label) ? 100 : 0);
          return { url, score };
        }).filter((candidate) => candidate.url).sort((left, right) => right.score - left.score);
      return candidates[0]?.url || "";
    })()`, true));
    const selectedImageUrl = detailImageUrl || String(linkedSearchImageUrl || "");
    if (!/^https?:\/\//i.test(selectedImageUrl)) return "";
    const response = await searchWindow.webContents.session.fetch(selectedImageUrl, {
      headers: { Referer: target.href },
    });
    if (!response.ok) return "";
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 8_000_000) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 8_000_000) return "";
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return "";
    const size = image.getSize();
    const scale = Math.min(1, 480 / Math.max(size.width, size.height, 1));
    const preview = scale < 1
      ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: "good" })
      : image;
    return preview.toDataURL();
  } catch {
    return "";
  }
}

async function renderedSearchSourceResult(source, articleNumber, brand = "", title = "") {
  const interactiveOfficialSearch = source.store === "브랜드 공식몰"
    && !String(source.officialProductUrl || "")
    && /^https:\/\//i.test(String(source.homepageUrl || ""));
  const url = String(source.officialProductUrl || (interactiveOfficialSearch ? source.homepageUrl : source.searchUrl) || "");
  if (!/^https:\/\//i.test(url)) return { count: Number(source.count || 0), products: [] };
  let searchWindow;
  try {
    searchWindow = new BrowserWindow({
      show: false,
      icon: APP_ICON_PATH,
      width: 1100,
      height: 800,
      webPreferences: {
        partition: "persist:around-g-domestic-search",
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    searchWindow.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36");
    await Promise.race([
      searchWindow.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("SEARCH_PAGE_TIMEOUT")), 30_000)),
    ]);
    if (interactiveOfficialSearch) {
      const searchQuery = String(articleNumber || title || "").trim();
      let submitted = false;
      for (let attempt = 0; attempt < 6 && !submitted; attempt += 1) {
        submitted = await searchWindow.webContents.executeJavaScript(`(() => {
          const query = ${JSON.stringify(String(articleNumber || title || ""))};
          const visible = (element) => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          };
          let input = [...document.querySelectorAll('input[type="search"],input[name*="search" i],input[name="q" i],input[name*="query" i],input[name*="keyword" i],input[name*="schWord" i]')].find(visible);
          if (!input) {
            const opener = [...document.querySelectorAll('button,a,[role="button"]')].find((element) => {
              const label = [element.getAttribute("aria-label"), element.getAttribute("title"), element.className, element.textContent].join(" ");
              return visible(element) && /search|검색/i.test(label);
            });
            opener?.click();
            return false;
          }
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter ? setter.call(input, query) : (input.value = query);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.focus();
          const form = input.form;
          const submit = form?.querySelector('button[type="submit"],input[type="submit"]');
          if (submit && visible(submit)) submit.click();
          else if (form?.requestSubmit) form.requestSubmit();
          else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          return true;
        })()`, true).catch(() => false);
        if (!submitted) await wait(600);
      }
      if (!submitted || !searchQuery) return null;
      await wait(2_000);
    }
    // Dynamic commerce pages render and lazy-load after navigation. Give them
    // time to settle and scroll enough to materialize the first result cards.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await wait(attempt === 0 ? 2_000 : 800);
      await searchWindow.webContents.executeJavaScript(`(() => {
        const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo(0, Math.min(maxY, window.scrollY + Math.max(500, window.innerHeight * 0.8)));
      })()`, true).catch(() => {});
    }
    const content = await searchWindow.webContents.executeJavaScript(`(() => {
      const expectedArticle = ${JSON.stringify(String(articleNumber || ""))};
      const expectedCompact = expectedArticle.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      const expectedBase = expectedArticle.split(/[-_]/)[0].replace(/[^A-Z0-9]/gi, "").toUpperCase();
      const matchesExpected = (value) => {
        const compact = String(value || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
        return Boolean(expectedCompact && compact.includes(expectedCompact))
          || Boolean(expectedBase.length >= 5 && compact.includes(expectedBase));
      };
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const productLinks = [...document.querySelectorAll("a[href]")]
        .filter((link) => visible(link) || matchesExpected(link.href) || matchesExpected(link.outerHTML))
        .filter((link) => /\\/(?:p|pd|products?|goods|product|(?:[a-z]{2}\\/)?t)\\//i.test(link.href)
          || /productDetail\\.action/i.test(link.href)
          || /\\/item\\/itemView\\.ssg/i.test(link.href)
          || matchesExpected(link.href)
          || matchesExpected(link.outerHTML));
      const seen = new Set();
      const productCards = [];
      for (const link of productLinks) {
        const productUrl = String(link.href || "").split("#")[0];
        if (!productUrl || seen.has(productUrl)) continue;
        const card = link.closest("li, article, [data-product-id], [data-item-id], [class*='product-card'], [class*='goods-item'], [class*='item-card'], [class*='cunit'], [class*='mnemitem'], [class*='mnemitem'], [class*='item_unit']")
          || link.parentElement;
        const text = String(card?.innerText || link.innerText || "").trim();
        const markup = String(card?.outerHTML || link.outerHTML || "").slice(0, 2500);
        const sameProductLinks = [link, ...(card?.querySelectorAll?.("a[href]") || [])]
          .filter((candidate) => String(candidate.href || "").split("#")[0] === productUrl);
        const linkedImages = sameProductLinks.flatMap((candidate) => [...candidate.querySelectorAll("img")]);
        const image = linkedImages.find((candidate) => {
          const value = String(candidate.currentSrc || candidate.dataset?.original || candidate.dataset?.src || candidate.src || "");
          return value && !/logo|icon|sprite|badge|banner|placeholder|loading|swatch|color/i.test([value, candidate.alt, candidate.className].join(" "));
        });
        const imageUrl = String(image?.currentSrc || image?.dataset?.original || image?.dataset?.src || image?.src || "");
        const imageLinkedToProduct = Boolean(imageUrl);
        const titleElement = card?.querySelector?.("[class*='title'], [class*='name'], strong");
        const title = String(image?.alt || link.getAttribute("aria-label") || titleElement?.textContent || text.split("\\n")[0] || "").trim();
        const priceCandidates = [...(card?.querySelectorAll?.("del,s,strike,strong,b,em,span,p,div") || [])]
          .map((element) => {
            const value = String(element.textContent || "").trim();
            if (!/^[\\d,]+\\s*원$/.test(value)) return null;
            const style = getComputedStyle(element);
            const struck = /line-through/.test(style.textDecorationLine || style.textDecoration || "")
              || Boolean(element.closest("del,s,strike"));
            const className = String(element.className?.baseVal || element.className || "");
            const rgb = String(style.color || "").match(/\\d+/g)?.map(Number) || [];
            const red = rgb.length >= 3 && rgb[0] > rgb[1] * 1.35 && rgb[0] > rgb[2] * 1.35;
            const amount = Number(value.replace(/[^0-9]/g, ""));
            const score = (struck ? -1000 : 0) + (red ? 80 : 0)
              + (/sale|discount|final|current|price/i.test(className) ? 35 : 0)
              + (Number(style.fontWeight) >= 600 || /bold/i.test(style.fontWeight) ? 15 : 0);
            return { value, amount, struck, score };
          }).filter(Boolean)
          .filter((candidate) => !candidate.struck && candidate.amount > 0)
          .sort((left, right) => right.score - left.score || left.amount - right.amount);
        const price = priceCandidates[0]?.value || text.match(/[\\d,]+\\s*원/)?.[0] || "";
        const originalPrice = [...(card?.querySelectorAll?.("del,s,strike") || [])]
          .map((element) => String(element.textContent || "").trim())
          .find((value) => /^[\\d,]+\\s*원$/.test(value)) || "";
        seen.add(productUrl);
        productCards.push({ productUrl, text, markup, imageUrl, imageLinkedToProduct, title, price, originalPrice });
      }
      const pageText = String(document.body?.innerText || "").slice(0, 20000);
      const pageBlocked = /captcha|보안\s*확인|자동\s*입력|로봇|접속.{0,12}(?:제한|차단)|서비스.{0,12}(?:제한|지연)|비정상적인\s*접근/i.test(pageText);
      return JSON.stringify({ productCards, pageBlocked, pageText });
    })()`, true);
    try {
      const parsedContent = JSON.parse(content);
      if (parsedContent?.pageBlocked && !parsedContent?.productCards?.length) return null;
    } catch {}
    const analyzed = analyzeRenderedChannelProducts(content, source.store, articleNumber, brand, title);
    if (source.store !== "브랜드 공식몰" || !Array.isArray(analyzed?.products)) return analyzed;
    const officialPageUrl = String(source.homepageUrl || source.officialProductUrl || source.searchUrl || "");
    const products = [];
    for (const product of analyzed.products.slice(0, 12)) {
      const detailImageUrl = await officialDetailImage(
        searchWindow,
        product.url,
        officialPageUrl,
        product.imageVerifiedFromCard ? product.imageUrl : "",
      );
      products.push({
        ...product,
        // Never replace a failed detail-page lookup with an image borrowed
        // from a neighbouring search card.
        imageUrl: detailImageUrl,
        imageVerifiedFromDetail: Boolean(detailImageUrl),
      });
    }
    return { ...analyzed, count: products.length, products };
  } catch {
    return null;
  } finally {
    if (searchWindow && !searchWindow.isDestroyed()) searchWindow.destroy();
  }
}

async function addRenderedSearchCounts(data, articleNumber, brand = "", title = "") {
  const discoveredProducts = [];
  const sources = await Promise.all(data.sources.map(async (source) => {
    if (source.officialStatus && ![
      OFFICIAL_DOMAIN_STATUS.VERIFIED,
      OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED,
    ].includes(source.officialStatus)) {
      return { ...source, countVerified: false, verificationFailed: false };
    }
    if (!source.renderCount) {
      return {
        ...source,
        countVerified: source.ok === true,
        verificationFailed: source.ok === false,
      };
    }
    if (!source.linkOnly && source.ok && Number(source.count || 0) > 0) {
      return { ...source, countVerified: true, verificationFailed: false };
    }
    const renderAttempts = /^SSG\s/.test(String(source.store || "")) ? 2 : 1;
    let result = null;
    for (let attempt = 0; attempt < renderAttempts && !result; attempt += 1) {
      if (attempt > 0) await wait(1_500);
      result = await renderedSearchSourceResult(source, articleNumber, brand, title);
    }
    if (Array.isArray(result?.products)) discoveredProducts.push(...result.products);
    const count = result?.count;
    const absenceConfirmed = result?.absenceConfirmed === true;
    const isOfficialStore = source.store === "브랜드 공식몰";
    const verifiedOfficialProductUrl = isOfficialStore
      ? String((result?.products || []).find((product) => /^https?:\/\//i.test(String(product?.url || "")))?.url || "")
      : String(source.officialProductUrl || "");
    return {
      ...source,
      count: Number.isFinite(count) ? count : 0,
      countVerified: Number.isFinite(count) && (Number(count) > 0 || absenceConfirmed),
      verificationFailed: !Number.isFinite(count),
      verificationPending: Number.isFinite(count) && Number(count) === 0 && !absenceConfirmed,
      absenceConfirmed,
      // The official search URL and a verified product-detail URL are
      // intentionally separate. A search page must never be presented as a
      // purchase link merely because the brand has a supported search form.
      officialSearchUrl: isOfficialStore ? String(source.officialProductUrl || "") : "",
      officialProductUrl: verifiedOfficialProductUrl,
      officialProductMissing: isOfficialStore && absenceConfirmed,
    };
  }));
  const products = [...(data.products || []), ...discoveredProducts].filter((product, index, all) =>
    index === all.findIndex((candidate) => `${candidate.store}:${candidate.id || candidate.url}` === `${product.store}:${product.id || product.url}`));
  return { ...data, products, sources };
}

function brandsWithOfficialDomainStatus(brands, registry) {
  const compactRecord = (record) => record ? ({
    status: record.status,
    homepageUrl: String(record.homepageUrl || ""),
  }) : null;
  const recordById = new Map((Array.isArray(registry) ? registry : []).map((record) =>
    [Number(record.brandId), compactRecord(record)]));
  const recordByName = new Map((Array.isArray(registry) ? registry : []).flatMap((record) =>
    [record.brandName, record.brandKo].filter(Boolean).map((name) => [String(name).trim().toLowerCase(), compactRecord(record)])));
  return (Array.isArray(brands) ? brands : []).map((brand) => {
    const official = recordById.get(Number(brand.id ?? brand.brandId))
      || recordByName.get(String(brand.ko || brand.name || "").trim().toLowerCase());
    return {
      ...brand,
      officialDomainStatus: official?.status || OFFICIAL_DOMAIN_STATUS.PENDING,
      officialHomepageUrl: official?.homepageUrl || "",
    };
  });
}

async function ensureOfficialDomainRegistry(brands) {
  const settings = store.snapshot().settings;
  const current = Array.isArray(settings.officialBrandRegistry) ? settings.officialBrandRegistry : [];
  const registry = createOfficialDomainRegistry(brands, current);
  const changed = registry.length !== current.length || registry.some((record, index) =>
    JSON.stringify(record) !== JSON.stringify(current[index]));
  if (changed) {
    await store.setSettings({
      officialBrandRegistry: registry,
      officialBrandRegistryUpdatedAt: new Date().toISOString(),
    });
  }
  return registry;
}

function safeOfficialDomainRegistry(brands) {
  const saved = store.snapshot().settings.officialBrandRegistry;
  const registry = createOfficialDomainRegistry(brands, Array.isArray(saved) ? saved : []);
  // Persisting thousands of domain records is maintenance work; it must never
  // block the brand picker from rendering.
  void ensureOfficialDomainRegistry(brands).catch(() => {});
  return registry;
}

function officialDomainAuditSnapshot(registry, extra = {}) {
  const saved = store.snapshot().settings.officialDomainAudit || {};
  const savedState = String(saved.state || "idle");
  return {
    running: officialDomainAuditRunning,
    state: officialDomainAuditRunning ? "running"
      : ["running", "cooldown", "blocked"].includes(savedState) ? "paused" : savedState,
    currentBrand: String(saved.currentBrand || ""),
    processed: Number(saved.processed || 0),
    blocked: Boolean(saved.blocked),
    lastError: String(saved.lastError || ""),
    phase: String(saved.phase || ""),
    attempt: Number(saved.attempt || 0),
    notFoundExcelPath: String(saved.notFoundExcelPath || store.snapshot().settings.officialDomainNotFoundExcelPath || ""),
    notFoundCount: Number(saved.notFoundCount || store.snapshot().settings.officialDomainNotFoundCount || 0),
    notFoundExportError: String(saved.notFoundExportError || ""),
    updatedAt: String(saved.updatedAt || ""),
    ...officialDomainRegistrySummary(registry),
    ...extra,
  };
}

function sendOfficialDomainAuditProgress(registry, extra = {}) {
  const payload = officialDomainAuditSnapshot(registry, extra);
  mainWindow?.webContents.send("official-domain:audit-progress", payload);
  return payload;
}

async function exportNaverOfficialStoreNotFoundExcel(registry) {
  const rows = naverOfficialStoreNotFoundRows(registry);
  const folder = currentBrandExportFolder();
  await mkdir(folder, { recursive: true });
  const filePath = join(folder, "네이버_공식몰_미발견_브랜드.xlsx");
  await writeXlsxFile(naverOfficialStoreNotFoundWorkbookData(rows), {
    sheet: "공식몰 미발견",
    stickyRowsCount: 1,
    columns: [
      { width: 8 }, { width: 14 }, { width: 26 }, { width: 24 }, { width: 24 },
      { width: 48 }, { width: 12 }, { width: 24 }, { width: 64 },
    ],
  }).toFile(filePath);
  await store.setSettings({
    officialDomainNotFoundExcelPath: filePath,
    officialDomainNotFoundCount: rows.length,
    officialDomainNotFoundExcelUpdatedAt: new Date().toISOString(),
  });
  return { path: filePath, count: rows.length };
}

function createOfficialDomainAuditWindow() {
  const auditWindow = new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    webPreferences: {
      partition: "persist:around-g-official-domain-audit",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      // Third-party official malls occasionally execute legacy page scripts
      // (for example msDropDown) that open a native JavaScript error dialog.
      // The audit runs hidden, so those dialogs must never block the 3,400
      // brand verification queue or appear over the Around G window.
      disableDialogs: true,
    },
  });
  auditWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  auditWindow.webContents.session.on("will-download", (_event, item) => item.cancel());
  return auditWindow;
}

async function loadAuditPage(auditWindow, url) {
  let timeout;
  try {
    await Promise.race([
      auditWindow.loadURL(url),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("OFFICIAL_DOMAIN_PAGE_TIMEOUT")), OFFICIAL_DOMAIN_AUDIT_PAGE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (String(error?.message || error) === "OFFICIAL_DOMAIN_PAGE_TIMEOUT") {
      auditWindow.webContents.stop();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  await wait(900);
  let analysisTimeout;
  try {
    return await Promise.race([
      auditWindow.webContents.executeJavaScript(`(() => {
    const text = String(document.body?.innerText || "").slice(0, 20000);
    const blocked = /captcha|보안\\s*확인|자동\\s*입력|비정상적인\\s*접근|로봇이 아닙니다|접속.{0,12}(?:제한|차단)/i.test(text);
    const imageSource = (image) => String(image?.currentSrc || image?.src || image?.getAttribute?.("data-src") || "").trim();
    const candidates = [...document.querySelectorAll("a[href]")].map((link) => {
      const block = link.closest("li, article, section, [class*='item'], [class*='result'], [class*='card']") || link.parentElement;
      return {
        url: String(link.href || ""),
        title: String(link.innerText || link.getAttribute("aria-label") || link.title || "").trim().slice(0, 300),
        rel: String(link.rel || ""),
        imageUrl: imageSource(block?.querySelector("img") || link.querySelector("img")),
      };
    }).filter((item) => /^https?:/i.test(item.url));
    const logoUrls = [...new Set([
      ...[...document.querySelectorAll("img[alt*='logo' i], img[class*='logo' i], img[id*='logo' i], header img")].map(imageSource),
      ...[...document.querySelectorAll("link[rel*='icon']")].map((link) => String(link.href || "")),
    ].filter((item) => /^https?:/i.test(item)))].slice(0, 8);
    let searchTemplate = "";
    for (const form of [...document.forms]) {
      if (String(form.method || "get").toLowerCase() === "post") continue;
      const input = form.querySelector('input[type="search"], input[name="q"], input[name="query"], input[name="keyword"], input[name*="search" i]');
      if (!input) continue;
      try {
        const target = new URL(form.action || location.href, location.href);
        target.searchParams.set(input.name || "q", "{query}");
        searchTemplate = target.href.replace(/%7Bquery%7D/gi, "{query}");
        break;
      } catch {}
    }
        return { candidates, logoUrls, blocked, text, pageTitle: String(document.title || ""), finalUrl: String(location.href), searchTemplate };
      })()`, true),
      new Promise((_, reject) => {
        analysisTimeout = setTimeout(() => reject(new Error("OFFICIAL_DOMAIN_ANALYSIS_TIMEOUT")), OFFICIAL_DOMAIN_AUDIT_ANALYSIS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(analysisTimeout);
  }
}

async function compareOfficialBrandLogos(sourceLogoUrl, candidateLogoUrls) {
  const sourceFingerprint = await imageFingerprint(sourceLogoUrl).catch(() => null);
  if (!sourceFingerprint) return { compared: false, similarity: 0 };
  const urls = [...new Set((Array.isArray(candidateLogoUrls) ? candidateLogoUrls : [])
    .map((value) => String(value || "").trim()).filter((value) => /^https?:/i.test(value)))].slice(0, 8);
  if (!urls.length) return { compared: false, similarity: 0 };
  const similarities = await Promise.all(urls.map(async (url) => {
    const fingerprint = await imageFingerprint(url).catch(() => null);
    return fingerprint ? fingerprintSimilarity(sourceFingerprint, fingerprint) : null;
  }));
  const compared = similarities.some(Number.isFinite);
  return {
    compared,
    similarity: compared ? Math.max(...similarities.filter(Number.isFinite)) : 0,
  };
}

async function compareOfficialBrandLogosWithinLimit(sourceLogoUrl, candidateLogoUrls) {
  let timeout;
  try {
    return await Promise.race([
      compareOfficialBrandLogos(sourceLogoUrl, candidateLogoUrls),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ compared: false, similarity: 0, timedOut: true }), OFFICIAL_DOMAIN_AUDIT_LOGO_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function auditOneOfficialDomain(auditWindow, record, onPhase = () => {}) {
  const brand = record.brandKo || record.brandName;
  let discovery;
  try {
    onPhase("naver_search");
    discovery = await loadAuditPage(auditWindow, officialDomainDiscoveryUrl(brand, record.brandName));
  } catch {
    return { record: failedOfficialDomainAuditRecord(record, "DISCOVERY_LOAD_FAILED"), blocked: false };
  }
  if (discovery.blocked) {
    return { record: failedOfficialDomainAuditRecord(record, "DISCOVERY_BLOCKED"), blocked: true };
  }
  const discoveryLogoCandidates = (discovery.candidates || []).filter((candidate) => candidate.imageUrl).slice(0, 8);
  onPhase("logo_compare");
  const discoveryLogoScores = await Promise.all(discoveryLogoCandidates.map(async (candidate) => ({
    candidate,
    comparison: await compareOfficialBrandLogosWithinLimit(record.brandLogoUrl, [candidate.imageUrl]),
  })));
  const logoScoreByUrl = new Map(discoveryLogoScores.map(({ candidate, comparison }) => [candidate.url, comparison.similarity]));
  const candidates = rankOfficialDomainCandidates((discovery.candidates || []).map((candidate) => ({
    ...candidate,
    logoSimilarity: logoScoreByUrl.get(candidate.url) || 0,
  })), brand).slice(0, OFFICIAL_DOMAIN_AUDIT_MAX_CANDIDATES);
  for (const candidate of candidates) {
    try {
      onPhase("official_site");
      const page = await loadAuditPage(auditWindow, candidate.url);
      if (page.blocked) continue;
      const logoComparison = await compareOfficialBrandLogosWithinLimit(record.brandLogoUrl, [candidate.imageUrl, ...(page.logoUrls || [])]);
      const next = auditedOfficialDomainRecord(record, {
        candidateUrl: candidate.url,
        finalUrl: page.finalUrl,
        pageTitle: page.pageTitle,
        pageText: page.text,
        searchTemplate: page.searchTemplate,
        logoCompared: logoComparison.compared,
        logoSimilarity: logoComparison.similarity,
        verifiedAlias: candidate.title,
      });
      if (next.status !== OFFICIAL_DOMAIN_STATUS.PENDING) return { record: next, blocked: false };
    } catch {
      // 다음 후보 도메인을 확인한다.
    }
  }
  // A Korean brand homepage always wins. Only after every homepage candidate
  // fails do we accept an exact brand.naver.com official brand store.
  const naverStores = rankNaverOfficialStoreCandidates(discovery.candidates || [], brand);
  if (naverStores.length) {
    onPhase("official_site");
    return { record: naverOfficialStoreRecord(record, naverStores[0]), blocked: false };
  }
  // Both approved domestic routes were checked. Do not leave the brand in an
  // endless pending state or connect an overseas/marketplace result.
  return { record: noOfficialStoreRecord(record), blocked: false };
}

async function persistOfficialDomainAudit(registry, audit) {
  await store.setSettings({
    officialBrandRegistry: registry,
    officialBrandRegistryUpdatedAt: new Date().toISOString(),
    officialDomainAudit: { ...audit, updatedAt: new Date().toISOString() },
  });
}

async function runOfficialDomainAudit() {
  if (officialDomainAuditRunning) return;
  clearTimeout(officialDomainAuditResumeTimer);
  officialDomainAuditResumeTimer = null;
  officialDomainAuditRunning = true;
  officialDomainAuditStopRequested = false;
  const brands = store.snapshot().settings.brandCatalog || explorerMetadata().brands;
  let registry = await ensureOfficialDomainRegistry(brands);
  let processed = 0;
  let blocked = false;
  let lastError = "";
  officialDomainAuditWindow = createOfficialDomainAuditWindow();
  try {
    await persistOfficialDomainAudit(registry, { state: "running", currentBrand: "", processed: 0, blocked: false, lastError: "" });
    const auditQueue = officialDomainAuditQueue(registry);
    const deferredIndices = [];
    const processAuditIndex = async (index, attempt) => {
      if (officialDomainAuditStopRequested) return null;
      const record = registry[index];
      if (record.status !== OFFICIAL_DOMAIN_STATUS.PENDING) return;
      const currentBrand = record.brandKo || record.brandName;
      const progress = (phase) => sendOfficialDomainAuditProgress(registry, {
        state: "running", currentBrand, processed, blocked: false, lastError: "", phase, attempt,
      });
      progress(attempt === 1 ? "starting" : "retrying");
      const activeWindow = officialDomainAuditWindow;
      let brandTimeout;
      let abortCurrent;
      const abortPromise = new Promise((resolve) => {
        abortCurrent = () => resolve({ aborted: true });
        officialDomainAuditAbortCurrent = abortCurrent;
      });
      const timeoutPromise = new Promise((resolve) => {
        brandTimeout = setTimeout(() => {
          if (activeWindow && !activeWindow.isDestroyed()) activeWindow.destroy();
          resolve({
            record: failedOfficialDomainAuditRecord(record, "BRAND_AUDIT_TIMEOUT"),
            blocked: false,
            timedOut: true,
          });
        }, OFFICIAL_DOMAIN_AUDIT_BRAND_TIMEOUT_MS);
      });
      let result;
      try {
        result = await Promise.race([
          auditOneOfficialDomain(activeWindow, record, progress),
          timeoutPromise,
          abortPromise,
        ]);
      } finally {
        clearTimeout(brandTimeout);
        if (officialDomainAuditAbortCurrent === abortCurrent) officialDomainAuditAbortCurrent = null;
      }
      if (result?.aborted || officialDomainAuditStopRequested) return null;
      if (result?.timedOut) {
        progress("timed_out");
        if (officialDomainAuditWindow === activeWindow) {
          officialDomainAuditWindow = createOfficialDomainAuditWindow();
        }
      }
      registry[index] = result.record;
      processed += 1;
      blocked = result.blocked;
      lastError = result.record.lastVerificationError || "";
      if (processed % 5 === 0 || blocked) {
        await persistOfficialDomainAudit(registry, { state: blocked ? "blocked" : "running", currentBrand, processed, blocked, lastError, phase: blocked ? "security_wait" : "saved", attempt });
      }
      sendOfficialDomainAuditProgress(registry, {
        state: blocked ? "blocked" : "running", currentBrand, processed, blocked, lastError,
        phase: blocked ? "security_wait" : "saved", attempt,
        updatedBrand: {
          brandId: Number(result.record.brandId),
          status: result.record.status,
          homepageUrl: String(result.record.homepageUrl || ""),
        },
      });
      return result;
    };
    for (const index of auditQueue) {
      if (officialDomainAuditStopRequested) break;
      const result = await processAuditIndex(index, 1);
      if (result?.blocked) break;
      if (result?.record?.status === OFFICIAL_DOMAIN_STATUS.PENDING) deferredIndices.push(index);
      await wait(OFFICIAL_DOMAIN_AUDIT_BETWEEN_BRANDS_MS);
    }
    if (!blocked && !officialDomainAuditStopRequested && deferredIndices.length) {
      if (officialDomainAuditWindow && !officialDomainAuditWindow.isDestroyed()) officialDomainAuditWindow.destroy();
      officialDomainAuditWindow = createOfficialDomainAuditWindow();
      for (const index of deferredIndices) {
        if (officialDomainAuditStopRequested) break;
        const result = await processAuditIndex(index, 2);
        if (result?.blocked) break;
        await wait(OFFICIAL_DOMAIN_AUDIT_BETWEEN_BRANDS_MS);
      }
    }
  } finally {
    officialDomainAuditAbortCurrent = null;
    if (officialDomainAuditWindow && !officialDomainAuditWindow.isDestroyed()) officialDomainAuditWindow.destroy();
    officialDomainAuditWindow = null;
    officialDomainAuditRunning = false;
    const summary = officialDomainRegistrySummary(registry);
    const resumeAt = "";
    const state = blocked ? "paused"
      : officialDomainAuditStopRequested ? "paused"
        : summary.unchecked ? "paused" : summary.pending ? "completed_with_pending" : "completed";
    let notFoundExcel = { path: "", count: 0, error: "" };
    try {
      notFoundExcel = { ...await exportNaverOfficialStoreNotFoundExcel(registry), error: "" };
    } catch (error) {
      notFoundExcel.error = error instanceof Error ? error.message : String(error || "EXCEL_EXPORT_FAILED");
    }
    const finalAudit = {
      state, currentBrand: "", processed, blocked, lastError, resumeAt,
      notFoundExcelPath: notFoundExcel.path,
      notFoundCount: notFoundExcel.count,
      notFoundExportError: notFoundExcel.error,
    };
    await persistOfficialDomainAudit(registry, finalAudit);
    sendOfficialDomainAuditProgress(registry, { running: false, ...finalAudit });
  }
}

async function startImmediateOfficialMallLinkage() {
  const version = app.getVersion();
  const settings = store.snapshot().settings;
  const initialBrands = settings.brandCatalog || explorerMetadata().brands;
  const initialRegistry = safeOfficialDomainRegistry(initialBrands);
  const initialSummary = officialDomainRegistrySummary(initialRegistry);
  if (settings.immediateOfficialMallLinkageVersion === version && !initialSummary.pending) return;
  await store.setSettings({
    immediateOfficialMallLinkageStartedAt: new Date().toISOString(),
  });
  mainWindow?.webContents.send("official-domain:audit-progress", {
    ...officialDomainAuditSnapshot(safeOfficialDomainRegistry(settings.brandCatalog || explorerMetadata().brands)),
    running: true,
    state: "running",
    phase: "starting",
    currentBrand: "전체 브랜드 목록 동기화",
  });
  const syncResult = await syncBrandCatalogFromKrPoizon().catch((error) => ({ ok: false, error }));
  const refreshedSettings = store.snapshot().settings;
  const brands = syncResult?.ok && Array.isArray(syncResult.brands) && syncResult.brands.length
    ? syncResult.brands
    : refreshedSettings.brandCatalog || explorerMetadata().brands;
  await ensureOfficialDomainRegistry(brands);
  await runOfficialDomainAudit();
  const completedRegistry = safeOfficialDomainRegistry(brands);
  const completedSummary = officialDomainRegistrySummary(completedRegistry);
  if (!completedSummary.pending) {
    await store.setSettings({
      immediateOfficialMallLinkageVersion: version,
      immediateOfficialMallLinkageCompletedAt: new Date().toISOString(),
    });
  }
}

function pauseOfficialDomainAuditForSellerAutomation() {
  const shouldResume = officialDomainAuditRunning || Boolean(officialDomainAuditResumeTimer);
  clearTimeout(officialDomainAuditResumeTimer);
  officialDomainAuditResumeTimer = null;
  if (shouldResume) {
    officialDomainAuditStopRequested = true;
    officialDomainAuditAbortCurrent?.();
    officialDomainAuditAbortCurrent = null;
    if (officialDomainAuditWindow && !officialDomainAuditWindow.isDestroyed()) {
      officialDomainAuditWindow.destroy();
    }
    officialDomainAuditWindow = null;
  }
  return shouldResume;
}

// 이 앱은 GPU 가속이 필요하지 않으며 일부 Windows 그래픽 드라이버의
// GPU 프로세스 반복 종료를 피하기 위해 소프트웨어 렌더링을 사용합니다.
app.disableHardwareAcceleration();

function sendUpdateStatus(status, message, extra = {}) {
  mainWindow?.webContents.send("update:status", { status, message, currentVersion: app.getVersion(), ...extra });
}

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const UPDATE_RETRY_INTERVAL_MS = 15 * 60 * 1_000;
const UPDATE_INSTALL_RETRY_MS = 30 * 1_000;
const OFFICIAL_DOMAIN_AUDIT_PAGE_TIMEOUT_MS = 20_000;
const OFFICIAL_DOMAIN_AUDIT_ANALYSIS_TIMEOUT_MS = 8_000;
const OFFICIAL_DOMAIN_AUDIT_LOGO_TIMEOUT_MS = 10_000;
const OFFICIAL_DOMAIN_AUDIT_BRAND_TIMEOUT_MS = 45_000;
const OFFICIAL_DOMAIN_AUDIT_BETWEEN_BRANDS_MS = 750;
const OFFICIAL_DOMAIN_AUDIT_MAX_CANDIDATES = 2;

function scheduleUpdateCheck(delayMs = UPDATE_CHECK_INTERVAL_MS) {
  if (!app.isPackaged || updateReady) return;
  clearTimeout(updateCheckTimer);
  updateCheckTimer = setTimeout(() => {
    checkForUpdatesAutomatically().catch(() => {});
  }, delayMs);
}

async function checkForUpdatesAutomatically() {
  if (!app.isPackaged || updateCheckInFlight || updateReady) return { ok: true, skipped: true };
  updateCheckInFlight = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    scheduleUpdateCheck();
    return { ok: true, version: result?.updateInfo?.version || "" };
  } catch (error) {
    scheduleUpdateCheck(UPDATE_RETRY_INTERVAL_MS);
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    updateCheckInFlight = false;
  }
}

function hasActiveUpdateSensitiveWork() {
  return brandExportJobPending || brandExportMonitorRunning || brandDownloadStarted;
}

function installDownloadedUpdateWhenSafe() {
  clearTimeout(updateInstallTimer);
  if (!updateReady) return;
  if (hasActiveUpdateSensitiveWork()) {
    sendUpdateStatus("downloaded", "업데이트 준비 완료 · 현재 작업이 끝나면 자동 설치합니다.", {
      waitingForWork: true,
    });
    updateInstallTimer = setTimeout(installDownloadedUpdateWhenSafe, UPDATE_INSTALL_RETRY_MS);
    return;
  }
  sendUpdateStatus("installing", "업데이트를 자동 설치하고 다시 시작합니다.");
  updateInstallTimer = setTimeout(() => {
    if (updateReady) autoUpdater.quitAndInstall(true, true);
  }, 3_000);
}

function configureUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking", "새 버전을 확인하고 있습니다."));
  autoUpdater.on("update-available", (info) => sendUpdateStatus("downloading", `새 버전 ${info.version}을 자동으로 다운로드합니다.`, {
    version: info.version,
    releaseDate: info.releaseDate || ""
  }));
  autoUpdater.on("update-not-available", () => sendUpdateStatus("current", "현재 최신 버전입니다."));
  autoUpdater.on("download-progress", (info) => sendUpdateStatus("downloading", `업데이트 다운로드 ${Math.round(info.percent)}%`, { percent: info.percent }));
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    clearTimeout(updateCheckTimer);
    sendUpdateStatus("downloaded", `버전 ${info.version} 다운로드가 완료되었습니다.`, {
      version: info.version,
      releaseDate: info.releaseDate || ""
    });
    installDownloadedUpdateWhenSafe();
  });
  autoUpdater.on("error", (error) => {
    sendUpdateStatus("error", `업데이트 확인 실패: ${error.message}`);
    scheduleUpdateCheck(UPDATE_RETRY_INTERVAL_MS);
  });
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
    brandExportFolder: settings.brandExportFolder || "",
    hasAppSecret: Boolean(settings.appSecretEncrypted),
    hasAccessToken: Boolean(settings.accessTokenEncrypted)
  };
}

const SELLER_EXPORT_POLL_INTERVAL_MS = 60 * 1000;
const SELLER_MULTI_EXPORT_POLL_INTERVAL_MS = 10 * 1000;
const SELLER_EXPORT_MONITOR_DELAY_WARNING_MS = 20 * 60 * 1000;
const RESTORED_PENDING_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PROCESSED_BRAND_EXPORT_SUFFIX = "_총판매량50이상_OR_정리.xlsx";

function defaultBrandExportFolder() {
  return oneDriveBrandExportFolder()
    || join(app.getPath("desktop"), "Around G POIZON", "POIZON 전체내보내기");
}

function currentBrandExportFolder() {
  return String(store?.snapshot()?.settings?.brandExportFolder || "").trim()
    || defaultBrandExportFolder();
}

function oneDriveRootFolder() {
  return [process.env.OneDriveConsumer, process.env.OneDrive, process.env.OneDriveCommercial]
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
}

function oneDrivePoizonBackupRoot() {
  const root = oneDriveRootFolder();
  return root ? join(root, "Around G POIZON", "POIZON 다운로드 백업") : "";
}

function oneDriveBrandExportFolder() {
  const root = oneDrivePoizonBackupRoot();
  return root ? join(root, "브랜드 원본") : "";
}

function oneDrivePopularExportFolder() {
  const root = oneDrivePoizonBackupRoot();
  return root ? join(root, "인기상품 원본") : "";
}

function oneDriveInstallFolder() {
  const root = oneDriveRootFolder();
  return root ? join(root, "Around G POIZON", "설치 파일") : "";
}

function oneDriveSettingsFolder() {
  const root = oneDriveRootFolder();
  return root ? join(root, "Around G POIZON", "설정 복구") : "";
}

function portableBackupPath() {
  const folder = oneDriveSettingsFolder();
  return folder ? join(folder, "Around-G-POIZON-복구.json") : "";
}

function publicPortableSnapshot() {
  const snapshot = store.snapshot();
  const settings = { ...(snapshot.settings || {}) };
  for (const key of [
    "appSecretEncrypted", "accessTokenEncrypted", "brandExportFolder",
    "oneDrivePoizonBackupRoot", "brandExportJobCache", "brandExportFileValidationCache",
  ]) delete settings[key];
  return { ...snapshot, settings, collector: { status: "idle", lastPage: 0, lastFingerprint: "", repeatedPages: 0 } };
}

function setOneDriveBackupStatus(state, message, extra = {}) {
  oneDriveBackupStatus = { state, message, folder: oneDriveRootFolder(), ...extra };
  mainWindow?.webContents.send("backup:status", oneDriveBackupStatus);
}

async function writePortableOneDriveBackup() {
  const filePath = portableBackupPath();
  if (!filePath) throw new Error("ONEDRIVE_NOT_CONNECTED");
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, JSON.stringify(publicPortableSnapshot(), null, 2), "utf8");
  await rename(temporary, filePath);
  return filePath;
}

async function restorePortableOneDriveBackupIfFresh(hadLocalData) {
  if (hadLocalData) return { restored: false };
  const filePath = portableBackupPath();
  if (!filePath) return { restored: false };
  try {
    const backup = JSON.parse(await readFile(filePath, "utf8"));
    await store.restorePortableBackup(backup);
    return { restored: true, filePath };
  } catch (error) {
    if (error?.code === "ENOENT") return { restored: false };
    throw error;
  }
}

async function removeOldOneDriveInstallers(folder, keepName) {
  const entries = await readdir(folder, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === keepName || !/^Around-G-POIZON-Setup-.*\.exe$/i.test(entry.name)) continue;
    await unlink(join(folder, entry.name));
    removed += 1;
  }
  return removed;
}

async function backupCurrentInstallerToOneDrive() {
  const folder = oneDriveInstallFolder();
  if (!folder) throw new Error("ONEDRIVE_NOT_CONNECTED");
  await mkdir(folder, { recursive: true });
  const version = app.getVersion();
  const fileName = `Around-G-POIZON-Setup-${version}.exe`;
  const destination = join(folder, fileName);
  const existing = await stat(destination).catch(() => null);
  if (!existing?.size) {
    const url = `https://github.com/7venik-bit/around-g-poizon-desktop/releases/download/v${version}/${fileName}`;
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60 * 1_000) });
    if (!response.ok) throw new Error(`INSTALLER_DOWNLOAD_${response.status}`);
    const temporary = `${destination}.download`;
    await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
    await rename(temporary, destination);
  }
  const removed = await removeOldOneDriveInstallers(folder, fileName);
  await writeFile(join(folder, "새 PC 설치 안내.txt"), [
    "Around G POIZON 새 PC 설치 안내", "", `1. ${fileName} 파일을 실행합니다.`,
    "2. 기존 PC와 같은 OneDrive 계정으로 로그인합니다.",
    "3. 프로그램을 처음 실행하면 설정과 POIZON 자료를 자동 복구합니다.",
    "4. POIZON 및 외부 사이트 로그인은 보안을 위해 새 PC에서 다시 진행합니다.",
  ].join("\r\n"), "utf8");
  return { destination, removed };
}

async function runOneDriveRecoveryBackup() {
  if (!oneDriveRootFolder()) {
    setOneDriveBackupStatus("disconnected", "OneDrive 로그인이 필요합니다. 백업이 중지되었습니다.");
    return { ok: false, ...oneDriveBackupStatus };
  }
  try {
    setOneDriveBackupStatus("syncing", "OneDrive에 최신 설치본과 설정을 백업하고 있습니다.");
    const settingsPath = await writePortableOneDriveBackup();
    const installer = app.isPackaged ? await backupCurrentInstallerToOneDrive() : { destination: "", removed: 0 };
    setOneDriveBackupStatus("connected", "최신 설치본 1개와 설정이 안전하게 백업되었습니다.", {
      settingsPath, installerPath: installer.destination, removedInstallers: installer.removed,
    });
    return { ok: true, ...oneDriveBackupStatus };
  } catch (error) {
    setOneDriveBackupStatus("warning", `OneDrive 백업 확인 필요: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, ...oneDriveBackupStatus };
  }
}

function sameFolder(left = "", right = "") {
  return resolve(String(left || "")).toLocaleLowerCase() === resolve(String(right || "")).toLocaleLowerCase();
}

function safeBrandExportLabel(value = "") {
  return String(brandExportLabel(value) || "POIZON")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim() || "POIZON";
}

function brandExportFolderName(brandName = "", jobId = "") {
  const safeBrand = safeBrandExportLabel(brandName);
  const safeJobId = String(jobId || "").replace(/[^0-9]/g, "").trim();
  return safeJobId ? `${safeBrand}_${safeJobId}` : safeBrand;
}

function parseBrandExportFolderName(folderName = "") {
  const normalized = String(folderName || "").trim();
  const matched = normalized.match(/^(.*)_([0-9]{7,})$/);
  return matched
    ? { brandName: String(matched[1] || "").trim(), jobId: matched[2] }
    : { brandName: normalized, jobId: "" };
}


async function listBrandExportExcelEntries(folder) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.xlsx$/i.test(entry.name) && !entry.name.startsWith("~$")) {
        files.push({ path, name: entry.name, directory });
      }
    }
  }
  await visit(folder);
  return files;
}

async function copyExcelTree(sourceFolder, destinationFolder) {
  if (!sourceFolder || !destinationFolder || sameFolder(sourceFolder, destinationFolder)) return 0;
  let entries = [];
  try {
    entries = await listBrandExportExcelEntries(sourceFolder);
  } catch {
    return 0;
  }
  let copied = 0;
  for (const entry of entries) {
    const nestedPath = relative(sourceFolder, entry.path);
    if (!nestedPath || nestedPath.startsWith("..")) continue;
    const destination = join(destinationFolder, nestedPath);
    await mkdir(dirname(destination), { recursive: true });
    const sourceInfo = await stat(entry.path);
    const destinationInfo = await stat(destination).catch(() => null);
    if (destinationInfo?.size === sourceInfo.size) continue;
    await copyFile(entry.path, destination);
    copied += 1;
  }
  return copied;
}

async function initializeOneDrivePoizonBackup() {
  const backupRoot = oneDrivePoizonBackupRoot();
  const brandFolder = oneDriveBrandExportFolder();
  const popularFolder = oneDrivePopularExportFolder();
  if (!backupRoot || !brandFolder || !popularFolder) return { enabled: false, copied: 0 };
  await mkdir(brandFolder, { recursive: true });
  await mkdir(popularFolder, { recursive: true });
  const previousBrandFolder = String(store.snapshot().settings.brandExportFolder || "").trim()
    || join(app.getPath("desktop"), "Around G POIZON", "POIZON 전체내보내기");
  const copiedBrands = await copyExcelTree(previousBrandFolder, brandFolder);
  const legacyPopularFolder = join(app.getPath("desktop"), "Around G POIZON");
  let copiedPopular = 0;
  try {
    const entries = await readdir(legacyPopularFolder, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/^POIZON-인기상품-원본-.*\.xlsx$/i.test(entry.name)) continue;
      const source = join(legacyPopularFolder, entry.name);
      const destination = join(popularFolder, entry.name);
      const sourceInfo = await stat(source);
      const destinationInfo = await stat(destination).catch(() => null);
      if (destinationInfo?.size === sourceInfo.size) continue;
      await copyFile(source, destination);
      copiedPopular += 1;
    }
  } catch {
    // A fresh installation may not have any desktop POIZON files yet.
  }
  await store.setSettings({
    brandExportFolder: brandFolder,
    oneDrivePoizonBackupRoot: backupRoot,
    oneDrivePoizonBackupEnabled: true,
  });
  return { enabled: true, copied: copiedBrands + copiedPopular, folder: backupRoot };
}

function brandFromExportFileName(name = "") {
  return String(name)
    .replace(/\.xlsx$/i, "")
    .replace(/_총판매량50이상_OR_정리$/i, "")
    .replace(/_판매량30이상_정리$/i, "")
    .replace(/_\d{8}_\d{6}$/, "")
    .trim();
}

function isProcessedBrandExportName(name = "") {
  return /_(?:총판매량50이상_OR|판매량30이상)_정리\.xlsx$/i.test(String(name));
}

function isPartialBrandExportName(name = "") {
  return /_부분다운로드_\d+_of_\d+_/i.test(String(name));
}

function processedBrandExportName(name = "") {
  const sourceName = String(name || "POIZON.xlsx");
  return sourceName.replace(/\.xlsx$/i, PROCESSED_BRAND_EXPORT_SUFFIX);
}

async function validateBrandExportFile(filePath, expectedBrands = []) {
  const info = await stat(filePath);
  const signature = `${filePath}:${info.mtimeMs}:${info.size}`;
  if (brandExportValidationCache.has(signature)) return brandExportValidationCache.get(signature);
  const saved = store?.snapshot()?.settings?.brandExportFileValidationCache;
  const savedEntry = Array.isArray(saved)
    ? saved.find((entry) => String(entry?.signature || "") === signature)
    : null;
  if (savedEntry?.result) {
    brandExportValidationCache.set(signature, savedEntry.result);
    return savedEntry.result;
  }
  const fileBuffer = await readFile(filePath);
  const brandColumn = readPoizonColumnValues(fileBuffer, "상품 브랜드", "브랜드");
  const observedBrands = brandColumn.values;
  const integrity = analyzeBrandValues(expectedBrands, observedBrands);
  const result = {
    ...integrity,
    status: integrity.ok ? "matched" : "mismatch",
    message: integrity.ok ? "선택 브랜드와 Excel 브랜드가 일치합니다." : brandMismatchMessage(integrity),
  };
  brandExportValidationCache.set(signature, result);
  const nextCache = [
    { signature, result },
    ...(Array.isArray(saved) ? saved : []).filter((entry) => String(entry?.signature || "") !== signature),
  ].slice(0, 500);
  await store?.setSettings({ brandExportFileValidationCache: nextCache });
  return result;
}

async function listBrandExportFiles() {
  const folder = currentBrandExportFolder();
  await mkdir(folder, { recursive: true });
  const entries = await listBrandExportExcelEntries(folder);
  const preparedEntries = await Promise.all(entries
    .filter((entry) => !isProcessedBrandExportName(entry.name) && !isPartialBrandExportName(entry.name))
    .map(async (entry) => ({ entry, info: await stat(entry.path) })));
  preparedEntries.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);
  const usedJobIds = new Set();
  const files = [];
  for (const { entry, info } of preparedEntries) {
    const path = entry.path;
    const folderMeta = entry.directory === folder
      ? { brandName: "", jobId: "" }
      : parseBrandExportFolderName(basename(entry.directory));
    const expectedBrand = folderMeta.brandName || brandFromExportFileName(entry.name);
    const savedJob = savedBrandExportJobForFile({
      path,
      name: entry.name,
      brandName: expectedBrand,
      mtimeMs: info.mtimeMs,
    }, usedJobIds);
    const recoveredJobId = String(folderMeta.jobId || savedJob?.jobId || "").trim();
    if (recoveredJobId) usedJobIds.add(recoveredJobId);
    const brandIntegrity = await validateBrandExportFile(path, [expectedBrand]).catch((error) => ({
      ok: false,
      status: "invalid",
      expectedBrand,
      dominantBrand: "",
      ratio: 0,
      message: `Excel 브랜드 확인 실패: ${error instanceof Error ? error.message : String(error)}`,
    }));
    const detectedBrand = String(brandIntegrity?.dominantBrand || "").trim();
    const resolvedBrandName = detectedBrand || expectedBrand;
    if (recoveredJobId && resolvedBrandName
      && !brandsMatch(resolvedBrandName, savedJob?.brandName)) {
      await rememberBrandExportJob({
        jobId: recoveredJobId,
        brandName: resolvedBrandName,
        createdAt: Number(savedJob?.createdAt || info.mtimeMs),
        lastDownloadedAt: Number(savedJob?.lastDownloadedAt || info.mtimeMs),
        expectedProductCount: Number(savedJob?.expectedProductCount || 0),
        filePath: path,
        fileName: entry.name,
        fileMtimeMs: info.mtimeMs,
      });
    }
    files.push({
      path,
      name: entry.name,
      brandName: resolvedBrandName,
      detectedBrandName: detectedBrand,
      brandIntegrity,
      jobId: recoveredJobId,
      jobIdRecovered: Boolean(recoveredJobId),
      time: info.mtimeMs,
      mtimeMs: info.mtimeMs,
      size: info.size,
    });
  }
  const visibleFiles = files.filter((file) => !isProcessedBrandExportName(file.name));
  visibleFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { ok: true, folder, files: visibleFiles };
}

function excelPreviewCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : String(value);
}

function buildExcelPreviewProducts(headers = [], entries = []) {
  const column = (...names) => findPoizonColumn(headers, ...names);
  const columns = {
    spuId: column("SPU ID", "SPU_ID"), image: column("SPU 이미지", "상품 이미지", "이미지"),
    articleNumber: column("상품 번호", "상품번호", "품번"), title: column("상품명", "영문 상품명"),
    brand: column("상품 브랜드", "브랜드"), category1: column("카테고리 대분류", "대분류"),
    category2: column("카테고리 중분류", "중분류"), category3: column("카테고리 소분류", "소분류"),
    averagePrice: column("최근 30일간 평균 거래가", "최근 30일 평균 거래가"),
    sales30d: column("최근 30일 판매량", "최근30일판매량"),
    localSales30d: column("현지 판매자 최근 30일 판매량", "현지판매자최근30일판매량"),
    totalSales: column("중국 총 판매량", "총 판매량"),
    localTotalSales: column("현지 판매자 총 판매량", "현지판매자총판매량"),
    option: column("사이즈/옵션/색상", "옵션"), skuId: column("SKU ID", "SKU_ID"),
  };
  const cell = (row, index) => index >= 0 ? row[index] : "";
  const raw = (row, index) => String(cell(row, index) ?? "").trim();
  const grouped = new Map();
  for (const entry of entries) {
    const row = entry.values || [];
    const spuId = raw(row, columns.spuId);
    const articleNumber = raw(row, columns.articleNumber);
    const title = raw(row, columns.title);
    if (!spuId && !articleNumber && !title) continue;
    const key = articleNumber ? `ARTICLE:${articleNumber.toUpperCase()}` : spuId ? `SPU:${spuId}` : `ROW:${entry.sourceRowNumber}`;
    const previous = grouped.get(key) || { optionKeys: new Set(), variants: [] };
    const optionKey = raw(row, columns.skuId) || raw(row, columns.option) || String(entry.sourceRowNumber);
    previous.optionKeys.add(optionKey);
    const variant = {
      totalSales: parsePoizonSalesMetric(cell(row, columns.totalSales)), totalSalesRaw: raw(row, columns.totalSales),
      localTotalSales: parsePoizonSalesMetric(cell(row, columns.localTotalSales)), localTotalSalesRaw: raw(row, columns.localTotalSales),
      sales30d: parsePoizonSalesMetric(cell(row, columns.sales30d)), sales30dRaw: raw(row, columns.sales30d),
      localSales30d: parsePoizonSalesMetric(cell(row, columns.localSales30d)), localSales30dRaw: raw(row, columns.localSales30d),
    };
    previous.variants.push(variant);
    Object.assign(previous, {
      key, spuId: previous.spuId || spuId, articleNumber: previous.articleNumber || articleNumber,
      title: previous.title || title, brandName: previous.brandName || raw(row, columns.brand),
      logoUrl: previous.logoUrl || raw(row, columns.image),
      categoryName: previous.categoryName || [columns.category1, columns.category2, columns.category3].map((index) => raw(row, index)).filter(Boolean).join(" / "),
      averagePrice: Math.max(Number(previous.averagePrice || 0), parsePoizonSalesMetric(cell(row, columns.averagePrice))),
    });
    grouped.set(key, previous);
  }
  return [...grouped.values()].map((product) => {
    const representative = product.variants.reduce((best, variant) => !best
      || variant.localTotalSales > best.localTotalSales
      || (variant.localTotalSales === best.localTotalSales && variant.totalSales > best.totalSales) ? variant : best, null) || {};
    return {
      key: product.key, spuId: product.spuId || "", articleNumber: product.articleNumber || "", title: product.title || "",
      brandName: product.brandName || "", logoUrl: product.logoUrl || "", categoryName: product.categoryName || "",
      averagePrice: product.averagePrice || 0, optionCount: product.optionKeys.size,
      totalSales: representative.totalSales || 0, totalSalesRaw: representative.totalSalesRaw || "",
      localTotalSales: representative.localTotalSales || 0, localTotalSalesRaw: representative.localTotalSalesRaw || "",
      sales30d: representative.sales30d || 0, sales30dRaw: representative.sales30dRaw || "",
      localSales30d: representative.localSales30d || 0, localSales30dRaw: representative.localSales30dRaw || "",
    };
  });
}

async function previewExcelFile(input = {}) {
  const filePath = String(input.path || "").trim();
  if (!filePath) return { ok: false, message: "파일 경로가 없습니다." };
  if (!/\.xlsx$/i.test(filePath)) return { ok: false, message: "Excel(.xlsx) 파일만 볼 수 있습니다." };
  const info = await stat(filePath);
  const signature = `${filePath}:${info.mtimeMs}:${info.size}`;
  let workbook = excelPreviewCache.get(signature);
  if (!workbook) {
    const rows = await readFirstDataSheet(await readFile(filePath));
    const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    workbook = {
      headers: Array.from({ length: columnCount }, (_unused, index) => excelPreviewCell(rows[0]?.[index]) || `열 ${index + 1}`),
      rows: rows.slice(1).map((row) => Array.from({ length: columnCount }, (_unused, index) => excelPreviewCell(row[index]))),
      columnCount,
    };
    excelPreviewCache.set(signature, workbook);
    while (excelPreviewCache.size > 3) excelPreviewCache.delete(excelPreviewCache.keys().next().value);
  }
  const filtered = filterPoizonPreviewRows(workbook.headers, workbook.rows, input.filters || {});
  const limit = Math.min(200, Math.max(25, Number(input.limit) || 100));
  const productView = input.filters?.productView !== false;
  const products = productView ? buildExcelPreviewProducts(workbook.headers, filtered.entries) : [];
  const sourceTotalProducts = productView ? buildExcelPreviewProducts(workbook.headers, workbook.rows.map((values, index) => ({ values, sourceRowNumber: index + 2 }))).length : 0;
  const resultCount = productView ? products.length : filtered.entries.length;
  const maximumOffset = Math.max(0, Math.floor(Math.max(0, resultCount - 1) / limit) * limit);
  const offset = Math.min(maximumOffset, Math.max(0, Number(input.offset) || 0));
  const pageEntries = filtered.entries.slice(offset, offset + limit);
  const pageProducts = products.slice(offset, offset + limit);
  return {
    ok: true,
    path: filePath,
    name: basename(filePath),
    headers: workbook.headers,
    rows: productView ? [] : pageEntries.map((entry) => entry.values),
    rowNumbers: productView ? [] : pageEntries.map((entry) => entry.sourceRowNumber),
    products: pageProducts,
    productView,
    offset,
    limit,
    totalRows: resultCount,
    filteredSourceRows: filtered.entries.length,
    sourceTotalRows: filtered.sourceRows,
    sourceTotalProducts,
    totalColumns: workbook.columnCount,
    totalSalesColumn: filtered.totalSalesColumn,
    localTotalSalesColumn: filtered.localTotalSalesColumn,
    filterApplied: filtered.filterApplied,
    matchMode: filtered.matchMode,
  };
}

async function scanBrandExportFolder() {
  const folder = currentBrandExportFolder();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // The will-download handler owns files created by the active POIZON job.
  // Polling a partially written file can otherwise attach the previous job's
  // brand before the completed download is validated.
  if (brandDownloadStarted) return;
  try {
    const entries = await listBrandExportExcelEntries(folder);
    const candidates = await Promise.all(entries
      .filter((entry) => !isProcessedBrandExportName(entry.name))
      .map(async (entry) => {
        const path = entry.path;
        const info = await stat(path);
        return { path, name: entry.name, directory: entry.directory, mtimeMs: info.mtimeMs, size: info.size };
      }));
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const newest = candidates.find((candidate) => !brandDownloadPathsInProgress.has(candidate.path));
    if (!newest) return;
    const signature = `${newest.path}:${newest.mtimeMs}:${newest.size}`;
    if (lastBrandExportSignature === "__BASELINE_EXISTING_FILES__") {
      lastBrandExportSignature = signature;
      return;
    }
    if (signature === lastBrandExportSignature) return;
    lastBrandExportSignature = signature;
    const folderMeta = newest.directory === folder
      ? { brandName: "", jobId: "" }
      : parseBrandExportFolderName(basename(newest.directory));
    const expectedBrand = folderMeta.brandName || brandFromExportFileName(newest.name);
    if (!expectedBrand) return;
    const matchingJobs = [...brandExportJobs.entries()].filter(([_jobId, job]) =>
      brandsMatch(job?.brandName, expectedBrand)
      || brandsMatch(job?.brandKo, expectedBrand)
    );
    const folderJobId = folderMeta.jobId && brandExportJobs.has(folderMeta.jobId)
      ? folderMeta.jobId
      : "";
    const matchedJobId = folderJobId || (matchingJobs.length === 1 ? matchingJobs[0][0] : "");
    // Existing files can receive a new OneDrive modification timestamp after
    // startup. Only a file tied to one current POIZON job may emit a live
    // completion event; historical files are restored through list-files.
    if (!matchedJobId) return;
    const brandIntegrity = await validateBrandExportFile(newest.path, [expectedBrand]).catch((error) => ({
      ok: false,
      status: "invalid",
      expectedBrand,
      dominantBrand: "",
      ratio: 0,
      message: `Excel 브랜드 확인 실패: ${error instanceof Error ? error.message : String(error)}`,
    }));
    mainWindow.webContents.send("brand-export:detected", {
      ...newest,
      brandName: expectedBrand,
      jobId: matchedJobId,
      brandIntegrity,
    });
  } catch (error) {
    mainWindow.webContents.send("brand-export:error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function startBrandExportFolderPolling() {
  if (brandExportPollTimer) clearInterval(brandExportPollTimer);
  brandExportPollTimer = setInterval(scanBrandExportFolder, 3000);
  setTimeout(scanBrandExportFolder, 500);
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
    icon: APP_ICON_PATH,
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

function openInventoryWindow(filePath, brandName = "") {
  const inventoryWindow = new BrowserWindow({
    icon: APP_ICON_PATH,
    width: 1380,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f3f9ff",
    title: `${brandName || "POIZON"} 국내 재고·사이즈 확인`,
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  inventoryWindows.add(inventoryWindow);
  inventoryWindow.on("closed", () => inventoryWindows.delete(inventoryWindow));
  inventoryWindow.loadFile(join(import.meta.dirname, "src", "inventory.html"), {
    query: { path: filePath, brand: brandName },
  });
}

function showCollectorWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function minimizeSellerAutomationWindow(message = "POIZON 판매자센터를 백그라운드에서 실행 중입니다.") {
  if (!sellerWindow || sellerWindow.isDestroyed()) return;
  sellerWindow.showInactive();
  if (!sellerWindow.isMinimized()) sellerWindow.minimize();
  showCollectorWindow();
  mainWindow?.webContents.send("seller:capture-progress", {
    background: true,
    message,
  });
}

function localFileTimestamp(date = new Date()) {
  const two = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}_${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

function isPoizonExportDownloadUrl(value = "") {
  try {
    const url = new URL(String(value));
    const hostname = url.hostname.toLowerCase();
    const pathname = decodeURIComponent(url.pathname).toLowerCase();
    return /\.xlsx(?:$|[?#])/i.test(url.href)
      || pathname.includes("/intl-taskcenter/")
      || (hostname.endsWith(".aliyuncs.com") && /poizon|dewu|oss-accelerate/.test(hostname));
  } catch {
    return false;
  }
}

function openSellerCenterWindow(targetUrl = SELLER_CENTER_URL, options = {}) {
  const visible = options.visible !== false;
  const activate = options.activate !== false;
  const deferNavigation = options.deferNavigation === true;
  if (sellerWindow && !sellerWindow.isDestroyed()) {
    if (visible) {
      if (activate) {
        sellerWindow.show();
        sellerWindow.focus();
      } else {
        sellerWindow.showInactive();
      }
    } else {
      sellerWindow.hide();
      showCollectorWindow();
    }
    if (!deferNavigation && targetUrl && sellerWindow.webContents.getURL() !== targetUrl) {
      sellerWindow.loadURL(targetUrl);
    }
    return;
  }
  sellerWindow = new BrowserWindow({
    icon: APP_ICON_PATH,
    show: visible && activate,
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
      backgroundThrottling: false,
    },
  });
  const sellerSession = sellerWindow.webContents.session;
  if (!sellerDownloadSessions.has(sellerSession)) {
    sellerSession.on("will-download", (_event, item) => {
    const sessionGeneration = brandWorkSessionGeneration;
    const requestedJobs = [...brandExportJobs.entries()]
      .filter(([_jobId, job]) => Number(job?.downloadRequestedAt || 0) > 0 && !job?.downloadStarted)
      .sort((left, right) => Number(left[1].downloadRequestedAt) - Number(right[1].downloadRequestedAt));
    const lockedJobId = activeBrandDownloadJobId && brandExportJobs.has(activeBrandDownloadJobId)
      ? activeBrandDownloadJobId
      : "";
    const downloadJobId = lockedJobId
      || requestedJobs[0]?.[0]
      || (brandExportJobs.size === 1 ? [...brandExportJobs.keys()][0] : "");
    const downloadJob = brandExportJobs.get(downloadJobId);
    if (!downloadJobId || !downloadJob) {
      mainWindow?.webContents.send("brand-export:error", {
        message: "다운로드 파일과 브랜드 작업번호를 안전하게 연결하지 못해 자동 저장을 중단했습니다.",
      });
      item.cancel();
      return;
    }
    activeBrandDownloadJobId = downloadJobId;
    downloadJob.downloadStarted = true;
    brandDownloadStarted = true;
    const folder = currentBrandExportFolder();
    // Electron must receive the destination before this event handler yields.
    // Waiting for an async mkdir here lets Windows open its Save As dialog first.
    const exportBrand = safeBrandExportLabel(downloadJob.brandName);
    const brandFolder = join(folder, brandExportFolderName(exportBrand, downloadJobId));
    mkdirSync(brandFolder, { recursive: true });
    const safeBrand = exportBrand;
    const fileName = safeBrand
      ? `${downloadJobId}_${safeBrand}_${localFileTimestamp()}.xlsx`
      : `${downloadJobId}_POIZON_${localFileTimestamp()}.xlsx`;
    const filePath = join(brandFolder, fileName);
    brandDownloadPathsInProgress.add(filePath);
    item.setSavePath(filePath);
    mainWindow?.webContents.send("brand-export:progress", {
      status: "download-started",
      brandName: downloadJob.brandName,
      jobId: downloadJobId,
      jobState: "4단계/5 · Excel 다운로드 중",
      message: `${downloadJob.brandName || "선택 브랜드"} · 4단계/5 · Excel 다운로드를 시작했습니다.`,
    });
    item.once("done", async (_doneEvent, state) => {
      if (sessionGeneration !== brandWorkSessionGeneration) return;
      if (state === "completed") {
        let finalPath = filePath;
        let finalName = fileName;
        const expectedProductCount = Number(downloadJob.expectedProductCount || 0);
        const fileBuffer = await readFile(filePath);
        const workbook = await readSheet(repairPoizonWorksheetDimensions(fileBuffer));
        const workbookSummary = summarizePoizonRows(getPoizonWorksheetRows(workbook));
        const actualProductCount = workbookSummary.dataRowCount;
        const summaryLabel = `전체 행 ${actualProductCount.toLocaleString("ko-KR")}개 · 고유 SPU ${workbookSummary.uniqueSpuCount.toLocaleString("ko-KR")}개 · 중복 ${workbookSummary.duplicateSpuCount.toLocaleString("ko-KR")}개 · 빈 SPU ${workbookSummary.blankSpuCount.toLocaleString("ko-KR")}개`;
        if (expectedProductCount > 0 && actualProductCount < expectedProductCount) {
          const partialName = `${safeBrand}_부분다운로드_${actualProductCount}_of_${expectedProductCount}_rows_${localFileTimestamp()}.xlsx`;
          const partialPath = join(brandFolder, partialName);
          try {
            await rename(filePath, partialPath);
            finalPath = partialPath;
            finalName = partialName;
          } catch {
            // Preserve the original downloaded workbook even if Windows keeps it locked.
          }
          mainWindow?.webContents.send("brand-export:progress", {
            status: "partial-download",
            brandName: downloadJob.brandName,
            jobId: downloadJobId,
            jobState: `부분 다운로드 ${actualProductCount}/${expectedProductCount}행 · 실패`,
            message: `${downloadJob.brandName || "선택 브랜드"} 부분 다운로드 ${actualProductCount.toLocaleString("ko-KR")}/${expectedProductCount.toLocaleString("ko-KR")}행 · ${summaryLabel} · 확인완료로 처리하지 않습니다.`,
          });
          mainWindow?.webContents.send("brand-export:error", {
            brandName: downloadJob.brandName,
            jobId: downloadJobId,
            jobState: `부분 다운로드 ${actualProductCount}/${expectedProductCount}행 · 실패`,
            message: `${downloadJob.brandName || "선택 브랜드"} Excel이 ${actualProductCount.toLocaleString("ko-KR")}/${expectedProductCount.toLocaleString("ko-KR")}행만 포함해 부분 파일로 보존했습니다. ${summaryLabel}`,
            path: finalPath,
            name: finalName,
          });
          brandExportJobs.delete(downloadJobId);
          if (activeBrandDownloadJobId === downloadJobId) activeBrandDownloadJobId = "";
          brandDownloadPathsInProgress.delete(filePath);
          brandDownloadStarted = false;
          if (brandExportJobs.size) scheduleBrandExportMonitor(500);
          else emitBrandExportAllComplete();
          return;
        }
        const brandIntegrity = await validateBrandExportFile(filePath, [
          downloadJob.brandName,
          downloadJob.brandKo,
        ]).catch((error) => ({
          ok: false,
          status: "invalid",
          expectedBrand: downloadJob.brandName,
          dominantBrand: "",
          ratio: 0,
          message: `Excel 브랜드 확인 실패: ${error instanceof Error ? error.message : String(error)}`,
        }));
        const detectedBrand = brandIntegrity.dominantBrand
          ? safeBrandExportLabel(brandIntegrity.dominantBrand)
          : exportBrand;
        const detectedMatchesRequested = Boolean(detectedBrand) && [
          downloadJob.brandName,
          downloadJob.brandKo,
        ].filter(Boolean).some((expected) => brandsMatch(detectedBrand, expected));
        const resolvedBrandName = detectedMatchesRequested
          ? downloadJob.brandName
          : detectedBrand || downloadJob.brandName || exportBrand;
        if (detectedBrand && !detectedMatchesRequested && detectedBrand !== exportBrand) {
          const detectedFolder = join(folder, brandExportFolderName(detectedBrand, downloadJobId));
          await mkdir(detectedFolder, { recursive: true });
          finalName = `${detectedBrand}_${localFileTimestamp()}.xlsx`;
          const detectedPath = join(detectedFolder, finalName);
          try {
            await rename(filePath, detectedPath);
            finalPath = detectedPath;
          } catch {
            // Keep the completed workbook in its original requested-brand folder
            // if Windows temporarily locks the file while the download closes.
            finalName = fileName;
          }
        }
        const info = await stat(finalPath);
        lastBrandExportSignature = `${finalPath}:${info.mtimeMs}:${info.size}`;
        await rememberBrandExportJob({
          jobId: downloadJobId,
          brandName: resolvedBrandName,
          createdAt: downloadJob.createdAt,
          lastDownloadedAt: Date.now(),
          expectedProductCount,
          filePath: finalPath,
          fileName: finalName,
          fileMtimeMs: info.mtimeMs,
          sessionGeneration,
        });
        mainWindow?.webContents.send("brand-export:detected", {
          path: finalPath,
          name: finalName,
          brandName: resolvedBrandName,
          detectedBrandName: detectedMatchesRequested ? "" : detectedBrand || "",
          jobId: downloadJobId,
          size: info.size,
          time: info.mtimeMs,
          brandIntegrity,
          workbookSummary,
        });
      } else {
        mainWindow?.webContents.send("brand-export:error", {
          message: `브랜드 데이터 저장 실패: ${state}`,
        });
      }
      brandExportJobs.delete(downloadJobId);
      if (activeBrandDownloadJobId === downloadJobId) activeBrandDownloadJobId = "";
      brandDownloadPathsInProgress.delete(filePath);
      brandDownloadStarted = false;
      if (brandExportJobs.size) scheduleBrandExportMonitor(500);
      else emitBrandExportAllComplete();
    });
    });
    sellerDownloadSessions.add(sellerSession);
  }
  sellerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isPoizonExportDownloadUrl(url) || /^https:\/\/seller\.poizon\.com\//i.test(url)) {
      sellerWindow?.webContents.downloadURL(url);
    } else if (/^https:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  sellerWindow.webContents.on("will-navigate", (event, url) => {
    if (!isPoizonExportDownloadUrl(url)) return;
    event.preventDefault();
    sellerWindow?.webContents.downloadURL(url);
  });
  sellerWindow.on("closed", () => {
    sellerWindow = null;
    brandExportJobPending = false;
  });
  if (visible && !activate) {
    sellerWindow.once("ready-to-show", () => {
      if (sellerWindow && !sellerWindow.isDestroyed()) sellerWindow.showInactive();
    });
  }
  if (!deferNavigation && targetUrl) sellerWindow.loadURL(targetUrl);
  if (!visible) showCollectorWindow();
}

async function waitForSellerExportAndDownload() {
  await new Promise((resolve) => setTimeout(resolve, 1800));
  if (!sellerWindow || sellerWindow.isDestroyed()) return;
  if (!sellerWindow.webContents.getURL().includes("/main/exportCenter")) {
    await sellerWindow.loadURL(SELLER_EXPORT_CENTER_URL);
  }
  while (true) {
    if (!sellerWindow || sellerWindow.isDestroyed()) return;
    const result = await sellerWindow.webContents.executeJavaScript(`(() => {
      const visible = (element) => element && element.getBoundingClientRect().width > 0
        && element.getBoundingClientRect().height > 0;
      const rows = [...document.querySelectorAll("tr, [role='row']")].filter(visible);
      const exportRows = rows.filter((row) =>
        /상품검색\\s*내보내기/.test(String(row.innerText || row.textContent || ""))
      );
      const row = exportRows[0];
      if (!row) return { state: "WAITING_FOR_ROW" };
      const text = String(row.innerText || row.textContent || "").replace(/\\s+/g, " ").trim();
      const download = [...row.querySelectorAll("a, button, [role='button']")]
        .find((element) => visible(element)
          && /^다운로드$/.test(String(element.innerText || element.textContent || "").trim()));
      if (download && /성공/.test(text)) {
        download.click();
        return { state: "DOWNLOAD_CLICKED" };
      }
      return { state: /처리\\s*중/.test(text) ? "PROCESSING" : "WAITING" };
    })()`, true).catch(() => ({ state: "PAGE_NOT_READY" }));
    if (result?.state === "DOWNLOAD_CLICKED") return;
    await new Promise((resolve) => setTimeout(resolve, SELLER_EXPORT_POLL_INTERVAL_MS));
    if (!sellerWindow || sellerWindow.isDestroyed()) return;
    if (!sellerWindow.webContents.getURL().includes("/main/exportCenter")) {
      await sellerWindow.loadURL(SELLER_EXPORT_CENTER_URL);
    } else {
      await sellerWindow.webContents.reloadIgnoringCache();
    }
  }
}

async function waitForSellerExportAndAutoDownload() {
  let lastReloadAt = 0;
  await new Promise((resolve) => setTimeout(resolve, 1800));
  if (!sellerWindow || sellerWindow.isDestroyed()) return;
  if (!sellerWindow.webContents.getURL().includes("/main/exportCenter")) {
    await sellerWindow.loadURL(SELLER_EXPORT_CENTER_URL);
    lastReloadAt = Date.now();
  }
  while (true) {
    if (!sellerWindow || sellerWindow.isDestroyed()) return;
    const result = await sellerWindow.webContents.executeJavaScript(`(() => {
      const visible = (element) => element && element.getBoundingClientRect().width > 0
        && element.getBoundingClientRect().height > 0;
      const textOf = (element) => String(element?.innerText || element?.textContent || "")
        .replace(/\\s+/g, " ").trim();
      const isDownload = (element) => {
        const description = [
          textOf(element),
          element?.getAttribute?.("aria-label"),
          element?.getAttribute?.("title"),
          element?.getAttribute?.("href"),
        ].filter(Boolean).join(" ");
        return /\\uB2E4\\uC6B4\\uB85C\\uB4DC/i.test(description)
          || /download|export/i.test(description);
      };
      const enabled = (element) => !element.disabled
        && element.getAttribute("aria-disabled") !== "true"
        && !element.classList.contains("disabled");
      const rows = [...document.querySelectorAll("tbody tr, tr, [role='row']")].filter(visible);
      for (const row of rows) {
        const controls = [...row.querySelectorAll("a, button, [role='button']")]
          .filter((element) => visible(element) && enabled(element) && isDownload(element));
        if (!controls.length) continue;
        const rowText = textOf(row);
        if (/\\uCC98\\uB9AC\\s*\\uC911|processing|pending/i.test(rowText)) continue;
        const control = controls[controls.length - 1];
        control.scrollIntoView({ block: "center" });
        control.click();
        return { state: "DOWNLOAD_CLICKED" };
      }
      return { state: rows.length ? "PROCESSING" : "WAITING_FOR_ROW" };
    })()`, true).catch(() => ({ state: "PAGE_NOT_READY" }));
    if (result?.state === "DOWNLOAD_CLICKED") return;
    await new Promise((resolve) => setTimeout(resolve, SELLER_EXPORT_POLL_INTERVAL_MS));
    if (!sellerWindow || sellerWindow.isDestroyed()) return;
    if (!sellerWindow.webContents.getURL().includes("/main/exportCenter")) {
      await sellerWindow.loadURL(SELLER_EXPORT_CENTER_URL);
      lastReloadAt = Date.now();
    } else if (Date.now() - lastReloadAt >= SELLER_EXPORT_POLL_INTERVAL_MS) {
      await sellerWindow.webContents.reloadIgnoringCache();
      lastReloadAt = Date.now();
    }
  }
}

async function watchLatestSellerExportEveryTenSeconds() {
  const pollIntervalMs = SELLER_EXPORT_POLL_INTERVAL_MS;
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  if (!sellerWindow || sellerWindow.isDestroyed()) return;
  if (!sellerWindow.webContents.getURL().includes("/main/exportCenter")) {
    await sellerWindow.loadURL(SELLER_EXPORT_CENTER_URL);
  }

  while (true) {
    if (brandDownloadStarted) return;
    if (!sellerWindow || sellerWindow.isDestroyed()) return;
    const result = await sellerWindow.webContents.executeJavaScript(`(() => {
      const expectedJobId = ${JSON.stringify(pendingBrandExportJobId)};
      const visible = (element) => element && element.getBoundingClientRect().width > 0
        && element.getBoundingClientRect().height > 0;
      const textOf = (element) => String(element?.innerText || element?.textContent || "")
        .replace(/\\s+/g, " ").trim();
      const rows = [...document.querySelectorAll("tbody tr, [role='row'], tr")]
        .filter(visible)
        .filter((row) => /\\uC0C1\\uD488\\uAC80\\uC0C9\\s*\\uB0B4\\uBCF4\\uB0B4\\uAE30/i.test(textOf(row)));
      const latestRow = expectedJobId
        ? rows.find((row) => {
          const cells = [...row.querySelectorAll("td, [role='cell'], [role='gridcell']")];
          const taskNumber = textOf(cells[0]).match(/\\b\\d{9,}\\b/)?.[0]
            || textOf(row).match(/\\b\\d{9,}\\b/)?.[0]
            || "";
          return taskNumber === expectedJobId;
        })
        : rows[0];
      if (!latestRow) return { state: "WAITING_FOR_LATEST_JOB" };

      const rowText = textOf(latestRow);
      if (/\\uCC98\\uB9AC\\s*\\uC911|processing|pending/i.test(rowText)) {
        return { state: "PROCESSING" };
      }
      if (!/\\uC131\\uACF5|completed|success/i.test(rowText)) {
        return { state: "WAITING_FOR_SUCCESS" };
      }

      const controls = [...latestRow.querySelectorAll("a, button, [role='button']")];
      const download = controls.find((element) => {
        if (!visible(element) || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
        const description = [
          textOf(element),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("href"),
        ].filter(Boolean).join(" ");
        return /\\uB2E4\\uC6B4\\uB85C\\uB4DC/i.test(description)
          || /download/i.test(description);
      });
      if (!download) return { state: "WAITING_FOR_DOWNLOAD" };

      download.scrollIntoView({ block: "center" });
      const href = String(download.href || download.getAttribute("href") || "");
      if (!/^https:\\/\\//i.test(href)) {
        download.focus();
        download.click();
      }
      return {
        state: /^https:\\/\\//i.test(href) ? "DOWNLOAD_URL_READY" : "DOWNLOAD_CLICKED",
        href,
      };
    })()`, true).catch(() => ({ state: "PAGE_NOT_READY" }));

    const stateLabel = {
      WAITING_FOR_LATEST_JOB: "4단계/5 · 작업번호 행 확인 중",
      PROCESSING: "4단계/5 · POIZON 파일 처리 중 · 10초마다 자동 감시",
      WAITING_FOR_SUCCESS: "4단계/5 · POIZON 처리 완료 대기 중",
      WAITING_FOR_DOWNLOAD: "4단계/5 · 다운로드 버튼 대기 중",
      PAGE_NOT_READY: "4단계/5 · 다운로드센터 확인 중",
    }[result?.state];
    if (stateLabel) {
      mainWindow?.webContents.send("brand-export:progress", {
        status: "monitoring",
        jobId: pendingBrandExportJobId,
        jobState: stateLabel,
        message: `${pendingBrandExportName || "선택 브랜드"} · 작업번호 ${pendingBrandExportJobId} · ${stateLabel}`,
      });
    }

    if (result?.state === "DOWNLOAD_URL_READY") {
      sellerWindow.webContents.downloadURL(result.href);
    }
    if (result?.state === "DOWNLOAD_URL_READY" || result?.state === "DOWNLOAD_CLICKED") {
      mainWindow?.webContents.send("brand-export:progress", {
        status: "download-requested",
        jobId: pendingBrandExportJobId,
        jobState: "4단계/5 · 처리 성공 · 다운로드 시작",
        message: `${pendingBrandExportName || "선택 브랜드"} · 4단계/5 · POIZON 처리 성공 · 다운로드를 요청했습니다.`,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    if (brandDownloadStarted) return;
    if (!sellerWindow || sellerWindow.isDestroyed()) return;
    if (!sellerWindow.webContents.getURL().includes("/main/exportCenter")) {
      await sellerWindow.loadURL(SELLER_EXPORT_CENTER_URL);
    } else {
      await sellerWindow.webContents.reloadIgnoringCache();
    }
  }

  brandExportJobPending = false;
  pendingBrandExportName = "";
  pendingBrandExportJobId = "";
}


function ensureSellerMonitorWindow() {
  if (sellerMonitorWindow && !sellerMonitorWindow.isDestroyed()) return sellerMonitorWindow;
  sellerMonitorWindow = new BrowserWindow({
    icon: APP_ICON_PATH,
    show: false,
    skipTaskbar: true,
    width: 1360,
    height: 860,
    title: "POIZON 다운로드 감시 · Around G",
    backgroundColor: "#ffffff",
    webPreferences: {
      partition: "persist:around-g-poizon-seller",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  sellerMonitorWindow.on("closed", () => {
    sellerMonitorWindow = null;
    if (brandExportJobs.size) scheduleBrandExportMonitor(3_000);
  });
  sellerMonitorWindow.loadURL(SELLER_EXPORT_CENTER_URL);
  return sellerMonitorWindow;
}

function sellerMonitorFrames(targetWindow = sellerMonitorWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return [];
  const mainFrame = targetWindow.webContents.mainFrame;
  return [mainFrame, ...(mainFrame.framesInSubtree || [])]
    .filter((frame, index, all) => all.findIndex((candidate) => candidate.routingId === frame.routingId) === index);
}

const SELLER_MONITOR_STATUS_PRIORITY = {
  PAGE_NOT_READY: 0,
  WAITING_FOR_ROW: 1,
  WAITING_FOR_SUCCESS: 2,
  PROCESSING: 3,
  WAITING_FOR_COMPLETION: 4,
  WAITING_FOR_DOWNLOAD: 5,
  READY: 6,
};

async function readSellerMonitorStatuses(expectedIds = []) {
  const monitor = ensureSellerMonitorWindow();
  if (!monitor.webContents.getURL().includes("/main/exportCenter")) {
    await monitor.loadURL(SELLER_EXPORT_CENTER_URL);
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const merged = new Map(expectedIds.map((jobId) => [jobId, { jobId, state: "WAITING_FOR_ROW" }]));
  const sources = [
    { name: "seller", window: sellerWindow },
    { name: "monitor", window: monitor },
  ].filter((source, index, all) => source.window
    && !source.window.isDestroyed()
    && source.window.webContents.getURL().includes("/main/exportCenter")
    && all.findIndex((candidate) => candidate.window === source.window) === index);
  for (const source of sources) {
    const frames = sellerMonitorFrames(source.window);
    for (const frame of frames) {
    const expectedJobs = expectedIds.map((jobId) => {
      const job = brandExportJobs.get(jobId);
      return { jobId, restored: Boolean(job?.restored), createdAt: Number(job?.createdAt || 0) };
    });
    const statuses = await Promise.race([
      frame.executeJavaScript(`(() => {
        const expectedJobs = ${JSON.stringify(expectedJobs)};
        const usable = (element) => Boolean(element && element.isConnected);
        const textOf = (element) => String(element?.textContent || element?.innerText || "")
          .replace(/\\s+/g, " ").trim();
        const compactNumber = (value) => String(value || "").replace(/\\D/g, "");
        const datePattern = /\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?/g;
        const parseDate = (value) => {
          const normalized = String(value || "").replace(/[/.]/g, "-");
          const time = Date.parse(normalized.replace(" ", "T"));
          return Number.isFinite(time) ? time : 0;
        };
        const selector = "tbody tr, [role='row'], tr, [data-row-key], [class*='table'] [class*='row'], [class*='list'] [class*='item']";
        const rowCandidates = [...document.querySelectorAll(selector)].filter(usable);
        const findJobContainer = (jobId) => {
          const direct = rowCandidates
            .filter((candidate) => textOf(candidate).includes(jobId)
              || compactNumber(textOf(candidate)).includes(compactNumber(jobId)))
            .sort((left, right) => textOf(left).length - textOf(right).length)[0];
          if (direct) return direct;
          const leaf = [...document.querySelectorAll("body *")]
            .filter(usable)
            .filter((element) => {
              const value = textOf(element);
              const matched = value.includes(jobId) || compactNumber(value).includes(compactNumber(jobId));
              if (!matched || value.length > 1000) return false;
              return ![...element.children].some((child) => {
                const childText = textOf(child);
                return childText.includes(jobId) || compactNumber(childText).includes(compactNumber(jobId));
              });
            })
            .sort((left, right) => textOf(left).length - textOf(right).length)[0];
          return leaf?.closest("tr, [role='row'], [data-row-key], [class*='row'], [class*='item']")
            || leaf?.parentElement
            || leaf
            || null;
        };
        const usedRows = new Set();
        const parsedRows = rowCandidates.map((row) => {
          const rowText = textOf(row);
          const cells = [...row.querySelectorAll("td, [role='cell'], [role='gridcell']")];
          const cellTexts = cells.map(textOf);
          const dates = cellTexts.flatMap((value) => value.match(datePattern) || []);
          const workStateText = cellTexts.find((value) => /^(?:성공|success|completed)$/i.test(value)) || "";
          const controls = [...row.querySelectorAll("a, button, [role='button']")];
          const control = controls.find((element) => usable(element)
            && !element.disabled
            && element.getAttribute("aria-disabled") !== "true"
            && /다운로드|download/i.test([
              textOf(element), element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("href"),
            ].filter(Boolean).join(" ")));
          return { row, rowText, cells, dates, workStateText, control, startAt: parseDate(dates[0]) };
        });
        return expectedJobs.map((expected) => {
          const { jobId } = expected;
          let row = findJobContainer(jobId);
          let recovered = false;
          if (!row && expected.restored && expected.createdAt > 0) {
            const candidates = parsedRows.filter((item) => !usedRows.has(item.row)
              && item.control
              && /^(?:성공|success|completed)$/i.test(item.workStateText)
              && item.dates.length > 0
              && item.startAt >= expected.createdAt - 5 * 60_000
              && item.startAt <= expected.createdAt + 60 * 60_000)
              .sort((left, right) => Math.abs(left.startAt - expected.createdAt) - Math.abs(right.startAt - expected.createdAt));
            row = candidates[0]?.row || null;
            recovered = Boolean(row);
          }
          if (!row) return { jobId, state: "WAITING_FOR_ROW" };
          usedRows.add(row);
          const rowText = textOf(row);
          const cells = [...row.querySelectorAll("td, [role='cell'], [role='gridcell']")];
          const cellTexts = cells.map(textOf);
          const dates = cellTexts.flatMap((value) => value.match(datePattern) || []);
          const workStateText = cellTexts.find((value) => /^(?:성공|success|completed)$/i.test(value)) || cellTexts[3] || "";
          const startText = dates[0] || "";
          const completionText = dates.at(-1) || "";
          const jobNumberMatched = recovered || compactNumber(rowText).includes(compactNumber(jobId));
          const workSucceeded = /^(?:성공|success|completed)$/i.test(workStateText);
          const completionConfirmed = /\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?/.test(completionText);
          if (!jobNumberMatched) return { jobId, state: "WAITING_FOR_ROW" };
          if (/처리\\s*중|processing|pending|진행\\s*중/i.test(workStateText || rowText)) {
            return { jobId, state: "PROCESSING", workStateText, completionText };
          }
          if (!workSucceeded) return { jobId, state: "WAITING_FOR_SUCCESS", workStateText, completionText };
          if (!completionConfirmed) return { jobId, state: "WAITING_FOR_COMPLETION", workStateText, completionText };
          const control = [...row.querySelectorAll("a, button, [role='button']")].find((element) => {
            if (!usable(element) || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
            return /다운로드|download/i.test([
              textOf(element), element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("href"),
            ].filter(Boolean).join(" "));
          });
          let href = String(control?.href || control?.getAttribute?.("href") || "");
          try {
            if (href && !/^javascript:/i.test(href)) href = new URL(href, location.href).href;
          } catch {}
          return {
            jobId,
            state: control ? "READY" : "WAITING_FOR_DOWNLOAD",
            href,
            workStateText,
            completionText,
            startText,
            recovered,
            jobNumberMatched,
            workSucceeded,
            completionConfirmed,
          };
        });
      })()`, true),
      new Promise((resolve) => setTimeout(() => resolve([]), 5_000)),
    ]).catch(() => []);
    for (const status of Array.isArray(statuses) ? statuses : []) {
      const previous = merged.get(status.jobId);
      if (!previous || SELLER_MONITOR_STATUS_PRIORITY[status.state] > SELLER_MONITOR_STATUS_PRIORITY[previous.state]) {
        merged.set(status.jobId, {
          ...status,
          frameRoutingId: frame.routingId,
          windowSource: source.name,
        });
      }
    }
  }
  }
  return expectedIds.map((jobId) => merged.get(jobId) || { jobId, state: "PAGE_NOT_READY" });
}

async function requestSellerMonitorDownload(jobId = "", preferredFrameRoutingId = null, windowSource = "monitor", rowLocator = {}) {
  const targetWindow = windowSource === "seller" && sellerWindow && !sellerWindow.isDestroyed()
    ? sellerWindow
    : ensureSellerMonitorWindow();
  const frames = sellerMonitorFrames(targetWindow);
  const ordered = preferredFrameRoutingId === null
    ? frames
    : [...frames].sort((left, right) => Number(right.routingId === preferredFrameRoutingId) - Number(left.routingId === preferredFrameRoutingId));
  for (const frame of ordered) {
    const result = await frame.executeJavaScript(`(() => {
      const jobId = ${JSON.stringify(String(jobId))};
      const rowLocator = ${JSON.stringify(rowLocator || {})};
      const usable = (element) => Boolean(element && element.isConnected);
      const textOf = (element) => String(element?.textContent || element?.innerText || "").replace(/\\s+/g, " ").trim();
      const selector = "tbody tr, [role='row'], tr, [data-row-key], [class*='table'] [class*='row'], [class*='list'] [class*='item']";
      const rowCandidates = [...document.querySelectorAll(selector)].filter(usable);
      const compactNumber = (value) => String(value || "").replace(/\\D/g, "");
      const direct = rowCandidates
        .filter((candidate) => textOf(candidate).includes(jobId)
          || compactNumber(textOf(candidate)).includes(compactNumber(jobId)))
        .sort((left, right) => textOf(left).length - textOf(right).length)[0];
      const leaf = direct ? null : [...document.querySelectorAll("body *")]
        .filter(usable)
        .filter((element) => textOf(element).includes(jobId)
          && ![...element.children].some((child) => textOf(child).includes(jobId)))
        .sort((left, right) => textOf(left).length - textOf(right).length)[0];
      const recoveredRow = rowLocator.recovered ? rowCandidates.find((candidate) => {
        const value = textOf(candidate);
        return (!rowLocator.startText || value.includes(rowLocator.startText))
          && (!rowLocator.completionText || value.includes(rowLocator.completionText));
      }) : null;
      const row = direct
        || recoveredRow
        || leaf?.closest("tr, [role='row'], [data-row-key], [class*='row'], [class*='item']")
        || leaf?.parentElement
        || leaf
        || null;
      if (!row) return { clicked: false, href: "", reason: "JOB_ROW_NOT_FOUND" };
      const rowText = textOf(row);
      const cells = [...row.querySelectorAll("td, [role='cell'], [role='gridcell']")];
      const cellTexts = cells.map(textOf);
      const datePattern = /\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?/g;
      const dates = cellTexts.flatMap((value) => value.match(datePattern) || []);
      const workStateText = cellTexts.find((value) => /^(?:성공|success|completed)$/i.test(value)) || cellTexts[3] || "";
      const completionText = dates.at(-1) || "";
      const jobNumberMatched = Boolean(rowLocator.recovered) || compactNumber(rowText).includes(compactNumber(jobId));
      const workSucceeded = /^(?:성공|success|completed)$/i.test(workStateText);
      const completionConfirmed = /\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?/.test(completionText);
      if (!jobNumberMatched || !workSucceeded || !completionConfirmed) {
        return {
          clicked: false,
          href: "",
          reason: "DOWNLOAD_CONDITIONS_NOT_MET",
          jobNumberMatched,
          workSucceeded,
          completionConfirmed,
        };
      }
      const control = [...row.querySelectorAll("a, button, [role='button']")].find((element) =>
        usable(element)
        && !element.disabled
        && element.getAttribute("aria-disabled") !== "true"
        && /다운로드|download/i.test([
          textOf(element), element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("href"),
        ].filter(Boolean).join(" "))
      );
      if (!control) return { clicked: false, href: "" };
      let href = String(control.href || control.getAttribute("href") || "");
      try {
        if (href && !/^javascript:/i.test(href)) href = new URL(href, location.href).href;
      } catch {}
      if (/^https:\\/\\//i.test(href)) return { clicked: true, href };
      control.focus?.();
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        control.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button: 0,
        }));
      }
      if (typeof control.click === "function") control.click();
      return { clicked: true, href: "" };
    })()`, true).catch(() => ({ clicked: false, href: "" }));
    if (result?.clicked) return { ...result, targetWindow };
  }
  return { clicked: false, href: "" };
}

function emitBrandExportAllComplete() {
  if (brandExportJobs.size || brandDownloadStarted || activeBrandDownloadJobId || brandDownloadPathsInProgress.size) return false;
  if (brandExportMonitorRestartTimer) {
    clearTimeout(brandExportMonitorRestartTimer);
    brandExportMonitorRestartTimer = null;
  }
  if (brandExportAllCompleteSent) return true;
  brandExportAllCompleteSent = true;
  mainWindow?.webContents.send("brand-export:progress", {
    status: "all-complete",
    monitorSource: "dedicated-window",
    jobState: "모든 작업 확인완료",
    message: "선택한 브랜드의 POIZON 원본 Excel 다운로드와 프로그램 등록이 모두 완료되었습니다.",
  });
  return true;
}

function scheduleBrandExportMonitor(delayMs = 0) {
  if (!brandExportJobs.size || brandExportMonitorRunning) {
    if (!brandExportJobs.size) emitBrandExportAllComplete();
    return;
  }
  brandExportAllCompleteSent = false;
  if (brandExportMonitorRestartTimer) clearTimeout(brandExportMonitorRestartTimer);
  brandExportMonitorRestartTimer = setTimeout(() => {
    brandExportMonitorRestartTimer = null;
    if (!brandExportJobs.size || brandExportMonitorRunning) return;
    void watchAllSellerExportJobsEveryTenSeconds();
  }, Math.max(0, Number(delayMs) || 0));
}

async function watchAllSellerExportJobsEveryTenSeconds() {
  if (brandExportMonitorRunning) return { ok: true, jobs: brandExportJobs.size };
  brandExportMonitorRunning = true;
  const pollIntervalMs = SELLER_MULTI_EXPORT_POLL_INTERVAL_MS;
  try {
    while (brandExportJobs.size) {
      const expectedIds = [...brandExportJobs.keys()];
      const statuses = await readSellerMonitorStatuses(expectedIds);
      for (const status of statuses) {
        const job = brandExportJobs.get(status.jobId);
        if (!job) continue;
        const stateLabel = {
          WAITING_FOR_ROW: "4단계/5 · 작업번호 행 확인 중",
          PROCESSING: "4단계/5 · POIZON 파일 처리 중 · 10초마다 감시",
          WAITING_FOR_SUCCESS: "4단계/5 · POIZON 처리 완료 대기 중",
          WAITING_FOR_COMPLETION: "4단계/5 · 작업 완료 시각 확인 중",
          WAITING_FOR_DOWNLOAD: "4단계/5 · 다운로드 버튼 대기",
          PAGE_NOT_READY: "4단계/5 · 다운로드센터 프레임 확인 중",
          READY: "4단계/5 · 처리 성공 · 다운로드 시작",
        }[status.state] || status.state;
        mainWindow?.webContents.send("brand-export:progress", {
          status: "monitoring",
          monitorSource: "dedicated-window",
          brandName: job.brandName,
          jobId: status.jobId,
          jobState: stateLabel,
          message: `${job.brandName} · 작업번호 ${status.jobId} · ${stateLabel}`,
        });
      }

      const statusCheckedAt = Date.now();
      if (activeBrandDownloadJobId) {
        const activeJob = brandExportJobs.get(activeBrandDownloadJobId);
        const requestAge = statusCheckedAt - Number(activeJob?.downloadRequestedAt || statusCheckedAt);
        if (!activeJob || (!activeJob.downloadStarted && requestAge >= 120_000)) {
          if (activeJob) {
            activeJob.downloadRequestedAt = 0;
            activeJob.downloadStarted = false;
          }
          activeBrandDownloadJobId = "";
        }
      }
      const ready = activeBrandDownloadJobId ? null : statuses.find((status) => {
        const job = brandExportJobs.get(status.jobId);
        return Boolean(job)
          && status.state === "READY"
          && status.jobNumberMatched
          && status.workSucceeded
          && status.completionConfirmed
          && !job.downloadStarted
          && !job.downloadRequestedAt;
      });
      if (ready) {
        const job = brandExportJobs.get(ready.jobId);
        if (!job) continue;
        activeBrandDownloadJobId = ready.jobId;
        job.downloadRequestedAt = Date.now();
        const action = await requestSellerMonitorDownload(ready.jobId, ready.frameRoutingId, ready.windowSource, {
          recovered: Boolean(ready.recovered),
          startText: ready.startText || "",
          completionText: ready.completionText || "",
        });
        if (action?.href && action?.targetWindow && !action.targetWindow.isDestroyed()) {
          action.targetWindow.webContents.downloadURL(action.href);
        }
        if (!action?.clicked) {
          const currentJob = brandExportJobs.get(ready.jobId);
          if (!currentJob) continue;
          currentJob.downloadRequestedAt = 0;
          currentJob.downloadStarted = false;
          if (activeBrandDownloadJobId === ready.jobId) activeBrandDownloadJobId = "";
          mainWindow?.webContents.send("brand-export:progress", {
            status: "monitoring",
            monitorSource: "dedicated-window",
            brandName: currentJob.brandName,
            jobId: ready.jobId,
            jobState: "4단계/5 · 다운로드 버튼 재탐색",
            message: `${currentJob.brandName} · 작업번호 ${ready.jobId} · 모든 다운로드센터 프레임에서 버튼을 다시 찾습니다.`,
          });
        }
      }
      for (const [jobId, job] of [...brandExportJobs.entries()]) {
        const age = statusCheckedAt - Number(job?.createdAt || statusCheckedAt);
        if (age >= SELLER_EXPORT_MONITOR_DELAY_WARNING_MS && !job.delayWarningSent) {
          job.delayWarningSent = true;
          mainWindow?.webContents.send("brand-export:progress", {
            status: "monitoring",
            monitorSource: "dedicated-window",
            brandName: job.brandName,
            jobId,
            jobState: "POIZON 처리 지연 · 감시 계속",
            message: `${job.brandName} · 작업번호 ${jobId} · 20분이 지났지만 다운로드가 완료될 때까지 계속 감시합니다.`,
          });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const monitor = ensureSellerMonitorWindow();
      if (!monitor.webContents.getURL().includes("/main/exportCenter")) {
        await monitor.loadURL(SELLER_EXPORT_CENTER_URL);
      } else {
        await monitor.webContents.reloadIgnoringCache();
      }
    }
  } catch (error) {
    mainWindow?.webContents.send("brand-export:progress", {
      status: "monitor-recovering",
      monitorSource: "dedicated-window",
      jobState: "다운로드센터 감시 자동 복구 중",
      message: `전용 감시 창 오류를 3초 후 자동 복구합니다: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    brandExportMonitorRunning = false;
    if (brandExportJobs.size) scheduleBrandExportMonitor(3_000);
    else emitBrandExportAllComplete();
  }
  return { ok: true, jobs: brandExportJobs.size };
}

const SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT = `(() => {
  const visible = (element) => element && element.getClientRects().length > 0;
  const textOf = (element) => String(element?.innerText || element?.textContent || "")
    .replace(/\s+/g, " ").trim();
  const candidates = [...document.querySelectorAll(
    "tbody tr, [role='row'], tr, [data-row-key], [class*='table'] [class*='row'], [class*='list'] [class*='item']"
  )].filter(visible);
  const jobs = [];
  const seen = new Set();
  for (const element of candidates) {
    const text = textOf(element);
    if (!text || text.length > 2400) continue;
    const cells = [...element.querySelectorAll("td, [role='cell'], [role='gridcell']")];
    const firstCellText = textOf(cells[0]);
    const id = firstCellText.match(/\\b\\d{7,}\\b/)?.[0]
      || text.match(/\\b\\d{7,}\\b/)?.[0]
      || "";
    if (!id || seen.has(id)) continue;
    const rowHint = cells.length >= 2
      || /내보내기|다운로드|작업|export|download|task|导出|下载|任务|처리|成功/i.test(text);
    if (!rowHint) continue;
    seen.add(id);
    jobs.push({ id, fingerprint: id, text: text.slice(0, 500) });
  }
  const bodyText = textOf(document.body);
  const emptyState = /暂无数据|没有数据|暂无任务|데이터가\s*없|작업이\s*없|no\s*(?:data|task)/i.test(bodyText);
  return { ready: jobs.length > 0 || emptyState, jobs };
})()`;

async function readSellerExportJobsFromWindow(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return null;
  const mainFrame = targetWindow.webContents.mainFrame;
  const frames = [mainFrame, ...(mainFrame.framesInSubtree || [])]
    .filter((frame, index, all) => all.findIndex((candidate) => candidate.routingId === frame.routingId) === index);
  const jobsById = new Map();
  let ready = false;
  for (const frame of frames) {
    try {
      const snapshot = await frame.executeJavaScript(SELLER_EXPORT_JOB_SNAPSHOT_SCRIPT, true);
      if (snapshot?.ready) ready = true;
      for (const job of snapshot?.jobs || []) {
        const id = String(job?.id || "").trim();
        if (id && !jobsById.has(id)) jobsById.set(id, job);
      }
    } catch {
      // 접근할 수 없는 외부 프레임은 건너뛰고 나머지 프레임을 계속 확인합니다.
    }
  }
  return ready || jobsById.size ? [...jobsById.values()] : null;
}

async function readSellerExportJobs() {
  if (!sellerWindow || sellerWindow.isDestroyed()) return null;
  if (!sellerWindow.webContents.getURL().includes("/main/exportCenter")) {
    await sellerWindow.loadURL(SELLER_EXPORT_CENTER_URL);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return readSellerExportJobsFromWindow(sellerWindow);
}

async function readSellerExportJobsFromMonitor() {
  const monitor = ensureSellerMonitorWindow();
  if (!monitor.webContents.getURL().includes("/main/exportCenter")) {
    await monitor.loadURL(SELLER_EXPORT_CENTER_URL);
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return readSellerExportJobsFromWindow(monitor);
}

async function readSellerExportBaselineSeparately() {
  let baselineWindow;
  try {
    baselineWindow = new BrowserWindow({
      show: false,
      width: 1100,
      height: 760,
      webPreferences: {
        partition: "persist:around-g-poizon-seller",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    await baselineWindow.loadURL(SELLER_EXPORT_CENTER_URL);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    return await readSellerExportJobsFromWindow(baselineWindow);
  } catch {
    return null;
  } finally {
    if (baselineWindow && !baselineWindow.isDestroyed()) baselineWindow.destroy();
  }
}

async function readStableSellerExportJobs() {
  let previousSignature = null;
  let stableReads = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const jobs = await readSellerExportJobs();
    if (Array.isArray(jobs)) {
      const signature = jobs.map((job) => String(job?.id || "").trim())
        .filter(Boolean).sort().join("|");
      if (signature === previousSignature) stableReads += 1;
      else stableReads = 1;
      previousSignature = signature;
      if (stableReads >= 2) return jobs;
    } else {
      previousSignature = null;
      stableReads = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!sellerWindow || sellerWindow.isDestroyed()) return null;
  }
  return null;
}

function normalizeBrandExportKey(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\uAC00-\uD7A3]+/g, "");
}

function savedBrandExportJobs() {
  const saved = store?.snapshot()?.settings?.brandExportJobCache;
  return Array.isArray(saved) ? saved : [];
}

function normalizeSavedBrandExportPath(value = "") {
  return String(value || "")
    .trim()
    .replace(/[\\/]+/g, "\\")
    .toLocaleLowerCase();
}

function savedBrandExportJobForFile(input = {}, usedJobIds = new Set()) {
  const pathKey = normalizeSavedBrandExportPath(input.path);
  const fileNameKey = String(input.name || "").trim().toLocaleLowerCase();
  const brandKey = normalizeBrandExportKey(input.brandName);
  const mtimeMs = Number(input.mtimeMs || 0);
  const candidates = savedBrandExportJobs()
    .map((item) => ({
      ...item,
      jobId: String(item?.jobId || "").trim(),
      brandName: String(item?.brandName || "").trim(),
      brandKo: String(item?.brandKo || "").trim(),
      filePath: String(item?.filePath || "").trim(),
      fileName: String(item?.fileName || "").trim(),
      fileMtimeMs: Number(item?.fileMtimeMs || 0),
      lastDownloadedAt: Number(item?.lastDownloadedAt || 0),
      createdAt: Number(item?.createdAt || 0),
    }))
    .filter((item) => item.jobId && item.lastDownloadedAt > 0 && !usedJobIds.has(item.jobId));
  const exactPath = pathKey
    ? candidates.find((item) => normalizeSavedBrandExportPath(item.filePath) === pathKey)
    : null;
  if (exactPath) return exactPath;
  const brandMatches = (item) => {
    if (!brandKey) return false;
    return brandsMatch(item.brandName, input.brandName)
      || brandsMatch(item.brandKo, input.brandName);
  };
  const exactNameMatches = fileNameKey
    ? candidates.filter((item) => item.fileName.toLocaleLowerCase() === fileNameKey && brandMatches(item))
    : [];
  if (exactNameMatches.length === 1) return exactNameMatches[0];
  const brandCandidates = candidates.filter(brandMatches);
  if (!brandCandidates.length) return null;
  const scored = brandCandidates.map((item) => {
    const referenceTime = item.fileMtimeMs || item.lastDownloadedAt || item.createdAt;
    return {
      item,
      difference: mtimeMs > 0 && referenceTime > 0
        ? Math.abs(mtimeMs - referenceTime)
        : Number.POSITIVE_INFINITY,
    };
  }).sort((left, right) => left.difference - right.difference);
  const nearest = scored[0];
  const second = scored[1];
  const maximumDifference = 24 * 60 * 60 * 1000;
  if (nearest && nearest.difference <= maximumDifference
    && (!second || second.difference - nearest.difference >= 30_000)) {
    return nearest.item;
  }
  return brandCandidates.length === 1 ? brandCandidates[0] : null;
}

function restorePendingBrandExportJobs() {
  const cutoff = Date.now() - RESTORED_PENDING_JOB_MAX_AGE_MS;
  for (const saved of savedBrandExportJobs()) {
    const jobId = String(saved?.jobId || "").trim();
    const brandName = String(saved?.brandName || "").trim();
    const createdAt = Number(saved?.createdAt || 0);
    const lastDownloadedAt = Number(saved?.lastDownloadedAt || 0);
    if (!jobId || !brandName || lastDownloadedAt > 0 || createdAt < cutoff) continue;
    brandExportJobs.set(jobId, {
      jobId,
      brandName,
      brandKo: String(saved?.brandKo || "").trim(),
      createdAt,
      expectedProductCount: Number(saved?.expectedProductCount || 0),
      downloadStarted: false,
      downloadRequestedAt: 0,
      restored: true,
    });
  }
  return [...brandExportJobs.entries()].map(([jobId, job]) => ({
    jobId,
    brandName: job.brandName,
    brandKo: job.brandKo || "",
    createdAt: Number(job.createdAt || 0),
    expectedProductCount: Number(job.expectedProductCount || 0),
    restored: Boolean(job.restored),
  }));
}

async function rememberBrandExportJob(input = {}) {
  if (input.sessionGeneration !== undefined
    && input.sessionGeneration !== brandWorkSessionGeneration) return;
  const jobId = String(input.jobId || "").trim();
  const brandName = String(input.brandName || "").trim();
  const brandKo = String(input.brandKo || "").trim();
  const officialRegistry = safeOfficialDomainRegistry(
    store.snapshot().settings.brandCatalog || explorerMetadata().brands
  );
  const officialRecord = officialDomainRecordForBrand(officialRegistry, brandName)
    || officialDomainRecordForBrand(officialRegistry, brandKo);
  const officialAliases = officialDomainSearchAliases(officialRecord);
  if (!jobId || !brandName) return;
  const next = {
    jobId,
    brandName,
    brandKo,
    brandKey: normalizeBrandExportKey(brandName),
    createdAt: Number(input.createdAt) || Date.now(),
    lastDownloadedAt: Number(input.lastDownloadedAt) || 0,
    expectedProductCount: Number(input.expectedProductCount) || 0,
    filePath: String(input.filePath || "").trim(),
    fileName: String(input.fileName || "").trim(),
    fileMtimeMs: Number(input.fileMtimeMs) || 0,
  };
  const cache = [
    next,
    ...savedBrandExportJobs().filter((item) => String(item?.jobId || "") !== jobId),
  ].slice(0, 500);
  await store.setSettings({ brandExportJobCache: cache });
}

function brandExportJobOwner(jobId = "") {
  const normalizedId = String(jobId || "").trim();
  if (!normalizedId) return null;
  const active = brandExportJobs.get(normalizedId);
  if (active) return active;
  return savedBrandExportJobs().find((item) => String(item?.jobId || "").trim() === normalizedId) || null;
}

function sellerWindowFrames() {
  if (!sellerWindow || sellerWindow.isDestroyed()) return [];
  const mainFrame = sellerWindow.webContents.mainFrame;
  return [mainFrame, ...(mainFrame.framesInSubtree || [])]
    .filter((frame, index, all) => all.findIndex((candidate) => candidate.routingId === frame.routingId) === index);
}

async function executeSellerFrameWithTimeout(frame, script, timeoutMs = 4_000, fallback = null) {
  return Promise.race([
    frame.executeJavaScript(script, true),
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]).catch(() => fallback);
}

function currentSellerProductFrame() {
  const frames = sellerWindowFrames();
  return frames.find((frame) => frame.routingId === sellerProductFrameRoutingId)
    || frames[0]
    || null;
}

function sellerBrandExportFailureMessage(code = "", brandName = "") {
  const label = String(brandName || "선택 브랜드").trim();
  const messages = {
    SEARCH_INPUT_NOT_FOUND: `${label} 상품검색 입력창이 표시되지 않았습니다. 시간 간격을 두고 다시 진행합니다.`,
    SELLER_LOGIN_REQUIRED: `${label} 작업 중 판매자센터 로그인 화면이 확인됐습니다. 로그인 후 다시 실행해 주세요.`,
    SELLER_SEARCH_SCRIPT_ERROR: `${label} 상품검색 화면 제어 중 오류가 발생했습니다. 상품검색 화면을 다시 열어 재시도해 주세요.`,
    SELLER_SEARCH_STAGE_TIMEOUT: `${label} 상품검색 단계가 40초 안에 끝나지 않아 페이지를 초기화했습니다. 이전 검색 작업은 종료되었습니다.`,
    SELLER_SECURITY_CHECK_REQUIRED: `${label} 검색 중 POIZON 보안 확인 화면이 표시됐습니다. 판매자센터에서 보안 확인을 완료한 뒤 다시 실행해 주세요.`,
    PRODUCT_VERIFICATION_TIMEOUT: `${label} 전체 페이지 확인이 70초 안에 끝나지 않아 다음 브랜드로 이동합니다.`,
    BRAND_INPUT_NOT_APPLIED: `${label} 검색어가 판매자센터에 입력되지 않아 중단했습니다.`,
    BRAND_RESULT_MISMATCH: `${label} 검색 결과가 확인되지 않아 내보내기를 중단했습니다. 기존 검색 결과는 다운로드하지 않습니다.`,
    SEARCH_RESULT_NOT_UPDATED: `${label} 검색 결과가 새로 바뀌지 않아 내보내기를 중단했습니다. 기존 검색 결과는 다운로드하지 않습니다.`,
    PARTIAL_PRODUCT_COLLECTION: `${label} 전체 상품 수집이 완료되지 않아 내보내기를 중단했습니다. 부분 파일은 다운로드하지 않습니다.`,
    PRODUCT_PAGE_NOT_READY: `${label} 상품 수와 전체 페이지를 확인하지 못해 내보내기를 중단했습니다.`,
    PRODUCT_LAST_PAGE_FAILED: `${label} 마지막 상품 페이지를 확인하지 못해 내보내기를 중단했습니다.`,
    DOWNLOAD_CENTER_SHORTCUT_NOT_FOUND: `${label} 내보내기 후 다운로드센터 바로 가기 버튼을 찾지 못했습니다.`,
  };
  return messages[code] || `판매자센터 자동화 실패: ${code || "UNKNOWN"}`;
}

async function verifyCompleteSellerExportAndClick(expectedTotal = 0) {
  const productFrame = currentSellerProductFrame();
  if (!productFrame) return { ok: false, code: "PRODUCT_PAGE_NOT_READY" };
  return productFrame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getClientRects().length > 0;
    const normalizedText = (element) => String(element?.innerText || element?.textContent || "")
      .replace(/\\s+/g, " ").trim();
    const readTotal = () => {
      const match = String(document.body?.innerText || "").match(/총\\s*([\\d,]+)\\s*건\\s*결과/);
      return Number(String(match?.[1] || "0").replace(/,/g, "")) || 0;
    };
    const readPage = () => {
      const tables = [...document.querySelectorAll("table")].filter(visible);
      const table = tables
        .map((element) => ({
          element,
          rows: [...element.querySelectorAll("tbody tr")].filter(visible)
            .filter((row) => normalizedText(row).length > 0),
        }))
        .sort((left, right) => right.rows.length - left.rows.length)[0];
      const rows = table?.rows || [];
      const keys = rows.map((row) => {
        const explicit = row.getAttribute("data-row-key")
          || row.getAttribute("data-key")
          || row.getAttribute("data-id")
          || row.id;
        return String(explicit || normalizedText(row)).trim();
      }).filter(Boolean);
      const active = [...document.querySelectorAll(".ant-pagination-item-active")].find(visible);
      const pageSizeText = [...document.querySelectorAll(".ant-select-selection-item")]
        .find((element) => visible(element) && /건\\/페이지/.test(element.textContent))?.textContent || "";
      const pageSize = Number(pageSizeText.match(/(\\d+)\\s*건\\/페이지/)?.[1]) || keys.length || 10;
      const total = readTotal();
      const currentPage = Number(active?.textContent.trim()) || 1;
      const pageCount = total > 0 ? Math.ceil(total / pageSize) : 0;
      return { keys, currentPage, pageSize, pageCount, total };
    };
    const clickPage = async (targetPage) => {
      for (let clickAttempt = 0; clickAttempt < 4; clickAttempt += 1) {
        const direct = [...document.querySelectorAll(".ant-pagination-item")]
          .find((item) => visible(item) && Number(item.textContent.trim()) === targetPage);
        const current = readPage().currentPage;
        if (current === targetPage) return true;
        const pagination = [...document.querySelectorAll(".ant-pagination")].find(visible);
        const jumper = pagination?.querySelector(".ant-pagination-options-quick-jumper input");
        if (direct) {
          (direct.querySelector("button,a") || direct).click();
        } else if (jumper) {
          jumper.focus();
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          if (setter) setter.call(jumper, String(targetPage));
          else jumper.value = String(targetPage);
          jumper.dispatchEvent(new Event("input", { bubbles: true }));
          jumper.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true,
          }));
          jumper.dispatchEvent(new KeyboardEvent("keyup", {
            key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true,
          }));
        } else {
          const numbered = [...document.querySelectorAll(".ant-pagination-item")]
            .filter(visible)
            .map((item) => ({ item, page: Number(item.textContent.trim()) || 0 }))
            .filter((entry) => entry.page > 0)
            .sort((left, right) => right.page - left.page);
          const boundary = targetPage > current ? numbered[0] : numbered[numbered.length - 1];
          if (!boundary?.item || boundary.page === current) return false;
          (boundary.item.querySelector("button,a") || boundary.item).click();
        }
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await wait(250);
          if (readPage().currentPage === targetPage) {
            await wait(500);
            return true;
          }
        }
      }
      return false;
    };

    const sizeChanger = [...document.querySelectorAll(".ant-pagination-options-size-changer,.ant-pagination-options")]
      .find(visible);
    const selector = sizeChanger?.querySelector(".ant-select-selector");
    if (selector) {
      selector.click();
      await wait(250);
      const options = [...document.querySelectorAll('[role="option"],.ant-select-item-option')]
        .filter(visible)
        .map((element) => ({ element, size: Number(String(element.textContent || "").match(/\\d+/)?.[0] || 0) }))
        .filter((entry) => entry.size > 0)
        .sort((left, right) => right.size - left.size);
      const currentSize = readPage().pageSize;
      if (options[0] && options[0].size > currentSize) {
        options[0].element.click();
        await wait(1_200);
      } else {
        document.body.click();
      }
    }

    let firstSnapshot = readPage();
    for (let attempt = 0; attempt < 60 && (!firstSnapshot.total || !firstSnapshot.keys.length); attempt += 1) {
      await wait(250);
      firstSnapshot = readPage();
    }
    const expected = Math.max(${Number(expectedTotal) || 0}, firstSnapshot.total);
    const finalPageCount = firstSnapshot.pageCount
      || (expected > 0 && firstSnapshot.pageSize > 0 ? Math.ceil(expected / firstSnapshot.pageSize) : 0);
    if (expected < 1 || finalPageCount < 1 || !firstSnapshot.keys.length) {
      return { ok: false, code: "PRODUCT_PAGE_NOT_READY", expected, actual: 0, pageCount: finalPageCount };
    }

    if (finalPageCount > 1 && !(await clickPage(finalPageCount))) {
      return { ok: false, code: "PRODUCT_LAST_PAGE_FAILED", expected, actual: 0, pageCount: finalPageCount };
    }
    let lastSnapshot = readPage();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (lastSnapshot.currentPage === finalPageCount && lastSnapshot.keys.length > 0) break;
      await wait(250);
      lastSnapshot = readPage();
    }
    if (lastSnapshot.currentPage !== finalPageCount || !lastSnapshot.keys.length) {
      return { ok: false, code: "PRODUCT_LAST_PAGE_FAILED", expected, actual: 0, pageCount: finalPageCount };
    }
    if (lastSnapshot.total > 0 && lastSnapshot.total !== expected) {
      return { ok: false, code: "PARTIAL_PRODUCT_COLLECTION", expected, actual: lastSnapshot.total, pageCount: finalPageCount };
    }

    const exportPattern = /^전체\\s*내보내기$/;
    let exportButton = null;
    for (let attempt = 0; attempt < 20 && !exportButton; attempt += 1) {
      const labelElement = [...document.querySelectorAll("button, [role='button'], a, span")]
        .find((element) => visible(element) && exportPattern.test(normalizedText(element)));
      exportButton = labelElement?.closest?.("button, [role='button'], a") || labelElement || null;
      if (!exportButton) await wait(250);
    }
    if (!exportButton) return { ok: false, code: "EXPORT_BUTTON_NOT_FOUND_AFTER_VERIFICATION", expected, actual: expected };
    if (exportButton.disabled || exportButton.getAttribute("aria-disabled") === "true") {
      return { ok: false, code: "EXPORT_BUTTON_DISABLED_AFTER_VERIFICATION", expected, actual: expected };
    }
    const clickLikeUser = (element) => {
      if (!element) return false;
      element.scrollIntoView({ block: "center", inline: "center" });
      element.focus?.();
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button: 0,
        }));
      }
      element.click?.();
      return true;
    };
    clickLikeUser(exportButton);
    await wait(700);

    let confirmationObserved = false;
    let confirmationClicked = false;
    let confirmationClickCount = 0;
    let requestAcknowledged = false;
    const confirmationPattern = /^(?:확인|내보내기|생성|확정|제출|계속|确认|确定|提交|导出|继续)$/i;
    const cancelPattern = /취소|닫기|取消|关闭/i;
    const successPattern = /(?:내보내기|작업|파일).*(?:등록|생성|완료|성공|접수)|(?:导出|任务).*(?:成功|已创建|已提交)/i;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const dialogs = [...document.querySelectorAll(
        ".ant-modal, .ant-modal-confirm, [role='dialog'], .ant-popover, .ant-drawer"
      )].filter(visible);
      if (dialogs.length) confirmationObserved = true;
      const controls = dialogs.flatMap((dialog) =>
        [...dialog.querySelectorAll("button, [role='button'], a")].filter(visible)
      );
      const confirmControl = controls.find((element) => {
        const label = normalizedText(element);
        return confirmationPattern.test(label) && !cancelPattern.test(label);
      }) || controls.find((element) => {
        const label = normalizedText(element);
        const className = String(element.className || "");
        return /primary|confirm|ok/i.test(className) && !cancelPattern.test(label);
      });
      if (confirmControl) {
        clickLikeUser(confirmControl);
        confirmationClicked = true;
        confirmationClickCount += 1;
        await wait(900);
        continue;
      }
      if (successPattern.test(normalizedText(document.body))) {
        requestAcknowledged = true;
        break;
      }
      if (confirmationClickCount > 0 && dialogs.length === 0) {
        await wait(1_200);
        const remainingDialogs = [...document.querySelectorAll(
          ".ant-modal, .ant-modal-confirm, [role='dialog'], .ant-popover, .ant-drawer"
        )].filter(visible);
        if (!remainingDialogs.length) {
          requestAcknowledged = true;
          break;
        }
      }
      await wait(250);
    }
    return {
      ok: true,
      expected,
      actual: expected,
      pageCount: finalPageCount,
      firstPageCount: firstSnapshot.keys.length,
      lastPageCount: lastSnapshot.keys.length,
      confirmationObserved,
      confirmationClicked,
      confirmationClickCount,
      requestAcknowledged,
      confirmationTimedOut: !requestAcknowledged,
    };
  })()`, true);
}

async function captureSellerDiagnostic(brandName = "", stage = "error") {
  if (!sellerWindow || sellerWindow.isDestroyed()) return "";
  try {
    const folder = join(app.getPath("userData"), "seller-diagnostics");
    await mkdir(folder, { recursive: true });
    const filePath = join(folder, `${safeBrandExportLabel(brandName) || "brand"}_${stage}_${localFileTimestamp()}.png`);
    const image = await sellerWindow.webContents.capturePage();
    await writeFile(filePath, image.toPNG());
    return filePath;
  } catch {
    return "";
  }
}

async function confirmSellerExportRequest(targetFrame) {
  return targetFrame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getBoundingClientRect().width > 0
      && element.getBoundingClientRect().height > 0;
    const textOf = (element) => String(element?.innerText || element?.textContent || "")
      .replace(/\\s+/g, " ").trim();
    const clickLikeUser = (element) => {
      element?.scrollIntoView?.({ block: "center", inline: "center" });
      element?.focus?.();
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        element?.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, composed: true, view: window, button: 0,
        }));
      }
      element?.click?.();
    };
    const confirmPattern = /^(?:확인|내보내기|생성|확정|제출|계속|确认|确定|提交|导出|继续)$/i;
    const cancelPattern = /취소|닫기|取消|关闭/i;
    let confirmationObserved = false;
    let confirmationClicked = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const dialogs = [...document.querySelectorAll(
        ".ant-modal, .ant-modal-confirm, [role='dialog'], .ant-popover, .ant-drawer"
      )].filter(visible);
      if (dialogs.length) confirmationObserved = true;
      const controls = dialogs.flatMap((dialog) =>
        [...dialog.querySelectorAll("button, [role='button'], a")].filter(visible)
      );
      const confirmControl = controls.find((element) => {
        const label = textOf(element);
        return confirmPattern.test(label) && !cancelPattern.test(label);
      }) || controls.find((element) => {
        const label = textOf(element);
        return /primary|confirm|ok/i.test(String(element.className || ""))
          && !cancelPattern.test(label);
      });
      if (confirmControl) {
        clickLikeUser(confirmControl);
        confirmationClicked = true;
        await wait(900);
        continue;
      }
      if (confirmationClicked && !dialogs.length) {
        return { ok: true, confirmationObserved, confirmationClicked, requestAcknowledged: true };
      }
      await wait(250);
    }
    return {
      ok: !confirmationObserved,
      confirmationObserved,
      confirmationClicked,
      requestAcknowledged: !confirmationObserved,
    };
  })()`, true);
}

async function clickSellerDownloadCenterShortcut(targetFrame) {
  return targetFrame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getBoundingClientRect().width > 0
      && element.getBoundingClientRect().height > 0;
    const textOf = (element) => String(element?.innerText || element?.textContent || "")
      .replace(/\\s+/g, " ").trim();
    const pattern = /^(?:다운로드센터\\s*바로\\s*가기|다운로드\\s*센터\\s*바로\\s*가기)$/;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const control = [...document.querySelectorAll("a, button, [role='button'], span")]
        .filter(visible)
        .find((element) => pattern.test(textOf(element)));
      if (control) {
        const target = control.closest("a, button, [role='button']") || control;
        target.scrollIntoView?.({ block: "center", inline: "center" });
        target.focus?.();
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
          target.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, composed: true, view: window, button: 0,
          }));
        }
        target.click?.();
        return { ok: true, clicked: true, label: textOf(control) };
      }
      await wait(250);
    }
    return { ok: false, clicked: false, code: "DOWNLOAD_CENTER_SHORTCUT_NOT_FOUND" };
  })()`, true);
}

function moveWindowsCursorAndClick(screenX, screenY) {
  if (process.platform !== "win32") return Promise.resolve({ ok: false, reason: "WINDOWS_ONLY" });
  const x = Math.round(Number(screenX));
  const y = Math.round(Number(screenY));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return Promise.resolve({ ok: false, reason: "INVALID_SCREEN_COORDINATES" });
  }
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AroundGCursor {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
'@
$point = New-Object AroundGCursor+POINT
[AroundGCursor]::GetCursorPos([ref]$point) | Out-Null
$startX = $point.X
$startY = $point.Y
$targetX = ${x}
$targetY = ${y}
for ($step = 1; $step -le 18; $step++) {
  $nextX = [Math]::Round($startX + (($targetX - $startX) * $step / 18))
  $nextY = [Math]::Round($startY + (($targetY - $startY) * $step / 18))
  [AroundGCursor]::SetCursorPos($nextX, $nextY) | Out-Null
  Start-Sleep -Milliseconds 15
}
[AroundGCursor]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 70
[AroundGCursor]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
`;
  return new Promise((resolve) => {
    execFile("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle", "Hidden",
      "-Command", script,
    ], { windowsHide: true, timeout: 5_000 }, (error) => {
      resolve(error ? { ok: false, reason: String(error.message || error) } : { ok: true });
    });
  });
}

async function physicalClickSellerElement(targetFrame, locatorScript, step, timeoutMs = 8_000) {
  if (!sellerWindow || sellerWindow.isDestroyed()) return { ok: false, step: `${step}_WINDOW_MISSING` };
  sellerWindow.showInactive();
  sellerWindow.webContents.focus();
  const startedAt = Date.now();
  let point = null;
  while (!point && Date.now() - startedAt < timeoutMs) {
    point = await targetFrame.executeJavaScript(`(() => {
      const visible = (element) => element && element.getBoundingClientRect().width > 0
        && element.getBoundingClientRect().height > 0;
      const textOf = (element) => String(element?.innerText || element?.textContent || "")
        .replace(/\\s+/g, " ").trim();
      const element = (() => { ${locatorScript} })();
      if (!element || !visible(element)) return null;
      element.scrollIntoView?.({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, label: textOf(element) };
    })()`, true).catch(() => null);
    if (!point) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!point) return { ok: false, step: `${step}_NOT_FOUND` };
  const bounds = sellerWindow.getContentBounds();
  const clicked = await moveWindowsCursorAndClick(bounds.x + point.x, bounds.y + point.y);
  await new Promise((resolve) => setTimeout(resolve, 700));
  return clicked.ok ? { ok: true, step, label: point.label } : { ok: false, step: `${step}_CLICK_FAILED` };
}

async function performPhysicalSellerSortAndExport(targetFrame) {
  const sort = await physicalClickSellerElement(targetFrame, `
    const pattern = /현지\\s*판매자\\s*최근\\s*30일\\s*판매량/;
    const label = [...document.querySelectorAll("th,[role='columnheader'],thead td,thead div")]
      .filter(visible).find((element) => pattern.test(textOf(element)));
    if (!label) return null;
    const header = label.closest("th,[role='columnheader'],thead td") || label;
    const candidates = [...header.querySelectorAll("button,[role='button'],[class*='sort'],svg,i")].filter(visible);
    return candidates.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0]
      || header;
  `, "PHYSICAL_LOCAL_SALES_SORT");
  if (!sort.ok) return sort;
  const descending = await physicalClickSellerElement(targetFrame, `
    return [...document.querySelectorAll("button,[role='button'],[role='menuitem'],li,span,div")]
      .filter(visible).find((element) => /^내림차순$/.test(textOf(element)));
  `, "PHYSICAL_DESCENDING");
  if (!descending.ok) return descending;
  const confirm = await physicalClickSellerElement(targetFrame, `
    const dialogs = [...document.querySelectorAll("[role='dialog'],.ant-popover,.ant-dropdown,.ant-modal")].filter(visible);
    const root = dialogs.at(-1) || document;
    return [...root.querySelectorAll("button,[role='button'],a,span")]
      .filter(visible).find((element) => /^확인$/.test(textOf(element)))?.closest("button,[role='button'],a") || null;
  `, "PHYSICAL_SORT_CONFIRM");
  if (!confirm.ok) return confirm;
  await new Promise((resolve) => setTimeout(resolve, 900));
  const exportClick = await physicalClickSellerElement(targetFrame, `
    return [...document.querySelectorAll("button,[role='button'],a,span")]
      .filter(visible).find((element) => /^전체\\s*내보내기$/.test(textOf(element)))?.closest("button,[role='button'],a") || null;
  `, "PHYSICAL_EXPORT");
  return exportClick.ok ? { ok: true, sort: "LOCAL_SELLER_RECENT_30_DAYS_DESC", exportClicked: true } : exportClick;
}

async function confirmSellerExportRequestPhysical(targetFrame) {
  const clicked = await physicalClickSellerElement(targetFrame, `
    const dialogs = [...document.querySelectorAll(".ant-modal,.ant-modal-confirm,[role='dialog']")].filter(visible);
    const dialog = dialogs.at(-1);
    if (!dialog) return null;
    return [...dialog.querySelectorAll("button,[role='button'],a")].filter(visible)
      .find((element) => /^(?:확인|내보내기|생성|확정|제출|계속)$/.test(textOf(element))) || null;
  `, "PHYSICAL_EXPORT_CONFIRM", 15_000);
  return clicked.ok
    ? { ok: true, confirmationObserved: true, confirmationClicked: true, requestAcknowledged: true }
    : { ok: false, confirmationObserved: false, confirmationClicked: false, requestAcknowledged: false };
}

async function clickSellerDownloadCenterShortcutPhysical(targetFrame) {
  const mainFrame = sellerWindow?.webContents?.mainFrame;
  const frames = [mainFrame, targetFrame, ...sellerWindowFrames()]
    .filter(Boolean)
    .filter((frame, index, all) =>
      all.findIndex((candidate) => candidate.routingId === frame.routingId) === index
    );
  const locator = `
    const controls = [...document.querySelectorAll("a,button,[role='button']")].filter(visible);
    return controls.find((element) => {
      const label = textOf(element);
      const href = String(element.href || element.getAttribute?.("href") || "");
      return /exportCenter/i.test(href)
        || /^(?:다운로드\\s*센터.*(?:바로\\s*가기|이동)|바로\\s*가기)$/.test(label);
    }) || null;
  `;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const frame of frames) {
      const clicked = await physicalClickSellerElement(
        frame,
        locator,
        "PHYSICAL_DOWNLOAD_CENTER",
        700,
      );
      if (clicked.ok) {
        const navigationDeadline = Date.now() + 10_000;
        while (Date.now() < navigationDeadline) {
          const currentUrl = String(sellerWindow?.webContents?.getURL?.() || "");
          if (/\/main\/exportCenter(?:[/?#]|$)/i.test(currentUrl)) {
            return { ok: true, clicked: true, navigated: true, url: currentUrl };
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return { ok: true, clicked: true, navigated: false };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { ok: false, clicked: false, code: "DOWNLOAD_CENTER_SHORTCUT_NOT_FOUND" };
}


async function typeSellerBrandWithRealKeyboard(targetFrame, brandName) {
  if (!sellerWindow || sellerWindow.isDestroyed()) {
    return { ok: false, step: "SELLER_WINDOW_NOT_AVAILABLE" };
  }
  sellerWindow.showInactive();
  sellerWindow.webContents.focus();
  const focused = await targetFrame.executeJavaScript(`(() => {
    const visible = (element) => element && element.getBoundingClientRect().width > 0
      && element.getBoundingClientRect().height > 0;
    const textOf = (element) => String(element?.innerText || element?.textContent || "")
      .replace(/\\s+/g, " ").trim();
    const searchButton = [...document.querySelectorAll("button, [role='button']")]
      .filter(visible)
      .find((element) => /^검색\\s*및\\s*입찰$/.test(textOf(element)));
    if (!searchButton) return { ok: false, step: "EXACT_SEARCH_BUTTON_NOT_FOUND" };
    const buttonRect = searchButton.getBoundingClientRect();
    const input = [...document.querySelectorAll("input, textarea")]
      .filter(visible)
      .filter((element) => !element.disabled && !element.readOnly)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element,
          verticalDistance: Math.abs(
            (rect.top + rect.height / 2) - (buttonRect.top + buttonRect.height / 2)
          ),
          horizontalGap: buttonRect.left - rect.right,
        };
      })
      .filter((candidate) => candidate.verticalDistance < 24
        && candidate.horizontalGap >= -4 && candidate.horizontalGap < 80)
      .sort((left, right) => left.horizontalGap - right.horizontalGap)[0]?.element;
    if (!input) return { ok: false, step: "EXACT_SEARCH_INPUT_NOT_FOUND" };
    input.scrollIntoView({ block: "center", inline: "center" });
    input.focus();
    input.select?.();
    return {
      ok: true,
      searchX: Math.round(buttonRect.left + buttonRect.width / 2),
      searchY: Math.round(buttonRect.top + buttonRect.height / 2),
    };
  })()`, true).catch(() => ({ ok: false, step: "KEYBOARD_FOCUS_FAILED" }));
  if (!focused?.ok || !sellerWindow || sellerWindow.isDestroyed()) return focused;
  sellerWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
  sellerWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
  sellerWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
  sellerWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
  // Electron can leave insertText's returned promise pending while a web page
  // is processing focus. Send it without awaiting and verify the visible value
  // on a fixed deadline instead of blocking the entire brand queue forever.
  void sellerWindow.webContents.insertText(String(brandName));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const verified = await Promise.race([
    targetFrame.executeJavaScript(`(() => {
    const active = document.activeElement;
    const value = String(active?.value || "").trim();
    return {
      ok: value === ${JSON.stringify(String(brandName))},
      step: value === ${JSON.stringify(String(brandName))} ? "REAL_KEYBOARD_INPUT_CONFIRMED" : "REAL_KEYBOARD_INPUT_FAILED",
      inputValue: value,
    };
    })()`, true),
    new Promise((resolve) => setTimeout(() => resolve({
      ok: false,
      step: "REAL_KEYBOARD_INPUT_VERIFY_TIMEOUT",
    }), 3_000)),
  ]).catch(() => ({ ok: false, step: "REAL_KEYBOARD_INPUT_VERIFY_FAILED" }));
  if (!verified?.ok || !sellerWindow || sellerWindow.isDestroyed()) return verified;
  const x = Number(focused.searchX);
  const y = Number(focused.searchY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ...verified, ok: false, step: "REAL_SEARCH_BUTTON_COORDINATES_MISSING" };
  }
  const contentBounds = sellerWindow.getContentBounds();
  const screenX = Math.round(contentBounds.x + x);
  const screenY = Math.round(contentBounds.y + y);
  const physicalClick = await moveWindowsCursorAndClick(screenX, screenY);
  if (!physicalClick.ok) {
    sellerWindow.webContents.sendInputEvent({ type: "mouseMove", x, y });
    sellerWindow.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x, y });
    sellerWindow.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x, y });
  }
  // Keep the Seller Center active long enough for its real click handler to
  // start the request before the caller minimizes the window.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return {
    ...verified,
    submitted: true,
    physicalCursorMoved: physicalClick.ok,
    step: physicalClick.ok ? "PHYSICAL_SEARCH_BUTTON_CLICKED" : "REAL_SEARCH_BUTTON_CLICKED",
  };
}

async function automateSellerBrandExport(input = {}) {
  const sessionGeneration = brandWorkSessionGeneration;
  const attemptGeneration = ++brandExportAttemptGeneration;
  const cleared = () => sessionGeneration !== brandWorkSessionGeneration
    || attemptGeneration !== brandExportAttemptGeneration;
  const brandName = String(input.brandName || "").trim();
  const brandKo = String(input.brandKo || "").trim();
  if (brandExportJobPending) {
    return {
      ok: false,
      code: "EXPORT_ALREADY_PENDING",
      message: "이미 POIZON 데이터를 가져오고 있습니다. 같은 작업을 다시 만들지 않습니다.",
    };
  }
  if (!brandName) return { ok: false, message: "선택한 브랜드명이 없습니다." };
  const officialAuditPaused = pauseOfficialDomainAuditForSellerAutomation();
  if (officialAuditPaused) {
    mainWindow?.webContents.send("brand-export:progress", {
      status: "official-audit-paused-for-seller",
      brandName,
      jobState: "1단계/5 · 공식몰 검증 분리 · 판매자센터 연결 준비",
      message: `${brandName} · 공식몰 전체 검증을 멈추고 POIZON 브랜드 검색을 우선 실행합니다. 검증 기록은 유지되며 검증 계속 버튼을 누를 때만 재개됩니다.`,
    });
  }
  const folder = currentBrandExportFolder();
  await mkdir(folder, { recursive: true });
  pendingBrandExportName = brandName;
  pendingBrandExportJobId = "";
  brandExportJobPending = true;
  brandDownloadStarted = false;
  // Show the exact Electron Seller Center window that is being automated.
  // A separately opened Chrome window is a different browser session and does
  // not reflect this automation, which previously made real work look idle.
  openSellerCenterWindow(SELLER_PRODUCT_SEARCH_URL, {
    visible: false,
    activate: false,
    deferNavigation: true,
  });
  if (!sellerWindow || sellerWindow.isDestroyed()) {
    brandExportJobPending = false;
    pendingBrandExportName = "";
    return { ok: false, message: "판매자센터 창을 열지 못했습니다." };
  }
  const baselinePromise = readSellerExportBaselineSeparately().catch(() => null);
  if (cleared()) return { ok: false, code: "WORK_CLEARED", message: "작업 기록 삭제로 이전 요청을 중단했습니다." };
  mainWindow?.webContents.send("brand-export:progress", {
    status: "opening-product-search",
    brandName,
    jobState: "1단계/5 · 판매자센터 연결 시도",
    message: `${brandName} · 판매자센터 상품검색 화면 연결을 시도합니다.`,
  });
  try {
    await sellerWindow.loadURL(SELLER_PRODUCT_SEARCH_URL);
  } catch (error) {
    const diagnosticPath = await captureSellerDiagnostic(brandName, "page-load-failed");
    brandExportJobPending = false;
    pendingBrandExportName = "";
    return {
      ok: false,
      code: "SELLER_PAGE_LOAD_FAILED",
      message: `${brandName} 판매자센터 상품검색 페이지 연결에 실패했습니다.${diagnosticPath ? ` 진단 화면: ${diagnosticPath}` : ""}`,
      diagnostics: { reason: String(error?.message || error || ""), path: diagnosticPath },
    };
  }
  await new Promise((resolve) => setTimeout(resolve, 3500));
  // Keep the same persistent Seller Center session and automation path used by
  // the popular-list collector, but leave the native window minimized while
  // brand search, export registration, and download-center monitoring run.
  // backgroundThrottling is disabled on this BrowserWindow, so minimizing it
  // does not pause the seller automation.
  if (sellerWindow && !sellerWindow.isDestroyed()) {
    sellerWindow.showInactive();
    sellerWindow.minimize();
    showCollectorWindow();
  }
  const connectedPage = await executeSellerFrameWithTimeout(sellerWindow.webContents.mainFrame, `(() => ({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    login: /login|signin|passport/i.test(location.href),
    inputCount: document.querySelectorAll("input, textarea").length,
  }))()`, 4_000, { url: sellerWindow.webContents.getURL(), readyState: "timeout", inputCount: 0 });
  mainWindow?.webContents.send("brand-export:progress", {
    status: connectedPage.login ? "seller-login-required" : "seller-page-connected",
    brandName,
    jobState: connectedPage.login ? "1단계/5 · 판매자센터 로그인 필요" : "1단계/5 · 판매자센터 페이지 연결 확인",
    message: `${brandName} · URL ${connectedPage.url || "확인 불가"} · 문서 ${connectedPage.readyState || "unknown"} · 입력 요소 ${Number(connectedPage.inputCount || 0)}개`,
  });
  if (connectedPage.login) {
    brandExportJobPending = false;
    pendingBrandExportName = "";
    return {
      ok: false,
      code: "SELLER_LOGIN_REQUIRED",
      message: `${brandName} 작업을 진행하려면 POIZON 판매자센터 로그인이 필요합니다.`,
    };
  }
  // Freeze the download-center job list before clicking "전체 내보내기".
  // Waiting until after the export allowed the newly-created job to leak into
  // the baseline, so the first job could never be recognized as new.
  let baselineJobs = await baselinePromise;
  if (!Array.isArray(baselineJobs)) {
    baselineJobs = await Promise.race([
      readSellerExportJobsFromMonitor(),
      new Promise((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]).catch(() => null);
  }
  const baselineAvailable = Array.isArray(baselineJobs);
  const baselineJobIds = new Set([
    ...brandExportJobs.keys(),
    ...savedBrandExportJobs().map((job) => String(job?.jobId || "").trim()),
    ...(baselineJobs || []).map((job) => String(job?.id || "").trim()),
  ].filter(Boolean));
  mainWindow?.webContents.send("brand-export:progress", {
    status: baselineAvailable ? "job-baseline-ready" : "job-baseline-fallback",
    brandName,
    jobState: "기존 작업번호 확인 완료 · 상품검색 시작",
    message: baselineAvailable
      ? `${brandName} · 내보내기 전 기존 작업번호 ${baselineJobIds.size}개를 고정했습니다.`
      : `${brandName} · 저장된 미사용 작업번호를 제외하고 새 작업번호를 확인합니다.`,
  });
  const sellerBrandAliasGroups = [
    ["Columbia", "컬럼비아", "哥伦比亚"],
    ["Patagonia", "파타고니아", "巴塔哥尼亚"],
    ["Tommy Hilfiger", "타미힐피거", "汤米希尔费格"],
    ["FILA", "휠라", "斐乐"],
    ["Reebok", "리복", "锐步"],
  ];
  const brandKoInput = String(input.brandKo || "").trim();
  const sellerBrandMatchKeys = [brandName, brandKoInput];
  const localizedAliases = sellerBrandAliasGroups.find((aliases) =>
    aliases.some((alias) => brandsMatch(brandName, alias) || brandsMatch(brandKoInput, alias))
  );
  if (localizedAliases) sellerBrandMatchKeys.push(...localizedAliases);
  if (brandsMatch(brandName, "Jordan")) {
    sellerBrandMatchKeys.push("Jordan", "조던", "乔丹");
  }
  mainWindow?.webContents.send("brand-export:progress", {
    status: "searching-brand-products",
    brandName,
    jobState: "1단계/5 · 브랜드 입력·상품 검색 중",
    message: `${brandName} · 브랜드를 입력하고 상품 검색을 실행합니다.`,
  });
  const runSellerSearch = (targetFrame, searchAlreadySubmitted = false) => targetFrame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getBoundingClientRect().width > 0
      && element.getBoundingClientRect().height > 0;
    const textOf = (element) => String(element?.innerText || element?.textContent || "")
      .replace(/\\s+/g, " ").trim();
    const normalize = (value) => String(value || "").replace(/\\s+/g, "").trim();
    const clickLikeUser = (element) => {
      if (!element) return false;
      element.scrollIntoView({ block: "center", inline: "center" });
      element.focus?.();
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button: 0,
        }));
      }
      element.click?.();
      return true;
    };
    const findVisibleByText = (selector, pattern) =>
      [...document.querySelectorAll(selector)].filter(visible)
        .find((element) => pattern.test(textOf(element)));
        const roots = [document];
        for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
          const root = roots[rootIndex];
          for (const element of root.querySelectorAll("*")) {
            if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
          }
        }
        const inputs = roots.flatMap((root) => [...root.querySelectorAll("input, textarea")])
          .filter((element, index, all) => all.indexOf(element) === index)
          .filter(visible)
          .filter((element) => {
            const type = String(element.type || "text").toLowerCase();
            return !element.disabled && !element.readOnly
              && !["hidden", "password", "date", "datetime-local", "month", "time", "file", "checkbox", "radio"].includes(type);
          });
        // The proven Seller Center flow uses the global product query input at
        // the very top of the page: [상품 정보] [query] [검색 및 입찰]. Do not
        // confuse it with one of the many product-filter inputs below it.
        const exactSearchButtons = roots.flatMap((root) =>
          [...root.querySelectorAll("button, [role='button']")]
        ).filter((element, index, all) => all.indexOf(element) === index)
          .filter(visible)
          .filter((element) => /^검색\\s*및\\s*입찰$/.test(textOf(element)));
        const exactSearchButton = exactSearchButtons
          .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0] || null;
        const exactButtonRect = exactSearchButton?.getBoundingClientRect();
        const exactInput = exactButtonRect
          ? inputs.map((element) => {
              const rect = element.getBoundingClientRect();
              const verticalDistance = Math.abs(
                (rect.top + rect.height / 2) - (exactButtonRect.top + exactButtonRect.height / 2)
              );
              const horizontalGap = exactButtonRect.left - rect.right;
              return { element, verticalDistance, horizontalGap, top: rect.top };
            }).filter((candidate) => candidate.verticalDistance < 24
              && candidate.horizontalGap >= -4 && candidate.horizontalGap < 80)
            .sort((left, right) => left.horizontalGap - right.horizontalGap)[0]?.element || null
          : null;
        const inputScore = (element) => {
          const rect = element.getBoundingClientRect();
          const attributes = [
            element.placeholder,
            element.getAttribute("aria-label"),
            element.getAttribute("name"),
            element.getAttribute("id"),
            element.getAttribute("data-placeholder"),
          ].filter(Boolean).join(" ");
          const context = textOf(element.closest("form, .ant-form-item, [class*='form'], [class*='search']") || element.parentElement);
          const strongHint = /상품|상품명|브랜드|품번|검색|product|brand|article|spu|sku|商品|品牌|货号|搜索|查询/i.test(attributes);
          const contextHint = /상품|브랜드|품번|검색|product|brand|spu|sku|商品|品牌|货号/i.test(context);
          return (strongHint ? 1000 : 0)
            + (contextHint ? 300 : 0)
            + (rect.top >= 0 && rect.top < 360 ? 120 : 0)
            + Math.min(180, Math.round(rect.width));
        };
        const searchInputs = inputs.map((element) => ({ element, score: inputScore(element) }))
          .sort((left, right) => right.score - left.score);
        const input = exactInput || searchInputs[0]?.element || null;
        if (!input || (!exactInput && searchInputs[0].score < 200)) {
          return { ok: false, step: "SEARCH_INPUT_NOT_FOUND", inputCount: inputs.length };
        }
        const readSearchState = () => {
          const rows = [...document.querySelectorAll("tbody tr")].filter(visible);
          const rowTexts = rows.slice(0, 30).map((row) =>
            String(row.innerText || row.textContent || "").replace(/\\s+/g, " ").trim()
          );
          const rowText = rowTexts.join("\\n");
          const totalText = [...document.querySelectorAll("body *")]
            .filter(visible)
            .map((element) => String(element.innerText || element.textContent || "").trim())
            .find((text) => /^총\\s*[\\d,]+\\s*건\\s*결과$/.test(text)) || "";
          const totalCount = Number(String(totalText).replace(/[^0-9]/g, "")) || 0;
          return { rowText, rowTexts, totalText, totalCount };
        };
        const beforeSearch = readSearchState();
        const requestedBrandKeys = ${JSON.stringify(sellerBrandMatchKeys)}
          .map(normalize).filter(Boolean);
        const requestedBrandRatio = (state) => {
          const rows = Array.isArray(state?.rowTexts) ? state.rowTexts.filter(Boolean) : [];
          if (!rows.length || !requestedBrandKeys.length) return 0;
          const matches = rows.filter((row) => requestedBrandKeys.some((key) => {
            const normalizedKey = normalize(key).toLocaleLowerCase();
            if (normalizedKey.length > 3) return normalize(row).toLocaleLowerCase().includes(normalizedKey);
            const tokens = String(row || "").toLocaleLowerCase()
              .split(/[^a-z0-9가-힣]+/).filter(Boolean);
            return tokens.includes(String(key || "").trim().toLocaleLowerCase());
          })).length;
          return matches / rows.length;
        };
        const hasRequestedBrand = (state) => requestedBrandRatio(state) >= 0.8;
        const valuePrototype = input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(valuePrototype, "value")?.set;
        const applyValue = (value) => {
          const previousValue = String(input.value || "");
          input.focus();
          if (setter) setter.call(input, value);
          else input.value = value;
          // POIZON uses a React-controlled global search input. Reset React's
          // value tracker to the previous DOM value so the synthetic input
          // event is recognized as a real user change instead of being ignored
          // and immediately rendered back to an empty string.
          if (input._valueTracker && typeof input._valueTracker.setValue === "function") {
            input._valueTracker.setValue(previousValue);
          }
          input.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: value ? "insertText" : "deleteContentBackward",
            data: value || null,
          }));
          input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        };
        if (String(input.value || "").trim() !== ${JSON.stringify(brandName)}) {
          applyValue("");
          await wait(160);
          applyValue(${JSON.stringify(brandName)});
          await wait(700);
        }
        if (String(input.value || "").trim() !== ${JSON.stringify(brandName)}) {
          return {
            ok: false,
            step: "BRAND_INPUT_NOT_APPLIED",
            actualInputValue: String(input.value || "").trim(),
            expectedInputValue: ${JSON.stringify(brandName)},
          };
        }
        const buttons = [...document.querySelectorAll("button, [role='button']")].filter(visible);
        const inputRect = input.getBoundingClientRect();
        const searchCandidates = buttons.filter((element) =>
          /검색\\s*및\\s*입찰|^검색$|^검색하기$|搜索|查询|search/i.test(String(element.innerText || element.textContent || "").trim())
        );
        const search = exactSearchButton || searchCandidates.find((element) => {
          const rect = element.getBoundingClientRect();
          return Math.abs((rect.top + rect.height / 2) - (inputRect.top + inputRect.height / 2)) < 90;
        }) || searchCandidates[0];
        const pressEnter = () => {
          input.focus();
          for (const type of ["keydown", "keypress", "keyup"]) {
            input.dispatchEvent(new KeyboardEvent(type, {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            }));
          }
        };
        const waitForSearchUpdate = async () => {
          let stableSignature = "";
          let stableCount = 0;
          for (let attempt = 0; attempt < 60; attempt += 1) {
            await wait(250);
            const current = readSearchState();
            const changed = current.rowText !== beforeSearch.rowText || current.totalText !== beforeSearch.totalText;
            const hasRows = current.rowText.length > 0;
            const brandMatched = hasRequestedBrand(current);
            const signature = current.totalText + "\\n" + current.rowText;
            // The working Seller Center keeps the visible "총 9,900건" label
            // unchanged after a search. The rendered product rows are the
            // authoritative signal that the brand search completed.
            // The physical click happens before this verifier starts. On a
            // fast response the first snapshot can already be the filtered
            // result, so matching rows are authoritative even when the DOM no
            // longer differs from that snapshot.
            const requestedInputConfirmed = normalize(input.value).toLocaleLowerCase()
              === normalize(${JSON.stringify(brandName)}).toLocaleLowerCase();
            if (hasRows && (brandMatched || (alreadySubmitted && requestedInputConfirmed))) {
              stableCount = signature === stableSignature ? stableCount + 1 : 1;
              stableSignature = signature;
              if (stableCount >= 3) return true;
            } else {
              stableCount = 0;
              stableSignature = "";
            }
          }
          return false;
        };
        const alreadySubmitted = ${JSON.stringify(Boolean(searchAlreadySubmitted))};
        if (!alreadySubmitted) {
          if (search) clickLikeUser(search);
          else pressEnter();
        }
        let searchApplied = await waitForSearchUpdate();
        if (!searchApplied && !alreadySubmitted) {
          pressEnter();
          searchApplied = await waitForSearchUpdate();
        }
        if (!searchApplied && !alreadySubmitted && search) {
          clickLikeUser(search);
          searchApplied = await waitForSearchUpdate();
        }
        if (!searchApplied
          && ${JSON.stringify(brandKoInput)} !== ""
          && ${JSON.stringify(brandKoInput)} !== ${JSON.stringify(brandName)}) {
          applyValue("");
          await wait(160);
          applyValue(${JSON.stringify(brandKoInput)});
          await wait(700);
          if (search) clickLikeUser(search);
          else pressEnter();
          searchApplied = await waitForSearchUpdate();
          if (!searchApplied) {
            pressEnter();
            searchApplied = await waitForSearchUpdate();
          }
        }
        if (!searchApplied) {
          const current = readSearchState();
          return {
            ok: false,
            step: hasRequestedBrand(current) ? "SEARCH_RESULT_NOT_UPDATED" : "BRAND_RESULT_MISMATCH",
            beforeTotal: beforeSearch.totalCount,
            currentTotal: current.totalCount
          };
        }

        // The remaining controls must be operated through the visible Windows
        // cursor. Return after the product search has actually updated so the
        // outer workflow can perform sorting and export physically.
        const searchedState = readSearchState();
        return {
          ok: true,
          inputValue: String(input.value || "").trim(),
          resultRowCount: searchedState.rowTexts.length,
          firstResult: searchedState.rowTexts[0] || "",
        };

    const localSalesPattern = /\\uD604\\uC9C0\\s*\\uD310\\uB9E4\\uC790\\s*\\uCD5C\\uADFC\\s*30\\uC77C\\s*\\uD310\\uB9E4\\uB7C9/;
    const localSalesHeaderText = [...document.querySelectorAll(
      "th, [role='columnheader'], thead td, thead div"
    )].filter(visible)
      .filter((element) => localSalesPattern.test(textOf(element)))
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!localSalesHeaderText) {
      return { ok: false, step: "LOCAL_SELLER_30D_COLUMN_NOT_FOUND" };
    }

    let localSalesHeader = localSalesHeaderText.closest(
      "th, [role='columnheader'], thead td"
    );
    if (!localSalesHeader) {
      localSalesHeader = localSalesHeaderText;
      for (let depth = 0; depth < 6 && localSalesHeader.parentElement; depth += 1) {
        const parent = localSalesHeader.parentElement;
        const rect = parent.getBoundingClientRect();
        if (rect.width > 70 && rect.width < 360 && localSalesPattern.test(textOf(parent))) {
          localSalesHeader = parent;
        } else {
          break;
        }
      }
    }

    const textRect = localSalesHeaderText.getBoundingClientRect();
    const headerRect = localSalesHeader.getBoundingClientRect();
    const headerSearchRoot = localSalesHeader.closest("thead, [role='row']")
      || localSalesHeader.parentElement
      || document;

    const scoreCandidate = (element) => {
      const target = element.closest?.("button, [role='button'], [class*='sort'], [class*='filter'], [aria-label], [title]")
        || element;
      const rect = target.getBoundingClientRect();
      const hint = [
        target.getAttribute?.("aria-label"),
        target.getAttribute?.("title"),
        target.className,
        target.textContent
      ].filter(Boolean).join(" ");
      const centerY = (headerRect.top + headerRect.bottom) / 2;
      const distance = Math.abs(rect.left - textRect.right) + Math.abs((rect.top + rect.bottom) / 2 - centerY);
      const compact = rect.width > 0 && rect.width <= 56 && rect.height > 0 && rect.height <= 56;
      const inHeader = rect.left >= headerRect.left - 8
        && rect.right <= headerRect.right + 12
        && rect.top >= headerRect.top - 8
        && rect.bottom <= headerRect.bottom + 8;
      const rightOfHeaderText = rect.left >= textRect.right - 6
        && rect.left <= textRect.right + 72;
      return {
        target,
        score: (/sort|filter|desc|order/i.test(hint) ? 100 : 0)
          + (rightOfHeaderText ? 90 : 0)
          + (compact ? 45 : 0)
          + (inHeader ? 35 : 0)
          - Math.min(distance, 160)
      };
    };

    const candidateMap = new Map();
    for (const element of headerSearchRoot.querySelectorAll(
      "button, [role='button'], [class*='sort'], [class*='filter'], [aria-label], [title], svg, i, span"
    )) {
      if (!visible(element)) continue;
      const candidate = scoreCandidate(element);
      if (!candidateMap.has(candidate.target)) {
        candidateMap.set(candidate.target, candidate);
      }
    }
    const sortCandidates = [...candidateMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((entry) => entry.target);

    const centerY = (headerRect.top + headerRect.bottom) / 2;
    const probePoints = [
      [textRect.right + 6, centerY],
      [textRect.right + 13, centerY],
      [textRect.right + 21, centerY],
      [headerRect.right - 8, centerY],
      [headerRect.right - 15, centerY],
      [headerRect.right - 10, headerRect.bottom - 10]
    ];

    const descendingPattern = /^\uB0B4\uB9BC\uCC28\uC21C$/;
    const findDescending = () => [...document.querySelectorAll(
      "button, [role='button'], [role='menuitem'], label, li, span, div"
    )].find((el) => visible(el) && descendingPattern.test(normalize(el.textContent)));

    const clickAt = (x, y) => {
      const target = document.elementFromPoint(x, y);
      if (!target) return false;
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
      return true;
    };

    let descending = findDescending();
    for (const candidate of sortCandidates) {
      if (descending) break;
      clickLikeUser(candidate);
      await wait(450);
      descending = findDescending();
    }
    for (const [x, y] of probePoints) {
      if (descending) break;
      clickAt(x, y);
      await wait(450);
      descending = findDescending();
    }
    if (!descending) {
      return { ok: false, code: "LOCAL_SALES_SORT_ICON_NOT_FOUND" };
    }

    clickLikeUser(descending);
    await wait(350);

    const confirmPattern = /^\uD655\uC778$/;
    const findConfirm = () => [...document.querySelectorAll(
      "button, [role='button'], a, span, div"
    )].find((el) => visible(el) && confirmPattern.test(normalize(el.textContent)));
    let confirmControl = findConfirm();
    if (!confirmControl) {
      return { ok: false, code: "LOCAL_SALES_SORT_CONFIRM_NOT_FOUND" };
    }
    clickLikeUser(confirmControl);
    await wait(700);
    confirmControl = findConfirm();
    if (confirmControl) {
      clickLikeUser(confirmControl);
      await wait(900);
    }

    let exportButton = null;
    const exportPattern = /^\uC804\uCCB4\s*\uB0B4\uBCF4\uB0B4\uAE30$/;
    for (let attempt = 0; attempt < 12 && !exportButton; attempt += 1) {
      exportButton = [...document.querySelectorAll("button, [role='button'], a, span")]
        .find((element) => visible(element) && exportPattern.test(normalize(element.textContent)));
      if (!exportButton) await wait(400);
    }
    if (!exportButton) return { ok: false, code: "EXPORT_BUTTON_NOT_FOUND_AFTER_SORT" };
    if (exportButton.disabled || exportButton.getAttribute("aria-disabled") === "true") {
      return { ok: false, code: "EXPORT_BUTTON_DISABLED_AFTER_SORT" };
    }
    clickLikeUser(exportButton);
    await wait(500);
    const verifiedState = readSearchState();
    return {
      ok: true,
      sort: "LOCAL_SELLER_RECENT_30_DAYS_DESC",
      exportClicked: true,
      inputValue: String(input.value || "").trim(),
      resultRowCount: verifiedState.rowTexts.length,
      firstResult: verifiedState.rowTexts[0] || "",
    };
  })()`, true);
  let searched = null;
  let lastSearchDiagnostics = null;
  for (let searchInputAttempt = 1; searchInputAttempt <= 1; searchInputAttempt += 1) {
    const frames = sellerWindowFrames();
    const frameCandidates = [];
    mainWindow?.webContents.send("brand-export:progress", {
      status: "probing-search-frame",
      brandName,
      jobState: "1단계/5 · 상품검색 입력창 연결 중",
      message: `${brandName} · 응답하지 않는 POIZON 내부 프레임은 4초 후 건너뜁니다.`,
    });
    const probedFrames = await Promise.all(frames.map(async (frame) => {
      const probe = await executeSellerFrameWithTimeout(frame, `(() => {
          const visible = (element) => element && element.getClientRects().length > 0;
          const inputs = [...document.querySelectorAll("input, textarea")].filter(visible)
            .filter((element) => !element.disabled && !element.readOnly);
          const body = String(document.body?.innerText || "").slice(0, 1200);
          const hint = /상품|브랜드|품번|검색|SPU|SKU|product|brand|商品|品牌|货号|搜索/i.test(body);
          return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            inputCount: inputs.length,
            hint,
            login: /login|signin|passport/i.test(location.href),
          };
        })()`, 4_000, null);
      return probe ? { frame, probe } : null;
    }));
    frameCandidates.push(...probedFrames.filter(Boolean));
    frameCandidates.sort((left, right) =>
      Number(right.probe?.inputCount > 0) - Number(left.probe?.inputCount > 0)
      || Number(right.probe?.hint) - Number(left.probe?.hint)
      || Number(right.frame.routingId === sellerWindow.webContents.mainFrame.routingId)
        - Number(left.frame.routingId === sellerWindow.webContents.mainFrame.routingId)
    );
    const loginFrame = frameCandidates.find((candidate) => candidate.probe?.login);
    if (loginFrame) {
      searched = { ok: false, step: "SELLER_LOGIN_REQUIRED", diagnostics: loginFrame.probe };
      break;
    }
    for (const candidate of frameCandidates) {
      if (!candidate.probe?.inputCount && !candidate.probe?.hint) continue;
      mainWindow?.webContents.send("brand-export:progress", {
        status: "searching-brand-products",
        brandName,
        jobState: `1단계/5 · 브랜드 입력·상품 검색 중 · ${brandName}`,
        message: `${brandName} · 기존 검색 서비스 방식으로 브랜드를 입력하고 검색을 실행합니다.`,
      });
      // POIZON's top product-search box is React-controlled. Enter the brand
      // through Electron's real keyboard path, as in the recorded manual flow,
      // before clicking the adjacent search button in runSellerSearch.
      const realKeyboardInput = await typeSellerBrandWithRealKeyboard(candidate.frame, brandName)
        .catch(() => ({ ok: false, step: "REAL_KEYBOARD_INPUT_FAILED" }));
      if (sellerWindow && !sellerWindow.isDestroyed()) {
        // Keep the Seller Center visible while sorting, exporting, and
        // confirming. Minimize only after the download-center shortcut.
        sellerWindow.show();
        sellerWindow.focus();
      }
      mainWindow?.webContents.send("brand-export:progress", {
        status: realKeyboardInput?.ok ? "seller-brand-input-confirmed" : "seller-brand-input-fallback",
        brandName,
        jobState: realKeyboardInput?.ok
          ? `1단계/5 · 상품검색 브랜드 입력 완료 · ${brandName}`
          : `1단계/5 · 상품검색 입력 재시도 · ${brandName}`,
        message: realKeyboardInput?.ok
          ? `${brandName} · 판매자센터 상단 상품검색 입력을 확인하고 검색 및 입찰을 실행합니다.`
          : `${brandName} · 실제 키보드 입력이 확인되지 않아 기존 입력 방식으로 즉시 재시도합니다.`,
      });
      if (!realKeyboardInput?.ok) {
        searched = realKeyboardInput || { ok: false, step: "REAL_KEYBOARD_INPUT_FAILED" };
        lastSearchDiagnostics = candidate.probe;
        break;
      }
      const result = await Promise.race([
        runSellerSearch(candidate.frame, Boolean(realKeyboardInput?.submitted)),
        new Promise((resolve) => setTimeout(() => resolve({
          ok: false,
          step: "SELLER_SEARCH_STAGE_TIMEOUT",
        }), 70_000)),
      ]).catch((error) => ({
        ok: false,
        step: "SELLER_SEARCH_SCRIPT_ERROR",
        detail: String(error?.message || error || ""),
      }));
      lastSearchDiagnostics = candidate.probe;
      if (result?.ok) {
        const postSearch = await performPhysicalSellerSortAndExport(candidate.frame)
          .catch((error) => ({
            ok: false,
            step: "PHYSICAL_POST_SEARCH_FAILED",
            detail: String(error?.message || error || ""),
          }));
        if (postSearch?.ok) {
          searched = { ...result, ...postSearch };
          sellerProductFrameRoutingId = candidate.frame.routingId;
          break;
        }
        searched = postSearch;
        break;
      }
      if (result?.step !== "SEARCH_INPUT_NOT_FOUND") {
        searched = result;
        break;
      }
      searched = result;
    }
    if (searched?.ok || (searched?.step && searched.step !== "SEARCH_INPUT_NOT_FOUND")) break;
  }
  if (cleared()) {
    brandExportJobPending = false;
    pendingBrandExportName = "";
    pendingBrandExportJobId = "";
    return { ok: false, code: "BRAND_ATTEMPT_ABORTED", message: `${brandName} 작업 시간이 초과되어 다음 브랜드로 이동합니다.` };
  }
  if (!searched?.ok && searched?.step === "SEARCH_INPUT_NOT_FOUND") {
    searched = { ...searched, diagnostics: lastSearchDiagnostics };
  }
  if (!searched?.ok) {
    const diagnosticPath = await captureSellerDiagnostic(brandName, String(searched?.step || "search-failed").toLowerCase());
    pendingBrandExportName = "";
    pendingBrandExportJobId = "";
    brandExportJobPending = false;
    return {
      ok: false,
      code: searched?.code || searched?.step || "SELLER_AUTOMATION_FAILED",
      message: `${sellerBrandExportFailureMessage(searched?.code || searched?.step, brandName)}${diagnosticPath ? ` 진단 화면: ${diagnosticPath}` : ""}`,
      diagnostics: { ...(searched?.diagnostics || {}), path: diagnosticPath },
    };
  }

  // Keep the registration window on product search. Navigating it to the
  // download center removed the search input needed by the next queued brand.
  // The separate monitor identifies only the new job here; full refresh,
  // completion checks, and downloads start after the whole queue is drained.
  if (sellerWindow && !sellerWindow.isDestroyed()) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    sellerWindow.minimize();
    showCollectorWindow();
  }

  mainWindow?.webContents.send("brand-export:progress", {
    status: "seller-search-evidence",
    brandName,
    jobState: "2단계/5 · 전체 내보내기 완료 · 다음 브랜드 준비",
    message: `${brandName} · 입력값 ${searched.inputValue || "확인 불가"} · 현지 30일 내림차순 · 전체 내보내기 완료 · 상품검색 화면 유지`,
  });

  const completeness = {
    ok: true,
    expected: 0,
    pageCount: 0,
    confirmationObserved: false,
    confirmationClicked: false,
    requestAcknowledged: true,
  };

  mainWindow?.webContents.send("brand-export:progress", {
    status: "waiting-for-job-creation",
    brandName,
    jobState: "2단계/5 · 전체 내보내기 클릭 완료 · 새 작업번호 확인 중",
    message: `${brandName} · 전체 내보내기를 완료했습니다. 별도 확인 창에서 새 작업번호만 확인한 뒤 다음 브랜드로 이동합니다.`,
  });

  let createdJob = null;
  const verificationStartedAt = Date.now();
  const verificationTimeoutMs = 180000;
  let lastReloadAt = 0;
  let lastProgressAt = 0;
  let fallbackCandidateJobId = "";
  let fallbackCandidateStableReads = 0;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  while (Date.now() - verificationStartedAt < verificationTimeoutMs) {
    if (cleared()) break;
    const currentJobs = await Promise.race([
      readSellerExportJobsFromMonitor(),
      new Promise((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    if (Array.isArray(currentJobs)) {
      const unusedJobs = currentJobs.filter((job) => !brandExportJobOwner(job?.id));
      const candidate = findNewSellerExportJob([...baselineJobIds], unusedJobs);
      if (candidate && baselineAvailable) {
        createdJob = candidate;
      } else if (candidate) {
        const candidateId = String(candidate.id || "").trim();
        fallbackCandidateStableReads = candidateId === fallbackCandidateJobId
          ? fallbackCandidateStableReads + 1
          : 1;
        fallbackCandidateJobId = candidateId;
        if (fallbackCandidateStableReads >= 2) createdJob = candidate;
      } else {
        fallbackCandidateJobId = "";
        fallbackCandidateStableReads = 0;
      }
    }
    if (createdJob) break;

    const elapsedMs = Date.now() - verificationStartedAt;
    if (elapsedMs - lastProgressAt >= 10000) {
      lastProgressAt = elapsedMs;
      mainWindow?.webContents.send("brand-export:progress", {
        status: "waiting-for-job-creation",
        brandName,
        jobState: `2단계/5 · 다운로드센터 작업 생성 대기 · ${Math.floor(elapsedMs / 1000)}초`,
        message: `${brandName} · 전체 내보내기 요청 완료 · POIZON이 새 작업번호를 생성하는 중입니다. 화면을 반복 초기화하지 않고 기다립니다.`,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
    const monitor = ensureSellerMonitorWindow();
    if (elapsedMs >= 15000 && Date.now() - lastReloadAt >= 15000) {
      await monitor.webContents.reloadIgnoringCache();
      lastReloadAt = Date.now();
    }
  }
  if (cleared()) {
    pendingBrandExportName = "";
    pendingBrandExportJobId = "";
    brandExportJobPending = false;
    return { ok: false, code: "BRAND_ATTEMPT_ABORTED", message: `${brandName} 작업 시간이 초과되어 다음 브랜드로 이동합니다.` };
  }
  if (!createdJob) {
    pendingBrandExportName = "";
    pendingBrandExportJobId = "";
    brandExportJobPending = false;
    sellerWindow.hide();
    showCollectorWindow();
    return {
      ok: false,
      code: "EXPORT_JOB_NOT_CREATED",
      confirmationObserved: Boolean(completeness?.confirmationObserved),
      confirmationClicked: Boolean(completeness?.confirmationClicked),
      requestAcknowledged: Boolean(completeness?.requestAcknowledged),
      message: completeness?.confirmationObserved && !completeness?.confirmationClicked
        ? "POIZON 전체 내보내기 확인창을 완료하지 못했습니다. 확인창 처리 로직을 다시 점검해 주세요."
        : "실제 상품검색과 전체 내보내기 요청은 실행됐지만 3분 동안 새 미사용 작업번호를 확인하지 못했습니다. 다운로드센터 화면 구조 또는 로그인 세션을 확인해 주세요.",
    };
  }
  if (cleared()) return { ok: false, code: "WORK_CLEARED", message: "작업 기록 삭제로 이전 요청을 중단했습니다." };
  pendingBrandExportJobId = String(createdJob.id || "").trim();
  const registeredJobId = pendingBrandExportJobId;
  const existingOwner = brandExportJobOwner(registeredJobId);
  if (existingOwner) {
    pendingBrandExportName = "";
    pendingBrandExportJobId = "";
    brandExportJobPending = false;
    sellerWindow.hide();
    showCollectorWindow();
    return {
      ok: false,
      code: "EXPORT_JOB_ID_REUSED",
      message: `새 작업번호가 생성되지 않았습니다. 기존 작업번호 ${registeredJobId}는 ${existingOwner.brandName || "다른 브랜드"} 작업에 이미 연결되어 있습니다.`,
    };
  }
  brandExportJobs.set(registeredJobId, {
    jobId: registeredJobId,
    brandName,
    brandKo,
    createdAt: Date.now(),
    downloadStarted: false,
    expectedProductCount: Number(completeness.expected || searched.expectedTotal || 0),
  });
  await rememberBrandExportJob({
    jobId: registeredJobId,
    brandName,
    brandKo,
    createdAt: Date.now(),
    expectedProductCount: Number(completeness.expected || searched.expectedTotal || 0),
    sessionGeneration,
  });
  mainWindow?.webContents.send("brand-export:progress", {
    status: "job-created",
    brandName,
    jobId: registeredJobId,
    jobState: "작업번호 생성 확인 완료 · 전체 등록 대기",
    message: `${brandName} · 새 작업번호 ${registeredJobId} 생성 확인 완료 · 다음 브랜드로 이동`,
  });
  brandExportJobPending = false;
  pendingBrandExportName = "";
  pendingBrandExportJobId = "";
  sellerWindow.hide();
  mainWindow?.show();
  mainWindow?.focus();
  if (!input.deferMonitor) void watchAllSellerExportJobsEveryTenSeconds();
  return {
    ok: true,
    folder,
    jobId: registeredJobId,
    expectedProductCount: Number(completeness.expected || searched.expectedTotal || 0),
  };
}

async function syncBrandCatalogFromKrPoizon() {
  const window = new BrowserWindow({
    show: false,
    icon: APP_ICON_PATH,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: "persist:around-g-poizon-brands",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await window.loadURL(KR_POIZON_BRAND_LIST_URL);
    const source = await window.webContents.executeJavaScript(
      `document.querySelector("#__NEXT_DATA__")?.textContent || ""`,
      true
    );
    if (!source) throw new Error("KR_POIZON_BRAND_DATA_NOT_FOUND");
    const koreanBrands = parseKrPoizonBrandData(source);
    let englishBrands = [];
    try {
      await window.loadURL(EN_POIZON_BRAND_LIST_URL);
      const englishSource = await window.webContents.executeJavaScript(
        `document.querySelector("#__NEXT_DATA__")?.textContent || ""`,
        true
      );
      if (englishSource) englishBrands = parseKrPoizonBrandData(englishSource);
    } catch {
      // 한국 공식 목록만 완전하면 전체 브랜드 검색을 막지 않는다.
    }
    const brands = mergeLocalizedBrandCatalog(koreanBrands, englishBrands);
    if (!Array.isArray(brands) || brands.length < FULL_BRAND_CATALOG_MINIMUM) {
      throw new Error(`KR_POIZON_BRAND_COUNT_INVALID_${brands?.length || 0}`);
    }
    await store.setSettings({ brandCatalog: brands, brandCatalogUpdatedAt: new Date().toISOString() });
    const officialBrandRegistry = await ensureOfficialDomainRegistry(brands);
    return {
      ok: true,
      brands: brandsWithOfficialDomainStatus(brands, officialBrandRegistry),
      officialDomainSummary: officialDomainRegistrySummary(officialBrandRegistry),
      source: KR_POIZON_BRAND_LIST_URL,
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "KR_POIZON_BRAND_SYNC_FAILED",
        message: "기존 크롬 방식의 POIZON 한국 브랜드 목록을 읽지 못했습니다.",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function queryPublicBrandProducts(input) {
  const brandPath = publicBrandPath({
    productUrl: input?.brandUrl,
    name: input?.brandName,
  });
  if (!/^\/brand\/[a-z0-9][a-z0-9-]*$/i.test(brandPath)) {
    return { ok: false, error: { code: "POIZON_BRAND_URL_INVALID", message: "POIZON 영문 브랜드 주소를 찾지 못했습니다." } };
  }
  const window = new BrowserWindow({
    show: false,
    icon: APP_ICON_PATH,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: "persist:around-g-poizon-brands",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    const productsByKey = new Map();
    let pageCount = 1;
    let sourceTotal = 0;
    for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
      const pageUrl = new URL(brandPath, "https://kr.poizon.com");
      if (pageNum > 1) pageUrl.searchParams.set("page", String(pageNum));
      await window.loadURL(pageUrl.href);
      const source = await window.webContents.executeJavaScript(
        `document.querySelector("#__NEXT_DATA__")?.textContent || ""`,
        true
      );
      if (!source) throw new Error(`KR_POIZON_BRAND_PRODUCTS_NOT_FOUND_PAGE_${pageNum}`);
      const pageData = JSON.parse(source);
      const pageProducts = parsePublicBrandProducts(pageData, input.brandId);
      if (pageNum === 1) {
        sourceTotal = Math.max(0, Number(pageData?.props?.pageProps?.total || pageProducts.length));
        pageCount = publicBrandPageCount(sourceTotal, pageProducts.length, 100);
      }
      for (const product of pageProducts) {
        const key = `${product.articleNumber}:${product.globalSpuId || product.spuId || ""}`;
        productsByKey.set(key, product);
      }
      mainWindow?.webContents.send("explorer:brand-progress", {
        percent: Math.round((pageNum / pageCount) * 100),
        count: productsByKey.size,
        pageNum,
        pageCount,
      });
      if (!pageProducts.length) break;
    }
    if (!productsByKey.size) throw new Error("KR_POIZON_BRAND_PRODUCTS_EMPTY");
    const salesByArticle = input?.salesByArticle || {};
    let products = [...productsByKey.values()].map((product) => {
      const hasSalesData = Object.hasOwn(salesByArticle, product.articleNumber);
      return {
        ...product,
        brandName: String(input.brandName || ""),
        hasSalesData,
        sales30d: hasSalesData ? Number(salesByArticle[product.articleNumber] || 0) : 0,
      };
    });
    const salesDataCount = products.filter((product) => product.hasSalesData).length;
    if (input?.minimumSales30) {
      products = products.filter((product) => product.hasSalesData && product.sales30d >= 30);
    }
    return {
      ok: true,
      products,
      total: products.length,
      sourceTotal,
      pages: pageCount,
      pageNum: pageCount,
      salesFilterAvailable: salesDataCount > 0,
      salesDataCount,
      sourceCount: pageCount,
      failedSourceCount: 0,
      publicSource: true,
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "KR_POIZON_BRAND_PRODUCTS_FAILED",
        message: "POIZON 공개 브랜드 상품을 읽지 못했습니다.",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function captureSellerCenterProducts() {
  const revealSellerLogin = () => {
    if (!sellerWindow || sellerWindow.isDestroyed()) return;
    if (sellerWindow.isMinimized()) sellerWindow.restore();
    sellerWindow.show();
    sellerWindow.focus();
    mainWindow?.webContents.send("seller:capture-progress", {
      attentionRequired: true,
      message: "POIZON 로그인 또는 보안 확인이 필요해 판매자센터 창을 표시했습니다.",
    });
  };
  if (!sellerWindow || sellerWindow.isDestroyed()) {
    mainWindow?.webContents.send("seller:capture-progress", { percent: 2, count: 0, message: "판매자센터를 여는 중" });
    openSellerCenterWindow(SELLER_CENTER_URL, { visible: false });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(500);
      if (sellerWindow && !sellerWindow.isDestroyed() && sellerWindow.webContents.getURL()) break;
    }
    if (!sellerWindow || sellerWindow.isDestroyed()) {
      return { ok: false, message: "판매자센터 창을 열지 못했습니다." };
    }
  }
  if (sellerWindow && !sellerWindow.isDestroyed()) {
    minimizeSellerAutomationWindow("POIZON 로그인 세션을 백그라운드에서 확인 중입니다.");
  }
  mainWindow?.webContents.send("seller:capture-progress", { percent: 5, count: 0, message: "로그인 세션 확인 중" });
  let currentUrl = sellerWindow.webContents.getURL();
  for (let attempt = 0; attempt < 20 && !currentUrl; attempt += 1) {
    await wait(500);
    currentUrl = sellerWindow.webContents.getURL();
  }
  if (!currentUrl.startsWith("https://seller.poizon.com/")) {
    revealSellerLogin();
    return { ok: false, message: "판매자센터 인기상품 화면으로 이동해 주세요." };
  }
  if (!currentUrl.includes("/main/dataCenter/merchantRankBoard")) {
    await sellerWindow.loadURL(SELLER_CENTER_URL);
    await wait(1_800);
    currentUrl = sellerWindow.webContents.getURL();
    if (!currentUrl.includes("/main/dataCenter/merchantRankBoard")) {
      revealSellerLogin();
      return { ok: false, message: "판매자센터 로그인을 완료해 주세요. 로그인 세션은 다음 실행부터 자동으로 유지됩니다." };
    }
  }
  sellerWindow.maximize();
  minimizeSellerAutomationWindow("POIZON 인기상품 조건을 백그라운드에서 적용 중입니다.");
  await wait(700);
  const networkProducts = [];
  let debuggerListener;
  let debuggerAttachedHere = false;
  try {
    if (!sellerWindow.webContents.debugger.isAttached()) {
      sellerWindow.webContents.debugger.attach("1.3");
      debuggerAttachedHere = true;
    }
    await sellerWindow.webContents.debugger.sendCommand("Network.enable");
    debuggerListener = async (_event, method, params) => {
      if (method !== "Network.responseReceived" || !["XHR", "Fetch"].includes(params?.type)) return;
      if (!String(params?.response?.url || "").includes("seller.poizon.com")) return;
      try {
        const body = await sellerWindow.webContents.debugger.sendCommand("Network.getResponseBody", {
          requestId: params.requestId,
        });
        const parsed = JSON.parse(body.base64Encoded
          ? Buffer.from(body.body, "base64").toString("utf8")
          : body.body);
        networkProducts.push(...extractSellerApiProducts(parsed, 200));
      } catch {
        // JSON이 아닌 응답이나 보안 응답은 화면 안정화 수집으로 처리합니다.
      }
    };
    sellerWindow.webContents.debugger.on("message", debuggerListener);
  } catch {
    debuggerAttachedHere = false;
  }
  const stopNetworkCapture = () => {
    if (debuggerListener) sellerWindow?.webContents.debugger.removeListener("message", debuggerListener);
    if (debuggerAttachedHere && sellerWindow && !sellerWindow.isDestroyed() && sellerWindow.webContents.debugger.isAttached()) {
      try { sellerWindow.webContents.debugger.detach(); } catch {}
    }
  };
  let conditionResults = [];
  let failedConditions = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    mainWindow?.webContents.send("seller:capture-progress", {
      percent: 5 + attempt,
      count: 0,
      message: `인기상품 조건 적용 중 (${attempt}/3)`,
    });
    conditionResults = await applySellerPopularConditions();
    failedConditions = conditionResults.filter((condition) => (
      !condition.found
      || (condition.action === "select" && !condition.verifiedSelected)
      || (condition.action === "fullscreen" && !condition.expanded)
    ));
    if (!failedConditions.length) break;
    await wait(1_500 * attempt);
  }
  if (failedConditions.length) {
    stopNetworkCapture();
    return {
      ok: false,
      message: `인기상품 조건 확인 실패: ${failedConditions.map((condition) => condition.label).join(", ")}. 잘못된 데이터는 저장하지 않았습니다.`,
      conditions: conditionResults,
    };
  }
  mainWindow?.webContents.send("seller:capture-progress", {
    percent: 12,
    count: 0,
    message: "일주일 전 · 주간 대비 · 판매 인기 높은 순 · SPU · 인기상품 전체화면 확인 완료",
  });
  const fullscreenCondition = conditionResults.find((condition) => condition.key === "fullscreen");
  if (!fullscreenCondition?.found) {
    stopNetworkCapture();
    return {
      ok: false,
      message: `인기상품 전체화면 버튼을 누르지 못했습니다. 잘못된 9개 목록은 저장하지 않습니다.${fullscreenCondition?.x !== undefined ? ` 클릭 좌표 (${fullscreenCondition.x}, ${fullscreenCondition.y}), 대상 ${fullscreenCondition.targetTag || "없음"}` : ""}`,
      conditions: conditionResults,
    };
  }
  const frames = [sellerWindow.webContents.mainFrame, ...(sellerWindow.webContents.mainFrame.framesInSubtree || [])]
    .filter((frame, index, all) => all.findIndex((candidate) => candidate.routingId === frame.routingId) === index);
  const captures = [];
  const limit = 200;
  const capturedNodes = new Map();
  const rankSlots = new Map();
  const stableObservations = new Map();
  const addConfirmedProduct = (product) => {
    const rank = Number(product.rank || 0);
    const articleNumber = String(product.articleNumber || "").toUpperCase();
    const name = String(product.name || "").trim();
    if (rank < 1 || rank > limit || (!articleNumber && !name)) return;
    const merged = mergeSellerProductsByRank([[rankSlots.get(rank)], [{ ...product, articleNumber, name }]], limit)[0];
    if (merged) rankSlots.set(rank, merged);
  };
  const addNodesToSlots = (nodes) => {
    for (const product of parseSellerDomNodes(nodes, limit)) {
      const rank = Number(product.rank || 0);
      const articleNumber = String(product.articleNumber || "").toUpperCase();
      if (!product.rankDetected || rank < 1 || rank > limit || !articleNumber) continue;
      const signature = JSON.stringify([
        articleNumber,
        product.name,
        Number(product.averagePrice || 0),
        Number(product.lowestPrice || 0),
        Number(product.highestPrice || 0),
      ]);
      const previous = stableObservations.get(rank);
      const observation = previous?.signature === signature
        ? { signature, count: previous.count + 1, product }
        : { signature, count: 1, product };
      stableObservations.set(rank, observation);
      // A detected rank is pasted directly into the matching 1-200 slot.
      // Later observations may verify it, but a single valid row is never
      // discarded merely because virtualization removed it from the screen.
      addConfirmedProduct(product);
    }
  };
  const validProductCount = () => rankSlots.size;
  const captureFrameWithTimeout = async (frame, timeoutMs = 2_500) => Promise.race([
    frame.executeJavaScript(SELLER_CAPTURE_SCRIPT, true),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("seller frame capture timeout")),
      timeoutMs,
    )),
  ]);
  const captureVisibleSlots = async () => {
    for (const frame of frames) {
      try {
        const captured = await captureFrameWithTimeout(frame);
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
  };
  minimizeSellerAutomationWindow("POIZON 인기상품 200건을 백그라운드에서 수집 중입니다.");
  for (let pass = 0; pass < 3 && rankSlots.size < limit; pass += 1) {
    await dragSellerScrollbarToRatio(0);
    await wait(900);
    let atEnd = false;
    let iteration = 0;
    while (!atEnd && iteration < 2_000 && rankSlots.size < limit) {
      iteration += 1;
      await captureVisibleSlots();
      await wait(180);
      const scrollResult = await executeAcrossSellerFrames(SELLER_ROW_SCROLL_SCRIPT);
      if (!scrollResult?.found) break;
      atEnd = Boolean(scrollResult.atEnd);
      const tableRatio = scrollResult.maximum > 0
        ? Math.min(1, scrollResult.after / scrollResult.maximum)
        : 1;
      const basePercent = pass === 0 ? 12 : 86 + ((pass - 1) * 6);
      const passRange = pass === 0 ? 74 : 6;
      mainWindow?.webContents.send("seller:capture-progress", {
        percent: Math.min(99, Math.round(basePercent + tableRatio * passRange)),
        count: rankSlots.size,
        target: limit,
        missing: limit - rankSlots.size,
        message: pass === 0
          ? `1~${limit}위 슬롯을 한 행씩 확인 중 · 표 위치 ${Math.round(tableRatio * 100)}%`
          : `누락 슬롯 재확인 ${pass}/2 · 표 위치 ${Math.round(tableRatio * 100)}%`,
      });
      await wait(220);
    }
    await captureVisibleSlots();
  }
  if (!captures.length) {
    stopNetworkCapture();
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
  products = mergeSellerProductsByRank([
    products,
    nodeProducts,
    slotProducts,
    networkProducts,
  ], limit);
  const validProducts = products.filter((product) => {
    const articleNumber = String(product.articleNumber || "").trim();
    const name = String(product.name || "").trim();
    const hasRealArticle = !articleNumber
      || /^[A-Z0-9][A-Z0-9._/-]{2,39}(?:\s+[A-Z0-9][A-Z0-9._/-]{0,19}){0,3}$/i.test(articleNumber);
    const isHeader = /^(?:SPU 기준|SKU 기준|SPU 기준 SKU 기준|상품정보|평균 거래가(?:\\(KRW\\))?)$/i.test(name);
    return hasRealArticle && !isHeader && Boolean(articleNumber || name);
  });
  if (!validProducts.length) {
    stopNetworkCapture();
    const frameSummary = captures.map((capture) => `${capture.title || "frame"}:${capture.text.length}`).join(", ");
    return {
      ok: false,
      message: `인기상품 표는 확인했지만 실제 품번과 가격이 있는 상품 행을 찾지 못했습니다. 표의 1위 상품 행이 보이도록 스크롤한 뒤 다시 눌러 주세요.${frameSummary ? ` (확인한 화면 ${captures.length}개)` : ""}`,
    };
  }
  const preservedSlots = new Map();
  for (const product of validProducts.sort((left, right) => Number(left.rank) - Number(right.rank))) {
    const rank = Number(product.rank || 0);
    const articleNumber = String(product.articleNumber || "").toUpperCase();
    if (rank < 1 || rank > limit || preservedSlots.has(rank)) continue;
    preservedSlots.set(rank, { ...product, articleNumber });
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
  stopNetworkCapture();
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

async function captureSellerBrandSales(input = {}) {
  if (!sellerWindow || sellerWindow.isDestroyed()) {
    openSellerCenterWindow();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(500);
      if (sellerWindow && !sellerWindow.isDestroyed() && sellerWindow.webContents.getURL()) break;
    }
  }
  if (!sellerWindow || sellerWindow.isDestroyed()) {
    return { ok: false, message: "판매자센터 창을 열지 못했습니다." };
  }
  await sellerWindow.loadURL(SELLER_PRODUCT_SEARCH_URL);
  await wait(1_800);
  if (!sellerWindow.webContents.getURL().includes("/main/goods/search")) {
    return { ok: false, message: "판매자센터 로그인을 확인해 주세요." };
  }
  const networkSellerProducts = [];
  const pendingBrandResponses = new Set();
  let brandDebuggerListener;
  let brandDebuggerAttachedHere = false;
  const stopBrandNetworkCapture = () => {
    try {
      if (brandDebuggerListener) {
        sellerWindow?.webContents.debugger.removeListener("message", brandDebuggerListener);
      }
      if (brandDebuggerAttachedHere && sellerWindow?.webContents.debugger.isAttached()) {
        sellerWindow.webContents.debugger.detach();
      }
    } catch {}
  };
  try {
    const sellerDebugger = sellerWindow.webContents.debugger;
    if (!sellerDebugger.isAttached()) {
      sellerDebugger.attach("1.3");
      brandDebuggerAttachedHere = true;
    }
    await sellerDebugger.sendCommand("Network.enable");
    brandDebuggerListener = async (_event, method, params) => {
      if (method === "Network.responseReceived") {
        const response = params?.response || {};
        if (!["XHR", "Fetch"].includes(params?.type)) return;
        // Seller Center serves product metrics through several gateway hosts.
        // This debugger is attached only to the dedicated Seller Center window,
        // so inspect every XHR/Fetch response instead of assuming *.poizon.com.
        pendingBrandResponses.add(params.requestId);
        return;
      }
      if (method !== "Network.loadingFinished" || !pendingBrandResponses.has(params?.requestId)) return;
      pendingBrandResponses.delete(params.requestId);
      try {
        const payload = await sellerDebugger.sendCommand("Network.getResponseBody", {
          requestId: params.requestId,
        });
        const text = payload?.base64Encoded
          ? Buffer.from(payload.body || "", "base64").toString("utf8")
          : String(payload?.body || "");
        if (!/^\s*[\[{]/.test(text)) return;
        networkSellerProducts.push(...extractSellerBrandApiProducts(JSON.parse(text)));
      } catch {}
    };
    sellerDebugger.on("message", brandDebuggerListener);
  } catch {}
  // Seller Center keeps brand names in their original English form. Searching
  // a translated Korean label first can leave the unfiltered 9,900-row table.
  const brandNames = [input.brandName, input.brandKo].map((value) => String(value || "").trim()).filter(Boolean);
  const selected = await sellerWindow.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getClientRects().length > 0;
    const searchInput = [...document.querySelectorAll("input")].find((element) =>
      visible(element) && /상품명\\/상품번호\\/브랜드\\/카테고리\\/시리즈/.test(element.placeholder || "")
    );
    if (searchInput?.value) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(searchInput, "");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const globalReset = [...document.querySelectorAll("button,[role=button]")].find((button) =>
      visible(button) && button.textContent.trim() === "초기화"
    );
    if (globalReset) {
      globalReset.click();
      await wait(800);
    }
    // 판매자센터 실제 상품 검색 화면과 동일한 기본 경로:
    // 상단 상품정보 입력란에 선택 브랜드를 입력하고 "검색 및 입찰"을 실행한다.
    const preferredNames = ${JSON.stringify(brandNames)};
    // 상단 통합검색은 React 상태가 반영되지 않아 전체 9,900건이 그대로
    // 남는 경우가 있다. 정확한 브랜드 드롭다운 필터를 먼저 적용하고,
    // 드롭다운을 찾지 못했을 때만 상단 검색을 보조 경로로 사용한다.
    const ownText = (element) => [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim();
    const brandLabel = [...document.querySelectorAll("button,[role=button],label,span,div")]
      .filter((element) => visible(element) && (ownText(element) === "브랜드" || element.textContent.trim() === "브랜드"))
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    const brandButton = brandLabel?.closest("button,[role=button],.ant-select,.ant-dropdown-trigger,.semi-select,.semi-dropdown-trigger")
      || brandLabel;
    const names = ${JSON.stringify(brandNames)};
    const searchFromTop = async () => {
      const topSearchButton = [...document.querySelectorAll("button,[role=button]")]
        .filter(visible)
        .find((button) => /검색\s*및\s*입찰|검색/.test(button.textContent.trim()));
      const topSearchInput = [...document.querySelectorAll("input")]
        .filter((element) => visible(element) && ["text", "search", ""].includes(element.type))
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      if (!topSearchInput || !topSearchButton || !names[0]) return null;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(topSearchInput, names[0]);
      topSearchInput.dispatchEvent(new Event("input", { bubbles: true }));
      topSearchInput.dispatchEvent(new Event("change", { bubbles: true }));
      topSearchButton.click();
      await wait(1_500);
      return { ok: true, selected: names[0], route: "TOP_PRODUCT_SEARCH" };
    };
    if (!brandButton) {
      return await searchFromTop() || { ok: false, reason: "BRAND_BUTTON_AND_TOP_SEARCH_NOT_FOUND" };
    }
    brandButton.click();
    await wait(500);
    const popup = [...document.querySelectorAll('[role="tooltip"],[role="dialog"],.ant-popover,.ant-dropdown,.ant-select-dropdown,.semi-portal,.semi-popover,.semi-select-dropdown')]
      .filter(visible).at(-1) || document.body;
    if (!popup) return { ok: false, reason: "BRAND_POPUP_NOT_FOUND" };
    const reset = [...popup.querySelectorAll("button,[role=button]")].find((button) =>
      visible(button) && button.textContent.trim() === "초기화"
    );
    if (reset) {
      reset.click();
      await wait(350);
    }
    const input = [...popup.querySelectorAll("input")].find((element) =>
      visible(element) && ["text", "search", ""].includes(element.type)
    );
    for (const name of names) {
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, name);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(250);
      }
      const expected = names.map((value) => value.toLowerCase());
      let option;
      for (let attempt = 0; attempt < 20 && !option; attempt += 1) {
        await wait(250);
        const candidates = [...document.querySelectorAll(
          '.ant-popover:not(.ant-popover-hidden) li.ant-list-item,[role=option],.ant-select-item-option,.semi-select-option'
        )].filter(visible);
        option = candidates.find((element) => {
          const text = element.textContent.trim().toLowerCase();
          return expected.some((value) => text === value || text.startsWith(value + " ") || text.includes(value));
        });
      }
      if (option) {
        option.click();
        await wait(250);
        const confirm = [...document.querySelectorAll("button,[role=button]")].find((button) =>
          visible(button) && /^(확인|적용|검색)$/.test(button.textContent.trim())
        );
        if (confirm) confirm.click();
        await wait(1_200);
        return { ok: true, selected: option.textContent.trim(), route: "EXACT_BRAND_FILTER" };
      }
    }
    // 판매자센터가 브랜드 팝업 구조를 변경한 경우 상단 통합 검색창으로 전환한다.
    // 상품정보 검색은 브랜드명도 지원하며 이 경로가 화면 개편의 영향을 덜 받는다.
    return await searchFromTop() || { ok: false, reason: "BRAND_OPTION_AND_TOP_SEARCH_NOT_FOUND" };
  })()`, true);
  if (!selected?.ok) {
    stopBrandNetworkCapture();
    return { ok: false, message: `판매자센터 브랜드 필터를 적용하지 못했습니다. (${selected?.reason || "UNKNOWN"})` };
  }
  mainWindow?.show();
  mainWindow?.focus();
  sellerWindow.hide();
  // 검색 버튼 클릭 직후에는 기존 표가 잠시 남아 있다. 상품 번호가 있는
  // 새 결과 표와 통계 열이 실제로 렌더링될 때까지 기다린 뒤 수집한다.
  await sellerWindow.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const headers = [...document.querySelectorAll("table thead th")]
        .map((cell) => String(cell.innerText || "").replace(/\\s+/g, " ").trim());
      const rows = [...document.querySelectorAll("table tbody tr")]
        .map((row) => String(row.innerText || ""));
      if (
        rows.some((text) => /상품\\s*번호\\s*[:：]/.test(text))
        && headers.some((text) => /최근\\s*30일\\s*판매량/.test(text))
      ) return true;
      await wait(250);
    }
    return false;
  })()`, true);
  await sellerWindow.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getClientRects().length > 0;
    const current = [...document.querySelectorAll(".ant-select-selection-item")].find((element) =>
      visible(element) && /건\\/페이지/.test(element.textContent)
    );
    if (!current || /20\\s*건\\/페이지/.test(current.textContent)) return;
    current.closest(".ant-select")?.querySelector(".ant-select-selector")?.click();
    await wait(250);
    const option = [...document.querySelectorAll('[role="option"],.ant-select-item-option')]
      .find((element) => visible(element) && /20\\s*건\\/페이지/.test(element.textContent));
    option?.click();
    await wait(900);
  })()`, true);
  // The legacy selector above requested 20 rows. Immediately switch the
  // pagination control to the largest option exposed by Seller Center so a
  // 9,900-row brand does not require roughly 495 page transitions.
  await sellerWindow.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getClientRects().length > 0;
    const sizeChanger = [...document.querySelectorAll(".ant-pagination-options-size-changer,.ant-pagination-options")]
      .find(visible);
    const selector = sizeChanger?.querySelector(".ant-select-selector");
    if (!selector) return false;
    selector.click();
    await wait(250);
    const options = [...document.querySelectorAll('[role="option"],.ant-select-item-option')]
      .filter(visible)
      .map((element) => ({ element, size: Number(String(element.textContent || "").match(/\\d+/)?.[0] || 0) }))
      .filter((entry) => entry.size > 0)
      .sort((left, right) => right.size - left.size);
    if (!options[0]) return false;
    options[0].element.click();
    await wait(1_000);
    return true;
  })()`, true);
  const pages = [];
  let sellerSourceTotal = 0;
  let capturedRowCount = 0;
  let pageTransitionFailure = null;
  for (let page = 1; page <= 1_000; page += 1) {
    const capture = await sellerWindow.webContents.executeJavaScript(`(() => {
      const visible = (element) => element && element.getClientRects().length > 0;
      const headers = [...document.querySelectorAll("table thead th")]
        .filter(visible)
        .map((cell) => String(cell.innerText || "").replace(/\\s+/g, " ").trim());
      const rowElements = [...document.querySelectorAll("table tbody tr")].filter(visible);
      const rows = rowElements.map((row) => ({
        text: row.innerText || "",
        cells: [...row.querySelectorAll("td")].map((cell) => cell.innerText || ""),
        headers,
        imageUrl: row.querySelector("img")?.src || ""
      })).filter((row) => /상품\\s*번호\\s*[:：]/.test(row.text));
      const next = [...document.querySelectorAll(".ant-pagination-next")].find(visible);
      const activePage = [...document.querySelectorAll(".ant-pagination-item-active")]
        .find(visible);
      const totalMatch = String(document.body?.innerText || "").match(/총\\s*([\\d,]+)\\s*건\\s*결과/);
      const totalCount = Number(String(totalMatch?.[1] || "0").replace(/,/g, ""));
      const currentPage = Number(activePage?.textContent.trim()) || ${page};
      const visiblePageNumbers = [...document.querySelectorAll(".ant-pagination-item")]
        .filter(visible)
        .map((item) => Number(item.textContent.trim()))
        .filter(Number.isFinite);
      const pageSizeText = [...document.querySelectorAll(".ant-select-selection-item")]
        .find((element) => visible(element) && /건\\/페이지/.test(element.textContent))?.textContent || "";
      const pageSize = Number(pageSizeText.match(/(\\d+)\\s*건\\/페이지/)?.[1]) || rows.length || 10;
      const pageCount = totalCount > 0
        ? Math.ceil(totalCount / pageSize)
        : Math.max(currentPage, ...visiblePageNumbers, 1);
      return {
        rows,
        hasNext: Boolean(next && !next.classList.contains("ant-pagination-disabled") && currentPage < pageCount),
        first: rows[0]?.text || "",
        currentPage,
        pageCount,
        totalCount
      };
    })()`, true);
    pages.push(capture.rows || []);
    capturedRowCount += Number(capture.rows?.length || 0);
    sellerSourceTotal = Math.max(sellerSourceTotal, Number(capture.totalCount || 0));
    if (
      page === 1
      && selected.route !== "EXACT_BRAND_FILTER"
      && Number(capture.totalCount || 0) >= 9_000
    ) {
      stopBrandNetworkCapture();
      return {
        ok: false,
        message: "선택 브랜드 필터가 적용되지 않아 판매자센터 전체 결과가 표시되었습니다. 전체 수집은 중단했습니다.",
        code: "SELLER_BRAND_FILTER_NOT_APPLIED",
      };
    }
    const products = mergeSellerBrandPages(pages);
    mainWindow?.webContents.send("explorer:brand-progress", {
      percent: capture.hasNext
        ? Math.min(99, 70 + Math.round((capture.currentPage / Math.max(capture.currentPage, capture.pageCount || capture.currentPage)) * 29))
        : 99,
      count: products.length,
      pageNum: capture.currentPage,
      pageCount: capture.pageCount,
      message: `판매자센터 현지 30일 판매량 수집 ${capture.currentPage}/${capture.pageCount}페이지`,
    });
    if (!capture.hasNext) break;
    const expectedNextPage = capture.currentPage + 1;
    let advanced = false;
    for (let clickAttempt = 0; clickAttempt < 3 && !advanced; clickAttempt += 1) {
      const clicked = await sellerWindow.webContents.executeJavaScript(`(() => {
        const visible = (element) => element && element.getClientRects().length > 0;
        const expected = ${expectedNextPage};
        const directPage = [...document.querySelectorAll(".ant-pagination-item")]
          .find((item) => visible(item) && Number(item.textContent.trim()) === expected);
        const next = [...document.querySelectorAll(".ant-pagination-next:not(.ant-pagination-disabled)")]
          .find(visible);
        const target = directPage || next;
        const button = target?.querySelector("button,a") || target;
        if (!button) return false;
        button.click();
        return true;
      })()`, true);
      if (!clicked) continue;
      for (let attempt = 0; attempt < 32; attempt += 1) {
        await wait(250);
        const activePage = await sellerWindow.webContents.executeJavaScript(
          `(() => {
            const visible = (element) => element && element.getClientRects().length > 0;
            const active = [...document.querySelectorAll(".ant-pagination-item-active")].find(visible);
            return Number(active?.textContent.trim()) || 0;
          })()`,
          true,
        );
        if (activePage === expectedNextPage) {
          // Wait for the table body to finish replacing the previous page.
          await wait(450);
          advanced = true;
          break;
        }
      }
    }
    if (!advanced) {
      // One final direct-page attempt handles pagination controls that only
      // expose the requested page after the next-arrow updates the range.
      advanced = await sellerWindow.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const visible = (element) => element && element.getClientRects().length > 0;
        const expected = ${expectedNextPage};
        const item = [...document.querySelectorAll(".ant-pagination-item")]
          .find((element) => visible(element) && Number(element.textContent.trim()) === expected);
        const button = item?.querySelector("button,a") || item;
        if (!button) return false;
        button.click();
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await wait(250);
          const active = [...document.querySelectorAll(".ant-pagination-item-active")].find(visible);
          if (Number(active?.textContent.trim()) === expected) return true;
        }
        return false;
      })()`, true);
    }
    if (!advanced) {
      pageTransitionFailure = { page: capture.currentPage, expectedNextPage };
      break;
    }
  }
  const expectedBrands = new Set(
    [selected.selected, input.brandKo, input.brandName]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const domProducts = mergeSellerBrandPages(pages);
  const allProducts = mergeSellerBrandProducts(domProducts, networkSellerProducts);
  const matchedProducts = allProducts.filter((product) => {
    const rowBrand = String(product.brandName || "").trim().toLowerCase();
    if (!rowBrand) return true;
    return [...expectedBrands].some((expected) =>
      rowBrand === expected || rowBrand.includes(expected) || expected.includes(rowBrand)
    );
  });
  // 판매자센터의 브랜드 표기가 영문/한글/법인명으로 달라 일치하지 않더라도
  // 이미 브랜드 검색으로 얻은 원본 행은 삭제하지 않는다.
  const products = matchedProducts.length ? matchedProducts : allProducts;
  const diagnostics = sellerBrandDiagnostics(pages);
  stopBrandNetworkCapture();
  return {
    ok: true,
    products,
    total: products.length,
    sourceTotal: sellerSourceTotal || products.length,
    capturedRowCount,
    missingCount: Math.max(0, (sellerSourceTotal || products.length) - products.length),
    selectedBrand: selected.selected,
    diagnostics: {
      ...diagnostics,
      domProductCount: domProducts.length,
      networkProductCount: mergeSellerBrandProducts(networkSellerProducts).length,
      mergedProductCount: allProducts.length,
    },
    pageTransitionFailure,
  };
}

async function lookupSellerTransactionPrice(input = {}) {
  const articleNumber = String(input.articleNumber || "").trim();
  if (!articleNumber) return { ok: false, code: "ARTICLE_REQUIRED", message: "상품번호가 없습니다." };
  if (!sellerWindow || sellerWindow.isDestroyed()) openSellerCenterWindow(SELLER_PRODUCT_SEARCH_URL);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (sellerWindow && !sellerWindow.isDestroyed() && sellerWindow.webContents.getURL()) break;
    await wait(300);
  }
  if (!sellerWindow || sellerWindow.isDestroyed()) {
    return { ok: false, code: "SELLER_WINDOW_UNAVAILABLE", message: "판매자센터 창을 열지 못했습니다." };
  }
  if (!sellerWindow.webContents.getURL().includes("/main/goods/search")) {
    await sellerWindow.loadURL(SELLER_PRODUCT_SEARCH_URL);
    await wait(1_500);
  }
  if (!sellerWindow.webContents.getURL().includes("/main/goods/search")) {
    return { ok: false, code: "SELLER_LOGIN_REQUIRED", message: "판매자센터 로그인을 확인해 주세요." };
  }
  sellerWindow.showInactive();
  let productFrame = null;
  for (let attempt = 0; attempt < 40 && !productFrame; attempt += 1) {
    const frames = sellerWindowFrames();
    const probes = await Promise.all(frames.map(async (frame) => ({
      frame,
      matched: await executeSellerFrameWithTimeout(frame, `(() => {
        const visible = (element) => element && element.getClientRects().length > 0;
        const inputs = [...document.querySelectorAll("input")].filter(visible);
        const buttons = [...document.querySelectorAll("button,[role=button]")].filter(visible);
        return inputs.some((element) => /상품명|상품번호|브랜드|카테고리|시리즈/.test(element.placeholder || ""))
          && buttons.some((element) => /검색\\s*및\\s*입찰|^검색$/.test(element.textContent.trim()));
      })()`, 2_000, false),
    })));
    productFrame = probes.find((candidate) => candidate.matched)?.frame || null;
    if (!productFrame) await wait(250);
  }
  if (!productFrame) {
    showCollectorWindow();
    return { ok: false, code: "SEARCH_CONTROL_NOT_FOUND", message: `${articleNumber} 상품검색 내부 화면을 찾지 못했습니다.` };
  }
  sellerProductFrameRoutingId = productFrame.routingId;
  await productFrame.executeJavaScript(String.raw`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getClientRects().length > 0;
    const back = [...document.querySelectorAll("button,a,[role=button],span")].filter((element) =>
      visible(element) && element.getBoundingClientRect().left > innerWidth * 0.55
    ).find((element) => /뒤로가기/.test(element.textContent.trim()));
    const close = [...document.querySelectorAll("button,[role=button]")].filter((element) =>
      visible(element) && element.getBoundingClientRect().left > innerWidth * 0.55
    )
      .find((element) => /닫기|close/i.test((element.getAttribute("aria-label") || "") + " " + (element.title || "")));
    const target = back?.closest("button,a,[role=button]") || back || close;
    if (!target) return false;
    target.click();
    await wait(500);
    return true;
  })()`, true).catch(() => false);
  const transactionNetworkResponses = [];
  const pendingTransactionRequests = new Set();
  const transactionBodyTasks = new Set();
  let transactionCaptureActive = true;
  let transactionDebuggerListener;
  let transactionDebuggerAttachedHere = false;
  const stopTransactionNetworkCapture = async () => {
    transactionCaptureActive = false;
    await Promise.allSettled([...transactionBodyTasks]);
    try {
      if (transactionDebuggerListener) sellerWindow?.webContents.debugger.removeListener("message", transactionDebuggerListener);
      if (transactionDebuggerAttachedHere && sellerWindow && !sellerWindow.isDestroyed() && sellerWindow.webContents.debugger.isAttached()) {
        sellerWindow.webContents.debugger.detach();
      }
    } catch {}
  };
  try {
    const sellerDebugger = sellerWindow.webContents.debugger;
    if (!sellerDebugger.isAttached()) {
      sellerDebugger.attach("1.3");
      transactionDebuggerAttachedHere = true;
    }
    await sellerDebugger.sendCommand("Network.enable");
    transactionDebuggerListener = (_event, method, params) => {
      if (method === "Network.responseReceived" && transactionCaptureActive && ["XHR", "Fetch"].includes(params?.type)) {
        pendingTransactionRequests.add(params.requestId);
        return;
      }
      if (method !== "Network.loadingFinished" || !pendingTransactionRequests.has(params?.requestId)) return;
      pendingTransactionRequests.delete(params.requestId);
      const task = sellerDebugger.sendCommand("Network.getResponseBody", { requestId: params.requestId })
        .then((payload) => {
          const body = payload?.base64Encoded
            ? Buffer.from(payload.body || "", "base64").toString("utf8")
            : String(payload?.body || "");
          if (/^\s*[\[{]/.test(body) && body.length <= 5_000_000) transactionNetworkResponses.push({ body });
        }).catch(() => {});
      transactionBodyTasks.add(task);
      task.finally(() => transactionBodyTasks.delete(task));
    };
    sellerDebugger.on("message", transactionDebuggerListener);
  } catch {}
  await productFrame.executeJavaScript(String.raw`(() => {
    const storageKey = "__aroundGOptionResponses";
    window[storageKey] = [];
    const record = (url, body) => {
      const text = String(body || "");
      if (!text || text.length > 3_000_000) return;
      if (!/price|sales|sold|volume|size|sku|option|价格|售价|销量|尺码|판매량|가격/i.test(text)) return;
      window[storageKey].push({ url: String(url || ""), body: text, time: Date.now() });
      if (window[storageKey].length > 80) window[storageKey].splice(0, window[storageKey].length - 80);
    };
    if (!window.__aroundGFetchHooked && typeof window.fetch === "function") {
      window.__aroundGFetchHooked = true;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        response.clone().text().then((body) => record(response.url || args[0], body)).catch(() => {});
        return response;
      };
    }
    if (!window.__aroundGXhrHooked && window.XMLHttpRequest) {
      window.__aroundGXhrHooked = true;
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__aroundGUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener("load", () => {
          try { if (!this.responseType || this.responseType === "text") record(this.responseURL || this.__aroundGUrl, this.responseText); } catch {}
        }, { once: true });
        return originalSend.apply(this, args);
      };
    }
    return true;
  })()`, true).catch(() => false);
  const searched = await productFrame.executeJavaScript(String.raw`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getClientRects().length > 0;
    const article = ${JSON.stringify(articleNumber)};
    const normalize = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const inputs = [...document.querySelectorAll("input")].filter(visible);
    const input = inputs.find((element) => /상품명|상품번호|브랜드|카테고리|시리즈/.test(element.placeholder || ""))
      || inputs.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    const button = [...document.querySelectorAll("button,[role=button]")].filter(visible)
      .find((element) => /검색\s*및\s*입찰|^검색$/.test(element.textContent.trim()));
    if (!input || !button) return { ok: false, code: "SEARCH_CONTROL_NOT_FOUND" };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, article);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    button.click();
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await wait(250);
      // POIZON renders search results as virtual div rows, not only table rows.
      // Locate the smallest visible result container that contains both the
      // exact article number and the row's "상품 데이터" action.
      const normalizedArticle = normalize(article);
      const candidates = [...document.querySelectorAll("tr,[role=row],li,div,section,article")]
        .filter((element) => {
          if (!visible(element)) return false;
          const value = normalize(element.innerText);
          if (!value.includes(normalizedArticle)) return false;
          return [...element.querySelectorAll("a,button,[role=button],span,div")]
            .some((item) => visible(item) && /상품\s*데이터/.test(item.textContent.trim()));
        })
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
        });
      let row = candidates[0];
      // Network search can finish before the virtual list exposes a stable
      // row wrapper. With an exact article query, a single visible
      // "상품 데이터" action is the searched product and can safely be used
      // only as a trigger for the internal detail response.
      if (!row && attempt >= 12) {
        const actions = [...document.querySelectorAll("a,button,[role=button],span,div")]
          .filter((element) => visible(element) && /상품\s*데이터/.test(element.textContent.trim()))
          .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
          });
        // POIZON often omits the searched article number from the rendered
        // virtual row even though the exact search returned products. Rank an
        // action whose ancestors contain the article first; otherwise use the
        // first visible result action. The search request itself is exact, so
        // requiring the article to be rendered again creates a false
        // "product not found" result.
        const action = actions.find((item) => {
          let candidate = item;
          for (let depth = 0; candidate && depth < 12; depth += 1, candidate = candidate.parentElement) {
            if (normalize(candidate.innerText).includes(normalizedArticle)) return true;
          }
          return false;
        }) || actions[0];
        if (action) {
          let candidate = action;
          for (let depth = 0; candidate && depth < 12; depth += 1, candidate = candidate.parentElement) {
            if (normalize(candidate.innerText).includes(normalizedArticle)) {
              row = candidate;
              break;
            }
          }
          row ||= action.parentElement || action;
        }
      }
      if (!row) continue;
      const rowText = String(row.innerText || "");
      const salesMatch = rowText.match(/(?:최근\s*30일\s*판매량\D*)(<?\s*[\d,]+\+?)/i);
      const salesRaw = String(salesMatch?.[1] || "").trim();
      const dataLabels = [...row.querySelectorAll("a,button,[role=button],span,div")]
        .filter((element) => visible(element) && /상품\s*데이터/.test(element.textContent.trim()))
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
        });
      const dataLabel = dataLabels[0];
      const target = dataLabel?.closest("a,button,[role=button]") || dataLabel;
      if (!target) continue;
      target.scrollIntoView({ block: "center", inline: "center" });
      const rect = target.getBoundingClientRect();
      return {
        ok: true,
        salesRaw,
        rowText,
        productDataPoint: {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        },
      };
    }
    const visibleDataActions = [...document.querySelectorAll("a,button,[role=button],span,div")]
      .filter((element) => visible(element) && /상품\s*데이터/.test(element.textContent.trim())).length;
    return { ok: false, code: "PRODUCT_ROW_NOT_FOUND", visibleDataActions };
  })()`, true).catch(() => ({ ok: false, code: "PRODUCT_SEARCH_FAILED" }));
  if (!searched?.ok) {
    showCollectorWindow();
    return {
      ok: false,
      code: searched?.code || "PRODUCT_SEARCH_FAILED",
      message: `${articleNumber} 검색 결과 열기 실패 · 상품 데이터 버튼 ${Number(searched?.visibleDataActions || 0)}개`,
    };
  }
  const productDataClicked = await physicalSellerPointClick(searched.productDataPoint, 1_400);
  if (!productDataClicked) {
    showCollectorWindow();
    return { ok: false, code: "PRODUCT_DATA_CLICK_POINT_NOT_FOUND", message: `${articleNumber} 상품 데이터 버튼을 클릭하지 못했습니다.` };
  }
  const productPanelOpened = await productFrame.executeJavaScript(String.raw`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getClientRects().length > 0;
    const article = ${JSON.stringify(articleNumber.toUpperCase().replace(/[^A-Z0-9]/g, ""))};
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const panel = [...document.querySelectorAll(".ant-drawer-content,[role=dialog],aside,.ant-drawer,section")].find((element) => {
        if (!visible(element)) return false;
        const rect = element.getBoundingClientRect();
        const content = String(element.innerText || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        return rect.left > innerWidth * 0.55 && rect.width > 240
          && /상품\s*데이터/.test(element.innerText || "")
          && (content.includes(article) || /거래\s*내역|가격\s*추이/.test(element.innerText || ""));
      });
      if (panel) return true;
      await wait(250);
    }
    return false;
  })()`, true).catch(() => false);
  if (!productPanelOpened) {
    showCollectorWindow();
    return { ok: false, code: "PRODUCT_DATA_PANEL_NOT_OPENED", message: `${articleNumber} 상품 데이터 화면으로 전환되지 않았습니다.` };
  }
  let salesRaw = String(searched.salesRaw || "").trim();
  if (!salesRaw) {
    const rowText = String(searched.rowText || "");
    const matches = [...rowText.matchAll(/(?:^|\s)(<?\s*[\d,]+)\+?(?=\s|$)/g)].map((match) => match[1]);
    salesRaw = matches.at(-1) || "";
  }
  await productFrame.executeJavaScript(String.raw`(() => {
    window.__aroundGOptionResponses = [];
    return true;
  })()`, true).catch(() => false);
  const transactionHistoryTabPoint = await productFrame.executeJavaScript(String.raw`(() => {
    const visible = (element) => element && element.getClientRects().length > 0;
    const panels = [...document.querySelectorAll(".ant-drawer-content,[role=dialog],aside,.ant-drawer,section")]
      .filter((element) => {
        if (!visible(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.left > innerWidth * 0.55 && rect.width > 240 && /상품\s*데이터/.test(element.innerText || "");
      }).sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
    const panel = panels[0];
    const label = [...(panel?.querySelectorAll("[role=tab],button,a,span,div") || [])].filter(visible)
      .filter((element) => /거래\s*내역/.test(element.textContent.trim()))
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    const target = label?.closest("[role=tab],button,a") || label;
    if (!target) return null;
    target.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`, true).catch(() => null);
  if (!transactionHistoryTabPoint) {
    await stopTransactionNetworkCapture();
    showCollectorWindow();
    return { ok: false, code: "TRANSACTION_HISTORY_TAB_NOT_FOUND", message: `${articleNumber} 상품 데이터의 거래 내역 링크를 찾지 못했습니다.` };
  }
  await physicalSellerPointClick(transactionHistoryTabPoint, 1_200);
  const transactionHistoryTabOpened = await productFrame.executeJavaScript(String.raw`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getClientRects().length > 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const panel = [...document.querySelectorAll(".ant-drawer-content,[role=dialog],aside,.ant-drawer,section")].find((element) => {
        if (!visible(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.left > innerWidth * 0.55 && rect.width > 240
          && /거래\s*내역/.test(element.innerText || "")
          && /전체\s*\(옵션\s*선택\)|옵션\s*선택/.test(element.innerText || "");
      });
      if (panel) return true;
      await wait(250);
    }
    return false;
  })()`, true).catch(() => false);
  if (!transactionHistoryTabOpened) {
    await stopTransactionNetworkCapture();
    showCollectorWindow();
    return { ok: false, code: "TRANSACTION_HISTORY_TAB_NOT_OPENED", message: `${articleNumber} 거래 내역 화면으로 전환되지 않았습니다.` };
  }
  const optionControl = await productFrame.executeJavaScript(String.raw`(() => {
    const visible = (element) => element && element.getClientRects().length > 0;
    const panels = [...document.querySelectorAll(".ant-drawer-content,[role=dialog],aside,.ant-drawer,section")]
      .filter((element) => {
        if (!visible(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.left > innerWidth * 0.55 && rect.width > 240
          && /거래\s*내역/.test(element.innerText || "");
      }).sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
    const panel = panels[0] || document.body;
    const controls = [...panel.querySelectorAll("select,[role=combobox],button,[aria-haspopup=listbox],input,.ant-select-selector")].filter(visible);
    const control = controls.find((element) => /전체|옵션\s*선택/.test((element.innerText || element.value || element.placeholder || element.parentElement?.innerText || "").trim()));
    if (!control) return null;
    const target = control.closest("select,[role=combobox],button,[aria-haspopup=listbox],.ant-select-selector") || control;
    const rect = target.getBoundingClientRect();
    return {
      opened: true,
      text: String(target.innerText || target.value || target.parentElement?.innerText || ""),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`, true).catch(() => null);
  if (!optionControl) {
    await stopTransactionNetworkCapture();
    showCollectorWindow();
    return { ok: false, code: "OPTION_CONTROL_NOT_FOUND", message: `${articleNumber} 거래 내역의 전체 옵션 선택창을 찾지 못했습니다.` };
  }
  await physicalSellerPointClick(optionControl, 500);
  await wait(400);
  const allOption = await productFrame.executeJavaScript(String.raw`(() => {
    const visible = (element) => element && element.getClientRects().length > 0;
    const options = [...document.querySelectorAll("[role=option],.ant-select-item-option,li")].filter(visible)
      .filter((element) => /^전체(?:\s|\(|$)/.test(element.textContent.trim()))
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
    const option = options[0];
    if (!option) return null;
    const rect = option.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`, true).catch(() => null);
  if (allOption) {
    await physicalSellerPointClick(allOption, 900);
  } else {
    sellerWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "ESC" });
    sellerWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "ESC" });
  }
  await wait(700);
  const capturedRows = [];
  let previousScroll = -1;
  for (let pass = 0; pass < 40; pass += 1) {
    const capture = await productFrame.executeJavaScript(String.raw`(() => {
      const visible = (element) => element && element.getClientRects().length > 0;
      const panels = [...document.querySelectorAll(".ant-drawer-content,[role=dialog],aside,.ant-drawer,section")]
        .filter((element) => {
          if (!visible(element)) return false;
          const rect = element.getBoundingClientRect();
          return rect.left > innerWidth * 0.55 && rect.width > 240
            && /거래\s*내역/.test(element.innerText || "");
        }).sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
      const panel = panels[0] || document.body;
      const leafText = [...panel.querySelectorAll("span,p,div,td")].filter((element) => {
        if (!visible(element)) return false;
        const value = String(element.innerText || "").trim();
        if (!value || value.length > 80) return false;
        return ![...element.children].some((child) => String(child.innerText || "").trim() === value);
      }).map((element) => ({ element, text: String(element.innerText || "").trim(), rect: element.getBoundingClientRect() }));
      const priceNodes = leafText.filter((node) => /^(?:[₩￦]\s*[\d,]+(?:\s*-\s*[₩￦]?\s*[\d,]+)?|[\d,]+\s*원)$/.test(node.text));
      const rows = [];
      const grouped = [];
      for (const node of priceNodes) {
        let group = grouped.find((item) => Math.abs(item.y - node.rect.top) < 8);
        if (!group) { group = { y: node.rect.top, prices: [] }; grouped.push(group); }
        group.prices.push(node);
      }
      for (const group of grouped) {
        const firstPrice = group.prices.sort((a, b) => a.rect.left - b.rect.left)[0];
        const salesNode = leafText.filter((node) => /판매량\s*[:：]?\s*<?\s*[\d,]+\+?/i.test(node.text)
          && Math.abs(node.rect.left - firstPrice.rect.left) < 65
          && node.rect.top >= firstPrice.rect.top - 5 && node.rect.top <= firstPrice.rect.bottom + 34)
          .sort((a, b) => a.rect.top - b.rect.top)[0];
        const labels = leafText.filter((node) => node.rect.right <= firstPrice.rect.left + 8
          && node.rect.left >= panel.getBoundingClientRect().left
          && node.rect.top >= firstPrice.rect.top - 25 && node.rect.bottom <= (salesNode?.rect.bottom || firstPrice.rect.bottom + 30) + 10
          && !/[₩￦원]|판매량/.test(node.text))
          .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
        const option = [...new Set(labels.map((node) => node.text))].join(" ").replace(/\s+/g, " ").trim();
        const price = Number((firstPrice.text.match(/(?:[₩￦]\s*)?([\d,]+)\s*원?/)?.[1] || "").replace(/,/g, ""));
        const sales = (salesNode?.text.match(/판매량\s*[:：]?\s*(<?\s*[\d,]+)\+?/i)?.[1] || "").trim();
        if (option && price && sales) rows.push({ text: option + " " + firstPrice.text + " " + salesNode.text, option, price, sales });
      }
      const scroller = [panel, ...panel.querySelectorAll("div,section")]
        .filter((element) => {
          if (!visible(element) || element.scrollHeight <= element.clientHeight + 20) return false;
          const rect = element.getBoundingClientRect();
          return rect.left >= panel.getBoundingClientRect().left - 2 && rect.width > 180;
        }).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
      if (!scroller) return { rows, scrollTop: 0, atEnd: true, scrollPoint: null };
      const rect = scroller.getBoundingClientRect();
      return {
        rows,
        scrollTop: scroller.scrollTop,
        atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4,
        scrollPoint: { x: rect.left + rect.width / 2, y: Math.min(rect.bottom - 20, rect.top + rect.height * 0.72) },
      };
    })()`, true).catch(() => ({ rows: [], atEnd: true, scrollTop: 0 }));
    capturedRows.push(...(capture.rows || []));
    if (capture.atEnd || Number(capture.scrollTop) === previousScroll) break;
    previousScroll = Number(capture.scrollTop);
    if (capture.scrollPoint) {
      sellerWindow.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(capture.scrollPoint.x), y: Math.round(capture.scrollPoint.y) });
      sellerWindow.webContents.sendInputEvent({ type: "mouseWheel", x: Math.round(capture.scrollPoint.x), y: Math.round(capture.scrollPoint.y), deltaY: 420, deltaX: 0, canScroll: true });
    }
    await wait(350);
  }
  const uniqueRows = [...new Map(capturedRows.map((row) => [`${row.option}|${row.price}|${row.sales}`, row])).values()];
  await wait(500);
  await stopTransactionNetworkCapture();
  const sellerResponses = await productFrame.executeJavaScript(String.raw`(() => Array.isArray(window.__aroundGOptionResponses)
    ? window.__aroundGOptionResponses.slice(-80)
    : [])()`, true).catch(() => []);
  const responseRows = optionRowsFromSellerResponses([
    ...transactionNetworkResponses,
    ...sellerResponses,
  ]);
  // The seller API can return partial/background payloads. Never let one
  // incomplete API row discard valid option rows collected from the visible
  // transaction-history list.
  const priceRows = [...new Map(
    [...uniqueRows, ...responseRows].map((row) => [
      `${String(row?.option || "").trim()}|${Number(row?.price || 0)}|${String(row?.sales || "").trim()}`,
      row,
    ])
  ).values()];
  const sizeOptions = qualifiedOptionPrices(priceRows, 0)
    .sort((left, right) => String(left.option || "").localeCompare(String(right.option || ""), "ko", { numeric: true }));
  const result = highestQualifiedOptionPrice({ rows: priceRows, minimumSales: 30 });
  await productFrame.executeJavaScript(String.raw`(() => {
    const visible = (element) => element && element.getClientRects().length > 0;
    const labels = [...document.querySelectorAll("button,a,[role=button],span")].filter(visible);
    const back = labels.find((element) => /뒤로가기/.test(element.textContent.trim()));
    const target = back?.closest("button,a,[role=button]") || back;
    if (target) target.click();
    return Boolean(target);
  })()`, true).catch(() => false);
  showCollectorWindow();
  if (!result.price) {
    sellerWindow.showInactive();
    return { ok: false, eligible: false, code: "QUALIFIED_OPTION_PRICE_NOT_FOUND", sizeOptions, sales30d: Number(String(salesRaw).replace(/[^0-9]/g, "")) || 0, message: `${articleNumber} 옵션 가격 확인 실패 · 화면 ${uniqueRows.length}행 · 응답 ${responseRows.length}행 · 판매 30건 이상 0행` };
  }
  sellerWindow.hide();
  return {
    ok: true,
    articleNumber,
    sales30d: Number(String(salesRaw).replace(/[^0-9]/g, "")) || 0,
    ...result,
    sizeOptions,
    source: uniqueRows.length && responseRows.length
      ? "seller-product-transaction-history-options+api"
      : responseRows.length
        ? "seller-product-transaction-api"
        : "seller-product-transaction-history-options",
  };
}

function sendWeeklySiteHealthStatus(payload = {}) {
  const status = {
    ...store?.snapshot()?.settings?.weeklySiteHealth,
    ...payload,
    scheduleLabel: "매주 수요일 밤 12시",
    nextRunAt: nextWeeklySiteHealthAt(new Date()).toISOString(),
  };
  mainWindow?.webContents.send("weekly-site-health:status", status);
  return status;
}

async function inspectSiteHealthTarget(target) {
  const startedAt = new Date();
  try {
    const response = await fetch(target.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(SITE_HEALTH_TIMEOUT_MS),
      headers: {
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 AroundG-SiteHealth/1.0",
      },
    });
    const endedAt = new Date();
    // 401/403 means that the server itself responded and a login/security
    // session is required. Record it separately instead of misreporting a
    // network outage.
    const reachable = response.status > 0 && response.status < 500;
    return {
      ...target,
      ok: reachable,
      result: reachable ? (response.ok ? "정상" : "접속 가능·로그인/보안 확인 필요") : "오류",
      statusCode: response.status,
      responseMs: endedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      finalUrl: response.url || target.url,
      error: reachable ? "" : `HTTP ${response.status}`,
    };
  } catch (error) {
    const endedAt = new Date();
    return {
      ...target,
      ok: false,
      result: "오류",
      statusCode: 0,
      responseMs: endedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      finalUrl: target.url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function reportTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

async function writeWeeklySiteHealthReport(startedAt, endedAt, results, summary) {
  const folder = currentBrandExportFolder();
  await mkdir(folder, { recursive: true });
  const filePath = join(folder, `연동서버_정기점검_${reportTimestamp(startedAt)}.xlsx`);
  const nextRun = nextWeeklySiteHealthAt(endedAt);
  const overview = [
    ["항목", "내용"],
    ["점검 구분", "연동 서버 주간 정기점검"],
    ["점검 일정", "매주 수요일 밤 12시 (목요일 00:00)"],
    ["점검 시작", startedAt.toLocaleString("ko-KR")],
    ["점검 종료", endedAt.toLocaleString("ko-KR")],
    ["전체 결과", summary.ok ? "전체 정상" : `${summary.failed}개 사이트 점검 필요`],
    ["정상", summary.passed],
    ["점검 필요", summary.failed],
    ["다음 점검 예정", nextRun.toLocaleString("ko-KR")],
  ];
  const detail = [
    ["번호", "연동 서버", "점검 주소", "점검 시작", "점검 종료", "HTTP 상태", "응답 시간(ms)", "점검 결과", "오류 내용"],
    ...results.map((result, index) => [
      index + 1,
      result.name,
      result.finalUrl || result.url,
      new Date(result.startedAt).toLocaleString("ko-KR"),
      new Date(result.endedAt).toLocaleString("ko-KR"),
      result.statusCode || "응답 없음",
      result.responseMs,
      result.result,
      result.error || "",
    ]),
  ];
  const workbook = (rows, widths) => ({
    data: rows.map((row, rowIndex) => row.map((value) => rowIndex === 0
      ? { value, fontWeight: "bold", backgroundColor: "#DCECF8" }
      : { value })),
    columns: widths.map((width) => ({ width })),
    stickyRowsCount: 1,
  });
  await writeXlsxFile([
    { ...workbook(overview, [24, 64]), sheet: "점검 요약" },
    { ...workbook(detail, [8, 24, 68, 24, 24, 14, 18, 28, 54]), sheet: "서버별 점검 결과" },
  ]).toFile(filePath);
  return filePath;
}

async function runWeeklySiteHealthCheck({ manual = false } = {}) {
  if (weeklySiteHealthRunning) return sendWeeklySiteHealthStatus({ running: true, message: "연동 서버 정기점검이 이미 진행 중입니다." });
  weeklySiteHealthRunning = true;
  const startedAt = new Date();
  sendWeeklySiteHealthStatus({ running: true, state: "running", startedAt: startedAt.toISOString(), message: "모든 연동 서버 정기점검을 시작했습니다.", completed: 0, total: SITE_HEALTH_TARGETS.length });
  const results = [];
  try {
    for (const target of SITE_HEALTH_TARGETS) {
      sendWeeklySiteHealthStatus({ running: true, state: "running", message: `${target.name} 연동 상태를 점검하고 있습니다.`, completed: results.length, total: SITE_HEALTH_TARGETS.length });
      results.push(await inspectSiteHealthTarget(target));
    }
    const endedAt = new Date();
    const summary = weeklySiteHealthSummary(results);
    const reportPath = await writeWeeklySiteHealthReport(startedAt, endedAt, results, summary);
    const message = summary.ok
      ? `연동 서버 ${summary.total}곳 정기점검이 모두 정상 완료되었습니다.`
      : `정기점검 완료: ${summary.passed}곳 정상, ${summary.failed}곳 점검이 필요합니다.`;
    const saved = {
      running: false,
      state: summary.ok ? "completed" : "completed_with_errors",
      manual,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      lastRunAt: endedAt.toISOString(),
      message,
      reportPath,
      results,
      ...summary,
    };
    await store.setSettings({ weeklySiteHealth: saved });
    sendWeeklySiteHealthStatus(saved);
    if (Notification.isSupported()) new Notification({ title: "Around G 정기점검 완료", body: `${message}\nExcel 보고서가 저장되었습니다.` }).show();
    return saved;
  } catch (error) {
    const failed = {
      running: false,
      state: "failed",
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      message: `정기점검 처리 오류: ${error instanceof Error ? error.message : String(error)}`,
      results,
    };
    await store.setSettings({ weeklySiteHealth: failed });
    sendWeeklySiteHealthStatus(failed);
    return failed;
  } finally {
    weeklySiteHealthRunning = false;
    scheduleWeeklySiteHealthCheck();
  }
}

function scheduleWeeklySiteHealthCheck() {
  if (weeklySiteHealthTimer) clearTimeout(weeklySiteHealthTimer);
  const now = new Date();
  const next = nextWeeklySiteHealthAt(now);
  weeklySiteHealthTimer = setTimeout(() => void runWeeklySiteHealthCheck(), Math.max(1_000, next.getTime() - now.getTime()));
  weeklySiteHealthTimer.unref?.();
  sendWeeklySiteHealthStatus({ nextRunAt: next.toISOString() });
}

app.whenReady().then(async () => {
  app.setAppUserModelId("kr.aroundg.poizon");
  const userDataFolder = app.getPath("userData");
  const hadLocalData = Boolean(await stat(join(userDataFolder, "around-g-data.json")).catch(() => null));
  store = new JsonStore(userDataFolder);
  await store.load();
  if (process.argv.includes("--migrate-only")) {
    app.quit();
    return;
  }
  await restorePortableOneDriveBackupIfFresh(hadLocalData).catch(() => {});
  await initializeOneDrivePoizonBackup();
  ipcMain.handle("store:snapshot", () => store.snapshot());
  ipcMain.handle("store:upsert", (_event, collection, item) => store.upsert(collection, item));
  ipcMain.handle("store:bulk-upsert", (_event, collection, items) => store.bulkUpsert(collection, items));
  ipcMain.handle("store:remove", (_event, collection, id) => store.remove(collection, id));
  ipcMain.handle("collector:check", (_event, input) => store.updateCollector(input));
  ipcMain.handle("app:info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    automaticUpdates: app.isPackaged,
  }));
  ipcMain.handle("backup:status", () => oneDriveBackupStatus);
  ipcMain.handle("backup:run", () => runOneDriveRecoveryBackup());
  ipcMain.handle("update:check", async () => {
    if (!app.isPackaged) return { ok: false, message: "개발 모드에서는 업데이트를 확인하지 않습니다." };
    return checkForUpdatesAutomatically();
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
  ipcMain.handle("explorer:meta", async () => {
    const settings = store.snapshot().settings;
    const cached = settings.brandCatalog;
    const brands = Array.isArray(cached) && cached.length ? cached : explorerMetadata().brands;
    // Brand selection must remain available even when the much larger official
    // domain registry cannot be persisted or refreshed.
    const officialBrandRegistry = safeOfficialDomainRegistry(brands);
    return {
      ...explorerMetadata(),
      brands: prioritizeBrandCatalog(brandsWithOfficialDomainStatus(brands, officialBrandRegistry)),
      officialDomainSummary: officialDomainRegistrySummary(officialBrandRegistry),
      officialDomainAudit: officialDomainAuditSnapshot(officialBrandRegistry),
      brandCatalogUpdatedAt: String(settings.brandCatalogUpdatedAt || ""),
      needsBrandSync: brandCatalogNeedsSync(cached, settings.brandCatalogUpdatedAt),
      fullBrandMinimum: FULL_BRAND_CATALOG_MINIMUM,
    };
  });
  ipcMain.handle("explorer:sync-brands", async () => {
    mainWindow?.webContents.send("explorer:brand-progress", { percent: 10, count: 0 });
    const result = await syncBrandCatalogFromKrPoizon();
    mainWindow?.webContents.send("explorer:brand-progress", {
      percent: result.ok ? 100 : 0,
      count: result.ok ? result.brands.length : 0,
    });
    if (result.ok) return result;
    const settings = store.snapshot().settings;
    const preserved = Array.isArray(settings.brandCatalog) && settings.brandCatalog.length
      ? settings.brandCatalog
      : explorerMetadata().brands;
    return {
      ...result,
      preservedBrands: prioritizeBrandCatalog(preserved),
      preservedCount: preserved.length,
    };
  });
  ipcMain.handle("official-domain:audit-status", async () => {
    const settings = store.snapshot().settings;
    const brands = settings.brandCatalog || explorerMetadata().brands;
    const registry = await ensureOfficialDomainRegistry(brands);
    return officialDomainAuditSnapshot(registry);
  });
  ipcMain.handle("official-domain:audit-start", async () => {
    clearTimeout(officialDomainAuditResumeTimer);
    officialDomainAuditResumeTimer = null;
    if (!officialDomainAuditRunning) void runOfficialDomainAudit();
    const settings = store.snapshot().settings;
    const registry = await ensureOfficialDomainRegistry(settings.brandCatalog || explorerMetadata().brands);
    return { ok: true, audit: officialDomainAuditSnapshot(registry, { running: true, state: "running" }) };
  });
  ipcMain.handle("official-domain:audit-stop", () => {
    officialDomainAuditStopRequested = true;
    officialDomainAuditAbortCurrent?.();
    officialDomainAuditAbortCurrent = null;
    if (officialDomainAuditWindow && !officialDomainAuditWindow.isDestroyed()) {
      officialDomainAuditWindow.destroy();
    }
    officialDomainAuditWindow = null;
    clearTimeout(officialDomainAuditResumeTimer);
    officialDomainAuditResumeTimer = null;
    return { ok: true };
  });
  ipcMain.handle("weekly-site-health:status", () => sendWeeklySiteHealthStatus());
  ipcMain.handle("weekly-site-health:run", () => runWeeklySiteHealthCheck({ manual: true }));
  ipcMain.handle("seller:open", () => {
    openSellerCenterWindow();
    return { ok: true };
  });
  ipcMain.handle("seller:open-product-search", () => {
    openSellerCenterWindow(SELLER_PRODUCT_SEARCH_URL);
    return { ok: true };
  });
  const abortSellerBrandExportAttempt = async () => {
  brandExportAttemptGeneration += 1;
  brandExportJobPending = false;
  pendingBrandExportName = "";
  pendingBrandExportJobId = "";
  sellerProductFrameRoutingId = null;
  try {
    sellerWindow?.webContents.stop();
    if (sellerWindow && !sellerWindow.isDestroyed()) {
      await Promise.race([
        sellerWindow.loadURL(SELLER_PRODUCT_SEARCH_URL),
        new Promise((resolve) => setTimeout(resolve, 8_000)),
      ]);
      sellerWindow.hide();
    }
  } catch {}
  showCollectorWindow();
  return { ok: true };
  };
  ipcMain.handle("seller:brand-export", async (_event, input) => {
    let timeout;
    const timedOut = new Promise((resolve) => {
      timeout = setTimeout(() => resolve({
        ok: false,
        code: "BRAND_AUTOMATION_TIMEOUT",
        message: `${String(input?.brandName || "선택 브랜드")} 작업이 20분 안에 끝나지 않아 강제 종료했습니다. 다음 브랜드로 이동합니다.`,
      }), SELLER_BRAND_EXPORT_HARD_TIMEOUT_MS);
    });
    const result = await Promise.race([automateSellerBrandExport(input), timedOut]);
    clearTimeout(timeout);
    if (result?.code === "BRAND_AUTOMATION_TIMEOUT") {
      await abortSellerBrandExportAttempt();
      return { ...result, aborted: true };
    }
    return result;
  });
  ipcMain.handle("seller:abort-brand-export-attempt", abortSellerBrandExportAttempt);

  ipcMain.handle("seller:stop-brand-work", async () => {
    brandWorkSessionGeneration += 1;
    if (brandExportMonitorRestartTimer) {
      clearTimeout(brandExportMonitorRestartTimer);
      brandExportMonitorRestartTimer = null;
    }
    brandExportJobs.clear();
    brandExportAllCompleteSent = true;
    brandDownloadStarted = false;
    activeBrandDownloadJobId = "";
    await store.setSettings({ brandExportJobCache: [] });
    await abortSellerBrandExportAttempt();
    if (sellerMonitorWindow && !sellerMonitorWindow.isDestroyed()) {
      sellerMonitorWindow.webContents.stop();
      sellerMonitorWindow.destroy();
    }
    sellerMonitorWindow = null;
    return { ok: true, stopped: true };
  });

ipcMain.handle("seller:start-brand-export-monitor", () => {
    if (brandExportJobs.size && (!sellerWindow || sellerWindow.isDestroyed())) {
      openSellerCenterWindow(SELLER_EXPORT_CENTER_URL, { visible: false });
    }
    if (brandExportJobs.size) ensureSellerMonitorWindow();
    scheduleBrandExportMonitor(0);
    return { ok: true, jobs: brandExportJobs.size };
  });
  ipcMain.handle("brand-export:pending-jobs", () => restorePendingBrandExportJobs());
  ipcMain.handle("brand-export:open-file", async (_event, input = {}) => {
    const filePath = String(input.path || "").trim();
    if (!filePath) return { ok: false, message: "열 파일 경로가 없습니다." };
    openInventoryWindow(filePath, String(input.brand || "").trim());
    return { ok: true };
  });
  ipcMain.handle("brand-export:open-original", async (_event, input = {}) => {
    const filePath = String(input.path || "").trim();
    if (!filePath) return { ok: false, message: "파일 경로가 없습니다." };
    const error = await shell.openPath(filePath);
    return error ? { ok: false, message: error } : { ok: true };
  });
  ipcMain.handle("excel:preview", async (_event, input = {}) => {
    try {
      return await previewExcelFile(input);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("brand-export:list-files", () => listBrandExportFiles());
  ipcMain.handle("brand-export:trash-files", async (_event, paths = []) => {
    const requested = [...new Set((Array.isArray(paths) ? paths : []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 500);
    const root = resolve(currentBrandExportFolder());
    let deleted = 0;
    const failed = [];
    for (const requestedPath of requested) {
      const target = resolve(requestedPath);
      const nested = relative(root, target);
      if (!nested || nested.startsWith("..") || resolve(root, nested) !== target || !/\.xlsx$/i.test(target)) {
        failed.push({ path: requestedPath, message: "허용된 Excel 저장 폴더 밖의 파일입니다." });
        continue;
      }
      try {
        const info = await stat(target);
        if (!info.isFile()) throw new Error("Excel 파일이 아닙니다.");
        await shell.trashItem(target);
        deleted += 1;
      } catch (error) {
        failed.push({ path: requestedPath, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return {
      ok: failed.length === 0,
      deleted,
      failed,
      message: failed.length ? `${deleted}개 삭제 · ${failed.length}개 실패` : "",
    };
  });
  ipcMain.handle("brand-export:clear-session", async () => {
    brandWorkSessionGeneration += 1;
    brandExportJobs.clear();
    pendingBrandExportName = "";
    pendingBrandExportJobId = "";
    activeBrandDownloadJobId = "";
    brandExportJobPending = false;
    brandDownloadStarted = false;
    lastBrandExportSignature = "__BASELINE_EXISTING_FILES__";
    await store.setSettings({ brandExportJobCache: [] });
    mainWindow?.webContents.send("brand-export:session-cleared");
    for (const inventoryWindow of inventoryWindows) {
      if (!inventoryWindow.isDestroyed()) {
        inventoryWindow.webContents.send("brand-export:session-cleared");
      }
    }
    return { ok: true };
  });
  ipcMain.handle("brand-export:select-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      defaultPath: currentBrandExportFolder(),
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const folder = result.filePaths[0];
    await store.setSettings({ brandExportFolder: folder });
    lastBrandExportSignature = "__BASELINE_EXISTING_FILES__";
    startBrandExportFolderPolling();
    return { canceled: false, folder };
  });
  ipcMain.handle("brand-export:get-folder", () => ({
    folder: currentBrandExportFolder(),
  }));
  ipcMain.handle("seller:capture", () => captureSellerCenterProducts());
  ipcMain.handle("excel:stage-popular-products", async (_event, products) => {
    try {
      const limit = 200;
      const slots = createPopularSlots(products, limit);
      const folder = oneDrivePopularExportFolder()
        || join(app.getPath("desktop"), "Around G POIZON");
      await mkdir(folder, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      const filePath = join(folder, `POIZON-인기상품-원본-${stamp}.xlsx`);
      const data = popularSlotsToExcelData(slots);
      await writeXlsxFile(data, {
        sheet: "POIZON_RAW",
        stickyRowsCount: 1,
        columns: [
          { width: 8 }, { width: 46 }, { width: 20 }, { width: 54 }, { width: 18 },
          { width: 15 }, { width: 15 }, { width: 15 }, { width: 42 }, { width: 12 },
        ],
      }).toFile(filePath);

      const rows = await readSheet(await readFile(filePath), "POIZON_RAW");
      const imported = excelRowsToPopularProducts(rows);
      return {
        ok: true,
        path: filePath,
        products: imported,
        imported: imported.filter((product) => !product.missingRank).length,
        missing: imported.filter((product) => product.missingRank).map((product) => product.rank),
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("popular:workflow-get", () => {
    const settings = store.snapshot().settings;
    return {
      period: settings.popularPeriod || "week",
      compare: settings.popularCompare || "week",
      unit: settings.popularUnit || "SPU",
      limit: 200,
      reminder: false,
      lastSyncAt: settings.popularLastSyncAt || "",
    };
  });
  ipcMain.handle("popular:workflow-save", async (_event, input) => {
    const allowed = {
      period: new Set(["day", "week", "month", "quarter"]),
      compare: new Set(["none", "year", "day", "week", "month"]),
      unit: new Set(["SPU", "SKU"]),
    };
    const next = {
      popularPeriod: allowed.period.has(input.period) ? input.period : "week",
      popularCompare: allowed.compare.has(input.compare) ? input.compare : "week",
      popularUnit: allowed.unit.has(input.unit) ? input.unit : "SPU",
      popularLimit: 200,
      popularReminder: false,
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
      const officialBrandRecord = officialDomainRecordForBrand(
        store.snapshot().settings.officialBrandRegistry,
        String(input?.brand || "").trim()
      );
      const data = await queryDomesticProducts({
        query: String(input?.query || "").trim(),
        articleNumber: String(input?.articleNumber || "").trim(),
        brand: String(input?.brand || "").trim(),
        title: String(input?.title || "").trim(),
        preferTitle: !String(input?.imageUrl || "").trim(),
        verifyLinkCounts: false,
        officialBrandRecord,
      });
      let matched = await addMatchConfidence(data, input || {});
      if (input?.verifyLinkCounts === true) {
        matched = await addRenderedSearchCounts(
          matched,
          String(input?.articleNumber || ""),
          String(input?.brand || ""),
          String(input?.title || "")
        );
        matched = await addMatchConfidence(matched, input || {});
      }
      return { ok: true, data: matched };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  let categorySearchGeneration = 0;
  ipcMain.handle("explorer:cancel-category", () => {
    categorySearchGeneration += 1;
    return { ok: true };
  });
  ipcMain.handle("explorer:query", (_event, input) => {
    const settings = store.snapshot().settings;
    const catalog = settings.brandCatalog || explorerMetadata().brands;
    const rankedBrands = input?.mode === "category"
      ? salesRankedBrands(store.snapshot().products, catalog, 200)
      : [];
    const requestGeneration = categorySearchGeneration;
    return queryExplorer(secretConfig(), {
      ...input,
      brandIds: input?.mode === "category" ? rankedBrands.map((brand) => brand.id) : input?.brandIds,
      rankedBrandCount: rankedBrands.length,
      shouldStop: () => input?.mode === "category" && requestGeneration !== categorySearchGeneration,
      onProgress: (pageNum, pageCount, detail = {}) => {
        const percent = Math.min(70, Math.max(2, Math.round((pageNum / Math.max(1, pageCount)) * 70)));
        mainWindow?.webContents.send("explorer:brand-progress", {
          context: input?.mode === "category" ? "category" : "brand",
          percent,
          pageNum,
          pageCount,
          count: Number(detail.count || 0),
          phase: String(detail.phase || "progress"),
          brandName: input?.mode === "category" ? String(rankedBrands.find((brand) => Number(brand.id) === Number(detail.brandId))?.name || "") : "",
          brandLogoUrl: input?.mode === "category" ? String(rankedBrands.find((brand) => Number(brand.id) === Number(detail.brandId))?.logoUrl || "") : "",
          message: input?.mode === "category"
            ? `판매순위 연관 브랜드 ${pageNum}/${pageCount} 조회 중`
            : `POIZON API ${pageNum}/${pageCount}페이지 수집 중`,
        });
      },
    });
  });
  ipcMain.handle("external:open", async (_event, url) => {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("INVALID_URL");
    await shell.openExternal(parsed.href);
  });
  ipcMain.handle("official:open-search", async (_event, input) => {
    const discovery = new URL(String(input?.discoveryUrl || ""));
    const product = new URL(String(input?.productUrl || ""));
    if (![discovery.protocol, product.protocol].every((protocol) => ["https:", "http:"].includes(protocol))) {
      throw new Error("INVALID_URL");
    }
    await shell.openExternal(discovery.href);
    await wait(1_500);
    await shell.openExternal(product.href);
    return { ok: true };
  });
  ipcMain.handle("excel:import", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Excel", extensions: ["xlsx"] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const sheet = await readFirstDataSheet(await readFile(filePath));
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
  ipcMain.handle("excel:import-brand-source", async (_event, input = {}) => {
    let filePath = String(input.path || "").trim();
    const expectedBrand = String(input.expectedBrand || "").trim();
    if (!filePath) {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "POIZON Excel", extensions: ["xlsx"] }],
      });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      [filePath] = result.filePaths;
    }
    const fileBuffer = await readFile(filePath);
    const workbook = await readSheet(repairPoizonWorksheetDimensions(fileBuffer));
    const sourceSheet = getPoizonWorksheetRows(workbook);
    if (!Array.isArray(sourceSheet) || sourceSheet.length < 2) {
      return { canceled: false, ok: false, message: "Excel 파일에 상품 데이터가 없습니다." };
    }
    const filtered = filterPoizonRowsByTotalSales(sourceSheet, POIZON_MINIMUM_TOTAL_SALES);
    if (!filtered.ok) {
      return {
        canceled: false,
        ok: false,
        code: filtered.code,
        message: filtered.message,
      };
    }
    if (filtered.filteredRows === 0) {
      return {
        canceled: false,
        ok: false,
        code: "POIZON_SALES_FILTER_EMPTY",
        message: `중국 총 판매량 또는 현지 판매자 총 판매량이 ${POIZON_MINIMUM_TOTAL_SALES}건 이상인 상품이 없습니다.`,
        sourceRows: filtered.sourceRows,
        filteredRows: 0,
      };
    }
    const sheet = filtered.sheet;
    const headers = sheet[0] || [];
    const findColumn = (...names) => findPoizonColumn(headers, ...names);
    const columns = {
      spuId: findColumn("SPU ID", "SPU_ID"),
      image: findColumn("SPU 이미지", "상품 이미지", "이미지"),
      articleNumber: findColumn("상품 번호", "상품번호", "품번"),
      title: findColumn("상품명", "영문 상품명"),
      brand: findColumn("상품 브랜드", "브랜드"),
      category1: findColumn("카테고리 대분류", "대분류"),
      category2: findColumn("카테고리 중분류", "중분류"),
      category3: findColumn("카테고리 소분류", "소분류"),
      option: findColumn("사이즈/옵션/색상", "옵션"),
      skuId: findColumn("SKU ID", "SKU_ID"),
      averagePrice: findColumn("최근 30일간 평균 거래가", "최근 30일 평균 거래가"),
      sales30d: findColumn("최근 30일 판매량", "최근30일판매량"),
      localSales30d: findColumn("현지 판매자 최근 30일 판매량", "현지판매자최근30일판매량"),
      totalSales: findColumn("중국 총 판매량", "총 판매량"),
      localTotalSales: findColumn("현지 판매자 총 판매량", "현지판매자총판매량"),
    };
    if (columns.spuId < 0 && columns.articleNumber < 0) {
      return { canceled: false, ok: false, message: "POIZON 상품검색 전체 내보내기 양식이 아닙니다." };
    }
    const cell = (row, index) => index >= 0 ? row[index] : "";
    const numeric = (value) => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const rawMetric = (value) => String(value ?? "").trim();
    const productsByKey = new Map();
    let importedRows = 0;
    for (const row of sheet.slice(1)) {
      const spuId = String(cell(row, columns.spuId) ?? "").trim();
      const articleNumber = String(cell(row, columns.articleNumber) ?? "").trim();
      const title = String(cell(row, columns.title) ?? "").trim();
      if (!spuId && !articleNumber && !title) continue;
      importedRows += 1;
      const key = spuId ? `SPU:${spuId}` : articleNumber ? `ARTICLE:${articleNumber.toUpperCase()}` : `ROW:${importedRows}`;
      const previous = productsByKey.get(key) || {};
      const option = String(cell(row, columns.option) ?? "").trim();
      const options = new Set(previous.options || []);
      if (option) options.add(option);
      const sales30d = numeric(cell(row, columns.sales30d));
      const localSales30d = numeric(cell(row, columns.localSales30d));
      const totalSales = numeric(cell(row, columns.totalSales));
      const localTotalSales = numeric(cell(row, columns.localTotalSales));
      const variant = {
        sourceRow: importedRows + 1,
        skuId: String(cell(row, columns.skuId) ?? "").trim(),
        option,
        sales30d,
        sales30dRaw: rawMetric(cell(row, columns.sales30d)),
        localSales30d,
        localSales30dRaw: rawMetric(cell(row, columns.localSales30d)),
        totalSales,
        totalSalesRaw: rawMetric(cell(row, columns.totalSales)),
        localTotalSales,
        localTotalSalesRaw: rawMetric(cell(row, columns.localTotalSales)),
      };
      productsByKey.set(key, {
        ...previous,
        spuId: previous.spuId || spuId,
        articleNumber: previous.articleNumber || articleNumber,
        title: previous.title || title,
        apiTitle: previous.apiTitle || title,
        logoUrl: previous.logoUrl || String(cell(row, columns.image) ?? "").trim(),
        brandName: previous.brandName || String(cell(row, columns.brand) ?? "").trim(),
        categoryName: previous.categoryName || [
          cell(row, columns.category1), cell(row, columns.category2), cell(row, columns.category3),
        ].filter(Boolean).map(String).join(" / "),
        averagePrice: Math.max(Number(previous.averagePrice || 0), numeric(cell(row, columns.averagePrice))),
        hasPriceData: columns.averagePrice >= 0,
        hasSalesData: columns.sales30d >= 0,
        hasLocalSalesData: columns.localSales30d >= 0,
        hasTotalSalesData: columns.totalSales >= 0,
        hasLocalTotalSalesData: columns.localTotalSales >= 0,
        options: [...options],
        variants: [...(previous.variants || []), variant],
        source: "poizon-excel-export",
      });
    }
    const useTotalSales = columns.totalSales >= 0 && columns.localTotalSales >= 0;
    for (const product of productsByKey.values()) {
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const representative = variants.reduce((best, variant) => {
        if (!best) return variant;
        const localKey = useTotalSales ? "localTotalSales" : "localSales30d";
        const chinaKey = useTotalSales ? "totalSales" : "sales30d";
        return Number(variant[localKey] || 0) > Number(best[localKey] || 0)
          || (Number(variant[localKey] || 0) === Number(best[localKey] || 0)
            && Number(variant[chinaKey] || 0) > Number(best[chinaKey] || 0))
          ? variant
          : best;
      }, null);
      if (representative) {
        for (const metric of ["sales30d", "localSales30d", "totalSales", "localTotalSales"]) {
          product[metric] = representative[metric];
          product[`${metric}Raw`] = representative[`${metric}Raw`];
        }
        product.representativeSkuId = representative.skuId;
        product.representativeOption = representative.option;
      }
    }
    const products = [...productsByKey.values()];
    const brandIntegrity = expectedBrand ? analyzeBrandMatch(expectedBrand, products) : null;
    if (brandIntegrity && !brandIntegrity.ok) {
      return {
        canceled: false,
        ok: false,
        code: "BRAND_EXCEL_MISMATCH",
        message: brandMismatchMessage(brandIntegrity),
        brandIntegrity,
      };
    }
    const processedName = processedBrandExportName(basename(filePath));
    const processedPath = join(dirname(filePath), processedName);
    const exportData = [
      headers.map((value) => ({
        value: String(value ?? ""),
        fontWeight: "bold",
        backgroundColor: "#DCECF8",
      })),
      ...filtered.rows.map((row) => row.map((raw, index) => {
        if (index === filtered.totalSalesColumn || index === filtered.localTotalSalesColumn) {
          return { value: Number(raw || 0), type: Number, format: "#,##0" };
        }
        const value = raw instanceof Date || ["string", "number", "boolean"].includes(typeof raw)
          ? raw
          : raw === null || raw === undefined ? null : String(raw);
        return { value };
      })),
    ];
    await writeXlsxFile([{
      data: exportData,
      sheet: "POIZON_TOTAL_50_OR",
      stickyRowsCount: 1,
      columns: headers.map((header, index) => ({
        width: index === columns.title ? 54
          : index === columns.image ? 38
            : Math.max(12, Math.min(26, String(header || "").length + 6)),
      })),
    }]).toFile(processedPath);
    return {
      canceled: false,
      ok: true,
      path: processedPath,
      processedPath,
      processedName,
      originalPath: filePath,
      sourceRows: filtered.sourceRows,
      filteredRows: filtered.filteredRows,
      uniqueSpuCount: products.length,
      minimumSales: POIZON_MINIMUM_TOTAL_SALES,
      products,
      brandIntegrity,
    };
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
  ipcMain.handle("excel:export-explorer", async (_event, input = {}) => {
    const safeTitle = String(input.title || "POIZON-상품검색").replace(/[\\/:*?"<>|]/g, "_");
    const result = await dialog.showSaveDialog({
      defaultPath: `${safeTitle}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const rows = Array.isArray(input.products) ? input.products : [];
    const headers = [
      "선택", "상품 이미지", "상품 번호", "영문 상품명", "SPU ID", "브랜드", "카테고리",
      "최근 30일 평균 거래가", "중국 구매자 페이지 노출",
      "총 판매량", "현지 판매자 총 판매량",
      "최근 30일 판매량", "현지 판매자 최근 30일 판매량",
    ];
    const metricCell = (row, numericField, rawField, availableField) => {
      if (row[availableField] === false) return { value: "--" };
      const numericValue = Number(row[numericField]);
      if (!Number.isFinite(numericValue)) return { value: "--" };
      const rawValue = String(row[rawField] ?? "").replace(/,/g, "").trim();
      if (/^<\s*5$/i.test(rawValue)) {
        return { value: numericValue, type: Number, format: '"<5"' };
      }
      if (/^\d+(?:\.\d+)?\+$/.test(rawValue)) {
        return { value: numericValue, type: Number, format: '#,##0"+"' };
      }
      return { value: numericValue, type: Number, format: "#,##0" };
    };
    const data = [
      headers.map((value) => ({ value, fontWeight: "bold", backgroundColor: "#DCECF8" })),
      ...rows.map((row) => [
        { value: row.selected ? "선택" : "" },
        { value: String(row.logoUrl || "") },
        { value: String(row.articleNumber || "") },
        { value: String(row.title || row.name || "") },
        { value: String(row.spuId || "") },
        { value: String(row.brandName || row.brand || "") },
        { value: String(row.categoryName || row.category || "") },
        row.hasPriceData === false
          ? { value: "데이터 없음" }
          : { value: Number(row.averagePrice || 0), type: Number, format: "#,##0" },
        row.hasBuyerExposureData === false
          ? { value: "데이터 없음" }
          : { value: Number(row.buyerExposure || 0), type: Number, format: "#,##0" },
        metricCell(row, "totalSales", "totalSalesRaw", "hasTotalSalesData"),
        metricCell(row, "localTotalSales", "localTotalSalesRaw", "hasLocalTotalSalesData"),
        metricCell(row, "sales30d", "sales30dRaw", "hasSalesData"),
        metricCell(row, "localSales30d", "localSales30dRaw", "hasLocalSalesData"),
      ]),
    ];
    await writeXlsxFile([{
      data,
      sheet: "상품 검색 결과",
      stickyRowsCount: 1,
      columns: [
        { width: 9 }, { width: 36 }, { width: 22 }, { width: 64 }, { width: 16 },
        { width: 20 }, { width: 28 }, { width: 22 }, { width: 22 }, { width: 20 }, { width: 24 },
        { width: 20 }, { width: 28 },
      ],
    }]).toFile(result.filePath);
    return { canceled: false, path: result.filePath };
  });

  configureUpdater();
  createWindow();
  setTimeout(() => void runOneDriveRecoveryBackup(), 1_500);
  setInterval(() => void runOneDriveRecoveryBackup(), 30 * 60 * 1_000).unref?.();
  startBrandExportFolderPolling();
  scheduleWeeklySiteHealthCheck();
  // v2.10.183 operator-requested one-time run: link every pending official
  // mall immediately after the update. The persisted version marker prevents
  // this long-running audit from restarting on every app launch.
  if (app.isPackaged) setTimeout(() => void startImmediateOfficialMallLinkage(), 8_000);
  if (app.isPackaged) scheduleUpdateCheck(5_000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (brandExportPollTimer) clearInterval(brandExportPollTimer);
  if (brandExportMonitorRestartTimer) clearTimeout(brandExportMonitorRestartTimer);
  if (updateCheckTimer) clearTimeout(updateCheckTimer);
  if (updateInstallTimer) clearTimeout(updateInstallTimer);
  if (officialDomainAuditResumeTimer) clearTimeout(officialDomainAuditResumeTimer);
  if (weeklySiteHealthTimer) clearTimeout(weeklySiteHealthTimer);
});
