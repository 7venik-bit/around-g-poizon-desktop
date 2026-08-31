import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, nativeTheme, Notification, safeStorage, session, shell } from "electron";
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
  preferredSellerBrandSearchName,
  sellerBrandAliases,
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
  prioritizeBrandCatalogBySales,
  publicBrandPageCount,
  publicBrandPath,
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
  brandSearchProfileKey,
  recordBrandSearchOutcome,
  selectBrandSearchStrategy,
} from "./services/brand-search-profile.mjs";
import {
  extractSellerBrandApiProducts,
  mergeSellerBrandPages,
  mergeSellerBrandProducts,
  sellerBrandDiagnostics,
} from "./services/seller-brand-sales.mjs";
import {
  analyzeRenderedChannelProducts,
  classifySsgProductEvidence,
  exactArticleIdentityMatch,
  resolveSsgProductClassification,
  detectedRetailer,
  isConsignmentOperatedProduct,
  isOverseasPurchaseProduct,
  isPlatformShoppingProductUrl,
  isTrustedNaverFashionProductCard,
  normalizeRenderedStockEvidence,
  naverFashionTownUrl,
  parseNaverFashionTownChannelCounts,
  queryDomesticProducts,
  sanitizeDomesticProductCode,
  sanitizeDomesticQuery,
} from "./relay/domestic-search.mjs";
import { scoreProductCandidate } from "./services/matcher.mjs";
import { mergeSellerProductsByRank, parseSellerDomNodes } from "./services/seller-dom.mjs";
import { highestQualifiedOptionPrice, optionRowsFromSellerResponses, qualifiedOptionPrices } from "./services/seller-transaction-price.mjs";
import { SELLER_POPULAR_CONDITIONS } from "./services/seller-conditions.mjs";
import { findNewSellerExportJob, findRecentSellerExportJob } from "./services/brand-export-jobs.mjs";
import {
  SITE_HEALTH_TARGETS,
  nextWeeklySiteHealthAt,
  weeklySiteHealthSummary,
} from "./services/weekly-site-health.mjs";

let store;
const { autoUpdater } = pkg;
nativeTheme.themeSource = "light";
// Keep hidden commerce pages fully active. Without these switches Chromium can
// throttle timers and painting for occluded windows, which omits lazy results.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

async function openExternalInChromeTab(rawUrl) {
  const parsed = new URL(String(rawUrl || ""));
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("INVALID_URL");
  if (process.platform !== "win32") {
    await shell.openExternal(parsed.href);
    return { browser: "default" };
  }
  const script = String.raw`
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Google\Chrome\Application\chrome.exe')
)
$chrome = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) { throw 'CHROME_NOT_FOUND' }
Start-Process -FilePath $chrome -ArgumentList @('--new-tab', $env:AROUND_G_EXTERNAL_URL)
`;
  const opened = await new Promise((resolve) => {
    execFile("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle", "Hidden",
      "-Command", script,
    ], {
      windowsHide: true,
      timeout: 10_000,
      env: { ...process.env, AROUND_G_EXTERNAL_URL: parsed.href },
    }, (error) => resolve(!error));
  });
  if (opened) return { browser: "chrome" };
  await shell.openExternal(parsed.href);
  return { browser: "default" };
}

let mainWindow;
let sellerWindow;
let sellerMonitorWindow;
const inventoryWindows = new Set();
const officialInteractiveWindows = new Set();
const domesticLoginWindows = new Map();
const DOMESTIC_SEARCH_PARTITION = "persist:around-g-domestic-search";
const DOMESTIC_PRICE_PARTITION = "persist:around-g-domestic-price";
let domesticSearchGeneration = 0;
const activeDomesticSearchWindows = new Set();
const activeDomesticPriceWindows = new Set();
let domesticPriceLookupQueue = Promise.resolve();

function cancelDomesticSearches() {
  domesticSearchGeneration += 1;
  for (const window of [...activeDomesticSearchWindows]) {
    if (window && !window.isDestroyed()) window.destroy();
  }
  activeDomesticSearchWindows.clear();
  return { ok: true, generation: domesticSearchGeneration };
}

function domesticSearchCanceled(generation) {
  return generation !== domesticSearchGeneration;
}
const DOMESTIC_LOGIN_SOURCES = [
  { id: "musinsa", name: "무신사", url: "https://www.musinsa.com/", domains: ["musinsa.com"] },
  { id: "ssg", name: "SSG·신세계백화점", url: "https://www.ssg.com/", domains: ["ssg.com"] },
  { id: "lotte", name: "롯데온·롯데백화점", url: "https://www.lotteon.com/", domains: ["lotteon.com"] },
  { id: "wconcept", name: "W컨셉", url: "https://www.wconcept.co.kr/", domains: ["wconcept.co.kr"] },
  { id: "okmall", name: "OK몰", url: "https://www.okmall.com/", domains: ["okmall.com"] },
  { id: "sivillage", name: "신세계V·S.I.VILLAGE", url: "https://www.sivillage.com/", domains: ["sivillage.com"] },
  { id: "abcmart", name: "ABC마트", url: "https://abcmart.a-rt.com/", domains: ["a-rt.com"] },
  { id: "kasina", name: "카시나", url: "https://www.kasina.co.kr/", domains: ["kasina.co.kr"] },
  { id: "onthespot", name: "온더스팟", url: "https://www.onthespot.co.kr/", domains: ["onthespot.co.kr"] },
  { id: "folder", name: "폴더", url: "https://www.folderstyle.com/", domains: ["folderstyle.com"] },
  { id: "shoemarker", name: "슈마커", url: "https://www.shoemarker.co.kr/", domains: ["shoemarker.co.kr"] },
  { id: "worksout", name: "웍스아웃·칼하트WIP", url: "https://worksout.co.kr/", domains: ["worksout.co.kr"] },
  { id: "heights", name: "하이츠", url: "https://heights-store.com/", domains: ["heights-store.com"] },
  { id: "eql", name: "EQL", url: "https://www.eqlstore.com/", domains: ["eqlstore.com"] },
  { id: "hfashion", name: "H패션몰", url: "https://www.hfashionmall.com/", domains: ["hfashionmall.com"] },
  { id: "29cm", name: "29CM", url: "https://www.29cm.co.kr/", domains: ["29cm.co.kr"] },
  { id: "nike", name: "나이키 공식몰", url: "https://www.nike.com/kr/", loginUrl: "https://www.nike.com/kr/member/profile/login", domains: ["nike.com"], officialAccount: true },
  { id: "adidas", name: "아디다스 공식몰", url: "https://www.adidas.co.kr/", loginUrl: "https://www.adidas.co.kr/account-login", domains: ["adidas.co.kr"], officialAccount: true },
];
let updateReady = false;
let updateCheckTimer;
let updateInstallTimer;
let updateCheckInFlight = false;
let oneDriveBackupStatus = { state: "checking", message: "프로그램 시작 5분 후 OneDrive 백업을 시작합니다." };
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
// POIZON occasionally retires individual data-center component routes. Enter
// through the stable Seller Center home and use the visible left menu instead
// of booting from a route that can show "Load Component Timeout".
const SELLER_CENTER_URL = "https://seller.poizon.com/";
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
    if (product.brandVerifiedFromCard === false) return false;
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
  return {
    ...data,
    products,
    sources,
    // Profit calculation may use a price from an exact-query card even when
    // the stricter inventory/image confidence pass later hides that card from
    // the sourcing-result list. These candidates have already passed the
    // channel, brand, model/title and domestic-purchase filters above.
    domesticPriceCandidates: discoveredProducts.filter((product) => Number(product?.price || 0) > 0),
  };
}

async function verifyAllStoresWithMusinsaImage(data, input = {}) {
  const products = Array.isArray(data?.products) ? data.products : [];
  const exactMusinsa = products.find((product) =>
    String(product?.sourceStore || product?.store || "") === "무신사"
      && Number(product?.signals?.codeScore || 0) === 1
      && product?.articleConflict !== true
      && product?.signals?.codeConflict !== true
      && /^https?:\/\//i.test(String(product?.url || ""))
      && /^https?:\/\//i.test(String(product?.imageUrl || ""))
  );
  if (!exactMusinsa) return { ...data, musinsaImageVerification: { applied: false } };
  const referenceFingerprint = await imageFingerprint(exactMusinsa.imageUrl).catch(() => null);
  if (!referenceFingerprint) {
    return { ...data, musinsaImageVerification: { applied: false, referenceUrl: exactMusinsa.url } };
  }
  const verified = await Promise.all(products.map(async (product) => {
    const store = String(product?.sourceStore || product?.store || "");
    if (product === exactMusinsa || store === "무신사") {
      return { ...product, musinsaImageReference: true, imageVerificationLabel: "무신사 기준 이미지" };
    }
    const exactCode = Number(product?.signals?.codeScore || 0) === 1
      && product?.articleConflict !== true
      && product?.signals?.codeConflict !== true;
    const imageUrl = String(product?.imageUrl || "");
    if (!exactCode || !/^https?:\/\//i.test(imageUrl)) {
      return { ...product, musinsaImageCompared: false, imageVerificationLabel: "이미지 확인 필요" };
    }
    const candidateFingerprint = await imageFingerprint(imageUrl).catch(() => null);
    const similarity = fingerprintSimilarity(referenceFingerprint, candidateFingerprint);
    if (!Number.isFinite(similarity)) {
      return { ...product, musinsaImageCompared: false, imageVerificationLabel: "이미지 확인 필요" };
    }
    const imageScore = Math.round(similarity * 100);
    return {
      ...product,
      musinsaImageCompared: true,
      musinsaImageScore: imageScore,
      musinsaImageRejected: imageScore < 58,
      imageVerificationLabel: imageScore >= 82 ? "무신사 이미지 높은 일치"
        : imageScore >= 58 ? "무신사 이미지 일치" : "무신사 이미지 불일치",
    };
  }));
  const accepted = verified.filter((product) => product.musinsaImageRejected !== true);
  return {
    ...data,
    products: accepted,
    musinsaImageVerification: {
      applied: true,
      referenceStore: "무신사",
      referenceUrl: exactMusinsa.url,
      referenceImageUrl: exactMusinsa.imageUrl,
      compared: verified.filter((product) => product.musinsaImageCompared === true).length,
      rejected: verified.filter((product) => product.musinsaImageRejected === true).length,
      articleNumber: String(input.articleNumber || ""),
    },
  };
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

function isNaverSecurityVerificationText(value) {
  return /captcha|보안\s*확인|자동\s*입력|로봇|스팸을\s*방지|실제\s*사용자|비정상적인\s*접근/i.test(String(value || ""));
}

async function waitForNaverSecurityVerification(searchWindow) {
  if (!searchWindow || searchWindow.isDestroyed()) return false;
  searchWindow.setTitle("네이버 사람 확인을 완료해 주세요 · Around G");
  searchWindow.setAlwaysOnTop(true);
  searchWindow.show();
  searchWindow.focus();
  mainWindow?.webContents.send("domestic-search:security-required", {
    source: "네이버",
    message: "네이버 사람 확인을 완료하면 상품 검색을 자동으로 계속합니다.",
  });
  const deadline = Date.now() + (10 * 60_000);
  while (Date.now() < deadline) {
    if (searchWindow.isDestroyed()) return false;
    const state = await searchWindow.webContents.executeJavaScript(`JSON.stringify({
      text: String(document.body?.innerText || "").slice(0, 20000),
      url: String(location.href || "")
    })`, true).then(JSON.parse).catch(() => null);
    if (state && !isNaverSecurityVerificationText(state.text)) {
      searchWindow.setAlwaysOnTop(false);
      searchWindow.hide();
      mainWindow?.webContents.send("domestic-search:security-complete", {
        source: "네이버",
        message: "네이버 사람 확인 완료 · 상품 검색을 다시 시작합니다.",
      });
      return true;
    }
    await wait(1_000);
  }
  return false;
}

async function submitOfficialMallSearch(searchWindow, query) {
  const exactQuery = String(query || "").trim();
  if (!exactQuery || !searchWindow || searchWindow.isDestroyed()) return false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const script = `(() => {
      const query = ${JSON.stringify(String(query || ""))};
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const roots = [document];
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll?.('*') || []) {
          if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
        }
      }
      const selectAll = (selector) => roots.flatMap((root) => [...(root.querySelectorAll?.(selector) || [])]);
      window.__aroundGLastSearchAlert = "";
      window.alert = (message) => { window.__aroundGLastSearchAlert = String(message || ""); };
      let input = selectAll('input[type="search"],input[type="text"][placeholder*="검색"],input[placeholder*="검색어"],input[placeholder*="검색"],input[name*="search" i],input[name="q" i],input[name*="query" i],input[name*="keyword" i],input[name*="schWord" i]').find(visible);
      if (!input) {
        const controls = selectAll('header button,header a,button,a,[role="button"]');
        const opener = controls.find((element) => {
          const label = [element.getAttribute("aria-label"), element.getAttribute("title"), element.className, element.textContent].join(" ");
          return visible(element) && /search|검색/i.test(label);
        }) || controls.find((element) => {
          if (!visible(element) || !element.querySelector('svg')) return false;
          const label = [element.outerHTML, element.parentElement?.className].join(" ");
          return /search|검색|magnif|ico[_-]?sch/i.test(label);
        });
        if (!opener) return false;
        opener.scrollIntoView({ block: "center", inline: "nearest" });
        const rect = opener.getBoundingClientRect();
        return { openTarget: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } };
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter ? setter.call(input, query) : (input.value = query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.focus();
      if (!String(input.value || "").trim()) return false;
      const inputRect = input.getBoundingClientRect();
      const inputTarget = { x: Math.round(inputRect.left + inputRect.width / 2), y: Math.round(inputRect.top + inputRect.height / 2) };
      const form = input.form;
      const nearby = input.closest('form,[role="search"],header,section,div');
      const submitCandidates = [
        ...(form?.querySelectorAll('button[type="submit"],input[type="submit"]') || []),
        ...(nearby?.querySelectorAll('button[type="submit"],input[type="submit"],[aria-label*="검색"],[title*="검색"]') || []),
      ];
      const submit = submitCandidates.find((element) => {
        if (!visible(element) || element === input) return false;
        const label = [element.getAttribute('aria-label'), element.getAttribute('title'), element.className, element.textContent, element.outerHTML].join(' ');
        return /search|검색|magnif|ico[_-]?sch/i.test(label) || element.type === 'submit';
      });
      if (submit && visible(submit)) {
        submit.scrollIntoView({ block: "center", inline: "nearest" });
        const rect = submit.getBoundingClientRect();
        return { ready: true, inputTarget, target: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } };
      }
      return { ready: true, inputTarget, enter: true };
    })()`;
    const frames = [searchWindow.webContents.mainFrame, ...searchWindow.webContents.mainFrame.framesInSubtree];
    let submitted = false;
    let opened = false;
    for (const frame of frames) {
      const prepared = await frame.executeJavaScript(script, true).catch(() => false);
      if (prepared?.openTarget) {
        if (frame === searchWindow.webContents.mainFrame) {
          searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: prepared.openTarget.x, y: prepared.openTarget.y });
          searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: prepared.openTarget.x, y: prepared.openTarget.y, button: "left", clickCount: 1 });
          searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: prepared.openTarget.x, y: prepared.openTarget.y, button: "left", clickCount: 1 });
        } else {
          await frame.executeJavaScript(`[...document.querySelectorAll('button,a,[role="button"]')].find((element) => /search|검색/i.test([element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent].join(" ")))?.click()`, true).catch(() => {});
        }
        opened = true;
        break;
      }
      if (!prepared?.ready) continue;
      // Framework-controlled official-mall inputs can ignore a JavaScript-only
      // value assignment. Physically focus the visible field and type the exact
      // query so the site's own key/input handlers receive the same events as a user.
      if (prepared.inputTarget && frame === searchWindow.webContents.mainFrame) {
        searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: prepared.inputTarget.x, y: prepared.inputTarget.y });
        searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: prepared.inputTarget.x, y: prepared.inputTarget.y, button: "left", clickCount: 1 });
        searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: prepared.inputTarget.x, y: prepared.inputTarget.y, button: "left", clickCount: 1 });
        searchWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
        searchWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
        await searchWindow.webContents.insertText(exactQuery);
        await wait(350);
      }
      if (prepared.target && frame === searchWindow.webContents.mainFrame) {
        searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: prepared.target.x, y: prepared.target.y });
        searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: prepared.target.x, y: prepared.target.y, button: "left", clickCount: 1 });
        searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: prepared.target.x, y: prepared.target.y, button: "left", clickCount: 1 });
      } else if (prepared.enter && frame === searchWindow.webContents.mainFrame) {
        searchWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
        searchWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      } else {
        await frame.executeJavaScript(`document.activeElement?.form?.requestSubmit?.() || document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }))`, true).catch(() => {});
      }
      submitted = true;
      break;
    }
    if (submitted) return true;
    await wait(opened ? 900 : 700);
  }
  return false;
}

async function officialMallSearchWasExecuted(searchWindow, query, previousUrl = "") {
  if (!searchWindow || searchWindow.isDestroyed()) return false;
  const state = await searchWindow.webContents.executeJavaScript(`(() => {
    const query = ${JSON.stringify(String(query || ""))};
    const compact = (value) => String(value || "").replace(/[^A-Z0-9가-힣]/gi, "").toUpperCase();
    const expected = compact(query);
    const inputs = [...document.querySelectorAll('input[type="search"],input[name*="search" i],input[name="q" i],input[name*="query" i],input[name*="keyword" i],input[name*="schWord" i]')];
    const inputMatched = inputs.some((input) => compact(input.value).includes(expected));
    const pageText = String(document.body?.innerText || "");
    const pageMatched = expected.length >= 4 && compact(pageText).includes(expected);
    const resultCount = /(?:상품|검색결과)\\s*\\(?\\s*[1-9][\\d,]*\\s*(?:개|건|\\))/i.test(pageText)
      || /총\\s*[1-9][\\d,]*\\s*개/i.test(pageText);
    const productLinks = [...document.querySelectorAll('a[href]')].filter((link) =>
      /\/(?:goods|product|products|pd|item|t)\//i.test(String(link.href || ""))).length;
    return { url: String(location.href || ""), inputMatched, pageMatched, resultCount, productLinks };
  })()`, true).catch(() => null);
  if (!state) return false;
  const urlChanged = Boolean(previousUrl && state.url && state.url !== previousUrl);
  const queryInUrl = (() => {
    try { return decodeURIComponent(state.url).toUpperCase().includes(String(query || "").toUpperCase()); }
    catch { return false; }
  })();
  // Merely seeing the code in the search input/suggestion is not proof that
  // the magnifier was pressed. Require navigation or rendered product results.
  return Boolean(urlChanged || queryInUrl || (state.pageMatched && (state.resultCount || state.productLinks > 0)));
}

async function executeOfficialMallSearch(searchWindow, homepageUrl, query) {
  // One product query must be submitted only once. Re-loading the homepage and
  // entering the same query again made a technical failure look like a fresh
  // negative result and also left the previous search visible in the window.
  const previousUrl = String(searchWindow.webContents.getURL() || homepageUrl);
  const submitted = await submitOfficialMallSearch(searchWindow, query);
  if (!submitted) return false;
  await wait(2_000);
  return officialMallSearchWasExecuted(searchWindow, query, previousUrl);
}

function renderedSearchFailure(reason, searchWindow = null, details = {}) {
  return {
    count: null,
    products: [],
    searchCompleted: false,
    searchSubmitted: details.searchSubmitted === true,
    verificationReason: String(reason || "search_failed"),
    securityVerificationRequired: details.securityVerificationRequired === true,
    loginRequired: details.loginRequired === true,
    resolvedSearchUrl: String(
      details.resolvedSearchUrl
      || (!searchWindow?.isDestroyed?.() ? searchWindow?.webContents?.getURL?.() : "")
      || "",
    ),
  };
}

async function lookupNaverDomesticPrice(input = {}) {
  const articleNumber = sanitizeDomesticProductCode(input?.articleNumber || input?.productCode);
  const brand = sanitizeDomesticQuery(input?.brand);
  const title = sanitizeDomesticQuery(input?.title);
  const query = articleNumber || title;
  if (!query) return { ok: false, message: "가격 검색용 상품번호가 없습니다.", candidates: [] };
  const searchUrl = naverFashionTownUrl("overview", brand, query);
  let priceWindow;
  try {
    await session.fromPartition(DOMESTIC_PRICE_PARTITION).clearCache();
    priceWindow = new BrowserWindow({
      show: false,
      width: 1360,
      height: 900,
      icon: APP_ICON_PATH,
      webPreferences: {
        partition: DOMESTIC_PRICE_PARTITION,
        sandbox: true,
        backgroundThrottling: false,
        paintWhenInitiallyHidden: true,
        offscreen: true,
      },
    });
    activeDomesticPriceWindows.add(priceWindow);
    priceWindow.on("closed", () => activeDomesticPriceWindows.delete(priceWindow));
    priceWindow.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36");
    try {
      await Promise.race([
        priceWindow.loadURL(searchUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error("PRICE_LOOKUP_TIMEOUT")), 20_000)),
      ]);
    } catch (error) {
      const currentUrl = String(priceWindow.webContents.getURL() || "");
      if (!/ERR_ABORTED/i.test(String(error?.message || "")) || !/^https:\/\//i.test(currentUrl)) throw error;
    }
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await wait(attempt === 0 ? 1_500 : 500);
      const snapshot = await priceWindow.webContents.executeJavaScript(`(() => {
        const visible = (element) => {
          if (!element) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const links = [...document.querySelectorAll('a[href*="/window-products/"]')].filter(visible);
        const seen = new Set();
        const productCards = [];
        for (const link of links) {
          const productUrl = String(link.href || "").split("#")[0];
          if (!productUrl || seen.has(productUrl)) continue;
          let card = link;
          let best = link.parentElement;
          for (let depth = 0; card?.parentElement && depth < 7; depth += 1) {
            card = card.parentElement;
            const body = String(card.innerText || "").replace(/\\s+/g, " ").trim();
            const ownedLinks = card.querySelectorAll('a[href*="/window-products/"]').length;
            if (/\\d[\\d,]{2,}\\s*원/.test(body) && body.length < 1800 && ownedLinks <= 3) best = card;
            if (ownedLinks > 3 || body.length >= 1800) break;
          }
          const text = String(best?.innerText || link.innerText || "").replace(/\\s+/g, " ").trim();
          const prices = [...text.matchAll(/([1-9][\\d,]{2,})\\s*원/g)]
            .map((match) => Number(match[1].replace(/,/g, "")))
            .filter((value) => value >= 1_000 && value <= 100_000_000);
          if (!prices.length) continue;
          const image = best?.querySelector('img[src],img[data-src]');
          productCards.push({
            productUrl,
            title: String(link.getAttribute("title") || link.getAttribute("aria-label") || link.innerText || text).replace(/\\s+/g, " ").trim().slice(0, 300),
            text,
            markup: String(best?.outerHTML || "").slice(0, 12000),
            price: Math.min(...prices),
            originalPrice: Math.max(...prices),
            imageUrl: String(image?.currentSrc || image?.src || image?.dataset?.src || ""),
            imageLinkedToProduct: Boolean(image),
          });
          seen.add(productUrl);
        }
        const pageText = String(document.body?.innerText || "").slice(0, 50000);
        return {
          productCards,
          pageText,
          explicitEmpty: /검색\\s*결과가?\\s*없|검색된\\s*상품이\\s*없/i.test(pageText),
        };
      })()`, true).catch(() => null);
      if (!snapshot) continue;
      const analyzed = analyzeRenderedChannelProducts(
        JSON.stringify(snapshot), "네이버 패션타운", articleNumber, brand, title,
      );
      const candidates = (analyzed?.products || [])
        .filter((candidate) => Number(candidate?.price || 0) > 0)
        .sort((left, right) => Number(left.price) - Number(right.price))
        .slice(0, 5);
      if (candidates.length) return { ok: true, searchUrl, candidates };
      if (snapshot.explicitEmpty) return { ok: true, searchUrl, candidates: [], message: "검색 결과에 상품이 없습니다." };
    }
    return { ok: false, searchUrl, candidates: [], message: "일치 상품의 가격을 안전하게 확인하지 못했습니다." };
  } catch (error) {
    const timeout = /PRICE_LOOKUP_TIMEOUT/i.test(String(error?.message || ""));
    return {
      ok: false,
      searchUrl,
      candidates: [],
      message: timeout ? "가격 확인 시간이 초과되었습니다." : "가격 확인 창을 불러오지 못했습니다.",
    };
  } finally {
    if (priceWindow && !priceWindow.isDestroyed()) priceWindow.destroy();
    activeDomesticPriceWindows.delete(priceWindow);
  }
}

async function readNaverFashionTownChannelCounts(searchWindow) {
  if (!searchWindow || searchWindow.isDestroyed()) return null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (attempt > 0) await wait(300);
    const labels = await searchWindow.webContents.executeJavaScript(`(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      return [...document.querySelectorAll('a,button,[role="tab"],[role="button"],label')]
        .filter(visible)
        .map((element) => String(element.textContent || element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim())
        .filter((text) => /브랜드직영몰|공식브랜드|브랜드스토어|백화점|아울렛/.test(text))
        .slice(0, 120);
    })()`, true).catch(() => []);
    const counts = parseNaverFashionTownChannelCounts(labels);
    if (counts) return counts;
  }
  return null;
}

async function ensureNaverOfficialBrandFilter(searchWindow) {
  return clickNaverShoppingChannel(searchWindow, "네이버 공식 브랜드스토어");
}

async function clickNaverShoppingChannel(searchWindow, store) {
  const targetLabel = store === "네이버 공식 브랜드스토어" ? "브랜드직영몰"
    : store === "네이버 백화점" ? "백화점"
      : store === "네이버 아울렛" ? "아울렛" : "";
  if (!targetLabel) return true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const target = await searchWindow.webContents.executeJavaScript(`(() => {
      const label = ${JSON.stringify(targetLabel)};
      const compact = (value) => String(value || "").replace(/\\s+/g, "");
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const selectedEvidence = (element) => {
        let node = element;
        for (let depth = 0; node && depth < 6 && node !== document.body; depth += 1, node = node.parentElement) {
          if (node.getAttribute('aria-selected') === 'true'
            || node.getAttribute('aria-current') === 'page'
            || /(?:^|[\\s_-])(?:selected|active|on)(?:$|[\\s_-])/i.test(String(node.className || ''))) return true;
          const background = String(getComputedStyle(node).backgroundColor || '').match(/\\d+/g)?.map(Number) || [];
          if (background.length >= 3 && background[3] !== 0
            && background[0] + background[1] + background[2] < 300) return true;
        }
        return false;
      };
      const clickSurface = (element) => {
        let node = element;
        for (let depth = 0; node && depth < 6 && node !== document.body; depth += 1, node = node.parentElement) {
          if (node.closest('header,nav')) return null;
          const style = getComputedStyle(node);
          if (/^(?:A|BUTTON|LABEL)$/.test(node.tagName)
            || /^(?:tab|button|link)$/.test(String(node.getAttribute('role') || ''))
            || node.tabIndex >= 0 || typeof node.onclick === 'function' || style.cursor === 'pointer') return node;
        }
        return element;
      };
      // Only the rectangular result-count tabs are valid. The global Naver
      // navigation contains the same labels but has no count; clicking it
      // leaves the search results and clears the product query.
      const candidates = [...document.querySelectorAll('body *')]
        .filter(visible)
        .filter((element) => !element.closest('header,nav'))
        .filter((element) => new RegExp('^' + compact(label) + '[\\\\d,]+개$').test(compact(element.textContent)))
        .sort((left, right) => {
          const score = (element) => (selectedEvidence(element) ? 300 : 0)
            + (clickSurface(element) !== element ? 120 : 0)
            + (element.getBoundingClientRect().top > 180 ? 60 : 0)
            - Math.min(50, element.getBoundingClientRect().width * element.getBoundingClientRect().height / 10_000);
          return score(right) - score(left);
        });
      const element = candidates[0];
      if (!element) return null;
      const surface = clickSurface(element) || element;
      surface.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = surface.getBoundingClientRect();
      return {
        selected: selectedEvidence(element) || selectedEvidence(surface),
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
    })()`, true).catch(() => null);
    if (!target) {
      await wait(700);
      continue;
    }
    if (target.selected) return true;
    searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: target.x, y: target.y });
    searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: target.x, y: target.y, button: "left", clickCount: 1 });
    searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: target.x, y: target.y, button: "left", clickCount: 1 });
    await wait(1_500);
  }
  const state = await searchWindow.webContents.executeJavaScript(`(() => {
    const compact = (value) => String(value || "").replace(/\\s+/g, "");
    const selectedEvidence = (element) => {
      let node = element;
      for (let depth = 0; node && depth < 6 && node !== document.body; depth += 1, node = node.parentElement) {
        if (node.getAttribute('aria-selected') === 'true'
          || node.getAttribute('aria-current') === 'page'
          || /(?:^|[\\s_-])(?:selected|active|on)(?:$|[\\s_-])/i.test(String(node.className || ''))) return true;
        const background = String(getComputedStyle(node).backgroundColor || '').match(/\\d+/g)?.map(Number) || [];
        if (background.length >= 3 && background[3] !== 0
          && background[0] + background[1] + background[2] < 300) return true;
      }
      return false;
    };
    const resultTabs = [...document.querySelectorAll('body *')]
      .filter((element) => !element.closest('header,nav'))
      .filter((element) => new RegExp('^' + ${JSON.stringify(targetLabel)} + '[\\\\d,]+개$').test(compact(element.textContent)));
    const selected = resultTabs.some(selectedEvidence);
    const queryPreserved = /\/window\/search\/fashion-group/i.test(String(location.pathname || ""))
      && /에\\s*대한\\s*패션타운\\s*검색결과/.test(String(document.body?.innerText || ""));
    return JSON.stringify({
      url: String(location.href || ""), selected, queryPreserved,
      missing: /페이지를\\s*찾을\\s*수\\s*없습니다/.test(String(document.body?.innerText || ""))
    });
  })()`, true).then(JSON.parse).catch(() => null);
  return Boolean(state && !state.missing && state.queryPreserved && state.selected);
}

async function clickNaverShoppingHomeMenu(searchWindow) {
  if (!searchWindow || searchWindow.isDestroyed()) return false;
  let target = null;
  for (let attempt = 0; attempt < 20 && !target; attempt += 1) {
    target = await searchWindow.webContents.executeJavaScript(`(() => {
      const compact = (value) => String(value || "").replace(/\\s+/g, "").trim();
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const candidates = [...document.querySelectorAll('nav a,a,[role="link"],button,[role="button"]')]
        .filter(visible)
        .filter((element) => compact(element.textContent) === "쇼핑")
        .sort((left, right) => {
          const score = (element) => (/shopping\\.naver\\.com\\/ns\\/home/i.test(String(element.href || element.getAttribute("href") || "")) ? 300 : 0)
            + (element.closest('nav,[aria-label*="서비스"]') ? 100 : 0)
            + (element.tagName === "A" ? 50 : 0);
          return score(right) - score(left);
        });
      const element = candidates[0];
      if (!element) return null;
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        href: String(element.href || element.getAttribute("href") || ""),
      };
    })()`, true).catch(() => null);
    if (!target) await wait(500);
  }
  if (!target) return false;
  searchWindow.webContents.focus();
  searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: target.x, y: target.y });
  searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: target.x, y: target.y, button: "left", clickCount: 1 });
  searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: target.x, y: target.y, button: "left", clickCount: 1 });
  // Naver currently opens Shopping in a new tab. Electron's popup handler can
  // receive that request before the original window commits its navigation,
  // leaving the visible window on Naver's AI search page. Preserve the real
  // mouse click first, then continue with the exact href owned by that clicked
  // Shopping button only when the visible window did not move.
  await wait(1_200);
  const afterPhysicalClickUrl = String(searchWindow.webContents.getURL() || "");
  if (!/^https:\/\/shopping\.naver\.com\/ns\/home(?:[/?#]|$)/i.test(afterPhysicalClickUrl)
    && /^https:\/\/shopping\.naver\.com\/ns\/home(?:[/?#]|$)/i.test(String(target.href || ""))) {
    await searchWindow.loadURL(target.href).catch(() => {});
  }
  // Naver opens Shopping in a new tab. setWindowOpenHandler redirects that
  // request into this visible verification window, so wait for the real
  // Shopping home document instead of guessing a direct commerce URL.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(attempt === 0 ? 1_000 : 500);
    const state = await searchWindow.webContents.executeJavaScript(`(() => ({
      url: String(location.href || ""),
      ready: Boolean(document.documentElement && document.body),
      securityRequired: /captcha|보안\\s*확인|스팸을\\s*방지|실제\\s*사용자|비정상적인\\s*접근/i.test(String(document.body?.innerText || ""))
    }))()`, true).catch(() => null);
    if (state?.securityRequired) return false;
    if (state?.ready && /^https:\/\/shopping\.naver\.com\/ns\/home(?:[/?#]|$)/i.test(state.url)) return true;
  }
  return false;
}

async function clickNaverFashionTownMenu(searchWindow) {
  if (!searchWindow || searchWindow.isDestroyed()) return false;
  let target = null;
  for (let attempt = 0; attempt < 30 && !target; attempt += 1) {
    target = await searchWindow.webContents.executeJavaScript(`(() => {
      const compact = (value) => String(value || "").replace(/\\s+/g, "").trim();
      const fashionLabels = ["패션타운"];
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const candidates = [...document.querySelectorAll('header a,nav a,a,button,[role="button"]')]
        .filter(visible)
        .map((element) => {
          const label = compact(element.textContent);
          const matchedLabel = fashionLabels.find((fashionLabel) => label.includes(fashionLabel));
          return { element, label, matchedLabel };
        })
        .filter((candidate) => candidate.matchedLabel)
        .sort((left, right) => {
          const score = (candidate) => (candidate.label === candidate.matchedLabel ? 500 : 0)
            + (/fashion|window/i.test(String(candidate.element.getAttribute("href") || "")) ? 200 : 0)
            + (candidate.element.closest("nav") ? 100 : 0)
            + (candidate.element.closest("header") ? 50 : 0)
            - candidate.label.length;
          return score(right) - score(left);
        });
      const selected = candidates[0];
      const element = selected?.element;
      if (!element || !selected?.matchedLabel) return null;
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        label: selected.matchedLabel,
        href: String(element.href || element.getAttribute("href") || ""),
      };
    })()`, true).catch(() => null);
    if (!target) await wait(500);
  }
  if (!target) return false;
  searchWindow.webContents.focus();
  searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: target.x, y: target.y });
  searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: target.x, y: target.y, button: "left", clickCount: 1 });
  searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: target.x, y: target.y, button: "left", clickCount: 1 });
  await wait(1_200);
  const afterFashionClickUrl = String(searchWindow.webContents.getURL() || "");
  if (!/fashion|style/i.test(afterFashionClickUrl)
    && /^https:\/\/shopping\.naver\.com\//i.test(String(target.href || ""))
    && /fashion|style/i.test(String(target.href || ""))) {
    await searchWindow.loadURL(target.href).catch(() => {});
  }
  // Navigation and search activation are separate steps. Naver changes both
  // the route and the search-control markup, so entering Fashion Town must not
  // depend on a writable input already existing. Either visible service name
  // is sufficient, and the next function opens/re-queries the real input.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(attempt === 0 ? 1_000 : 500);
    const ready = await searchWindow.webContents.executeJavaScript(`(() => {
      const compact = (value) => String(value || "").replace(/\\s+/g, "").trim();
      const fashionLabels = ["패션타운"];
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const routeOrTitleMatched = /fashion|style/i.test(String(location.pathname || ""))
        || fashionLabels.some((label) => compact(document.title).includes(label));
      const selectedMenuMatched = [...document.querySelectorAll('header a,nav a,a,button,[role="button"],[aria-current],[aria-selected="true"]')]
        .filter(visible)
        .some((element) => {
          const labelMatched = fashionLabels.some((label) => compact(element.textContent).includes(label));
          const selected = element.getAttribute("aria-current") === "page"
            || element.getAttribute("aria-selected") === "true"
            || /(?:^|[\\s_-])(?:selected|active|on)(?:$|[\\s_-])/i.test(String(element.className || ""));
          return labelMatched && selected;
        });
      const searchScopeMatched = [...document.querySelectorAll('form button,form [role="button"],[role="search"] button,[role="search"] [role="button"]')]
        .filter(visible)
        .some((element) => fashionLabels.some((label) => compact(element.textContent).includes(label)));
      return Boolean(routeOrTitleMatched || selectedMenuMatched || searchScopeMatched);
    })()`, true).catch(() => false);
    if (ready) return true;
  }
  return false;
}

async function openNaverFashionTownSearchInput(searchWindow) {
  if (!searchWindow || searchWindow.isDestroyed()) return null;
  let launcher = null;
  for (let attempt = 0; attempt < 20 && !launcher; attempt += 1) {
    launcher = await searchWindow.webContents.executeJavaScript(`(() => {
      const compact = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const inputs = [...document.querySelectorAll('input:not([type="password"]),textarea,[role="searchbox"],[contenteditable="true"]')]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const placeholder = compact(element.getAttribute("placeholder") || element.getAttribute("aria-label") || element.getAttribute("data-placeholder"));
          // Naver main/Shopping can expose an AI search field in the same top
          // area. Only Fashion Town's own "상품명 또는 브랜드" field is valid.
          const fashionInput = /상품명\\s*또는\\s*브랜드/.test(placeholder);
          const score = fashionInput
            ? 500 + (rect.top < 220 ? 200 : 0) + (element.closest('header,form,[role="search"]') ? 100 : 0) + (rect.width >= 250 ? 50 : 0)
            : -1;
          return { element, rect, score };
        });
      const controls = [...document.querySelectorAll('button,a,[role="button"],[role="searchbox"],label')]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const label = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("data-placeholder"), element.className, element.outerHTML].join(" ");
          const fashionLauncher = /패션타운.*?(?:상품명\\s*또는\\s*브랜드|상품을\\s*검색)|상품명\\s*또는\\s*브랜드/i.test(label);
          const score = fashionLauncher
            ? 500 + (rect.top < 220 ? 150 : 0) + (rect.left > window.innerWidth * 0.55 ? 50 : 0)
            : -1;
          return { element, rect, score };
        });
      const selected = [...inputs, ...controls]
        .filter((candidate) => candidate.score >= 300)
        .sort((left, right) => right.score - left.score)[0];
      if (!selected) return null;
      selected.element.scrollIntoView({ block: "center", inline: "center" });
      const rect = selected.element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`, true).catch(() => null);
    if (!launcher) await wait(400);
  }
  if (!launcher) return null;
  searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: launcher.x, y: launcher.y });
  searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: launcher.x, y: launcher.y, button: "left", clickCount: 1 });
  searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: launcher.x, y: launcher.y, button: "left", clickCount: 1 });

  // Clicking the desktop header field opens Naver's search layer.  On the
  // compact layout the first click is the top-right magnifier and creates the
  // same real input.  Re-query after the SPA render instead of retaining the
  // launcher element, which Naver replaces during this transition.
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await wait(attempt === 0 ? 350 : 250);
    const inputTarget = await searchWindow.webContents.executeJavaScript(`(() => {
      const compact = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const selected = [...document.querySelectorAll('input:not([type="password"]),textarea,[role="searchbox"],[contenteditable="true"]')]
        .filter((element) => visible(element)
          && !element.disabled
          && !element.readOnly
          && (element.matches('input,textarea') || element.isContentEditable || element.getAttribute('role') === 'searchbox'))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const placeholder = compact(element.getAttribute("placeholder") || element.getAttribute("aria-label") || element.getAttribute("data-placeholder"));
          const fashionInput = /상품명\\s*또는\\s*브랜드/.test(placeholder);
          const score = fashionInput
            ? 500 + (document.activeElement === element ? 350 : 0) + (rect.top < 250 ? 200 : 0)
              + (element.closest('header,form,[role="search"],[role="dialog"],[class*="layer" i],[class*="search" i]') ? 100 : 0)
              + (rect.width >= 250 ? 50 : 0)
            : -1;
          return { element, score };
        })
        .filter((candidate) => candidate.score >= 300)
        .sort((left, right) => right.score - left.score)[0]?.element;
      if (!selected) return null;
      selected.scrollIntoView({ block: "center", inline: "center" });
      const rect = selected.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`, true).catch(() => null);
    if (inputTarget) return inputTarget;
  }
  return null;
}

async function typeNaverQueryLikeUser(searchWindow, inputTarget, exactQuery) {
  if (!inputTarget) return false;
  const inputSelector = 'input:not([type="password"]),textarea,[role="searchbox"],[contenteditable="true"]';
  const readValue = () => searchWindow.webContents.executeJavaScript(`(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const valueOf = (element) => String(element?.matches?.('input,textarea') ? element.value || "" : element?.textContent || "");
    const active = document.activeElement;
    if (active?.matches?.(${JSON.stringify(inputSelector)}) && visible(active)) return valueOf(active);
    const input = [...document.querySelectorAll(${JSON.stringify(inputSelector)})]
      .find((element) => visible(element) && valueOf(element));
    return valueOf(input);
  })()`, true).catch(() => "");
  const waitForInputValue = async (expectedValue) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (await readValue() === expectedValue) return true;
      await wait(100);
    }
    return false;
  };

  // Naver replaces and synchronizes its React search field while it is being
  // edited. Type at a visible human pace and wait for each character to reach
  // the controlled input before sending the next one.
  for (const keyDelay of [220, 360]) {
    searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: inputTarget.x, y: inputTarget.y });
    searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: inputTarget.x, y: inputTarget.y, button: "left", clickCount: 1 });
    searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: inputTarget.x, y: inputTarget.y, button: "left", clickCount: 1 });
    await wait(450);
    searchWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
    searchWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
    searchWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
    searchWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
    await wait(300);

    let prefixOk = true;
    for (let index = 0; index < exactQuery.length; index += 1) {
      const character = exactQuery[index];
      searchWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: character });
      searchWindow.webContents.sendInputEvent({ type: "char", keyCode: character });
      searchWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: character });
      await wait(keyDelay);
      if (!await waitForInputValue(exactQuery.slice(0, index + 1))) {
        prefixOk = false;
        break;
      }
    }
    if (prefixOk && await waitForInputValue(exactQuery)) {
      // Keep the completed value visible and let Naver finish rendering its
      // suggestion/search layer before locating the magnifier.
      await wait(2_000);
      if (await readValue() === exactQuery) return true;
    }
  }
  return false;
}

async function waitForNaverSearchResultsStable(searchWindow, query) {
  if (!searchWindow || searchWindow.isDestroyed()) return false;
  const exactQuery = String(query || "").trim();
  if (!exactQuery) return false;
  const deadline = Date.now() + 15_000;
  let previousSignature = "";
  let stableSamples = 0;
  while (Date.now() < deadline) {
    if (searchWindow.isDestroyed()) return false;
    const pageScript = `(() => {
      const query = ${JSON.stringify(exactQuery)};
      const compact = (value) => String(value || "").replace(/[^A-Z0-9가-힣]/gi, "").toUpperCase();
      const expected = compact(query);
      const bodyText = String(document.body?.innerText || "");
      const queryVisible = expected && (compact(bodyText).includes(expected)
        || [...document.querySelectorAll('input:not([type="password"]),textarea,[role="searchbox"]')]
          .some((input) => compact(input.value || input.textContent).includes(expected)));
      const productLinks = [...document.querySelectorAll('a[href*="window-products"],a[href*="/products/"]')]
        .map((link) => ({ href: String(link.href || ""), text: String(link.innerText || link.textContent || "").trim() }))
        .filter((item) => /^https?:\/\//i.test(item.href));
      const unique = [];
      const seen = new Set();
      for (const item of productLinks) {
        if (seen.has(item.href)) continue;
        seen.add(item.href);
        unique.push(item);
        if (unique.length >= 24) break;
      }
      const noResult = /검색된\s*상품이\s*없습니다|검색\s*결과가\s*없습니다|상품이\s*없습니다|검색결과\s*없음/i.test(bodyText);
      const securityRequired = /captcha|보안\s*확인|자동\s*입력|로봇|스팸을\s*방지|실제\s*사용자|비정상적인\s*접근/i.test(bodyText);
      const signature = unique.map((item) => item.href + "|" + compact(item.text).slice(0, 80)).join("||");
      return { queryVisible, noResult, securityRequired, cardCount: unique.length, signature };
    })()`;
    const state = await searchWindow.webContents.executeJavaScript(pageScript, true).catch(() => null);
    if (!state || state.securityRequired) return false;
    const ready = state.queryVisible === true && (state.cardCount > 0 || state.noResult === true);
    const signature = state.noResult === true ? "__NO_RESULT__" : String(state.signature || "");
    if (ready && signature && signature === previousSignature) stableSamples += 1;
    else stableSamples = ready && signature ? 1 : 0;
    previousSignature = ready ? signature : "";
    if (stableSamples >= 4) {
      // Keep the rendered result visible briefly after DOM stability so lazy
      // card metadata and images can finish committing before extraction.
      await wait(1_500);
      return true;
    }
    await wait(500);
  }
  return false;
}

async function submitNaverShoppingSearch(searchWindow, query) {
  const exactQuery = String(query || "").trim();
  if (!exactQuery || !searchWindow || searchWindow.isDestroyed()) return false;
  searchWindow.webContents.focus();
  const previousUrl = String(searchWindow.webContents.getURL() || "");
  const inputTarget = await openNaverFashionTownSearchInput(searchWindow);
  if (!inputTarget) return false;
  const inputVerified = await typeNaverQueryLikeUser(searchWindow, inputTarget, exactQuery);
  if (!inputVerified) return false;

  // The suggestion layer can replace the search button after the final input
  // event. Re-query its live coordinates instead of closing the window after
  // one stale lookup.
  let submitTarget = null;
  for (let attempt = 0; attempt < 20 && !submitTarget; attempt += 1) {
    submitTarget = await searchWindow.webContents.executeJavaScript(`(() => {
    const compact = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const valueOf = (element) => String(element?.matches?.('input,textarea') ? element.value || "" : element?.textContent || "");
    const input = [...document.querySelectorAll('input:not([type="password"]),textarea,[role="searchbox"],[contenteditable="true"]')]
      .find((element) => visible(element) && compact(valueOf(element)) === compact(${JSON.stringify(exactQuery)}));
    if (!input) return null;
    const scope = input.closest('form,[role="search"],[role="dialog"],[class*="layer" i],[class*="search" i]')
      || input.parentElement?.parentElement?.parentElement || document;
    const inputRect = input.getBoundingClientRect();
    const rawControls = [
      ...scope.querySelectorAll('button,[role="button"],input[type="submit"],a,svg'),
      ...document.querySelectorAll('button,[role="button"],input[type="submit"],svg')
    ];
    const controls = [...new Set(rawControls.map((element) =>
      element.matches('svg') ? element.closest('button,[role="button"],a') || element : element))];
    const button = controls.filter(visible)
      .map((element) => {
        const label = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title"), element.className, element.outerHTML].join(" ");
        const compactLabel = compact(label);
        const rect = element.getBoundingClientRect();
        const explicitSearch = /검색|search|magnif|ico[_-]?(?:sch|search)/i.test(label);
        const typeSubmit = String(element.getAttribute("type") || "").toLowerCase() === "submit";
        const clearOrToggle = /입력(?:내용)?삭제|지우기|닫기|clear|delete|remove|close|dropdown|arrow|down|toggle|autocomplete|fold|unfold|expand|collapse/i.test(compactLabel)
          || element.hasAttribute("aria-expanded")
          || Boolean(element.getAttribute("aria-haspopup"));
        const sameRow = Math.abs((rect.top + rect.height / 2) - (inputRect.top + inputRect.height / 2)) < 60;
        const horizontalGap = rect.left - inputRect.right;
        const rightAdjacent = sameRow && horizontalGap >= -35 && horizontalGap <= 160
          && rect.right > inputRect.right - 10
          && rect.width <= 120 && rect.height <= 120;
        const insideRightEdge = sameRow
          && rect.left >= inputRect.left + inputRect.width * 0.72
          && rect.right <= inputRect.right + 120
          && rect.width <= 120 && rect.height <= 120;
        // Naver places clear, autocomplete-toggle and search controls in that
        // order. The magnifier is the farthest-right eligible control.
        const rightmostPriority = Math.max(0, Math.min(220, rect.right - inputRect.right)) * 12;
        const score = (explicitSearch ? 900 : 0)
          + (typeSubmit ? 700 : 0)
          + (rightAdjacent ? 600 : 0)
          + (insideRightEdge ? 450 : 0)
          + rightmostPriority;
        return {
          element,
          score,
          eligible: !clearOrToggle && (explicitSearch || typeSubmit || rightAdjacent || insideRightEdge)
        };
      })
      .filter((candidate) => candidate.eligible)
      .sort((left, right) => right.score - left.score)[0]?.element;
    if (button) {
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), fallback: false };
    }
    // Last physical fallback for Naver builds whose magnifier has no button,
    // role, accessible name, or searchable class. Click the right edge of the
    // smallest search container surrounding the verified input.
    let container = input.parentElement;
    let containerRect = null;
    for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
      const rect = container.getBoundingClientRect();
      if (!containerRect && rect.width >= inputRect.width && rect.width <= inputRect.width + 220 && rect.height <= 120) {
        containerRect = rect;
      }
    }
    if (!containerRect) return null;
    return {
      x: Math.round(Math.min(window.innerWidth - 8, containerRect.right - 24)),
      y: Math.round(inputRect.top + inputRect.height / 2),
      fallback: true
    };
    })()`, true).catch(() => null);
    if (!submitTarget) await wait(300);
  }
  if (!submitTarget) return false;
  searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: submitTarget.x, y: submitTarget.y });
  // Make the hand-off visible: completed code, pointer movement, then click.
  await wait(800);
  searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: submitTarget.x, y: submitTarget.y, button: "left", clickCount: 1 });
  searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: submitTarget.x, y: submitTarget.y, button: "left", clickCount: 1 });

  for (let attempt = 0; attempt < 24; attempt += 1) {
    await wait(attempt === 0 ? 1_500 : 500);
    const state = await searchWindow.webContents.executeJavaScript(`JSON.stringify({
      url: String(location.href || ""),
      text: String(document.body?.innerText || "").slice(0, 30000),
      resultMatched: [...document.querySelectorAll('a[href*="window-products"],a[href*="/products/"]')].some((link) => {
        const compact = (value) => String(value || "").replace(/[^A-Z0-9가-힣]/gi, "").toUpperCase();
        const expected = compact(${JSON.stringify(exactQuery)});
        const card = link.closest('li,article,[class*="product" i],[class*="item" i],div');
        return expected.length >= 4 && compact([link.href, link.textContent, card?.innerText].join(" ")).includes(expected);
      }),
      noResult: /검색\\s*결과가\\s*없|상품을\\s*찾을\\s*수\\s*없|일치하는\\s*상품이\\s*없/.test(String(document.body?.innerText || ""))
    })`, true).then(JSON.parse).catch(() => null);
    const urlChanged = Boolean(state?.url && state.url !== previousUrl);
    const compact = (value) => String(value || "").replace(/[^A-Z0-9가-힣]/gi, "").toUpperCase();
    const queryInUrl = (() => {
      try { return compact(decodeURIComponent(state?.url || "")).includes(compact(exactQuery)); }
      catch { return false; }
    })();
    const queryVisibleInPage = compact(state?.text || "").includes(compact(exactQuery));
    if (state && !/페이지를\s*찾을\s*수\s*없습니다/.test(state.text)
      && ((urlChanged && queryInUrl)
        || state.resultMatched === true
        || (state.noResult === true && queryVisibleInPage))) return await waitForNaverSearchResultsStable(searchWindow, exactQuery);
  }
  return false;
}

async function openRenderedSizeOptions(searchWindow) {
  if (!searchWindow || searchWindow.isDestroyed()) return false;
  let clicked = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const target = await searchWindow.webContents.executeJavaScript(`(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const controls = [...document.querySelectorAll('select,button,[role="button"],[role="combobox"],[aria-haspopup="listbox"]')]
        .filter(visible)
        .filter((element) => {
          const label = [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("placeholder"), element.className].join(" ");
          return /사이즈|size|옵션|option|선택/i.test(label)
            && !/구매|장바구니|결제|buy|cart/i.test(label);
        });
      const element = controls[${attempt}] || controls[0];
      if (!element) return null;
      element.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`, true).catch(() => null);
    if (!target) break;
    searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: target.x, y: target.y });
    searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: target.x, y: target.y, button: "left", clickCount: 1 });
    searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: target.x, y: target.y, button: "left", clickCount: 1 });
    clicked = true;
    await wait(600);
  }
  return clicked;
}

async function clickRenderedProductCard(searchWindow, productUrl, searchResultsUrl = "") {
  if (!searchWindow || searchWindow.isDestroyed()) return false;
  const expectedUrl = String(productUrl || "").split("#")[0];
  if (!/^https?:\/\//i.test(expectedUrl)) return false;
  const resultsUrl = String(searchResultsUrl || "");
  const currentUrl = String(searchWindow.webContents.getURL() || "");
  if (resultsUrl && currentUrl !== resultsUrl) {
    await Promise.race([
      searchWindow.loadURL(resultsUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error("SEARCH_RESULTS_RELOAD_TIMEOUT")), 15_000)),
    ]).catch(() => {});
    await wait(1_200);
  }
  const cardFound = await searchWindow.webContents.executeJavaScript(`(() => {
    const expected = ${JSON.stringify(expectedUrl)};
    const clean = (value) => String(value || "").split("#")[0];
    const links = [...document.querySelectorAll("a[href]")];
    const link = links.find((candidate) => clean(candidate.href) === expected)
      || links.find((candidate) => {
        try {
          const left = new URL(clean(candidate.href));
          const right = new URL(expected);
          return left.origin === right.origin && left.pathname === right.pathname;
        } catch { return false; }
      });
    if (!link) return false;
    link.scrollIntoView({ block: "center", inline: "center" });
    return true;
  })()`, true).catch(() => false);
  if (!cardFound) return false;
  // scrollIntoView can move a responsive card after the first layout pass.
  // Wait for that movement to settle, then measure the actual clickable link.
  await wait(650);
  const target = await searchWindow.webContents.executeJavaScript(`(() => {
    const expected = ${JSON.stringify(expectedUrl)};
    const clean = (value) => String(value || "").split("#")[0];
    const links = [...document.querySelectorAll("a[href]")];
    const link = links.find((candidate) => clean(candidate.href) === expected)
      || links.find((candidate) => {
        try {
          const left = new URL(clean(candidate.href));
          const right = new URL(expected);
          return left.origin === right.origin && left.pathname === right.pathname;
        } catch { return false; }
      });
    if (!link) return null;
    const rect = link.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(rect.height / 2, 180)) };
  })()`, true).catch(() => null);
  if (!target) return false;
  const bounds = searchWindow.getContentBounds();
  const clicked = await moveWindowsCursorAndClick(
    bounds.x + target.x,
    bounds.y + target.y,
    650,
  );
  if (!clicked.ok) return false;
  await wait(2_000);
  const openedUrl = String(searchWindow.webContents.getURL() || "").split("#")[0];
  if (openedUrl === expectedUrl) return true;
  try {
    const opened = new URL(openedUrl);
    const expected = new URL(expectedUrl);
    return opened.origin === expected.origin && opened.pathname === expected.pathname;
  } catch { return false; }
}

async function openOfficialMallInternalSearch(homepageUrl, query) {
  const homepage = new URL(String(homepageUrl || ""));
  if (!["https:", "http:"].includes(homepage.protocol)) throw new Error("INVALID_URL");
  const exactQuery = String(query || "").trim();
  if (!exactQuery) throw new Error("SEARCH_QUERY_REQUIRED");
  const searchWindow = new BrowserWindow({
    title: `공식몰 상품 검색 · ${exactQuery}`,
    width: 1320,
    height: 900,
    show: true,
    autoHideMenuBar: true,
    icon: APP_ICON_PATH,
    webPreferences: {
      partition: DOMESTIC_SEARCH_PARTITION,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  officialInteractiveWindows.add(searchWindow);
  searchWindow.on("closed", () => officialInteractiveWindows.delete(searchWindow));
  searchWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) searchWindow.loadURL(url).catch(() => {});
    return { action: "deny" };
  });
  await searchWindow.loadURL(homepage.href);
  searchWindow.show();
  searchWindow.focus();
  const login = await ensureOfficialAccountLogin(searchWindow, homepage.href);
  if (!login.ok) return { ok: false, submitted: false, loginRequired: true, reason: login.reason };
  if (login.required) await searchWindow.loadURL(homepage.href).catch(() => {});
  const submitted = await executeOfficialMallSearch(searchWindow, homepage.href, exactQuery);
  if (!submitted) {
    searchWindow.setTitle(`공식몰 돋보기를 눌러 ${exactQuery}을(를) 검색해 주세요`);
  }
  return { ok: true, submitted };
}

async function renderedSearchSourceResult(source, articleNumber, brand = "", title = "", securityRetry = 0, searchAttempt = null, sharedNaverSession = null, generation = domesticSearchGeneration) {
  if (domesticSearchCanceled(generation)) throw new Error("DOMESTIC_SEARCH_CANCELED");
  const interactiveOfficialSearch = source.store === "브랜드 공식몰"
    && !String(source.officialProductUrl || "")
    && /^https:\/\//i.test(String(source.homepageUrl || ""));
  const interactiveSiteSearch = interactiveOfficialSearch || source.interactiveSearch === true;
  const url = String(searchAttempt?.url || source.officialProductUrl || (interactiveOfficialSearch ? source.homepageUrl : source.searchUrl) || "");
  if (!/^https:\/\//i.test(url)) return { count: Number(source.count || 0), products: [] };
  const naverPortalSource = /^네이버\s/.test(String(source.store || ""));
  // NAVER_SINGLE_OVERVIEW_SEARCH_V1: one Fashion Town overview search is captured once, then each card is classified locally.
  const ssgChannelSource = /^SSG(?:\s|$)/.test(String(source.store || ""));
  const musinsaSource = String(source.store || "") === "무신사";
  let naverChannelCounts = null;
  let searchWindow;
  let musinsaSettledEmpty = false;
  try {
    const reuseNaverSearch = Boolean(naverPortalSource
      && sharedNaverSession?.window
      && !sharedNaverSession.window.isDestroyed()
      && sharedNaverSession.resultsUrl
      && sharedNaverSession.channelCounts);
    // The overview page already contains brand-store, department and outlet results.
    // Never click those channel tabs after the product query has been submitted.
    const naverChannelClickRequired = false;
    if (reuseNaverSearch) {
      // Reuse the exact DOM produced by the first query. Reloading the result URL
      // caused Naver to render/transition again and made one user search look like
      // several searches even though the query text was not retyped.
      searchWindow = sharedNaverSession.window;
      naverChannelCounts = sharedNaverSession.channelCounts;
      await wait(250);
    } else {
      searchWindow = new BrowserWindow({
        show: false,
        icon: APP_ICON_PATH,
        width: naverPortalSource ? 1480 : 1100,
        height: naverPortalSource ? 900 : 800,
        webPreferences: {
          partition: DOMESTIC_SEARCH_PARTITION,
          sandbox: true,
          backgroundThrottling: false,
          paintWhenInitiallyHidden: true,
          offscreen: true,
        },
      });
      activeDomesticSearchWindows.add(searchWindow);
      searchWindow.on("closed", () => activeDomesticSearchWindows.delete(searchWindow));
      // The search viewport stays full-sized but is rendered offscreen. It is
      // only shown by waitForNaverSecurityVerification when human action is required.
      searchWindow.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
        if (/^https?:\/\//i.test(String(popupUrl || ""))) searchWindow.loadURL(popupUrl).catch(() => {});
        return { action: "deny" };
      });
      searchWindow.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36");
      const initialUrl = naverPortalSource ? "https://www.naver.com/" : url;
      try {
        await Promise.race([
          searchWindow.loadURL(initialUrl),
          new Promise((_, reject) => setTimeout(() => reject(new Error("SEARCH_PAGE_TIMEOUT")), 30_000)),
        ]);
      } catch (error) {
        // Commerce SPAs frequently abort the first navigation while replacing it
        // with their own redirect. Continue only when that replacement produced a
        // real HTTPS document; every other load error remains an explicit failure.
        const aborted = /ERR_ABORTED/i.test(String(error?.message || ""));
        const currentUrl = String(searchWindow.webContents.getURL() || "");
        const documentReady = aborted && /^https:\/\//i.test(currentUrl)
          ? await searchWindow.webContents.executeJavaScript(
            `Boolean(document.documentElement && String(location.href || "").startsWith("https://"))`,
            true,
          ).catch(() => false)
          : false;
        // Musinsa can finish painting a valid search result and then abort a
        // secondary SPA navigation. Electron rejects loadURL in that case even
        // though the user-visible result is already authoritative. Accept the
        // document only when it is the exact Musinsa search URL and either
        // product cards or the site's explicit empty-result message are visible.
        const expectedMusinsaQuery = sanitizeDomesticProductCode(articleNumber)
          || sanitizeDomesticQuery(searchAttempt?.query || source.searchQuery || title);
        let recoveredMusinsaResult = false;
        if (musinsaSource) {
          // The rejected navigation event can arrive just before React commits
          // the final DOM. Give that already-running render a short bounded
          // window; this never submits or repeats the search.
          for (let attempt = 0; attempt < 8 && !recoveredMusinsaResult; attempt += 1) {
            if (attempt > 0) await wait(500);
            recoveredMusinsaResult = await searchWindow.webContents.executeJavaScript(`(() => {
              const current = new URL(String(location.href || ""));
              const expected = ${JSON.stringify(expectedMusinsaQuery)};
              const actual = String(current.searchParams.get("keyword") || "").trim();
              const pageText = String(document.body?.innerText || "").slice(0, 50000);
              const exactSearch = /(^|\\.)musinsa\\.com$/i.test(current.hostname)
                && current.pathname.includes("/search/goods")
                && actual.toUpperCase() === expected.toUpperCase();
              const cards = document.querySelectorAll('a[href*="/products/"],a[href*="/product/"]').length;
              const explicitEmpty = /검색\\s*결과가?\\s*(?:없|0)|상품이?\\s*(?:없|0)|검색된\\s*상품이\\s*없/i.test(pageText);
              return Boolean(exactSearch && document.documentElement && (cards > 0 || explicitEmpty));
            })()`, true).catch(() => false);
          }
        }
        if (!documentReady && !recoveredMusinsaResult) throw error;
      }
      if (interactiveOfficialSearch) {
        const login = await ensureOfficialAccountLogin(searchWindow, String(source.homepageUrl || url));
        if (!login.ok) return renderedSearchFailure("login_required", searchWindow, { loginRequired: true });
        if (login.required) await searchWindow.loadURL(String(source.homepageUrl || url)).catch(() => {});
      }
      if (interactiveSiteSearch) {
        const searchQuery = interactiveOfficialSearch
          ? sanitizeDomesticProductCode(articleNumber) || sanitizeDomesticQuery(title)
          : String(searchAttempt?.query || source.searchQuery || articleNumber || title || "").trim();
        if (!searchQuery) return renderedSearchFailure("search_query_missing", searchWindow);
        if (naverPortalSource) {
          const shoppingHomeOpened = await clickNaverShoppingHomeMenu(searchWindow);
          if (!shoppingHomeOpened) {
            const pageText = await searchWindow.webContents.executeJavaScript(
              `String(document.body?.innerText || "").slice(0, 20000)`,
              true,
            ).catch(() => "");
            const securityRequired = isNaverSecurityVerificationText(pageText);
            if (securityRequired && securityRetry < 1) {
              const verified = await waitForNaverSecurityVerification(searchWindow);
              if (verified) {
                searchWindow.destroy();
                searchWindow = null;
                return renderedSearchSourceResult(source, articleNumber, brand, title, securityRetry + 1, searchAttempt, sharedNaverSession, generation);
              }
            }
            return renderedSearchFailure(
              securityRequired ? "security_verification_required" : "naver_shopping_click_failed",
              searchWindow,
              { securityVerificationRequired: securityRequired },
            );
          }
          const fashionTownOpened = await clickNaverFashionTownMenu(searchWindow);
          if (!fashionTownOpened) {
            const pageText = await searchWindow.webContents.executeJavaScript(
              `String(document.body?.innerText || "").slice(0, 20000)`,
              true,
            ).catch(() => "");
            const securityRequired = isNaverSecurityVerificationText(pageText);
            if (securityRequired && securityRetry < 1) {
              const verified = await waitForNaverSecurityVerification(searchWindow);
              if (verified) {
                searchWindow.destroy();
                searchWindow = null;
                return renderedSearchSourceResult(source, articleNumber, brand, title, securityRetry + 1, searchAttempt, sharedNaverSession);
              }
            }
            return renderedSearchFailure(
              securityRequired ? "security_verification_required" : "fashion_town_click_failed",
              searchWindow,
              { securityVerificationRequired: securityRequired },
            );
          }
        }
        const submitted = naverPortalSource
          ? await submitNaverShoppingSearch(searchWindow, searchQuery)
          : await executeOfficialMallSearch(searchWindow, String(source.homepageUrl || url), searchQuery);
        if (!submitted) {
          const pageText = naverPortalSource
            ? await searchWindow.webContents.executeJavaScript(
              `String(document.body?.innerText || "").slice(0, 20000)`,
              true,
            ).catch(() => "")
            : "";
          const securityRequired = naverPortalSource && isNaverSecurityVerificationText(pageText);
          if (securityRequired && securityRetry < 1) {
            const verified = await waitForNaverSecurityVerification(searchWindow);
            if (verified) {
              searchWindow.destroy();
              searchWindow = null;
              return renderedSearchSourceResult(source, articleNumber, brand, title, securityRetry + 1, searchAttempt, sharedNaverSession);
            }
          }
          return renderedSearchFailure(
            securityRequired ? "security_verification_required" : "search_submission_failed",
            searchWindow,
            { securityVerificationRequired: securityRequired },
          );
        }
        await wait(2_000);
      }
    }
    if (naverPortalSource) {
      // Counts are useful metadata, but they are no longer a prerequisite for
      // reading the overview result. Naver can change or delay tab-count markup
      // while the actual product cards are already visible and usable.
      naverChannelCounts ||= await readNaverFashionTownChannelCounts(searchWindow) || {};
      if (sharedNaverSession && !reuseNaverSearch) {
        sharedNaverSession.window = searchWindow;
        sharedNaverSession.resultsUrl = String(searchWindow.webContents.getURL() || url);
        sharedNaverSession.channelCounts = naverChannelCounts;
        sharedNaverSession.searchSubmitted = true;
      }
      const currentChannelRaw = naverChannelCounts[String(source.store || "")];
      const currentChannelCount = Number.isFinite(Number(currentChannelRaw)) ? Number(currentChannelRaw) : null;
      if (currentChannelCount === 0) {
        return {
          count: 0,
          channelCount: 0,
          products: [],
          presenceConfirmed: false,
          absenceConfirmed: true,
          searchCompleted: true,
          searchSubmitted: true,
          resolvedSearchUrl: String(searchWindow.webContents.getURL() || url),
          naverChannelCounts,
        };
      }
    }
    if (naverChannelClickRequired) {
      const channelSelected = source.store === "네이버 공식 브랜드스토어"
        ? await ensureNaverOfficialBrandFilter(searchWindow)
        : await clickNaverShoppingChannel(searchWindow, source.store);
      if (!channelSelected) {
        return renderedSearchFailure(
          source.store === "네이버 공식 브랜드스토어" ? "official_filter_failed" : "channel_selection_failed",
          searchWindow,
          { searchSubmitted: true },
        );
      }
    }
    // Naver and SSG exact results are already rendered above the fold.
    // Scrolling first loads unrelated recommendations and can remove the
    // single exact card from the candidate set.
    if (musinsaSource) {
      // Musinsa renders its search cards asynchronously. Do not close or read
      // the window after a fixed short delay: wait for cards, an authoritative
      // empty-result message, or a fully settled 15-second result page.
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await wait(1_000);
        const state = await searchWindow.webContents.executeJavaScript(`(() => {
          const visible = (element) => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          };
          const cards = [...document.querySelectorAll(
            'a[href*="/products/"],a[href*="/product/"],[class*="goods" i] a[href],[class*="product" i] a[href]'
          )].filter(visible).length;
          const pageText = String(document.body?.innerText || "").slice(0, 50000);
          return {
            cards,
            explicitEmpty: /검색\\s*결과가?\\s*(?:없|0)|상품이?\\s*(?:없|0)|검색된\\s*상품이\\s*없/i.test(pageText),
            blocked: /captcha|보안\\s*확인|비정상적인\\s*접근|접속.{0,12}(?:제한|차단)/i.test(pageText),
            loginRequired: /로그인\\s*(?:후|이\\s*필요|해주세요)|회원\\s*로그인/i.test(pageText.slice(0, 10000)),
            ready: document.readyState === "complete" && pageText.trim().length > 0,
          };
        })()`, true).catch(() => null);
        if (state?.cards > 0) {
          await wait(750);
          break;
        }
        if (state?.explicitEmpty) {
          musinsaSettledEmpty = true;
          break;
        }
        if (state?.blocked || state?.loginRequired) break;
        if (attempt === 14 && state?.ready) musinsaSettledEmpty = true;
      }
    }
    if (naverPortalSource || ssgChannelSource || musinsaSource) {
      await wait(1_500);
    } else {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await wait(attempt === 0 ? 2_000 : 800);
        await searchWindow.webContents.executeJavaScript(`(() => {
          const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
          window.scrollTo(0, Math.min(maxY, window.scrollY + Math.max(500, window.innerHeight * 0.8)));
        })()`, true).catch(() => {});
      }
    }
    // UNIVERSAL_RESULT_STABILITY_V2: simulation showed that a page can look
    // stable for several seconds and append more cards later. Never treat a
    // short stable interval as completion. Keep every successful result page
    // alive for the full 25-second observation window before final capture.
    // This only observes DOM state and never moves the user's physical mouse.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await wait(1_000);
      if (!searchWindow || searchWindow.isDestroyed()) break;
      const interruption = await searchWindow.webContents.executeJavaScript(`(() => {
        const pageText = String(document.body?.innerText || "").slice(0, 80000);
        return {
          blocked: /captcha|보안\\s*확인|비정상적인\\s*접근|접속.{0,12}(?:제한|차단)/i.test(pageText),
          loginRequired: /로그인\\s*(?:후|이\\s*필요|해주세요)|회원\\s*로그인/i.test(pageText.slice(0, 12000)),
        };
      })()`, true).catch(() => null);
      // Authentication and security screens cannot produce product results.
      // Preserve them as explicit non-empty failure states instead of waiting
      // and incorrectly reporting "상품 없음".
      if (interruption?.blocked || interruption?.loginRequired) break;
    }
    let content = await searchWindow.webContents.executeJavaScript(`(() => {
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
      const directProductLinks = [...document.querySelectorAll("a[href]")]
        .filter((link) => visible(link) || matchesExpected(link.href) || matchesExpected(link.outerHTML))
        .filter((link) => /\\/(?:p|pd|products?|window-products|goods|product|(?:[a-z]{2}\\/)?t)\\//i.test(link.href)
          || /productDetail\\.action/i.test(link.href)
          || /\\/item\\/itemView\\.ssg/i.test(link.href)
          || matchesExpected(link.href)
          || matchesExpected(link.outerHTML));
      // SSG와 롯데는 품번을 상품 링크 안이 아니라 같은 카드의 형제 제목에
      // 표시하기도 한다. 품번을 포함한 카드에서 실제 링크를 다시 찾는다.
      const articleCardLinks = [...document.querySelectorAll(
        "li,article,[data-product-id],[data-item-id],[class*='product-card'],[class*='goods-item'],[class*='item-card'],[class*='cunit'],[class*='mnemitem'],[class*='item_unit'],[class*='itemUnit'],[class*='item_grid'],[class*='product_unit'],[class*='product'],[class*='goods']"
      )].filter((card) => matchesExpected(card.innerText) || matchesExpected(card.outerHTML))
        .flatMap((card) => [...card.querySelectorAll("a[href]")])
        .filter((link) => visible(link) || matchesExpected(link.closest("li,article,div")?.innerText));
      // Naver frequently ships generated class names and keeps the image,
      // title and price in sibling nodes. Start at any visible node containing
      // the exact article, then climb to the smallest owning block that has a
      // link, image and price. This does not depend on Naver's class names.
      const articleTextCardLinks = [...document.querySelectorAll("a,div,li,article,span,strong")]
        .filter((element) => visible(element) && matchesExpected(element.innerText))
        .flatMap((element) => {
          let card = element;
          for (let depth = 0; card && depth < 8 && card !== document.body; depth += 1, card = card.parentElement) {
            const cardText = String(card.innerText || "");
            if (matchesExpected(cardText)
              && /[\\d,]+\\s*원/.test(cardText)
              && card.querySelector("img")
              && card.querySelector("a[href]")) return [...card.querySelectorAll("a[href]")];
          }
          return [];
        })
        .filter((link) => visible(link) || matchesExpected(link.closest("li,article,div")?.innerText));
      const productLinks = [...new Set([...directProductLinks, ...articleCardLinks, ...articleTextCardLinks])];
      const seen = new Set();
      const productCards = [];
      for (const link of productLinks) {
        const productUrl = String(link.href || "").split("#")[0];
        let productKey = productUrl;
        try {
          const parsedProductUrl = new URL(productUrl);
          // Naver cards often expose image and title anchors with different
          // tracking parameters for the same product. Count and click that
          // product once by its stable origin/path identity.
          if (/\.naver\.com$/i.test(parsedProductUrl.hostname)) {
            productKey = parsedProductUrl.origin + parsedProductUrl.pathname;
          }
        } catch {}
        if (!productUrl || seen.has(productKey)) continue;
        const card = link.closest("li, article, [data-product-id], [data-item-id], [class*='product-card'], [class*='goods-item'], [class*='item-card'], [class*='cunit'], [class*='mnemitem'], [class*='item_unit'], [class*='itemUnit'], [class*='item_grid'], [class*='product_unit']")
          || link.parentElement;
        const text = String(card?.innerText || link.innerText || "").trim();
        // SSG places its brand and "본사직영" badges near the product title,
        // sometimes outside the immediate anchor. Keep enough of the owning
        // card to classify the seller without borrowing evidence from another card.
        const markup = String(card?.outerHTML || link.outerHTML || "").slice(0, 8000);
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
        seen.add(productKey);
        const channelEvidenceText = [text, markup].join(" ");
        const officialBrandStoreLabelMatched = /브랜드\s*직영몰|공식\s*브랜드|브랜드\s*스토어/i.test(channelEvidenceText);
        const departmentStoreLabelMatched = /백화점/i.test(channelEvidenceText);
        const outletLabelMatched = /아울렛|outlet/i.test(channelEvidenceText);
        let naverWholeViewChannel = "";
        try {
          const productHost = new URL(productUrl).hostname.toLowerCase();
          if (productHost === "naver.com" || productHost.endsWith(".naver.com")) {
            naverWholeViewChannel = /\/window-products\/department\//i.test(productUrl) || departmentStoreLabelMatched
              ? "department"
              : /\/window-products\/outlet\//i.test(productUrl) || outletLabelMatched
                ? "outlet"
                : "brand-store";
          }
        } catch {}
        productCards.push({
          productUrl, text, markup, imageUrl, imageLinkedToProduct, title, price, originalPrice,
          officialBrandStoreLabelMatched, departmentStoreLabelMatched, outletLabelMatched,
          naverWholeViewChannel,
        });
      }
      const fullPageText = String(document.body?.innerText || "");
      const pageText = fullPageText.slice(0, 120000);
      const pageHeaderText = [...document.querySelectorAll('header,nav')]
        .map((element) => String(element.innerText || ""))
        .join(" ").slice(0, 20000);
      const selectedChannelEmpty = /검색된\s*상품이\s*없(?:습니다|어)|검색\s*결과가?\s*없(?:습니다|어)|상품이\s*없(?:습니다|어)|검색결과\s*없음/i.test(fullPageText);
      const requestedStore = ${JSON.stringify(String(source.store || ""))};
      const recognizedChannelCounts = ${JSON.stringify(naverChannelCounts)};
      const channelLabels = requestedStore.includes("공식 브랜드스토어")
        ? ["브랜드직영몰", "공식브랜드", "브랜드스토어"]
        : requestedStore.includes("백화점") ? ["백화점"]
          : requestedStore.includes("아울렛") ? ["아울렛"] : [];
      let selectedChannelCount = Number.isFinite(recognizedChannelCounts?.[requestedStore])
        ? Number(recognizedChannelCounts[requestedStore]) : null;
      for (const label of channelLabels) {
        const escaped = label.replace(/[.*+?^{}()|[\]\\$]/g, "\\$&");
        const match = fullPageText.match(new RegExp(escaped + "\\s*([\\d,]+)\\s*개", "i"));
        if (!match) continue;
        selectedChannelCount = Math.max(selectedChannelCount ?? 0, Number(match[1].replace(/,/g, "")) || 0);
      }
      const pageBlocked = /captcha|보안\s*확인|자동\s*입력|로봇|접속.{0,12}(?:제한|차단)|서비스.{0,12}(?:제한|지연)|비정상적인\s*접근/i.test(pageText);
      return JSON.stringify({ productCards, pageBlocked, pageText, pageHeaderText, selectedChannelEmpty, selectedChannelCount });
    })()`, true);
    let parsedContent;
    try {
      parsedContent = JSON.parse(content);
      if (parsedContent?.pageBlocked && !parsedContent?.productCards?.length) {
        if (securityRetry >= 1 || !/naver\.com/i.test(String(searchWindow.webContents.getURL() || url))) {
          return renderedSearchFailure("security_verification_required", searchWindow, {
            searchSubmitted: interactiveSiteSearch,
            securityVerificationRequired: true,
          });
        }
        const verified = await waitForNaverSecurityVerification(searchWindow);
        if (!verified) {
          return renderedSearchFailure("security_verification_required", searchWindow, {
            searchSubmitted: interactiveSiteSearch,
            securityVerificationRequired: true,
          });
        }
        searchWindow.destroy();
        searchWindow = null;
        return renderedSearchSourceResult(source, articleNumber, brand, title, securityRetry + 1, searchAttempt, sharedNaverSession);
      }
    } catch {
      return renderedSearchFailure("result_parse_failed", searchWindow, { searchSubmitted: interactiveSiteSearch });
    }
    if (naverPortalSource) {
      const expectedNaverChannel = source.store === "네이버 백화점" ? "department"
        : source.store === "네이버 아울렛" ? "outlet"
          : source.store === "네이버 공식 브랜드스토어" ? "brand-store" : "";
      const currentChannelRaw = naverChannelCounts?.[String(source.store || "")];
      const currentChannelCount = Number.isFinite(Number(currentChannelRaw)) ? Number(currentChannelRaw) : null;
      const channelCards = (parsedContent.productCards || []).filter((card) =>
        isTrustedNaverFashionProductCard(card)
          && (!expectedNaverChannel || String(card?.naverWholeViewChannel || "") === expectedNaverChannel));
      if (!channelCards.length && Number(currentChannelCount || 0) > 0) {
        return renderedSearchFailure("overview_channel_card_collection_failed", searchWindow, {
          searchSubmitted: true,
          resolvedSearchUrl: String(searchWindow.webContents.getURL() || url),
        });
      }
      parsedContent.productCards = channelCards;
      parsedContent.selectedChannelCount = currentChannelCount ?? channelCards.length;
      content = JSON.stringify(parsedContent);
    }
    if (["SSG 백화점", "SSG 아울렛"].includes(String(source.store || ""))) {
      const department = source.store === "SSG 백화점";
      const headerMatched = department
        ? /신세계\s*백화점|백화점/i.test(String(parsedContent.pageHeaderText || ""))
        : /아울렛|outlet/i.test(String(parsedContent.pageHeaderText || ""));
      const labelField = department ? "departmentStoreLabelMatched" : "outletLabelMatched";
      const labeledChannelCards = (parsedContent.productCards || []).filter((card) =>
        isPlatformShoppingProductUrl(card?.productUrl) && card?.[labelField] === true);
      if (!headerMatched || labeledChannelCards.length === 0) {
        return renderedSearchFailure("ssg_channel_evidence_mismatch", searchWindow, {
          searchSubmitted: interactiveSiteSearch,
          resolvedSearchUrl: String(searchWindow.webContents.getURL() || url),
        });
      }
      parsedContent.productCards = labeledChannelCards;
      parsedContent.selectedChannelCount = labeledChannelCards.length;
      content = JSON.stringify(parsedContent);
    }
    const analyzed = analyzeRenderedChannelProducts(content, source.store, articleNumber, brand, title);
    const resolvedSearchUrl = String(searchWindow.webContents.getURL() || url);
    if (!analyzed) return renderedSearchFailure("result_analysis_failed", searchWindow, { searchSubmitted: interactiveSiteSearch });
    const candidateCount = Array.isArray(analyzed.products) ? analyzed.products.length : 0;
    let detailed = {
      ...analyzed,
      resolvedSearchUrl,
      searchCompleted: true,
      searchSubmitted: interactiveSiteSearch,
      candidateCount,
      naverChannelCounts,
    };
    if (musinsaSource && musinsaSettledEmpty && candidateCount === 0) {
      detailed = {
        ...detailed,
        count: 0,
        products: [],
        presenceConfirmed: false,
        absenceConfirmed: true,
        detailVerificationPending: false,
      };
    }
    // Naver, SSG and Lotte are list-only sources. Their visible search cards
    // are the requested output; do not navigate to details or inspect stock.
    if (/^(?:네이버\s|SSG(?:\s|$)|롯데온(?:\s|$))/.test(String(source.store || ""))) {
      return {
        ...detailed,
        count: /^네이버\s/.test(String(source.store || "")) && Number.isFinite(analyzed?.channelCount)
          ? Number(analyzed.channelCount) : candidateCount,
        products: (analyzed.products || []).map((product) => ({ ...product, inStock: null, sizes: [] })),
        detailVerificationPending: false,
      };
    }
    if (Array.isArray(analyzed?.products)) {
      const products = [];
      for (const product of analyzed.products.slice(0, 8)) {
        let detailText = "";
        let stockEvidence = normalizeRenderedStockEvidence();
        try {
          const productOpened = await clickRenderedProductCard(searchWindow, product.url, resolvedSearchUrl);
          if (!productOpened) throw new Error("PRODUCT_CARD_CLICK_FAILED");
          await wait(1_000);
          await openRenderedSizeOptions(searchWindow);
          detailText = await searchWindow.webContents.executeJavaScript(
            `String(document.body?.innerText || "").slice(0, 60000)`,
            true,
          ).catch(() => "");
          const rawStock = await searchWindow.webContents.executeJavaScript(`(() => {
            const visible = (element) => {
              if (!element) return false;
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
            };
            const sold = (element) => element.disabled
              || element.getAttribute("aria-disabled") === "true"
              || /disabled|sold.?out|품절|재고.?없음/i.test([element.className, element.textContent].join(" "));
            const optionNodes = [
              ...document.querySelectorAll("select option"),
              ...document.querySelectorAll('[class*="size" i] button,[class*="option" i] button,[data-option],[data-size],[role="option"],[role="listbox"] li,[class*="dropdown" i] li'),
            ];
            // Some official malls render size choices as plain buttons/labels
            // with no size-related class. Include those only when their own
            // label looks like an apparel/shoe size and their nearby field is
            // explicitly headed by "사이즈/size", avoiding quantity buttons.
            const plainSizeNodes = [...document.querySelectorAll('button,label,[role="button"],input[type="radio"]')]
              .filter(visible)
              .filter((element) => {
                const label = String(element.getAttribute("data-size") || element.value || element.textContent || "").replace(/\\s+/g, " ").trim();
                if (!/^(?:FREE|ONE\s*SIZE|XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-9]?\d{1,2}(?:\.5)?|[12]\d{2}|[2-3]\d{2}(?:\.5)?)$/i.test(label)) return false;
                let scope = element.parentElement;
                for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
                  const scopeText = String(scope.innerText || "").slice(0, 1200);
                  if (/사이즈|size/i.test(scopeText)) return true;
                }
                return false;
              });
            const uniqueOptionNodes = [...new Set([...optionNodes, ...plainSizeNodes])];
            const options = uniqueOptionNodes.slice(0, 160).map((element) => ({
              label: String(element.getAttribute("data-size") || element.getAttribute("data-option") || element.textContent || "").replace(/\\s+/g, " ").trim(),
              inStock: !sold(element),
            }));
            const purchaseAvailable = [...document.querySelectorAll('button,a,[role="button"]')].some((element) =>
              visible(element) && !sold(element) && /구매|바로구매|장바구니|BUY\s*NOW|ADD\s*TO\s*(?:BAG|CART)/i.test(element.textContent || element.getAttribute("aria-label") || "")
            );
            const pageText = String(document.body?.innerText || "").slice(0, 60000);
            const loginRequired = /(?:login|signin|member\/login|auth\/login)/i.test(location.href)
              || [...document.querySelectorAll('input[type="password"]')].some(visible)
              || /로그인\s*(?:후|이\s*필요|해주세요)|회원\s*로그인/i.test(pageText.slice(0, 8000));
            return { pageText, purchaseAvailable, options, loginRequired };
          })()`, true).catch(() => null);
          if (rawStock) stockEvidence = normalizeRenderedStockEvidence(rawStock);
        } catch {}
        const detailArticleVerified = product.detailArticleVerificationRequired
          ? exactArticleIdentityMatch(detailText, articleNumber) : false;
        if (product.detailArticleVerificationRequired && !detailArticleVerified) continue;
        const evidence = `${String(product.title || "")} ${String(detailText || "")}`;
        if (isOverseasPurchaseProduct(evidence)) continue;
        if (isConsignmentOperatedProduct(evidence)) continue;
        const isSsg = /:\/\/(?:[^/]+\.)?ssg\.com\//i.test(String(product.url || ""));
        const detailClassification = isSsg
          ? classifySsgProductEvidence({ brand, url: product.url, text: evidence })
          : String(product.ssgClassification || "");
        const classification = isSsg
          ? resolveSsgProductClassification(detailClassification, product.ssgClassification)
          : detailClassification;
        const retailer = detectedRetailer(evidence);
        products.push({
          ...product,
          sourceStore: String(product.sourceStore || product.store || source.store || ""),
          // Search cards can omit the manufacturer's code. Preserve the code
          // verified on the detail page so same-model colour cards are merged
          // later and the best matching image/price remains.
          detectedArticleNumber: detailArticleVerified ? articleNumber : product.detectedArticleNumber,
          store: isSsg && classification === "official_brand"
            ? "SSG 브랜드 공식관"
            : isSsg && classification === "parallel_import" ? "SSG 병행수입" : product.store,
          retailerName: isSsg && classification === "official_brand"
            ? (/본사\s*직영/i.test(evidence) || /본사\s*직영/i.test(String(product.retailerName || ""))
              ? "브랜드 공식관 · 본사직영" : "브랜드 공식관 · 공식수입")
            : isSsg && classification === "parallel_import" ? (retailer || "병행수입 상품") : product.retailerName,
          officialStoreVerified: isSsg ? classification === "official_brand" : product.officialStoreVerified,
          ssgClassification: classification,
          ssgDetailVerified: Boolean(detailText),
          ...stockEvidence,
        });
      }
      const preserveNaverChannelCount = /^네이버\s/.test(String(source.store || ""))
        && Number.isFinite(analyzed?.channelCount);
      detailed = {
        ...analyzed,
        resolvedSearchUrl,
        count: preserveNaverChannelCount ? Number(analyzed.channelCount) : products.length,
        products,
        searchCompleted: true,
        searchSubmitted: interactiveSiteSearch,
        candidateCount,
        naverChannelCounts,
        detailVerificationPending: candidateCount > 0 && products.length === 0,
      };
    }
    if (source.store !== "브랜드 공식몰" || !Array.isArray(detailed?.products)) return detailed;
    const officialPageUrl = String(source.homepageUrl || source.officialProductUrl || source.searchUrl || "");
    const products = [];
    for (const product of detailed.products.slice(0, 12)) {
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
    return { ...detailed, count: products.length, products };
  } catch (error) {
    const message = String(error?.message || error || "");
    if (domesticSearchCanceled(generation) || /DOMESTIC_SEARCH_CANCELED/i.test(message)) throw new Error("DOMESTIC_SEARCH_CANCELED");
    const reason = /SEARCH_PAGE_TIMEOUT/i.test(message) ? "page_load_timeout"
      : /ERR_(?:NAME_NOT_RESOLVED|CONNECTION|TIMED_OUT|INTERNET_DISCONNECTED)/i.test(message) ? "network_error"
        : "page_load_failed";
    // A Musinsa SPA can terminate its navigation after accepting the exact
    // search route. If the route still contains the requested model number,
    // treat a non-network/non-timeout load termination as a completed empty
    // search. Genuine connection and timeout failures remain visible errors.
    const failedUrl = String(!searchWindow?.isDestroyed?.() ? searchWindow?.webContents?.getURL?.() : "");
    const requestedMusinsaQuery = sanitizeDomesticProductCode(articleNumber)
      || sanitizeDomesticQuery(searchAttempt?.query || source.searchQuery || title);
    let exactMusinsaSearchRoute = false;
    try {
      const parsedFailedUrl = new URL(failedUrl);
      exactMusinsaSearchRoute = /(^|\.)musinsa\.com$/i.test(parsedFailedUrl.hostname)
        && parsedFailedUrl.pathname.includes("/search/goods")
        && String(parsedFailedUrl.searchParams.get("keyword") || "").trim().toUpperCase()
          === requestedMusinsaQuery.toUpperCase();
    } catch {}
    if (musinsaSource && reason === "page_load_failed" && exactMusinsaSearchRoute) {
      return {
        count: 0,
        products: [],
        presenceConfirmed: false,
        absenceConfirmed: true,
        searchCompleted: true,
        searchSubmitted: true,
        resolvedSearchUrl: failedUrl,
        detailVerificationPending: false,
      };
    }
    return renderedSearchFailure(reason, searchWindow);
  } finally {
    const keepSharedNaverWindow = naverPortalSource
      && sharedNaverSession?.window === searchWindow;
    if (searchWindow && !searchWindow.isDestroyed() && !keepSharedNaverWindow) searchWindow.destroy();
    if (searchWindow?.isDestroyed()) activeDomesticSearchWindows.delete(searchWindow);
  }
}

async function addRenderedSearchCounts(data, articleNumber, brand = "", title = "", generation = domesticSearchGeneration) {
  const discoveredProducts = [];
  const sources = [];
  // Naver Fashion Town exposes official-brand, department, and outlet counts
  // on one result page. Keep that browser/result URL alive across the three
  // source rows so the product code is physically submitted exactly once.
  const sharedNaverSession = {
    window: null,
    resultsUrl: "",
    channelCounts: null,
    searchSubmitted: false,
  };
  // The complete domestic lookup is one sequential request again. A source
  // failure is recorded on that source, then the same request continues to
  // the next source without spawning module-specific state or retries.
  for (const source of data.sources) {
    if (domesticSearchCanceled(generation)) throw new Error("DOMESTIC_SEARCH_CANCELED");
    const resolvedSource = await (async () => {
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
    // A search-card hit is only a candidate. Musinsa and other rendered
    // channels must open the product detail page before an exact article and
    // stock state can be reported as a purchasable domestic result.
      const allQueryAttempts = Array.isArray(source.searchAttempts) && source.searchAttempts.length
        ? source.searchAttempts : [{ query: source.searchQuery || articleNumber || title || "", url: source.searchUrl || "" }];
    // One Naver search already contains all three requested channels. Never
    // type title fallbacks or re-submit the product code for each source row.
      const queryAttempts = /^네이버\s/.test(String(source.store || ""))
        ? allQueryAttempts.slice(0, 1) : allQueryAttempts;
      let result = null;
      for (const queryAttempt of queryAttempts) {
        if (domesticSearchCanceled(generation)) throw new Error("DOMESTIC_SEARCH_CANCELED");
      // Submit each query exactly once. A later query is a fallback only when
      // the completed prior search returned no product; browser/security or
      // detail-verification failures must not repeat the same query or advance
      // as though the product were absent.
        const queryResult = await renderedSearchSourceResult(
          source, articleNumber, brand, title, 0, queryAttempt, sharedNaverSession, generation,
        );
        if (!queryResult) {
          result = renderedSearchFailure("unknown_search_failure");
          break;
        }
        result = queryResult;
        if (queryResult.verificationReason || queryResult.detailVerificationPending) break;
        if (Number(queryResult.count || 0) > 0 || (queryResult.products || []).length > 0) break;
      // Only a completed, authoritative zero-result search may advance to the
      // next query (product code -> title -> title+code). A page/parser/detail
      // failure ends this source once and is never submitted as another query.
        if (queryResult.absenceConfirmed !== true) break;
      }
      if (Array.isArray(result?.products)) discoveredProducts.push(...result.products);
      const count = result?.count;
      const absenceConfirmed = result?.absenceConfirmed === true;
      const displayCount = Number.isFinite(count)
        ? Number(count)
        : 0;
      const isOfficialStore = source.store === "브랜드 공식몰";
      const verifiedOfficialProductUrl = isOfficialStore
        ? String((result?.products || []).find((product) => /^https?:\/\//i.test(String(product?.url || "")))?.url || "")
        : String(source.officialProductUrl || "");
      const verifiedProductUrl = String((result?.products || [])
        .find((product) => /^https?:\/\//i.test(String(product?.url || "")))?.url || "");
      return {
        ...source,
        searchUrl: String(result?.resolvedSearchUrl || source.searchUrl || ""),
        count: displayCount,
        countVerified: Number.isFinite(count) && (Number(count) > 0 || absenceConfirmed),
        verificationFailed: !Number.isFinite(count),
        verificationPending: result?.detailVerificationPending === true
          || (Number.isFinite(count) && Number(count) === 0 && !absenceConfirmed),
        absenceConfirmed,
        searchCompleted: result?.searchCompleted === true,
        searchSubmitted: result?.searchSubmitted === true,
        verificationReason: String(result?.verificationReason || ""),
        securityVerificationRequired: result?.securityVerificationRequired === true,
        loginRequired: result?.loginRequired === true,
        candidateCount: Number(result?.candidateCount || 0),
        parallelRetailerListEnforced: result?.parallelRetailerListEnforced === true,
      // The official search URL and a verified product-detail URL are
      // intentionally separate. A search page must never be presented as a
      // purchase link merely because the brand has a supported search form.
        officialSearchUrl: isOfficialStore ? String(source.officialProductUrl || "") : "",
        officialProductUrl: verifiedOfficialProductUrl,
        verifiedProductUrl,
        officialProductMissing: isOfficialStore && absenceConfirmed,
      };
    })();
    sources.push(resolvedSource);
    if (source.store === "네이버 패션타운"
      && sharedNaverSession.window
      && !sharedNaverSession.window.isDestroyed()) {
      // The shared Naver window is closed only after every source result has
      // been resolved and pushed. This is a post-capture grace period, not a
      // substitute for the DOM-stability gate above.
      await wait(2_000);
      sharedNaverSession.window.destroy();
      sharedNaverSession.window = null;
    }
  }
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
    nextRunAt: String(saved.nextRunAt || ""),
    scheduleLabel: "매일 새벽 1시~6시",
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
const SELLER_LOGIN_WAIT_MS = 10 * 60 * 1_000;
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

function officialAccountCredentials(sourceId) {
  const settings = store.snapshot().settings;
  const prefix = sourceId === "nike" ? "nike" : sourceId === "adidas" ? "adidas" : "";
  if (!prefix) return { id: "", password: "" };
  return {
    id: String(settings[`${prefix}LoginId`] || "").trim(),
    password: decrypted(settings[`${prefix}PasswordEncrypted`] || ""),
  };
}

function officialAccountSourceForUrl(value) {
  let hostname = "";
  try { hostname = new URL(String(value || "")).hostname.replace(/^www\./, ""); } catch { return null; }
  return DOMESTIC_LOGIN_SOURCES.find((source) => source.officialAccount
    && source.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) || null;
}

async function ensureOfficialAccountLogin(searchWindow, homepageUrl) {
  const source = officialAccountSourceForUrl(homepageUrl);
  if (!source) return { ok: true, required: false };
  const credentials = officialAccountCredentials(source.id);
  if (!credentials.id || !credentials.password) {
    searchWindow.show();
    searchWindow.focus();
    searchWindow.setTitle(`${source.name} 계정정보를 설정한 뒤 검색해 주세요`);
    return { ok: false, required: true, reason: "OFFICIAL_CREDENTIALS_REQUIRED" };
  }
  await searchWindow.loadURL(source.loginUrl).catch(() => {});
  await wait(1_200);
  const state = await searchWindow.webContents.executeJavaScript(`(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };
    const fields = [...document.querySelectorAll('input')].filter(visible);
    const user = fields.find((el) => /email|user|login|아이디|이메일/i.test([el.name, el.id, el.type, el.autocomplete, el.placeholder, el.getAttribute('aria-label')].join(' ')) && el.type !== 'password');
    const password = fields.find((el) => el.type === 'password' || /password|비밀번호/i.test([el.name, el.id, el.placeholder, el.getAttribute('aria-label')].join(' ')));
    if (!user || !password) return { formFound: false };
    const setValue = (el, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    setValue(user, ${JSON.stringify(credentials.id)});
    setValue(password, ${JSON.stringify(credentials.password)});
    const submit = [...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(visible).find((el) => /로그인|log\s*in|sign\s*in/i.test([el.textContent, el.value, el.getAttribute('aria-label')].join(' ')));
    if (!submit) return { formFound: true };
    submit.scrollIntoView({ block: 'center' }); const r = submit.getBoundingClientRect();
    return { formFound: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`, true).catch(() => null);
  if (state?.x && state?.y) {
    searchWindow.webContents.sendInputEvent({ type: "mouseMove", x: state.x, y: state.y });
    searchWindow.webContents.sendInputEvent({ type: "mouseDown", x: state.x, y: state.y, button: "left", clickCount: 1 });
    searchWindow.webContents.sendInputEvent({ type: "mouseUp", x: state.x, y: state.y, button: "left", clickCount: 1 });
    await wait(3_000);
  }
  const stillOnLogin = /login|signin|sign-in/i.test(searchWindow.webContents.getURL());
  if (!state || stillOnLogin || (state.formFound === true && !state.x)) {
    searchWindow.show();
    searchWindow.focus();
    searchWindow.setTitle(`${source.name} 로그인 확인 필요 · 로그인 완료 후 다시 검색`);
    return { ok: false, required: true, reason: "OFFICIAL_LOGIN_FAILED" };
  }
  return { ok: true, required: true };
}

function publicConfig() {
  const settings = store.snapshot().settings;
  return {
    appKey: settings.appKey || "",
    apiBaseUrl: settings.apiBaseUrl || "https://open.poizon.com",
    brandExportFolder: settings.brandExportFolder || "",
    hasAppSecret: Boolean(settings.appSecretEncrypted),
    hasAccessToken: Boolean(settings.accessTokenEncrypted),
    poizonLoginId: settings.poizonLoginId || "",
    hasPoizonPassword: Boolean(settings.poizonPasswordEncrypted),
    nikeLoginId: settings.nikeLoginId || "",
    hasNikePassword: Boolean(settings.nikePasswordEncrypted),
    adidasLoginId: settings.adidasLoginId || "",
    hasAdidasPassword: Boolean(settings.adidasPasswordEncrypted),
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
    "appSecretEncrypted", "accessTokenEncrypted", "poizonLoginId", "poizonPasswordEncrypted",
    "nikeLoginId", "nikePasswordEncrypted", "adidasLoginId", "adidasPasswordEncrypted", "brandExportFolder",
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
  const emitStartupProgress = (percent, message, details = {}) => {
    mainWindow?.webContents.send("startup-recovery:progress", {
      percent: Math.max(0, Math.min(100, Number(percent) || 0)),
      message,
      ...details,
    });
  };
  emitStartupProgress(5, "POIZON 다운로드 폴더를 확인하고 있습니다.");
  await mkdir(folder, { recursive: true });
  const entries = await listBrandExportExcelEntries(folder);
  const sourceEntries = entries
    .filter((entry) => !isProcessedBrandExportName(entry.name) && !isPartialBrandExportName(entry.name));
  emitStartupProgress(12, `기존 POIZON Excel ${sourceEntries.length}개를 확인합니다.`, {
    current: 0,
    total: sourceEntries.length,
  });
  const preparedEntries = [];
  for (let index = 0; index < sourceEntries.length; index += 1) {
    const entry = sourceEntries[index];
    preparedEntries.push({ entry, info: await stat(entry.path) });
    emitStartupProgress(12 + Math.round(((index + 1) / Math.max(1, sourceEntries.length)) * 18),
      `기존 POIZON Excel 목록 확인 ${index + 1}/${sourceEntries.length}`, {
        current: index + 1,
        total: sourceEntries.length,
      });
  }
  preparedEntries.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);
  const usedJobIds = new Set();
  const files = [];
  for (let index = 0; index < preparedEntries.length; index += 1) {
    const { entry, info } = preparedEntries[index];
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
    emitStartupProgress(30 + Math.round(((index + 1) / Math.max(1, preparedEntries.length)) * 58),
      `POIZON 변경 사항 확인 ${index + 1}/${preparedEntries.length}`, {
        current: index + 1,
        total: preparedEntries.length,
      });
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
  emitStartupProgress(90, `기존 POIZON Excel ${visibleFiles.length}개 확인을 완료했습니다.`, {
    current: visibleFiles.length,
    total: visibleFiles.length,
  });
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
    spuId: column("SPU ID", "SPU_ID"), image: column("SPU 이미지", "상품 이미지", "이미지", "이미지 URL"),
    articleNumber: column("상품 번호", "상품번호", "상품코드", "품번"), title: column("상품명", "영문 상품명"),
    brand: column("상품 브랜드", "브랜드"), category1: column("카테고리 대분류", "대분류"),
    category2: column("카테고리 중분류", "중분류"), category3: column("카테고리 소분류", "소분류"),
    averagePrice: column("최근 30일간 평균 거래가", "최근 30일 평균 거래가", "평균 거래가"),
    sales30d: column("최근 30일 판매량", "최근30일판매량"),
    localSales30d: column("현지 판매자 최근 30일 판매량", "현지판매자최근30일판매량"),
    totalSales: column("중국 총 판매량", "총 판매량"),
    localTotalSales: column("현지 판매자 총 판매량", "현지판매자총판매량"),
    option: column("사이즈/옵션/색상", "옵션"), skuId: column("SKU ID", "SKU_ID"),
  };
  const cell = (row, index) => index >= 0 ? row[index] : "";
  const raw = (row, index) => String(cell(row, index) ?? "").trim();
  return entries.flatMap((entry) => {
    const row = entry.values || [];
    // Domestic sourcing is performed per size/SKU row. A product can have
    // high total sales while the selected size has "<5" or another low recent
    // sales value. Never put that size into the domestic-search queue. When
    // both recent-sales columns are present, the row itself must satisfy the
    // same strict 30+ AND rule. The source workbook remains untouched.
    if (columns.sales30d >= 0 && columns.localSales30d >= 0) {
      const chinaRecentSales = parsePoizonSalesMetric(cell(row, columns.sales30d));
      const localRecentSales = parsePoizonSalesMetric(cell(row, columns.localSales30d));
      if (chinaRecentSales < 30 || localRecentSales < 30) return [];
    }
    const spuId = raw(row, columns.spuId);
    const articleNumber = raw(row, columns.articleNumber);
    const title = raw(row, columns.title);
    const skuId = raw(row, columns.skuId);
    const option = raw(row, columns.option);
    if (!spuId && !articleNumber && !title && !skuId) return [];
    return [{
      key: `ROW:${entry.sourceRowNumber}:${skuId || articleNumber || spuId}`,
      sourceRowNumber: entry.sourceRowNumber,
      spuId,
      skuId,
      option,
      articleNumber,
      title,
      brandName: raw(row, columns.brand),
      logoUrl: raw(row, columns.image),
      categoryName: [columns.category1, columns.category2, columns.category3].map((index) => raw(row, index)).filter(Boolean).join(" / "),
      averagePrice: parsePoizonSalesMetric(cell(row, columns.averagePrice)),
      optionCount: 1,
      totalSales: parsePoizonSalesMetric(cell(row, columns.totalSales)),
      totalSalesRaw: raw(row, columns.totalSales),
      localTotalSales: parsePoizonSalesMetric(cell(row, columns.localTotalSales)),
      localTotalSalesRaw: raw(row, columns.localTotalSales),
      sales30d: parsePoizonSalesMetric(cell(row, columns.sales30d)),
      sales30dRaw: raw(row, columns.sales30d),
      localSales30d: parsePoizonSalesMetric(cell(row, columns.localSales30d)),
      localSales30dRaw: raw(row, columns.localSales30d),
    }];
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
      headers: Array.from({ length: columnCount }, (_unused, index) => excelPreviewCell(rows[0]?.[index])),
      rows: rows.slice(1).map((row) => Array.from({ length: columnCount }, (_unused, index) => excelPreviewCell(row[index]))),
      columnCount,
    };
    excelPreviewCache.set(signature, workbook);
    while (excelPreviewCache.size > 3) excelPreviewCache.delete(excelPreviewCache.keys().next().value);
  }
  const productView = input.filters?.productView !== false;
  const manualRawFilter = !productView && [
    input.filters?.minimumTotal,
    input.filters?.maximumTotal,
    input.filters?.minimumLocalTotal,
    input.filters?.maximumLocalTotal,
  ].some((value) => value !== null && value !== undefined && String(value).trim() !== "");
  const filtered = productView || manualRawFilter
    ? filterPoizonPreviewRows(workbook.headers, workbook.rows, {
        ...(input.filters || {}),
        rowLevel: manualRawFilter,
      })
    : {
        entries: workbook.rows.map((values, index) => ({ values, sourceRowNumber: index + 2 })),
        sourceRows: workbook.rows.length,
        sourceProducts: workbook.rows.length,
        filteredProducts: workbook.rows.length,
        chinaQualifiedProducts: workbook.rows.length,
        localQualifiedProducts: workbook.rows.length,
        missingChinaProducts: 0,
        missingLocalProducts: 0,
        totalSalesColumn: -1,
        localTotalSalesColumn: -1,
        filterApplied: false,
        matchMode: "all",
      };
  const selectionOnly = input.filters?.selectionOnly === true;
  // Keep the viewer paged, but allow one explicit local read to select every
  // searchable product across all result pages.
  const limit = selectionOnly
    ? Math.min(100000, Math.max(25, Number(input.limit) || 100))
    : Math.min(200, Math.max(25, Number(input.limit) || 100));
  const products = productView ? buildExcelPreviewProducts(workbook.headers, filtered.entries) : [];
  const sourceTotalProducts = productView ? buildExcelPreviewProducts(workbook.headers, workbook.rows.map((values, index) => ({ values, sourceRowNumber: index + 2 }))).length : 0;
  const resultCount = productView ? products.length : filtered.entries.length;
  const maximumOffset = Math.max(0, Math.floor(Math.max(0, resultCount - 1) / limit) * limit);
  const offset = Math.min(maximumOffset, Math.max(0, Number(input.offset) || 0));
  const pageEntries = filtered.entries.slice(offset, offset + limit);
  const pageProducts = productView
    ? products.slice(offset, offset + limit)
    : buildExcelPreviewProducts(workbook.headers, pageEntries);
  return {
    ok: true,
    path: filePath,
    name: basename(filePath),
    headers: workbook.headers,
    rows: productView || selectionOnly ? [] : pageEntries.map((entry) => entry.values),
    rowNumbers: productView || selectionOnly ? [] : pageEntries.map((entry) => entry.sourceRowNumber),
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
    filterDiagnostics: {
      sourceProducts: filtered.sourceProducts,
      filteredProducts: filtered.filteredProducts,
      chinaQualifiedProducts: filtered.chinaQualifiedProducts,
      localQualifiedProducts: filtered.localQualifiedProducts,
      missingChinaProducts: filtered.missingChinaProducts,
      missingLocalProducts: filtered.missingLocalProducts,
      totalSalesHeader: filtered.totalSalesColumn >= 0 ? workbook.headers[filtered.totalSalesColumn] : "",
      localTotalSalesHeader: filtered.localTotalSalesColumn >= 0 ? workbook.headers[filtered.localTotalSalesColumn] : "",
      totalSalesColumnNumber: filtered.totalSalesColumn >= 0 ? filtered.totalSalesColumn + 1 : 0,
      localTotalSalesColumnNumber: filtered.localTotalSalesColumn >= 0 ? filtered.localTotalSalesColumn + 1 : 0,
    },
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
    // A download may be created outside Electron's will-download handler.
    // Wait for the file to stop changing before treating it as terminal.
    await new Promise((resolve) => setTimeout(resolve, 800));
    const stableInfo = await stat(newest.path);
    if (stableInfo.size !== newest.size || stableInfo.mtimeMs !== newest.mtimeMs) return;
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
    // The workbook already exists and is stable, so the active job is done even
    // when POIZON's task-number cell could not be read. Leaving it in the map
    // would restart the monitor forever and request a duplicate download.
    await rememberBrandExportJob({
      jobId: matchedJobId,
      brandName: expectedBrand,
      brandKo: brandExportJobs.get(matchedJobId)?.brandKo || "",
      createdAt: Number(brandExportJobs.get(matchedJobId)?.createdAt || newest.mtimeMs),
      lastDownloadedAt: Date.now(),
      expectedProductCount: Number(brandExportJobs.get(matchedJobId)?.expectedProductCount || 0),
      filePath: newest.path,
      fileName: newest.name,
      fileMtimeMs: newest.mtimeMs,
      sessionGeneration: brandWorkSessionGeneration,
    });
    brandExportJobs.delete(matchedJobId);
    if (activeBrandDownloadJobId === matchedJobId) activeBrandDownloadJobId = "";
    if (brandExportJobs.size) scheduleBrandExportMonitor(500);
    else emitBrandExportAllComplete();
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
    show: false,
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
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });
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
    item.once("done", (_doneEvent, state) => {
      void (async () => {
      if (sessionGeneration !== brandWorkSessionGeneration) return;
      if (state === "completed") {
        // Persist the terminal download state before workbook inspection. If a
        // later Excel/brand validation step fails, this job must never be
        // downloaded or monitored again.
        const completedInfo = await stat(filePath);
        await rememberBrandExportJob({
          jobId: downloadJobId,
          brandName: downloadJob.brandName,
          brandKo: downloadJob.brandKo,
          createdAt: downloadJob.createdAt,
          lastDownloadedAt: Date.now(),
          expectedProductCount: Number(downloadJob.expectedProductCount || 0),
          filePath,
          fileName,
          fileMtimeMs: completedInfo.mtimeMs,
          sessionGeneration,
        });
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
      })().catch((error) => {
        mainWindow?.webContents.send("brand-export:error", {
          brandName: downloadJob.brandName,
          jobId: downloadJobId,
          jobState: state === "completed" ? "다운로드 완료 · Excel 확인 오류" : "다운로드 실패",
          message: state === "completed"
            ? `${downloadJob.brandName || "선택 브랜드"} 파일 다운로드는 완료됐으며 반복 감시를 종료합니다. Excel 확인 오류: ${error instanceof Error ? error.message : String(error)}`
            : `브랜드 데이터 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
          path: filePath,
          name: fileName,
        });
      }).finally(() => {
        // Terminal cleanup is unconditional: a completed/failed Electron
        // download must not leave its job in the polling queue forever.
        brandExportJobs.delete(downloadJobId);
        if (activeBrandDownloadJobId === downloadJobId) activeBrandDownloadJobId = "";
        brandDownloadPathsInProgress.delete(filePath);
        brandDownloadStarted = false;
        if (brandExportJobs.size) scheduleBrandExportMonitor(500);
        else emitBrandExportAllComplete();
      });
    });
    });
    sellerDownloadSessions.add(sellerSession);
  }
  sellerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isPoizonExportDownloadUrl(url) || /^https:\/\/seller\.poizon\.com\//i.test(url)) {
      sellerWindow?.webContents.downloadURL(url);
    } else if (/^https:\/\//i.test(url)) {
      openExternalInChromeTab(url).catch(() => shell.openExternal(url));
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
  FAILED: 5.5,
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
      return {
        jobId,
        restored: Boolean(job?.restored),
        createdAt: Number(job?.createdAt || 0),
        restoredAt: Number(job?.restoredAt || 0),
        allowTimeRecovery: Boolean(job?.restored) || Number(job?.rowMisses || 0) >= 2,
      };
    });
    const statuses = await Promise.race([
      frame.executeJavaScript(`(() => {
        const expectedJobs = ${JSON.stringify(expectedJobs)};
        const usable = (element) => Boolean(element && element.isConnected);
        const textOf = (element) => String(element?.textContent || element?.innerText || "")
          .replace(/\\s+/g, " ").trim();
        const downloadControlIn = (row) => [...row.querySelectorAll("a, button, [role='button'], [class*='download'], [class*='Download'], span, div")]
          .filter(usable)
          .filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true")
          .filter((element) => /다운로드|download/i.test([
            textOf(element), element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("href"),
          ].filter(Boolean).join(" ")))
          .sort((left, right) => textOf(left).length - textOf(right).length)[0] || null;
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
          const workStateText = cellTexts.find((value) => /^(?:성공|success|completed|실패|failed|error)$/i.test(value)) || "";
          const control = downloadControlIn(row);
          const rowJobId = String(cellTexts[0] || rowText).match(/\b\d{7,}\b/)?.[0] || "";
          const failed = /^(?:실패|failed|error)$/i.test(workStateText)
            || /(?:^|\s)(?:실패|failed|error)(?:\s|$)/i.test(rowText);
          return { row, rowText, cells, dates, workStateText, control, rowJobId, failed, startAt: parseDate(dates[0]) };
        });
        return expectedJobs.map((expected) => {
          const { jobId } = expected;
          let row = findJobContainer(jobId);
          const directParsed = parsedRows.find((item) => item.row === row);
          const failedDirectRow = directParsed?.failed ? row : null;
          if (failedDirectRow) row = null;
          let recovered = false;
          if (!row && expected.allowTimeRecovery && expected.createdAt > 0) {
            const referenceAt = expected.restored && expected.restoredAt > 0
              ? expected.restoredAt
              : expected.createdAt;
            const lowerBound = expected.restored ? referenceAt - 15 * 60_000 : expected.createdAt - 5 * 60_000;
            const upperBound = expected.restored ? referenceAt + 5_000 : expected.createdAt + 5_000;
            const candidates = parsedRows.filter((item) => !usedRows.has(item.row)
              && item.control
              && /^(?:성공|success|completed)$/i.test(item.workStateText)
              && item.dates.length > 0
              && item.startAt >= lowerBound
              // POIZON creates the export row before Around G registers it.
              // Reject later rows so adjacent brand jobs cannot be swapped.
              && item.startAt <= upperBound)
              .sort((left, right) => Math.abs(left.startAt - referenceAt) - Math.abs(right.startAt - referenceAt));
            row = candidates[0]?.row || null;
            recovered = Boolean(row);
          }
          if (!row && failedDirectRow) {
            return { jobId, state: "FAILED", workStateText: directParsed?.workStateText || "실패" };
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
          const recoveredJobId = recovered
            ? (String(cellTexts[0] || rowText).match(/\b\d{7,}\b/)?.[0] || "")
            : "";
          const jobNumberMatched = recovered || compactNumber(rowText).includes(compactNumber(jobId));
          const workSucceeded = /^(?:성공|success|completed)$/i.test(workStateText);
          const completionConfirmed = /\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?/.test(completionText);
          if (!jobNumberMatched) return { jobId, state: "WAITING_FOR_ROW" };
          if (/처리\\s*중|processing|pending|진행\\s*중/i.test(workStateText || rowText)) {
            return { jobId, state: "PROCESSING", workStateText, completionText };
          }
          if (!workSucceeded) return { jobId, state: "WAITING_FOR_SUCCESS", workStateText, completionText };
          if (!completionConfirmed) return { jobId, state: "WAITING_FOR_COMPLETION", workStateText, completionText };
          const control = downloadControlIn(row);
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
            startAtMs: parseDate(startText),
            recovered,
            recoveredJobId,
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

async function replaceRecoveredBrandExportJobId(previousJobId, recoveredJobId, job, status = {}) {
  const previousId = String(previousJobId || "").trim();
  const nextId = String(recoveredJobId || "").trim();
  if (!previousId || !nextId || previousId === nextId || brandExportJobs.has(nextId)) return previousId;
  brandExportJobs.delete(previousId);
  const recovered = {
    ...job,
    jobId: nextId,
    createdAt: Number(status.startAtMs || job?.createdAt || Date.now()),
    restored: true,
    restoredAt: Number(job?.restoredAt || Date.now()),
  };
  brandExportJobs.set(nextId, recovered);
  const saved = savedBrandExportJobs();
  const previousSaved = saved.find((item) => String(item?.jobId || "").trim() === previousId) || {};
  await store.setSettings({
    brandExportJobCache: [
      { ...previousSaved, ...recovered, lastDownloadedAt: 0, terminalState: "" },
      ...saved.filter((item) => ![previousId, nextId].includes(String(item?.jobId || "").trim())),
    ].slice(0, 500),
  });
  return nextId;
}

async function finishFailedBrandExportJob(jobId, job) {
  const failedAt = Date.now();
  brandExportJobs.delete(jobId);
  const saved = savedBrandExportJobs();
  const previous = saved.find((item) => String(item?.jobId || "").trim() === String(jobId)) || {};
  await store.setSettings({
    brandExportJobCache: [
      { ...previous, ...job, jobId, terminalState: "failed", terminalAt: failedAt },
      ...saved.filter((item) => String(item?.jobId || "").trim() !== String(jobId)),
    ].slice(0, 500),
  });
  mainWindow?.webContents.send("brand-export:error", {
    brandName: job?.brandName || "",
    jobId,
    jobState: "POIZON 작업 실패 확인 · 감시 종료",
    message: `${job?.brandName || "선택 브랜드"} · 작업번호 ${jobId}는 POIZON에서 실패로 확인되어 무한 감시를 종료했습니다.`,
  });
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
      const downloadControlIn = (row) => [...row.querySelectorAll("a, button, [role='button'], [class*='download'], [class*='Download'], span, div")]
        .filter(usable)
        .filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true")
        .filter((element) => /다운로드|download/i.test([
          textOf(element), element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("href"),
        ].filter(Boolean).join(" ")))
        .sort((left, right) => textOf(left).length - textOf(right).length)[0] || null;
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
      const control = downloadControlIn(row);
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
        const previousJobId = String(status.jobId || "").trim();
        const recoveredJobId = String(status.recoveredJobId || "").trim();
        const job = brandExportJobs.get(previousJobId);
        if (job && recoveredJobId && recoveredJobId !== previousJobId) {
          const nextJobId = await replaceRecoveredBrandExportJobId(previousJobId, recoveredJobId, job, status);
          status.previousJobId = previousJobId;
          status.jobId = nextJobId;
          mainWindow?.webContents.send("brand-export:progress", {
            status: "monitoring",
            monitorSource: "dedicated-window",
            brandName: job.brandName,
            jobId: nextJobId,
            jobState: "재시작 복구 · 최신 성공 작업번호 자동 연결",
            message: `${job.brandName} · 저장된 작업번호 ${previousJobId} 대신 최신 성공 작업번호 ${nextJobId}를 연결했습니다.`,
          });
        }
      }
      for (const status of statuses) {
        const job = brandExportJobs.get(status.jobId);
        if (!job) continue;
        if (status.state === "FAILED") {
          if (activeBrandDownloadJobId === status.jobId) activeBrandDownloadJobId = "";
          await finishFailedBrandExportJob(status.jobId, job);
          continue;
        }
        if (status.state === "WAITING_FOR_ROW") job.rowMisses = Number(job.rowMisses || 0) + 1;
        else job.rowMisses = 0;
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
  const datePattern = /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/g;
  const parseDate = (value) => {
    const parts = String(value || "").match(/\d+/g)?.map(Number) || [];
    if (parts.length < 5) return 0;
    return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] || 0).getTime();
  };
  for (const element of candidates) {
    const text = textOf(element);
    if (!text || text.length > 2400) continue;
    const cells = [...element.querySelectorAll("td, [role='cell'], [role='gridcell']")];
    const cellTexts = cells.map(textOf);
    const firstCellText = textOf(cells[0]);
    const id = firstCellText.match(/\\b\\d{7,}\\b/)?.[0]
      || text.match(/\\b\\d{7,}\\b/)?.[0]
      || "";
    if (!id || seen.has(id)) continue;
    const rowHint = cells.length >= 2
      || /내보내기|다운로드|작업|export|download|task|导出|下载|任务|처리|成功/i.test(text);
    if (!rowHint) continue;
    const workStateText = cellTexts.find((value) => /^(?:성공|success|completed|실패|failed|error)$/i.test(value)) || "";
    const failed = /^(?:실패|failed|error)$/i.test(workStateText);
    const succeeded = /^(?:성공|success|completed)$/i.test(workStateText);
    const dates = cellTexts.flatMap((value) => value.match(datePattern) || []);
    const startText = dates[0] || "";
    const startAtMs = parseDate(startText);
    seen.add(id);
    jobs.push({ id, fingerprint: id, text: text.slice(0, 500), workStateText, failed, succeeded, startText, startAtMs });
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

// The long-lived hidden monitor can keep a stale SPA table even after a hard
// reload. Open a short-lived window in the same authenticated partition so a
// newly-created POIZON export row cannot be missed and orphaned from its brand.
async function readSellerExportJobsFreshly() {
  return readSellerExportBaselineSeparately();
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

async function findDownloadedFileForPendingBrandExport(saved, entries = []) {
  const jobId = String(saved?.jobId || "").trim();
  const brandName = String(saved?.brandName || "").trim();
  const brandKo = String(saved?.brandKo || "").trim();
  const createdAt = Number(saved?.createdAt || 0);
  const candidates = (await Promise.all((entries || [])
    .filter((entry) => !isProcessedBrandExportName(entry.name) && !isPartialBrandExportName(entry.name))
    .map(async (entry) => ({ entry, info: await stat(entry.path).catch(() => null) }))))
    .filter(({ info }) => info && info.size > 0 && info.mtimeMs >= createdAt - 5 * 60_000)
    .sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);
  const exact = candidates.find(({ entry }) => {
    const folderMeta = parseBrandExportFolderName(basename(entry.directory));
    return String(folderMeta.jobId || "") === jobId
      || new RegExp(`(?:^|\\D)${jobId}(?:\\D|$)`).test(entry.name);
  });
  if (exact) return exact;
  for (const candidate of candidates) {
    const integrity = await validateBrandExportFile(candidate.entry.path, [brandName, brandKo].filter(Boolean))
      .catch(() => null);
    if (integrity?.ok) return candidate;
  }
  return null;
}

async function restorePendingBrandExportJobs() {
  const cutoff = Date.now() - RESTORED_PENDING_JOB_MAX_AGE_MS;
  const savedJobs = savedBrandExportJobs();
  const folder = currentBrandExportFolder();
  await mkdir(folder, { recursive: true });
  const entries = await listBrandExportExcelEntries(folder).catch(() => []);
  mainWindow?.webContents.send("startup-recovery:progress", {
    percent: 92,
    message: `중단된 POIZON 작업 ${savedJobs.length}개를 확인하고 있습니다.`,
    current: 0,
    total: savedJobs.length,
  });
  const reconciledCache = [];
  for (let index = 0; index < savedJobs.length; index += 1) {
    const saved = savedJobs[index];
    mainWindow?.webContents.send("startup-recovery:progress", {
      percent: 92 + Math.round(((index + 1) / Math.max(1, savedJobs.length)) * 6),
      message: `중단된 POIZON 작업 확인 ${index + 1}/${savedJobs.length}`,
      current: index + 1,
      total: savedJobs.length,
    });
    const jobId = String(saved?.jobId || "").trim();
    const brandName = String(saved?.brandName || "").trim();
    const createdAt = Number(saved?.createdAt || 0);
    const lastDownloadedAt = Number(saved?.lastDownloadedAt || 0);
    const terminalState = String(saved?.terminalState || "").trim();
    if (!jobId || !brandName || lastDownloadedAt > 0 || terminalState || createdAt < cutoff) {
      reconciledCache.push(saved);
      continue;
    }
    const completedFile = await findDownloadedFileForPendingBrandExport(saved, entries);
    if (completedFile) {
      brandExportJobs.delete(jobId);
      const completed = {
        ...saved,
        lastDownloadedAt: Number(completedFile.info.mtimeMs || Date.now()),
        filePath: completedFile.entry.path,
        fileName: completedFile.entry.name,
        fileMtimeMs: Number(completedFile.info.mtimeMs || 0),
        terminalState: "",
      };
      reconciledCache.push(completed);
      mainWindow?.webContents.send("brand-export:progress", {
        status: "startup-file-recovered",
        brandName,
        jobId,
        jobState: "프로그램 시작 복구 · 기존 Excel 확인완료",
        message: `${brandName} · 작업번호 ${jobId}의 기존 다운로드 파일을 확인해 반복 감시를 건너뜁니다.`,
      });
      continue;
    }
    reconciledCache.push(saved);
    brandExportJobs.set(jobId, {
      jobId,
      brandName,
      brandKo: String(saved?.brandKo || "").trim(),
      createdAt,
      expectedProductCount: Number(saved?.expectedProductCount || 0),
      downloadStarted: false,
      downloadRequestedAt: 0,
      restored: true,
      restoredAt: Date.now(),
    });
  }
  if (JSON.stringify(reconciledCache) !== JSON.stringify(savedJobs)) {
    await store.setSettings({ brandExportJobCache: reconciledCache.slice(0, 500) });
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

function recoverableSavedBrandExportJob(brandName = "", brandKo = "", currentJobs = []) {
  const visibleJobIds = new Set((currentJobs || [])
    .map((job) => String(job?.id || "").trim())
    .filter(Boolean));
  const cutoff = Date.now() - RESTORED_PENDING_JOB_MAX_AGE_MS;
  const sameNonEmptyBrand = (left = "", right = "") => Boolean(String(left || "").trim())
    && Boolean(String(right || "").trim())
    && brandsMatch(left, right);
  return savedBrandExportJobs()
    .map((job) => ({
      ...job,
      jobId: String(job?.jobId || "").trim(),
      brandName: String(job?.brandName || "").trim(),
      brandKo: String(job?.brandKo || "").trim(),
      createdAt: Number(job?.createdAt || 0),
      lastDownloadedAt: Number(job?.lastDownloadedAt || 0),
      terminalState: String(job?.terminalState || "").trim(),
    }))
    .filter((job) => job.jobId
      && visibleJobIds.has(job.jobId)
      && job.lastDownloadedAt === 0
      && !job.terminalState
      && !currentJobs.find((current) => String(current?.id || "").trim() === job.jobId)?.failed
      && job.createdAt >= cutoff
      && (sameNonEmptyBrand(job.brandName, brandName)
        || sameNonEmptyBrand(job.brandKo, brandName)
        || sameNonEmptyBrand(job.brandName, brandKo)
        || sameNonEmptyBrand(job.brandKo, brandKo)))
    .sort((left, right) => right.createdAt - left.createdAt)[0] || null;
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

async function sellerAuthenticationState() {
  if (!sellerWindow || sellerWindow.isDestroyed()) return { login: false, authenticated: false, loading: false };
  const url = String(sellerWindow.webContents.getURL() || "");
  // Do not treat an empty/loading shell or an unrelated transient URL as a
  // login form.  The old search flow reused the persistent Seller Center
  // session and only authenticated when POIZON actually displayed its login
  // route or a visible password form.  Misclassifying a blank component as a
  // login page made the physical Ctrl+A/paste fallback run against the product
  // screen and was the main source of repeated authentication and timeouts.
  if (/login|signin|passport|auth/i.test(url)) return { login: true, authenticated: false, loading: false };
  let sawContent = false;
  for (const frame of sellerWindowFrames()) {
    const state = await executeSellerFrameWithTimeout(frame, `(() => {
      const roots = [document];
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
        }
      }
      const queryAll = (selector) => roots.flatMap((root) => [...root.querySelectorAll(selector)]);
      const visible = (element) => {
        const rect = element?.getBoundingClientRect?.();
        const style = element ? getComputedStyle(element) : null;
        return Boolean(rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden');
      };
      const text = String(document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 5000);
      const password = queryAll('input[type="password"],input[autocomplete="current-password"]').some(visible);
      const loginText = /로그인|登录|登入|sign\\s*in|log\\s*in/i.test(text);
      const authenticated = /상품\\s*및\\s*입찰\\s*분석|상품\\s*검색|전체\\s*시장\\s*데이터|商品(?:及竞价分析|搜索)|下载中心|주문\\s*관리/i.test(text);
      return { password, loginText, authenticated, hasContent: text.trim().length > 20 };
    })()`, 4_000, { password: false, loginText: false, authenticated: false, hasContent: false });
    sawContent ||= Boolean(state?.hasContent);
    if (state?.password || (state?.loginText && !state?.authenticated)) {
      return { login: true, authenticated: false, loading: false };
    }
    if (state?.authenticated) return { login: false, authenticated: true, loading: false };
  }
  return { login: false, authenticated: false, loading: !sawContent };
}

async function sellerPageRequiresLogin() {
  return Boolean((await sellerAuthenticationState()).login);
}

async function waitForSellerAuthenticationState(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let state = { login: false, authenticated: false, loading: true };
  while (Date.now() < deadline) {
    state = await sellerAuthenticationState();
    if (state.login || state.authenticated) return state;
    await wait(750);
  }
  return state;
}

async function setSellerLoginStatusOverlay(state = "checking", title = "", detail = "") {
  if (!sellerWindow || sellerWindow.isDestroyed()) return;
  const colors = {
    checking: ["#2563eb", "#eff6ff"],
    filling: ["#d97706", "#fffbeb"],
    success: ["#059669", "#ecfdf5"],
    error: ["#dc2626", "#fef2f2"],
  };
  const [accent, background] = colors[state] || colors.checking;
  const script = `(() => {
    let panel = document.getElementById("around-g-login-status");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "around-g-login-status";
      panel.style.cssText = "position:fixed;z-index:2147483647;right:24px;top:24px;width:320px;box-sizing:border-box;padding:15px 17px;border-radius:12px;font-family:Arial,'Malgun Gothic',sans-serif;box-shadow:0 10px 35px rgba(0,0,0,.28);";
      document.documentElement.appendChild(panel);
    }
    panel.style.border = "2px solid " + ${JSON.stringify(accent)};
    panel.style.background = ${JSON.stringify(background)};
    panel.style.color = "#172033";
    panel.innerHTML = '<strong style="display:block;color:${String(accent)};font-size:15px;margin-bottom:6px"></strong><span style="display:block;font-size:12px;line-height:1.5"></span>';
    panel.querySelector("strong").textContent = ${JSON.stringify(title)};
    panel.querySelector("span").textContent = ${JSON.stringify(detail)};
    return true;
  })()`;
  await executeSellerFrameWithTimeout(sellerWindow.webContents.mainFrame, script, 3_000, false).catch(() => false);
}

async function submitStoredSellerCredentialsWithAccessibility(loginId, password) {
  if (!sellerWindow || sellerWindow.isDestroyed()) return { ok: false, step: "SELLER_WINDOW_CLOSED" };
  const client = sellerWindow.webContents.debugger;
  let attachedHere = false;
  try {
    if (!client.isAttached()) {
      client.attach("1.3");
      attachedHere = true;
    }
    await client.sendCommand("Accessibility.enable");
    const pageTree = await client.sendCommand("Page.getFrameTree");
    const frameIds = [];
    const collectFrames = (entry) => {
      if (entry?.frame?.id) frameIds.push(entry.frame.id);
      for (const child of entry?.childFrames || []) collectFrames(child);
    };
    collectFrames(pageTree?.frameTree);
    const axTrees = await Promise.all((frameIds.length ? frameIds : [undefined]).map((frameId) =>
      client.sendCommand("Accessibility.getFullAXTree", frameId ? { frameId } : {})
        .catch(() => ({ nodes: [] }))
    ));
    const nodes = axTrees.flatMap((tree) => Array.isArray(tree?.nodes) ? tree.nodes : [])
      .filter((node) => !node.ignored && node.backendDOMNodeId);
    const role = (node) => String(node?.role?.value || "").toLowerCase();
    const label = (node) => [
      node?.name?.value,
      node?.description?.value,
      ...(node?.properties || []).map((property) => property?.value?.value),
    ].filter(Boolean).join(" ");
    const textboxes = nodes.filter((node) => /textbox|textfield|input/.test(role(node)));
    const passwordNode = textboxes.find((node) => /비밀번호|password|密码|passcode/i.test(label(node)));
    const idNode = textboxes.find((node) =>
      node !== passwordNode && /휴대폰|전화|이메일|아이디|phone|email|account|username|手机号|邮箱|账号/i.test(label(node))
    ) || textboxes.find((node) => node !== passwordNode);
    const loginButton = nodes.find((node) =>
      /button|link/.test(role(node)) && /로그인|登录|登入|sign\s*in|log\s*in/i.test(label(node))
    );
    if (!idNode || !passwordNode) {
      return { ok: false, step: "ACCESSIBILITY_LOGIN_INPUTS_NOT_FOUND", axNodes: nodes.length, textboxes: textboxes.length };
    }
    const replaceFocusedText = async (node, value) => {
      await client.sendCommand("DOM.focus", { backendNodeId: node.backendDOMNodeId });
      await client.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2 });
      await client.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
      await client.sendCommand("Input.insertText", { text: value });
      await wait(150);
    };
    await replaceFocusedText(idNode, loginId);
    await replaceFocusedText(passwordNode, password);
    if (!loginButton) return { ok: false, filled: true, step: "ACCESSIBILITY_LOGIN_BUTTON_NOT_FOUND" };
    await client.sendCommand("DOM.focus", { backendNodeId: loginButton.backendDOMNodeId });
    await client.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter" });
    await client.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
    return { ok: true, filled: true, step: "ACCESSIBILITY_CREDENTIALS_SUBMITTED" };
  } catch (error) {
    return { ok: false, step: "ACCESSIBILITY_LOGIN_FAILED", reason: String(error?.message || error || "") };
  } finally {
    if (attachedHere && client.isAttached()) {
      try { client.detach(); } catch {}
    }
  }
}


async function submitStoredSellerCredentialsWithRealMouse(loginId, password) {
  if (!sellerWindow || sellerWindow.isDestroyed()) return { ok: false, step: "SELLER_WINDOW_CLOSED" };
  let previousClipboard = "";
  try {
    const viewport = await executeSellerFrameWithTimeout(
      sellerWindow.webContents.mainFrame,
      "({ width: Math.round(innerWidth), height: Math.round(innerHeight) })",
      3_000,
      null
    );
    const width = Number(viewport?.width || 0);
    const height = Number(viewport?.height || 0);
    if (width < 800 || height < 500) {
      return { ok: false, step: "REAL_MOUSE_VIEWPORT_TOO_SMALL", width, height };
    }
    if (sellerWindow.isMinimized()) sellerWindow.restore();
    sellerWindow.show();
    sellerWindow.focus();
    const contents = sellerWindow.webContents;
    previousClipboard = clipboard.readText();
    const click = async (xRatio, yRatio) => {
      const x = Math.round(width * xRatio);
      const y = Math.round(height * yRatio);
      contents.sendInputEvent({ type: "mouseMove", x, y });
      contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
      contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
      await wait(180);
    };
    const paste = async (value) => {
      contents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
      contents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
      clipboard.writeText(value);
      contents.sendInputEvent({ type: "keyDown", keyCode: "V", modifiers: ["control"] });
      contents.sendInputEvent({ type: "keyUp", keyCode: "V", modifiers: ["control"] });
      await wait(250);
    };
    // POIZON seller login card stays at these responsive viewport ratios.
    await click(0.72, 0.30);
    await paste(loginId);
    await click(0.72, 0.365);
    await paste(password);
    await click(0.72, 0.428);
    return { ok: true, filled: true, step: "REAL_MOUSE_CREDENTIALS_SUBMITTED" };
  } catch (error) {
    return { ok: false, step: "REAL_MOUSE_LOGIN_FAILED", reason: String(error?.message || error || "") };
  } finally {
    try { clipboard.writeText(previousClipboard); } catch {}
  }
}

async function submitStoredSellerCredentials() {
  const settings = store.snapshot().settings || {};
  const loginId = String(settings.poizonLoginId || "").trim();
  let password = "";
  try {
    password = decrypted(settings.poizonPasswordEncrypted);
  } catch {
    await setSellerLoginStatusOverlay("error", "저장 비밀번호 확인 실패", "연동 관리에서 POIZON 비밀번호를 다시 저장해 주세요.");
    return { ok: false, stored: false, step: "PASSWORD_DECRYPT_FAILED" };
  }
  if (!loginId || !password) {
    await setSellerLoginStatusOverlay("error", "POIZON 계정 저장 필요", "Around G POIZON의 연동 관리에서 아이디와 비밀번호를 암호화 저장해 주세요.");
    return { ok: false, stored: false, step: "STORED_CREDENTIALS_MISSING" };
  }
  if (!sellerWindow || sellerWindow.isDestroyed()) return { ok: false, stored: true, step: "SELLER_WINDOW_CLOSED" };
  await setSellerLoginStatusOverlay("checking", "저장 계정 확인 완료", "로그인 입력칸을 찾고 있습니다.");
  let lastResult = { ok: false, step: "LOGIN_INPUTS_NOT_FOUND" };
  for (const frame of sellerWindowFrames()) {
    const result = await executeSellerFrameWithTimeout(frame, `(async () => {
      const roots = [document];
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
        }
      }
      const queryAll = (selector) => roots.flatMap((root) => [...root.querySelectorAll(selector)]);
      const visible = (element) => {
        if (!element || element.disabled) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const passwordInput = queryAll('input[type="password"], input[autocomplete="current-password"]').find(visible);
      const idInputs = queryAll('input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[autocomplete="username"]').filter(visible);
      const idInput = idInputs.find((element) => /user|account|email|phone|login|아이디|휴대폰|이메일|전화번호|账号|帐号|手机号/i.test([
        element.name, element.id, element.placeholder, element.autocomplete,
      ].join(' '))) || idInputs[0];
      if (!idInput || !passwordInput) return { ok: false, step: 'LOGIN_INPUTS_NOT_FOUND', inputs: idInputs.length, passwords: passwordInput ? 1 : 0 };
      const setValue = (element, value) => {
        element.focus();
        const prototype = Object.getPrototypeOf(element);
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter ? setter.call(element, value) : (element.value = value);
        element.setAttribute('value', value);
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true, key: 'Unidentified' }));
        element.blur();
      };
      setValue(idInput, ${JSON.stringify(loginId)});
      setValue(passwordInput, ${JSON.stringify(password)});
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!String(idInput.value || '').trim() || !String(passwordInput.value || '')) {
        return { ok: false, step: 'LOGIN_VALUES_REJECTED' };
      }
      const buttons = queryAll('button, input[type="submit"], [role="button"], a').filter(visible);
      const submit = buttons.find((element) => /로그인|登录|登入|sign\\s*in|log\\s*in/i.test(String(element.innerText || element.textContent || element.value || element.getAttribute('aria-label') || '')))
        || buttons.find((element) => element.type === 'submit')
        || idInput.closest('form')?.querySelector('button, input[type="submit"]');
      if (!submit) return { ok: false, step: 'LOGIN_BUTTON_NOT_FOUND', filled: true };
      if (submit.disabled) return { ok: false, step: 'LOGIN_BUTTON_DISABLED', filled: true };
      submit.focus();
      submit.click();
      return { ok: true, step: 'STORED_CREDENTIALS_SUBMITTED', filled: true };
    })()`, 7_000, { ok: false, step: "LOGIN_FRAME_TIMEOUT" });
    lastResult = result || lastResult;
    if (result?.filled) {
      await setSellerLoginStatusOverlay(
        result.ok ? "filling" : "error",
        result.ok ? "ID·비밀번호 자동 입력 완료" : "로그인 버튼 확인 필요",
        result.ok ? "로그인 버튼을 눌렀습니다. 판매자센터 진입을 확인하고 있습니다." : `입력은 완료했지만 버튼 실행에 실패했습니다. (${result.step || "UNKNOWN"})`
      );
    }
    if (result?.ok) return { ...result, stored: true };
  }
  const accessibilityResult = await submitStoredSellerCredentialsWithAccessibility(loginId, password);
  if (accessibilityResult?.filled) {
    await setSellerLoginStatusOverlay(
      accessibilityResult.ok ? "filling" : "error",
      accessibilityResult.ok ? "ID·비밀번호 실제 입력 완료" : "로그인 버튼 확인 필요",
      accessibilityResult.ok
        ? "POIZON 화면 요소를 직접 찾아 입력했습니다. 판매자센터 진입을 확인하고 있습니다."
        : `입력은 완료했지만 버튼 실행에 실패했습니다. (${accessibilityResult.step || "UNKNOWN"})`
    );
  }
  if (accessibilityResult?.ok) return { ...accessibilityResult, stored: true };
  const realMouseResult = await submitStoredSellerCredentialsWithRealMouse(loginId, password);
  if (realMouseResult?.ok) {
    await setSellerLoginStatusOverlay(
      "filling",
      "ID·비밀번호 실제 마우스 입력 완료",
      "로그인 버튼을 직접 눌렀습니다. 판매자센터 진입을 확인하고 있습니다."
    );
    return { ...realMouseResult, stored: true };
  }
  await setSellerLoginStatusOverlay(
    "error",
    "로그인 실제 입력 실패",
    `저장 계정의 실제 마우스 입력을 다시 시도합니다. (${realMouseResult?.step || accessibilityResult?.step || lastResult.step || "UNKNOWN"})`
  );
  return { ...(realMouseResult || accessibilityResult || lastResult), ok: false, stored: true };
}

async function sellerProductSearchPageState() {
  if (!sellerWindow || sellerWindow.isDestroyed()) {
    return { ready: false, failed: false, frame: null, url: "" };
  }
  for (const frame of sellerWindowFrames()) {
    const state = await executeSellerFrameWithTimeout(frame, `(() => {
      const visible = (element) => element && element.getClientRects().length > 0;
      const textOf = (element) => String(element?.innerText || element?.textContent || "")
        .replace(/\\s+/g, " ").trim();
      const body = String(document.body?.innerText || "");
      const failed = /Page\\s*Not\\s*Found|Component\\s*Key\\s*Error|Load\\s*Component\\s*Timeout|请求超时/i.test(body);
      const input = [...document.querySelectorAll("input,textarea")]
        .filter(visible).find((element) => !element.disabled && !element.readOnly);
      const search = [...document.querySelectorAll("button,[role='button']")]
        .filter(visible).find((element) => /검색\\s*및\\s*입찰|商品.{0,8}(?:搜索|查询)/i.test(textOf(element)));
      return { ready: !failed && Boolean(input && search), failed, url: location.href };
    })()`, 3_000, { ready: false, failed: false, url: "" });
    if (state?.ready) return { ...state, frame };
    if (state?.failed) return { ...state, frame: null };
  }
  return {
    ready: false,
    failed: false,
    frame: null,
    url: String(sellerWindow.webContents.getURL() || ""),
  };
}

async function enterSellerProductSearchViaMenu({ forceHome = false } = {}) {
  if (!sellerWindow || sellerWindow.isDestroyed()) return false;
  const recoverSellerHome = async () => {
    const homeClick = await physicalClickSellerElement(sellerWindow.webContents.mainFrame, `
      return [...document.querySelectorAll("a,button,[role='button'],span")]
        .filter(visible)
        .find((element) => /^(?:홈페이지로\\s*돌아가기|返回首页|回到首页)$/.test(textOf(element)))
        ?.closest("a,button,[role='button']") || null;
    `, "PHYSICAL_SELLER_HOME_RECOVERY", 5_000);
    if (!homeClick.ok) return false;
    await wait(2_500);
    return true;
  };
  let state = await sellerProductSearchPageState();
  if (!forceHome && state.ready) return true;
  let recoveredFromFailedPage = false;
  if (state.failed) {
    recoveredFromFailedPage = await recoverSellerHome();
  }
  const currentUrl = String(sellerWindow.webContents.getURL() || "");
  const authentication = await sellerAuthenticationState();
  // Keep the page that POIZON opened after a successful login. Reloading the
  // Seller Center root here discards that freshly established navigation and
  // sends the window back to the login card. The restored workflow expands
  // 상품 and clicks 상품 검색 in the authenticated page instead.
  if (!authentication.authenticated
      && ((forceHome && !recoveredFromFailedPage)
        || (state.failed && !recoveredFromFailedPage)
        || !currentUrl.includes("seller.poizon.com"))) {
    await sellerWindow.loadURL(SELLER_CENTER_URL).catch(() => {});
    await wait(2_500);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    state = await sellerProductSearchPageState();
    if (state.ready) return true;
    if (state.failed) {
      const recovered = await recoverSellerHome();
      if (!recovered) return false;
      state = await sellerProductSearchPageState();
      if (state.ready) return true;
    }
    const menuFrame = sellerWindow.webContents.mainFrame;
    const searchMenuVisible = await executeSellerFrameWithTimeout(menuFrame, `(() => {
      const visible = (element) => element && element.getClientRects().length > 0;
      const textOf = (element) => String(element?.innerText || element?.textContent || "")
        .replace(/\\s+/g, " ").trim();
      return [...document.querySelectorAll("a,button,[role='menuitem'],[role='button'],li,div,span")]
        .filter(visible).some((element) => /^(?:상품\\s*검색|商品搜索)$/.test(textOf(element)));
    })()`, 2_000, false);
    if (!searchMenuVisible) {
      const productMenu = await physicalClickSellerElement(menuFrame, `
        return [...document.querySelectorAll("a,button,[role='menuitem'],[role='button'],li,div,span")]
          .filter(visible)
          .filter((element) => /^(?:상품(?:\\s*및\\s*입찰\\s*분석)?|商品(?:及竞价分析)?)$/.test(textOf(element)))
          .sort((left, right) => {
            const a = left.getBoundingClientRect();
            const b = right.getBoundingClientRect();
            return a.width * a.height - b.width * b.height;
          })[0]?.closest("a,button,[role='menuitem'],[role='button'],li") || null;
      `, "PHYSICAL_PRODUCT_MENU", 5_000);
      if (productMenu.ok) await wait(800);
    }
    const searchMenu = await physicalClickSellerElement(menuFrame, `
      return [...document.querySelectorAll("a,button,[role='menuitem'],[role='button'],li,div,span")]
        .filter(visible)
        .filter((element) => /^(?:상품\\s*검색|商品搜索)$/.test(textOf(element)))
        .sort((left, right) => {
          const a = left.getBoundingClientRect();
          const b = right.getBoundingClientRect();
          return a.width * a.height - b.width * b.height;
        })[0]?.closest("a,button,[role='menuitem'],[role='button'],li") || null;
    `, "PHYSICAL_PRODUCT_SEARCH_MENU", 6_000);
    if (searchMenu.ok) {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        state = await sellerProductSearchPageState();
        if (state.ready) return true;
        if (state.failed) break;
        await wait(500);
      }
    }
    if (attempt < 2) {
      state = await sellerProductSearchPageState();
      if (state.failed) {
        if (!await recoverSellerHome()) return false;
      } else if (!(await sellerAuthenticationState()).authenticated) {
        await sellerWindow.loadURL(SELLER_CENTER_URL).catch(() => {});
        await wait(2_500);
      }
    }
  }
  return false;
}

async function ensureSellerLoginBeforeBrandSearch(brandName = "") {
  const initialState = await waitForSellerAuthenticationState();
  if (initialState.authenticated) return { ok: true, reused: true };
  if (!initialState.login) return { ok: false, code: "SELLER_LOGIN_PAGE_TIMEOUT" };
  if (!sellerWindow || sellerWindow.isDestroyed()) return { ok: false, code: "SELLER_WINDOW_CLOSED" };
  if (sellerWindow.isMinimized()) sellerWindow.restore();
  sellerWindow.show();
  sellerWindow.focus();
  let automatic = await submitStoredSellerCredentials();
  let lastAutoLoginAttemptAt = Date.now();
  mainWindow?.webContents.send("brand-export:progress", {
    status: "seller-login-waiting",
    brandName,
    jobState: automatic.ok ? "자동 로그인 중 · 완료 후 검색 재개" : "로그인 확인 대기 · 완료 후 검색 재개",
    message: automatic.ok
      ? `${brandName} · 암호화 저장된 계정으로 POIZON 자동 로그인을 진행합니다.`
      : `${brandName} · POIZON 로그인이 필요합니다. 로그인 후 브랜드 검색이 자동으로 이어집니다.`,
  });
  const deadline = Date.now() + SELLER_LOGIN_WAIT_MS;
  while (Date.now() < deadline) {
    await wait(1_000);
    if (!sellerWindow || sellerWindow.isDestroyed()) return { ok: false, code: "SELLER_WINDOW_CLOSED" };
    const pageState = await sellerAuthenticationState();
    if (pageState.login) {
      // The Korean login form is rendered asynchronously. Keep retrying the
      // encrypted credentials after its inputs appear instead of trying only
      // once while the page is still empty.
      if (Date.now() - lastAutoLoginAttemptAt >= 2_500) {
        automatic = await submitStoredSellerCredentials();
        lastAutoLoginAttemptAt = Date.now();
      }
      continue;
    }
    if (!pageState.authenticated) continue;
    await setSellerLoginStatusOverlay("success", "자동 로그인 테스트 성공 완료", "POIZON 판매자센터 진입을 확인했습니다. 브랜드 검색을 자동으로 계속합니다.");
    mainWindow?.webContents.send("brand-export:progress", {
      status: "seller-login-restored",
      brandName,
      jobState: "로그인 완료 · 브랜드 검색 자동 재개",
      message: `${brandName} · POIZON 로그인 완료 후 브랜드 검색을 자동으로 계속합니다.`,
    });
    return { ok: true, reused: false };
  }
  return { ok: false, code: "SELLER_LOGIN_TIMEOUT" };
}

function currentSellerProductFrame() {
  const frames = sellerWindowFrames();
  return frames.find((frame) => frame.routingId === sellerProductFrameRoutingId)
    || frames[0]
    || null;
}

async function detectSellerDailySearchLimit() {
  const patterns = [
    /(?:하루|일일|당일|오늘)[^\n]{0,80}?20\s*(?:번|회)[^\n]{0,80}?(?:가능|초과|제한|도달)/i,
    /20\s*(?:번|회)[^\n]{0,80}?(?:초과|제한|가능|도달)/i,
    /(?:每日|每天|今日)[^\n]{0,80}?20\s*次[^\n]{0,80}?(?:上限|限制|超过|已用完)/i,
    /20\s*次[^\n]{0,80}?(?:上限|限制|超过|已用完)/i,
  ];
  for (const frame of sellerWindowFrames()) {
    const notice = await executeSellerFrameWithTimeout(frame, `(() => {
      const text = String(document.body?.innerText || "").replace(/\\s+/g, " ").trim();
      const patterns = ${JSON.stringify(patterns.map((pattern) => pattern.source))}
        .map((source) => new RegExp(source, "i"));
      const matched = patterns.find((pattern) => pattern.test(text));
      return matched ? (text.match(matched)?.[0] || "DAILY_LIMIT") : "";
    })()`, 2_000, "").catch(() => "");
    if (notice) return { exceeded: true, notice: String(notice) };
  }
  return { exceeded: false, notice: "" };
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
    DAILY_SEARCH_LIMIT_EXCEEDED: "포이즌 검색 데이터는 하루 20번만 가능합니다. 오늘 사용 가능 횟수를 초과했습니다.",
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
    const confirmationPattern = /^(?:확인|내보내기|생성|확정|제출|계속|바로\s*가기|다운로드\s*센터.*바로\s*가기|确认|确定|提交|导出|继续)$/i;
    const cancelPattern = /취소|닫기|나중에|取消|关闭/i;
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
    const confirmPattern = /^(?:확인|내보내기|생성|확정|제출|계속|바로\s*가기|다운로드\s*센터.*바로\s*가기|确认|确定|提交|导出|继续)$/i;
    const cancelPattern = /취소|닫기|나중에|取消|关闭/i;
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

function moveWindowsCursorAndClick(screenX, screenY, hoverDelayMs = 0) {
  if (process.platform !== "win32") return Promise.resolve({ ok: false, reason: "WINDOWS_ONLY" });
  const x = Math.round(Number(screenX));
  const y = Math.round(Number(screenY));
  const hoverDelay = Math.max(0, Math.min(3_000, Math.round(Number(hoverDelayMs) || 0)));
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
Start-Sleep -Milliseconds ${hoverDelay}
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

async function physicalClickSellerElement(targetFrame, locatorScript, step, timeoutMs = 20_000) {
  if (!sellerWindow || sellerWindow.isDestroyed()) return { ok: false, step: `${step}_WINDOW_MISSING` };
  sellerWindow.showInactive();
  sellerWindow.webContents.focus();
  const startedAt = Date.now();
  let point = null;
  while (!point && Date.now() - startedAt < timeoutMs) {
    point = await targetFrame.executeJavaScript(`(() => {
        if (document.readyState === "loading") return null;
        const visible = (element) => element && element.getBoundingClientRect().width > 0
          && element.getBoundingClientRect().height > 0;
        const textOf = (element) => String(element?.innerText || element?.textContent || "")
          .replace(/\\s+/g, " ").trim();
        const element = (() => { ${locatorScript} })();
        if (!element || !visible(element)) return null;
        element.scrollIntoView?.({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          label: textOf(element),
          url: location.href,
        };
      })()`, true).catch(() => null);
    if (!point) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!point) return { ok: false, step: `${step}_NOT_FOUND` };
  const bounds = sellerWindow.getContentBounds();
  const clicked = await moveWindowsCursorAndClick(bounds.x + point.x, bounds.y + point.y);
  await new Promise((resolve) => setTimeout(resolve, 700));
  return clicked.ok
    ? { ok: true, step, label: point.label, url: point.url, physicalCursorMoved: true }
    : { ok: false, step: `${step}_CLICK_FAILED` };
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
  `, "BACKGROUND_LOCAL_SALES_SORT");
  if (!sort.ok) return sort;
  const descending = await physicalClickSellerElement(targetFrame, `
    return [...document.querySelectorAll("button,[role='button'],[role='menuitem'],li,span,div")]
      .filter(visible).find((element) => /^내림차순$/.test(textOf(element)));
  `, "BACKGROUND_DESCENDING");
  if (!descending.ok) return descending;
  const confirm = await physicalClickSellerElement(targetFrame, `
    const dialogs = [...document.querySelectorAll("[role='dialog'],.ant-popover,.ant-dropdown,.ant-modal")].filter(visible);
    const root = dialogs.at(-1) || document;
    return [...root.querySelectorAll("button,[role='button'],a,span")]
      .filter(visible).find((element) => /^확인$/.test(textOf(element)))?.closest("button,[role='button'],a") || null;
  `, "BACKGROUND_SORT_CONFIRM");
  if (!confirm.ok) return confirm;
  await new Promise((resolve) => setTimeout(resolve, 900));
  const exportClick = await physicalClickSellerElement(targetFrame, `
    return [...document.querySelectorAll("button,[role='button'],a,span")]
      .filter(visible).find((element) => /^전체\\s*내보내기$/.test(textOf(element)))?.closest("button,[role='button'],a") || null;
  `, "BACKGROUND_EXPORT");
  return exportClick.ok ? { ok: true, sort: "LOCAL_SELLER_RECENT_30_DAYS_DESC", exportClicked: true } : exportClick;
}

async function confirmSellerExportRequestPhysical(targetFrame) {
  // POIZON sometimes replaces the old one-button confirmation with a
  // completion popup containing "나중에 / 바로가기". In that layout,
  // "바로가기" both acknowledges the export and opens Download Center.
  const shortcut = await physicalClickSellerElement(targetFrame, `
    const dialogs = [...document.querySelectorAll(
      ".ant-modal,.ant-modal-confirm,[role='dialog'],.ant-popover,.ant-drawer,.semi-modal,.semi-portal"
    )].filter(visible);
    const dialog = dialogs.at(-1);
    if (!dialog) return null;
    return [...dialog.querySelectorAll("button,[role='button'],a,span")].filter(visible)
      .find((element) => /^(?:바로\s*가기|다운로드\s*센터.*바로\s*가기)$/.test(textOf(element)))
      ?.closest("button,[role='button'],a") || null;
  `, "PHYSICAL_EXPORT_DOWNLOAD_CENTER_SHORTCUT", 15_000);
  if (shortcut.ok) {
    return {
      ok: true,
      confirmationObserved: true,
      confirmationClicked: true,
      requestAcknowledged: true,
      downloadCenterClicked: true,
    };
  }
  const clicked = await physicalClickSellerElement(targetFrame, `
    const dialogs = [...document.querySelectorAll(
      ".ant-modal,.ant-modal-confirm,[role='dialog'],.ant-popover,.ant-drawer,.semi-modal,.semi-portal"
    )].filter(visible);
    const dialog = dialogs.at(-1);
    if (!dialog) return null;
    return [...dialog.querySelectorAll("button,[role='button'],a")].filter(visible)
      .find((element) => /^(?:확인|내보내기|생성|확정|제출|계속|确认|确定|提交|导出|继续)$/.test(textOf(element))) || null;
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
  const physicalClick = await moveWindowsCursorAndClick(
    Math.round(contentBounds.x + x),
    Math.round(contentBounds.y + y),
  );
  if (!physicalClick.ok) {
    return { ...verified, ok: false, step: "PHYSICAL_SEARCH_BUTTON_CLICK_FAILED" };
  }
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return {
    ...verified,
    submitted: true,
    physicalCursorMoved: true,
    background: false,
    step: "PHYSICAL_SEARCH_BUTTON_CLICKED",
  };
}

async function applyExactSellerBrandFilter(targetFrame, names = []) {
  const candidates = [...new Set((names || []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (!candidates.length) return { ok: false, step: "BRAND_FILTER_NAMES_MISSING" };
  return executeSellerFrameWithTimeout(targetFrame, `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getClientRects().length > 0;
    const textOf = (element) => String(element?.innerText || element?.textContent || "")
      .replace(/\\s+/g, " ").trim();
    const normalize = (value) => String(value || "").normalize("NFKC")
      .replace(/[^a-z0-9가-힣一-龥]+/gi, "").toLocaleLowerCase();
    const names = ${JSON.stringify(candidates)};
    const normalizedNames = names.map(normalize).filter(Boolean);
    const ownText = (element) => [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent).join("").trim();
    const brandLabel = [...document.querySelectorAll("button,[role=button],label,span,div")]
      .filter(visible)
      .filter((element) => ownText(element) === "브랜드" || textOf(element) === "브랜드")
      .sort((left, right) => left.getBoundingClientRect().width - right.getBoundingClientRect().width)[0];
    const brandButton = brandLabel?.closest(
      "button,[role=button],.ant-select,.ant-dropdown-trigger,.semi-select,.semi-dropdown-trigger"
    ) || brandLabel;
    if (!brandButton) return { ok: false, step: "EXACT_BRAND_BUTTON_NOT_FOUND" };
    brandButton.click();
    await wait(600);
    const popupSelector = '[role="tooltip"],[role="dialog"],.ant-popover,.ant-dropdown,.ant-select-dropdown,.semi-portal,.semi-popover,.semi-select-dropdown';
    const popup = [...document.querySelectorAll(popupSelector)].filter(visible).at(-1);
    if (!popup) return { ok: false, step: "EXACT_BRAND_POPUP_NOT_FOUND" };
    const input = [...popup.querySelectorAll("input")].find((element) =>
      visible(element) && !element.disabled && ["text", "search", ""].includes(element.type)
    );
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    for (const name of names) {
      if (input) {
        input.focus();
        setter ? setter.call(input, name) : (input.value = name);
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: name, inputType: "insertText" }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      let option = null;
      for (let attempt = 0; attempt < 24 && !option; attempt += 1) {
        await wait(250);
        const options = [...document.querySelectorAll(
          '.ant-popover:not(.ant-popover-hidden) li.ant-list-item,[role=option],.ant-select-item-option,.semi-select-option'
        )].filter(visible);
        option = options.find((element) => {
          const value = normalize(textOf(element));
          const requested = normalize(name);
          // Do not allow a parent brand to silently select a child brand.
          // In particular, "PUMA" must not match "PUMA KIDS" merely because
          // the option text starts with the requested value.
          return value === requested;
        });
      }
      if (!option) continue;
      option.click();
      await wait(350);
      const confirm = [...document.querySelectorAll("button,[role=button],a")]
        .filter(visible).find((element) => /^(확인|적용|검색)$/.test(textOf(element)));
      if (confirm) confirm.click();
      await wait(700);
      const search = [...document.querySelectorAll("button,[role=button]")]
        .filter(visible).find((element) => /^검색\\s*및\\s*입찰$/.test(textOf(element)));
      if (!search) return { ok: false, step: "EXACT_BRAND_SEARCH_BUTTON_NOT_FOUND" };
      search.click();
      let stable = 0;
      let signature = "";
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await wait(250);
        const rows = [...document.querySelectorAll("tbody tr")].filter(visible)
          .map(textOf).filter(Boolean);
        const matched = rows.filter((row) => normalizedNames.some((key) => normalize(row).includes(key)));
        const nextSignature = rows.slice(0, 20).join("|");
        if (rows.length && matched.length / rows.length >= 0.8) {
          stable = nextSignature === signature ? stable + 1 : 1;
          signature = nextSignature;
          if (stable >= 3) {
            return {
              ok: true,
              route: "EXACT_BRAND_FILTER",
              selected: textOf(option),
              inputValue: name,
              resultRowCount: rows.length,
              firstResult: rows[0] || "",
            };
          }
        } else {
          stable = 0;
          signature = "";
        }
      }
      return { ok: false, step: "EXACT_BRAND_RESULT_NOT_CONFIRMED", selected: textOf(option) };
    }
    return { ok: false, step: "EXACT_BRAND_OPTION_NOT_FOUND" };
  })()`, 35_000, { ok: false, step: "EXACT_BRAND_FILTER_TIMEOUT" });
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
  openSellerCenterWindow(SELLER_CENTER_URL, {
    visible: true,
    activate: true,
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
    // Start from the known working Seller Center data page where the left menu
    // is rendered. The bare /main route itself returns Component Key Error.
    await sellerWindow.loadURL(SELLER_CENTER_URL);
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
  await new Promise((resolve) => setTimeout(resolve, 3_500));
  const login = await ensureSellerLoginBeforeBrandSearch(brandName);
  if (!login.ok) {
    brandExportJobPending = false;
    pendingBrandExportName = "";
    return {
      ok: false,
      code: login.code || "SELLER_LOGIN_REQUIRED",
      message: login.code === "SELLER_LOGIN_TIMEOUT"
        ? `${brandName} · 10분 동안 로그인이 확인되지 않아 작업을 중단했습니다.`
        : `${brandName} · POIZON 로그인 창이 닫혀 작업을 중단했습니다.`,
    };
  }
  mainWindow?.webContents.send("brand-export:progress", {
    status: "seller-product-menu-clicking",
    brandName,
    jobState: "1단계/5 · 판매자센터 상품 메뉴 클릭 중",
    message: `${brandName} · 판매자센터 정상 데이터 화면에서 상품 → 상품 검색을 실제 마우스로 클릭합니다.`,
  });
  // The login success page already owns the valid Seller Center session.
  // Continue in that page and restore the old physical menu-click workflow.
  const productSearchOpened = await enterSellerProductSearchViaMenu();
  if (!productSearchOpened) {
    const pageState = await sellerProductSearchPageState();
    const diagnosticPath = await captureSellerDiagnostic(brandName, "physical-product-menu-failed");
    brandExportJobPending = false;
    pendingBrandExportName = "";
    return {
      ok: false,
      code: pageState.failed ? "SELLER_COMPONENT_LOAD_TIMEOUT" : "SELLER_PRODUCT_MENU_CLICK_FAILED",
      message: pageState.failed
        ? `${brandName} · 메뉴 클릭 후 POIZON 상품검색 구성요소가 열리지 않았습니다.`
        : `${brandName} · 판매자센터의 상품 → 상품 검색 메뉴를 실제 마우스로 클릭하지 못했습니다.`,
      diagnostics: { url: pageState.url, path: diagnosticPath },
    };
  }
  // Keep the same persistent Seller Center session visible while the restored
  // Windows cursor workflow performs brand search, sorting, and export.
  if (sellerWindow && !sellerWindow.isDestroyed()) {
    sellerWindow.showInactive();
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
  let baselineAvailable = Array.isArray(baselineJobs);
  const recoverableJob = recoverableSavedBrandExportJob(brandName, brandKo, baselineJobs || []);
  if (recoverableJob && !brandExportJobs.has(recoverableJob.jobId)) {
    brandExportJobs.set(recoverableJob.jobId, {
      jobId: recoverableJob.jobId,
      brandName,
      brandKo,
      createdAt: recoverableJob.createdAt,
      downloadStarted: false,
      expectedProductCount: Number(recoverableJob.expectedProductCount || 0),
      recovered: true,
      restoredAt: Date.now(),
    });
    brandExportJobPending = false;
    pendingBrandExportName = "";
    pendingBrandExportJobId = "";
    sellerWindow.showInactive();
    mainWindow?.webContents.send("brand-export:progress", {
      status: "job-created",
      brandName,
      jobId: recoverableJob.jobId,
      jobState: "중단 전 작업번호 복구 완료 · 다운로드 감시 재개",
      message: `${brandName} · 중단 전 작업번호 ${recoverableJob.jobId}를 다시 연결했습니다. 새 내보내기를 중복 생성하지 않고 다운로드를 이어갑니다.`,
    });
    if (!input.deferMonitor) void watchAllSellerExportJobsEveryTenSeconds();
    return {
      ok: true,
      folder,
      jobId: recoverableJob.jobId,
      expectedProductCount: Number(recoverableJob.expectedProductCount || 0),
      recovered: true,
    };
  }
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
    ["PUMA", "Puma", "푸마", "彪马"],
    ["On", "On Running", "온", "온러닝", "昂跑"],
    ["Polo Ralph Lauren", "POLO RALPH LAUREN", "폴로 랄프로렌", "랄프로렌", "拉夫劳伦"],
    ["Adidas Originals", "adidas Originals", "아디다스 오리지널스", "阿迪达斯", "三叶草"],
  ];
  const brandKoInput = String(input.brandKo || "").trim();
  const sellerOfficialRegistry = safeOfficialDomainRegistry(
    store.snapshot().settings.brandCatalog || explorerMetadata().brands
  );
  const sellerOfficialRecord = officialDomainRecordForBrand(sellerOfficialRegistry, brandName)
    || officialDomainRecordForBrand(sellerOfficialRegistry, brandKoInput);
  const sellerBrandMatchKeys = sellerBrandAliases({
    brandName,
    brandKo: brandKoInput,
    brandUrl: input.brandUrl,
    officialHomepageUrl: input.officialHomepageUrl || sellerOfficialRecord?.homepageUrl,
    officialAliases: officialDomainSearchAliases(sellerOfficialRecord),
  });
  const localizedAliases = sellerBrandAliasGroups.find((aliases) =>
    aliases.some((alias) => brandsMatch(brandName, alias) || brandsMatch(brandKoInput, alias))
  );
  if (localizedAliases) sellerBrandMatchKeys.push(...localizedAliases);
  if (brandsMatch(brandName, "Jordan")) {
    sellerBrandMatchKeys.push("Jordan", "조던", "乔丹");
  }
  const sellerBrandSearchName = brandsMatch(brandName, "On")
    ? "On Running"
    : preferredSellerBrandSearchName(sellerBrandMatchKeys);
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
        if (String(input.value || "").trim() !== ${JSON.stringify(sellerBrandSearchName)}) {
          applyValue("");
          await wait(160);
          applyValue(${JSON.stringify(sellerBrandSearchName)});
          await wait(700);
        }
        if (String(input.value || "").trim() !== ${JSON.stringify(sellerBrandSearchName)}) {
          return {
            ok: false,
            step: "BRAND_INPUT_NOT_APPLIED",
            actualInputValue: String(input.value || "").trim(),
            expectedInputValue: ${JSON.stringify(sellerBrandSearchName)},
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
              === normalize(${JSON.stringify(sellerBrandSearchName)}).toLocaleLowerCase();
            // A submitted input is not proof that POIZON changed the result.
            // Export only after the rendered product rows actually match the
            // requested brand; otherwise the previous brand can be exported.
            if (hasRows && brandMatched && requestedInputConfirmed) {
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
  let exportAcknowledgedAt = 0;
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
      // Restore the proven pre-module Seller Center route as one uninterrupted
      // operation: enter the brand in the visible product-search field, click
      // 검색 및 입찰, verify the result, sort, and export in the same window.
      const realKeyboardInput = await typeSellerBrandWithRealKeyboard(candidate.frame, sellerBrandSearchName)
        .catch(() => ({ ok: false, step: "REAL_KEYBOARD_INPUT_FAILED" }));
      if (sellerWindow && !sellerWindow.isDestroyed()) {
        sellerWindow.showInactive();
      }
      mainWindow?.webContents.send("brand-export:progress", {
        status: realKeyboardInput?.ok ? "seller-brand-input-confirmed" : "seller-brand-input-fallback",
        brandName,
        jobState: realKeyboardInput?.ok
          ? `1단계/5 · 상품검색 브랜드 입력 완료 · ${brandName}`
          : `1단계/5 · 상품검색 입력 재시도 · ${brandName}`,
        message: realKeyboardInput?.ok
          ? `${brandName} · 판매자센터 상단 상품검색 입력을 확인하고 검색 및 입찰을 실행합니다.`
          : `${brandName} · 실제 키보드 입력이 확인되지 않아 작업을 중단합니다.`,
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
        mainWindow?.webContents.send("brand-export:progress", {
          status: "waiting-for-seller-result-navigation",
          brandName,
          jobState: `2단계/5 · 결과 화면 전환 확인 중 · ${brandName}`,
          message: `${brandName} · POIZON 화면에서 실제 마우스로 결과 확인·정렬·내보내기를 진행합니다. 작업 중에는 마우스를 움직이지 마세요.`,
        });
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        const postSearch = await performPhysicalSellerSortAndExport(candidate.frame)
          .catch((error) => ({
            ok: false,
            step: "PHYSICAL_POST_SEARCH_FAILED",
            detail: String(error?.message || error || ""),
          }));
        if (postSearch?.ok) {
          sellerProductFrameRoutingId = candidate.frame.routingId;
          // POIZON can create the export job immediately when "전체 내보내기"
          // is clicked, before (or while) the confirmation UI is observed.
          // Never refresh the baseline here: a fast new job would be recorded
          // as an old job and could then never be linked to this brand. The
          // baseline frozen before product search remains authoritative, while
          // the confirmation timestamp below rejects genuinely old rows.
          // Clicking "전체 내보내기" only opens POIZON's confirmation
          // dialog. The old rebuilt path skipped this existing confirmation
          // helper and then waited three minutes for a job that had never
          // actually been submitted.
          const confirmationStartedAt = Date.now();
          const confirmation = await confirmSellerExportRequestPhysical(candidate.frame)
            .catch(() => ({
              ok: false,
              confirmationObserved: false,
              confirmationClicked: false,
              requestAcknowledged: false,
            }));
          // Follow the same proven Seller Center flow the user performs:
          // export -> confirm -> Download Center shortcut -> read the job row.
          // A separate hidden monitor can lag behind the live SPA session.
          if (!confirmation?.requestAcknowledged) {
            const dailyLimit = await detectSellerDailySearchLimit();
            searched = {
              ...result,
              ...postSearch,
              ...confirmation,
              ok: false,
              step: dailyLimit.exceeded ? "DAILY_SEARCH_LIMIT_EXCEEDED" : "EXPORT_CONFIRMATION_NOT_ACKNOWLEDGED",
              code: dailyLimit.exceeded ? "DAILY_SEARCH_LIMIT_EXCEEDED" : "EXPORT_CONFIRMATION_NOT_ACKNOWLEDGED",
              diagnostics: dailyLimit.exceeded ? { reason: dailyLimit.notice } : undefined,
            };
            break;
          }
          exportAcknowledgedAt = confirmationStartedAt;
          const downloadCenter = confirmation.downloadCenterClicked
            ? { ok: true, clicked: true, alreadyNavigated: true }
            : confirmation.confirmationClicked
            ? await clickSellerDownloadCenterShortcutPhysical(candidate.frame).catch(() => ({
              ok: false,
              clicked: false,
              code: "DOWNLOAD_CENTER_SHORTCUT_NOT_FOUND",
            }))
            : { ok: false, clicked: false, code: "EXPORT_CONFIRMATION_NOT_ACKNOWLEDGED" };
          searched = { ...result, ...postSearch, ...confirmation, downloadCenter, ok: true };
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

  // The current brand remains in the live Download Center until its job and
  // workbook are complete. The next queued brand opens a fresh product-search
  // page, so there is no reason to keep relying on a stale background table.
  if (sellerWindow && !sellerWindow.isDestroyed()) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    sellerWindow.hide();
    showCollectorWindow();
  }

  mainWindow?.webContents.send("brand-export:progress", {
    status: "seller-search-evidence",
    brandName,
    jobState: searched.confirmationClicked
      ? "2단계/5 · 내보내기 확인 완료 · 작업번호 생성 확인 중"
      : "2단계/5 · 전체 내보내기 클릭 · 작업번호 생성 확인 중",
    message: searched.confirmationClicked
      ? `${brandName} · 현지 30일 내림차순 · POIZON 내보내기 확인창 처리 완료 · 새 작업번호 확인 중`
      : `${brandName} · 전체 내보내기 클릭 완료 · 확인창 없이 작업번호가 생성되는지 확인 중`,
  });

  const completeness = {
    ok: true,
    expected: 0,
    pageCount: 0,
    confirmationObserved: Boolean(searched.confirmationObserved),
    confirmationClicked: Boolean(searched.confirmationClicked),
    requestAcknowledged: Boolean(searched.requestAcknowledged),
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
  let lateConfirmationChecked = Boolean(searched.confirmationClicked);
  let lastFreshReadAt = 0;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  while (Date.now() - verificationStartedAt < verificationTimeoutMs) {
    if (cleared()) break;
    const jobSources = await Promise.all([
      Promise.race([
        readSellerExportJobsFromMonitor(),
        new Promise((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]),
      Promise.race([
        readSellerExportJobs(),
        new Promise((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]),
    ]).catch(() => []);
    let currentJobs = [...new Map(jobSources
      .flatMap((jobs) => Array.isArray(jobs) ? jobs : [])
      .map((job) => [String(job?.id || "").trim(), job])
      .filter(([id]) => id)).values()];
    const elapsedMs = Date.now() - verificationStartedAt;
    if (elapsedMs >= 10_000 && Date.now() - lastFreshReadAt >= 15_000) {
      lastFreshReadAt = Date.now();
      const freshJobs = await Promise.race([
        readSellerExportJobsFreshly(),
        new Promise((resolve) => setTimeout(() => resolve(null), 20_000)),
      ]).catch(() => null);
      if (Array.isArray(freshJobs)) {
        const mergedJobs = new Map();
        for (const job of [...(Array.isArray(currentJobs) ? currentJobs : []), ...freshJobs]) {
          const id = String(job?.id || "").trim();
          if (id) mergedJobs.set(id, job);
        }
        currentJobs = [...mergedJobs.values()];
      }
    }
    if (Array.isArray(currentJobs)) {
      const unusedJobs = currentJobs.filter((job) => !brandExportJobOwner(job?.id));
      let candidate = findNewSellerExportJob([...baselineJobIds], unusedJobs, {
        notBeforeMs: exportAcknowledgedAt,
        baselineAuthoritative: baselineAvailable,
        // POIZON and the local PC can differ slightly, but a previous-day job
        // (such as the PUMA row reused for KOLON SPORT) must always be rejected.
        allowedClockSkewMs: 2 * 60_000,
      });
      // A slow baseline window can finish after POIZON has already inserted
      // the new row and accidentally classify that row as old. The Download
      // Center timestamp is independent evidence: an unowned job created for
      // this request must be attached even if it leaked into the baseline.
      if (!candidate && elapsedMs >= 10_000) {
        candidate = findRecentSellerExportJob(unusedJobs, {
          notBeforeMs: exportAcknowledgedAt,
          allowedClockSkewMs: 2 * 60_000,
        });
      }
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

    // Some Seller Center responses render the confirmation modal several
    // seconds after the export click. Check once more before declaring that
    // no job was created; do not click the export button again and risk a
    // duplicate job.
    if (!lateConfirmationChecked && elapsedMs >= 5_000) {
      lateConfirmationChecked = true;
      const lateConfirmation = await confirmSellerExportRequestPhysical(currentSellerProductFrame())
        .catch(() => null);
      if (lateConfirmation?.confirmationClicked) {
        completeness.confirmationObserved = true;
        completeness.confirmationClicked = true;
        completeness.requestAcknowledged = true;
        mainWindow?.webContents.send("brand-export:progress", {
          status: "waiting-for-job-creation",
          brandName,
          jobState: "2단계/5 · 지연 확인창 처리 완료 · 작업번호 생성 확인 중",
          message: `${brandName} · 늦게 표시된 POIZON 내보내기 확인창을 처리했습니다.`,
        });
      }
    }
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
  const registeredCreatedAt = Number(createdJob.startAtMs || exportAcknowledgedAt || Date.now());
  brandExportJobs.set(registeredJobId, {
    jobId: registeredJobId,
    brandName,
    brandKo,
    createdAt: registeredCreatedAt,
    downloadStarted: false,
    expectedProductCount: Number(completeness.expected || searched.expectedTotal || 0),
  });
  await rememberBrandExportJob({
    jobId: registeredJobId,
    brandName,
    brandKo,
    createdAt: registeredCreatedAt,
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
  if (!await enterSellerProductSearchViaMenu()) {
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
  if (!sellerWindow || sellerWindow.isDestroyed()) openSellerCenterWindow(SELLER_CENTER_URL);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (sellerWindow && !sellerWindow.isDestroyed() && sellerWindow.webContents.getURL()) break;
    await wait(300);
  }
  if (!sellerWindow || sellerWindow.isDestroyed()) {
    return { ok: false, code: "SELLER_WINDOW_UNAVAILABLE", message: "판매자센터 창을 열지 못했습니다." };
  }
  if (!await enterSellerProductSearchViaMenu()) {
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

function domesticLoginSource(sourceId) {
  return DOMESTIC_LOGIN_SOURCES.find((source) => source.id === String(sourceId || ""));
}

async function domesticLoginStatuses() {
  const persistentSession = session.fromPartition(DOMESTIC_SEARCH_PARTITION);
  return Promise.all(DOMESTIC_LOGIN_SOURCES.map(async (source) => {
    const cookieGroups = await Promise.all(source.domains.map((domain) => persistentSession.cookies.get({ domain }).catch(() => [])));
    const cookies = cookieGroups.flat();
    return {
      id: source.id,
      name: source.name,
      url: source.url,
      hasSession: cookies.length > 0,
      windowOpen: Boolean(domesticLoginWindows.get(source.id) && !domesticLoginWindows.get(source.id).isDestroyed()),
    };
  }));
}

async function openDomesticLogin(sourceId) {
  const source = domesticLoginSource(sourceId);
  if (!source) return { ok: false, message: "지원하지 않는 소싱몰입니다." };
  const existing = domesticLoginWindows.get(source.id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return { ok: true, opened: true };
  }
  const loginWindow = new BrowserWindow({
    title: `${source.name} 로그인 · Around G`,
    width: 1280,
    height: 860,
    show: true,
    autoHideMenuBar: true,
    webPreferences: { partition: DOMESTIC_SEARCH_PARTITION, sandbox: true, contextIsolation: true },
  });
  domesticLoginWindows.set(source.id, loginWindow);
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) loginWindow.loadURL(url).catch(() => {});
    return { action: "deny" };
  });
  loginWindow.on("closed", () => {
    domesticLoginWindows.delete(source.id);
    mainWindow?.webContents.send("domestic-login:changed", { sourceId: source.id });
  });
  await loginWindow.loadURL(source.url).catch(() => {});
  return { ok: true, opened: true };
}

async function clearDomesticLogin(sourceId) {
  const source = domesticLoginSource(sourceId);
  if (!source) return { ok: false, message: "지원하지 않는 소싱몰입니다." };
  const persistentSession = session.fromPartition(DOMESTIC_SEARCH_PARTITION);
  for (const domain of source.domains) {
    const cookies = await persistentSession.cookies.get({ domain }).catch(() => []);
    for (const cookie of cookies) {
      const scheme = cookie.secure ? "https" : "http";
      const host = String(cookie.domain || domain).replace(/^\./, "");
      await persistentSession.cookies.remove(`${scheme}://${host}${cookie.path || "/"}`, cookie.name).catch(() => {});
    }
  }
  domesticLoginWindows.get(source.id)?.close();
  return { ok: true };
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
  // Starting the program creates a clean visible sourcing session. Preserve
  // the job-to-brand cache only as hidden recovery evidence so an interrupted
  // update can reconnect the same selected brand without auto-selecting or
  // mixing any previous brand into the new screen.
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
  ipcMain.handle("domestic-login:list", () => domesticLoginStatuses());
  ipcMain.handle("domestic-login:open", (_event, sourceId) => openDomesticLogin(sourceId));
  ipcMain.handle("domestic-login:clear", (_event, sourceId) => clearDomesticLogin(sourceId));
  ipcMain.handle("config:save", async (_event, config) => {
    const next = {
      appKey: String(config.appKey || "").trim(),
      apiBaseUrl: String(config.apiBaseUrl || "https://open.poizon.com").trim(),
      poizonLoginId: String(config.poizonLoginId || "").trim(),
      nikeLoginId: String(config.nikeLoginId || "").trim(),
      adidasLoginId: String(config.adidasLoginId || "").trim(),
    };
    if (config.appSecret) next.appSecretEncrypted = encrypted(config.appSecret);
    if (config.accessToken) next.accessTokenEncrypted = encrypted(config.accessToken);
    if (config.poizonPassword) next.poizonPasswordEncrypted = encrypted(config.poizonPassword);
    if (config.nikePassword) next.nikePasswordEncrypted = encrypted(config.nikePassword);
    if (config.adidasPassword) next.adidasPasswordEncrypted = encrypted(config.adidasPassword);
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
      brands: prioritizeBrandCatalogBySales(
        store.snapshot().products,
        brandsWithOfficialDomainStatus(brands, officialBrandRegistry),
        200
      ),
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
  ipcMain.handle("seller:open-product-search", async () => {
    if (!sellerWindow || sellerWindow.isDestroyed()) {
      openSellerCenterWindow(SELLER_CENTER_URL);
    } else {
      sellerWindow.show();
      sellerWindow.focus();
    }
    return { ok: await enterSellerProductSearchViaMenu() };
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
  ipcMain.handle("seller:begin-brand-search-session", async () => {
    // A click on "브랜드 검색" always starts a new POIZON export request.
    // Keep the saved cache only as a baseline so an old job number can never
    // be claimed by this run, while clearing active monitoring state that
    // belongs to the previous completed run.
    brandWorkSessionGeneration += 1;
    brandExportAttemptGeneration += 1;
    brandExportJobs.clear();
    brandExportJobPending = false;
    pendingBrandExportName = "";
    pendingBrandExportJobId = "";
    brandDownloadStarted = false;
    activeBrandDownloadJobId = "";
    brandExportAllCompleteSent = false;
    lastBrandExportSignature = "__NEW_BRAND_SEARCH_SESSION__";
    if (brandExportMonitorRestartTimer) {
      clearTimeout(brandExportMonitorRestartTimer);
      brandExportMonitorRestartTimer = null;
    }
    return {
      ok: true,
      sessionGeneration: brandWorkSessionGeneration,
      historicalJobCount: savedBrandExportJobs().length,
    };
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
  ipcMain.handle("seller:wait-brand-export-complete", async (_event, input = {}) => {
    const jobId = String(input.jobId || "").trim();
    const sessionGeneration = brandWorkSessionGeneration;
    const timeoutMs = Math.min(
      SELLER_BRAND_EXPORT_HARD_TIMEOUT_MS,
      Math.max(30_000, Number(input.timeoutMs) || SELLER_BRAND_EXPORT_HARD_TIMEOUT_MS),
    );
    const startedAt = Date.now();
    if (!jobId) return { ok: false, code: "JOB_ID_MISSING" };
    scheduleBrandExportMonitor(0);
    while (brandExportJobs.has(jobId)) {
      if (sessionGeneration !== brandWorkSessionGeneration) {
        return { ok: false, code: "BRAND_SESSION_CHANGED", stopped: true };
      }
      if (Date.now() - startedAt >= timeoutMs) {
        return { ok: false, code: "BRAND_DOWNLOAD_TIMEOUT", jobId };
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    return { ok: true, completed: true, jobId };
  });
  ipcMain.handle("brand-export:pending-jobs", () => restorePendingBrandExportJobs());
  ipcMain.handle("brand-export:open-file", async (_event, input = {}) => {
    const filePath = String(input.path || "").trim();
    if (!filePath) return { ok: false, message: "열 파일 경로가 없습니다." };
    openInventoryWindow(filePath, String(input.brand || "").trim());
    return { ok: true };
  });
  ipcMain.handle("brand-export:reveal-file", async (_event, input = {}) => {
    const filePath = String(input.path || "").trim();
    if (!filePath) return { ok: false, message: "파일 경로가 없습니다." };
    shell.showItemInFolder(filePath);
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
  ipcMain.handle("brand-export:start-folder-polling", () => {
    startBrandExportFolderPolling();
    return { ok: true };
  });
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
    const searchGeneration = domesticSearchGeneration;
    const technicalWarnings = [];
    const rememberWarning = (stage, error) => {
      technicalWarnings.push({
        stage,
        message: error instanceof Error ? error.message : String(error || "알 수 없는 오류"),
      });
    };
    try {
      // Inventory/search pages must be fetched from the network for every new
      // request. Keep cookies so authenticated official-mall sessions survive.
      try {
        await session.fromPartition(DOMESTIC_SEARCH_PARTITION).clearCache();
      } catch (error) {
        rememberWarning("search_cache_clear", error);
      }
      const settings = store.snapshot().settings;
      const profileKey = brandSearchProfileKey(input?.brand, input?.brandId);
      const searchProfiles = settings.brandSearchProfiles || {};
      const searchStrategy = selectBrandSearchStrategy(searchProfiles[profileKey]);
      const officialBrandRecord = officialDomainRecordForBrand(
        settings.officialBrandRegistry,
        String(input?.brand || "").trim()
      );
      // Normalize once at the IPC boundary so every downstream platform,
      // physical keyboard input, URL builder, and detail-page comparison uses
      // the same Han-free domestic search identity.
      const searchArticleNumber = sanitizeDomesticProductCode(input?.articleNumber);
      const searchProductCode = sanitizeDomesticProductCode(input?.productCode);
      const searchBrand = sanitizeDomesticQuery(input?.brand);
      const searchTitle = sanitizeDomesticQuery(input?.title);
      const allowedSourceGroups = new Set(["official", "musinsa", "naver", "ssg", "lotte", "parallel", "retailers"]);
      const enabledSourceGroups = Array.isArray(input?.sourceGroups)
        ? input.sourceGroups.filter((group) => allowedSourceGroups.has(group)) : null;
      const data = await queryDomesticProducts({
        query: sanitizeDomesticQuery(input?.query),
        articleNumber: searchArticleNumber,
        productCode: searchProductCode,
        brand: searchBrand,
        title: searchTitle,
        preferTitle: !String(input?.imageUrl || "").trim(),
        verifyLinkCounts: false,
        officialBrandRecord,
        searchStrategy,
        enabledSourceGroups,
      });
      if (domesticSearchCanceled(searchGeneration)) return { ok: false, canceled: true, message: "검색이 중지되었습니다." };
      // Core retailer results are authoritative. Optional enrichment must never
      // turn a successful search into a full-row failure.
      let matched = data;
      try {
        matched = await addMatchConfidence(matched, input || {});
      } catch (error) {
        rememberWarning("match_confidence", error);
      }
      if (input?.verifyLinkCounts === true) {
        try {
          matched = await addRenderedSearchCounts(
            matched,
            searchArticleNumber,
            searchBrand,
            searchTitle,
            searchGeneration
          );
        } catch (error) {
          rememberWarning("rendered_search_counts", error);
        }
        if (domesticSearchCanceled(searchGeneration)) return { ok: false, canceled: true, message: "검색이 중지되었습니다." };
        try {
          matched = await addMatchConfidence(matched, input || {});
        } catch (error) {
          rememberWarning("verified_match_confidence", error);
        }
        try {
          matched = await verifyAllStoresWithMusinsaImage(matched, input || {});
        } catch (error) {
          rememberWarning("store_image_verification", error);
        }
      }
      const products = Array.isArray(matched?.products) ? matched.products : [];
      const exactMatch = products.some((product) =>
        Number(product.signals?.codeScore || 0) === 1
        && product.articleConflict !== true
        && product.signals?.codeConflict !== true
      );
      let learningSaved = false;
      try {
        const brandSearchProfiles = recordBrandSearchOutcome(searchProfiles, {
          brand: String(input?.brand || "").trim(),
          brandId: String(input?.brandId || "").trim(),
          strategy: searchStrategy,
          exactMatch,
          resultCount: products.length,
        });
        await store.setSettings({ brandSearchProfiles });
        learningSaved = true;
      } catch (error) {
        rememberWarning("search_learning_save", error);
      }
      return {
        ok: true,
        data: {
          ...matched,
          products,
          technicalWarnings,
          searchLearning: {
            strategy: searchStrategy,
            exactMatch,
            saved: learningSaved,
          },
        },
      };
    } catch (error) {
      if (domesticSearchCanceled(searchGeneration) || /DOMESTIC_SEARCH_CANCELED/i.test(String(error?.message || error || ""))) {
        return { ok: false, canceled: true, message: "검색이 중지되었습니다." };
      }
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("domestic:cancel", () => cancelDomesticSearches());
  ipcMain.handle("domestic-price:lookup", (_event, input) => {
    const task = domesticPriceLookupQueue.then(
      () => lookupNaverDomesticPrice(input),
      () => lookupNaverDomesticPrice(input),
    );
    domesticPriceLookupQueue = task.then(() => undefined, () => undefined);
    return task;
  });
  let categorySearchGeneration = 0;
  ipcMain.handle("explorer:cancel-category", () => {
    categorySearchGeneration += 1;
    return { ok: true };
  });
  ipcMain.handle("explorer:query", (_event, input) => {
    const settings = store.snapshot().settings;
    const catalog = settings.brandCatalog || explorerMetadata().brands;
    const requestedBrandIds = (Array.isArray(input?.brandIds) ? input.brandIds : []).map(Number).filter(Number.isFinite);
    const catalogById = new Map(catalog.map((brand) => [Number(brand.id), brand]));
    const categoryBrands = input?.mode === "category"
      ? requestedBrandIds.map((id) => catalogById.get(id)).filter(Boolean)
      : [];
    const requestGeneration = categorySearchGeneration;
    return queryExplorer(secretConfig(), {
      ...input,
      brandIds: input?.mode === "category" ? categoryBrands.map((brand) => brand.id) : input?.brandIds,
      rankedBrandCount: categoryBrands.length,
      shouldStop: () => input?.mode === "category" && requestGeneration !== categorySearchGeneration,
      onProgress: (pageNum, pageCount, detail = {}) => {
        const percent = Math.min(70, Math.max(2, Math.round((pageNum / Math.max(1, pageCount)) * 70)));
        mainWindow?.webContents.send("explorer:brand-progress", {
          context: input?.mode === "category" ? "category" : "brand",
          percent,
          pageNum,
          pageCount,
          count: Number(detail.count || 0),
          brandProductCount: Number(detail.brandProductCount || 0),
          phase: String(detail.phase || "progress"),
          brandName: input?.mode === "category" ? String(categoryBrands.find((brand) => Number(brand.id) === Number(detail.brandId))?.name || "") : "",
          brandLogoUrl: input?.mode === "category" ? String(categoryBrands.find((brand) => Number(brand.id) === Number(detail.brandId))?.logoUrl || "") : "",
          message: input?.mode === "category"
            ? `즐겨찾기 브랜드 ${pageNum}/${pageCount} · 선택 카테고리 전체 상품 조회 중`
            : `POIZON API ${pageNum}/${pageCount}페이지 수집 중`,
        });
      },
    });
  });
  ipcMain.handle("external:open", async (_event, url) => {
    return openExternalInChromeTab(url);
  });
  ipcMain.handle("official:open-internal-search", async (_event, input) => {
    return openOfficialMallInternalSearch(input?.homepageUrl, input?.query);
  });
  ipcMain.handle("official:open-search", async (_event, input) => {
    const discovery = new URL(String(input?.discoveryUrl || ""));
    const product = new URL(String(input?.productUrl || ""));
    if (![discovery.protocol, product.protocol].every((protocol) => ["https:", "http:"].includes(protocol))) {
      throw new Error("INVALID_URL");
    }
    await openExternalInChromeTab(discovery.href);
    await wait(1_500);
    await openExternalInChromeTab(product.href);
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
  setTimeout(() => void runOneDriveRecoveryBackup(), 5 * 60 * 1_000);
  setInterval(() => void runOneDriveRecoveryBackup(), 30 * 60 * 1_000).unref?.();
  scheduleWeeklySiteHealthCheck();
  // Full official-mall verification is manual-only. Startup and updates must
  // never create its browser window, timer, catalog sync, or network traffic.
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
