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
  popularCompleteness,
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
  noOfficialStoreRecord,
} from "./services/official-domain-registry.mjs";
import {
  naverOfficialStoreNotFoundRows,
  naverOfficialStoreNotFoundWorkbookData,
} from "./services/official-domain-not-found.mjs";
import {
  officialMallAdapterRecord,
  officialMallAdapterSummary,
} from "./services/official-mall-adapters.mjs";
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
  strictProductArticleIdentityMatch,
  titleIdentityMatch,
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
import {
  isApprovedNaverDomesticSellerEvidence,
  isDomesticNaverPriceCard,
  selectNaverSellingPrices,
} from "./services/naver-price.mjs";
import { mergeSellerProductsByRank, parseSellerDomNodes } from "./services/seller-dom.mjs";
import { highestQualifiedOptionPrice, optionRowsFromSellerResponses, qualifiedOptionPrices } from "./services/seller-transaction-price.mjs";
import { SELLER_POPULAR_CONDITIONS } from "./services/seller-conditions.mjs";
import { findNewSellerExportJob, findRecentSellerExportJob } from "./services/brand-export-jobs.mjs";
import {
  SITE_HEALTH_TARGETS,
  nextWeeklySiteHealthAt,
  weeklySiteHealthSummary,
} from "./services/weekly-site-health.mjs";
import { normalizePurchaseLedgerRow, validatePurchaseLedgerRow } from "./services/purchase-ledger.mjs";

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
let musinsaLedgerWindow;
const inventoryWindows = new Set();
const officialInteractiveWindows = new Set();
const domesticLoginWindows = new Map();
const DOMESTIC_SEARCH_PARTITION = "persist:around-g-domestic-search";
const DOMESTIC_PRICE_PARTITION = "persist:around-g-domestic-price";
const DOMESTIC_SELLER_EVIDENCE_PARTITION = "persist:around-g-domestic-seller-evidence";
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
  { id: "musinsa", name: "ë¬´ì‹ ì‚¬", url: "https://www.musinsa.com/", domains: ["musinsa.com"] },
  { id: "ssg", name: "SSGÂ·ì‹ ì„¸ê³„ë°±í™”ì ", url: "https://www.ssg.com/", domains: ["ssg.com"] },
  { id: "lotte", name: "ë¡¯ë°ì˜¨Â·ë¡¯ë°ë°±í™”ì ", url: "https://www.lotteon.com/", domains: ["lotteon.com"] },
  { id: "wconcept", name: "Wì»¨ì…‰", url: "https://www.wconcept.co.kr/", domains: ["wconcept.co.kr"] },
  { id: "okmall", name: "OKëª°", url: "https://www.okmall.com/", domains: ["okmall.com"] },
  { id: "sivillage", name: "ì‹ ì„¸ê³„VÂ·S.I.VILLAGE", url: "https://www.sivillage.com/", domains: ["sivillage.com"] },
  { id: "abcmart", name: "ABCë§ˆíŠ¸", url: "https://abcmart.a-rt.com/", domains: ["a-rt.com"] },
  { id: "kasina", name: "ì¹´ì‹œë‚˜", url: "https://www.kasina.co.kr/", domains: ["kasina.co.kr"] },
  { id: "onthespot", name: "ì˜¨ë”ìŠ¤íŒŸ", url: "https://www.onthespot.co.kr/", domains: ["onthespot.co.kr"] },
  { id: "folder", name: "í´ë”", url: "https://www.folderstyle.com/", domains: ["folderstyle.com"] },
  { id: "shoemarker", name: "ìŠˆë§ˆì»¤", url: "https://www.shoemarker.co.kr/", domains: ["shoemarker.co.kr"] },
  { id: "worksout", name: "ì›ìŠ¤ì•„ì›ƒÂ·ì¹¼í•˜íŠ¸WIP", url: "https://worksout.co.kr/", domains: ["worksout.co.kr"] },
  { id: "heights", name: "í•˜ì´ì¸ ", url: "https://heights-store.com/", domains: ["heights-store.com"] },
  { id: "eql", name: "EQL", url: "https://www.eqlstore.com/", domains: ["eqlstore.com"] },
  { id: "hfashion", name: "HíŒ¨ì…˜ëª°", url: "https://www.hfashionmall.com/", domains: ["hfashionmall.com"] },
  { id: "29cm", name: "29CM", url: "https://www.29cm.co.kr/", domains: ["29cm.co.kr"] },
  { id: "nike", name: "ë‚˜ì´í‚¤ ê³µì‹ëª°", url: "https://www.nike.com/kr/", loginUrl: "https://www.nike.com/kr/member/profile/login", domains: ["nike.com"], officialAccount: true },
  { id: "adidas", name: "ì•„ë””ë‹¤ìŠ¤ ê³µì‹ëª°", url: "https://www.adidas.co.kr/", loginUrl: "https://www.adidas.co.kr/account-login", domains: ["adidas.co.kr"], officialAccount: true },
];
let updateReady = false;
let updateCheckTimer;
let updateInstallTimer;
let updateCheckInFlight = false;
let oneDriveBackupStatus = { state: "checking", message: "í”„ë¡œê·¸ëž¨ ì‹œìž‘ 5ë¶„ í›„ OneDrive ë°±ì—…ì„ ì‹œìž‘í•©ë‹ˆë‹¤." };
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
const SELLER_CENTER_URL = "https://seller.poizon.com/main/dataCenter/merchantRankBoard";
const SELLER_EXPORT_CENTER_URL = "https://seller.poizon.com/main/exportCenter";
const SELLER_BRAND_EXPORT_HARD_TIMEOUT_MS = 20 * 60 * 1000;
const KR_POIZON_BRAND_LIST_URL = "https://kr.poizon.com/brand/list";
const EN_POIZON_BRAND_LIST_URL = "https://www.poizon.com/brand/list";
const APP_ICON_PATH = join(import.meta.dirname, "build", "icon.png");
const SITE_HEALTH_TIMEOUT_MS = 25_000;
const SELLER_CAPTURE_SCRIPT = `(async () => {
  const selector = "tr, [role='row'], li, [class*='row'], [class*='item'], [class*='product'], [class*='table']";
  const headings = [...document.querySelectorAll("h1, h2, h3, h4, strong, span, div")]
    .filter((element) => String(element.innerText || element.textContent || "").trim() === "ì¸ê¸°ìƒí’ˆ");
  const scopes = [];
  for (const heading of headings) {
    let candidate = heading.parentElement;
    for (let depth = 0; candidate && depth < 12; depth += 1, candidate = candidate.parentElement) {
      const text = String(candidate.innerText || "");
      const hasTableHeaders = text.includes("SPU ê¸°ì¤€")
        && text.includes("SKU ê¸°ì¤€")
        && text.includes("ìƒí’ˆì •ë³´")
        && /í‰ê· \\s*ê±°ëž˜ê°€/.test(text);
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
  const scrollCandidates = [scope, ...scope.querySelectorAll("div, section, main, article, [role='grid'], [role='table']")]
    .map((element) => ({
      element,
      maximum: Math.max(0, element.scrollHeight - element.clientHeight),
    }))
    .filter((candidate) => candidate.maximum > 80)
    .sort((left, right) => right.maximum - left.maximum);
  const scrollTarget = scrollCandidates[0];
  return {
    text: nodes.map((node) => node.text).join("\\n").slice(0, 1000000),
    title: document.title,
    url: location.href,
    nodes,
    scopeVerified: true,
    scannedNodeCount: nodes.length,
    signature: nodes.map((node) => node.text + "|" + node.imageUrl).join("||").slice(0, 200000),
    scrollTop: Number(scrollTarget?.element?.scrollTop || 0),
    scrollMaximum: Number(scrollTarget?.maximum || 0)
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
        && /ìƒí’ˆì •ë³´|í‰ê· \\s*ê±°ëž˜ê°€/.test(text);
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
        && /ìƒí’ˆì •ë³´|í‰ê· \\s*ê±°ëž˜ê°€/.test(text);
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
        && /ìƒí’ˆì •ë³´|í‰ê· \\s*ê±°ëž˜ê°€/.test(text);
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
        && /ìƒí’ˆì •ë³´|í‰ê· \\s*ê±°ëž˜ê°€/.test(text);
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
        && /ìƒí’ˆì •ë³´|í‰ê· \\s*ê±°ëž˜ê°€/.test(text);
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
  // Route input directly to the hidden Seller Center renderer. Moving the
  // Windows cursor steals the user's active application and prevents genuine
  // background collection.
  sellerWindow.webContents.sendInputEvent({ type: "mouseMove", x, y });
  await wait(80);
  sellerWindow.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x, y });
  await wait(100);
  sellerWindow.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x, y });
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
      // ì ‘ê·¼í•  ìˆ˜ ì—†ëŠ” ì™¸ë¶€ í”„ë ˆìž„ì€ ê±´ë„ˆëœë‹ˆë‹¤.
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
          .filter((element) => String(element.innerText || element.textContent || "").trim() === "ì¸ê¸°ìƒí’ˆ");
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
            if (text.includes("SPU ê¸°ì¤€") && text.includes("SKU ê¸°ì¤€") && text.includes("ìƒí’ˆì •ë³´") && controls.length >= 1) {
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
        // POIZON ì‚¬ìš©ìž ì •ì˜ ë¼ë””ì˜¤ëŠ” ì„ íƒ ìƒíƒœë¥¼ í‘œì¤€ DOM ì†ì„±ìœ¼ë¡œ ë…¸ì¶œí•˜ì§€
        // ì•ŠëŠ” ê²½ìš°ê°€ ìžˆì–´, ì •í™•í•œ ë ˆì´ë¸”ì˜ í´ë¦­ ì„±ê³µì„ ë³´ì¡° ê²€ì¦ìœ¼ë¡œ ì¸ì •í•©ë‹ˆë‹¤.
        verifiedSelected: verification.verifiedSelected || Boolean(result.found && result.selected),
        verificationMode: verification.verifiedSelected ? "dom-state" : "label-click",
      };
    }
    if (condition.action === "fullscreen" && result.found && result.requiresNativeClick) {
      sellerWindow.webContents.sendInputEvent({ type: "mouseMove", x: result.x, y: result.y });
      sellerWindow.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x: result.x, y: result.y });
      await wait(120);
      sellerWindow.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: result.x, y: result.y });
    }
    if (condition.action === "fullscreen" && result.found) {
      await wait(1_200);
      const verified = await executeAcrossSellerFrames(`(() => {
        const headings = [...document.querySelectorAll("h1, h2, h3, h4, strong, span, div")]
          .filter((element) => String(element.innerText || element.textContent || "").trim() === "ì¸ê¸°ìƒí’ˆ");
        for (const heading of headings) {
          let panel = heading.parentElement;
          for (let depth = 0; panel && depth < 10; depth += 1, panel = panel.parentElement) {
            const text = String(panel.innerText || "");
            const rect = panel.getBoundingClientRect();
            if (text.includes("SPU ê¸°ì¤€") && text.includes("SKU ê¸°ì¤€")
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
    const exactOfficialProduct = product.store === "ë¸Œëžœë“œ ê³µì‹ëª°"
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
      sourceTrustLabel: "ê³µì‹ëª° í™•ì¸ì™„ë£Œ",
      imageVerificationLabel: product.imageVerifiedFromDetail
        ? "ìƒì„¸ ì´ë¯¸ì§€ í™•ì¸ì™„ë£Œ"
        : product.imageVerifiedFromCard ? "ê³µì‹ëª° ì´ë¯¸ì§€ í™•ì¸" : "ì´ë¯¸ì§€ í™•ì¸ í•„ìš”",
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
    const verifiedNaverIdentity = String(product?.sourceStore || product?.store || "") === "ë„¤ì´ë²„ íŒ¨ì…˜íƒ€ìš´"
      && product.domesticSellerVerified === true
      && (product.articleNumberVerified === true
        || (product.brandVerifiedFromCard === true && product.titleVerifiedFromDetail === true));
    // Naver's exact result card often omits the model code and uses a campaign
    // photo instead of POIZON's packshot. The detail page has already supplied
    // stronger evidence: approved domestic seller plus article identity or
    // brand-title identity. Keep that verified product regardless of a weak
    // thumbnail fingerprint.
    if (verifiedNaverIdentity) return true;
    if (codeMatched) return true;
    if (product.store === "ë¸Œëžœë“œ ê³µì‹ëª°") return false;
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
    String(product?.sourceStore || product?.store || "") === "ë¬´ì‹ ì‚¬"
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
    if (product === exactMusinsa || store === "ë¬´ì‹ ì‚¬") {
      return { ...product, musinsaImageReference: true, imageVerificationLabel: "ë¬´ì‹ ì‚¬ ê¸°ì¤€ ì´ë¯¸ì§€" };
    }
    if (store === "ë„¤ì´ë²„ íŒ¨ì…˜íƒ€ìš´"
      && product?.domesticSellerVerified === true
      && product?.articleNumberVerified === true) {
      return {
        ...product,
        musinsaImageCompared: false,
        imageVerificationLabel: "ë„¤ì´ë²„ ìƒì„¸ í’ˆë²ˆ í™•ì¸",
      };
    }
    const exactCode = Number(product?.signals?.codeScore || 0) === 1
      && product?.articleConflict !== true
      && product?.signals?.codeConflict !== true;
    const imageUrl = String(product?.imageUrl || "");
    if (!exactCode || !/^https?:\/\//i.test(imageUrl)) {
      return { ...product, musinsaImageCompared: false, imageVerificationLabel: "ì´ë¯¸ì§€ í™•ì¸ í•„ìš”" };
    }
    const candidateFingerprint = await imageFingerprint(imageUrl).catch(() => null);
    const similarity = fingerprintSimilarity(referenceFingerprint, candidateFingerprint);
    if (!Number.isFinite(similarity)) {
      return { ...product, musinsaImageCompared: false, imageVerificationLabel: "ì´ë¯¸ì§€ í™•ì¸ í•„ìš”" };
    }
    const imageScore = Math.round(similarity * 100);
    return {
      ...product,
      musinsaImageCompared: true,
      musinsaImageScore: imageScore,
      musinsaImageRejected: imageScore < 58,
      imageVerificationLabel: imageScore >= 82 ? "ë¬´ì‹ ì‚¬ ì´ë¯¸ì§€ ë†’ì€ ì¼ì¹˜"
        : imageScore >= 58 ? "ë¬´ì‹ ì‚¬ ì´ë¯¸ì§€ ì¼ì¹˜" : "ë¬´ì‹ ì‚¬ ì´ë¯¸ì§€ ë¶ˆì¼ì¹˜",
    };
  }));
  const accepted = verified.filter((product) => product.musinsaImageRejected !== true);
  return {
    ...data,
    products: accepted,
    musinsaImageVerification: {
      applied: true,
      referenceStore: "ë¬´ì‹ ì‚¬",
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
            + (/main|ëŒ€í‘œ|detail|product|goods/i.test(label) ? 30 : 0)
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
  return /captcha|ë³´ì•ˆ\s*í™•ì¸|ìžë™\s*ìž…ë ¥|ë¡œë´‡|ìŠ¤íŒ¸ì„\s*ë°©ì§€|ì‹¤ì œ\s*ì‚¬ìš©ìž|ë¹„ì •ìƒì ì¸\s*ì ‘ê·¼/i.test(String(value || ""));
}

async function waitForNaverSecurityVerification(searchWindow) {
  if (!searchWindow || searchWindow.isDestroyed()) return false;
  searchWindow.setTitle("ë„¤ì´ë²„ ì‚¬ëžŒ í™•ì¸ì„ ì™„ë£Œí•´ ì£¼ì„¸ìš” Â· Around G");
  searchWindow.setAlwaysOnTop(true);
  searchWindow.show();
  searchWindow.focus();
  mainWindow?.webContents.send("domestic-search:security-required", {
    source: "ë„¤ì´ë²„",
    message: "ë„¤ì´ë²„ ì‚¬ëžŒ í™•ì¸ì„ ì™„ë£Œí•˜ë©´ ìƒí’ˆ ê²€ìƒ‰ì„ ìžë™ìœ¼ë¡œ ê³„ì†í•©ë‹ˆë‹¤.",
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
        source: "ë„¤ì´ë²„",
        message: "ë„¤ì´ë²„ ì‚¬ëžŒ í™•ì¸ ì™„ë£Œ Â· ìƒí’ˆ ê²€ìƒ‰ì„ ë‹¤ì‹œ ì‹œìž‘í•©ë‹ˆë‹¤.",
      });
      return true;
    }
    await wait(1_000);
  }
  return false;
}

async function submitOfficialMallSearch(searchWindow, query) {
  const exactQuery = sanitizeDomesticProductCode(query) || sanitizeDomesticQuery(query);
  if (!exactQuery || !searchWindow || searchWindow.isDestroyed()) return false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const script = `(() => {
      const query = ${JSON.stringify(exactQuery)};
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
      let input = selectAll('input[type="search"],input[type="text"][placeholder*="ê²€ìƒ‰"],input[placeholder*="ê²€ìƒ‰ì–´"],input[placeholder*="ê²€ìƒ‰"],input[name*="search" i],input[name="q" i],input[name*="query" i],input[name*="keyword" i],input[name*="schWord" i]').find(visible);
      if (!input) {
        const controls = selectAll('header button,header a,button,a,[role="button"]');
        const opener = controls.find((element) => {
          const label = [element.getAttribute("aria-label"), element.getAttribute("title"), element.className, element.textContent].join(" ");
          return visible(element) && /search|ê²€ìƒ‰/i.test(label);
        }) || controls.find((element) => {
          if (!visible(element) || !element.querySelector('svg')) return false;
          const label = [element.outerHTML, element.parentElement?.className].join(" ");
          return /search|ê²€ìƒ‰|magnif|ico[_-]?sch/i.test(label);
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
        ...(nearby?.querySelectorAll('button[type="submit"],input[type="submit"],[aria-label*="ê²€ìƒ‰"],[title*="ê²€ìƒ‰"]') || []),
      ];
      const submit = submitCandidates.find((element) => {
        if (!visible(element) || element === input) return false;
        const label = [element.getAttribute('aria-label'), element.getAttribute('title'), element.className, element.textContent, element.outerHTML].join(' ');
        return /search|ê²€ìƒ‰|magnif|ico[_-]?sch/i.test(label) || element.type === 'submit';
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
          await frame.executeJavaScript(`[...document.querySelectorAll('button,a,[role="button"]')].find((element) => /search|ê²€ìƒ‰/i.test([element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent].join(" ")))?.click()`, true).catch(() => {});
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
    const compact = (value) => String(value || "").replace(/[^A-Z0-9ê°€-íž£]/gi, "").toUpperCase();
    const expected = compact(query);
    const inputs = [...document.querySelectorAll('input[type="search"],input[name*="search" i],input[name="q" i],input[name*="query" i],input[name*="keyword" i],input[name*="schWord" i]')];
    const inputMatched = inputs.some((input) => compact(input.value).includes(expected));
    const pageText = String(document.body?.innerText || "");
    const pageMatched = expected.length >= 4 && compact(pageText).includes(expected);
    const resultCount = /(?:ìƒí’ˆ|ê²€ìƒ‰ê²°ê³¼)\\s*\\(?\\s*[1-9][\\d,]*\\s*(?:ê°œ|ê±´|\\))/i.test(pageText)
      || /ì´\\s*[1-9][\\d,]*\\s*ê°œ/i.test(pageText);
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
  const exactQuery = sanitizeDomesticProductCode(query) || sanitizeDomesticQuery(query);
  if (!exactQuery) return false;
  const previousUrl = String(searchWindow.webContents.getURL() || homepageUrl);
  const submitted = await submitOfficialMallSearch(searchWindow, exactQuery);
  if (!submitted) return false;
  await wait(2_000);
  return officialMallSearchWasExecuted(searchWindow, exactQuery, previousUrl);
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

async function verifyApprovedNaverDomesticProducts(products = [], {
  articleNumber = "",
  brand = "",
  title = "",
  requireArticleIdentity = false,
} = {}) {
  const candidates = (Array.isArray(products) ? products : [])
    .filter((product) => isDomesticNaverPriceCard({
      productUrl: product?.url || product?.productUrl,
      title: product?.title,
      text: product?.text,
    }))
    .slice(0, 8);
  if (!candidates.length) {
    return { products: [], candidateCount: 0, checkedCount: 0, rejectedCount: 0, failedCount: 0 };
  }
  let evidenceWindow;
  const approved = [];
  let checkedCount = 0;
  let rejectedCount = 0;
  let failedCount = 0;
  try {
    evidenceWindow = new BrowserWindow({
      show: false,
      width: 1360,
      height: 900,
      icon: APP_ICON_PATH,
      webPreferences: {
        partition: DOMESTIC_SELLER_EVIDENCE_PARTITION,
        sandbox: true,
        backgroundThrottling: false,
        paintWhenInitiallyHidden: true,
        offscreen: true,
      },
    });
    evidenceWindow.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36");
    for (const candidate of candidates) {
      const productUrl = String(candidate?.url || candidate?.productUrl || "");
      if (!productUrl || evidenceWindow.isDestroyed()) continue;
      try {
        await Promise.race([
          evidenceWindow.loadURL(productUrl),
          new Promise((_, reject) => setTimeout(() => reject(new Error("SELLER_EVIDENCE_TIMEOUT")), 12_000)),
        ]);
        let snapshot = null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await wait(attempt === 0 ? 900 : 350);
          snapshot = await evidenceWindow.webContents.executeJavaScript(`(() => {
            const fullText = String(document.body?.innerText || "").slice(0, 80000);
            const sellerEvidenceText = fullText.split(/\\n+/)
              .map((line) => line.replace(/\\s+/g, " ").trim())
              .filter((line) => line.length >= 3 && line.length <= 240)
              .filter((line) => /íŒë§¤(?:ì¤‘)?ì¸?\\s*ìƒí’ˆ|ê³µì‹\\s*íŒë§¤ì²˜|ë¸Œëžœë“œ\\s*(?:ê³µì‹|ì§ì˜)|ê³µì‹\\s*(?:ë¸Œëžœë“œ|ìŠ¤í† ì–´|ì˜¨ë¼ì¸ëª°)|ì§ì˜\\s*(?:ìŠ¤í† ì–´|ì˜¨ë¼ì¸ëª°)|ê´€ë¶€ê°€ì„¸|í•´ì™¸\\s*ì§êµ¬|êµ¬ë§¤\\s*ëŒ€í–‰/i.test(line))
              .slice(0, 20).join(" ");
            const titleText = [...document.querySelectorAll('h1,[itemprop="name"],[class*="product" i][class*="title" i],[class*="goods" i][class*="name" i]')]
              .map((element) => String(element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim())
              .filter(Boolean).slice(0, 8).join(" ").slice(0, 2000);
            const identityLabel = /í’ˆ\\s*ë²ˆ|ìƒí’ˆ\\s*(?:ë²ˆí˜¸|ì½”ë“œ)|ì œí’ˆ\\s*(?:ë²ˆí˜¸|ì½”ë“œ)|ëª¨ë¸\\s*(?:ëª…|ë²ˆí˜¸|ì½”ë“œ)?|ìŠ¤íƒ€ì¼\\s*(?:ë²ˆí˜¸|ì½”ë“œ)?|style\\s*(?:no|number|code)?|model\\s*(?:no|number|code)?|sku|mpn/i;
            const labeledText = fullText.split(/\\n+/).map((line) => line.replace(/\\s+/g, " ").trim())
              .filter((line) => identityLabel.test(line)).slice(0, 40).join("\\n");
            const structuredCodes = [];
            const addCode = (value) => {
              if (Array.isArray(value)) return value.forEach(addCode);
              if (value !== undefined && value !== null && String(value).trim()) structuredCodes.push(String(value).trim());
            };
            for (const element of document.querySelectorAll('[itemprop="sku"],[itemprop="mpn"],[itemprop="model"]')) {
              addCode(element.getAttribute("content") || element.textContent);
            }
            for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
              try {
                const walk = (value) => {
                  if (!value || typeof value !== "object") return;
                  if (Array.isArray(value)) return value.forEach(walk);
                  for (const [key, child] of Object.entries(value)) {
                    if (/^(?:sku|mpn|model|styleNo|articleNumber)$/i.test(key)) addCode(child);
                    else if (child && typeof child === "object") walk(child);
                  }
                };
                walk(JSON.parse(script.textContent || "null"));
              } catch {}
            }
            return {
              fullText, sellerEvidenceText, titleText, labeledText,
              structuredCodes: [...new Set(structuredCodes)].slice(0, 30),
              ready: document.readyState === "complete",
            };
          })()`, true).catch(() => null);
          if (snapshot?.sellerEvidenceText || snapshot?.ready) break;
        }
        if (!snapshot) {
          failedCount += 1;
          continue;
        }
        checkedCount += 1;
        const sellerVerified = isApprovedNaverDomesticSellerEvidence({
          productUrl,
          sellerEvidenceText: snapshot.sellerEvidenceText,
          detailText: snapshot.fullText,
        });
        const articleVerified = strictProductArticleIdentityMatch(snapshot, articleNumber);
        const observedIdentityText = `${String(candidate?.title || "")} ${String(snapshot.titleText || "")}`;
        const observedBrandTokens = observedIdentityText.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        const brandVerified = !String(brand || "").trim()
          || observedBrandTokens.some((token) => brandsMatch(brand, token));
        const productTitleVerified = !String(title || "").trim()
          || titleIdentityMatch(observedIdentityText, title);
        const identityVerified = requireArticleIdentity
          ? articleVerified
          : brandVerified && productTitleVerified;
        if (!sellerVerified || !identityVerified) {
          rejectedCount += 1;
          continue;
        }
        approved.push({
          ...candidate,
          domesticSellerVerified: true,
          domesticSellerEvidence: String(snapshot.sellerEvidenceText || "").slice(0, 240),
          brandVerifiedFromCard: brandVerified,
          articleNumber: articleVerified ? sanitizeDomesticProductCode(articleNumber) : "",
          detectedArticleNumber: articleVerified ? sanitizeDomesticProductCode(articleNumber) : "",
          articleNumberVerified: articleVerified,
          titleVerifiedFromDetail: productTitleVerified,
          matchBasis: articleVerified ? "article" : "brand_title",
        });
      } catch {
        // A single inaccessible product is omitted without affecting the
        // remaining candidates or any other program feature.
        failedCount += 1;
      }
    }
  } finally {
    if (evidenceWindow && !evidenceWindow.isDestroyed()) evidenceWindow.destroy();
  }
  return {
    products: approved,
    candidateCount: candidates.length,
    checkedCount,
    rejectedCount,
    failedCount,
  };
}

async function filterApprovedNaverDomesticProducts(products = []) {
  return (await verifyApprovedNaverDomesticProducts(products)).products;
}

async function lookupNaverDomesticPrice(input = {}) {
  const articleNumber = sanitizeDomesticProductCode(input?.articleNumber || input?.productCode);
  const brand = sanitizeDomesticQuery(input?.brand);
  const title = sanitizeDomesticQuery(input?.title);
  const query = articleNumber || title;
  if (!query) return { ok: false, message: "ê°€ê²© ê²€ìƒ‰ìš© ìƒí’ˆë²ˆí˜¸ê°€ ì—†ìŠµë‹ˆë‹¤.", candidates: [] };
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
            if (/\\d[\\d,]{2,}\\s*ì›/.test(body) && body.length < 1800 && ownedLinks <= 3) best = card;
            if (ownedLinks > 3 || body.length >= 1800) break;
          }
          const text = String(best?.innerText || link.innerText || "").replace(/\\s+/g, " ").trim();
          const prices = [...text.matchAll(/([1-9][\\d,]{2,})\\s*ì›/g)]
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
          explicitEmpty: /ê²€ìƒ‰\\s*ê²°ê³¼ê°€?\\s*ì—†|ê²€ìƒ‰ëœ\\s*ìƒí’ˆì´\\s*ì—†/i.test(pageText),
        };
      })()`, true).catch(() => null);
      if (!snapshot) continue;
      snapshot.productCards = (snapshot.productCards || []).filter(isDomesticNaverPriceCard).map((card) => {
        const selectedPrices = selectNaverSellingPrices(card?.text || "");
        return {
          ...card,
          price: selectedPrices.price,
          originalPrice: selectedPrices.originalPrice,
          shippingFeeExcluded: selectedPrices.excludedShippingAmounts.length > 0,
        };
      }).filter((card) => Number(card.price || 0) > 0);
      const analyzed = analyzeRenderedChannelProducts(
        JSON.stringify(snapshot), "ë„¤ì´ë²„ íŒ¨ì…˜íƒ€ìš´", articleNumber, brand, title,
      );
      const candidates = (analyzed?.products || [])
        .filter((candidate) => Number(candidate?.price || 0) > 0)
        .sort((left, right) => Number(left.price) - Number(right.price))
        .slice(0, 5);
      if (candidates.length) {
        const approvedCandidates = await filterApprovedNaverDomesticProducts(candidates);
        if (approvedCandidates.length) return { ok: true, searchUrl, candidates: approvedCandidates };
        return { ok: true, searchUrl, candidates: [], message: "ìŠ¹ì¸ëœ êµ­ë‚´ ì •í’ˆ íŒë§¤ì²˜ ìƒí’ˆì´ ì—†ìŠµë‹ˆë‹¤." };
      }
      if (snapshot.explicitEmpty) return { ok: true, searchUrl, candidates: [], message: "ê²€ìƒ‰ ê²°ê³¼ì— ìƒí’ˆì´ ì—†ìŠµë‹ˆë‹¤." };
    }
    return { ok: false, searchUrl, candidates: [], message: "ì¼ì¹˜ ìƒí’ˆì˜ ê°€ê²©ì„ ì•ˆì „í•˜ê²Œ í™•ì¸í•˜ì§€ ëª»í–ˆìŠµë‹ˆë‹¤." };
  } catch (error) {
    const timeout = /PRICE_LOOKUP_TIMEOUT/i.test(String(error?.message || ""));
    return {
      ok: false,
      searchUrl,
      candidates: [],
      message: timeout ? "ê°€ê²© í™•ì¸ ì‹œê°„ì´ ì´ˆê³¼ë˜ì—ˆìŠµë‹ˆë‹¤." : "ê°€ê²© í™•ì¸ ì°½ì„ ë¶ˆëŸ¬ì˜¤ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.",
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
        .filter((text) => /ë¸Œëžœë“œì§ì˜ëª°|ê³µì‹ë¸Œëžœë“œ|ë¸Œëžœë“œìŠ¤í† ì–´|ë°±í™”ì |ì•„ìš¸ë ›/.test(text))
        .slice(0, 120);
    })()`, true).catch(() => []);
    const counts = parseNaverFashionTownChannelCounts(labels);
    if (counts) return counts;
  }
  return null;
}

async function ensureNaverOfficialBrandFilter(searchWindow) {
  return clickNaverShoppingChannel(searchWindow, "ë„¤ì´ë²„ ê³µì‹ ë¸Œëžœë“œìŠ¤í† ì–´");
}

async function clickNaverShoppingChannel(searchWindow, store) {
  const targetLabel = store === "ë„¤ì´ë²„ ê³µì‹ ë¸Œëžœë“œìŠ¤í† ì–´" ? "ë¸Œëžœë“œì§ì˜ëª°"
    : store === "ë„¤ì´ë²„ ë°±í™”ì " ? "ë°±í™”ì "
      : store === "ë„¤ì´ë²„ ì•„ìš¸ë ›" ? "ì•„ìš¸ë ›" : "";
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
        .filter((element) => new RegExp('^' + compact(label) + '[\\\\d,]+ê°œ$').test(compact(element.textContent)))
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
      .filter((element) => new RegExp('^' + ${JSON.stringify(targetLabel)} + '[\\\\d,]+ê°œ$').test(compact(element.textContent)));
    const selected = resultTabs.some(selectedEvidence);
    const queryPreserved = /\/window\/search\/fashion-group/i.test(String(location.pathname || ""))
      && /ì—\\s*ëŒ€í•œ\\s*íŒ¨ì…˜íƒ€ìš´\\s*ê²€ìƒ‰ê²°ê³¼/.test(String(document.body?.innerText || ""));
    return JSON.stringify({
      url: String(location.href || ""), selected, queryPreserved,
      missing: /íŽ˜ì´ì§€ë¥¼\\s*ì°¾ì„\\s*ìˆ˜\\s*ì—†ìŠµë‹ˆë‹¤/.test(String(document.body?.innerText || ""))
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
        .filter((element) => compact(element.textContent) === "ì‡¼í•‘")
        .sort((left, right) => {
          const score = (element) => (/shopping\\.naver\\.com\\/ns\\/home/i.test(String(element.href || element.getAttribute("href") || "")) ? 300 : 0)
            + (element.closest('nav,[aria-label*="ì„œë¹„ìŠ¤"]') ? 100 : 0)
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
      securityRequired: /captcha|ë³´ì•ˆ\\s*í™•ì¸|ìŠ¤íŒ¸ì„\\s*ë°©ì§€|ì‹¤ì œ\\s*ì‚¬ìš©ìž|ë¹„ì •ìƒì ì¸\\s*ì ‘ê·¼/i.test(String(document.body?.innerText || ""))
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
      const fashionLabels = ["íŒ¨ì…˜íƒ€ìš´"];
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
      const fashionLabels = ["íŒ¨ì…˜íƒ€ìš´"];
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
          // area. Only Fashion Town's own "ìƒí’ˆëª… ë˜ëŠ” ë¸Œëžœë“œ" field is valid.
          const fashionInput = /ìƒí’ˆëª…\\s*ë˜ëŠ”\\s*ë¸Œëžœë“œ/.test(placeholder);
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
          const fashionLauncher = /íŒ¨ì…˜íƒ€ìš´.*?(?:ìƒí’ˆëª…\\s*ë˜ëŠ”\\s*ë¸Œëžœë“œ|ìƒí’ˆì„\\s*ê²€ìƒ‰)|ìƒí’ˆëª…\\s*ë˜ëŠ”\\s*ë¸Œëžœë“œ/i.test(label);
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
          const fashionInput = /ìƒí’ˆëª…\\s*ë˜ëŠ”\\s*ë¸Œëžœë“œ/.test(placeholder);
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
      const compact = (value) => String(value || "").replace(/[^A-Z0-9ê°€-íž£]/gi, "").toUpperCase();
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
      const noResult = /ê²€ìƒ‰ëœ\s*ìƒí’ˆì´\s*ì—†ìŠµë‹ˆë‹¤|ê²€ìƒ‰\s*ê²°ê³¼ê°€\s*ì—†ìŠµë‹ˆë‹¤|ìƒí’ˆì´\s*ì—†ìŠµë‹ˆë‹¤|ê²€ìƒ‰ê²°ê³¼\s*ì—†ìŒ/i.test(bodyText);
      const securityRequired = /captcha|ë³´ì•ˆ\s*í™•ì¸|ìžë™\s*ìž…ë ¥|ë¡œë´‡|ìŠ¤íŒ¸ì„\s*ë°©ì§€|ì‹¤ì œ\s*ì‚¬ìš©ìž|ë¹„ì •ìƒì ì¸\s*ì ‘ê·¼/i.test(bodyText);
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
        const explicitSearch = /ê²€ìƒ‰|search|magnif|ico[_-]?(?:sch|search)/i.test(label);
        const typeSubmit = String(element.getAttribute("type") || "").toLowerCase() === "submit";
        const clearOrToggle = /ìž…ë ¥(?:ë‚´ìš©)?ì‚­ì œ|ì§€ìš°ê¸°|ë‹«ê¸°|clear|delete|remove|close|dropdown|arrow|down|toggle|autocomplete|fold|unfold|expand|collapse/i.test(compactLabel)
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
        const compact = (value) => String(value || "").replace(/[^A-Z0-9ê°€-íž£]/gi, "").toUpperCase();
        const expected = compact(${JSON.stringify(exactQuery)});
        const card = link.closest('li,article,[class*="product" i],[class*="item" i],div');
        return expected.length >= 4 && compact([link.href, link.textContent, card?.innerText].join(" ")).includes(expected);
      }),
      noResult: /ê²€ìƒ‰\\s*ê²°ê³¼ê°€\\s*ì—†|ìƒí’ˆì„\\s*ì°¾ì„\\s*ìˆ˜\\s*ì—†|ì¼ì¹˜í•˜ëŠ”\\s*ìƒí’ˆì´\\s*ì—†/.test(String(document.body?.innerText || ""))
    })`, true).then(JSON.parse).catch(() => null);
    const urlChanged = Boolean(state?.url && state.url !== previousUrl);
    const compact = (value) => String(value || "").replace(/[^A-Z0-9ê°€-íž£]/gi, "").toUpperCase();
    const queryInUrl = (() => {
      try { return compact(decodeURIComponent(state?.url || "")).includes(compact(exactQuery)); }
      catch { return false; }
    })();
    const queryVisibleInPage = compact(state?.text || "").includes(compact(exactQuery));
    if (state && !/íŽ˜ì´ì§€ë¥¼\s*ì°¾ì„\s*ìˆ˜\s*ì—†ìŠµë‹ˆë‹¤/.test(state.text)
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
          return /ì‚¬ì´ì¦ˆ|size|ì˜µì…˜|option|ì„ íƒ/i.test(label)
            && !/êµ¬ë§¤|ìž¥ë°”êµ¬ë‹ˆ|ê²°ì œ|buy|cart/i.test(label);
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

function browserWindowUsable(window) {
  return Boolean(window
    && !window.isDestroyed()
    && window.webContents
    && !window.webContents.isDestroyed());
}

function closedInternalSearchResult(stage = "unknown") {
  return {
    ok: false,
    submitted: false,
    canceled: true,
    reason: "INTERNAL_SEARCH_WINDOW_CLOSED",
    stage,
  };
}

async function openOfficialMallInternalSearch(homepageUrl, query) {
  const homepage = new URL(String(homepageUrl || ""));
  if (!["https:", "http:"].includes(homepage.protocol)) throw new Error("INVALID_URL");
  // Buttons in previously rendered result rows can still carry the raw POIZON
  // article value (for example `207521-001é»‘è‰²`). Normalize again at this IPC
  // boundary so neither the window title nor the physical official-mall input
  // can receive trailing Chinese colour/category metadata.
  const exactQuery = sanitizeDomesticProductCode(query) || sanitizeDomesticQuery(query);
  if (!exactQuery) throw new Error("SEARCH_QUERY_REQUIRED");
  const searchWindow = new BrowserWindow({
    title: `ê³µì‹ëª° ìƒí’ˆ ê²€ìƒ‰ Â· ${exactQuery}`,
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
    if (/^https?:\/\//i.test(url) && browserWindowUsable(searchWindow)) {
      searchWindow.loadURL(url).catch(() => {});
    }
    return { action: "deny" };
  });
  let stage = "homepage_load";
  try {
    await searchWindow.loadURL(homepage.href);
    if (!browserWindowUsable(searchWindow)) return closedInternalSearchResult(stage);
    searchWindow.show();
    searchWindow.focus();
    stage = "account_login";
    const login = await ensureOfficialAccountLogin(searchWindow, homepage.href);
    if (!browserWindowUsable(searchWindow)) return closedInternalSearchResult(stage);
    if (!login.ok) return { ok: false, submitted: false, loginRequired: true, reason: login.reason };
    if (login.required) {
      stage = "homepage_restore";
      await searchWindow.loadURL(homepage.href).catch(() => {});
      if (!browserWindowUsable(searchWindow)) return closedInternalSearchResult(stage);
    }
    stage = "search_submission";
    const submitted = await executeOfficialMallSearch(searchWindow, homepage.href, exactQuery);
    if (!browserWindowUsable(searchWindow)) return closedInternalSearchResult(stage);
    if (!submitted) {
      searchWindow.setTitle(`ê³µì‹ëª° ë‹ë³´ê¸°ë¥¼ ëˆŒëŸ¬ ${exactQuery}ì„(ë¥¼) ê²€ìƒ‰í•´ ì£¼ì„¸ìš”`);
    }
    return { ok: true, submitted };
  } catch (error) {
    const message = String(error?.message || error || "");
    if (!browserWindowUsable(searchWindow)
      || /Object has been destroyed|Render frame was disposed|WebContents was destroyed/i.test(message)) {
      return closedInternalSearchResult(stage);
    }
    throw error;
  }
}

async function loadNaverFashionTownResultPage(searchWindow, targetUrl, query) {
  const expectedQuery = sanitizeDomesticQuery(query);
  const inspectSettledResult = async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (attempt > 0) await wait(500);
      const state = await searchWindow.webContents.executeJavaScript(`(() => {
        const href = String(location.href || "");
        const text = String(document.body?.innerText || "").slice(0, 60000);
        const cards = document.querySelectorAll([
          'a[href*="/window-products/"]',
          'a[href*="/products/"]',
          'a[href*="/catalog/"]',
        ].join(',')).length;
        const explicitEmpty = /ê²€ìƒ‰\\s*ê²°ê³¼ê°€?\\s*(?:ì—†|0)|ìƒí’ˆì´?\\s*(?:ì—†|0)|ì¼ì¹˜í•˜ëŠ”\\s*(?:ìƒí’ˆ|ì œì•ˆ)ì´\\s*ì—†/i.test(text);
        const positiveCount = /(?:ì „ì²´|ê²€ìƒ‰\\s*ê²°ê³¼)\\s*[1-9][\\d,]*\\s*ê°œ/i.test(text);
        return { href, cards, explicitEmpty, positiveCount };
      })()`, true).catch(() => null);
      if (!state) continue;
      let decodedUrl = String(state.href || "");
      try { decodedUrl = decodeURIComponent(decodedUrl); } catch {}
      const compact = (value) => String(value || "").replace(/[^A-Z0-9ê°€-íž£]/gi, "").toUpperCase();
      const exactResult = /shopping\.naver\.com\/window\/search\//i.test(state.href)
        && compact(decodedUrl).includes(compact(expectedQuery));
      if (exactResult && (state.cards > 0 || state.explicitEmpty || state.positiveCount)) {
        return { ok: true, resolvedUrl: state.href };
      }
    }
    return { ok: false, resolvedUrl: String(searchWindow.webContents.getURL() || "") };
  };

  let firstError = null;
  try {
    await Promise.race([
      searchWindow.loadURL(targetUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error("NAVER_RESULT_PAGE_TIMEOUT")), 30_000)),
    ]);
  } catch (error) {
    firstError = error;
  }
  const firstResult = await inspectSettledResult();
  if (firstResult.ok) return firstResult;

  // A cold hidden Chromium session can reject Fashion Town's first SPA
  // navigation even after Naver home loaded normally. Clear only the HTTP
  // cache (cookies/login remain intact), then retry the same ranked query once.
  try { await searchWindow.webContents.session.clearCache(); } catch {}
  let retryError = null;
  try {
    await wait(600);
    await Promise.race([
      searchWindow.loadURL(targetUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error("NAVER_RESULT_PAGE_TIMEOUT")), 30_000)),
    ]);
  } catch (error) {
    retryError = error;
  }
  const retryResult = await inspectSettledResult();
  if (retryResult.ok) return retryResult;
  const errorMessage = String(retryError?.message || firstError?.message || "NAVER_RESULT_PAGE_NOT_SETTLED");
  return {
    ok: false,
    resolvedUrl: retryResult.resolvedUrl || firstResult.resolvedUrl,
    errorMessage,
    timeout: /TIMEOUT|TIMED_OUT/i.test(errorMessage),
    networkError: /ERR_(?:NAME_NOT_RESOLVED|CONNECTION|TIMED_OUT|INTERNET_DISCONNECTED)/i.test(errorMessage),
  };
}

async function renderedSearchSourceResult(source, articleNumber, brand = "", title = "", securityRetry = 0, searchAttempt = null, sharedNaverSession = null, generation = domesticSearchGeneration) {
  if (domesticSearchCanceled(generation)) throw new Error("DOMESTIC_SEARCH_CANCELED");
  const interactiveOfficialSearch = source.store === "ë¸Œëžœë“œ ê³µì‹ëª°"
    && !String(source.officialProductUrl || "")
    && /^https:\/\//i.test(String(source.homepageUrl || ""));
  const interactiveSiteSearch = interactiveOfficialSearch || source.interactiveSearch === true;
  const officialDirectUrl = source.store === "ë¸Œëžœë“œ ê³µì‹ëª°"
    ? String(source.directProductUrls?.[0] || "") : "";
  const url = String(officialDirectUrl || searchAttempt?.url || source.officialProductUrl || (interactiveOfficialSearch ? source.homepageUrl : source.searchUrl) || "");
  if (!/^https:\/\//i.test(url)) return { count: Number(source.count || 0), products: [] };
  const naverPortalSource = /^ë„¤ì´ë²„\s/.test(String(source.store || ""));
  // NAVER_SINGLE_OVERVIEW_SEARCH_V1: one Fashion Town overview search is captured once, then each card is classified locally.
  const ssgChannelSource = /^SSG(?:\s|$)/.test(String(source.store || ""));
  const musinsaSource = String(source.store || "") === "ë¬´ì‹ ì‚¬";
  let naverChannelCounts = null;
  let searchWindow;
  let musinsaSettledEmpty = false;
  let officialDirectDetail = null;
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
              const explicitEmpty = /ê²€ìƒ‰\\s*ê²°ê³¼ê°€?\\s*(?:ì—†|0)|ìƒí’ˆì´?\\s*(?:ì—†|0)|ê²€ìƒ‰ëœ\\s*ìƒí’ˆì´\\s*ì—†/i.test(pageText);
              return Boolean(exactSearch && document.documentElement && (cards > 0 || explicitEmpty));
            })()`, true).catch(() => false);
          }
        }
        if (!documentReady && !recoveredMusinsaResult) throw error;
      }
      // A brand adapter may know a stable product-detail route. Verify that
      // route against the exact POIZON article before falling back to the
      // mall's fragile, framework-controlled search-result grid.
      if (officialDirectUrl) {
        await wait(1_500);
        officialDirectDetail = await searchWindow.webContents.executeJavaScript(`(() => {
          const expected = ${JSON.stringify(sanitizeDomesticProductCode(articleNumber))};
          const compact = (value) => String(value || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
          const pageText = String(document.body?.innerText || "");
          const currentUrl = String(location.href || "");
          if (!expected || (!compact(currentUrl).includes(compact(expected))
            && !compact(pageText).includes(compact(expected)))) return null;
          const titleElement = document.querySelector('h1,[itemprop="name"],[class*="product" i][class*="title" i],[class*="goods" i][class*="name" i]');
          const productTitle = String(titleElement?.textContent || document.title || "").replace(/\\s+/g, " ").trim();
          const priceNodes = [...document.querySelectorAll('[itemprop="price"],[class*="price" i],strong,em,b,span')];
          const prices = priceNodes.map((element) => {
            const raw = String(element.getAttribute?.("content") || element.textContent || "").trim();
            const priceSemantic = element.getAttribute?.("itemprop") === "price"
              || /price/i.test(String(element.className?.baseVal || element.className || ""));
            const match = priceSemantic
              ? raw.match(/(?:[â‚©ï¿¦]\\s*)?([1-9][\\d,]{2,})\\s*ì›?/)
              : raw.match(/(?:[â‚©ï¿¦]\\s*([1-9][\\d,]{2,})|([1-9][\\d,]{2,})\\s*ì›)/);
            if (!match) return null;
            const amount = Number(String(match[1] || match[2]).replace(/,/g, ""));
            if (!Number.isFinite(amount) || amount < 1_000) return null;
            const style = getComputedStyle(element);
            const struck = /line-through/.test(style.textDecorationLine || style.textDecoration || "")
              || Boolean(element.closest("del,s,strike"));
            return { amount, value: amount.toLocaleString("ko-KR") + "ì›", struck };
          }).filter(Boolean).filter((item) => !item.struck).sort((a, b) => a.amount - b.amount);
          const image = [...document.querySelectorAll('img')].find((element) => {
            const src = String(element.currentSrc || element.src || "");
            const label = [src, element.alt, element.className].join(" ");
            const rect = element.getBoundingClientRect();
            return src && rect.width >= 120 && rect.height >= 120
              && !/logo|icon|sprite|badge|banner|placeholder|loading/i.test(label);
          });
          return {
            productUrl: currentUrl,
            title: productTitle,
            text: [productTitle, expected, prices[0]?.value || ""].filter(Boolean).join(" "),
            markup: String(titleElement?.outerHTML || ""),
            imageUrl: String(image?.currentSrc || image?.src || ""),
            imageLinkedToProduct: Boolean(image),
            price: prices[0]?.value || "",
            originalPrice: "",
          };
        })()`, true).catch(() => null);
        if (!officialDirectDetail) {
          const fallbackUrl = String(searchAttempt?.url || source.officialProductUrl || source.searchUrl || "");
          if (/^https:\/\//i.test(fallbackUrl) && fallbackUrl !== officialDirectUrl) {
            await searchWindow.loadURL(fallbackUrl).catch(() => {});
          }
        }
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
        if (!submitted && !interactiveOfficialSearch) {
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
        // Official-mall inputs are framework controlled. The code can be visibly
        // entered and the result grid can render even when the generic submit
        // detector does not observe a URL change. Continue to the bounded result
        // capture; only an explicit empty message may become "ìƒí’ˆ ì—†ìŒ".
        await wait(submitted ? 2_000 : 1_200);
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
      const channelSelected = source.store === "ë„¤ì´ë²„ ê³µì‹ ë¸Œëžœë“œìŠ¤í† ì–´"
        ? await ensureNaverOfficialBrandFilter(searchWindow)
        : await clickNaverShoppingChannel(searchWindow, source.store);
      if (!channelSelected) {
        return renderedSearchFailure(
          source.store === "ë„¤ì´ë²„ ê³µì‹ ë¸Œëžœë“œìŠ¤í† ì–´" ? "official_filter_failed" : "channel_selection_failed",
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
            explicitEmpty: /ê²€ìƒ‰\\s*ê²°ê³¼ê°€?\\s*(?:ì—†|0)|ìƒí’ˆì´?\\s*(?:ì—†|0)|ê²€ìƒ‰ëœ\\s*ìƒí’ˆì´\\s*ì—†/i.test(pageText),
            blocked: /captcha|ë³´ì•ˆ\\s*í™•ì¸|ë¹„ì •ìƒì ì¸\\s*ì ‘ê·¼|ì ‘ì†.{0,12}(?:ì œí•œ|ì°¨ë‹¨)/i.test(pageText),
            loginRequired: /ë¡œê·¸ì¸\\s*(?:í›„|ì´\\s*í•„ìš”|í•´ì£¼ì„¸ìš”)|íšŒì›\\s*ë¡œê·¸ì¸/i.test(pageText.slice(0, 10000)),
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
    if (officialDirectDetail) {
      await wait(750);
    } else if (naverPortalSource || ssgChannelSource || musinsaSource) {
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
    for (let attempt = 0; attempt < (officialDirectDetail ? 1 : 25); attempt += 1) {
      await wait(1_000);
      if (!searchWindow || searchWindow.isDestroyed()) break;
      const interruption = await searchWindow.webContents.executeJavaScript(`(() => {
        const pageText = String(document.body?.innerText || "").slice(0, 80000);
        return {
          blocked: /captcha|ë³´ì•ˆ\\s*í™•ì¸|ë¹„ì •ìƒì ì¸\\s*ì ‘ê·¼|ì ‘ì†.{0,12}(?:ì œí•œ|ì°¨ë‹¨)/i.test(pageText),
          loginRequired: /ë¡œê·¸ì¸\\s*(?:í›„|ì´\\s*í•„ìš”|í•´ì£¼ì„¸ìš”)|íšŒì›\\s*ë¡œê·¸ì¸/i.test(pageText.slice(0, 12000)),
        };
      })()`, true).catch(() => null);
      // Authentication and security screens cannot produce product results.
      // Preserve them as explicit non-empty failure states instead of waiting
      // and incorrectly reporting "ìƒí’ˆ ì—†ìŒ".
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
      // Official malls increasingly render result cards inside open shadow DOMs
      // and use generated class names. Collect every reachable root first, then
      // fall back to the card's structure (link + image + price) instead of
      // depending only on product-looking URL/class names.
      const roots = [document];
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll("*")) {
          if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
        }
      }
      const queryAll = (selector) => roots.flatMap((root) => [...root.querySelectorAll(selector)]);
      const allLinks = queryAll("a[href]");
      const directProductLinks = allLinks
        .filter((link) => visible(link) || matchesExpected(link.href) || matchesExpected(link.outerHTML))
        .filter((link) => /\\/(?:p|pd|products?|window-products|goods|product|(?:[a-z]{2}\\/)?t)\\//i.test(link.href)
          || /productDetail\\.action/i.test(link.href)
          || /\\/item\\/itemView\\.ssg/i.test(link.href)
          || matchesExpected(link.href)
          || matchesExpected(link.outerHTML));
      // SSGì™€ ë¡¯ë°ëŠ” í’ˆë²ˆì„ ìƒí’ˆ ë§í¬ ì•ˆì´ ì•„ë‹ˆë¼ ê°™ì€ ì¹´ë“œì˜ í˜•ì œ ì œëª©ì—
      // í‘œì‹œí•˜ê¸°ë„ í•œë‹¤. í’ˆë²ˆì„ í¬í•¨í•œ ì¹´ë“œì—ì„œ ì‹¤ì œ ë§í¬ë¥¼ ë‹¤ì‹œ ì°¾ëŠ”ë‹¤.
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
              && /[\\d,]+\\s*ì›/.test(cardText)
              && card.querySelector("img")
              && card.querySelector("a[href]")) return [...card.querySelectorAll("a[href]")];
          }
          return [];
        })
        .filter((link) => visible(link) || matchesExpected(link.closest("li,article,div")?.innerText));
      const structuralCardLinks = allLinks.filter((link) => {
        if (!visible(link) || /^(?:javascript:|mailto:|tel:)/i.test(String(link.getAttribute("href") || ""))) return false;
        if (link.closest("header,nav,footer,[role='navigation']")) return false;
        let card = link;
        for (let depth = 0; card && depth < 7 && card !== document.body; depth += 1, card = card.parentElement) {
          const text = String(card.innerText || "").replace(/\\s+/g, " ").trim();
          const image = card.querySelector("img[src],img[data-src],img[data-original],picture img");
          const price = /(?:â‚©|ï¿¦)\\s*[\\d,]+|[\\d,]+\\s*ì›/.test(text);
          if (image && price && text.length >= 5 && text.length <= 1200) return true;
        }
        return false;
      });
      const productLinks = [...new Set([
        ...directProductLinks, ...articleCardLinks, ...articleTextCardLinks, ...structuralCardLinks,
      ])];
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
        // SSG places its brand and "ë³¸ì‚¬ì§ì˜" badges near the product title,
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
            if (!/^[\\d,]+\\s*ì›$/.test(value)) return null;
            const style = getComputedStyle(element);
            const struck = /line-through/.test(style.textDecorationLine || style.textDecoration || "")
              || Boolean(element.closest("del,s,strike"));
            const className = String(element.className?.baseVal || element.className || "");
            const context = [className, element.getAttribute?.("aria-label"), element.getAttribute?.("title"),
              element.parentElement?.className, element.previousElementSibling?.textContent]
              .join(" ").replace(/\\s+/g, " ").slice(0, 240);
            if (/ë°°ì†¡(?:ë¹„)?|ì ë¦½|í¬ì¸íŠ¸|í˜œíƒ|ì¿ í°|ì›”\\s*ë‚©ë¶€/i.test(context)) return null;
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
        const fallbackPrice = text.split("\\n")
          .map((line) => String(line || "").trim())
          .filter((line) => !/ë°°ì†¡(?:ë¹„)?|ì ë¦½|í¬ì¸íŠ¸|í˜œíƒ|ì¿ í°|ì›”\\s*ë‚©ë¶€/i.test(line))
          .map((line) => line.match(/[\\d,]+\\s*ì›/)?.[0] || "")
          .find(Boolean) || "";
        const price = priceCandidates[0]?.value || fallbackPrice;
        const originalPrice = [...(card?.querySelectorAll?.("del,s,strike") || [])]
          .map((element) => String(element.textContent || "").trim())
          .find((value) => /^[\\d,]+\\s*ì›$/.test(value)) || "";
        seen.add(productKey);
        const channelEvidenceText = [text, markup].join(" ");
        const officialBrandStoreLabelMatched = /ë¸Œëžœë“œ\s*ì§ì˜ëª°|ê³µì‹\s*ë¸Œëžœë“œ|ë¸Œëžœë“œ\s*ìŠ¤í† ì–´/i.test(channelEvidenceText);
        const departmentStoreLabelMatched = /ë°±í™”ì /i.test(channelEvidenceText);
        const outletLabelMatched = /ì•„ìš¸ë ›|outlet/i.test(channelEvidenceText);
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
      const selectedChannelEmpty = /ê²€ìƒ‰ëœ\s*ìƒí’ˆì´\s*ì—†(?:ìŠµë‹ˆë‹¤|ì–´)|ê²€ìƒ‰\s*ê²°ê³¼ê°€?\s*ì—†(?:ìŠµë‹ˆë‹¤|ì–´)|ìƒí’ˆì´\s*ì—†(?:ìŠµë‹ˆë‹¤|ì–´)|ê²€ìƒ‰ê²°ê³¼\s*ì—†ìŒ/i.test(fullPageText);
      const requestedStore = ${JSON.stringify(String(source.store || ""))};
      const recognizedChannelCounts = ${JSON.stringify(naverChannelCounts)};
      const channelLabels = requestedStore.includes("ê³µì‹ ë¸Œëžœë“œìŠ¤í† ì–´")
        ? ["ë¸Œëžœë“œì§ì˜ëª°", "ê³µì‹ë¸Œëžœë“œ", "ë¸Œëžœë“œìŠ¤í† ì–´"]
        : requestedStore.includes("ë°±í™”ì ") ? ["ë°±í™”ì "]
          : requestedStore.includes("ì•„ìš¸ë ›") ? ["ì•„ìš¸ë ›"] : [];
      let selectedChannelCount = Number.isFinite(recognizedChannelCounts?.[requestedStore])
        ? Number(recognizedChannelCounts[requestedStore]) : null;
      for (const label of channelLabels) {
        const escaped = label.replace(/[.*+?^{}()|[\]\\$]/g, "\\$&");
        const match = fullPageText.match(new RegExp(escaped + "\\s*([\\d,]+)\\s*ê°œ", "i"));
        if (!match) continue;
        selectedChannelCount = Math.max(selectedChannelCount ?? 0, Number(match[1].replace(/,/g, "")) || 0);
      }
      const pageBlocked = /captcha|ë³´ì•ˆ\s*í™•ì¸|ìžë™\s*ìž…ë ¥|ë¡œë´‡|ì ‘ì†.{0,12}(?:ì œí•œ|ì°¨ë‹¨)|ì„œë¹„ìŠ¤.{0,12}(?:ì œí•œ|ì§€ì—°)|ë¹„ì •ìƒì ì¸\s*ì ‘ê·¼/i.test(pageText);
      return JSON.stringify({ productCards, pageBlocked, pageText, pageHeaderText, selectedChannelEmpty, selectedChannelCount });
    })()`, true);
    let parsedContent;
    try {
      parsedContent = JSON.parse(content);
      if (officialDirectDetail) {
        parsedContent.productCards = [officialDirectDetail];
        parsedContent.selectedChannelEmpty = false;
        content = JSON.stringify(parsedContent);
      }
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
      const expectedNaverChannel = source.store === "ë„¤ì´ë²„ ë°±í™”ì " ? "department"
        : source.store === "ë„¤ì´ë²„ ì•„ìš¸ë ›" ? "outlet"
          : source.store === "ë„¤ì´ë²„ ê³µì‹ ë¸Œëžœë“œìŠ¤í† ì–´" ? "brand-store" : "";
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
    if (["SSG ë°±í™”ì ", "SSG ì•„ìš¸ë ›"].includes(String(source.store || ""))) {
      const department = source.store === "SSG ë°±í™”ì ";
      const headerMatched = department
        ? /ì‹ ì„¸ê³„\s*ë°±í™”ì |ë°±í™”ì /i.test(String(parsedContent.pageHeaderText || ""))
        : /ì•„ìš¸ë ›|outlet/i.test(String(parsedContent.pageHeaderText || ""));
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
    // Official malls, Naver, SSG and Lotte are list-only sources. Their visible
    // cards provide the title, current price and real product link. Never open
    // every detail page or inspect stock: the user verifies a chosen item.
    if (/^(?:ë¸Œëžœë“œ ê³µì‹ëª°$|ë„¤ì´ë²„\s|SSG(?:\s|$)|ë¡¯ë°ì˜¨(?:\s|$))/.test(String(source.store || ""))) {
      const listProducts = /^ë„¤ì´ë²„\s/.test(String(source.store || ""))
        ? await filterApprovedNaverDomesticProducts(analyzed.products || [])
        : (analyzed.products || []);
      const officialMallSource = String(source.store || "") === "ë¸Œëžœë“œ ê³µì‹ëª°";
      const explicitAbsence = officialMallSource
        ? analyzed.absenceConfirmed === true || parsedContent.selectedChannelEmpty === true
        : listProducts.length === 0;
      return {
        ...detailed,
        count: listProducts.length,
        products: listProducts.map((product) => ({
          ...product,
          linkOnly: officialMallSource || product.linkOnly === true,
          linkVerified: /^https?:\/\//i.test(String(product.url || "")),
          inStock: null,
          sizes: [],
        })),
        presenceConfirmed: listProducts.length > 0,
        absenceConfirmed: explicitAbsence,
        resultLinkOnly: officialMallSource && listProducts.length === 0 && !explicitAbsence,
        detailVerificationPending: false,
        verificationReason: /^ë„¤ì´ë²„\s/.test(String(source.store || ""))
          ? (listProducts.length > 0 ? "approved_domestic_seller" : "approved_domestic_seller_not_found")
          : String(detailed.verificationReason || ""),
      };
    }
    if (Array.isArray(analyzed?.products)) {
      const products = [];
      const inspectedProducts = analyzed.products.slice(0, 8);
      const attemptedQuery = sanitizeDomesticQuery(searchAttempt?.query || source.searchQuery || articleNumber || title);
      const exactCodeQuery = sanitizeDomesticProductCode(articleNumber);
      const isCodePriorityAttempt = Boolean(exactCodeQuery && attemptedQuery === exactCodeQuery);
      let identityRequiredCount = 0;
      let identityCheckedCount = 0;
      let identityMismatchCount = 0;
      for (const product of inspectedProducts) {
        let detailText = "";
        let detailIdentity = { titleText: "", labeledText: "", structuredCodes: [] };
        let detailLoaded = false;
        let stockEvidence = normalizeRenderedStockEvidence();
        try {
          const productOpened = await clickRenderedProductCard(searchWindow, product.url, resolvedSearchUrl);
          if (!productOpened) throw new Error("PRODUCT_CARD_CLICK_FAILED");
          await wait(1_000);
          await openRenderedSizeOptions(searchWindow);
          const identitySnapshot = await searchWindow.webContents.executeJavaScript(`(() => {
            const pageText = String(document.body?.innerText || "").slice(0, 60000);
            const titleText = [...document.querySelectorAll('h1,[itemprop="name"],[class*="product" i][class*="title" i],[class*="goods" i][class*="name" i]')]
              .map((element) => String(element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim())
              .filter(Boolean).slice(0, 8).join(" ").slice(0, 2000);
            const identityLabel = /í’ˆ\\s*ë²ˆ|ìƒí’ˆ\\s*(?:ë²ˆí˜¸|ì½”ë“œ)|ì œí’ˆ\\s*(?:ë²ˆí˜¸|ì½”ë“œ)|ëª¨ë¸\\s*(?:ëª…|ë²ˆí˜¸|ì½”ë“œ)?|ìŠ¤íƒ€ì¼\\s*(?:ë²ˆí˜¸|ì½”ë“œ)?|style\\s*(?:no|number|code)?|model\\s*(?:no|number|code)?|sku|mpn/i;
            const labeledText = pageText.split(/\\n+/).map((line) => line.replace(/\\s+/g, " ").trim())
              .filter((line) => identityLabel.test(line)).slice(0, 40).join("\\n");
            const structuredCodes = [];
            const add = (value) => {
              if (Array.isArray(value)) return value.forEach(add);
              if (value !== undefined && value !== null && String(value).trim()) structuredCodes.push(String(value).trim());
            };
            for (const element of document.querySelectorAll('[itemprop="sku"],[itemprop="mpn"],[itemprop="model"]')) {
              add(element.getAttribute("content") || element.textContent);
            }
            for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
              try {
                const walk = (value) => {
                  if (!value || typeof value !== "object") return;
                  if (Array.isArray(value)) return value.forEach(walk);
                  for (const [key, child] of Object.entries(value)) {
                    if (/^(?:sku|mpn|model|styleNo|articleNumber)$/i.test(key)) add(child);
                    else if (child && typeof child === "object") walk(child);
                  }
                };
                walk(JSON.parse(script.textContent || "null"));
              } catch {}
            }
            return JSON.stringify({ pageText, titleText, labeledText, structuredCodes: [...new Set(structuredCodes)].slice(0, 30) });
          })()`, true).then(JSON.parse).catch(() => null);
          if (identitySnapshot) {
            detailText = String(identitySnapshot.pageText || "");
            detailIdentity = identitySnapshot;
            detailLoaded = true;
          }
          const rawStock = await searchWindow.webContents.executeJavaScript(`(() => {
            const visible = (element) => {
              if (!element) return false;
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
            };
            const sold = (element) => element.disabled
              || element.getAttribute("aria-disabled") === "true"
              || /disabled|sold.?out|í’ˆì ˆ|ìž¬ê³ .?ì—†ìŒ/i.test([element.className, element.textContent].join(" "));
            const optionNodes = [
              ...document.querySelectorAll("select option"),
              ...document.querySelectorAll('[class*="size" i] button,[class*="option" i] button,[data-option],[data-size],[role="option"],[role="listbox"] li,[class*="dropdown" i] li'),
            ];
            // Some official malls render size choices as plain buttons/labels
            // with no size-related class. Include those only when their own
            // label looks like an apparel/shoe size and their nearby field is
            // explicitly headed by "ì‚¬ì´ì¦ˆ/size", avoiding quantity buttons.
            const plainSizeNodes = [...document.querySelectorAll('button,label,[role="button"],input[type="radio"]')]
              .filter(visible)
              .filter((element) => {
                const label = String(element.getAttribute("data-size") || element.value || element.textContent || "").replace(/\\s+/g, " ").trim();
                if (!/^(?:FREE|ONE\s*SIZE|XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-9]?\d{1,2}(?:\.5)?|[12]\d{2}|[2-3]\d{2}(?:\.5)?)$/i.test(label)) return false;
                let scope = element.parentElement;
                for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
                  const scopeText = String(scope.innerText || "").slice(0, 1200);
                  if (/ì‚¬ì´ì¦ˆ|size/i.test(scopeText)) return true;
                }
                return false;
              });
            const uniqueOptionNodes = [...new Set([...optionNodes, ...plainSizeNodes])];
            const options = uniqueOptionNodes.slice(0, 160).map((element) => ({
              label: String(element.getAttribute("data-size") || element.getAttribute("data-option") || element.textContent || "").replace(/\\s+/g, " ").trim(),
              inStock: !sold(element),
            }));
            const purchaseAvailable = [...document.querySelectorAll('button,a,[role="button"]')].some((element) =>
              visible(element) && !sold(element) && /êµ¬ë§¤|ë°”ë¡œêµ¬ë§¤|ìž¥ë°”êµ¬ë‹ˆ|BUY\s*NOW|ADD\s*TO\s*(?:BAG|CART)/i.test(element.textContent || element.getAttribute("aria-label") || "")
            );
            const pageText = String(document.body?.innerText || "").slice(0, 60000);
            const loginRequired = /(?:login|signin|member\/login|auth\/login)/i.test(location.href)
              || [...document.querySelectorAll('input[type="password"]')].some(visible)
              || /ë¡œê·¸ì¸\s*(?:í›„|ì´\s*í•„ìš”|í•´ì£¼ì„¸ìš”)|íšŒì›\s*ë¡œê·¸ì¸/i.test(pageText.slice(0, 8000));
            return { pageText, purchaseAvailable, options, loginRequired };
          })()`, true).catch(() => null);
          if (rawStock) stockEvidence = normalizeRenderedStockEvidence(rawStock);
        } catch {}
        if (product.detailArticleVerificationRequired) identityRequiredCount += 1;
        const detailArticleVerified = product.detailArticleVerificationRequired
          ? strictProductArticleIdentityMatch(detailIdentity, articleNumber) : false;
        const titleFallbackVerified = product.detailArticleVerificationRequired
          && !isCodePriorityAttempt
          && product.brandVerifiedFromCard === true
          && titleIdentityMatch(`${String(product.title || "")} ${String(detailIdentity.titleText || "")}`, title);
        if (product.detailArticleVerificationRequired && detailLoaded) identityCheckedCount += 1;
        const linkOnlySource = String(product?.store || "") === "ë¸Œëžœë“œ ê³µì‹ëª°"
          || /^ë„¤ì´ë²„\s/.test(String(product?.store || ""));
        if (product.detailArticleVerificationRequired && !detailArticleVerified && !titleFallbackVerified) {
          if (detailLoaded) identityMismatchCount += 1;
          if (linkOnlySource) {
            products.push({
              ...product,
              linkOnly: true,
              linkVerified: /^https?:\/\//i.test(String(product?.url || "")),
              articleNumber: product.articleNumberVerified === true ? product.articleNumber : "",
              inStock: null,
              sizes: [],
              stockStatus: "manual_check",
              stockVerified: false,
            });
          }
          continue;
        }
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
          articleNumber: detailArticleVerified || product.articleNumberVerified === true ? articleNumber : "",
          articleNumberVerified: detailArticleVerified || product.articleNumberVerified === true,
          matchBasis: detailArticleVerified ? "article" : titleFallbackVerified ? "brand_title" : "card_article",
          store: isSsg && classification === "official_brand"
            ? "SSG ë¸Œëžœë“œ ê³µì‹ê´€"
            : isSsg && classification === "parallel_import" ? "SSG ë³‘í–‰ìˆ˜ìž…" : product.store,
          retailerName: isSsg && classification === "official_brand"
            ? (/ë³¸ì‚¬\s*ì§ì˜/i.test(evidence) || /ë³¸ì‚¬\s*ì§ì˜/i.test(String(product.retailerName || ""))
              ? "ë¸Œëžœë“œ ê³µì‹ê´€ Â· ë³¸ì‚¬ì§ì˜" : "ë¸Œëžœë“œ ê³µì‹ê´€ Â· ê³µì‹ìˆ˜ìž…")
            : isSsg && classification === "parallel_import" ? (retailer || "ë³‘í–‰ìˆ˜ìž… ìƒí’ˆ") : product.retailerName,
          officialStoreVerified: isSsg ? classification === "official_brand" : product.officialStoreVerified,
          ssgClassification: classification,
          ssgDetailVerified: Boolean(detailText),
          ...stockEvidence,
        });
      }
      const preserveNaverChannelCount = /^ë„¤ì´ë²„\s/.test(String(source.store || ""))
        && Number.isFinite(analyzed?.channelCount);
      const authoritativeIdentityMismatch = identityRequiredCount > 0
        && identityCheckedCount === identityRequiredCount
        && identityMismatchCount === identityRequiredCount;
      detailed = {
        ...analyzed,
        resolvedSearchUrl,
        count: preserveNaverChannelCount ? Number(analyzed.channelCount) : products.length,
        products,
        searchCompleted: true,
        searchSubmitted: interactiveSiteSearch,
        candidateCount,
        naverChannelCounts,
        absenceConfirmed: analyzed.absenceConfirmed === true || authoritativeIdentityMismatch,
        detailVerificationPending: candidateCount > 0 && products.length === 0 && !authoritativeIdentityMismatch,
      };
    }
    if (source.store !== "ë¸Œëžœë“œ ê³µì‹ëª°" || !Array.isArray(detailed?.products)) return detailed;
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
    // Official malls remain product-code-only. Other stores use the complete
    // accuracy-first fallback order: code -> title -> title+code.
      const queryAttempts = source.store === "ë¸Œëžœë“œ ê³µì‹ëª°"
        ? allQueryAttempts.slice(0, 1) : allQueryAttempts;
      let result = null;
      for (let queryAttemptIndex = 0; queryAttemptIndex < queryAttempts.length; queryAttemptIndex += 1) {
        const queryAttempt = queryAttempts[queryAttemptIndex];
        if (domesticSearchCanceled(generation)) throw new Error("DOMESTIC_SEARCH_CANCELED");
        // A Naver overview DOM belongs to exactly one submitted query. When an
        // exact-code result is authoritatively absent, discard that DOM before
        // submitting the next ranked query; otherwise the old code result is
        // accidentally reused and the title fallback never actually runs.
        if (/^ë„¤ì´ë²„\s/.test(String(source.store || "")) && queryAttemptIndex > 0) {
          if (sharedNaverSession.window && !sharedNaverSession.window.isDestroyed()) {
            sharedNaverSession.window.destroy();
          }
          sharedNaverSession.window = null;
          sharedNaverSession.resultsUrl = "";
          sharedNaverSession.channelCounts = null;
          sharedNaverSession.searchSubmitted = false;
        }
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
      const isOfficialStore = source.store === "ë¸Œëžœë“œ ê³µì‹ëª°";
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
        verificationFailed: result?.resultLinkOnly === true ? false : !Number.isFinite(count),
        verificationPending: result?.resultLinkOnly === true ? false : (
          result?.detailVerificationPending === true
          || result?.verificationPending === true
          || (Number.isFinite(count) && Number(count) === 0 && !absenceConfirmed)),
        absenceConfirmed,
        presenceConfirmed: result?.presenceConfirmed === true,
        resultLinkOnly: result?.resultLinkOnly === true,
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
    if (source.store === "ë„¤ì´ë²„ íŒ¨ì…˜íƒ€ìš´"
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
    adapterId: String(record.adapterId || ""),
    adapterStatus: String(record.adapterStatus || "pending"),
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
      officialAdapterId: official?.adapterId || "",
      officialAdapterStatus: official?.adapterStatus || "pending",
    };
  });
}

async function ensureOfficialDomainRegistry(brands) {
  const settings = store.snapshot().settings;
  const current = Array.isArray(settings.officialBrandRegistry) ? settings.officialBrandRegistry : [];
  const registry = createOfficialDomainRegistry(brands, current).map(officialMallAdapterRecord);
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
  const registry = createOfficialDomainRegistry(brands, Array.isArray(saved) ? saved : []).map(officialMallAdapterRecord);
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
    scheduleLabel: "ë§¤ì¼ ìƒˆë²½ 1ì‹œ~6ì‹œ",
    ...officialDomainRegistrySummary(registry),
    ...officialMallAdapterSummary(registry),
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
  const filePath = join(folder, "ë„¤ì´ë²„_ê³µì‹ëª°_ë¯¸ë°œê²¬_ë¸Œëžœë“œ.xlsx");
  await writeXlsxFile(naverOfficialStoreNotFoundWorkbookData(rows), {
    sheet: "ê³µì‹ëª° ë¯¸ë°œê²¬",
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
    const blocked = /captcha|ë³´ì•ˆ\\s*í™•ì¸|ìžë™\\s*ìž…ë ¥|ë¹„ì •ìƒì ì¸\\s*ì ‘ê·¼|ë¡œë´‡ì´ ì•„ë‹™ë‹ˆë‹¤|ì ‘ì†.{0,12}(?:ì œí•œ|ì°¨ë‹¨)/i.test(text);
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
  const existingHomepage = String(record.homepageUrl || "");
  const existingHost = (() => {
    try { return new URL(existingHomepage).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { return ""; }
  })();
  if (existingHomepage && existingHost !== "brand.naver.com"
    && [OFFICIAL_DOMAIN_STATUS.VERIFIED, OFFICIAL_DOMAIN_STATUS.SEARCH_UNSUPPORTED].includes(record.status)) {
    try {
      onPhase("official_site");
      const page = await loadAuditPage(auditWindow, existingHomepage);
      if (!page.blocked) {
        const logoComparison = await compareOfficialBrandLogosWithinLimit(record.brandLogoUrl, page.logoUrls || []);
        const rechecked = auditedOfficialDomainRecord(record, {
            candidateUrl: existingHomepage,
            finalUrl: page.finalUrl,
            pageTitle: page.pageTitle,
            pageText: page.text,
            searchTemplate: record.searchTemplate || page.searchTemplate,
            logoCompared: logoComparison.compared,
            logoSimilarity: logoComparison.similarity,
            verifiedAlias: brand,
          });
        return {
          record: rechecked.status === OFFICIAL_DOMAIN_STATUS.PENDING ? {
            ...record,
            verificationAttempts: rechecked.verificationAttempts,
            lastCheckedAt: rechecked.lastCheckedAt,
            lastVerificationError: rechecked.lastVerificationError || "OFFICIAL_RECHECK_EVIDENCE_MISSING",
          } : rechecked,
          blocked: false,
        };
      }
    } catch {
      return {
        record: {
          ...record,
          verificationAttempts: Number(record.verificationAttempts || 0) + 1,
          lastCheckedAt: new Date().toISOString(),
          lastVerificationError: "OFFICIAL_RECHECK_LOAD_FAILED",
        },
        blocked: false,
      };
    }
  }
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
      // ë‹¤ìŒ í›„ë³´ ë„ë©”ì¸ì„ í™•ì¸í•œë‹¤.
    }
  }
  // Only an independent brand-owned domain belongs in the official-mall row.
  // Naver Brand Store remains a separate domestic source.
  return { record: noOfficialStoreRecord(record), blocked: false };
}

async function persistOfficialDomainAudit(registry, audit) {
  await store.setSettings({
    officialBrandRegistry: registry,
    officialBrandRegistryUpdatedAt: new Date().toISOString(),
    officialDomainAudit: { ...audit, updatedAt: new Date().toISOString() },
  });
}

async function runOfficialDomainAudit({ recheckAll = false } = {}) {
  if (officialDomainAuditRunning) return;
  clearTimeout(officialDomainAuditResumeTimer);
  officialDomainAuditResumeTimer = null;
  officialDomainAuditRunning = true;
  officialDomainAuditStopRequested = false;
  const brands = store.snapshot().settings.brandCatalog || explorerMetadata().brands;
  let registry = await ensureOfficialDomainRegistry(brands);
  const previousAudit = store.snapshot().settings.officialDomainAudit || {};
  const continuingFullRecheck = recheckAll && previousAudit.recheckAll === true
    && ["running", "paused", "blocked"].includes(String(previousAudit.state || ""))
    && Boolean(previousAudit.startedAt);
  const startedAt = continuingFullRecheck ? String(previousAudit.startedAt) : new Date().toISOString();
  const startedAtMs = Date.parse(startedAt) || Date.now();
  let processed = 0;
  let blocked = false;
  let lastError = "";
  officialDomainAuditWindow = createOfficialDomainAuditWindow();
  try {
    const auditQueue = recheckAll
      ? registry.map((record, index) => ({ record, index }))
        .filter(({ record }) => Date.parse(record.lastCheckedAt || 0) < startedAtMs)
        .map(({ index }) => index)
      : officialDomainAuditQueue(registry);
    const runTotal = auditQueue.length;
    await persistOfficialDomainAudit(registry, {
      state: "running", currentBrand: "", processed: 0, blocked: false, lastError: "",
      recheckAll, startedAt, runTotal,
    });
    const deferredIndices = [];
    const processAuditIndex = async (index, attempt) => {
      if (officialDomainAuditStopRequested) return null;
      const record = registry[index];
      if (!recheckAll && record.status !== OFFICIAL_DOMAIN_STATUS.PENDING) return;
      const currentBrand = record.brandKo || record.brandName;
      const progress = (phase) => sendOfficialDomainAuditProgress(registry, {
        state: "running", currentBrand, processed, blocked: false, lastError: "", phase, attempt,
        recheckAll, startedAt, runTotal,
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
      progress("adapter_linkage");
      result.record = officialMallAdapterRecord(result.record);
      registry[index] = result.record;
      processed += 1;
      blocked = result.blocked;
      lastError = result.record.lastVerificationError || "";
      if (processed % 5 === 0 || blocked) {
        await persistOfficialDomainAudit(registry, {
          state: blocked ? "blocked" : "running", currentBrand, processed, blocked, lastError,
          phase: blocked ? "security_wait" : "saved", attempt, recheckAll, startedAt, runTotal,
        });
      }
      sendOfficialDomainAuditProgress(registry, {
        state: blocked ? "blocked" : "running", currentBrand, processed, blocked, lastError,
        phase: blocked ? "security_wait" : "saved", attempt,
        recheckAll, startedAt, runTotal,
        updatedBrand: {
          brandId: Number(result.record.brandId),
          status: result.record.status,
          homepageUrl: String(result.record.homepageUrl || ""),
          adapterId: String(result.record.adapterId || ""),
          adapterStatus: String(result.record.adapterStatus || "pending"),
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
      recheckAll, startedAt, runTotal,
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

// ì´ ì•±ì€ GPU ê°€ì†ì´ í•„ìš”í•˜ì§€ ì•Šìœ¼ë©° ì¼ë¶€ Windows ê·¸ëž˜í”½ ë“œë¼ì´ë²„ì˜
// GPU í”„ë¡œì„¸ìŠ¤ ë°˜ë³µ ì¢…ë£Œë¥¼ í”¼í•˜ê¸° ìœ„í•´ ì†Œí”„íŠ¸ì›¨ì–´ ë Œë”ë§ì„ ì‚¬ìš©í•©ë‹ˆë‹¤.
app.disableHardwareAcceleration();

function sendUpdateStatus(status, message, extra = {}) {
  mainWindow?.webContents.send("update:status", { status, message, currentVersion: app.getVersion(), ...extra });
  if (["downloaded", "installing", "error"].includes(status) && !(status === "downloaded" && extra.waitingForWork)) {
    void addProgramNotification({
      type: status === "error" ? "error" : "update",
      title: status === "error" ? "ì—…ë°ì´íŠ¸ ì˜¤ë¥˜" : status === "installing" ? "ì—…ë°ì´íŠ¸ ì„¤ì¹˜ ì‹œìž‘" : "ì—…ë°ì´íŠ¸ ë‹¤ìš´ë¡œë“œ ì™„ë£Œ",
      message,
      key: `update:${status}:${String(extra.version || app.getVersion())}:${message}`,
      windows: status !== "installing",
    });
  }
}

async function addProgramNotification({ type = "info", title = "í”„ë¡œê·¸ëž¨ ì•Œë¦¼", message = "", key = "", windows = false } = {}) {
  if (!store) return null;
  const current = Array.isArray(store.snapshot()?.settings?.programNotifications)
    ? store.snapshot().settings.programNotifications : [];
  if (key && current.some((item) => item.key === key)) return null;
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    key: String(key || ""), type: String(type || "info"), title: String(title || "í”„ë¡œê·¸ëž¨ ì•Œë¦¼"),
    message: String(message || ""), createdAt: new Date().toISOString(), read: false,
  };
  const programNotifications = [item, ...current].slice(0, 100);
  await store.setSettings({ programNotifications });
  mainWindow?.webContents.send("notifications:added", item);
  if (windows && Notification.isSupported()) {
    const notice = new Notification({ title: `Around G Â· ${item.title}`, body: item.message });
    notice.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });
    notice.show();
  }
  return item;
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
    sendUpdateStatus("downloaded", "ì—…ë°ì´íŠ¸ ì¤€ë¹„ ì™„ë£Œ Â· í˜„ìž¬ ìž‘ì—…ì´ ëë‚˜ë©´ ìžë™ ì„¤ì¹˜í•©ë‹ˆë‹¤.", {
      waitingForWork: true,
    });
    updateInstallTimer = setTimeout(installDownloadedUpdateWhenSafe, UPDATE_INSTALL_RETRY_MS);
    return;
  }
  sendUpdateStatus("installing", "ì—…ë°ì´íŠ¸ë¥¼ ìžë™ ì„¤ì¹˜í•˜ê³  ë‹¤ì‹œ ì‹œìž‘í•©ë‹ˆë‹¤.");
  updateInstallTimer = setTimeout(() => {
    if (updateReady) autoUpdater.quitAndInstall(true, true);
  }, 3_000);
}

function configureUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus("checking", "ìƒˆ ë²„ì „ì„ í™•ì¸í•˜ê³  ìžˆìŠµë‹ˆë‹¤."));
  autoUpdater.on("update-available", (info) => sendUpdateStatus("downloading", `ìƒˆ ë²„ì „ ${info.version}ì„ ìžë™ìœ¼ë¡œ ë‹¤ìš´ë¡œë“œí•©ë‹ˆë‹¤.`, {
    version: info.version,
    releaseDate: info.releaseDate || ""
  }));
  autoUpdater.on("update-not-available", () => sendUpdateStatus("current", "í˜„ìž¬ ìµœì‹  ë²„ì „ìž…ë‹ˆë‹¤."));
  autoUpdater.on("download-progress", (info) => sendUpdateStatus("downloading", `ì—…ë°ì´íŠ¸ ë‹¤ìš´ë¡œë“œ ${Math.round(info.percent)}%`, { percent: info.percent }));
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    clearTimeout(updateCheckTimer);
    sendUpdateStatus("downloaded", `ë²„ì „ ${info.version} ë‹¤ìš´ë¡œë“œê°€ ì™„ë£Œë˜ì—ˆìŠµë‹ˆë‹¤.`, {
      version: info.version,
      releaseDate: info.releaseDate || ""
    });
    installDownloadedUpdateWhenSafe();
  });
  autoUpdater.on("error", (error) => {
    sendUpdateStatus("error", `ì—…ë°ì´íŠ¸ í™•ì¸ ì‹¤íŒ¨: ${error.message}`);
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
    searchWindow.setTitle(`${source.name} ê³„ì •ì •ë³´ë¥¼ ì„¤ì •í•œ ë’¤ ê²€ìƒ‰í•´ ì£¼ì„¸ìš”`);
    return { ok: false, required: true, reason: "OFFICIAL_CREDENTIALS_REQUIRED" };
  }
  await searchWindow.loadURL(source.loginUrl).catch(() => {});
  await wait(1_200);
  const state = await searchWindow.webContents.executeJavaScript(`(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };
    const fields = [...document.querySelectorAll('input')].filter(visible);
    const user = fields.find((el) => /email|user|login|ì•„ì´ë””|ì´ë©”ì¼/i.test([el.name, el.id, el.type, el.autocomplete, el.placeholder, el.getAttribute('aria-label')].join(' ')) && el.type !== 'password');
    const password = fields.find((el) => el.type === 'password' || /password|ë¹„ë°€ë²ˆí˜¸/i.test([el.name, el.id, el.placeholder, el.getAttribute('aria-label')].join(' ')));
    if (!user || !password) return { formFound: false };
    const setValue = (el, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    setValue(user, ${JSON.stringify(credentials.id)});
    setValue(password, ${JSON.stringify(credentials.password)});
    const submit = [...document.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(visible).find((el) => /ë¡œê·¸ì¸|log\s*in|sign\s*in/i.test([el.textContent, el.value, el.getAttribute('aria-label')].join(' ')));
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
    searchWindow.setTitle(`${source.name} ë¡œê·¸ì¸ í™•ì¸ í•„ìš” Â· ë¡œê·¸ì¸ ì™„ë£Œ í›„ ë‹¤ì‹œ ê²€ìƒ‰`);
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
    ledgerWebhookUrl: settings.ledgerWebhookUrl || "",
    hasLedgerSecret: Boolean(settings.ledgerSecretEncrypted),
  };
}

function openMusinsaLedgerWindow() {
  if (musinsaLedgerWindow && !musinsaLedgerWindow.isDestroyed()) {
    musinsaLedgerWindow.show(); musinsaLedgerWindow.focus();
    return { ok: true };
  }
  musinsaLedgerWindow = new BrowserWindow({
    icon: APP_ICON_PATH, width: 1320, height: 900, title: "ë¬´ì‹ ì‚¬ ì£¼ë¬¸ ìƒì„¸ Â· êµ¬ë§¤ìž¥ë¶€ ê°€ì ¸ì˜¤ê¸°",
    webPreferences: { partition: DOMESTIC_SEARCH_PARTITION, sandbox: true, contextIsolation: true },
  });
  musinsaLedgerWindow.on("closed", () => { musinsaLedgerWindow = null; });
  void musinsaLedgerWindow.loadURL("https://www.musinsa.com/mypage/orders");
  return { ok: true };
}

async function captureMusinsaLedgerOrder() {
  if (!musinsaLedgerWindow || musinsaLedgerWindow.isDestroyed()) return { ok: false, code: "ORDER_WINDOW_CLOSED", message: "ë¬´ì‹ ì‚¬ ì£¼ë¬¸ ìƒì„¸ í™”ë©´ì„ ë¨¼ì € ì—´ì–´ì£¼ì„¸ìš”." };
  const url = musinsaLedgerWindow.webContents.getURL();
  if (!/musinsa\.com/i.test(url)) return { ok: false, code: "NOT_MUSINSA", message: "ë¬´ì‹ ì‚¬ ì£¼ë¬¸ ìƒì„¸ í™”ë©´ì—ì„œ ë‹¤ì‹œ ì‹œë„í•´ ì£¼ì„¸ìš”." };
  const rows = await musinsaLedgerWindow.webContents.executeJavaScript(`(() => {
    const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const body = clean(document.body?.innerText);
    const orderNumber = body.match(/(?:ì£¼ë¬¸\\s*ë²ˆí˜¸|order\\s*(?:no|number))\\s*[:ï¼š]?\\s*([0-9A-Z-]{6,})/i)?.[1] || '';
    const date = body.match(/(?:ì£¼ë¬¸\\s*(?:ì¼ìž|ì¼ì‹œ)|ê²°ì œ\\s*(?:ì¼ìž|ì¼ì‹œ))\\s*[:ï¼š]?\\s*(20\\d{2}[.\\/-]\\d{1,2}[.\\/-]\\d{1,2})/)?.[1]?.replace(/[.\\/]/g, '-') || '';
    const links = [...document.querySelectorAll('a[href*="/products/"]')];
    const unique = [...new Map(links.map(link => [new URL(link.href, location.href).pathname.match(/\\/products\\/(\\d+)/)?.[1], link])).entries()].filter(([id]) => id);
    return unique.map(([id, link]) => {
      const card = link.closest('article,li,[class*="order" i],[class*="product" i],[class*="goods" i]') || link.parentElement;
      const text = clean(card?.innerText || link.innerText);
      const image = card?.querySelector('img');
      const priceMatches = [...text.matchAll(/([0-9][0-9,]{2,})\\s*ì›/g)].map(m => Number(m[1].replace(/,/g,''))).filter(Boolean);
      const size = text.match(/(?:ì‚¬ì´ì¦ˆ|ì˜µì…˜)\\s*[:ï¼š]?\\s*([0-9A-Z./ -]{1,20})/i)?.[1]?.trim() || '';
      const lines = String(card?.innerText || '').split('\\n').map(clean).filter(Boolean);
      return { platform:'ë¬´ì‹ ì‚¬', orderNumber, purchaseDate:date, purchaseUrl:link.href, articleNumber:id,
        modelName:clean(image?.alt) || lines.find(v => v.length > 3 && !/ì›|ì£¼ë¬¸|ë°°ì†¡|ì˜µì…˜|ì‚¬ì´ì¦ˆ/.test(v)) || '',
        brand:lines[0] || '', krSize:size, purchasePrice:priceMatches.at(-1) || 0,
        imageUrl:image?.currentSrc || image?.src || '', quantity:1, status:'êµ¬ë§¤ì™„ë£Œ' };
    });
  })()`, true).catch(() => []);
  if (!rows.length) return { ok: false, code: "ORDER_PRODUCTS_NOT_FOUND", message: "ì£¼ë¬¸ ìƒì„¸ í™”ë©´ì—ì„œ ìƒí’ˆì„ ì°¾ì§€ ëª»í–ˆìŠµë‹ˆë‹¤. ì£¼ë¬¸ ìƒì„¸ë¥¼ ì—° ë’¤ ë‹¤ì‹œ ê°€ì ¸ì˜¤ì„¸ìš”." };
  return { ok: true, rows: rows.map(normalizePurchaseLedgerRow) };
}

async function syncPurchaseLedger(input = {}) {
  const row = normalizePurchaseLedgerRow(input);
  const validation = validatePurchaseLedgerRow(row);
  if (!validation.ok) return { ok: false, code: "REQUIRED_FIELDS_MISSING", message: `${validation.missing.join(", ")}ì„(ë¥¼) í™•ì¸í•´ ì£¼ì„¸ìš”.` };
  const settings = store.snapshot().settings;
  const endpoint = String(settings.ledgerWebhookUrl || "").trim();
  const secret = decrypted(settings.ledgerSecretEncrypted);
  if (!/^https:\/\/script\.google\.com\//i.test(endpoint) || !secret) return { ok: false, code: "LEDGER_NOT_CONNECTED", message: "Google êµ¬ë§¤ìž¥ë¶€ ì—°ê²° ì£¼ì†Œì™€ ë³´ì•ˆí‚¤ë¥¼ ë¨¼ì € ì €ìž¥í•´ ì£¼ì„¸ìš”." };
  try {
    const response = await fetch(endpoint, { method: "POST", redirect: "follow", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify({ secret, row }), signal: AbortSignal.timeout(20_000) });
    const result = await response.json();
    if (!result.ok) throw new Error(result.code || result.message || `HTTP_${response.status}`);
    const saved = await store.upsert("ledger", { ...row, id: row.duplicateKey, sheetRow: result.rowNumber, syncStatus: result.duplicate ? "duplicate" : "synced", syncedAt: new Date().toISOString() });
    return { ok: true, duplicate: Boolean(result.duplicate), rowNumber: result.rowNumber, saved };
  } catch (error) {
    await store.upsert("ledger", { ...row, id: row.duplicateKey, syncStatus: "failed", syncError: error instanceof Error ? error.message : String(error) });
    void addProgramNotification({ type: "error", title: "êµ¬ë§¤ìž¥ë¶€ ê¸°ë¡ ì‹¤íŒ¨", message: `${row.modelName} Â· ë‹¤ì‹œ ê¸°ë¡í•´ ì£¼ì„¸ìš”.`, key: `ledger:failed:${row.duplicateKey}:${Date.now()}`, windows: true });
    return { ok: false, code: "LEDGER_SYNC_FAILED", message: error instanceof Error ? error.message : String(error) };
  }
}

const SELLER_EXPORT_POLL_INTERVAL_MS = 60 * 1000;
const SELLER_MULTI_EXPORT_POLL_INTERVAL_MS = 10 * 1000;
const SELLER_EXPORT_MONITOR_DELAY_WARNING_MS = 20 * 60 * 1000;
const RESTORED_PENDING_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PROCESSED_BRAND_EXPORT_SUFFIX = "_ì´íŒë§¤ëŸ‰50ì´ìƒ_OR_ì •ë¦¬.xlsx";

function defaultBrandExportFolder() {
  return oneDriveBrandExportFolder()
    || join(app.getPath("desktop"), "Around G POIZON", "POIZON ì „ì²´ë‚´ë³´ë‚´ê¸°");
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
  return root ? join(root, "Around G POIZON", "POIZON ë‹¤ìš´ë¡œë“œ ë°±ì—…") : "";
}

function oneDriveBrandExportFolder() {
  const root = oneDrivePoizonBackupRoot();
  return root ? join(root, "ë¸Œëžœë“œ ì›ë³¸") : "";
}

function oneDrivePopularExportFolder() {
  const root = oneDrivePoizonBackupRoot();
  return root ? join(root, "ì¸ê¸°ìƒí’ˆ ì›ë³¸") : "";
}

function oneDriveInstallFolder() {
  const root = oneDriveRootFolder();
  return root ? join(root, "Around G POIZON", "ì„¤ì¹˜ íŒŒì¼") : "";
}

function oneDriveSettingsFolder() {
  const root = oneDriveRootFolder();
  return root ? join(root, "Around G POIZON", "ì„¤ì • ë³µêµ¬") : "";
}

function portableBackupPath() {
  const folder = oneDriveSettingsFolder();
  return folder ? join(folder, "Around-G-POIZON-ë³µêµ¬.json") : "";
}

function publicPortableSnapshot() {
  const snapshot = store.snapshot();
  const settings = { ...(snapshot.settings || {}) };
  for (const key of [
    "appSecretEncrypted", "accessTokenEncrypted", "poizonLoginId", "poizonPasswordEncrypted",
    "nikeLoginId", "nikePasswordEncrypted", "adidasLoginId", "adidasPasswordEncrypted", "brandExportFolder",
    "ledgerWebhookUrl", "ledgerSecretEncrypted",
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
  await writeFile(join(folder, "ìƒˆ PC ì„¤ì¹˜ ì•ˆë‚´.txt"), [
    "Around G POIZON ìƒˆ PC ì„¤ì¹˜ ì•ˆë‚´", "", `1. ${fileName} íŒŒì¼ì„ ì‹¤í–‰í•©ë‹ˆë‹¤.`,
    "2. ê¸°ì¡´ PCì™€ ê°™ì€ OneDrive ê³„ì •ìœ¼ë¡œ ë¡œê·¸ì¸í•©ë‹ˆë‹¤.",
    "3. í”„ë¡œê·¸ëž¨ì„ ì²˜ìŒ ì‹¤í–‰í•˜ë©´ ì„¤ì •ê³¼ POIZON ìžë£Œë¥¼ ìžë™ ë³µêµ¬í•©ë‹ˆë‹¤.",
    "4. POIZON ë° ì™¸ë¶€ ì‚¬ì´íŠ¸ ë¡œê·¸ì¸ì€ ë³´ì•ˆì„ ìœ„í•´ ìƒˆ PCì—ì„œ ë‹¤ì‹œ ì§„í–‰í•©ë‹ˆë‹¤.",
  ].join("\r\n"), "utf8");
  return { destination, removed };
}

async function runOneDriveRecoveryBackup() {
  if (!oneDriveRootFolder()) {
    setOneDriveBackupStatus("disconnected", "OneDrive ë¡œê·¸ì¸ì´ í•„ìš”í•©ë‹ˆë‹¤. ë°±ì—…ì´ ì¤‘ì§€ë˜ì—ˆìŠµë‹ˆë‹¤.");
    return { ok: false, ...oneDriveBackupStatus };
  }
  try {
    setOneDriveBackupStatus("syncing", "OneDriveì— ìµœì‹  ì„¤ì¹˜ë³¸ê³¼ ì„¤ì •ì„ ë°±ì—…í•˜ê³  ìžˆìŠµë‹ˆë‹¤.");
    const settingsPath = await writePortableOneDriveBackup();
    const installer = app.isPackaged ? await backupCurrentInstallerToOneDrive() : { destination: "", removed: 0 };
    setOneDriveBackupStatus("connected", "ìµœì‹  ì„¤ì¹˜ë³¸ 1ê°œì™€ ì„¤ì •ì´ ì•ˆì „í•˜ê²Œ ë°±ì—…ë˜ì—ˆìŠµë‹ˆë‹¤.", {
      settingsPath, installerPath: installer.destination, removedInstallers: installer.removed,
    });
    return { ok: true, ...oneDriveBackupStatus };
  } catch (error) {
    setOneDriveBackupStatus("warning", `OneDrive ë°±ì—… í™•ì¸ í•„ìš”: ${error instanceof Error ? error.message : String(error)}`);
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
  const configuredBrandFolder = String(store.snapshot().settings.brandExportFolder || "").trim();
  const previousBrandFolder = configuredBrandFolder
    || join(app.getPath("desktop"), "Around G POIZON", "POIZON ì „ì²´ë‚´ë³´ë‚´ê¸°");
  const copiedBrands = await copyExcelTree(previousBrandFolder, brandFolder);
  const legacyPopularFolder = join(app.getPath("desktop"), "Around G POIZON");
  let copiedPopular = 0;
  try {
    const entries = await readdir(legacyPopularFolder, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/^POIZON-ì¸ê¸°ìƒí’ˆ-ì›ë³¸-.*\.xlsx$/i.test(entry.name)) continue;
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
    // A backup destination must never replace the user's existing source
    // folder. Updating the app previously made historical files appear gone
    // even though their bytes were still present in the old folder.
    brandExportFolder: configuredBrandFolder || brandFolder,
    oneDrivePoizonBackupRoot: backupRoot,
    oneDrivePoizonBackupEnabled: true,
  });
  return { enabled: true, copied: copiedBrands + copiedPopular, folder: backupRoot };
}

function brandExportRecoveryFolders() {
  const current = currentBrandExportFolder();
  const desktopLegacy = join(app.getPath("desktop"), "Around G POIZON", "POIZON ì „ì²´ë‚´ë³´ë‚´ê¸°");
  const candidates = [current, desktopLegacy, oneDriveBrandExportFolder()];
  for (const root of [process.env.OneDriveConsumer, process.env.OneDrive, process.env.OneDriveCommercial]) {
    const oneDriveRoot = String(root || "").trim();
    if (!oneDriveRoot) continue;
    candidates.push(
      join(oneDriveRoot, "ë°”íƒ• í™”ë©´", "Around G POIZON", "POIZON ì „ì²´ë‚´ë³´ë‚´ê¸°"),
      join(oneDriveRoot, "Desktop", "Around G POIZON", "POIZON ì „ì²´ë‚´ë³´ë‚´ê¸°"),
    );
  }
  // Retain every historical workbook location recorded with a completed
  // POIZON job. These paths survive folder-layout changes and let the app
  // recover files stored outside the standard Desktop/OneDrive roots.
  for (const job of savedBrandExportJobs()) {
    const historicalFile = String(job?.filePath || "").trim();
    if (historicalFile) candidates.push(dirname(historicalFile));
  }
  const seen = new Set();
  return candidates.filter((folder) => {
    const key = resolve(String(folder || "")).toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function brandFromExportFileName(name = "") {
  return String(name)
    .replace(/\.xlsx$/i, "")
    .replace(/_ì´íŒë§¤ëŸ‰50ì´ìƒ_OR_ì •ë¦¬$/i, "")
    .replace(/_íŒë§¤ëŸ‰30ì´ìƒ_ì •ë¦¬$/i, "")
    .replace(/_\d{8}_\d{6}$/, "")
    .trim();
}

function isProcessedBrandExportName(name = "") {
  return /_(?:ì´íŒë§¤ëŸ‰50ì´ìƒ_OR|íŒë§¤ëŸ‰30ì´ìƒ)_ì •ë¦¬\.xlsx$/i.test(String(name));
}

function isPartialBrandExportName(name = "") {
  return /_ë¶€ë¶„ë‹¤ìš´ë¡œë“œ_\d+_of_\d+_/i.test(String(name));
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
  const brandColumn = readPoizonColumnValues(fileBuffer, "ìƒí’ˆ ë¸Œëžœë“œ", "ë¸Œëžœë“œ");
  const observedBrands = brandColumn.values;
  const integrity = analyzeBrandValues(expectedBrands, observedBrands);
  const result = {
    ...integrity,
    status: integrity.ok ? "matched" : "mismatch",
    message: integrity.ok ? "ì„ íƒ ë¸Œëžœë“œì™€ Excel ë¸Œëžœë“œê°€ ì¼ì¹˜í•©ë‹ˆë‹¤." : brandMismatchMessage(integrity),
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
  emitStartupProgress(5, "POIZON ë‹¤ìš´ë¡œë“œ í´ë”ë¥¼ í™•ì¸í•˜ê³  ìžˆìŠµë‹ˆë‹¤.");
  await mkdir(folder, { recursive: true });
  const entries = [];
  const seenPaths = new Set();
  for (const recoveryFolder of brandExportRecoveryFolders()) {
    const recovered = await listBrandExportExcelEntries(recoveryFolder).catch(() => []);
    for (const entry of recovered) {
      const pathKey = resolve(entry.path).toLocaleLowerCase();
      if (seenPaths.has(pathKey)) continue;
      seenPaths.add(pathKey);
      entries.push({ ...entry, rootFolder: recoveryFolder });
    }
  }
  const sourceEntries = entries
    .filter((entry) => !isProcessedBrandExportName(entry.name) && !isPartialBrandExportName(entry.name));
  emitStartupProgress(12, `ê¸°ì¡´ POIZON Excel ${sourceEntries.length}ê°œë¥¼ í™•ì¸í•©ë‹ˆë‹¤.`, {
    current: 0,
    total: sourceEntries.length,
  });
  const preparedEntries = [];
  for (let index = 0; index < sourceEntries.length; index += 1) {
    const entry = sourceEntries[index];
    preparedEntries.push({ entry, info: await stat(entry.path) });
    emitStartupProgress(12 + Math.round(((index + 1) / Math.max(1, sourceEntries.length)) * 18),
      `ê¸°ì¡´ POIZON Excel ëª©ë¡ í™•ì¸ ${index + 1}/${sourceEntries.length}`, {
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
    const folderMeta = sameFolder(entry.directory, entry.rootFolder)
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
      message: `Excel ë¸Œëžœë“œ í™•ì¸ ì‹¤íŒ¨: ${error instanceof Error ? error.message : String(error)}`,
    }));
    emitStartupProgress(30 + Math.round(((index + 1) / Math.max(1, preparedEntries.length)) * 58),
      `POIZON ë³€ê²½ ì‚¬í•­ í™•ì¸ ${index + 1}/${preparedEntries.length}`, {
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
  emitStartupProgress(90, `ê¸°ì¡´ POIZON Excel ${visibleFiles.length}ê°œ í™•ì¸ì„ ì™„ë£Œí–ˆìŠµë‹ˆë‹¤.`, {
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
    spuId: column("SPU ID", "SPU_ID"), image: column("SPU ì´ë¯¸ì§€", "ìƒí’ˆ ì´ë¯¸ì§€", "ì´ë¯¸ì§€", "ì´ë¯¸ì§€ URL"),
    articleNumber: column("ìƒí’ˆ ë²ˆí˜¸", "ìƒí’ˆë²ˆí˜¸", "ìƒí’ˆì½”ë“œ", "í’ˆë²ˆ"), title: column("ìƒí’ˆëª…", "ì˜ë¬¸ ìƒí’ˆëª…"),
    brand: column("ìƒí’ˆ ë¸Œëžœë“œ", "ë¸Œëžœë“œ"), category1: column("ì¹´í…Œê³ ë¦¬ ëŒ€ë¶„ë¥˜", "ëŒ€ë¶„ë¥˜"),
    category2: column("ì¹´í…Œê³ ë¦¬ ì¤‘ë¶„ë¥˜", "ì¤‘ë¶„ë¥˜"), category3: column("ì¹´í…Œê³ ë¦¬ ì†Œë¶„ë¥˜", "ì†Œë¶„ë¥˜"),
    averagePrice: column("ìµœê·¼ 30ì¼ê°„ í‰ê·  ê±°ëž˜ê°€", "ìµœê·¼ 30ì¼ í‰ê·  ê±°ëž˜ê°€", "í‰ê·  ê±°ëž˜ê°€"),
    sales30d: column("ìµœê·¼ 30ì¼ íŒë§¤ëŸ‰", "ìµœê·¼30ì¼íŒë§¤ëŸ‰"),
    localSales30d: column("í˜„ì§€ íŒë§¤ìž ìµœê·¼ 30ì¼ íŒë§¤ëŸ‰", "í˜„ì§€íŒë§¤ìžìµœê·¼30ì¼íŒë§¤ëŸ‰"),
    totalSales: column("ì¤‘êµ­ ì´ íŒë§¤ëŸ‰", "ì´ íŒë§¤ëŸ‰"),
    localTotalSales: column("í˜„ì§€ íŒë§¤ìž ì´ íŒë§¤ëŸ‰", "í˜„ì§€íŒë§¤ìžì´íŒë§¤ëŸ‰"),
    option: column("ì‚¬ì´ì¦ˆ/ì˜µì…˜/ìƒ‰ìƒ", "ì˜µì…˜"), skuId: column("SKU ID", "SKU_ID"),
  };
  const cell = (row, index) => index >= 0 ? row[index] : "";
  const raw = (row, index) => String(cell(row, index) ?? "").trim();
  return entries.flatMap((entry) => {
    const row = entry.values || [];
    // Do not apply an invisible recent-sales threshold here. Filtering has
    // already been completed against the user's explicit Excel conditions;
    // dropping low recent-sales SKU rows at conversion time made qualified
    // results disappear from the list.
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
  if (!filePath) return { ok: false, message: "íŒŒì¼ ê²½ë¡œê°€ ì—†ìŠµë‹ˆë‹¤." };
  if (!/\.xlsx$/i.test(filePath)) return { ok: false, message: "Excel(.xlsx) íŒŒì¼ë§Œ ë³¼ ìˆ˜ ìžˆìŠµë‹ˆë‹¤." };
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
      message: `Excel ë¸Œëžœë“œ í™•ì¸ ì‹¤íŒ¨: ${error instanceof Error ? error.message : String(error)}`,
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
    title: `${brandName || "POIZON"} êµ­ë‚´ ìž¬ê³ Â·ì‚¬ì´ì¦ˆ í™•ì¸`,
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

function minimizeSellerAutomationWindow(message = "POIZON íŒë§¤ìžì„¼í„°ë¥¼ ë°±ê·¸ë¼ìš´ë“œì—ì„œ ì‹¤í–‰ ì¤‘ìž…ë‹ˆë‹¤.") {
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
    title: "POIZON íŒë§¤ìžì„¼í„° Â· Around G ì§ì ‘ ì—°ê²°",
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
        message: "ë‹¤ìš´ë¡œë“œ íŒŒì¼ê³¼ ë¸Œëžœë“œ ìž‘ì—…ë²ˆí˜¸ë¥¼ ì•ˆì „í•˜ê²Œ ì—°ê²°í•˜ì§€ ëª»í•´ ìžë™ ì €ìž¥ì„ ì¤‘ë‹¨í–ˆìŠµë‹ˆë‹¤.",
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
      jobState: "4ë‹¨ê³„/5 Â· Excel ë‹¤ìš´ë¡œë“œ ì¤‘",
      message: `${downloadJob.brandName || "ì„ íƒ ë¸Œëžœë“œ"} Â· 4ë‹¨ê³„/5 Â· Excel ë‹¤ìš´ë¡œë“œë¥¼ ì‹œìž‘í–ˆìŠµë‹ˆë‹¤.`,
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
        const summaryLabel = `ì „ì²´ í–‰ ${actualProductCount.toLocaleString("ko-KR")}ê°œ Â· ê³ ìœ  SPU ${workbookSummary.uniqueSpuCount.toLocaleString("ko-KR")}ê°œ Â· ì¤‘ë³µ ${workbookSummary.duplicateSpuCount.toLocaleString("ko-KR")}ê°œ Â· ë¹ˆ SPU ${workbookSummary.blankSpuCount.toLocaleString("ko-KR")}ê°œ`;
        if (expectedProductCount > 0 && actualProductCount < expectedProductCount) {
          const partialName = `${safeBrand}_ë¶€ë¶„ë‹¤ìš´ë¡œë“œ_${actualProductCount}_of_${expectedProductCount}_rows_${localFileTimestamp()}.xlsx`;
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
            jobState: `ë¶€ë¶„ ë‹¤ìš´ë¡œë“œ ${actualProductCount}/${expectedProductCount}í–‰ Â· ì‹¤íŒ¨`,
            message: `${downloadJob.brandName || "ì„ íƒ ë¸Œëžœë“œ"} ë¶€ë¶„ ë‹¤ìš´ë¡œë“œ ${actualProductCount.toLocaleString("ko-KR")}/${expectedProductCount.toLocaleString("ko-KR")}í–‰ Â· ${summaryLabel} Â· í™•ì¸ì™„ë£Œë¡œ ì²˜ë¦¬í•˜ì§€ ì•ŠìŠµë‹ˆë‹¤.`,
          });
          mainWindow?.webContents.send("brand-export:error", {
            brandName: downloadJob.brandName,
            jobId: downloadJobId,
            jobState: `ë¶€ë¶„ ë‹¤ìš´ë¡œë“œ ${actualProductCount}/${expectedProductCount}í–‰ Â· ì‹¤íŒ¨`,
            message: `${downloadJob.brandName || "ì„ íƒ ë¸Œëžœë“œ"} Excelì´ ${actualProductCount.toLocaleString("ko-KR")}/${expectedProductCount.toLocaleString("ko-KR")}í–‰ë§Œ í¬í•¨í•´ ë¶€ë¶„ íŒŒì¼ë¡œ ë³´ì¡´í–ˆìŠµë‹ˆë‹¤. ${summaryLabel}`,
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
          message: `Excel ë¸Œëžœë“œ í™•ì¸ ì‹¤íŒ¨: ${error instanceof Error ? error.message : String(error)}`,
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
          message: `ë¸Œëžœë“œ ë°ì´í„° ì €ìž¥ ì‹¤íŒ¨: ${state}`,
        });
      }
      })().catch((error) => {
        mainWindow?.webContents.send("brand-export:error", {
          brandName: downloadJob.brandName,
          jobId: downloadJobId,
          jobState: state === "completed" ? "ë‹¤ìš´ë¡œë“œ ì™„ë£Œ Â· Excel í™•ì¸ ì˜¤ë¥˜" : "ë‹¤ìš´ë¡œë“œ ì‹¤íŒ¨",
          message: state === "completed"
            ? `${downloadJob.brandName || "ì„ íƒ ë¸Œëžœë“œ"} íŒŒì¼ ë‹¤ìš´ë¡œë“œëŠ” ì™„ë£Œëìœ¼ë©° ë°˜ë³µ ê°ì‹œë¥¼ ì¢…ë£Œí•©ë‹ˆë‹¤. Excel í™•ì¸ ì˜¤ë¥˜: ${error instanceof Error ? error.message : String(error)}`
            : `ë¸Œëžœë“œ ë°ì´í„° ì €ìž¥ ì‹¤íŒ¨: ${error instanceof Error ? error.message : String(error)}`,
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
        /ìƒí’ˆê²€ìƒ‰\\s*ë‚´ë³´ë‚´ê¸°/.test(String(row.innerText || row.textContent || ""))
      );
      const row = exportRows[0];
      if (!row) return { state: "WAITING_FOR_ROW" };
      const text = String(row.innerText || row.textContent || "").replace(/\\s+/g, " ").trim();
      const download = [...row.querySelectorAll("a, button, [role='button']")]
        .find((element) => visible(element)
          && /^ë‹¤ìš´ë¡œë“œ$/.test(String(element.innerText || element.textContent || "").trim()));
      if (download && /ì„±ê³µ/.test(text)) {
        download.click();
        return { state: "DOWNLOAD_CLICKED" };
      }
      return { state: /ì²˜ë¦¬\\s*ì¤‘/.test(text) ? "PROCESSING" : "WAITING" };
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
      WAITING_FOR_LATEST_JOB: "4ë‹¨ê³„/5 Â· ìž‘ì—…ë²ˆí˜¸ í–‰ í™•ì¸ ì¤‘",
      PROCESSING: "4ë‹¨ê³„/5 Â· POIZON íŒŒì¼ ì²˜ë¦¬ ì¤‘ Â· 10ì´ˆë§ˆë‹¤ ìžë™ ê°ì‹œ",
      WAITING_FOR_SUCCESS: "4ë‹¨ê³„/5 Â· POIZON ì²˜ë¦¬ ì™„ë£Œ ëŒ€ê¸° ì¤‘",
      WAITING_FOR_DOWNLOAD: "4ë‹¨ê³„/5 Â· ë‹¤ìš´ë¡œë“œ ë²„íŠ¼ ëŒ€ê¸° ì¤‘",
      PAGE_NOT_READY: "4ë‹¨ê³„/5 Â· ë‹¤ìš´ë¡œë“œì„¼í„° í™•ì¸ ì¤‘",
    }[result?.state];
    if (stateLabel) {
      mainWindow?.webContents.send("brand-export:progress", {
        status: "monitoring",
        jobId: pendingBrandExportJobId,
        jobState: stateLabel,
        message: `${pendingBrandExportName || "ì„ íƒ ë¸Œëžœë“œ"} Â· ìž‘ì—…ë²ˆí˜¸ ${pendingBrandExportJobId} Â· ${stateLabel}`,
      });
    }

    if (result?.state === "DOWNLOAD_URL_READY") {
      sellerWindow.webContents.downloadURL(result.href);
    }
    if (result?.state === "DOWNLOAD_URL_READY" || result?.state === "DOWNLOAD_CLICKED") {
      mainWindow?.webContents.send("brand-export:progress", {
        status: "download-requested",
        jobId: pendingBrandExportJobId,
        jobState: "4ë‹¨ê³„/5 Â· ì²˜ë¦¬ ì„±ê³µ Â· ë‹¤ìš´ë¡œë“œ ì‹œìž‘",
        message: `${pendingBrandExportName || "ì„ íƒ ë¸Œëžœë“œ"} Â· 4ë‹¨ê³„/5 Â· POIZON ì²˜ë¦¬ ì„±ê³µ Â· ë‹¤ìš´ë¡œë“œë¥¼ ìš”ì²­í–ˆìŠµë‹ˆë‹¤.`,
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
    title: "POIZON ë‹¤ìš´ë¡œë“œ ê°ì‹œ Â· Around G",
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
          .filter((element) => /ë‹¤ìš´ë¡œë“œ|download/i.test([
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
          const workStateText = cellTexts.find((value) => /^(?:ì„±ê³µ|success|completed|ì‹¤íŒ¨|failed|error)$/i.test(value)) || "";
          const control = downloadControlIn(row);
          const rowJobId = String(cellTexts[0] || rowText).match(/\b\d{7,}\b/)?.[0] || "";
          const failed = /^(?:ì‹¤íŒ¨|failed|error)$/i.test(workStateText)
            || /(?:^|\s)(?:ì‹¤íŒ¨|failed|error)(?:\s|$)/i.test(rowText);
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
              && /^(?:ì„±ê³µ|success|completed)$/i.test(item.workStateText)
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
            return { jobId, state: "FAILED", workStateText: directParsed?.workStateText || "ì‹¤íŒ¨" };
          }
          if (!row) return { jobId, state: "WAITING_FOR_ROW" };
          usedRows.add(row);
          const rowText = textOf(row);
          const cells = [...row.querySelectorAll("td, [role='cell'], [role='gridcell']")];
          const cellTexts = cells.map(textOf);
          const dates = cellTexts.flatMap((value) => value.match(datePattern) || []);
          const workStateText = cellTexts.find((value) => /^(?:ì„±ê³µ|success|completed)$/i.test(value)) || cellTexts[3] || "";
          const startText = dates[0] || "";
          const completionText = dates.at(-1) || "";
          const recoveredJobId = recovered
            ? (String(cellTexts[0] || rowText).match(/\b\d{7,}\b/)?.[0] || "")
            : "";
          const jobNumberMatched = recovered || compactNumber(rowText).includes(compactNumber(jobId));
          const workSucceeded = /^(?:ì„±ê³µ|success|completed)$/i.test(workStateText);
          const completionConfirmed = /\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?/.test(completionText);
          if (!jobNumberMatched) return { jobId, state: "WAITING_FOR_ROW" };
          if (/ì²˜ë¦¬\\s*ì¤‘|processing|pending|ì§„í–‰\\s*ì¤‘/i.test(workStateText || rowText)) {
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
    jobState: "POIZON ìž‘ì—… ì‹¤íŒ¨ í™•ì¸ Â· ê°ì‹œ ì¢…ë£Œ",
    message: `${job?.brandName || "ì„ íƒ ë¸Œëžœë“œ"} Â· ìž‘ì—…ë²ˆí˜¸ ${jobId}ëŠ” POIZONì—ì„œ ì‹¤íŒ¨ë¡œ í™•ì¸ë˜ì–´ ë¬´í•œ ê°ì‹œë¥¼ ì¢…ë£Œí–ˆìŠµë‹ˆë‹¤.`,
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
        .filter((element) => /ë‹¤ìš´ë¡œë“œ|download/i.test([
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
      const workStateText = cellTexts.find((value) => /^(?:ì„±ê³µ|success|completed)$/i.test(value)) || cellTexts[3] || "";
      const completionText = dates.at(-1) || "";
      const jobNumberMatched = Boolean(rowLocator.recovered) || compactNumber(rowText).includes(compactNumber(jobId));
      const workSucceeded = /^(?:ì„±ê³µ|success|completed)$/i.test(workStateText);
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
    jobState: "ëª¨ë“  ìž‘ì—… í™•ì¸ì™„ë£Œ",
    message: "ì„ íƒí•œ ë¸Œëžœë“œì˜ POIZON ì›ë³¸ Excel ë‹¤ìš´ë¡œë“œì™€ í”„ë¡œê·¸ëž¨ ë“±ë¡ì´ ëª¨ë‘ ì™„ë£Œë˜ì—ˆìŠµë‹ˆë‹¤.",
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

async function rebuildStaleSellerExportMonitor(jobId = "", job = {}) {
  if (sellerMonitorWindow && !sellerMonitorWindow.isDestroyed()) {
    sellerMonitorWindow.removeAllListeners("closed");
    sellerMonitorWindow.destroy();
  }
  sellerMonitorWindow = null;
  ensureSellerMonitorWindow();

  // Once registration has finished, the original Seller Center window can be
  // refreshed as a second independent source. During another brand's export it
  // must remain untouched.
  if (!brandExportJobPending
    && sellerWindow && !sellerWindow.isDestroyed()
    && sellerWindow.webContents.getURL().includes("/main/exportCenter")) {
    await sellerWindow.webContents.reloadIgnoringCache().catch(() => {});
  }
  mainWindow?.webContents.send("brand-export:progress", {
    status: "monitoring",
    monitorSource: "dedicated-window-rebuilt",
    brandName: job?.brandName || "",
    jobId,
    jobState: "4ë‹¨ê³„/5 Â· ì™„ë£Œ ìƒíƒœ ìƒˆë¡œê³ ì¹¨",
    message: `${job?.brandName || "ì„ íƒ ë¸Œëžœë“œ"} Â· ìž‘ì—…ë²ˆí˜¸ ${jobId} Â· ì˜¤ëž˜ëœ ì²˜ë¦¬ ì¤‘ ìƒíƒœë¥¼ ë²„ë¦¬ê³  ë‹¤ìš´ë¡œë“œ ì„¼í„°ë¥¼ ë‹¤ì‹œ ì—°ê²°í•©ë‹ˆë‹¤.`,
  });
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
            jobState: "ìž¬ì‹œìž‘ ë³µêµ¬ Â· ìµœì‹  ì„±ê³µ ìž‘ì—…ë²ˆí˜¸ ìžë™ ì—°ê²°",
            message: `${job.brandName} Â· ì €ìž¥ëœ ìž‘ì—…ë²ˆí˜¸ ${previousJobId} ëŒ€ì‹  ìµœì‹  ì„±ê³µ ìž‘ì—…ë²ˆí˜¸ ${nextJobId}ë¥¼ ì—°ê²°í–ˆìŠµë‹ˆë‹¤.`,
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
        if (status.state === "PROCESSING") {
          job.processingPolls = Number(job.processingPolls || 0) + 1;
          if (job.processingPolls >= 6) {
            job.processingPolls = 0;
            await rebuildStaleSellerExportMonitor(status.jobId, job);
          }
        } else {
          job.processingPolls = 0;
        }
        const stateLabel = {
          WAITING_FOR_ROW: "4ë‹¨ê³„/5 Â· ìž‘ì—…ë²ˆí˜¸ í–‰ í™•ì¸ ì¤‘",
          PROCESSING: "4ë‹¨ê³„/5 Â· POIZON íŒŒì¼ ì²˜ë¦¬ ì¤‘ Â· 10ì´ˆë§ˆë‹¤ ê°ì‹œ",
          WAITING_FOR_SUCCESS: "4ë‹¨ê³„/5 Â· POIZON ì²˜ë¦¬ ì™„ë£Œ ëŒ€ê¸° ì¤‘",
          WAITING_FOR_COMPLETION: "4ë‹¨ê³„/5 Â· ìž‘ì—… ì™„ë£Œ ì‹œê° í™•ì¸ ì¤‘",
          WAITING_FOR_DOWNLOAD: "4ë‹¨ê³„/5 Â· ë‹¤ìš´ë¡œë“œ ë²„íŠ¼ ëŒ€ê¸°",
          PAGE_NOT_READY: "4ë‹¨ê³„/5 Â· ë‹¤ìš´ë¡œë“œì„¼í„° í”„ë ˆìž„ í™•ì¸ ì¤‘",
          READY: "4ë‹¨ê³„/5 Â· ì²˜ë¦¬ ì„±ê³µ Â· ë‹¤ìš´ë¡œë“œ ì‹œìž‘",
        }[status.state] || status.state;
        mainWindow?.webContents.send("brand-export:progress", {
          status: "monitoring",
          monitorSource: "dedicated-window",
          brandName: job.brandName,
          jobId: status.jobId,
          jobState: stateLabel,
          message: `${job.brandName} Â· ìž‘ì—…ë²ˆí˜¸ ${status.jobId} Â· ${stateLabel}`,
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
            brandName: curre|Û}-¢G§²ÚîÆ­yÑ½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‰Í•Ñ¥½¸ˆ¤ì(€€€€€Á…¹•°¹¥€ô€‰…É½Õ¹µœµ±½¥¸µÍÑ…ÑÕÌˆì(€€€€€Á…¹•°¹ÍÑå±”¹ÍÍQ•áÐ€ô€‰Á½Í¥Ñ¥½¸é™¥á•íèµ¥¹‘•àèÈÄÐÜÐàÌØÐÜíÉ¥¡ÐèÈÑÁàíÑ½ÀèÈÑÁàíÝ¥‘Ñ èÌÈÁÁàí‰½àµÍ¥é¥¹œé‰½É‘•Èµ‰½àíÁ…‘‘¥¹œèÄÕÁà€ÄÝÁàí‰½É‘•ÈµÉ…‘¥ÕÌèÄÉÁàí™½¹Ðµ™…µ¥±äéÉ¥…°°5…±Õ¸½Ñ¡¥Œœ±Í…¹ÌµÍ•É¥˜í‰½àµÍ¡…‘½ÜèÀ€ÄÁÁà€ÌÕÁàÉ‰„ À°À°À°¸Èà¤ìˆì(€€€€€‘½Õµ•¹Ð¹‘½Õµ•¹Ñ±•µ•¹Ð¹…ÁÁ•¹‘¡¥±¡Á…¹•°¤ì(€€€ô(€€€Á…¹•°¹ÍÑå±”¹‰½É‘•È€ô€ˆÉÁàÍ½±¥€ˆ€¬€‘í)M=8¹ÍÑÉ¥¹¥™ä¡…•¹Ð¥ôì(€€€Á…¹•°¹ÍÑå±”¹‰…­É½Õ¹€ô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡‰…­É½Õ¹¥ôì(€€€Á…¹•°¹ÍÑå±”¹½±½È€ô€ˆŒÄÜÈÀÌÌˆì(€€€Á…¹•°¹¥¹¹•É!Q50€ô€œñÍÑÉ½¹œÍÑå±”ô‰‘¥ÍÁ±…äé‰±½¬í½±½Èè‘íMÑÉ¥¹œ¡…•¹Ð¥ôí™½¹ÐµÍ¥é”èÄÕÁàíµ…É¥¸µ‰½ÑÑ½´èÙÁàˆøð½ÍÑÉ½¹œøñÍÁ…¸ÍÑå±”ô‰‘¥ÍÁ±…äé‰±½¬í™½¹ÐµÍ¥é”èÄÉÁàí±¥¹”µ¡•¥¡ÐèÄ¸Ôˆøð½ÍÁ…¸øœì(€€€Á…¹•°¹ÅÕ•ÉåM•±•Ñ½È ‰ÍÑÉ½¹œˆ¤¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Ñ¥Ñ±”¥ôì(€€€Á…¹•°¹ÅÕ•ÉåM•±•Ñ½È ‰ÍÁ…¸ˆ¤¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡‘•Ñ…¥°¥ôì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô¤ ¥€ì(€…Ý…¥Ð•á•ÕÑ•M•±±•ÉÉ…µ•]¥Ñ¡Q¥µ•½ÕÐ¡Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹µ…¥¹É…µ”°ÍÉ¥ÁÐ°€Í|ÀÀÀ°™…±Í”¤¹…Ñ   ¤€ôø™…±Í”¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÕ‰µ¥ÑMÑ½É•‘M•±±•ÉÉ•‘•¹Ñ¥…±Í]¥Ñ¡•ÍÍ¥‰¥±¥Ñä¡±½¥¹%°Á…ÍÍÝ½É¤ì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰M11I}]%9=]}1=Mˆôì(€½¹ÍÐ±¥•¹Ð€ôÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•Èì(€±•Ð…ÑÑ…¡•‘!•É”€ô™…±Í”ì(€ÑÉäì(€€€¥˜€ …±¥•¹Ð¹¥ÍÑÑ…¡• ¤¤ì(€€€€€±¥•¹Ð¹…ÑÑ…  ˆÄ¸Ìˆ¤ì(€€€€€…ÑÑ…¡•‘!•É”€ôÑÉÕ”ì(€€€ô(€€€…Ý…¥Ð±¥•¹Ð¹Í•¹‘½µµ…¹ ‰•ÍÍ¥‰¥±¥Ñä¹•¹…‰±”ˆ¤ì(€€€½¹ÍÐÁ…•QÉ•”€ô…Ý…¥Ð±¥•¹Ð¹Í•¹‘½µµ…¹ ‰A…”¹•ÑÉ…µ•QÉ•”ˆ¤ì(€€€½¹ÍÐ™É…µ•%‘Ì€ômtì(€€€½¹ÍÐ½±±•ÑÉ…µ•Ì€ô€¡•¹ÑÉä¤€ôøì(€€€€€¥˜€¡•¹ÑÉäü¹™É…µ”ü¹¥¤™É…µ•%‘Ì¹ÁÕÍ ¡•¹ÑÉä¹™É…µ”¹¥¤ì(€€€€€™½È€¡½¹ÍÐ¡¥±½˜•¹ÑÉäü¹¡¥±‘É…µ•Ìñðmt¤½±±•ÑÉ…µ•Ì¡¡¥±¤ì(€€€ôì(€€€½±±•ÑÉ…µ•Ì¡Á…•QÉ•”ü¹™É…µ•QÉ•”¤ì(€€€½¹ÍÐ…áQÉ••Ì€ô…Ý…¥ÐAÉ½µ¥Í”¹…±° ¡™É…µ•%‘Ì¹±•¹Ñ €ü™É…µ•%‘Ì€èmÕ¹‘•™¥¹•‘t¤¹µ…À ¡™É…µ•%¤€ôø(€€€€€±¥•¹Ð¹Í•¹‘½µµ…¹ ‰•ÍÍ¥‰¥±¥Ñä¹•ÑÕ±±aQÉ•”ˆ°™É…µ•%€üì™É…µ•%ô€èíô¤(€€€€€€€€¹…Ñ   ¤€ôø€¡ì¹½‘•Ìèmtô¤¤(€€€€¤¤ì(€€€½¹ÍÐ¹½‘•Ì€ô…áQÉ••Ì¹™±…Ñ5…À ¡ÑÉ•”¤€ôøÉÉ…ä¹¥ÍÉÉ…ä¡ÑÉ•”ü¹¹½‘•Ì¤€üÑÉ•”¹¹½‘•Ì€èmt¤(€€€€€€¹™¥±Ñ•È ¡¹½‘”¤€ôø€…¹½‘”¹¥¹½É•€˜˜¹½‘”¹‰…­•¹‘=59½‘•%¤ì(€€€½¹ÍÐÉ½±”€ô€¡¹½‘”¤€ôøMÑÉ¥¹œ¡¹½‘”ü¹É½±”ü¹Ù…±Õ”ñð€ˆˆ¤¹Ñ½1½Ý•É…Í” ¤ì(€€€½¹ÍÐ±…‰•°€ô€¡¹½‘”¤€ôøl(€€€€€¹½‘”ü¹¹…µ”ü¹Ù…±Õ”°(€€€€€¹½‘”ü¹‘•ÍÉ¥ÁÑ¥½¸ü¹Ù…±Õ”°(€€€€€€¸¸¸¡¹½‘”ü¹ÁÉ½Á•ÉÑ¥•Ìñðmt¤¹µ…À ¡ÁÉ½Á•ÉÑä¤€ôøÁÉ½Á•ÉÑäü¹Ù…±Õ”ü¹Ù…±Õ”¤°(€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ ˆ€ˆ¤ì(€€€½¹ÍÐÑ•áÑ‰½á•Ì€ô¹½‘•Ì¹™¥±Ñ•È ¡¹½‘”¤€ôø€½Ñ•áÑ‰½áñÑ•áÑ™¥•±‘ñ¥¹ÁÕÐ¼¹Ñ•ÍÐ¡É½±”¡¹½‘”¤¤¤ì(€€€½¹ÍÐÁ…ÍÍÝ½É‘9½‘”€ôÑ•áÑ‰½á•Ì¹™¥¹ ¡¹½‘”¤€ôø€¿®æ®Â®Ê#¶báñÁ…ÍÍÝ½É‘ó–¾ž‚ñÁ…ÍÍ½‘”½¤¹Ñ•ÍÐ¡±…‰•°¡¹½‘”¤¤¤ì(€€€½¹ÍÐ¥‘9½‘”€ôÑ•áÑ‰½á•Ì¹™¥¹ ¡¹½‘”¤€ôø(€€€€€¹½‘”€„ôôÁ…ÍÍÝ½É‘9½‘”€˜˜€¿¶rÓ®2¶>Áó²‚¶fQó²vÓ®¦S²vñó²V²vÓ®RQñÁ¡½¹•ñ•µ…¥±ñ…½Õ¹ÑñÕÍ•É¹…µ•óš&/šrë–>Ýó¦
»žºÅó¢Ò›–>Ü½¤¹Ñ•ÍÐ¡±…‰•°¡¹½‘”¤¤(€€€€¤ñðÑ•áÑ‰½á•Ì¹™¥¹ ¡¹½‘”¤€ôø¹½‘”€„ôôÁ…ÍÍÝ½É‘9½‘”¤ì(€€€½¹ÍÐ±½¥¹	ÕÑÑ½¸€ô¹½‘•Ì¹™¥¹ ¡¹½‘”¤€ôø(€€€€€€½‰ÕÑÑ½¹ñ±¥¹¬¼¹Ñ•ÍÐ¡É½±”¡¹½‘”¤¤€˜˜€¿®†sªÞã²váóžfï–öUóžfï–•ñÍ¥¹qÌ©¥¹ñ±½qÌ©¥¸½¤¹Ñ•ÍÐ¡±…‰•°¡¹½‘”¤¤(€€€€¤ì(€€€¥˜€ …¥‘9½‘”ñð€…Á…ÍÍÝ½É‘9½‘”¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰MM%	%1%Qe}1=%9}%9AUQM}9=Q}=U9ˆ°…á9½‘•Ìè¹½‘•Ì¹±•¹Ñ °Ñ•áÑ‰½á•ÌèÑ•áÑ‰½á•Ì¹±•¹Ñ ôì(€€€ô(€€€½¹ÍÐÉ•Á±…•½ÕÍ•‘Q•áÐ€ô…Íå¹Œ€¡¹½‘”°Ù…±Õ”¤€ôøì(€€€€€…Ý…¥Ð±¥•¹Ð¹Í•¹‘½µµ…¹ ‰=4¹™½ÕÌˆ°ì‰…­•¹‘9½‘•%è¹½‘”¹‰…­•¹‘=59½‘•%ô¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹Í•¹‘½µµ…¹ ‰%¹ÁÕÐ¹‘¥ÍÁ…Ñ¡-•åÙ•¹Ðˆ°ìÑåÁ”è€‰­•å½Ý¸ˆ°­•äè€‰„ˆ°½‘”è€‰-•åˆ°µ½‘¥™¥•ÉÌè€Èô¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹Í•¹‘½µµ…¹ ‰%¹ÁÕÐ¹‘¥ÍÁ…Ñ¡-•åÙ•¹Ðˆ°ìÑåÁ”è€‰­•åUÀˆ°­•äè€‰„ˆ°½‘”è€‰-•åˆ°µ½‘¥™¥•ÉÌè€Èô¤ì(€€€€€…Ý…¥Ð±¥•¹Ð¹Í•¹‘½µµ…¹ ‰%¹ÁÕÐ¹¥¹Í•ÉÑQ•áÐˆ°ìÑ•áÐèÙ…±Õ”ô¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÄÔÀ¤ì(€€€ôì(€€€…Ý…¥ÐÉ•Á±…•½ÕÍ•‘Q•áÐ¡¥‘9½‘”°±½¥¹%¤ì(€€€…Ý…¥ÐÉ•Á±…•½ÕÍ•‘Q•áÐ¡Á…ÍÍÝ½É‘9½‘”°Á…ÍÍÝ½É¤ì(€€€¥˜€ …±½¥¹	ÕÑÑ½¸¤É•ÑÕÉ¸ì½¬è™…±Í”°™¥±±•èÑÉÕ”°ÍÑ•Àè€‰MM%	%1%Qe}1=%9}	UQQ=9}9=Q}=U9ˆôì(€€€…Ý…¥Ð±¥•¹Ð¹Í•¹‘½µµ…¹ ‰=4¹™½ÕÌˆ°ì‰…­•¹‘9½‘•%è±½¥¹	ÕÑÑ½¸¹‰…­•¹‘=59½‘•%ô¤ì(€€€…Ý…¥Ð±¥•¹Ð¹Í•¹‘½µµ…¹ ‰%¹ÁÕÐ¹‘¥ÍÁ…Ñ¡-•åÙ•¹Ðˆ°ìÑåÁ”è€‰­•å½Ý¸ˆ°­•äè€‰¹Ñ•Èˆ°½‘”è€‰¹Ñ•Èˆô¤ì(€€€…Ý…¥Ð±¥•¹Ð¹Í•¹‘½µµ…¹ ‰%¹ÁÕÐ¹‘¥ÍÁ…Ñ¡-•åÙ•¹Ðˆ°ìÑåÁ”è€‰­•åUÀˆ°­•äè€‰¹Ñ•Èˆ°½‘”è€‰¹Ñ•Èˆô¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°™¥±±•èÑÉÕ”°ÍÑ•Àè€‰MM%	%1%Qe}I9Q%1M}MU	5%QQˆôì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰MM%	%1%Qe}1=%9}%1ˆ°É•…Í½¸èMÑÉ¥¹œ¡•ÉÉ½Èü¹µ•ÍÍ…”ñð•ÉÉ½Èñð€ˆˆ¤ôì(€ô™¥¹…±±äì(€€€¥˜€¡…ÑÑ…¡•‘!•É”€˜˜±¥•¹Ð¹¥ÍÑÑ…¡• ¤¤ì(€€€€€ÑÉäì±¥•¹Ð¹‘•Ñ…  ¤ìô…Ñ íô(€€€ô(€ô)ô(()…Íå¹Œ™Õ¹Ñ¥½¸ÍÕ‰µ¥ÑMÑ½É•‘M•±±•ÉÉ•‘•¹Ñ¥…±Í]¥Ñ¡I•…±5½ÕÍ”¡±½¥¹%°Á…ÍÍÝ½É¤ì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰M11I}]%9=]}1=Mˆôì(€±•ÐÁÉ•Ù¥½ÕÍ±¥Á‰½…É€ô€ˆˆì(€ÑÉäì(€€€½¹ÍÐÙ¥•ÝÁ½ÉÐ€ô…Ý…¥Ð•á•ÕÑ•M•±±•ÉÉ…µ•]¥Ñ¡Q¥µ•½ÕÐ (€€€€€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹µ…¥¹É…µ”°(€€€€€€ˆ¡ìÝ¥‘Ñ è5…Ñ ¹É½Õ¹¡¥¹¹•É]¥‘Ñ ¤°¡•¥¡Ðè5…Ñ ¹É½Õ¹¡¥¹¹•É!•¥¡Ð¤ô¤ˆ°(€€€€€€Í|ÀÀÀ°(€€€€€¹Õ±°(€€€€¤ì(€€€½¹ÍÐÝ¥‘Ñ €ô9Õµ‰•È¡Ù¥•ÝÁ½ÉÐü¹Ý¥‘Ñ ñð€À¤ì(€€€½¹ÍÐ¡•¥¡Ð€ô9Õµ‰•È¡Ù¥•ÝÁ½ÉÐü¹¡•¥¡Ðñð€À¤ì(€€€¥˜€¡Ý¥‘Ñ €ð€àÀÀñð¡•¥¡Ð€ð€ÔÀÀ¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰I1}5=UM}Y%]A=IQ}Q==}M510ˆ°Ý¥‘Ñ °¡•¥¡Ðôì(€€€ô(€€€¥˜€¡Í•±±•É]¥¹‘½Ü¹¥Í5¥¹¥µ¥é• ¤¤Í•±±•É]¥¹‘½Ü¹É•ÍÑ½É” ¤ì(€€€Í•±±•É]¥¹‘½Ü¹Í¡½Ü ¤ì(€€€Í•±±•É]¥¹‘½Ü¹™½ÕÌ ¤ì(€€€½¹ÍÐ½¹Ñ•¹ÑÌ€ôÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌì(€€€ÁÉ•Ù¥½ÕÍ±¥Á‰½…É€ô±¥Á‰½…É¹É•…‘Q•áÐ ¤ì(€€€½¹ÍÐ±¥¬€ô…Íå¹Œ€¡áI…Ñ¥¼°åI…Ñ¥¼¤€ôøì(€€€€€½¹ÍÐà€ô5…Ñ ¹É½Õ¹¡Ý¥‘Ñ €¨áI…Ñ¥¼¤ì(€€€€€½¹ÍÐä€ô5…Ñ ¹É½Õ¹¡¡•¥¡Ð€¨åI…Ñ¥¼¤ì(€€€€€½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰µ½ÕÍ•5½Ù”ˆ°à°äô¤ì(€€€€€½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰µ½ÕÍ•½Ý¸ˆ°à°ä°‰ÕÑÑ½¸è€‰±•™Ðˆ°±¥­½Õ¹Ðè€Äô¤ì(€€€€€½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰µ½ÕÍ•UÀˆ°à°ä°‰ÕÑÑ½¸è€‰±•™Ðˆ°±¥­½Õ¹Ðè€Äô¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÄàÀ¤ì(€€€ôì(€€€½¹ÍÐÁ…ÍÑ”€ô…Íå¹Œ€¡Ù…±Õ”¤€ôøì(€€€€€½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰­•å½Ý¸ˆ°­•å½‘”è€‰ˆ°µ½‘¥™¥•ÉÌèl‰½¹ÑÉ½°‰tô¤ì(€€€€€½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰­•åUÀˆ°­•å½‘”è€‰ˆ°µ½‘¥™¥•ÉÌèl‰½¹ÑÉ½°‰tô¤ì(€€€€€±¥Á‰½…É¹ÝÉ¥Ñ•Q•áÐ¡Ù…±Õ”¤ì(€€€€€½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰­•å½Ý¸ˆ°­•å½‘”è€‰Xˆ°µ½‘¥™¥•ÉÌèl‰½¹ÑÉ½°‰tô¤ì(€€€€€½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰­•åUÀˆ°­•å½‘”è€‰Xˆ°µ½‘¥™¥•ÉÌèl‰½¹ÑÉ½°‰tô¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€ôì(€€€€¼¼A=%i=8Í•±±•È±½¥¸…ÉÍÑ…åÌ…ÐÑ¡•Í”É•ÍÁ½¹Í¥Ù”Ù¥•ÝÁ½ÉÐÉ…Ñ¥½Ì¸(€€€…Ý…¥Ð±¥¬ À¸ÜÈ°€À¸ÌÀ¤ì(€€€…Ý…¥ÐÁ…ÍÑ”¡±½¥¹%¤ì(€€€…Ý…¥Ð±¥¬ À¸ÜÈ°€À¸ÌØÔ¤ì(€€€…Ý…¥ÐÁ…ÍÑ”¡Á…ÍÍÝ½É¤ì(€€€…Ý…¥Ð±¥¬ À¸ÜÈ°€À¸ÐÈà¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°™¥±±•èÑÉÕ”°ÍÑ•Àè€‰I1}5=UM}I9Q%1M}MU	5%QQˆôì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰I1}5=UM}1=%9}%1ˆ°É•…Í½¸èMÑÉ¥¹œ¡•ÉÉ½Èü¹µ•ÍÍ…”ñð•ÉÉ½Èñð€ˆˆ¤ôì(€ô™¥¹…±±äì(€€€ÑÉäì±¥Á‰½…É¹ÝÉ¥Ñ•Q•áÐ¡ÁÉ•Ù¥½ÕÍ±¥Á‰½…É¤ìô…Ñ íô(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÍÕ‰µ¥ÑMÑ½É•‘M•±±•ÉÉ•‘•¹Ñ¥…±Ì ¤ì(€½¹ÍÐÍ•ÑÑ¥¹Ì€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ìñðíôì(€½¹ÍÐ±½¥¹%€ôMÑÉ¥¹œ¡Í•ÑÑ¥¹Ì¹Á½¥é½¹1½¥¹%ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€±•ÐÁ…ÍÍÝ½É€ô€ˆˆì(€ÑÉäì(€€€Á…ÍÍÝ½É€ô‘•ÉåÁÑ•¡Í•ÑÑ¥¹Ì¹Á½¥é½¹A…ÍÍÝ½É‘¹ÉåÁÑ•¤ì(€ô…Ñ ì(€€€…Ý…¥ÐÍ•ÑM•±±•É1½¥¹MÑ…ÑÕÍ=Ù•É±…ä ‰•ÉÉ½Èˆ°€‹²‚²z”ƒ®æ®Â®Ê#¶bàƒ¶fW²vàƒ².“¶2 ˆ°€‹²^Ã®>dƒªÒ®š³²^C²pA=%i=8ƒ®æ®Â®Ê#¶bã®–ðƒ®.“².pƒ²‚²z—¶VÐƒ²Žó²ã²jP¸ˆ¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ½É•è™…±Í”°ÍÑ•Àè€‰AMM]=I}IeAQ}%1ˆôì(€ô(€¥˜€ …±½¥¹%ñð€…Á…ÍÍÝ½É¤ì(€€€…Ý…¥ÐÍ•ÑM•±±•É1½¥¹MÑ…ÑÕÍ=Ù•É±…ä ‰•ÉÉ½Èˆ°€‰A=%i=8ƒªÎ²‚Tƒ²‚²z”ƒ¶V²jPˆ°€‰É½Õ¹A=%i=;²v`ƒ²^Ã®>dƒªÒ®š³²^C²pƒ²V²vÓ®RS²f ƒ®æ®Â®Ê#¶bã®–ðƒ²VS¶bã¶fPƒ²‚²z—¶VÐƒ²Žó²ã²jP¸ˆ¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ½É•è™…±Í”°ÍÑ•Àè€‰MQ=I}I9Q%1M}5%MM%9ˆôì(€ô(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ½É•èÑÉÕ”°ÍÑ•Àè€‰M11I}]%9=]}1=Mˆôì(€…Ý…¥ÐÍ•ÑM•±±•É1½¥¹MÑ…ÑÕÍ=Ù•É±…ä ‰¡•­¥¹œˆ°€‹²‚²z”ƒªÎ²‚Tƒ¶fW²vàƒ²f®Ž0ˆ°€‹®†sªÞã²vàƒ²z®‚—²æã²vƒ²ÂûªÎ€ƒ²z#²*×®.#®.¸ˆ¤ì(€±•Ð±…ÍÑI•ÍÕ±Ð€ôì½¬è™…±Í”°ÍÑ•Àè€‰1=%9}%9AUQM}9=Q}=U9ˆôì(€™½È€¡½¹ÍÐ™É…µ”½˜Í•±±•É]¥¹‘½ÝÉ…µ•Ì ¤¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð•á•ÕÑ•M•±±•ÉÉ…µ•]¥Ñ¡Q¥µ•½ÕÐ¡™É…µ”°€¡…Íå¹Œ€ ¤€ôøì(€€€€€½¹ÍÐÉ½½ÑÌ€ôm‘½Õµ•¹Ñtì(€€€€€™½È€¡±•Ð¥¹‘•à€ô€Àì¥¹‘•à€ðÉ½½ÑÌ¹±•¹Ñ ì¥¹‘•à€¬ô€Ä¤ì(€€€€€€€™½È€¡½¹ÍÐ•±•µ•¹Ð½˜É½½ÑÍm¥¹‘•át¹ÅÕ•ÉåM•±•Ñ½É±° œ¨œ¤¤ì(€€€€€€€€€¥˜€¡•±•µ•¹Ð¹Í¡…‘½ÝI½½Ð€˜˜€…É½½ÑÌ¹¥¹±Õ‘•Ì¡•±•µ•¹Ð¹Í¡…‘½ÝI½½Ð¤¤É½½ÑÌ¹ÁÕÍ ¡•±•µ•¹Ð¹Í¡…‘½ÝI½½Ð¤ì(€€€€€€€ô(€€€€€ô(€€€€€½¹ÍÐÅÕ•Éå±°€ô€¡Í•±•Ñ½È¤€ôøÉ½½ÑÌ¹™±…Ñ5…À ¡É½½Ð¤€ôøl¸¸¹É½½Ð¹ÅÕ•ÉåM•±•Ñ½É±°¡Í•±•Ñ½È¥t¤ì(€€€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôøì(€€€€€€€¥˜€ …•±•µ•¹Ðñð•±•µ•¹Ð¹‘¥Í…‰±•¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€½¹ÍÐÍÑå±”€ô•Ñ½µÁÕÑ•‘MÑå±”¡•±•µ•¹Ð¤ì(€€€€€€€É•ÑÕÉ¸É•Ð¹Ý¥‘Ñ €ø€À€˜˜É•Ð¹¡•¥¡Ð€ø€À€˜˜ÍÑå±”¹Ù¥Í¥‰¥±¥Ñä€„ôô€¡¥‘‘•¸œ€˜˜ÍÑå±”¹‘¥ÍÁ±…ä€„ôô€¹½¹”œì(€€€€€ôì(€€€€€½¹ÍÐÁ…ÍÍÝ½É‘%¹ÁÕÐ€ôÅÕ•Éå±° ¥¹ÁÕÑmÑåÁ”ô‰Á…ÍÍÝ½É‰t°¥¹ÁÕÑm…ÕÑ½½µÁ±•Ñ”ô‰ÕÉÉ•¹ÐµÁ…ÍÍÝ½É‰tœ¤¹™¥¹¡Ù¥Í¥‰±”¤ì(€€€€€½¹ÍÐ¥‘%¹ÁÕÑÌ€ôÅÕ•Éå±° ¥¹ÁÕÐé¹½Ð¡mÑåÁ•t¤°¥¹ÁÕÑmÑåÁ”ô‰Ñ•áÐ‰t°¥¹ÁÕÑmÑåÁ”ô‰•µ…¥°‰t°¥¹ÁÕÑmÑåÁ”ô‰Ñ•°‰t°¥¹ÁÕÑm…ÕÑ½½µÁ±•Ñ”ô‰ÕÍ•É¹…µ”‰tœ¤¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€½¹ÍÐ¥‘%¹ÁÕÐ€ô¥‘%¹ÁÕÑÌ¹™¥¹ ¡•±•µ•¹Ð¤€ôø€½ÕÍ•Éñ…½Õ¹Ññ•µ…¥±ñÁ¡½¹•ñ±½¥¹ó²V²vÓ®RQó¶rÓ®2¶>Áó²vÓ®¦S²vñó²‚¶fS®Ê#¶báó¢Ò›–>Ýó–âC–>Ýóš&/šrë–>Ü½¤¹Ñ•ÍÐ¡l(€€€€€€€•±•µ•¹Ð¹¹…µ”°•±•µ•¹Ð¹¥°•±•µ•¹Ð¹Á±…•¡½±‘•È°•±•µ•¹Ð¹…ÕÑ½½µÁ±•Ñ”°(€€€€€t¹©½¥¸ œ€œ¤¤¤ñð¥‘%¹ÁÕÑÍlÁtì(€€€€€¥˜€ …¥‘%¹ÁÕÐñð€…Á…ÍÍÝ½É‘%¹ÁÕÐ¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€1=%9}%9AUQM}9=Q}=U9œ°¥¹ÁÕÑÌè¥‘%¹ÁÕÑÌ¹±•¹Ñ °Á…ÍÍÝ½É‘ÌèÁ…ÍÍÝ½É‘%¹ÁÕÐ€ü€Ä€è€Àôì(€€€€€½¹ÍÐÍ•ÑY…±Õ”€ô€¡•±•µ•¹Ð°Ù…±Õ”¤€ôøì(€€€€€€€•±•µ•¹Ð¹™½ÕÌ ¤ì(€€€€€€€½¹ÍÐÁÉ½Ñ½ÑåÁ”€ô=‰©•Ð¹•ÑAÉ½Ñ½ÑåÁ•=˜¡•±•µ•¹Ð¤ì(€€€€€€€½¹ÍÐÍ•ÑÑ•È€ô=‰©•Ð¹•Ñ=Ý¹AÉ½Á•ÉÑå•ÍÉ¥ÁÑ½È¡ÁÉ½Ñ½ÑåÁ”°€Ù…±Õ”œ¤ü¹Í•Ð(€€€€€€€€€ñð=‰©•Ð¹•Ñ=Ý¹AÉ½Á•ÉÑå•ÍÉ¥ÁÑ½È¡!Q51%¹ÁÕÑ±•µ•¹Ð¹ÁÉ½Ñ½ÑåÁ”°€Ù…±Õ”œ¤ü¹Í•Ðì(€€€€€€€Í•ÑÑ•È€üÍ•ÑÑ•È¹…±°¡•±•µ•¹Ð°Ù…±Õ”¤€è€¡•±•µ•¹Ð¹Ù…±Õ”€ôÙ…±Õ”¤ì(€€€€€€€•±•µ•¹Ð¹Í•ÑÑÑÉ¥‰ÕÑ” Ù…±Õ”œ°Ù…±Õ”¤ì(€€€€€€€•±•µ•¹Ð¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ¥¹ÁÕÐœ°ì‰Õ‰‰±•ÌèÑÉÕ”°½µÁ½Í•èÑÉÕ”ô¤¤ì(€€€€€€€•±•µ•¹Ð¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ¡…¹”œ°ì‰Õ‰‰±•ÌèÑÉÕ”°½µÁ½Í•èÑÉÕ”ô¤¤ì(€€€€€€€•±•µ•¹Ð¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü-•å‰½…É‘Ù•¹Ð ­•åÕÀœ°ì‰Õ‰‰±•ÌèÑÉÕ”°½µÁ½Í•èÑÉÕ”°­•äè€U¹¥‘•¹Ñ¥™¥•œô¤¤ì(€€€€€€€•±•µ•¹Ð¹‰±ÕÈ ¤ì(€€€€€ôì(€€€€€Í•ÑY…±Õ”¡¥‘%¹ÁÕÐ°€‘í)M=8¹ÍÑÉ¥¹¥™ä¡±½¥¹%¥ô¤ì(€€€€€Í•ÑY…±Õ”¡Á…ÍÍÝ½É‘%¹ÁÕÐ°€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Á…ÍÍÝ½É¥ô¤ì(€€€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€ÈÔÀ¤¤ì(€€€€€¥˜€ …MÑÉ¥¹œ¡¥‘%¹ÁÕÐ¹Ù…±Õ”ñð€œœ¤¹ÑÉ¥´ ¤ñð€…MÑÉ¥¹œ¡Á…ÍÍÝ½É‘%¹ÁÕÐ¹Ù…±Õ”ñð€œœ¤¤ì(€€€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€1=%9}Y1UM}I)Qœôì(€€€€€ô(€€€€€½¹ÍÐ‰ÕÑÑ½¹Ì€ôÅÕ•Éå±° ‰ÕÑÑ½¸°¥¹ÁÕÑmÑåÁ”ô‰ÍÕ‰µ¥Ð‰t°mÉ½±”ô‰‰ÕÑÑ½¸‰t°„œ¤¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€½¹ÍÐÍÕ‰µ¥Ð€ô‰ÕÑÑ½¹Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôø€¿®†sªÞã²váóžfï–öUóžfï–•ñÍ¥¹qqÌ©¥¹ñ±½qqÌ©¥¸½¤¹Ñ•ÍÐ¡MÑÉ¥¹œ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ðñð•±•µ•¹Ð¹Ù…±Õ”ñð•±•µ•¹Ð¹•ÑÑÑÉ¥‰ÕÑ” …É¥„µ±…‰•°œ¤ñð€œœ¤¤¤(€€€€€€€ñð‰ÕÑÑ½¹Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð¹ÑåÁ”€ôôô€ÍÕ‰µ¥Ðœ¤(€€€€€€€ñð¥‘%¹ÁÕÐ¹±½Í•ÍÐ ™½É´œ¤ü¹ÅÕ•ÉåM•±•Ñ½È ‰ÕÑÑ½¸°¥¹ÁÕÑmÑåÁ”ô‰ÍÕ‰µ¥Ð‰tœ¤ì(€€€€€¥˜€ …ÍÕ‰µ¥Ð¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€1=%9}	UQQ=9}9=Q}=U9œ°™¥±±•èÑÉÕ”ôì(€€€€€¥˜€¡ÍÕ‰µ¥Ð¹‘¥Í…‰±•¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€1=%9}	UQQ=9}%M	1œ°™¥±±•èÑÉÕ”ôì(€€€€€ÍÕ‰µ¥Ð¹™½ÕÌ ¤ì(€€€€€ÍÕ‰µ¥Ð¹±¥¬ ¤ì(€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°ÍÑ•Àè€MQ=I}I9Q%1M}MU	5%QQœ°™¥±±•èÑÉÕ”ôì(€€€ô¤ ¥€°€Ý|ÀÀÀ°ì½¬è™…±Í”°ÍÑ•Àè€‰1=%9}I5}Q%5=UPˆô¤ì(€€€±…ÍÑI•ÍÕ±Ð€ôÉ•ÍÕ±Ðñð±…ÍÑI•ÍÕ±Ðì(€€€¥˜€¡É•ÍÕ±Ðü¹™¥±±•¤ì(€€€€€…Ý…¥ÐÍ•ÑM•±±•É1½¥¹MÑ…ÑÕÍ=Ù•É±…ä (€€€€€€€É•ÍÕ±Ð¹½¬€ü€‰™¥±±¥¹œˆ€è€‰•ÉÉ½Èˆ°(€€€€€€€É•ÍÕ±Ð¹½¬€ü€‰%
ß®æ®Â®Ê#¶bàƒ²zC®>dƒ²z®‚”ƒ²f®Ž0ˆ€è€‹®†sªÞã²vàƒ®Ê¶*ðƒ¶fW²vàƒ¶V²jPˆ°(€€€€€€€É•ÍÕ±Ð¹½¬€ü€‹®†sªÞã²vàƒ®Ê¶*ó²vƒ®"3®‚²*×®.#®.¸ƒ¶2C®ž“²zC²ó¶Àƒ²ž²z²vƒ¶fW²vã¶VcªÎ€ƒ²z#²*×®.#®.¸ˆ€èƒ²z®‚—²v ƒ²f®Ž3¶Z#²ž®ž0ƒ®Ê¶*ðƒ².“¶Z'²^@ƒ².“¶2£¶Z#²*×®.#®.¸€ ‘íÉ•ÍÕ±Ð¹ÍÑ•Àñð€‰U9-9=]8‰ô¥€(€€€€€€¤ì(€€€ô(€€€¥˜€¡É•ÍÕ±Ðü¹½¬¤É•ÑÕÉ¸ì€¸¸¹É•ÍÕ±Ð°ÍÑ½É•èÑÉÕ”ôì(€ô(€½¹ÍÐ…•ÍÍ¥‰¥±¥ÑåI•ÍÕ±Ð€ô…Ý…¥ÐÍÕ‰µ¥ÑMÑ½É•‘M•±±•ÉÉ•‘•¹Ñ¥…±Í]¥Ñ¡•ÍÍ¥‰¥±¥Ñä¡±½¥¹%°Á…ÍÍÝ½É¤ì(€¥˜€¡…•ÍÍ¥‰¥±¥ÑåI•ÍÕ±Ðü¹™¥±±•¤ì(€€€…Ý…¥ÐÍ•ÑM•±±•É1½¥¹MÑ…ÑÕÍ=Ù•É±…ä (€€€€€…•ÍÍ¥‰¥±¥ÑåI•ÍÕ±Ð¹½¬€ü€‰™¥±±¥¹œˆ€è€‰•ÉÉ½Èˆ°(€€€€€…•ÍÍ¥‰¥±¥ÑåI•ÍÕ±Ð¹½¬€ü€‰%
ß®æ®Â®Ê#¶bàƒ².“²‚pƒ²z®‚”ƒ²f®Ž0ˆ€è€‹®†sªÞã²vàƒ®Ê¶*ðƒ¶fW²vàƒ¶V²jPˆ°(€€€€€…•ÍÍ¥‰¥±¥ÑåI•ÍÕ±Ð¹½¬(€€€€€€€€ü€‰A=%i=8ƒ¶fS®¦Ðƒ²jS²3®–ðƒ²ž²‚Dƒ²Âû²Vƒ²z®‚—¶Z#²*×®.#®.¸ƒ¶2C®ž“²zC²ó¶Àƒ²ž²z²vƒ¶fW²vã¶VcªÎ€ƒ²z#²*×®.#®.¸ˆ(€€€€€€€€èƒ²z®‚—²v ƒ²f®Ž3¶Z#²ž®ž0ƒ®Ê¶*ðƒ².“¶Z'²^@ƒ².“¶2£¶Z#²*×®.#®.¸€ ‘í…•ÍÍ¥‰¥±¥ÑåI•ÍÕ±Ð¹ÍÑ•Àñð€‰U9-9=]8‰ô¥€(€€€€¤ì(€ô(€¥˜€¡…•ÍÍ¥‰¥±¥ÑåI•ÍÕ±Ðü¹½¬¤É•ÑÕÉ¸ì€¸¸¹…•ÍÍ¥‰¥±¥ÑåI•ÍÕ±Ð°ÍÑ½É•èÑÉÕ”ôì(€½¹ÍÐÉ•…±5½ÕÍ•I•ÍÕ±Ð€ô…Ý…¥ÐÍÕ‰µ¥ÑMÑ½É•‘M•±±•ÉÉ•‘•¹Ñ¥…±Í]¥Ñ¡I•…±5½ÕÍ”¡±½¥¹%°Á…ÍÍÝ½É¤ì(€¥˜€¡É•…±5½ÕÍ•I•ÍÕ±Ðü¹½¬¤ì(€€€…Ý…¥ÐÍ•ÑM•±±•É1½¥¹MÑ…ÑÕÍ=Ù•É±…ä (€€€€€€‰™¥±±¥¹œˆ°(€€€€€€‰%
ß®æ®Â®Ê#¶bàƒ².“²‚pƒ®ž#²jÃ²*ƒ²z®‚”ƒ²f®Ž0ˆ°(€€€€€€‹®†sªÞã²vàƒ®Ê¶*ó²vƒ²ž²‚Dƒ®"3®‚²*×®.#®.¸ƒ¶2C®ž“²zC²ó¶Àƒ²ž²z²vƒ¶fW²vã¶VcªÎ€ƒ²z#²*×®.#®.¸ˆ(€€€€¤ì(€€€É•ÑÕÉ¸ì€¸¸¹É•…±5½ÕÍ•I•ÍÕ±Ð°ÍÑ½É•èÑÉÕ”ôì(€ô(€…Ý…¥ÐÍ•ÑM•±±•É1½¥¹MÑ…ÑÕÍ=Ù•É±…ä (€€€€‰•ÉÉ½Èˆ°(€€€€‹®†sªÞã²vàƒ².“²‚pƒ²z®‚”ƒ².“¶2 ˆ°(€€€ƒ²‚²z”ƒªÎ²‚W²v`ƒ².“²‚pƒ®ž#²jÃ²*ƒ²z®‚—²vƒ®.“².pƒ².s®>¶V§®.#®.¸€ ‘íÉ•…±5½ÕÍ•I•ÍÕ±Ðü¹ÍÑ•Àñð…•ÍÍ¥‰¥±¥ÑåI•ÍÕ±Ðü¹ÍÑ•Àñð±…ÍÑI•ÍÕ±Ð¹ÍÑ•Àñð€‰U9-9=]8‰ô¥€(€€¤ì(€É•ÑÕÉ¸ì€¸¸¸¡É•…±5½ÕÍ•I•ÍÕ±Ðñð…•ÍÍ¥‰¥±¥ÑåI•ÍÕ±Ðñð±…ÍÑI•ÍÕ±Ð¤°½¬è™…±Í”°ÍÑ½É•èÑÉÕ”ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Í•±±•ÉAÉ½‘ÕÑM•…É¡A…•MÑ…Ñ” ¤ì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€É•ÑÕÉ¸ìÉ•…‘äè™…±Í”°™…¥±•è™…±Í”°™É…µ”è¹Õ±°°ÕÉ°è€ˆˆôì(€ô(€™½È€¡½¹ÍÐ™É…µ”½˜Í•±±•É]¥¹‘½ÝÉ…µ•Ì ¤¤ì(€€€½¹ÍÐÍÑ…Ñ”€ô…Ý…¥Ð•á•ÕÑ•M•±±•ÉÉ…µ•]¥Ñ¡Q¥µ•½ÕÐ¡™É…µ”°€  ¤€ôøì(€€€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€€€½¹ÍÐÑ•áÑ=˜€ô€¡•±•µ•¹Ð¤€ôøMÑÉ¥¹œ¡•±•µ•¹Ðü¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ðü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤(€€€€€€€€¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€€€€€½¹ÍÐ‰½‘ä€ôMÑÉ¥¹œ¡‘½Õµ•¹Ð¹‰½‘äü¹¥¹¹•ÉQ•áÐñð€ˆˆ¤ì(€€€€€½¹ÍÐ™…¥±•€ô€½A…•qqÌ©9½ÑqqÌ©½Õ¹‘ñ½µÁ½¹•¹ÑqqÌ©-•åqqÌ©ÉÉ½Éñ1½…‘qqÌ©½µÁ½¹•¹ÑqqÌ©Q¥µ•½ÕÑó¢¾ßšÆ¢Úš^Ø½¤¹Ñ•ÍÐ¡‰½‘ä¤ì(€€€€€½¹ÍÐ¥¹ÁÕÐ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÐ±Ñ•áÑ…É•„ˆ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤¹™¥¹ ¡•±•µ•¹Ð¤€ôø€…•±•µ•¹Ð¹‘¥Í…‰±•€˜˜€…•±•µ•¹Ð¹É•…‘=¹±ä¤ì(€€€€€½¹ÍÐÍ•…É €ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸tˆ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤¹™¥¹ ¡•±•µ•¹Ð¤€ôø€¿ªÊ²%qqÌ«®Â=qqÌ«²z²ÂÁó–V–N¹ìÀ°áô üëšBsžÒ‰óš~—¢¾ˆ¤½¤¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ì(€€€€€É•ÑÕÉ¸ìÉ•…‘äè€…™…¥±•€˜˜	½½±•…¸¡¥¹ÁÕÐ€˜˜Í•…É ¤°™…¥±•°ÕÉ°è±½…Ñ¥½¸¹¡É•˜ôì(€€€ô¤ ¥€°€Í|ÀÀÀ°ìÉ•…‘äè™…±Í”°™…¥±•è™…±Í”°ÕÉ°è€ˆˆô¤ì(€€€¥˜€¡ÍÑ…Ñ”ü¹É•…‘ä¤É•ÑÕÉ¸ì€¸¸¹ÍÑ…Ñ”°™É…µ”ôì(€€€¥˜€¡ÍÑ…Ñ”ü¹™…¥±•¤É•ÑÕÉ¸ì€¸¸¹ÍÑ…Ñ”°™É…µ”è¹Õ±°ôì(€ô(€É•ÑÕÉ¸ì(€€€É•…‘äè™…±Í”°(€€€™…¥±•è™…±Í”°(€€€™É…µ”è¹Õ±°°(€€€ÕÉ°èMÑÉ¥¹œ¡Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•ÑUI0 ¤ñð€ˆˆ¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•¹Ñ•ÉM•±±•ÉAÉ½‘ÕÑM•…É¡Y¥…5•¹Ô¡ì™½É•!½µ”€ô™…±Í”ô€ôíô¤ì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤É•ÑÕÉ¸™…±Í”ì(€½¹ÍÐÉ•½Ù•ÉM•±±•É!½µ”€ô…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐ¡½µ•±¥¬€ô…Ý…¥ÐÁ¡åÍ¥…±±¥­M•±±•É±•µ•¹Ð¡Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹µ…¥¹É…µ”°€(€€€€€É•ÑÕÉ¸l¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰„±‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸t±ÍÁ…¸ˆ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôø€½x üë¶f#¶:c²vÓ²ž®†qqqÌ«®>3²VªÂªâÁó¢þS–n{¦š[¦†Õó–n{–"Ã¦š[¦†Ô¤¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤(€€€€€€€€ü¹±½Í•ÍÐ ‰„±‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸tˆ¤ñð¹Õ±°ì(€€€€°€‰A!eM%1}M11I}!=5}I=YIdˆ°€Õ|ÀÀÀ¤ì(€€€¥˜€ …¡½µ•±¥¬¹½¬¤É•ÑÕÉ¸™…±Í”ì(€€€…Ý…¥ÐÝ…¥Ð É|ÔÀÀ¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ôì(€±•ÐÍÑ…Ñ”€ô…Ý…¥ÐÍ•±±•ÉAÉ½‘ÕÑM•…É¡A…•MÑ…Ñ” ¤ì(€¥˜€ …™½É•!½µ”€˜˜ÍÑ…Ñ”¹É•…‘ä¤É•ÑÕÉ¸ÑÉÕ”ì(€±•ÐÉ•½Ù•É•‘É½µ…¥±•‘A…”€ô™…±Í”ì(€¥˜€¡ÍÑ…Ñ”¹™…¥±•¤ì(€€€É•½Ù•É•‘É½µ…¥±•‘A…”€ô…Ý…¥ÐÉ•½Ù•ÉM•±±•É!½µ” ¤ì(€ô(€½¹ÍÐÕÉÉ•¹ÑUÉ°€ôMÑÉ¥¹œ¡Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•ÑUI0 ¤ñð€ˆˆ¤ì(€½¹ÍÐ…ÕÑ¡•¹Ñ¥…Ñ¥½¸€ô…Ý…¥ÐÍ•±±•ÉÕÑ¡•¹Ñ¥…Ñ¥½¹MÑ…Ñ” ¤ì(€€¼¼-••ÀÑ¡”Á…”Ñ¡…ÐA=%i=8½Á•¹•…™Ñ•È„ÍÕ•ÍÍ™Õ°±½¥¸¸I•±½…‘¥¹œÑ¡”(€€¼¼M•±±•È•¹Ñ•ÈÉ½½Ð¡•É”‘¥Í…É‘ÌÑ¡…Ð™É•Í¡±ä•ÍÑ…‰±¥Í¡•¹…Ù¥…Ñ¥½¸…¹(€€¼¼Í•¹‘ÌÑ¡”Ý¥¹‘½Ü‰…¬Ñ¼Ñ¡”±½¥¸…É¸Q¡”É•ÍÑ½É•Ý½É­™±½Ü•áÁ…¹‘Ì(€€¼¼ƒ²¶J …¹±¥­Ìƒ²¶J ƒªÊ²$¥¸Ñ¡”…ÕÑ¡•¹Ñ¥…Ñ•Á…”¥¹ÍÑ•…¸(€¥˜€ ……ÕÑ¡•¹Ñ¥…Ñ¥½¸¹…ÕÑ¡•¹Ñ¥…Ñ•(€€€€€€˜˜€ ¡™½É•!½µ”€˜˜€…É•½Ù•É•‘É½µ…¥±•‘A…”¤(€€€€€€€ñð€¡ÍÑ…Ñ”¹™…¥±•€˜˜€…É•½Ù•É•‘É½µ…¥±•‘A…”¤(€€€€€€€ñð€…ÕÉÉ•¹ÑUÉ°¹¥¹±Õ‘•Ì ‰Í•±±•È¹Á½¥é½¸¹½´ˆ¤¤¤ì(€€€…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹±½…‘UI0¡M11I}9QI}UI0¤¹…Ñ   ¤€ôøíô¤ì(€€€…Ý…¥ÐÝ…¥Ð É|ÔÀÀ¤ì(€ô(€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€Ìì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€ÍÑ…Ñ”€ô…Ý…¥ÐÍ•±±•ÉAÉ½‘ÕÑM•…É¡A…•MÑ…Ñ” ¤ì(€€€¥˜€¡ÍÑ…Ñ”¹É•…‘ä¤É•ÑÕÉ¸ÑÉÕ”ì(€€€¥˜€¡ÍÑ…Ñ”¹™…¥±•¤ì(€€€€€½¹ÍÐÉ•½Ù•É•€ô…Ý…¥ÐÉ•½Ù•ÉM•±±•É!½µ” ¤ì(€€€€€¥˜€ …É•½Ù•É•¤É•ÑÕÉ¸™…±Í”ì(€€€€€ÍÑ…Ñ”€ô…Ý…¥ÐÍ•±±•ÉAÉ½‘ÕÑM•…É¡A…•MÑ…Ñ” ¤ì(€€€€€¥˜€¡ÍÑ…Ñ”¹É•…‘ä¤É•ÑÕÉ¸ÑÉÕ”ì(€€€ô(€€€½¹ÍÐµ•¹ÕÉ…µ”€ôÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹µ…¥¹É…µ”ì(€€€½¹ÍÐÍ•…É¡5•¹ÕY¥Í¥‰±”€ô…Ý…¥Ð•á•ÕÑ•M•±±•ÉÉ…µ•]¥Ñ¡Q¥µ•½ÕÐ¡µ•¹ÕÉ…µ”°€  ¤€ôøì(€€€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€€€½¹ÍÐÑ•áÑ=˜€ô€¡•±•µ•¹Ð¤€ôøMÑÉ¥¹œ¡•±•µ•¹Ðü¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ðü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤(€€€€€€€€¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€€€€€É•ÑÕÉ¸l¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰„±‰ÕÑÑ½¸±mÉ½±”ôµ•¹Õ¥Ñ•´t±mÉ½±”ô‰ÕÑÑ½¸t±±¤±‘¥Ø±ÍÁ…¸ˆ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤¹Í½µ” ¡•±•µ•¹Ð¤€ôø€½x üë²¶J!qqÌ«ªÊ²%ó–V–NšBsžÒˆ¤¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ì(€€€ô¤ ¥€°€É|ÀÀÀ°™…±Í”¤ì(€€€¥˜€ …Í•…É¡5•¹ÕY¥Í¥‰±”¤ì(€€€€€½¹ÍÐÁÉ½‘ÕÑ5•¹Ô€ô…Ý…¥ÐÁ¡åÍ¥…±±¥­M•±±•É±•µ•¹Ð¡µ•¹ÕÉ…µ”°€(€€€€€€€É•ÑÕÉ¸l¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰„±‰ÕÑÑ½¸±mÉ½±”ôµ•¹Õ¥Ñ•´t±mÉ½±”ô‰ÕÑÑ½¸t±±¤±‘¥Ø±ÍÁ…¸ˆ¥t(€€€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø€½x üë²¶J  üéqqÌ«®Â=qqÌ«²z²ÂÁqqÌ«®Ú²t¤ýó–V–N üë–>+ž®{’îß–"šz@¤ü¤¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤(€€€€€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøì(€€€€€€€€€€€½¹ÍÐ„€ô±•™Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€€€½¹ÍÐˆ€ôÉ¥¡Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€€€É•ÑÕÉ¸„¹Ý¥‘Ñ €¨„¹¡•¥¡Ð€´ˆ¹Ý¥‘Ñ €¨ˆ¹¡•¥¡Ðì(€€€€€€€€€ô¥lÁtü¹±½Í•ÍÐ ‰„±‰ÕÑÑ½¸±mÉ½±”ôµ•¹Õ¥Ñ•´t±mÉ½±”ô‰ÕÑÑ½¸t±±¤ˆ¤ñð¹Õ±°ì(€€€€€€°€‰A!eM%1}AI=UQ}59Tˆ°€Õ|ÀÀÀ¤ì(€€€€€¥˜€¡ÁÉ½‘ÕÑ5•¹Ô¹½¬¤…Ý…¥ÐÝ…¥Ð àÀÀ¤ì(€€€ô(€€€½¹ÍÐÍ•…É¡5•¹Ô€ô…Ý…¥ÐÁ¡åÍ¥…±±¥­M•±±•É±•µ•¹Ð¡µ•¹ÕÉ…µ”°€(€€€€€É•ÑÕÉ¸l¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰„±‰ÕÑÑ½¸±mÉ½±”ôµ•¹Õ¥Ñ•´t±mÉ½±”ô‰ÕÑÑ½¸t±±¤±‘¥Ø±ÍÁ…¸ˆ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø€½x üë²¶J!qqÌ«ªÊ²%ó–V–NšBsžÒˆ¤¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤(€€€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøì(€€€€€€€€€½¹ÍÐ„€ô±•™Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€½¹ÍÐˆ€ôÉ¥¡Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€É•ÑÕÉ¸„¹Ý¥‘Ñ €¨„¹¡•¥¡Ð€´ˆ¹Ý¥‘Ñ €¨ˆ¹¡•¥¡Ðì(€€€€€€€ô¥lÁtü¹±½Í•ÍÐ ‰„±‰ÕÑÑ½¸±mÉ½±”ôµ•¹Õ¥Ñ•´t±mÉ½±”ô‰ÕÑÑ½¸t±±¤ˆ¤ñð¹Õ±°ì(€€€€°€‰A!eM%1}AI=UQ}MI!}59Tˆ°€Ù|ÀÀÀ¤ì(€€€¥˜€¡Í•…É¡5•¹Ô¹½¬¤ì(€€€€€½¹ÍÐ‘•…‘±¥¹”€ô…Ñ”¹¹½Ü ¤€¬€ÄÉ|ÀÀÀì(€€€€€Ý¡¥±”€¡…Ñ”¹¹½Ü ¤€ð‘•…‘±¥¹”¤ì(€€€€€€€ÍÑ…Ñ”€ô…Ý…¥ÐÍ•±±•ÉAÉ½‘ÕÑM•…É¡A…•MÑ…Ñ” ¤ì(€€€€€€€¥˜€¡ÍÑ…Ñ”¹É•…‘ä¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€€€¥˜€¡ÍÑ…Ñ”¹™…¥±•¤‰É•…¬ì(€€€€€€€…Ý…¥ÐÝ…¥Ð ÔÀÀ¤ì(€€€€€ô(€€€ô(€€€¥˜€¡…ÑÑ•µÁÐ€ð€È¤ì(€€€€€ÍÑ…Ñ”€ô…Ý…¥ÐÍ•±±•ÉAÉ½‘ÕÑM•…É¡A…•MÑ…Ñ” ¤ì(€€€€€¥˜€¡ÍÑ…Ñ”¹™…¥±•¤ì(€€€€€€€¥˜€ ……Ý…¥ÐÉ•½Ù•ÉM•±±•É!½µ” ¤¤É•ÑÕÉ¸™…±Í”ì(€€€€€ô•±Í”¥˜€ „¡…Ý…¥ÐÍ•±±•ÉÕÑ¡•¹Ñ¥…Ñ¥½¹MÑ…Ñ” ¤¤¹…ÕÑ¡•¹Ñ¥…Ñ•¤ì(€€€€€€€…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹±½…‘UI0¡M11I}9QI}UI0¤¹…Ñ   ¤€ôøíô¤ì(€€€€€€€…Ý…¥ÐÝ…¥Ð É|ÔÀÀ¤ì(€€€€€ô(€€€ô(€ô(€É•ÑÕÉ¸™…±Í”ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•¹ÍÕÉ•M•±±•É1½¥¹	•™½É•	É…¹‘M•…É ¡‰É…¹‘9…µ”€ô€ˆˆ¤ì(€½¹ÍÐ¥¹¥Ñ¥…±MÑ…Ñ”€ô…Ý…¥ÐÝ…¥Ñ½ÉM•±±•ÉÕÑ¡•¹Ñ¥…Ñ¥½¹MÑ…Ñ” ¤ì(€¥˜€¡¥¹¥Ñ¥…±MÑ…Ñ”¹…ÕÑ¡•¹Ñ¥…Ñ•¤É•ÑÕÉ¸ì½¬èÑÉÕ”°É•ÕÍ•èÑÉÕ”ôì(€¥˜€ …¥¹¥Ñ¥…±MÑ…Ñ”¹±½¥¸¤É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰M11I}1=%9}A}Q%5=UPˆôì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰M11I}]%9=]}1=Mˆôì(€¥˜€¡Í•±±•É]¥¹‘½Ü¹¥Í5¥¹¥µ¥é• ¤¤Í•±±•É]¥¹‘½Ü¹É•ÍÑ½É” ¤ì(€Í•±±•É]¥¹‘½Ü¹Í¡½Ü ¤ì(€Í•±±•É]¥¹‘½Ü¹™½ÕÌ ¤ì(€±•Ð…ÕÑ½µ…Ñ¥Œ€ô…Ý…¥ÐÍÕ‰µ¥ÑMÑ½É•‘M•±±•ÉÉ•‘•¹Ñ¥…±Ì ¤ì(€±•Ð±…ÍÑÕÑ½1½¥¹ÑÑ•µÁÑÐ€ô…Ñ”¹¹½Ü ¤ì(€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€ÍÑ…ÑÕÌè€‰Í•±±•Èµ±½¥¸µÝ…¥Ñ¥¹œˆ°(€€€‰É…¹‘9…µ”°(€€€©½‰MÑ…Ñ”è…ÕÑ½µ…Ñ¥Œ¹½¬€ü€‹²zC®>dƒ®†sªÞã²vàƒ²’Dƒ
Üƒ²f®Ž0ƒ¶nƒªÊ²$ƒ²z³ªÂpˆ€è€‹®†sªÞã²vàƒ¶fW²vàƒ®2ªâÀƒ
Üƒ²f®Ž0ƒ¶nƒªÊ²$ƒ²z³ªÂpˆ°(€€€µ•ÍÍ…”è…ÕÑ½µ…Ñ¥Œ¹½¬(€€€€€€ü€‘í‰É…¹‘9…µ•ôƒ
Üƒ²VS¶bã¶fPƒ²‚²z—®BpƒªÎ²‚W²ró®†pA=%i=8ƒ²zC®>dƒ®†sªÞã²vã²vƒ²ž¶Z'¶V§®.#®.¹€(€€€€€€è€‘í‰É…¹‘9…µ•ôƒ
ÜA=%i=8ƒ®†sªÞã²vã²vÐƒ¶V²jS¶V§®.#®.¸ƒ®†sªÞã²vàƒ¶nƒ®â3®zs®NpƒªÊ²'²vÐƒ²zC®>g²ró®†pƒ²vÓ²ZÓ²žG®.#®.¹€°(€ô¤ì(€½¹ÍÐ‘•…‘±¥¹”€ô…Ñ”¹¹½Ü ¤€¬M11I}1=%9}]%Q}5Lì(€Ý¡¥±”€¡…Ñ”¹¹½Ü ¤€ð‘•…‘±¥¹”¤ì(€€€…Ý…¥ÐÝ…¥Ð Å|ÀÀÀ¤ì(€€€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰M11I}]%9=]}1=Mˆôì(€€€½¹ÍÐÁ…•MÑ…Ñ”€ô…Ý…¥ÐÍ•±±•ÉÕÑ¡•¹Ñ¥…Ñ¥½¹MÑ…Ñ” ¤ì(€€€¥˜€¡Á…•MÑ…Ñ”¹±½¥¸¤ì(€€€€€€¼¼Q¡”-½É•…¸±½¥¸™½É´¥ÌÉ•¹‘•É•…Íå¹¡É½¹½ÕÍ±ä¸-••ÀÉ•ÑÉå¥¹œÑ¡”(€€€€€€¼¼•¹ÉåÁÑ•É•‘•¹Ñ¥…±Ì…™Ñ•È¥ÑÌ¥¹ÁÕÑÌ…ÁÁ•…È¥¹ÍÑ•…½˜ÑÉå¥¹œ½¹±ä(€€€€€€¼¼½¹”Ý¡¥±”Ñ¡”Á…”¥ÌÍÑ¥±°•µÁÑä¸(€€€€€¥˜€¡…Ñ”¹¹½Ü ¤€´±…ÍÑÕÑ½1½¥¹ÑÑ•µÁÑÐ€øô€É|ÔÀÀ¤ì(€€€€€€€…ÕÑ½µ…Ñ¥Œ€ô…Ý…¥ÐÍÕ‰µ¥ÑMÑ½É•‘M•±±•ÉÉ•‘•¹Ñ¥…±Ì ¤ì(€€€€€€€±…ÍÑÕÑ½1½¥¹ÑÑ•µÁÑÐ€ô…Ñ”¹¹½Ü ¤ì(€€€€€ô(€€€€€½¹Ñ¥¹Õ”ì(€€€ô(€€€¥˜€ …Á…•MÑ…Ñ”¹…ÕÑ¡•¹Ñ¥…Ñ•¤½¹Ñ¥¹Õ”ì(€€€…Ý…¥ÐÍ•ÑM•±±•É1½¥¹MÑ…ÑÕÍ=Ù•É±…ä ‰ÍÕ•ÍÌˆ°€‹²zC®>dƒ®†sªÞã²vàƒ¶3²*“¶*àƒ²ÇªÎÔƒ²f®Ž0ˆ°€‰A=%i=8ƒ¶2C®ž“²zC²ó¶Àƒ²ž²z²vƒ¶fW²vã¶Z#²*×®.#®.¸ƒ®â3®zs®NpƒªÊ²'²vƒ²zC®>g²ró®†pƒªÎ²7¶V§®.#®.¸ˆ¤ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€€€ÍÑ…ÑÕÌè€‰Í•±±•Èµ±½¥¸µÉ•ÍÑ½É•ˆ°(€€€€€‰É…¹‘9…µ”°(€€€€€©½‰MÑ…Ñ”è€‹®†sªÞã²vàƒ²f®Ž0ƒ
Üƒ®â3®zs®NpƒªÊ²$ƒ²zC®>dƒ²z³ªÂpˆ°(€€€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
ÜA=%i=8ƒ®†sªÞã²vàƒ²f®Ž0ƒ¶nƒ®â3®zs®NpƒªÊ²'²vƒ²zC®>g²ró®†pƒªÎ²7¶V§®.#®.¹€°(€€€ô¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°É•ÕÍ•è™…±Í”ôì(€ô(€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰M11I}1=%9}Q%5=UPˆôì)ô()™Õ¹Ñ¥½¸ÕÉÉ•¹ÑM•±±•ÉAÉ½‘ÕÑÉ…µ” ¤ì(€½¹ÍÐ™É…µ•Ì€ôÍ•±±•É]¥¹‘½ÝÉ…µ•Ì ¤ì(€É•ÑÕÉ¸™É…µ•Ì¹™¥¹ ¡™É…µ”¤€ôø™É…µ”¹É½ÕÑ¥¹%€ôôôÍ•±±•ÉAÉ½‘ÕÑÉ…µ•I½ÕÑ¥¹%¤(€€€ñð™É…µ•ÍlÁt(€€€ñð¹Õ±°ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘•Ñ•ÑM•±±•É…¥±åM•…É¡1¥µ¥Ð ¤ì(€½¹ÍÐÁ…ÑÑ•É¹Ì€ôl(€€€€¼ üë¶Vc®Ž¡ó²vó²vñó®.ç²vñó²b“®*`¥myq¹uìÀ°àÁôüÈÁqÌ¨ üë®Ê!ó¶j0¥myq¹uìÀ°àÁôü üëªÂ®*•ó²Ò#ªÎñó²‚s¶Vqó®>®.°¤½¤°(€€€€¼ÈÁqÌ¨ üë®Ê!ó¶j0¥myq¹uìÀ°àÁôü üë²Ò#ªÎñó²‚s¶VqóªÂ®*•ó®>®.°¤½¤°(€€€€¼ üëš¾?š^•óš¾?–’¥ó’î+š^”¥myq¹uìÀ°àÁôüÈÁqÌ«š²…myq¹uìÀ°àÁôü üë’â+¦fAó¦fC–"Ùó¢Ú¢þó–ÞËžR£–º0¤½¤°(€€€€¼ÈÁqÌ«š²…myq¹uìÀ°àÁôü üë’â+¦fAó¦fC–"Ùó¢Ú¢þó–ÞËžR£–º0¤½¤°(€tì(€™½È€¡½¹ÍÐ™É…µ”½˜Í•±±•É]¥¹‘½ÝÉ…µ•Ì ¤¤ì(€€€½¹ÍÐ¹½Ñ¥”€ô…Ý…¥Ð•á•ÕÑ•M•±±•ÉÉ…µ•]¥Ñ¡Q¥µ•½ÕÐ¡™É…µ”°€  ¤€ôøì(€€€€€½¹ÍÐÑ•áÐ€ôMÑÉ¥¹œ¡‘½Õµ•¹Ð¹‰½‘äü¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€€€€€½¹ÍÐÁ…ÑÑ•É¹Ì€ô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Á…ÑÑ•É¹Ì¹µ…À ¡Á…ÑÑ•É¸¤€ôøÁ…ÑÑ•É¸¹Í½ÕÉ”¤¥ô(€€€€€€€€¹µ…À ¡Í½ÕÉ”¤€ôø¹•ÜI•áÀ¡Í½ÕÉ”°€‰¤ˆ¤¤ì(€€€€€½¹ÍÐµ…Ñ¡•€ôÁ…ÑÑ•É¹Ì¹™¥¹ ¡Á…ÑÑ•É¸¤€ôøÁ…ÑÑ•É¸¹Ñ•ÍÐ¡Ñ•áÐ¤¤ì(€€€€€É•ÑÕÉ¸µ…Ñ¡•€ü€¡Ñ•áÐ¹µ…Ñ ¡µ…Ñ¡•¤ü¹lÁtñð€‰%1e}1%5%Pˆ¤€è€ˆˆì(€€€ô¤ ¥€°€É|ÀÀÀ°€ˆˆ¤¹…Ñ   ¤€ôø€ˆˆ¤ì(€€€¥˜€¡¹½Ñ¥”¤É•ÑÕÉ¸ì•á••‘•èÑÉÕ”°¹½Ñ¥”èMÑÉ¥¹œ¡¹½Ñ¥”¤ôì(€ô(€É•ÑÕÉ¸ì•á••‘•è™…±Í”°¹½Ñ¥”è€ˆˆôì)ô()™Õ¹Ñ¥½¸Í•±±•É	É…¹‘áÁ½ÉÑ…¥±ÕÉ•5•ÍÍ…”¡½‘”€ô€ˆˆ°‰É…¹‘9…µ”€ô€ˆˆ¤ì(€½¹ÍÐ±…‰•°€ôMÑÉ¥¹œ¡‰É…¹‘9…µ”ñð€‹²ƒ¶tƒ®â3®zs®Npˆ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐµ•ÍÍ…•Ì€ôì(€€€MI!}%9AUQ}9=Q}=U9è€‘í±…‰•±ôƒ²¶J#ªÊ²$ƒ²z®‚—²Â÷²vÐƒ¶Fs².s®Bc²ž ƒ²V+²Vc²*×®.#®.¸ƒ².sªÂƒªÂªÊ§²vƒ®FCªÎ€ƒ®.“².pƒ²ž¶Z'¶V§®.#®.¹€°(€€€M11I}1=%9}IEU%Iè€‘í±…‰•±ôƒ²zG²^ƒ²’Dƒ¶2C®ž“²zC²ó¶Àƒ®†sªÞã²vàƒ¶fS®¦Ó²vÐƒ¶fW²vã®BC²*×®.#®.¸ƒ®†sªÞã²vàƒ¶nƒ®.“².pƒ².“¶Z'¶VÐƒ²Žó²ã²jP¹€°(€€€M11I}MI!}MI%AQ}II=Hè€‘í±…‰•±ôƒ²¶J#ªÊ²$ƒ¶fS®¦Ðƒ²‚s²ZÐƒ²’Dƒ²b“®–cªÂ ƒ®Âs²w¶Z#²*×®.#®.¸ƒ²¶J#ªÊ²$ƒ¶fS®¦Ó²vƒ®.“².pƒ²^Ó²ZÐƒ²z³².s®>¶VÐƒ²Žó²ã²jP¹€°(€€€M11I}MI!}MQ}Q%5=UPè€‘í±…‰•±ôƒ²¶J#ªÊ²$ƒ®.£ªÎªÂ €ÐÃ²Ò ƒ²V#²^@ƒ®w®
c²ž ƒ²V+²Vƒ¶:c²vÓ²ž®–ðƒ²Ò#ªâÃ¶fS¶Z#²*×®.#®.¸ƒ²vÓ²‚ƒªÊ²$ƒ²zG²^²v ƒ²Š®Ž3®Bc²^#²*×®.#®.¹€°(€€€M11I}MUI%Qe}!-}IEU%Iè€‘í±…‰•±ôƒªÊ²$ƒ²’DA=%i=8ƒ®ÎÓ²V ƒ¶fW²vàƒ¶fS®¦Ó²vÐƒ¶Fs².s®BC²*×®.#®.¸ƒ¶2C®ž“²zC²ó¶Ã²^C²pƒ®ÎÓ²V ƒ¶fW²vã²vƒ²f®Ž3¶Vpƒ®Jƒ®.“².pƒ².“¶Z'¶VÐƒ²Žó²ã²jP¹€°(€€€AI=UQ}YI%%Q%=9}Q%5=UPè€‘í±…‰•±ôƒ²‚²ÊÐƒ¶:c²vÓ²ž ƒ¶fW²vã²vÐ€ÜÃ²Ò ƒ²V#²^@ƒ®w®
c²ž ƒ²V+²Vƒ®.“²v0ƒ®â3®zs®Ns®†pƒ²vÓ®>g¶V§®.#®.¹€°(€€€	I9}%9AUQ}9=Q}AA1%è€‘í±…‰•±ôƒªÊ²'²ZÓªÂ ƒ¶2C®ž“²zC²ó¶Ã²^@ƒ²z®‚—®Bc²ž ƒ²V+²Vƒ²’G®.£¶Z#²*×®.#®.¹€°(€€€	I9}IMU1Q}5%M5Q è€‘í±…‰•±ôƒªÊ²$ƒªÊÃªÎóªÂ ƒ¶fW²vã®Bc²ž ƒ²V+²Vƒ®
Ó®ÎÓ®
ÓªâÃ®–ðƒ²’G®.£¶Z#²*×®.#®.¸ƒªâÃ²†ÐƒªÊ²$ƒªÊÃªÎó®*Pƒ®.“²jÓ®†s®Ns¶Vc²ž ƒ²V+²*×®.#®.¹€°(€€€MI!}IMU1Q}9=Q}UAQè€‘í±…‰•±ôƒªÊ²$ƒªÊÃªÎóªÂ ƒ²#®†pƒ®ÂS®3²ž ƒ²V+²Vƒ®
Ó®ÎÓ®
ÓªâÃ®–ðƒ²’G®.£¶Z#²*×®.#®.¸ƒªâÃ²†ÐƒªÊ²$ƒªÊÃªÎó®*Pƒ®.“²jÓ®†s®Ns¶Vc²ž ƒ²V+²*×®.#®.¹€°(€€€AIQ%1}AI=UQ}=11Q%=8è€‘í±…‰•±ôƒ²‚²ÊÐƒ²¶J ƒ²"c²žG²vÐƒ²f®Ž3®Bc²ž ƒ²V+²Vƒ®
Ó®ÎÓ®
ÓªâÃ®–ðƒ²’G®.£¶Z#²*×®.#®.¸ƒ®Ú®Úƒ¶23²vó²v ƒ®.“²jÓ®†s®Ns¶Vc²ž ƒ²V+²*×®.#®.¹€°(€€€AI=UQ}A}9=Q}Idè€‘í±…‰•±ôƒ²¶J ƒ²"c²f ƒ²‚²ÊÐƒ¶:c²vÓ²ž®–ðƒ¶fW²vã¶Vc²ž ƒ®ªï¶VÐƒ®
Ó®ÎÓ®
ÓªâÃ®–ðƒ²’G®.£¶Z#²*×®.#®.¹€°(€€€AI=UQ}1MQ}A}%1è€‘í±…‰•±ôƒ®ž#²ž®ž$ƒ²¶J ƒ¶:c²vÓ²ž®–ðƒ¶fW²vã¶Vc²ž ƒ®ªï¶VÐƒ®
Ó®ÎÓ®
ÓªâÃ®–ðƒ²’G®.£¶Z#²*×®.#®.¹€°(€€€=]91=}9QI}M!=IQUQ}9=Q}=U9è€‘í±…‰•±ôƒ®
Ó®ÎÓ®
ÓªâÀƒ¶nƒ®.“²jÓ®†s®Ns²ó¶Àƒ®ÂS®†pƒªÂªâÀƒ®Ê¶*ó²vƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¹€°(€€€%1e}MI!}1%5%Q}aè€‹¶>³²vÓ²š0ƒªÊ²$ƒ®6Ã²vÓ¶Ã®*Pƒ¶Vc®Ž €ÈÃ®Ê#®ž0ƒªÂ®*—¶V§®.#®.¸ƒ²b“®*`ƒ²
³²j¤ƒªÂ®*”ƒ¶j²"c®–ðƒ²Ò#ªÎó¶Z#²*×®.#®.¸ˆ°(€ôì(€É•ÑÕÉ¸µ•ÍÍ…•Ím½‘•tñðƒ¶2C®ž“²zC²ó¶Àƒ²zC®>g¶fPƒ².“¶2 è€‘í½‘”ñð€‰U9-9=]8‰õ€ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Ù•É¥™å½µÁ±•Ñ•M•±±•ÉáÁ½ÉÑ¹‘±¥¬¡•áÁ•Ñ•‘Q½Ñ…°€ô€À¤ì(€½¹ÍÐÁÉ½‘ÕÑÉ…µ”€ôÕÉÉ•¹ÑM•±±•ÉAÉ½‘ÕÑÉ…µ” ¤ì(€¥˜€ …ÁÉ½‘ÕÑÉ…µ”¤É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰AI=UQ}A}9=Q}Idˆôì(€É•ÑÕÉ¸ÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐ¹½Éµ…±¥é•‘Q•áÐ€ô€¡•±•µ•¹Ð¤€ôøMÑÉ¥¹œ¡•±•µ•¹Ðü¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ðü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤(€€€€€€¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÉ•…‘Q½Ñ…°€ô€ ¤€ôøì(€€€€€½¹ÍÐµ…Ñ €ôMÑÉ¥¹œ¡‘½Õµ•¹Ð¹‰½‘äü¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¹µ…Ñ  ¿²ÒuqqÌ¨¡mqq±t¬¥qqÌ«ªÆÑqqÌ«ªÊÃªÎð¼¤ì(€€€€€É•ÑÕÉ¸9Õµ‰•È¡MÑÉ¥¹œ¡µ…Ñ ü¹lÅtñð€ˆÀˆ¤¹É•Á±…” ¼°½œ°€ˆˆ¤¤ñð€Àì(€€€ôì(€€€½¹ÍÐÉ•…‘A…”€ô€ ¤€ôøì(€€€€€½¹ÍÐÑ…‰±•Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰Ñ…‰±”ˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€½¹ÍÐÑ…‰±”€ôÑ…‰±•Ì(€€€€€€€€¹µ…À ¡•±•µ•¹Ð¤€ôø€¡ì(€€€€€€€€€•±•µ•¹Ð°(€€€€€€€€€É½ÝÌèl¸¸¹•±•µ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰Ñ‰½‘äÑÈˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€€€€€¹™¥±Ñ•È ¡É½Ü¤€ôø¹½Éµ…±¥é•‘Q•áÐ¡É½Ü¤¹±•¹Ñ €ø€À¤°(€€€€€€€ô¤¤(€€€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøÉ¥¡Ð¹É½ÝÌ¹±•¹Ñ €´±•™Ð¹É½ÝÌ¹±•¹Ñ ¥lÁtì(€€€€€½¹ÍÐÉ½ÝÌ€ôÑ…‰±”ü¹É½ÝÌñðmtì(€€€€€½¹ÍÐ­•åÌ€ôÉ½ÝÌ¹µ…À ¡É½Ü¤€ôøì(€€€€€€€½¹ÍÐ•áÁ±¥¥Ð€ôÉ½Ü¹•ÑÑÑÉ¥‰ÕÑ” ‰‘…Ñ„µÉ½Üµ­•äˆ¤(€€€€€€€€€ñðÉ½Ü¹•ÑÑÑÉ¥‰ÕÑ” ‰‘…Ñ„µ­•äˆ¤(€€€€€€€€€ñðÉ½Ü¹•ÑÑÑÉ¥‰ÕÑ” ‰‘…Ñ„µ¥ˆ¤(€€€€€€€€€ñðÉ½Ü¹¥ì(€€€€€€€É•ÑÕÉ¸MÑÉ¥¹œ¡•áÁ±¥¥Ðñð¹½Éµ…±¥é•‘Q•áÐ¡É½Ü¤¤¹ÑÉ¥´ ¤ì(€€€€€ô¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€€€½¹ÍÐ…Ñ¥Ù”€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ¥Ñ•´µ…Ñ¥Ù”ˆ¥t¹™¥¹¡Ù¥Í¥‰±”¤ì(€€€€€½¹ÍÐÁ…•M¥é•Q•áÐ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÍ•±•ÐµÍ•±•Ñ¥½¸µ¥Ñ•´ˆ¥t(€€€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôøÙ¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜€¿ªÆÑqp¿¶:c²vÓ²ž ¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¤¤ü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆì(€€€€€½¹ÍÐÁ…•M¥é”€ô9Õµ‰•È¡Á…•M¥é•Q•áÐ¹µ…Ñ  ¼¡qq¬¥qqÌ«ªÆÑqp¿¶:c²vÓ²ž ¼¤ü¹lÅt¤ñð­•åÌ¹±•¹Ñ ñð€ÄÀì(€€€€€½¹ÍÐÑ½Ñ…°€ôÉ•…‘Q½Ñ…° ¤ì(€€€€€½¹ÍÐÕÉÉ•¹ÑA…”€ô9Õµ‰•È¡…Ñ¥Ù”ü¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤ñð€Äì(€€€€€½¹ÍÐÁ…•½Õ¹Ð€ôÑ½Ñ…°€ø€À€ü5…Ñ ¹•¥°¡Ñ½Ñ…°€¼Á…•M¥é”¤€è€Àì(€€€€€É•ÑÕÉ¸ì­•åÌ°ÕÉÉ•¹ÑA…”°Á…•M¥é”°Á…•½Õ¹Ð°Ñ½Ñ…°ôì(€€€ôì(€€€½¹ÍÐ±¥­A…”€ô…Íå¹Œ€¡Ñ…É•ÑA…”¤€ôøì(€€€€€™½È€¡±•Ð±¥­ÑÑ•µÁÐ€ô€Àì±¥­ÑÑ•µÁÐ€ð€Ðì±¥­ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€€€½¹ÍÐ‘¥É•Ð€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ¥Ñ•´ˆ¥t(€€€€€€€€€€¹™¥¹ ¡¥Ñ•´¤€ôøÙ¥Í¥‰±”¡¥Ñ•´¤€˜˜9Õµ‰•È¡¥Ñ•´¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤€ôôôÑ…É•ÑA…”¤ì(€€€€€€€½¹ÍÐÕÉÉ•¹Ð€ôÉ•…‘A…” ¤¹ÕÉÉ•¹ÑA…”ì(€€€€€€€¥˜€¡ÕÉÉ•¹Ð€ôôôÑ…É•ÑA…”¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€€€½¹ÍÐÁ…¥¹…Ñ¥½¸€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸ˆ¥t¹™¥¹¡Ù¥Í¥‰±”¤ì(€€€€€€€½¹ÍÐ©ÕµÁ•È€ôÁ…¥¹…Ñ¥½¸ü¹ÅÕ•ÉåM•±•Ñ½È ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ½ÁÑ¥½¹ÌµÅÕ¥¬µ©ÕµÁ•È¥¹ÁÕÐˆ¤ì(€€€€€€€¥˜€¡‘¥É•Ð¤ì(€€€€€€€€€€¡‘¥É•Ð¹ÅÕ•ÉåM•±•Ñ½È ‰‰ÕÑÑ½¸±„ˆ¤ñð‘¥É•Ð¤¹±¥¬ ¤ì(€€€€€€€ô•±Í”¥˜€¡©ÕµÁ•È¤ì(€€€€€€€€€©ÕµÁ•È¹™½ÕÌ ¤ì(€€€€€€€€€½¹ÍÐÍ•ÑÑ•È€ô=‰©•Ð¹•Ñ=Ý¹AÉ½Á•ÉÑå•ÍÉ¥ÁÑ½È¡!Q51%¹ÁÕÑ±•µ•¹Ð¹ÁÉ½Ñ½ÑåÁ”°€‰Ù…±Õ”ˆ¤ü¹Í•Ðì(€€€€€€€€€¥˜€¡Í•ÑÑ•È¤Í•ÑÑ•È¹…±°¡©ÕµÁ•È°MÑÉ¥¹œ¡Ñ…É•ÑA…”¤¤ì(€€€€€€€€€•±Í”©ÕµÁ•È¹Ù…±Õ”€ôMÑÉ¥¹œ¡Ñ…É•ÑA…”¤ì(€€€€€€€€€©ÕµÁ•È¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ‰¥¹ÁÕÐˆ°ì‰Õ‰‰±•ÌèÑÉÕ”ô¤¤ì(€€€€€€€€€©ÕµÁ•È¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü-•å‰½…É‘Ù•¹Ð ‰­•å‘½Ý¸ˆ°ì(€€€€€€€€€€€­•äè€‰¹Ñ•Èˆ°½‘”è€‰¹Ñ•Èˆ°­•å½‘”è€ÄÌ°Ý¡¥ è€ÄÌ°‰Õ‰‰±•ÌèÑÉÕ”°(€€€€€€€€€ô¤¤ì(€€€€€€€€€©ÕµÁ•È¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü-•å‰½…É‘Ù•¹Ð ‰­•åÕÀˆ°ì(€€€€€€€€€€€­•äè€‰¹Ñ•Èˆ°½‘”è€‰¹Ñ•Èˆ°­•å½‘”è€ÄÌ°Ý¡¥ è€ÄÌ°‰Õ‰‰±•ÌèÑÉÕ”°(€€€€€€€€€ô¤¤ì(€€€€€€€ô•±Í”ì(€€€€€€€€€½¹ÍÐ¹Õµ‰•É•€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ¥Ñ•´ˆ¥t(€€€€€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€€€€€¹µ…À ¡¥Ñ•´¤€ôø€¡ì¥Ñ•´°Á…”è9Õµ‰•È¡¥Ñ•´¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤ñð€Àô¤¤(€€€€€€€€€€€€¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä¹Á…”€ø€À¤(€€€€€€€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøÉ¥¡Ð¹Á…”€´±•™Ð¹Á…”¤ì(€€€€€€€€€½¹ÍÐ‰½Õ¹‘…Éä€ôÑ…É•ÑA…”€øÕÉÉ•¹Ð€ü¹Õµ‰•É•‘lÁt€è¹Õµ‰•É•‘m¹Õµ‰•É•¹±•¹Ñ €´€Åtì(€€€€€€€€€¥˜€ …‰½Õ¹‘…Éäü¹¥Ñ•´ñð‰½Õ¹‘…Éä¹Á…”€ôôôÕÉÉ•¹Ð¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€€€€¡‰½Õ¹‘…Éä¹¥Ñ•´¹ÅÕ•ÉåM•±•Ñ½È ‰‰ÕÑÑ½¸±„ˆ¤ñð‰½Õ¹‘…Éä¹¥Ñ•´¤¹±¥¬ ¤ì(€€€€€€€ô(€€€€€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÐÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€€€€€¥˜€¡É•…‘A…” ¤¹ÕÉÉ•¹ÑA…”€ôôôÑ…É•ÑA…”¤ì(€€€€€€€€€€€…Ý…¥ÐÝ…¥Ð ÔÀÀ¤ì(€€€€€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€ô(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ôì((€€€½¹ÍÐÍ¥é•¡…¹•È€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ½ÁÑ¥½¹ÌµÍ¥é”µ¡…¹•È°¹…¹ÐµÁ…¥¹…Ñ¥½¸µ½ÁÑ¥½¹Ìˆ¥t(€€€€€€¹™¥¹¡Ù¥Í¥‰±”¤ì(€€€½¹ÍÐÍ•±•Ñ½È€ôÍ¥é•¡…¹•Èü¹ÅÕ•ÉåM•±•Ñ½È ˆ¹…¹ÐµÍ•±•ÐµÍ•±•Ñ½Èˆ¤ì(€€€¥˜€¡Í•±•Ñ½È¤ì(€€€€€Í•±•Ñ½È¹±¥¬ ¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€½¹ÍÐ½ÁÑ¥½¹Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° mÉ½±”ô‰½ÁÑ¥½¸‰t°¹…¹ÐµÍ•±•Ðµ¥Ñ•´µ½ÁÑ¥½¸œ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€¹µ…À ¡•±•µ•¹Ð¤€ôø€¡ì•±•µ•¹Ð°Í¥é”è9Õµ‰•È¡MÑÉ¥¹œ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤¹µ…Ñ  ½qq¬¼¤ü¹lÁtñð€À¤ô¤¤(€€€€€€€€¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä¹Í¥é”€ø€À¤(€€€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøÉ¥¡Ð¹Í¥é”€´±•™Ð¹Í¥é”¤ì(€€€€€½¹ÍÐÕÉÉ•¹ÑM¥é”€ôÉ•…‘A…” ¤¹Á…•M¥é”ì(€€€€€¥˜€¡½ÁÑ¥½¹ÍlÁt€˜˜½ÁÑ¥½¹ÍlÁt¹Í¥é”€øÕÉÉ•¹ÑM¥é”¤ì(€€€€€€€½ÁÑ¥½¹ÍlÁt¹•±•µ•¹Ð¹±¥¬ ¤ì(€€€€€€€…Ý…¥ÐÝ…¥Ð Å|ÈÀÀ¤ì(€€€€€ô•±Í”ì(€€€€€€€‘½Õµ•¹Ð¹‰½‘ä¹±¥¬ ¤ì(€€€€€ô(€€€ô((€€€±•Ð™¥ÉÍÑM¹…ÁÍ¡½Ð€ôÉ•…‘A…” ¤ì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ØÀ€˜˜€ …™¥ÉÍÑM¹…ÁÍ¡½Ð¹Ñ½Ñ…°ñð€…™¥ÉÍÑM¹…ÁÍ¡½Ð¹­•åÌ¹±•¹Ñ ¤ì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€™¥ÉÍÑM¹…ÁÍ¡½Ð€ôÉ•…‘A…” ¤ì(€€€ô(€€€½¹ÍÐ•áÁ•Ñ•€ô5…Ñ ¹µ…à ‘í9Õµ‰•È¡•áÁ•Ñ•‘Q½Ñ…°¤ñð€Áô°™¥ÉÍÑM¹…ÁÍ¡½Ð¹Ñ½Ñ…°¤ì(€€€½¹ÍÐ™¥¹…±A…•½Õ¹Ð€ô™¥ÉÍÑM¹…ÁÍ¡½Ð¹Á…•½Õ¹Ð(€€€€€ñð€¡•áÁ•Ñ•€ø€À€˜˜™¥ÉÍÑM¹…ÁÍ¡½Ð¹Á…•M¥é”€ø€À€ü5…Ñ ¹•¥°¡•áÁ•Ñ•€¼™¥ÉÍÑM¹…ÁÍ¡½Ð¹Á…•M¥é”¤€è€À¤ì(€€€¥˜€¡•áÁ•Ñ•€ð€Äñð™¥¹…±A…•½Õ¹Ð€ð€Äñð€…™¥ÉÍÑM¹…ÁÍ¡½Ð¹­•åÌ¹±•¹Ñ ¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰AI=UQ}A}9=Q}Idˆ°•áÁ•Ñ•°…ÑÕ…°è€À°Á…•½Õ¹Ðè™¥¹…±A…•½Õ¹Ðôì(€€€ô((€€€¥˜€¡™¥¹…±A…•½Õ¹Ð€ø€Ä€˜˜€„¡…Ý…¥Ð±¥­A…”¡™¥¹…±A…•½Õ¹Ð¤¤¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰AI=UQ}1MQ}A}%1ˆ°•áÁ•Ñ•°…ÑÕ…°è€À°Á…•½Õ¹Ðè™¥¹…±A…•½Õ¹Ðôì(€€€ô(€€€±•Ð±…ÍÑM¹…ÁÍ¡½Ð€ôÉ•…‘A…” ¤ì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ØÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€¥˜€¡±…ÍÑM¹…ÁÍ¡½Ð¹ÕÉÉ•¹ÑA…”€ôôô™¥¹…±A…•½Õ¹Ð€˜˜±…ÍÑM¹…ÁÍ¡½Ð¹­•åÌ¹±•¹Ñ €ø€À¤‰É•…¬ì(€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€±…ÍÑM¹…ÁÍ¡½Ð€ôÉ•…‘A…” ¤ì(€€€ô(€€€¥˜€¡±…ÍÑM¹…ÁÍ¡½Ð¹ÕÉÉ•¹ÑA…”€„ôô™¥¹…±A…•½Õ¹Ðñð€…±…ÍÑM¹…ÁÍ¡½Ð¹­•åÌ¹±•¹Ñ ¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰AI=UQ}1MQ}A}%1ˆ°•áÁ•Ñ•°…ÑÕ…°è€À°Á…•½Õ¹Ðè™¥¹…±A…•½Õ¹Ðôì(€€€ô(€€€¥˜€¡±…ÍÑM¹…ÁÍ¡½Ð¹Ñ½Ñ…°€ø€À€˜˜±…ÍÑM¹…ÁÍ¡½Ð¹Ñ½Ñ…°€„ôô•áÁ•Ñ•¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰AIQ%1}AI=UQ}=11Q%=8ˆ°•áÁ•Ñ•°…ÑÕ…°è±…ÍÑM¹…ÁÍ¡½Ð¹Ñ½Ñ…°°Á…•½Õ¹Ðè™¥¹…±A…•½Õ¹Ðôì(€€€ô((€€€½¹ÍÐ•áÁ½ÉÑA…ÑÑ•É¸€ô€½{²‚²ÊÑqqÌ«®
Ó®ÎÓ®
ÓªâÀ¼ì(€€€±•Ð•áÁ½ÉÑ	ÕÑÑ½¸€ô¹Õ±°ì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÈÀ€˜˜€…•áÁ½ÉÑ	ÕÑÑ½¸ì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€½¹ÍÐ±…‰•±±•µ•¹Ð€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸t°„°ÍÁ…¸ˆ¥t(€€€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôøÙ¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜•áÁ½ÉÑA…ÑÑ•É¸¹Ñ•ÍÐ¡¹½Éµ…±¥é•‘Q•áÐ¡•±•µ•¹Ð¤¤¤ì(€€€€€•áÁ½ÉÑ	ÕÑÑ½¸€ô±…‰•±±•µ•¹Ðü¹±½Í•ÍÐü¸ ‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸t°„ˆ¤ñð±…‰•±±•µ•¹Ðñð¹Õ±°ì(€€€€€¥˜€ …•áÁ½ÉÑ	ÕÑÑ½¸¤…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€ô(€€€¥˜€ …•áÁ½ÉÑ	ÕÑÑ½¸¤É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰aA=IQ}	UQQ=9}9=Q}=U9}QI}YI%%Q%=8ˆ°•áÁ•Ñ•°…ÑÕ…°è•áÁ•Ñ•ôì(€€€¥˜€¡•áÁ½ÉÑ	ÕÑÑ½¸¹‘¥Í…‰±•ñð•áÁ½ÉÑ	ÕÑÑ½¸¹•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ‘¥Í…‰±•ˆ¤€ôôô€‰ÑÉÕ”ˆ¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰aA=IQ}	UQQ=9}%M	1}QI}YI%%Q%=8ˆ°•áÁ•Ñ•°…ÑÕ…°è•áÁ•Ñ•ôì(€€€ô(€€€½¹ÍÐ±¥­1¥­•UÍ•È€ô€¡•±•µ•¹Ð¤€ôøì(€€€€€¥˜€ …•±•µ•¹Ð¤É•ÑÕÉ¸™…±Í”ì(€€€€€•±•µ•¹Ð¹ÍÉ½±±%¹Ñ½Y¥•Ü¡ì‰±½¬è€‰•¹Ñ•Èˆ°¥¹±¥¹”è€‰•¹Ñ•Èˆô¤ì(€€€€€•±•µ•¹Ð¹™½ÕÌü¸ ¤ì(€€€€€™½È€¡½¹ÍÐÑåÁ”½˜l‰Á½¥¹Ñ•É‘½Ý¸ˆ°€‰µ½ÕÍ•‘½Ý¸ˆ°€‰Á½¥¹Ñ•ÉÕÀˆ°€‰µ½ÕÍ•ÕÀ‰t¤ì(€€€€€€€•±•µ•¹Ð¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü5½ÕÍ•Ù•¹Ð¡ÑåÁ”°ì(€€€€€€€€€‰Õ‰‰±•ÌèÑÉÕ”°(€€€€€€€€€…¹•±…‰±”èÑÉÕ”°(€€€€€€€€€½µÁ½Í•èÑÉÕ”°(€€€€€€€€€Ù¥•ÜèÝ¥¹‘½Ü°(€€€€€€€€€‰ÕÑÑ½¸è€À°(€€€€€€€ô¤¤ì(€€€€€ô(€€€€€•±•µ•¹Ð¹±¥¬ü¸ ¤ì(€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€ôì(€€€±¥­1¥­•UÍ•È¡•áÁ½ÉÑ	ÕÑÑ½¸¤ì(€€€…Ý…¥ÐÝ…¥Ð ÜÀÀ¤ì((€€€±•Ð½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•€ô™…±Í”ì(€€€±•Ð½¹™¥Éµ…Ñ¥½¹±¥­•€ô™…±Í”ì(€€€±•Ð½¹™¥Éµ…Ñ¥½¹±¥­½Õ¹Ð€ô€Àì(€€€±•ÐÉ•ÅÕ•ÍÑ­¹½Ý±•‘•€ô™…±Í”ì(€€€½¹ÍÐ½¹™¥Éµ…Ñ¥½¹A…ÑÑ•É¸€ô€½x üë¶fW²váó®
Ó®ÎÓ®
ÓªâÁó²w²Åó¶fW²‚Uó²‚s²ÚqóªÎ²5ó®ÂS®†qqÌ«ªÂªâÁó®.“²jÓ®†s®NqqÌ«²ó¶À¸«®ÂS®†qqÌ«ªÂªâÁóž†»¢º‘óž†»–ºióš>C’ê‘ó–¾ó–éóžîŸžî´¤½¤ì(€€€½¹ÍÐ…¹•±A…ÑÑ•É¸€ô€¿²Þ£²1ó®.¯ªâÁó®
c²’G²^Aó–>[šÚ!ó–Ï¦^´½¤ì(€€€½¹ÍÐÍÕ•ÍÍA…ÑÑ•É¸€ô€¼ üë®
Ó®ÎÓ®
ÓªâÁó²zG²^ó¶23²vð¤¸¨ üë®NÇ®†uó²w²Åó²f®Ž1ó²ÇªÎÕó²‚G²"`¥ð üë–¾ó–éó’îï–*„¤¸¨ üëš"C–*}ó–ÞË–"o–îéó–ÞËš>C’ê¤½¤ì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ØÐì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€½¹ÍÐ‘¥…±½Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€€€ˆ¹…¹Ðµµ½‘…°°€¹…¹Ðµµ½‘…°µ½¹™¥É´°mÉ½±”ô‘¥…±½œt°€¹…¹ÐµÁ½Á½Ù•È°€¹…¹Ðµ‘É…Ý•Èˆ(€€€€€€¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€¥˜€¡‘¥…±½Ì¹±•¹Ñ ¤½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•€ôÑÉÕ”ì(€€€€€½¹ÍÐ½¹ÑÉ½±Ì€ô‘¥…±½Ì¹™±…Ñ5…À ¡‘¥…±½œ¤€ôø(€€€€€€€l¸¸¹‘¥…±½œ¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸t°„ˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¤ì(€€€€€½¹ÍÐ½¹™¥Éµ½¹ÑÉ½°€ô½¹ÑÉ½±Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôøì(€€€€€€€½¹ÍÐ±…‰•°€ô¹½Éµ…±¥é•‘Q•áÐ¡•±•µ•¹Ð¤ì(€€€€€€€É•ÑÕÉ¸½¹™¥Éµ…Ñ¥½¹A…ÑÑ•É¸¹Ñ•ÍÐ¡±…‰•°¤€˜˜€……¹•±A…ÑÑ•É¸¹Ñ•ÍÐ¡±…‰•°¤ì(€€€€€ô¤ñð½¹ÑÉ½±Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôøì(€€€€€€€½¹ÍÐ±…‰•°€ô¹½Éµ…±¥é•‘Q•áÐ¡•±•µ•¹Ð¤ì(€€€€€€€½¹ÍÐ±…ÍÍ9…µ”€ôMÑÉ¥¹œ¡•±•µ•¹Ð¹±…ÍÍ9…µ”ñð€ˆˆ¤ì(€€€€€€€É•ÑÕÉ¸€½ÁÉ¥µ…Éåñ½¹™¥Éµñ½¬½¤¹Ñ•ÍÐ¡±…ÍÍ9…µ”¤€˜˜€……¹•±A…ÑÑ•É¸¹Ñ•ÍÐ¡±…‰•°¤ì(€€€€€ô¤ì(€€€€€¥˜€¡½¹™¥Éµ½¹ÑÉ½°¤ì(€€€€€€€±¥­1¥­•UÍ•È¡½¹™¥Éµ½¹ÑÉ½°¤ì(€€€€€€€½¹™¥Éµ…Ñ¥½¹±¥­•€ôÑÉÕ”ì(€€€€€€€½¹™¥Éµ…Ñ¥½¹±¥­½Õ¹Ð€¬ô€Äì(€€€€€€€…Ý…¥ÐÝ…¥Ð äÀÀ¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€¥˜€¡ÍÕ•ÍÍA…ÑÑ•É¸¹Ñ•ÍÐ¡¹½Éµ…±¥é•‘Q•áÐ¡‘½Õµ•¹Ð¹‰½‘ä¤¤¤ì(€€€€€€€É•ÅÕ•ÍÑ­¹½Ý±•‘•€ôÑÉÕ”ì(€€€€€€€‰É•…¬ì(€€€€€ô(€€€€€¥˜€¡½¹™¥Éµ…Ñ¥½¹±¥­½Õ¹Ð€ø€À€˜˜‘¥…±½Ì¹±•¹Ñ €ôôô€À¤ì(€€€€€€€…Ý…¥ÐÝ…¥Ð Å|ÈÀÀ¤ì(€€€€€€€½¹ÍÐÉ•µ…¥¹¥¹¥…±½Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€€€€€ˆ¹…¹Ðµµ½‘…°°€¹…¹Ðµµ½‘…°µ½¹™¥É´°mÉ½±”ô‘¥…±½œt°€¹…¹ÐµÁ½Á½Ù•È°€¹…¹Ðµ‘É…Ý•Èˆ(€€€€€€€€¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€€€¥˜€ …É•µ…¥¹¥¹¥…±½Ì¹±•¹Ñ ¤ì(€€€€€€€€€É•ÅÕ•ÍÑ­¹½Ý±•‘•€ôÑÉÕ”ì(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€ô(€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€½¬èÑÉÕ”°(€€€€€•áÁ•Ñ•°(€€€€€…ÑÕ…°è•áÁ•Ñ•°(€€€€€Á…•½Õ¹Ðè™¥¹…±A…•½Õ¹Ð°(€€€€€™¥ÉÍÑA…•½Õ¹Ðè™¥ÉÍÑM¹…ÁÍ¡½Ð¹­•åÌ¹±•¹Ñ °(€€€€€±…ÍÑA…•½Õ¹Ðè±…ÍÑM¹…ÁÍ¡½Ð¹­•åÌ¹±•¹Ñ °(€€€€€½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•°(€€€€€½¹™¥Éµ…Ñ¥½¹±¥­•°(€€€€€½¹™¥Éµ…Ñ¥½¹±¥­½Õ¹Ð°(€€€€€É•ÅÕ•ÍÑ­¹½Ý±•‘•°(€€€€€½¹™¥Éµ…Ñ¥½¹Q¥µ•‘=ÕÐè€…É•ÅÕ•ÍÑ­¹½Ý±•‘•°(€€€ôì(€ô¤ ¥€°ÑÉÕ”¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸…ÁÑÕÉ•M•±±•É¥…¹½ÍÑ¥Œ¡‰É…¹‘9…µ”€ô€ˆˆ°ÍÑ…”€ô€‰•ÉÉ½Èˆ¤ì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤É•ÑÕÉ¸€ˆˆì(€ÑÉäì(€€€½¹ÍÐ™½±‘•È€ô©½¥¸¡…ÁÀ¹•ÑA…Ñ  ‰ÕÍ•É…Ñ„ˆ¤°€‰Í•±±•Èµ‘¥…¹½ÍÑ¥Ìˆ¤ì(€€€…Ý…¥Ðµ­‘¥È¡™½±‘•È°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€€€½¹ÍÐ™¥±•A…Ñ €ô©½¥¸¡™½±‘•È°€‘íÍ…™•	É…¹‘áÁ½ÉÑ1…‰•°¡‰É…¹‘9…µ”¤ñð€‰‰É…¹‰õ|‘íÍÑ…•õ|‘í±½…±¥±•Q¥µ•ÍÑ…µÀ ¥ô¹Á¹€¤ì(€€€½¹ÍÐ¥µ…”€ô…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹…ÁÑÕÉ•A…” ¤ì(€€€…Ý…¥ÐÝÉ¥Ñ•¥±”¡™¥±•A…Ñ °¥µ…”¹Ñ½A9 ¤¤ì(€€€É•ÑÕÉ¸™¥±•A…Ñ ì(€ô…Ñ ì(€€€É•ÑÕÉ¸€ˆˆì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸½¹™¥ÉµM•±±•ÉáÁ½ÉÑI•ÅÕ•ÍÐ¡Ñ…É•ÑÉ…µ”¤ì(€É•ÑÕÉ¸Ñ…É•ÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €ø€À(€€€€€€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹¡•¥¡Ð€ø€Àì(€€€½¹ÍÐÑ•áÑ=˜€ô€¡•±•µ•¹Ð¤€ôøMÑÉ¥¹œ¡•±•µ•¹Ðü¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ðü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤(€€€€€€¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ±¥­1¥­•UÍ•È€ô€¡•±•µ•¹Ð¤€ôøì(€€€€€•±•µ•¹Ðü¹ÍÉ½±±%¹Ñ½Y¥•Üü¸¡ì‰±½¬è€‰•¹Ñ•Èˆ°¥¹±¥¹”è€‰•¹Ñ•Èˆô¤ì(€€€€€•±•µ•¹Ðü¹™½ÕÌü¸ ¤ì(€€€€€™½È€¡½¹ÍÐÑåÁ”½˜l‰Á½¥¹Ñ•É‘½Ý¸ˆ°€‰µ½ÕÍ•‘½Ý¸ˆ°€‰Á½¥¹Ñ•ÉÕÀˆ°€‰µ½ÕÍ•ÕÀ‰t¤ì(€€€€€€€•±•µ•¹Ðü¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü5½ÕÍ•Ù•¹Ð¡ÑåÁ”°ì(€€€€€€€€€‰Õ‰‰±•ÌèÑÉÕ”°…¹•±…‰±”èÑÉÕ”°½µÁ½Í•èÑÉÕ”°Ù¥•ÜèÝ¥¹‘½Ü°‰ÕÑÑ½¸è€À°(€€€€€€€ô¤¤ì(€€€€€ô(€€€€€•±•µ•¹Ðü¹±¥¬ü¸ ¤ì(€€€ôì(€€€½¹ÍÐ½¹™¥ÉµA…ÑÑ•É¸€ô€½x üë¶fW²váó®
Ó®ÎÓ®
ÓªâÁó²w²Åó¶fW²‚Uó²‚s²ÚqóªÎ²5ó®ÂS®†qqÌ«ªÂªâÁó®.“²jÓ®†s®NqqÌ«²ó¶À¸«®ÂS®†qqÌ«ªÂªâÁóž†»¢º‘óž†»–ºióš>C’ê‘ó–¾ó–éóžîŸžî´¤½¤ì(€€€½¹ÍÐ…¹•±A…ÑÑ•É¸€ô€¿²Þ£²1ó®.¯ªâÁó®
c²’G²^Aó–>[šÚ!ó–Ï¦^´½¤ì(€€€±•Ð½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•€ô™…±Í”ì(€€€±•Ð½¹™¥Éµ…Ñ¥½¹±¥­•€ô™…±Í”ì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ØÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€½¹ÍÐ‘¥…±½Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€€€ˆ¹…¹Ðµµ½‘…°°€¹…¹Ðµµ½‘…°µ½¹™¥É´°mÉ½±”ô‘¥…±½œt°€¹…¹ÐµÁ½Á½Ù•È°€¹…¹Ðµ‘É…Ý•Èˆ(€€€€€€¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€¥˜€¡‘¥…±½Ì¹±•¹Ñ ¤½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•€ôÑÉÕ”ì(€€€€€½¹ÍÐ½¹ÑÉ½±Ì€ô‘¥…±½Ì¹™±…Ñ5…À ¡‘¥…±½œ¤€ôø(€€€€€€€l¸¸¹‘¥…±½œ¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸t°„ˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¤ì(€€€€€½¹ÍÐ½¹™¥Éµ½¹ÑÉ½°€ô½¹ÑÉ½±Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôøì(€€€€€€€½¹ÍÐ±…‰•°€ôÑ•áÑ=˜¡•±•µ•¹Ð¤ì(€€€€€€€É•ÑÕÉ¸½¹™¥ÉµA…ÑÑ•É¸¹Ñ•ÍÐ¡±…‰•°¤€˜˜€……¹•±A…ÑÑ•É¸¹Ñ•ÍÐ¡±…‰•°¤ì(€€€€€ô¤ñð½¹ÑÉ½±Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôøì(€€€€€€€½¹ÍÐ±…‰•°€ôÑ•áÑ=˜¡•±•µ•¹Ð¤ì(€€€€€€€É•ÑÕÉ¸€½ÁÉ¥µ…Éåñ½¹™¥Éµñ½¬½¤¹Ñ•ÍÐ¡MÑÉ¥¹œ¡•±•µ•¹Ð¹±…ÍÍ9…µ”ñð€ˆˆ¤¤(€€€€€€€€€€˜˜€……¹•±A…ÑÑ•É¸¹Ñ•ÍÐ¡±…‰•°¤ì(€€€€€ô¤ì(€€€€€¥˜€¡½¹™¥Éµ½¹ÑÉ½°¤ì(€€€€€€€±¥­1¥­•UÍ•È¡½¹™¥Éµ½¹ÑÉ½°¤ì(€€€€€€€½¹™¥Éµ…Ñ¥½¹±¥­•€ôÑÉÕ”ì(€€€€€€€…Ý…¥ÐÝ…¥Ð äÀÀ¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€¥˜€¡½¹™¥Éµ…Ñ¥½¹±¥­•€˜˜€…‘¥…±½Ì¹±•¹Ñ ¤ì(€€€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•°½¹™¥Éµ…Ñ¥½¹±¥­•°É•ÅÕ•ÍÑ­¹½Ý±•‘•èÑÉÕ”ôì(€€€€€ô(€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€½¬è€…½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•°(€€€€€½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•°(€€€€€½¹™¥Éµ…Ñ¥½¹±¥­•°(€€€€€É•ÅÕ•ÍÑ­¹½Ý±•‘•è€…½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•°(€€€ôì(€ô¤ ¥€°ÑÉÕ”¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±¥­M•±±•É½Ý¹±½…‘•¹Ñ•ÉM¡½ÉÑÕÐ¡Ñ…É•ÑÉ…µ”¤ì(€É•ÑÕÉ¸Ñ…É•ÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €ø€À(€€€€€€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹¡•¥¡Ð€ø€Àì(€€€½¹ÍÐÑ•áÑ=˜€ô€¡•±•µ•¹Ð¤€ôøMÑÉ¥¹œ¡•±•µ•¹Ðü¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ðü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤(€€€€€€¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÁ…ÑÑ•É¸€ô€½x üë®.“²jÓ®†s®Ns²ó¶ÁqqÌ«®ÂS®†qqqÌ«ªÂªâÁó®.“²jÓ®†s®NqqqÌ«²ó¶ÁqqÌ«®ÂS®†qqqÌ«ªÂªâÀ¤¼ì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÐÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€½¹ÍÐ½¹ÑÉ½°€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰„°‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸t°ÍÁ…¸ˆ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôøÁ…ÑÑ•É¸¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ì(€€€€€¥˜€¡½¹ÑÉ½°¤ì(€€€€€€€½¹ÍÐÑ…É•Ð€ô½¹ÑÉ½°¹±½Í•ÍÐ ‰„°‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸tˆ¤ñð½¹ÑÉ½°ì(€€€€€€€Ñ…É•Ð¹ÍÉ½±±%¹Ñ½Y¥•Üü¸¡ì‰±½¬è€‰•¹Ñ•Èˆ°¥¹±¥¹”è€‰•¹Ñ•Èˆô¤ì(€€€€€€€Ñ…É•Ð¹™½ÕÌü¸ ¤ì(€€€€€€€™½È€¡½¹ÍÐÑåÁ”½˜l‰Á½¥¹Ñ•É‘½Ý¸ˆ°€‰µ½ÕÍ•‘½Ý¸ˆ°€‰Á½¥¹Ñ•ÉÕÀˆ°€‰µ½ÕÍ•ÕÀ‰t¤ì(€€€€€€€€€Ñ…É•Ð¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü5½ÕÍ•Ù•¹Ð¡ÑåÁ”°ì(€€€€€€€€€€€‰Õ‰‰±•ÌèÑÉÕ”°…¹•±…‰±”èÑÉÕ”°½µÁ½Í•èÑÉÕ”°Ù¥•ÜèÝ¥¹‘½Ü°‰ÕÑÑ½¸è€À°(€€€€€€€€€ô¤¤ì(€€€€€€€ô(€€€€€€€Ñ…É•Ð¹±¥¬ü¸ ¤ì(€€€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°±¥­•èÑÉÕ”°±…‰•°èÑ•áÑ=˜¡½¹ÑÉ½°¤ôì(€€€€€ô(€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€ô(€€€É•ÑÕÉ¸ì½¬è™…±Í”°±¥­•è™…±Í”°½‘”è€‰=]91=}9QI}M!=IQUQ}9=Q}=U9ˆôì(€ô¤ ¥€°ÑÉÕ”¤ì)ô()™Õ¹Ñ¥½¸µ½Ù•]¥¹‘½ÝÍÕÉÍ½É¹‘±¥¬¡ÍÉ••¹`°ÍÉ••¹d°¡½Ù•É•±…å5Ì€ô€À¤ì(€¥˜€¡ÁÉ½•ÍÌ¹Á±…Ñ™½É´€„ôô€‰Ý¥¸ÌÈˆ¤É•ÑÕÉ¸AÉ½µ¥Í”¹É•Í½±Ù”¡ì½¬è™…±Í”°É•…Í½¸è€‰]%9=]M}=91dˆô¤ì(€½¹ÍÐà€ô5…Ñ ¹É½Õ¹¡9Õµ‰•È¡ÍÉ••¹`¤¤ì(€½¹ÍÐä€ô5…Ñ ¹É½Õ¹¡9Õµ‰•È¡ÍÉ••¹d¤¤ì(€½¹ÍÐ¡½Ù•É•±…ä€ô5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ Í|ÀÀÀ°5…Ñ ¹É½Õ¹¡9Õµ‰•È¡¡½Ù•É•±…å5Ì¤ñð€À¤¤¤ì(€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡à¤ñð€…9Õµ‰•È¹¥Í¥¹¥Ñ”¡ä¤¤ì(€€€É•ÑÕÉ¸AÉ½µ¥Í”¹É•Í½±Ù”¡ì½¬è™…±Í”°É•…Í½¸è€‰%9Y1%}MI9}==I%9QLˆô¤ì(€ô(€½¹ÍÐÍÉ¥ÁÐ€ô€)‘µQåÁ” œ)ÕÍ¥¹œMåÍÑ•´ì)ÕÍ¥¹œMåÍÑ•´¹IÕ¹Ñ¥µ”¹%¹Ñ•É½ÁM•ÉÙ¥•Ìì)ÁÕ‰±¥ŒÍÑ…Ñ¥Œ±…ÍÌÉ½Õ¹‘ÕÉÍ½Èì(€mMÑÉÕÑ1…å½ÕÐ¡1…å½ÕÑ-¥¹¹M•ÅÕ•¹Ñ¥…°¥tÁÕ‰±¥ŒÍÑÉÕÐA=%9PìÁÕ‰±¥Œ¥¹Ð`ìÁÕ‰±¥Œ¥¹Ðdìô(€m±±%µÁ½ÉÐ ‰ÕÍ•ÈÌÈ¹‘±°ˆ¥tÁÕ‰±¥ŒÍÑ…Ñ¥Œ•áÑ•É¸‰½½°•ÑÕÉÍ½ÉA½Ì¡½ÕÐA=%9PÁ½¥¹Ð¤ì(€m±±%µÁ½ÉÐ ‰ÕÍ•ÈÌÈ¹‘±°ˆ¥tÁÕ‰±¥ŒÍÑ…Ñ¥Œ•áÑ•É¸‰½½°M•ÑÕÉÍ½ÉA½Ì¡¥¹Ðà°¥¹Ðä¤ì(€m±±%µÁ½ÉÐ ‰ÕÍ•ÈÌÈ¹‘±°ˆ¥tÁÕ‰±¥ŒÍÑ…Ñ¥Œ•áÑ•É¸Ù½¥µ½ÕÍ•}•Ù•¹Ð¡Õ¥¹Ð™±…Ì°Õ¥¹Ð‘à°Õ¥¹Ð‘ä°Õ¥¹Ð‘…Ñ„°U%¹ÑAÑÈ•áÑÉ…%¹™¼¤ì)ô( (‘Á½¥¹Ð€ô9•Üµ=‰©•ÐÉ½Õ¹‘ÕÉÍ½È­A=%9P)mÉ½Õ¹‘ÕÉÍ½Étèé•ÑÕÉÍ½ÉA½Ì¡mÉ•™t‘Á½¥¹Ð¤ð=ÕÐµ9Õ±°(‘ÍÑ…ÉÑ`€ô€‘Á½¥¹Ð¹`(‘ÍÑ…ÉÑd€ô€‘Á½¥¹Ð¹d(‘Ñ…É•Ñ`€ô€‘íáô(‘Ñ…É•Ñd€ô€‘íåô)™½È€ ‘ÍÑ•À€ô€Äì€‘ÍÑ•À€µ±”€Äàì€‘ÍÑ•À¬¬¤ì(€€‘¹•áÑ`€ôm5…Ñ¡tèéI½Õ¹ ‘ÍÑ…ÉÑ`€¬€  ‘Ñ…É•Ñ`€´€‘ÍÑ…ÉÑ`¤€¨€‘ÍÑ•À€¼€Äà¤¤(€€‘¹•áÑd€ôm5…Ñ¡tèéI½Õ¹ ‘ÍÑ…ÉÑd€¬€  ‘Ñ…É•Ñd€´€‘ÍÑ…ÉÑd¤€¨€‘ÍÑ•À€¼€Äà¤¤(€mÉ½Õ¹‘ÕÉÍ½ÉtèéM•ÑÕÉÍ½ÉA½Ì ‘¹•áÑ`°€‘¹•áÑd¤ð=ÕÐµ9Õ±°(€MÑ…ÉÐµM±••À€µ5¥±±¥Í•½¹‘Ì€ÄÔ)ô)MÑ…ÉÐµM±••À€µ5¥±±¥Í•½¹‘Ì€‘í¡½Ù•É•±…åô)mÉ½Õ¹‘ÕÉÍ½Étèéµ½ÕÍ•}•Ù•¹Ð È°€À°€À°€À°mU%¹ÑAÑÉtèéi•É¼¤)MÑ…ÉÐµM±••À€µ5¥±±¥Í•½¹‘Ì€ÜÀ)mÉ½Õ¹‘ÕÉÍ½Étèéµ½ÕÍ•}•Ù•¹Ð Ð°€À°€À°€À°mU%¹ÑAÑÉtèéi•É¼¤)€ì(€É•ÑÕÉ¸¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøì(€€€•á•¥±” ‰Á½Ý•ÉÍ¡•±°¹•á”ˆ°l(€€€€€€ˆµ9½AÉ½™¥±”ˆ°(€€€€€€ˆµ9½¹%¹Ñ•É…Ñ¥Ù”ˆ°(€€€€€€ˆµ]¥¹‘½ÝMÑå±”ˆ°€‰!¥‘‘•¸ˆ°(€€€€€€ˆµ½µµ…¹ˆ°ÍÉ¥ÁÐ°(€€€t°ìÝ¥¹‘½ÝÍ!¥‘”èÑÉÕ”°Ñ¥µ•½ÕÐè€Õ|ÀÀÀô°€¡•ÉÉ½È¤€ôøì(€€€€€É•Í½±Ù”¡•ÉÉ½È€üì½¬è™…±Í”°É•…Í½¸èMÑÉ¥¹œ¡•ÉÉ½È¹µ•ÍÍ…”ñð•ÉÉ½È¤ô€èì½¬èÑÉÕ”ô¤ì(€€€ô¤ì(€ô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Á¡åÍ¥…±±¥­M•±±•É±•µ•¹Ð¡Ñ…É•ÑÉ…µ”°±½…Ñ½ÉMÉ¥ÁÐ°ÍÑ•À°Ñ¥µ•½ÕÑ5Ì€ô€ÈÁ|ÀÀÀ¤ì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‘íÍÑ•Áõ}]%9=]}5%MM%9€ôì(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹™½ÕÌ ¤ì(€½¹ÍÐÍÑ…ÉÑ•‘Ð€ô…Ñ”¹¹½Ü ¤ì(€±•ÐÁ½¥¹Ð€ô¹Õ±°ì(€Ý¡¥±”€ …Á½¥¹Ð€˜˜…Ñ”¹¹½Ü ¤€´ÍÑ…ÉÑ•‘Ð€ðÑ¥µ•½ÕÑ5Ì¤ì(€€€Á½¥¹Ð€ô…Ý…¥ÐÑ…É•ÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€  ¤€ôøì(€€€€€€€¥˜€¡‘½Õµ•¹Ð¹É•…‘åMÑ…Ñ”€ôôô€‰±½…‘¥¹œˆ¤É•ÑÕÉ¸¹Õ±°ì(€€€€€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €ø€À(€€€€€€€€€€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹¡•¥¡Ð€ø€Àì(€€€€€€€½¹ÍÐÑ•áÑ=˜€ô€¡•±•µ•¹Ð¤€ôøMÑÉ¥¹œ¡•±•µ•¹Ðü¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ðü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤(€€€€€€€€€€¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€€€€€€€½¹ÍÐ•±•µ•¹Ð€ô€  ¤€ôøì€‘í±½…Ñ½ÉMÉ¥ÁÑôô¤ ¤ì(€€€€€€€¥˜€ …•±•µ•¹Ðñð€…Ù¥Í¥‰±”¡•±•µ•¹Ð¤¤É•ÑÕÉ¸¹Õ±°ì(€€€€€€€•±•µ•¹Ð¹ÍÉ½±±%¹Ñ½Y¥•Üü¸¡ì‰±½¬è€‰•¹Ñ•Èˆ°¥¹±¥¹”è€‰•¹Ñ•Èˆô¤ì(€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€àèÉ•Ð¹±•™Ð€¬É•Ð¹Ý¥‘Ñ €¼€È°(€€€€€€€€€äèÉ•Ð¹Ñ½À€¬É•Ð¹¡•¥¡Ð€¼€È°(€€€€€€€€€±…‰•°èÑ•áÑ=˜¡•±•µ•¹Ð¤°(€€€€€€€€€ÕÉ°è±½…Ñ¥½¸¹¡É•˜°(€€€€€€€ôì(€€€€€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø¹Õ±°¤ì(€€€¥˜€ …Á½¥¹Ð¤…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€ÈÔÀ¤¤ì(€ô(€¥˜€ …Á½¥¹Ð¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‘íÍÑ•Áõ}9=Q}=U9€ôì(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰µ½ÕÍ•5½Ù”ˆ°àèÁ½¥¹Ð¹à°äèÁ½¥¹Ð¹äô¤ì(€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€àÀ¤¤ì(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ì(€€€ÑåÁ”è€‰µ½ÕÍ•½Ý¸ˆ°‰ÕÑÑ½¸è€‰±•™Ðˆ°±¥­½Õ¹Ðè€Ä°àèÁ½¥¹Ð¹à°äèÁ½¥¹Ð¹ä°(€ô¤ì(€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€ÄÀÀ¤¤ì(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ì(€€€ÑåÁ”è€‰µ½ÕÍ•UÀˆ°‰ÕÑÑ½¸è€‰±•™Ðˆ°±¥­½Õ¹Ðè€Ä°àèÁ½¥¹Ð¹à°äèÁ½¥¹Ð¹ä°(€ô¤ì(€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€ÜÀÀ¤¤ì(€É•ÑÕÉ¸ì½¬èÑÉÕ”°ÍÑ•À°±…‰•°èÁ½¥¹Ð¹±…‰•°°ÕÉ°èÁ½¥¹Ð¹ÕÉ°°‰…­É½Õ¹‘%¹ÁÕÐèÑÉÕ”ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Á•É™½ÉµA¡åÍ¥…±M•±±•ÉM½ÉÑ¹‘áÁ½ÉÐ¡Ñ…É•ÑÉ…µ”¤ì(€½¹ÍÐÍ½ÉÐ€ô…Ý…¥ÐÁ¡åÍ¥…±±¥­M•±±•É±•µ•¹Ð¡Ñ…É•ÑÉ…µ”°€(€€€½¹ÍÐÁ…ÑÑ•É¸€ô€¿¶b²žqqÌ«¶2C®ž“²zAqqÌ«²ÖsªÞñqqÌ¨ÌÃ²vñqqÌ«¶2C®ž“®~$¼ì(€€€½¹ÍÐ±…‰•°€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰Ñ ±mÉ½±”ô½±Õµ¹¡•…‘•Èt±Ñ¡•…Ñ±Ñ¡•…‘¥Øˆ¥t(€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤¹™¥¹ ¡•±•µ•¹Ð¤€ôøÁ…ÑÑ•É¸¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ì(€€€¥˜€ …±…‰•°¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐ¡•…‘•È€ô±…‰•°¹±½Í•ÍÐ ‰Ñ ±mÉ½±”ô½±Õµ¹¡•…‘•Èt±Ñ¡•…Ñˆ¤ñð±…‰•°ì(€€€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ôl¸¸¹¡•…‘•È¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸t±m±…ÍÌ¨ôÍ½ÉÐt±ÍÙœ±¤ˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€É•ÑÕÉ¸…¹‘¥‘…Ñ•Ì¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹±•™Ð€´„¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹±•™Ð¥lÁt(€€€€€ñð¡•…‘•Èì(€€°€‰	-I=U9}1=1}M1M}M=IPˆ¤ì(€¥˜€ …Í½ÉÐ¹½¬¤É•ÑÕÉ¸Í½ÉÐì(€½¹ÍÐ‘•Í•¹‘¥¹œ€ô…Ý…¥ÐÁ¡åÍ¥…±±¥­M•±±•É±•µ•¹Ð¡Ñ…É•ÑÉ…µ”°€(€€€É•ÑÕÉ¸l¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸t±mÉ½±”ôµ•¹Õ¥Ñ•´t±±¤±ÍÁ…¸±‘¥Øˆ¥t(€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤¹™¥¹ ¡•±•µ•¹Ð¤€ôø€½{®
Ó®šó²Â£²"p¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ì(€€°€‰	-I=U9}M9%9ˆ¤ì(€¥˜€ …‘•Í•¹‘¥¹œ¹½¬¤É•ÑÕÉ¸‘•Í•¹‘¥¹œì(€½¹ÍÐ½¹™¥É´€ô…Ý…¥ÐÁ¡åÍ¥…±±¥­M•±±•É±•µ•¹Ð¡Ñ…É•ÑÉ…µ”°€(€€€½¹ÍÐ‘¥…±½Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰mÉ½±”ô‘¥…±½œt°¹…¹ÐµÁ½Á½Ù•È°¹…¹Ðµ‘É½Á‘½Ý¸°¹…¹Ðµµ½‘…°ˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€½¹ÍÐÉ½½Ð€ô‘¥…±½Ì¹…Ð ´Ä¤ñð‘½Õµ•¹Ðì(€€€É•ÑÕÉ¸l¸¸¹É½½Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸t±„±ÍÁ…¸ˆ¥t(€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤¹™¥¹ ¡•±•µ•¹Ð¤€ôø€½{¶fW²và¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ü¹±½Í•ÍÐ ‰‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸t±„ˆ¤ñð¹Õ±°ì(€€°€‰	-I=U9}M=IQ}=9%I4ˆ¤ì(€¥˜€ …½¹™¥É´¹½¬¤É•ÑÕÉ¸½¹™¥É´ì(€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€äÀÀ¤¤ì(€½¹ÍÐ•áÁ½ÉÑ±¥¬€ô…Ý…¥ÐÁ¡åÍ¥…±±¥­M•±±•É±•µ•¹Ð¡Ñ…É•ÑÉ…µ”°€(€€€É•ÑÕÉ¸l¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸t±„±ÍÁ…¸ˆ¥t(€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤¹™¥¹ ¡•±•µ•¹Ð¤€ôø€½{²‚²ÊÑqqÌ«®
Ó®ÎÓ®
ÓªâÀ¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ü¹±½Í•ÍÐ ‰‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸t±„ˆ¤ñð¹Õ±°ì(€€°€‰	-I=U9}aA=IPˆ¤ì(€É•ÑÕÉ¸•áÁ½ÉÑ±¥¬¹½¬€üì½¬èÑÉÕ”°Í½ÉÐè€‰1=1}M11I}I9Q|ÌÁ}eM}Mˆ°•áÁ½ÉÑ±¥­•èÑÉÕ”ô€è•áÁ½ÉÑ±¥¬ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸½¹™¥ÉµM•±±•ÉáÁ½ÉÑI•ÅÕ•ÍÑA¡åÍ¥…°¡Ñ…É•ÑÉ…µ”¤ì(€€¼¼A=%i=8Í½µ•Ñ¥µ•ÌÉ•Á±…•ÌÑ¡”½±½¹”µ‰ÕÑÑ½¸½¹™¥Éµ…Ñ¥½¸Ý¥Ñ „(€€¼¼½µÁ±•Ñ¥½¸Á½ÁÕÀ½¹Ñ…¥¹¥¹œ€‹®
c²’G²^@€¼ƒ®ÂS®†sªÂªâÀˆ¸%¸Ñ¡…Ð±…å½ÕÐ°(€€¼¼€‹®ÂS®†sªÂªâÀˆ‰½Ñ …­¹½Ý±•‘•ÌÑ¡”•áÁ½ÉÐ…¹½Á•¹Ì½Ý¹±½…•¹Ñ•È¸(€½¹ÍÐÍ¡½ÉÑÕÐ€ô…Ý…¥ÐÁ¡åÍ¥…±±¥­M•±±•É±•µ•¹Ð¡Ñ…É•ÑÉ…µ”°€(€€€½¹ÍÐ‘¥…±½Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€ˆ¹…¹Ðµµ½‘…°°¹…¹Ðµµ½‘…°µ½¹™¥É´±mÉ½±”ô‘¥…±½œt°¹…¹ÐµÁ½Á½Ù•È°¹…¹Ðµ‘É…Ý•È°¹Í•µ¤µµ½‘…°°¹Í•µ¤µÁ½ÉÑ…°ˆ(€€€€¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€½¹ÍÐ‘¥…±½œ€ô‘¥…±½Ì¹…Ð ´Ä¤ì(€€€¥˜€ …‘¥…±½œ¤É•ÑÕÉ¸¹Õ±°ì(€€€É•ÑÕÉ¸l¸¸¹‘¥…±½œ¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸t±„±ÍÁ…¸ˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôø€½x üë®ÂS®†qqÌ«ªÂªâÁó®.“²jÓ®†s®NqqÌ«²ó¶À¸«®ÂS®†qqÌ«ªÂªâÀ¤¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤(€€€€€€ü¹±½Í•ÍÐ ‰‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸t±„ˆ¤ñð¹Õ±°ì(€€°€‰A!eM%1}aA=IQ}=]91=}9QI}M!=IQUPˆ°€ÄÕ|ÀÀÀ¤ì(€¥˜€¡Í¡½ÉÑÕÐ¹½¬¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬èÑÉÕ”°(€€€€€½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•èÑÉÕ”°(€€€€€½¹™¥Éµ…Ñ¥½¹±¥­•èÑÉÕ”°(€€€€€É•ÅÕ•ÍÑ­¹½Ý±•‘•èÑÉÕ”°(€€€€€‘½Ý¹±½…‘•¹Ñ•É±¥­•èÑÉÕ”°(€€€ôì(€ô(€½¹ÍÐ±¥­•€ô…Ý…¥ÐÁ¡åÍ¥…±±¥­M•±±•É±•µ•¹Ð¡Ñ…É•ÑÉ…µ”°€(€€€½¹ÍÐ‘¥…±½Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€ˆ¹…¹Ðµµ½‘…°°¹…¹Ðµµ½‘…°µ½¹™¥É´±mÉ½±”ô‘¥…±½œt°¹…¹ÐµÁ½Á½Ù•È°¹…¹Ðµ‘É…Ý•È°¹Í•µ¤µµ½‘…°°¹Í•µ¤µÁ½ÉÑ…°ˆ(€€€€¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€½¹ÍÐ‘¥…±½œ€ô‘¥…±½Ì¹…Ð ´Ä¤ì(€€€¥˜€ …‘¥…±½œ¤É•ÑÕÉ¸¹Õ±°ì(€€€É•ÑÕÉ¸l¸¸¹‘¥…±½œ¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸t±„ˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôø€½x üë¶fW²váó®
Ó®ÎÓ®
ÓªâÁó²w²Åó¶fW²‚Uó²‚s²ÚqóªÎ²5óž†»¢º‘óž†»–ºióš>C’ê‘ó–¾ó–éóžîŸžî´¤¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ñð¹Õ±°ì(€€°€‰A!eM%1}aA=IQ}=9%I4ˆ°€ÄÕ|ÀÀÀ¤ì(€É•ÑÕÉ¸±¥­•¹½¬(€€€€üì½¬èÑÉÕ”°½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•èÑÉÕ”°½¹™¥Éµ…Ñ¥½¹±¥­•èÑÉÕ”°É•ÅÕ•ÍÑ­¹½Ý±•‘•èÑÉÕ”ô(€€€€èì½¬è™…±Í”°½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•è™…±Í”°½¹™¥Éµ…Ñ¥½¹±¥­•è™…±Í”°É•ÅÕ•ÍÑ­¹½Ý±•‘•è™…±Í”ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±¥­M•±±•É½Ý¹±½…‘•¹Ñ•ÉM¡½ÉÑÕÑA¡åÍ¥…°¡Ñ…É•ÑÉ…µ”¤ì(€½¹ÍÐµ…¥¹É…µ”€ôÍ•±±•É]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌü¹µ…¥¹É…µ”ì(€½¹ÍÐ™É…µ•Ì€ômµ…¥¹É…µ”°Ñ…É•ÑÉ…µ”°€¸¸¹Í•±±•É]¥¹‘½ÝÉ…µ•Ì ¥t(€€€€¹™¥±Ñ•È¡	½½±•…¸¤(€€€€¹™¥±Ñ•È ¡™É…µ”°¥¹‘•à°…±°¤€ôø(€€€€€…±°¹™¥¹‘%¹‘•à ¡…¹‘¥‘…Ñ”¤€ôø…¹‘¥‘…Ñ”¹É½ÕÑ¥¹%€ôôô™É…µ”¹É½ÕÑ¥¹%¤€ôôô¥¹‘•à(€€€€¤ì(€½¹ÍÐ±½…Ñ½È€ô€(€€€½¹ÍÐ½¹ÑÉ½±Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰„±‰ÕÑÑ½¸±mÉ½±”ô‰ÕÑÑ½¸tˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€É•ÑÕÉ¸½¹ÑÉ½±Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôøì(€€€€€½¹ÍÐ±…‰•°€ôÑ•áÑ=˜¡•±•µ•¹Ð¤ì(€€€€€½¹ÍÐ¡É•˜€ôMÑÉ¥¹œ¡•±•µ•¹Ð¹¡É•˜ñð•±•µ•¹Ð¹•ÑÑÑÉ¥‰ÕÑ”ü¸ ‰¡É•˜ˆ¤ñð€ˆˆ¤ì(€€€€€É•ÑÕÉ¸€½•áÁ½ÉÑ•¹Ñ•È½¤¹Ñ•ÍÐ¡¡É•˜¤(€€€€€€€ñð€½x üë®.“²jÓ®†s®NqqqÌ«²ó¶À¸¨ üë®ÂS®†qqqÌ«ªÂªâÁó²vÓ®>d¥ó®ÂS®†qqqÌ«ªÂªâÀ¤¼¹Ñ•ÍÐ¡±…‰•°¤ì(€€€ô¤ñð¹Õ±°ì(€€ì(€½¹ÍÐ‘•…‘±¥¹”€ô…Ñ”¹¹½Ü ¤€¬€ÌÁ|ÀÀÀì(€Ý¡¥±”€¡…Ñ”¹¹½Ü ¤€ð‘•…‘±¥¹”¤ì(€€€™½È€¡½¹ÍÐ™É…µ”½˜™É…µ•Ì¤ì(€€€€€½¹ÍÐ±¥­•€ô…Ý…¥ÐÁ¡åÍ¥…±±¥­M•±±•É±•µ•¹Ð (€€€€€€€™É…µ”°(€€€€€€€±½…Ñ½È°(€€€€€€€€‰A!eM%1}=]91=}9QHˆ°(€€€€€€€€ÜÀÀ°(€€€€€€¤ì(€€€€€¥˜€¡±¥­•¹½¬¤ì(€€€€€€€½¹ÍÐ¹…Ù¥…Ñ¥½¹•…‘±¥¹”€ô…Ñ”¹¹½Ü ¤€¬€ÄÁ|ÀÀÀì(€€€€€€€Ý¡¥±”€¡…Ñ”¹¹½Ü ¤€ð¹…Ù¥…Ñ¥½¹•…‘±¥¹”¤ì(€€€€€€€€€½¹ÍÐÕÉÉ•¹ÑUÉ°€ôMÑÉ¥¹œ¡Í•±±•É]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌü¹•ÑUI0ü¸ ¤ñð€ˆˆ¤ì(€€€€€€€€€¥˜€ ½p½µ…¥¹p½•áÁ½ÉÑ•¹Ñ•È üél¼üuð¤½¤¹Ñ•ÍÐ¡ÕÉÉ•¹ÑUÉ°¤¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°±¥­•èÑÉÕ”°¹…Ù¥…Ñ•èÑÉÕ”°ÕÉ°èÕÉÉ•¹ÑUÉ°ôì(€€€€€€€€€ô(€€€€€€€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€ÈÔÀ¤¤ì(€€€€€€€ô(€€€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°±¥­•èÑÉÕ”°¹…Ù¥…Ñ•è™…±Í”ôì(€€€€€ô(€€€ô(€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€ÌÀÀ¤¤ì(€ô(€É•ÑÕÉ¸ì½¬è™…±Í”°±¥­•è™…±Í”°½‘”è€‰=]91=}9QI}M!=IQUQ}9=Q}=U9ˆôì)ô(()…Íå¹Œ™Õ¹Ñ¥½¸ÑåÁ•M•±±•É	É…¹‘]¥Ñ¡I•…±-•å‰½…É¡Ñ…É•ÑÉ…µ”°‰É…¹‘9…µ”¤ì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰M11I}]%9=]}9=Q}Y%1	1ˆôì(€ô(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹™½ÕÌ ¤ì(€½¹ÍÐ™½ÕÍ•€ô…Ý…¥ÐÑ…É•ÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€  ¤€ôøì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €ø€À(€€€€€€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹¡•¥¡Ð€ø€Àì(€€€½¹ÍÐÑ•áÑ=˜€ô€¡•±•µ•¹Ð¤€ôøMÑÉ¥¹œ¡•±•µ•¹Ðü¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ðü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤(€€€€€€¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÍ•…É¡	ÕÑÑ½¸€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸tˆ¥t(€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôø€½{ªÊ²%qqÌ«®Â=qqÌ«²z²ÂÀ¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ì(€€€¥˜€ …Í•…É¡	ÕÑÑ½¸¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰aQ}MI!}	UQQ=9}9=Q}=U9ˆôì(€€€½¹ÍÐ‰ÕÑÑ½¹I•Ð€ôÍ•…É¡	ÕÑÑ½¸¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€½¹ÍÐ¥¹ÁÕÐ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÐ°Ñ•áÑ…É•„ˆ¥t(€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø€…•±•µ•¹Ð¹‘¥Í…‰±•€˜˜€…•±•µ•¹Ð¹É•…‘=¹±ä¤(€€€€€€¹µ…À ¡•±•µ•¹Ð¤€ôøì(€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€•±•µ•¹Ð°(€€€€€€€€€Ù•ÉÑ¥…±¥ÍÑ…¹”è5…Ñ ¹…‰Ì (€€€€€€€€€€€€¡É•Ð¹Ñ½À€¬É•Ð¹¡•¥¡Ð€¼€È¤€´€¡‰ÕÑÑ½¹I•Ð¹Ñ½À€¬‰ÕÑÑ½¹I•Ð¹¡•¥¡Ð€¼€È¤(€€€€€€€€€€¤°(€€€€€€€€€¡½É¥é½¹Ñ…±…Àè‰ÕÑÑ½¹I•Ð¹±•™Ð€´É•Ð¹É¥¡Ð°(€€€€€€€ôì(€€€€€ô¤(€€€€€€¹™¥±Ñ•È ¡…¹‘¥‘…Ñ”¤€ôø…¹‘¥‘…Ñ”¹Ù•ÉÑ¥…±¥ÍÑ…¹”€ð€ÈÐ(€€€€€€€€˜˜…¹‘¥‘…Ñ”¹¡½É¥é½¹Ñ…±…À€øô€´Ð€˜˜…¹‘¥‘…Ñ”¹¡½É¥é½¹Ñ…±…À€ð€àÀ¤(€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø±•™Ð¹¡½É¥é½¹Ñ…±…À€´É¥¡Ð¹¡½É¥é½¹Ñ…±…À¥lÁtü¹•±•µ•¹Ðì(€€€¥˜€ …¥¹ÁÕÐ¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰aQ}MI!}%9AUQ}9=Q}=U9ˆôì(€€€¥¹ÁÕÐ¹ÍÉ½±±%¹Ñ½Y¥•Ü¡ì‰±½¬è€‰•¹Ñ•Èˆ°¥¹±¥¹”è€‰•¹Ñ•Èˆô¤ì(€€€¥¹ÁÕÐ¹™½ÕÌ ¤ì(€€€¥¹ÁÕÐ¹Í•±•Ðü¸ ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬èÑÉÕ”°(€€€€€Í•…É¡`è5…Ñ ¹É½Õ¹¡‰ÕÑÑ½¹I•Ð¹±•™Ð€¬‰ÕÑÑ½¹I•Ð¹Ý¥‘Ñ €¼€È¤°(€€€€€Í•…É¡dè5…Ñ ¹É½Õ¹¡‰ÕÑÑ½¹I•Ð¹Ñ½À€¬‰ÕÑÑ½¹I•Ð¹¡•¥¡Ð€¼€È¤°(€€€ôì(€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø€¡ì½¬è™…±Í”°ÍÑ•Àè€‰-e	=I}=UM}%1ˆô¤¤ì(€¥˜€ …™½ÕÍ•ü¹½¬ñð€…Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤É•ÑÕÉ¸™½ÕÍ•ì(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰­•å½Ý¸ˆ°­•å½‘”è€‰ˆ°µ½‘¥™¥•ÉÌèl‰½¹ÑÉ½°‰tô¤ì(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰­•åUÀˆ°­•å½‘”è€‰ˆ°µ½‘¥™¥•ÉÌèl‰½¹ÑÉ½°‰tô¤ì(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰­•å½Ý¸ˆ°­•å½‘”è€‰	…­ÍÁ…”ˆô¤ì(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰­•åUÀˆ°­•å½‘”è€‰	…­ÍÁ…”ˆô¤ì(€€¼¼±•ÑÉ½¸…¸±•…Ù”¥¹Í•ÉÑQ•áÐÌÉ•ÑÕÉ¹•ÁÉ½µ¥Í”Á•¹‘¥¹œÝ¡¥±”„Ý•ˆÁ…”(€€¼¼¥ÌÁÉ½•ÍÍ¥¹œ™½ÕÌ¸M•¹¥ÐÝ¥Ñ¡½ÕÐ…Ý…¥Ñ¥¹œ…¹Ù•É¥™äÑ¡”Ù¥Í¥‰±”Ù…±Õ”(€€¼¼½¸„™¥á•‘•…‘±¥¹”¥¹ÍÑ•…½˜‰±½­¥¹œÑ¡”•¹Ñ¥É”‰É…¹ÅÕ•Õ”™½É•Ù•È¸(€Ù½¥Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹¥¹Í•ÉÑQ•áÐ¡MÑÉ¥¹œ¡‰É…¹‘9…µ”¤¤ì(€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€ÄÈÀÀ¤¤ì(€½¹ÍÐÙ•É¥™¥•€ô…Ý…¥ÐAÉ½µ¥Í”¹É…”¡l(€€€Ñ…É•ÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€  ¤€ôøì(€€€½¹ÍÐ…Ñ¥Ù”€ô‘½Õµ•¹Ð¹…Ñ¥Ù•±•µ•¹Ðì(€€€½¹ÍÐÙ…±Õ”€ôMÑÉ¥¹œ¡…Ñ¥Ù”ü¹Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬èÙ…±Õ”€ôôô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡MÑÉ¥¹œ¡‰É…¹‘9…µ”¤¥ô°(€€€€€ÍÑ•ÀèÙ…±Õ”€ôôô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡MÑÉ¥¹œ¡‰É…¹‘9…µ”¤¥ô€ü€‰I1}-e	=I}%9AUQ}=9%I5ˆ€è€‰I1}-e	=I}%9AUQ}%1ˆ°(€€€€€¥¹ÁÕÑY…±Õ”èÙ…±Õ”°(€€€ôì(€€€ô¤ ¥€°ÑÉÕ”¤°(€€€¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ  ¤€ôøÉ•Í½±Ù”¡ì(€€€€€½¬è™…±Í”°(€€€€€ÍÑ•Àè€‰I1}-e	=I}%9AUQ}YI%e}Q%5=UPˆ°(€€€ô¤°€Í|ÀÀÀ¤¤°(€t¤¹…Ñ   ¤€ôø€¡ì½¬è™…±Í”°ÍÑ•Àè€‰I1}-e	=I}%9AUQ}YI%e}%1ˆô¤¤ì(€¥˜€ …Ù•É¥™¥•ü¹½¬ñð€…Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤É•ÑÕÉ¸Ù•É¥™¥•ì(€½¹ÍÐà€ô9Õµ‰•È¡™½ÕÍ•¹Í•…É¡`¤ì(€½¹ÍÐä€ô9Õµ‰•È¡™½ÕÍ•¹Í•…É¡d¤ì(€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡à¤ñð€…9Õµ‰•È¹¥Í¥¹¥Ñ”¡ä¤¤ì(€€€É•ÑÕÉ¸ì€¸¸¹Ù•É¥™¥•°½¬è™…±Í”°ÍÑ•Àè€‰I1}MI!}	UQQ=9}==I%9QM}5%MM%9ˆôì(€ô(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰µ½ÕÍ•5½Ù”ˆ°à°äô¤ì(€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€àÀ¤¤ì(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰µ½ÕÍ•½Ý¸ˆ°‰ÕÑÑ½¸è€‰±•™Ðˆ°±¥­½Õ¹Ðè€Ä°à°äô¤ì(€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€ÄÀÀ¤¤ì(€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰µ½ÕÍ•UÀˆ°‰ÕÑÑ½¸è€‰±•™Ðˆ°±¥­½Õ¹Ðè€Ä°à°äô¤ì(€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€Å|ÔÀÀ¤¤ì(€É•ÑÕÉ¸ì(€€€€¸¸¹Ù•É¥™¥•°(€€€ÍÕ‰µ¥ÑÑ•èÑÉÕ”°(€€€‰…­É½Õ¹‘%¹ÁÕÐèÑÉÕ”°(€€€‰…­É½Õ¹èÑÉÕ”°(€€€ÍÑ•Àè€‰	-I=U9}MI!}	UQQ=9}1%-ˆ°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸…ÁÁ±åá…ÑM•±±•É	É…¹‘¥±Ñ•È¡Ñ…É•ÑÉ…µ”°¹…µ•Ì€ômt¤ì(€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ôl¸¸¹¹•ÜM•Ð ¡¹…µ•Ìñðmt¤¹µ…À ¡Ù…±Õ”¤€ôøMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤¤¹™¥±Ñ•È¡	½½±•…¸¤¥tì(€¥˜€ ……¹‘¥‘…Ñ•Ì¹±•¹Ñ ¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰	I9}%1QI}95M}5%MM%9ˆôì(€É•ÑÕÉ¸•á•ÕÑ•M•±±•ÉÉ…µ•]¥Ñ¡Q¥µ•½ÕÐ¡Ñ…É•ÑÉ…µ”°€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐÑ•áÑ=˜€ô€¡•±•µ•¹Ð¤€ôøMÑÉ¥¹œ¡•±•µ•¹Ðü¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ðü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤(€€€€€€¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ¹½Éµ…±¥é”€ô€¡Ù…±Õ”¤€ôøMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹¹½Éµ…±¥é” ‰9-ˆ¤(€€€€€€¹É•Á±…” ½my„µèÀ´çªÂ ·¶z’â ·¦ú•t¬½¤°€ˆˆ¤¹Ñ½1½…±•1½Ý•É…Í” ¤ì(€€€½¹ÍÐ¹…µ•Ì€ô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡…¹‘¥‘…Ñ•Ì¥ôì(€€€½¹ÍÐ¹½Éµ…±¥é•‘9…µ•Ì€ô¹…µ•Ì¹µ…À¡¹½Éµ…±¥é”¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€½¹ÍÐ½Ý¹Q•áÐ€ô€¡•±•µ•¹Ð¤€ôøl¸¸¹•±•µ•¹Ð¹¡¥±‘9½‘•Ít(€€€€€€¹™¥±Ñ•È ¡¹½‘”¤€ôø¹½‘”¹¹½‘•QåÁ”€ôôô9½‘”¹QaQ}9=¤(€€€€€€¹µ…À ¡¹½‘”¤€ôø¹½‘”¹Ñ•áÑ½¹Ñ•¹Ð¤¹©½¥¸ ˆˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ‰É…¹‘1…‰•°€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹t±±…‰•°±ÍÁ…¸±‘¥Øˆ¥t(€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø½Ý¹Q•áÐ¡•±•µ•¹Ð¤€ôôô€‹®â3®zs®NpˆñðÑ•áÑ=˜¡•±•µ•¹Ð¤€ôôô€‹®â3®zs®Npˆ¤(€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø±•™Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €´É¥¡Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ ¥lÁtì(€€€½¹ÍÐ‰É…¹‘	ÕÑÑ½¸€ô‰É…¹‘1…‰•°ü¹±½Í•ÍÐ (€€€€€€‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹t°¹…¹ÐµÍ•±•Ð°¹…¹Ðµ‘É½Á‘½Ý¸µÑÉ¥•È°¹Í•µ¤µÍ•±•Ð°¹Í•µ¤µ‘É½Á‘½Ý¸µÑÉ¥•Èˆ(€€€€¤ñð‰É…¹‘1…‰•°ì(€€€¥˜€ …‰É…¹‘	ÕÑÑ½¸¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰aQ}	I9}	UQQ=9}9=Q}=U9ˆôì(€€€‰É…¹‘	ÕÑÑ½¸¹±¥¬ ¤ì(€€€…Ý…¥ÐÝ…¥Ð ØÀÀ¤ì(€€€½¹ÍÐÁ½ÁÕÁM•±•Ñ½È€ô€mÉ½±”ô‰Ñ½½±Ñ¥À‰t±mÉ½±”ô‰‘¥…±½œ‰t°¹…¹ÐµÁ½Á½Ù•È°¹…¹Ðµ‘É½Á‘½Ý¸°¹…¹ÐµÍ•±•Ðµ‘É½Á‘½Ý¸°¹Í•µ¤µÁ½ÉÑ…°°¹Í•µ¤µÁ½Á½Ù•È°¹Í•µ¤µÍ•±•Ðµ‘É½Á‘½Ý¸œì(€€€½¹ÍÐÁ½ÁÕÀ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±°¡Á½ÁÕÁM•±•Ñ½È¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤¹…Ð ´Ä¤ì(€€€¥˜€ …Á½ÁÕÀ¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰aQ}	I9}A=AUA}9=Q}=U9ˆôì(€€€½¹ÍÐ¥¹ÁÕÐ€ôl¸¸¹Á½ÁÕÀ¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÐˆ¥t¹™¥¹ ¡•±•µ•¹Ð¤€ôø(€€€€€Ù¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜€…•±•µ•¹Ð¹‘¥Í…‰±•€˜˜l‰Ñ•áÐˆ°€‰Í•…É ˆ°€ˆ‰t¹¥¹±Õ‘•Ì¡•±•µ•¹Ð¹ÑåÁ”¤(€€€€¤ì(€€€½¹ÍÐÍ•ÑÑ•È€ô=‰©•Ð¹•Ñ=Ý¹AÉ½Á•ÉÑå•ÍÉ¥ÁÑ½È¡!Q51%¹ÁÕÑ±•µ•¹Ð¹ÁÉ½Ñ½ÑåÁ”°€‰Ù…±Õ”ˆ¤ü¹Í•Ðì(€€€™½È€¡½¹ÍÐ¹…µ”½˜¹…µ•Ì¤ì(€€€€€¥˜€¡¥¹ÁÕÐ¤ì(€€€€€€€¥¹ÁÕÐ¹™½ÕÌ ¤ì(€€€€€€€Í•ÑÑ•È€üÍ•ÑÑ•È¹…±°¡¥¹ÁÕÐ°¹…µ”¤€è€¡¥¹ÁÕÐ¹Ù…±Õ”€ô¹…µ”¤ì(€€€€€€€¥¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü%¹ÁÕÑÙ•¹Ð ‰¥¹ÁÕÐˆ°ì‰Õ‰‰±•ÌèÑÉÕ”°‘…Ñ„è¹…µ”°¥¹ÁÕÑQåÁ”è€‰¥¹Í•ÉÑQ•áÐˆô¤¤ì(€€€€€€€¥¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ‰¡…¹”ˆ°ì‰Õ‰‰±•ÌèÑÉÕ”ô¤¤ì(€€€€€ô(€€€€€±•Ð½ÁÑ¥½¸€ô¹Õ±°ì(€€€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÈÐ€˜˜€…½ÁÑ¥½¸ì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€€€½¹ÍÐ½ÁÑ¥½¹Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€€€€€œ¹…¹ÐµÁ½Á½Ù•Èé¹½Ð ¹…¹ÐµÁ½Á½Ù•Èµ¡¥‘‘•¸¤±¤¹…¹Ðµ±¥ÍÐµ¥Ñ•´±mÉ½±”õ½ÁÑ¥½¹t°¹…¹ÐµÍ•±•Ðµ¥Ñ•´µ½ÁÑ¥½¸°¹Í•µ¤µÍ•±•Ðµ½ÁÑ¥½¸œ(€€€€€€€€¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€€€½ÁÑ¥½¸€ô½ÁÑ¥½¹Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôøì(€€€€€€€€€½¹ÍÐÙ…±Õ”€ô¹½Éµ…±¥é”¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤ì(€€€€€€€€€½¹ÍÐÉ•ÅÕ•ÍÑ•€ô¹½Éµ…±¥é”¡¹…µ”¤ì(€€€€€€€€€€¼¼¼¹½Ð…±±½Ü„Á…É•¹Ð‰É…¹Ñ¼Í¥±•¹Ñ±äÍ•±•Ð„¡¥±‰É…¹¸(€€€€€€€€€€¼¼%¸Á…ÉÑ¥Õ±…È°€‰AU5ˆµÕÍÐ¹½Ðµ…Ñ €‰AU5-%Lˆµ•É•±ä‰•…ÕÍ”(€€€€€€€€€€¼¼Ñ¡”½ÁÑ¥½¸Ñ•áÐÍÑ…ÉÑÌÝ¥Ñ Ñ¡”É•ÅÕ•ÍÑ•Ù…±Õ”¸(€€€€€€€€€É•ÑÕÉ¸Ù…±Õ”€ôôôÉ•ÅÕ•ÍÑ•ì(€€€€€€€ô¤ì(€€€€€ô(€€€€€¥˜€ …½ÁÑ¥½¸¤½¹Ñ¥¹Õ”ì(€€€€€½ÁÑ¥½¸¹±¥¬ ¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÌÔÀ¤ì(€€€€€½¹ÍÐ½¹™¥É´€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹t±„ˆ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤¹™¥¹ ¡•±•µ•¹Ð¤€ôø€½x£¶fW²váó²‚²j¥óªÊ²$¤¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ì(€€€€€¥˜€¡½¹™¥É´¤½¹™¥É´¹±¥¬ ¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÜÀÀ¤ì(€€€€€½¹ÍÐÍ•…É €ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹tˆ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤¹™¥¹ ¡•±•µ•¹Ð¤€ôø€½{ªÊ²%qqÌ«®Â=qqÌ«²z²ÂÀ¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ì(€€€€€¥˜€ …Í•…É ¤É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰aQ}	I9}MI!}	UQQ=9}9=Q}=U9ˆôì(€€€€€Í•…É ¹±¥¬ ¤ì(€€€€€±•ÐÍÑ…‰±”€ô€Àì(€€€€€±•ÐÍ¥¹…ÑÕÉ”€ô€ˆˆì(€€€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€àÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€€€½¹ÍÐÉ½ÝÌ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰Ñ‰½‘äÑÈˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€€€¹µ…À¡Ñ•áÑ=˜¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€€€€€½¹ÍÐµ…Ñ¡•€ôÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôø¹½Éµ…±¥é•‘9…µ•Ì¹Í½µ” ¡­•ä¤€ôø¹½Éµ…±¥é”¡É½Ü¤¹¥¹±Õ‘•Ì¡­•ä¤¤¤ì(€€€€€€€½¹ÍÐ¹•áÑM¥¹…ÑÕÉ”€ôÉ½ÝÌ¹Í±¥” À°€ÈÀ¤¹©½¥¸ ‰ðˆ¤ì(€€€€€€€¥˜€¡É½ÝÌ¹±•¹Ñ €˜˜µ…Ñ¡•¹±•¹Ñ €¼É½ÝÌ¹±•¹Ñ €øô€À¸à¤ì(€€€€€€€€€ÍÑ…‰±”€ô¹•áÑM¥¹…ÑÕÉ”€ôôôÍ¥¹…ÑÕÉ”€üÍÑ…‰±”€¬€Ä€è€Äì(€€€€€€€€€Í¥¹…ÑÕÉ”€ô¹•áÑM¥¹…ÑÕÉ”ì(€€€€€€€€€¥˜€¡ÍÑ…‰±”€øô€Ì¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€½¬èÑÉÕ”°(€€€€€€€€€€€€€É½ÕÑ”è€‰aQ}	I9}%1QHˆ°(€€€€€€€€€€€€€Í•±•Ñ•èÑ•áÑ=˜¡½ÁÑ¥½¸¤°(€€€€€€€€€€€€€¥¹ÁÕÑY…±Õ”è¹…µ”°(€€€€€€€€€€€€€É•ÍÕ±ÑI½Ý½Õ¹ÐèÉ½ÝÌ¹±•¹Ñ °(€€€€€€€€€€€€€™¥ÉÍÑI•ÍÕ±ÐèÉ½ÝÍlÁtñð€ˆˆ°(€€€€€€€€€€€ôì(€€€€€€€€€ô(€€€€€€€ô•±Í”ì(€€€€€€€€€ÍÑ…‰±”€ô€Àì(€€€€€€€€€Í¥¹…ÑÕÉ”€ô€ˆˆì(€€€€€€€ô(€€€€€ô(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰aQ}	I9}IMU1Q}9=Q}=9%I5ˆ°Í•±•Ñ•èÑ•áÑ=˜¡½ÁÑ¥½¸¤ôì(€€€ô(€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰aQ}	I9}=AQ%=9}9=Q}=U9ˆôì(€ô¤ ¥€°€ÌÕ|ÀÀÀ°ì½¬è™…±Í”°ÍÑ•Àè€‰aQ}	I9}%1QI}Q%5=UPˆô¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸…ÕÑ½µ…Ñ•M•±±•É	É…¹‘áÁ½ÉÐ¡¥¹ÁÕÐ€ôíô¤ì(€½¹ÍÐÍ•ÍÍ¥½¹•¹•É…Ñ¥½¸€ô‰É…¹‘]½É­M•ÍÍ¥½¹•¹•É…Ñ¥½¸ì(€½¹ÍÐ…ÑÑ•µÁÑ•¹•É…Ñ¥½¸€ô€¬­‰É…¹‘áÁ½ÉÑÑÑ•µÁÑ•¹•É…Ñ¥½¸ì(€½¹ÍÐ±•…É•€ô€ ¤€ôøÍ•ÍÍ¥½¹•¹•É…Ñ¥½¸€„ôô‰É…¹‘]½É­M•ÍÍ¥½¹•¹•É…Ñ¥½¸(€€€ñð…ÑÑ•µÁÑ•¹•É…Ñ¥½¸€„ôô‰É…¹‘áÁ½ÉÑÑÑ•µÁÑ•¹•É…Ñ¥½¸ì(€½¹ÍÐ‰É…¹‘9…µ”€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹‰É…¹‘9…µ”ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐ‰É…¹‘-¼€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹‰É…¹‘-¼ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€¥˜€¡‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€½‘”è€‰aA=IQ}1Ie}A9%9ˆ°(€€€€€µ•ÍÍ…”è€‹²vÓ®¾àA=%i=8ƒ®6Ã²vÓ¶Ã®–ðƒªÂ²‚ã²b“ªÎ€ƒ²z#²*×®.#®.¸ƒªÂg²v ƒ²zG²^²vƒ®.“².pƒ®ž3®N“²ž ƒ²V+²*×®.#®.¸ˆ°(€€€ôì(€ô(€¥˜€ …‰É…¹‘9…µ”¤É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹²ƒ¶w¶Vpƒ®â3®zs®Ns®ª²vÐƒ²^²*×®.#®.¸ˆôì(€½¹ÍÐ½™™¥¥…±Õ‘¥ÑA…ÕÍ•€ôÁ…ÕÍ•=™™¥¥…±½µ…¥¹Õ‘¥Ñ½ÉM•±±•ÉÕÑ½µ…Ñ¥½¸ ¤ì(€¥˜€¡½™™¥¥…±Õ‘¥ÑA…ÕÍ•¤ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€€€ÍÑ…ÑÕÌè€‰½™™¥¥…°µ…Õ‘¥ÐµÁ…ÕÍ•µ™½ÈµÍ•±±•Èˆ°(€€€€€‰É…¹‘9…µ”°(€€€€€©½‰MÑ…Ñ”è€ˆÇ®.£ªÎ¼Ôƒ
ÜƒªÎ×².w®ªÀƒªÊ²štƒ®Ú®š°ƒ
Üƒ¶2C®ž“²zC²ó¶Àƒ²^ÃªÊÀƒ²’®æˆ°(€€€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
ÜƒªÎ×².w®ªÀƒ²‚²ÊÐƒªÊ²šw²vƒ®¦#²ÚSªÎ€A=%i=8ƒ®â3®zs®NpƒªÊ²'²vƒ²jÃ²€ƒ².“¶Z'¶V§®.#®.¸ƒªÊ²štƒªâÃ®†w²v ƒ²rƒ²ž®Bc®¦ÀƒªÊ²štƒªÎ²4ƒ®Ê¶*ó²vƒ®"®–ðƒ®V3®ž0ƒ²z³ªÂs®B§®.#®.¹€°(€€€ô¤ì(€ô(€½¹ÍÐ™½±‘•È€ôÕÉÉ•¹Ñ	É…¹‘áÁ½ÉÑ½±‘•È ¤ì(€…Ý…¥Ðµ­‘¥È¡™½±‘•È°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô‰É…¹‘9…µ”ì(€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ô€ˆˆì(€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ôÑÉÕ”ì(€‰É…¹‘½Ý¹±½…‘MÑ…ÉÑ•€ô™…±Í”ì(€€¼¼-••ÀM•±±•È•¹Ñ•È½™˜µÍÉ••¸Ý¡¥±”¥ÑÌÉ•¹‘•É•ÈÁ•É™½ÉµÌÑ¡”Ý½É¬¸Q¡”(€€¼¼Á•ÉÍ¥ÍÑ•¹ÐÍ•ÍÍ¥½¸…¹Ù¥•ÝÁ½ÉÐÉ•µ…¥¸…Ñ¥Ù”‰•…ÕÍ”‰…­É½Õ¹Ñ¡É½ÑÑ±¥¹œ(€€¼¼¥Ì‘¥Í…‰±•½¸Ñ¡¥Ì	É½ÝÍ•É]¥¹‘½Ü¸(€½Á•¹M•±±•É•¹Ñ•É]¥¹‘½Ü¡M11I}9QI}UI0°ì(€€€Ù¥Í¥‰±”è™…±Í”°(€€€…Ñ¥Ù…Ñ”è™…±Í”°(€€€‘•™•É9…Ù¥…Ñ¥½¸èÑÉÕ”°(€ô¤ì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹¶2C®ž“²zC²ó¶Àƒ²Â÷²vƒ²^Ó²ž ƒ®ªï¶Z#²*×®.#®.¸ˆôì(€ô(€½¹ÍÐ‰…Í•±¥¹•AÉ½µ¥Í”€ôÉ•…‘M•±±•ÉáÁ½ÉÑ	…Í•±¥¹•M•Á…É…Ñ•±ä ¤¹…Ñ   ¤€ôø¹Õ±°¤ì(€¥˜€¡±•…É• ¤¤É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰]=I-}1Iˆ°µ•ÍÍ…”è€‹²zG²^ƒªâÃ®†tƒ²
·²‚s®†pƒ²vÓ²‚ƒ²jS²Ê·²vƒ²’G®.£¶Z#²*×®.#®.¸ˆôì(€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€ÍÑ…ÑÕÌè€‰½Á•¹¥¹œµÁÉ½‘ÕÐµÍ•…É ˆ°(€€€‰É…¹‘9…µ”°(€€€©½‰MÑ…Ñ”è€ˆÇ®.£ªÎ¼Ôƒ
Üƒ¶2C®ž“²zC²ó¶Àƒ²^ÃªÊÀƒ².s®>ˆ°(€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
Üƒ¶2C®ž“²zC²ó¶Àƒ²¶J#ªÊ²$ƒ¶fS®¦Ðƒ²^ÃªÊÃ²vƒ².s®>¶V§®.#®.¹€°(€ô¤ì(€ÑÉäì(€€€€¼¼MÑ…ÉÐ™É½´Ñ¡”­¹½Ý¸Ý½É­¥¹œM•±±•È•¹Ñ•È‘…Ñ„Á…”Ý¡•É”Ñ¡”±•™Ðµ•¹Ô(€€€€¼¼¥ÌÉ•¹‘•É•¸Q¡”‰…É”€½µ…¥¸É½ÕÑ”¥ÑÍ•±˜É•ÑÕÉ¹Ì½µÁ½¹•¹Ð-•äÉÉ½È¸(€€€…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹±½…‘UI0¡M11I}9QI}UI0¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€½¹ÍÐ‘¥…¹½ÍÑ¥A…Ñ €ô…Ý…¥Ð…ÁÑÕÉ•M•±±•É¥…¹½ÍÑ¥Œ¡‰É…¹‘9…µ”°€‰Á…”µ±½…µ™…¥±•ˆ¤ì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€½‘”è€‰M11I}A}1=}%1ˆ°(€€€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ¶2C®ž“²zC²ó¶Àƒ²¶J#ªÊ²$ƒ¶:c²vÓ²ž ƒ²^ÃªÊÃ²^@ƒ².“¶2£¶Z#²*×®.#®.¸‘í‘¥…¹½ÍÑ¥A…Ñ €ü€ƒ²ž®. ƒ¶fS®¦Ðè€‘í‘¥…¹½ÍÑ¥A…Ñ¡õ€€è€ˆ‰õ€°(€€€€€‘¥…¹½ÍÑ¥ÌèìÉ•…Í½¸èMÑÉ¥¹œ¡•ÉÉ½Èü¹µ•ÍÍ…”ñð•ÉÉ½Èñð€ˆˆ¤°Á…Ñ è‘¥…¹½ÍÑ¥A…Ñ ô°(€€€ôì(€ô(€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€Í|ÔÀÀ¤¤ì(€½¹ÍÐ±½¥¸€ô…Ý…¥Ð•¹ÍÕÉ•M•±±•É1½¥¹	•™½É•	É…¹‘M•…É ¡‰É…¹‘9…µ”¤ì(€¥˜€ …±½¥¸¹½¬¤ì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€½‘”è±½¥¸¹½‘”ñð€‰M11I}1=%9}IEU%Iˆ°(€€€€€µ•ÍÍ…”è±½¥¸¹½‘”€ôôô€‰M11I}1=%9}Q%5=UPˆ(€€€€€€€€ü€‘í‰É…¹‘9…µ•ôƒ
Ü€ÄÃ®Úƒ®>g²V ƒ®†sªÞã²vã²vÐƒ¶fW²vã®Bc²ž ƒ²V+²Vƒ²zG²^²vƒ²’G®.£¶Z#²*×®.#®.¹€(€€€€€€€€è€‘í‰É…¹‘9…µ•ôƒ
ÜA=%i=8ƒ®†sªÞã²vàƒ²Â÷²vÐƒ®.¯¶b ƒ²zG²^²vƒ²’G®.£¶Z#²*×®.#®.¹€°(€€€ôì(€ô(€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€ÍÑ…ÑÕÌè€‰Í•±±•ÈµÁÉ½‘ÕÐµµ•¹Ôµ±¥­¥¹œˆ°(€€€‰É…¹‘9…µ”°(€€€©½‰MÑ…Ñ”è€ˆÇ®.£ªÎ¼Ôƒ
Üƒ¶2C®ž“²zC²ó¶Àƒ²¶J ƒ®¦S®&Ðƒ¶Ó®š´ƒ²’Dˆ°(€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
Üƒ¶2C®ž“²zC²ó¶Àƒ²‚W²ƒ®6Ã²vÓ¶Àƒ¶fS®¦Ó²^C²pƒ²¶J ƒŠHƒ²¶J ƒªÊ²'²vƒ².“²‚pƒ®ž#²jÃ²*“®†pƒ¶Ó®š·¶V§®.#®.¹€°(€ô¤ì(€€¼¼Q¡”±½¥¸ÍÕ•ÍÌÁ…”…±É•…‘ä½Ý¹ÌÑ¡”Ù…±¥M•±±•È•¹Ñ•ÈÍ•ÍÍ¥½¸¸(€€¼¼½¹Ñ¥¹Õ”¥¸Ñ¡…ÐÁ…”…¹É•ÍÑ½É”Ñ¡”½±Á¡åÍ¥…°µ•¹Ôµ±¥¬Ý½É­™±½Ü¸(€½¹ÍÐÁÉ½‘ÕÑM•…É¡=Á•¹•€ô…Ý…¥Ð•¹Ñ•ÉM•±±•ÉAÉ½‘ÕÑM•…É¡Y¥…5•¹Ô ¤ì(€¥˜€ …ÁÉ½‘ÕÑM•…É¡=Á•¹•¤ì(€€€½¹ÍÐÁ…•MÑ…Ñ”€ô…Ý…¥ÐÍ•±±•ÉAÉ½‘ÕÑM•…É¡A…•MÑ…Ñ” ¤ì(€€€½¹ÍÐ‘¥…¹½ÍÑ¥A…Ñ €ô…Ý…¥Ð…ÁÑÕÉ•M•±±•É¥…¹½ÍÑ¥Œ¡‰É…¹‘9…µ”°€‰Á¡åÍ¥…°µÁÉ½‘ÕÐµµ•¹Ôµ™…¥±•ˆ¤ì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€½‘”èÁ…•MÑ…Ñ”¹™…¥±•€ü€‰M11I}=5A=99Q}1=}Q%5=UPˆ€è€‰M11I}AI=UQ}59U}1%-}%1ˆ°(€€€€€µ•ÍÍ…”èÁ…•MÑ…Ñ”¹™…¥±•(€€€€€€€€ü€‘í‰É…¹‘9…µ•ôƒ
Üƒ®¦S®&Ðƒ¶Ó®š´ƒ¶nA=%i=8ƒ²¶J#ªÊ²$ƒªÖ³²Ç²jS²3ªÂ ƒ²^Ó®š³²ž ƒ²V+²Vc²*×®.#®.¹€(€€€€€€€€è€‘í‰É…¹‘9…µ•ôƒ
Üƒ¶2C®ž“²zC²ó¶Ã²v`ƒ²¶J ƒŠHƒ²¶J ƒªÊ²$ƒ®¦S®&Ó®–ðƒ².“²‚pƒ®ž#²jÃ²*“®†pƒ¶Ó®š·¶Vc²ž ƒ®ªï¶Z#²*×®.#®.¹€°(€€€€€‘¥…¹½ÍÑ¥ÌèìÕÉ°èÁ…•MÑ…Ñ”¹ÕÉ°°Á…Ñ è‘¥…¹½ÍÑ¥A…Ñ ô°(€€€ôì(€ô(€€¼¼-••ÀÑ¡”…ÕÑ¡•¹Ñ¥…Ñ•É•¹‘•É•È¡¥‘‘•¸Ý¡¥±”‰É…¹Í•…É °Í½ÉÑ¥¹œ…¹(€€¼¼•áÁ½ÉÐ½¹Ñ¥¹Õ”Ñ¡É½Õ É•¹‘•É•ÈµÑ…É•Ñ•¥¹ÁÕÐ•Ù•¹ÑÌ¸(€¥˜€¡Í•±±•É]¥¹‘½Ü€˜˜€…Í•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€Í•±±•É]¥¹‘½Ü¹¡¥‘” ¤ì(€ô(€½¹ÍÐ½¹¹•Ñ•‘A…”€ô…Ý…¥Ð•á•ÕÑ•M•±±•ÉÉ…µ•]¥Ñ¡Q¥µ•½ÕÐ¡Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹µ…¥¹É…µ”°€  ¤€ôø€¡ì(€€€ÕÉ°è±½…Ñ¥½¸¹¡É•˜°(€€€Ñ¥Ñ±”è‘½Õµ•¹Ð¹Ñ¥Ñ±”°(€€€É•…‘åMÑ…Ñ”è‘½Õµ•¹Ð¹É•…‘åMÑ…Ñ”°(€€€±½¥¸è€½±½¥¹ñÍ¥¹¥¹ñÁ…ÍÍÁ½ÉÐ½¤¹Ñ•ÍÐ¡±½…Ñ¥½¸¹¡É•˜¤°(€€€¥¹ÁÕÑ½Õ¹Ðè‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÐ°Ñ•áÑ…É•„ˆ¤¹±•¹Ñ °(€ô¤¤ ¥€°€Ñ|ÀÀÀ°ìÕÉ°èÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•ÑUI0 ¤°É•…‘åMÑ…Ñ”è€‰Ñ¥µ•½ÕÐˆ°¥¹ÁÕÑ½Õ¹Ðè€Àô¤ì(€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€ÍÑ…ÑÕÌè½¹¹•Ñ•‘A…”¹±½¥¸€ü€‰Í•±±•Èµ±½¥¸µÉ•ÅÕ¥É•ˆ€è€‰Í•±±•ÈµÁ…”µ½¹¹•Ñ•ˆ°(€€€‰É…¹‘9…µ”°(€€€©½‰MÑ…Ñ”è½¹¹•Ñ•‘A…”¹±½¥¸€ü€ˆÇ®.£ªÎ¼Ôƒ
Üƒ¶2C®ž“²zC²ó¶Àƒ®†sªÞã²vàƒ¶V²jPˆ€è€ˆÇ®.£ªÎ¼Ôƒ
Üƒ¶2C®ž“²zC²ó¶Àƒ¶:c²vÓ²ž ƒ²^ÃªÊÀƒ¶fW²vàˆ°(€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
ÜUI0€‘í½¹¹•Ñ•‘A…”¹ÕÉ°ñð€‹¶fW²vàƒ®Ú#ªÂ ‰ôƒ
Üƒ®²ã²p€‘í½¹¹•Ñ•‘A…”¹É•…‘åMÑ…Ñ”ñð€‰Õ¹­¹½Ý¸‰ôƒ
Üƒ²z®‚”ƒ²jS²0€‘í9Õµ‰•È¡½¹¹•Ñ•‘A…”¹¥¹ÁÕÑ½Õ¹Ðñð€À¥÷ªÂq€°(€ô¤ì(€¥˜€¡½¹¹•Ñ•‘A…”¹±½¥¸¤ì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€½‘”è€‰M11I}1=%9}IEU%Iˆ°(€€€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ²zG²^²vƒ²ž¶Z'¶Vc®‚“®¦ÐA=%i=8ƒ¶2C®ž“²zC²ó¶Àƒ®†sªÞã²vã²vÐƒ¶V²jS¶V§®.#®.¹€°(€€€ôì(€ô(€€¼¼É••é”Ñ¡”‘½Ý¹±½…µ•¹Ñ•È©½ˆ±¥ÍÐ‰•™½É”±¥­¥¹œ€‹²‚²ÊÐƒ®
Ó®ÎÓ®
ÓªâÀˆ¸(€€¼¼]…¥Ñ¥¹œÕ¹Ñ¥°…™Ñ•ÈÑ¡”•áÁ½ÉÐ…±±½Ý•Ñ¡”¹•Ý±äµÉ•…Ñ•©½ˆÑ¼±•…¬¥¹Ñ¼(€€¼¼Ñ¡”‰…Í•±¥¹”°Í¼Ñ¡”™¥ÉÍÐ©½ˆ½Õ±¹•Ù•È‰”É•½¹¥é•…Ì¹•Ü¸(€±•Ð‰…Í•±¥¹•)½‰Ì€ô…Ý…¥Ð‰…Í•±¥¹•AÉ½µ¥Í”ì(€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡‰…Í•±¥¹•)½‰Ì¤¤ì(€€€‰…Í•±¥¹•)½‰Ì€ô…Ý…¥ÐAÉ½µ¥Í”¹É…”¡l(€€€€€É•…‘M•±±•ÉáÁ½ÉÑ)½‰ÍÉ½µ5½¹¥Ñ½È ¤°(€€€€€¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ  ¤€ôøÉ•Í½±Ù”¡¹Õ±°¤°€ÄÕ|ÀÀÀ¤¤°(€€€t¤¹…Ñ   ¤€ôø¹Õ±°¤ì(€ô(€±•Ð‰…Í•±¥¹•Ù…¥±…‰±”€ôÉÉ…ä¹¥ÍÉÉ…ä¡‰…Í•±¥¹•)½‰Ì¤ì(€½¹ÍÐÉ•½Ù•É…‰±•)½ˆ€ôÉ•½Ù•É…‰±•M…Ù•‘	É…¹‘áÁ½ÉÑ)½ˆ¡‰É…¹‘9…µ”°‰É…¹‘-¼°‰…Í•±¥¹•)½‰Ìñðmt¤ì(€¥˜€¡É•½Ù•É…‰±•)½ˆ€˜˜€…‰É…¹‘áÁ½ÉÑ)½‰Ì¹¡…Ì¡É•½Ù•É…‰±•)½ˆ¹©½‰%¤¤ì(€€€‰É…¹‘áÁ½ÉÑ)½‰Ì¹Í•Ð¡É•½Ù•É…‰±•)½ˆ¹©½‰%°ì(€€€€€©½‰%èÉ•½Ù•É…‰±•)½ˆ¹©½‰%°(€€€€€‰É…¹‘9…µ”°(€€€€€‰É…¹‘-¼°(€€€€€É•…Ñ•‘ÐèÉ•½Ù•É…‰±•)½ˆ¹É•…Ñ•‘Ð°(€€€€€‘½Ý¹±½…‘MÑ…ÉÑ•è™…±Í”°(€€€€€•áÁ•Ñ•‘AÉ½‘ÕÑ½Õ¹Ðè9Õµ‰•È¡É•½Ù•É…‰±•)½ˆ¹•áÁ•Ñ•‘AÉ½‘ÕÑ½Õ¹Ðñð€À¤°(€€€€€É•½Ù•É•èÑÉÕ”°(€€€€€É•ÍÑ½É•‘Ðè…Ñ”¹¹½Ü ¤°(€€€ô¤ì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ô€ˆˆì(€€€Í•±±•É]¥¹‘½Ü¹¡¥‘” ¤ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€€€ÍÑ…ÑÕÌè€‰©½ˆµÉ•…Ñ•ˆ°(€€€€€‰É…¹‘9…µ”°(€€€€€©½‰%èÉ•½Ù•É…‰±•)½ˆ¹©½‰%°(€€€€€©½‰MÑ…Ñ”è€‹²’G®. ƒ²‚ƒ²zG²^®Ê#¶bàƒ®Î×ªÖ°ƒ²f®Ž0ƒ
Üƒ®.“²jÓ®†s®NpƒªÂC².pƒ²z³ªÂpˆ°(€€€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
Üƒ²’G®. ƒ²‚ƒ²zG²^®Ê#¶bà€‘íÉ•½Ù•É…‰±•)½ˆ¹©½‰%‘÷®–ðƒ®.“².pƒ²^ÃªÊÃ¶Z#²*×®.#®.¸ƒ² ƒ®
Ó®ÎÓ®
ÓªâÃ®–ðƒ²’G®ÎÔƒ²w²Ç¶Vc²ž ƒ²V+ªÎ€ƒ®.“²jÓ®†s®Ns®–ðƒ²vÓ²ZÓªÂG®.#®.¹€°(€€€ô¤ì(€€€¥˜€ …¥¹ÁÕÐ¹‘•™•É5½¹¥Ñ½È¤Ù½¥Ý…Ñ¡±±M•±±•ÉáÁ½ÉÑ)½‰ÍÙ•ÉåQ•¹M•½¹‘Ì ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬èÑÉÕ”°(€€€€€™½±‘•È°(€€€€€©½‰%èÉ•½Ù•É…‰±•)½ˆ¹©½‰%°(€€€€€•áÁ•Ñ•‘AÉ½‘ÕÑ½Õ¹Ðè9Õµ‰•È¡É•½Ù•É…‰±•)½ˆ¹•áÁ•Ñ•‘AÉ½‘ÕÑ½Õ¹Ðñð€À¤°(€€€€€É•½Ù•É•èÑÉÕ”°(€€€ôì(€ô(€½¹ÍÐ‰…Í•±¥¹•)½‰%‘Ì€ô¹•ÜM•Ð¡l(€€€€¸¸¹‰É…¹‘áÁ½ÉÑ)½‰Ì¹­•åÌ ¤°(€€€€¸¸¹Í…Ù•‘	É…¹‘áÁ½ÉÑ)½‰Ì ¤¹µ…À ¡©½ˆ¤€ôøMÑÉ¥¹œ¡©½ˆü¹©½‰%ñð€ˆˆ¤¹ÑÉ¥´ ¤¤°(€€€€¸¸¸¡‰…Í•±¥¹•)½‰Ìñðmt¤¹µ…À ¡©½ˆ¤€ôøMÑÉ¥¹œ¡©½ˆü¹¥ñð€ˆˆ¤¹ÑÉ¥´ ¤¤°(€t¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€ÍÑ…ÑÕÌè‰…Í•±¥¹•Ù…¥±…‰±”€ü€‰©½ˆµ‰…Í•±¥¹”µÉ•…‘äˆ€è€‰©½ˆµ‰…Í•±¥¹”µ™…±±‰…¬ˆ°(€€€‰É…¹‘9…µ”°(€€€©½‰MÑ…Ñ”è€‹ªâÃ²†Ðƒ²zG²^®Ê#¶bàƒ¶fW²vàƒ²f®Ž0ƒ
Üƒ²¶J#ªÊ²$ƒ².s²zDˆ°(€€€µ•ÍÍ…”è‰…Í•±¥¹•Ù…¥±…‰±”(€€€€€€ü€‘í‰É…¹‘9…µ•ôƒ
Üƒ®
Ó®ÎÓ®
ÓªâÀƒ²‚ƒªâÃ²†Ðƒ²zG²^®Ê#¶bà€‘í‰…Í•±¥¹•)½‰%‘Ì¹Í¥é•÷ªÂs®–ðƒªÎƒ²‚W¶Z#²*×®.#®.¹€(€€€€€€è€‘í‰É…¹‘9…µ•ôƒ
Üƒ²‚²z—®Bpƒ®¾ã²
³²j¤ƒ²zG²^®Ê#¶bã®–ðƒ²‚s²fã¶VcªÎ€ƒ² ƒ²zG²^®Ê#¶bã®–ðƒ¶fW²vã¶V§®.#®.¹€°(€ô¤ì(€½¹ÍÐÍ•±±•É	É…¹‘±¥…ÍÉ½ÕÁÌ€ôl(€€€l‰½±Õµ‰¥„ˆ°€‹²î³®~ó®æ²Vˆ°€‹–N—’ò›š¾S’êh‰t°(€€€l‰A…Ñ…½¹¥„ˆ°€‹¶23¶ªÎƒ®.#²Vˆ°€‹–ÞÓ–†S–N—–Âó’êh‰t°(€€€l‰Q½µµä!¥±™¥•Èˆ°€‹¶®¾ã¶zC¶RóªÆÀˆ°€‹šÆ“žÆÏ–â3–ÂS¢Òçš‚ð‰t°(€€€l‰%1ˆ°€‹¶rƒ®vðˆ°€‹šZC’æ@‰t°(€€€l‰I••‰½¬ˆ°€‹®š³®ÎÔˆ°€‹¦RCš¶”‰t°(€€€l‰AU5ˆ°€‰AÕµ„ˆ°€‹¶Fã®ž ˆ°€‹–ö«¦¦°‰t°(€€€l‰=¸ˆ°€‰=¸IÕ¹¹¥¹œˆ°€‹²b ˆ°€‹²b£®~³®.tˆ°€‹šb¢ÞD‰t°(€€€l‰A½±¼I…±Á 1…ÕÉ•¸ˆ°€‰A=1<I1A 1UI8ˆ°€‹¶>Ó®†pƒ®z¶R®†s®‚0ˆ°€‹®z¶R®†s®‚0ˆ°€‹š.'–’¯–*Ï’ò˜‰t°(€€€l‰‘¥‘…Ì=É¥¥¹…±Ìˆ°€‰…‘¥‘…Ì=É¥¥¹…±Ìˆ°€‹²V®RS®.“²*ƒ²b“®š³²ž®C²*ˆ°€‹¦bÿ¢þ«¢úûšZ¼ˆ°€‹’â'–>Û¢6$‰t°(€tì(€½¹ÍÐ‰É…¹‘-½%¹ÁÕÐ€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹‰É…¹‘-¼ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐÍ•±±•É=™™¥¥…±I•¥ÍÑÉä€ôÍ…™•=™™¥¥…±½µ…¥¹I•¥ÍÑÉä (€€€ÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ì¹‰É…¹‘…Ñ…±½œñð•áÁ±½É•É5•Ñ…‘…Ñ„ ¤¹‰É…¹‘Ì(€€¤ì(€½¹ÍÐÍ•±±•É=™™¥¥…±I•½É€ô½™™¥¥…±½µ…¥¹I•½É‘½É	É…¹¡Í•±±•É=™™¥¥…±I•¥ÍÑÉä°‰É…¹‘9…µ”¤(€€€ñð½™™¥¥…±½µ…¥¹I•½É‘½É	É…¹¡Í•±±•É=™™¥¥…±I•¥ÍÑÉä°‰É…¹‘-½%¹ÁÕÐ¤ì(€½¹ÍÐÍ•±±•É	É…¹‘5…Ñ¡-•åÌ€ôÍ•±±•É	É…¹‘±¥…Í•Ì¡ì(€€€‰É…¹‘9…µ”°(€€€‰É…¹‘-¼è‰É…¹‘-½%¹ÁÕÐ°(€€€‰É…¹‘UÉ°è¥¹ÁÕÐ¹‰É…¹‘UÉ°°(€€€½™™¥¥…±!½µ•Á…•UÉ°è¥¹ÁÕÐ¹½™™¥¥…±!½µ•Á…•UÉ°ñðÍ•±±•É=™™¥¥…±I•½Éü¹¡½µ•Á…•UÉ°°(€€€½™™¥¥…±±¥…Í•Ìè½™™¥¥…±½µ…¥¹M•…É¡±¥…Í•Ì¡Í•±±•É=™™¥¥…±I•½É¤°(€ô¤ì(€½¹ÍÐ±½…±¥é•‘±¥…Í•Ì€ôÍ•±±•É	É…¹‘±¥…ÍÉ½ÕÁÌ¹™¥¹ ¡…±¥…Í•Ì¤€ôø(€€€…±¥…Í•Ì¹Í½µ” ¡…±¥…Ì¤€ôø‰É…¹‘Í5…Ñ ¡‰É…¹‘9…µ”°…±¥…Ì¤ñð‰É…¹‘Í5…Ñ ¡‰É…¹‘-½%¹ÁÕÐ°…±¥…Ì¤¤(€€¤ì(€¥˜€¡±½…±¥é•‘±¥…Í•Ì¤Í•±±•É	É…¹‘5…Ñ¡-•åÌ¹ÁÕÍ  ¸¸¹±½…±¥é•‘±¥…Í•Ì¤ì(€¥˜€¡‰É…¹‘Í5…Ñ ¡‰É…¹‘9…µ”°€‰)½É‘…¸ˆ¤¤ì(€€€Í•±±•É	É…¹‘5…Ñ¡-•åÌ¹ÁÕÍ  ‰)½É‘…¸ˆ°€‹²†Ã®6`ˆ°€‹’æS’âäˆ¤ì(€ô(€½¹ÍÐÍ•±±•É	É…¹‘M•…É¡9…µ”€ô‰É…¹‘Í5…Ñ ¡‰É…¹‘9…µ”°€‰=¸ˆ¤(€€€€ü€‰=¸IÕ¹¹¥¹œˆ(€€€€èÁÉ•™•ÉÉ•‘M•±±•É	É…¹‘M•…É¡9…µ”¡Í•±±•É	É…¹‘5…Ñ¡-•åÌ¤ì(€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€ÍÑ…ÑÕÌè€‰Í•…É¡¥¹œµ‰É…¹µÁÉ½‘ÕÑÌˆ°(€€€‰É…¹‘9…µ”°(€€€©½‰MÑ…Ñ”è€ˆÇ®.£ªÎ¼Ôƒ
Üƒ®â3®zs®Npƒ²z®‚—
ß²¶J ƒªÊ²$ƒ²’Dˆ°(€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
Üƒ®â3®zs®Ns®–ðƒ²z®‚—¶VcªÎ€ƒ²¶J ƒªÊ²'²vƒ².“¶Z'¶V§®.#®.¹€°(€ô¤ì(€½¹ÍÐÉÕ¹M•±±•ÉM•…É €ô€¡Ñ…É•ÑÉ…µ”°Í•…É¡±É•…‘åMÕ‰µ¥ÑÑ•€ô™…±Í”¤€ôøÑ…É•ÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €ø€À(€€€€€€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹¡•¥¡Ð€ø€Àì(€€€½¹ÍÐÑ•áÑ=˜€ô€¡•±•µ•¹Ð¤€ôøMÑÉ¥¹œ¡•±•µ•¹Ðü¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ðü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤(€€€€€€¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ¹½Éµ…±¥é”€ô€¡Ù…±Õ”¤€ôøMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹¹½Éµ…±¥é” ‰9-ˆ¤¹Ñ½1½…±•1½Ý•É…Í” ¤(€€€€€€¹É•Á±…” ½my„µèÀ´çªÂ ·¶z’â ·¦ú•t¬½œ°€ˆˆ¤(€€€€€€¹É•Á±…” ¼Ù¥áÑä½œ°€‰Í¥áÑäˆ¤¹É•Á±…” ¼á¥¡Ð½œ°€‰•¥¡Ðˆ¤ì(€€€½¹ÍÐ±¥­1¥­•UÍ•È€ô€¡•±•µ•¹Ð¤€ôøì(€€€€€¥˜€ …•±•µ•¹Ð¤É•ÑÕÉ¸™…±Í”ì(€€€€€•±•µ•¹Ð¹ÍÉ½±±%¹Ñ½Y¥•Ü¡ì‰±½¬è€‰•¹Ñ•Èˆ°¥¹±¥¹”è€‰•¹Ñ•Èˆô¤ì(€€€€€•±•µ•¹Ð¹™½ÕÌü¸ ¤ì(€€€€€™½È€¡½¹ÍÐÑåÁ”½˜l‰Á½¥¹Ñ•É‘½Ý¸ˆ°€‰µ½ÕÍ•‘½Ý¸ˆ°€‰Á½¥¹Ñ•ÉÕÀˆ°€‰µ½ÕÍ•ÕÀ‰t¤ì(€€€€€€€•±•µ•¹Ð¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü5½ÕÍ•Ù•¹Ð¡ÑåÁ”°ì(€€€€€€€€€‰Õ‰‰±•ÌèÑÉÕ”°(€€€€€€€€€…¹•±…‰±”èÑÉÕ”°(€€€€€€€€€½µÁ½Í•èÑÉÕ”°(€€€€€€€€€Ù¥•ÜèÝ¥¹‘½Ü°(€€€€€€€€€‰ÕÑÑ½¸è€À°(€€€€€€€ô¤¤ì(€€€€€ô(€€€€€•±•µ•¹Ð¹±¥¬ü¸ ¤ì(€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€ôì(€€€½¹ÍÐ™¥¹‘Y¥Í¥‰±•	åQ•áÐ€ô€¡Í•±•Ñ½È°Á…ÑÑ•É¸¤€ôø(€€€€€l¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±°¡Í•±•Ñ½È¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôøÁ…ÑÑ•É¸¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ì(€€€€€€€½¹ÍÐÉ½½ÑÌ€ôm‘½Õµ•¹Ñtì(€€€€€€€™½È€¡±•ÐÉ½½Ñ%¹‘•à€ô€ÀìÉ½½Ñ%¹‘•à€ðÉ½½ÑÌ¹±•¹Ñ ìÉ½½Ñ%¹‘•à€¬ô€Ä¤ì(€€€€€€€€€½¹ÍÐÉ½½Ð€ôÉ½½ÑÍmÉ½½Ñ%¹‘•átì(€€€€€€€€€™½È€¡½¹ÍÐ•±•µ•¹Ð½˜É½½Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¨ˆ¤¤ì(€€€€€€€€€€€¥˜€¡•±•µ•¹Ð¹Í¡…‘½ÝI½½Ð€˜˜€…É½½ÑÌ¹¥¹±Õ‘•Ì¡•±•µ•¹Ð¹Í¡…‘½ÝI½½Ð¤¤É½½ÑÌ¹ÁÕÍ ¡•±•µ•¹Ð¹Í¡…‘½ÝI½½Ð¤ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€€€½¹ÍÐ¥¹ÁÕÑÌ€ôÉ½½ÑÌ¹™±…Ñ5…À ¡É½½Ð¤€ôøl¸¸¹É½½Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÐ°Ñ•áÑ…É•„ˆ¥t¤(€€€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð°¥¹‘•à°…±°¤€ôø…±°¹¥¹‘•á=˜¡•±•µ•¹Ð¤€ôôô¥¹‘•à¤(€€€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøì(€€€€€€€€€€€½¹ÍÐÑåÁ”€ôMÑÉ¥¹œ¡•±•µ•¹Ð¹ÑåÁ”ñð€‰Ñ•áÐˆ¤¹Ñ½1½Ý•É…Í” ¤ì(€€€€€€€€€€€É•ÑÕÉ¸€…•±•µ•¹Ð¹‘¥Í…‰±•€˜˜€…•±•µ•¹Ð¹É•…‘=¹±ä(€€€€€€€€€€€€€€˜˜€…l‰¡¥‘‘•¸ˆ°€‰Á…ÍÍÝ½Éˆ°€‰‘…Ñ”ˆ°€‰‘…Ñ•Ñ¥µ”µ±½…°ˆ°€‰µ½¹Ñ ˆ°€‰Ñ¥µ”ˆ°€‰™¥±”ˆ°€‰¡•­‰½àˆ°€‰É…‘¥¼‰t¹¥¹±Õ‘•Ì¡ÑåÁ”¤ì(€€€€€€€€€ô¤ì(€€€€€€€€¼¼Q¡”ÁÉ½Ù•¸M•±±•È•¹Ñ•È™±½ÜÕÍ•ÌÑ¡”±½‰…°ÁÉ½‘ÕÐÅÕ•Éä¥¹ÁÕÐ…Ð(€€€€€€€€¼¼Ñ¡”Ù•ÉäÑ½À½˜Ñ¡”Á…”èo²¶J ƒ²‚W®ÎÑtmÅÕ•ÉåtoªÊ²$ƒ®Â<ƒ²z²ÂÁt¸¼¹½Ð(€€€€€€€€¼¼½¹™ÕÍ”¥ÐÝ¥Ñ ½¹”½˜Ñ¡”µ…¹äÁÉ½‘ÕÐµ™¥±Ñ•È¥¹ÁÕÑÌ‰•±½Ü¥Ð¸(€€€€€€€½¹ÍÐ•á…ÑM•…É¡	ÕÑÑ½¹Ì€ôÉ½½ÑÌ¹™±…Ñ5…À ¡É½½Ð¤€ôø(€€€€€€€€€l¸¸¹É½½Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸tˆ¥t(€€€€€€€€¤¹™¥±Ñ•È ¡•±•µ•¹Ð°¥¹‘•à°…±°¤€ôø…±°¹¥¹‘•á=˜¡•±•µ•¹Ð¤€ôôô¥¹‘•à¤(€€€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø€½{ªÊ²%qqÌ«®Â=qqÌ«²z²ÂÀ¼¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤ì(€€€€€€€½¹ÍÐ•á…ÑM•…É¡	ÕÑÑ½¸€ô•á…ÑM•…É¡	ÕÑÑ½¹Ì(€€€€€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø±•™Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ñ½À€´É¥¡Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ñ½À¥lÁtñð¹Õ±°ì(€€€€€€€½¹ÍÐ•á…Ñ	ÕÑÑ½¹I•Ð€ô•á…ÑM•…É¡	ÕÑÑ½¸ü¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€½¹ÍÐ•á…Ñ%¹ÁÕÐ€ô•á…Ñ	ÕÑÑ½¹I•Ð(€€€€€€€€€€ü¥¹ÁÕÑÌ¹µ…À ¡•±•µ•¹Ð¤€ôøì(€€€€€€€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€€€€€½¹ÍÐÙ•ÉÑ¥…±¥ÍÑ…¹”€ô5…Ñ ¹…‰Ì (€€€€€€€€€€€€€€€€¡É•Ð¹Ñ½À€¬É•Ð¹¡•¥¡Ð€¼€È¤€´€¡•á…Ñ	ÕÑÑ½¹I•Ð¹Ñ½À€¬•á…Ñ	ÕÑÑ½¹I•Ð¹¡•¥¡Ð€¼€È¤(€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€½¹ÍÐ¡½É¥é½¹Ñ…±…À€ô•á…Ñ	ÕÑÑ½¹I•Ð¹±•™Ð€´É•Ð¹É¥¡Ðì(€€€€€€€€€€€€€É•ÑÕÉ¸ì•±•µ•¹Ð°Ù•ÉÑ¥…±¥ÍÑ…¹”°¡½É¥é½¹Ñ…±…À°Ñ½ÀèÉ•Ð¹Ñ½Àôì(€€€€€€€€€€€ô¤¹™¥±Ñ•È ¡…¹‘¥‘…Ñ”¤€ôø…¹‘¥‘…Ñ”¹Ù•ÉÑ¥…±¥ÍÑ…¹”€ð€ÈÐ(€€€€€€€€€€€€€€˜˜…¹‘¥‘…Ñ”¹¡½É¥é½¹Ñ…±…À€øô€´Ð€˜˜…¹‘¥‘…Ñ”¹¡½É¥é½¹Ñ…±…À€ð€àÀ¤(€€€€€€€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø±•™Ð¹¡½É¥é½¹Ñ…±…À€´É¥¡Ð¹¡½É¥é½¹Ñ…±…À¥lÁtü¹•±•µ•¹Ðñð¹Õ±°(€€€€€€€€€€è¹Õ±°ì(€€€€€€€½¹ÍÐ¥¹ÁÕÑM½É”€ô€¡•±•µ•¹Ð¤€ôøì(€€€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€½¹ÍÐ…ÑÑÉ¥‰ÕÑ•Ì€ôl(€€€€€€€€€€€•±•µ•¹Ð¹Á±…•¡½±‘•È°(€€€€€€€€€€€•±•µ•¹Ð¹•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ±…‰•°ˆ¤°(€€€€€€€€€€€•±•µ•¹Ð¹•ÑÑÑÉ¥‰ÕÑ” ‰¹…µ”ˆ¤°(€€€€€€€€€€€•±•µ•¹Ð¹•ÑÑÑÉ¥‰ÕÑ” ‰¥ˆ¤°(€€€€€€€€€€€•±•µ•¹Ð¹•ÑÑÑÉ¥‰ÕÑ” ‰‘…Ñ„µÁ±…•¡½±‘•Èˆ¤°(€€€€€€€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ ˆ€ˆ¤ì(€€€€€€€€€½¹ÍÐ½¹Ñ•áÐ€ôÑ•áÑ=˜¡•±•µ•¹Ð¹±½Í•ÍÐ ‰™½É´°€¹…¹Ðµ™½É´µ¥Ñ•´°m±…ÍÌ¨ô™½É´t°m±…ÍÌ¨ôÍ•…É tˆ¤ñð•±•µ•¹Ð¹Á…É•¹Ñ±•µ•¹Ð¤ì(€€€€€€€€€½¹ÍÐÍÑÉ½¹!¥¹Ð€ô€¿²¶J!ó²¶J#®ªó®â3®zs®Nqó¶J#®Ê!óªÊ²%ñÁÉ½‘ÕÑñ‰É…¹‘ñ…ÉÑ¥±•ñÍÁÕñÍ­Õó–V–Nó–Nž&1ó¢ÒŸ–>ÝóšBsžÒ‰óš~—¢¾ˆ½¤¹Ñ•ÍÐ¡…ÑÑÉ¥‰ÕÑ•Ì¤ì(€€€€€€€€€½¹ÍÐ½¹Ñ•áÑ!¥¹Ð€ô€¿²¶J!ó®â3®zs®Nqó¶J#®Ê!óªÊ²%ñÁÉ½‘ÕÑñ‰É…¹‘ñÍÁÕñÍ­Õó–V–Nó–Nž&1ó¢ÒŸ–>Ü½¤¹Ñ•ÍÐ¡½¹Ñ•áÐ¤ì(€€€€€€€€€É•ÑÕÉ¸€¡ÍÑÉ½¹!¥¹Ð€ü€ÄÀÀÀ€è€À¤(€€€€€€€€€€€€¬€¡½¹Ñ•áÑ!¥¹Ð€ü€ÌÀÀ€è€À¤(€€€€€€€€€€€€¬€¡É•Ð¹Ñ½À€øô€À€˜˜É•Ð¹Ñ½À€ð€ÌØÀ€ü€ÄÈÀ€è€À¤(€€€€€€€€€€€€¬5…Ñ ¹µ¥¸ ÄàÀ°5…Ñ ¹É½Õ¹¡É•Ð¹Ý¥‘Ñ ¤¤ì(€€€€€€€ôì(€€€€€€€½¹ÍÐÍ•…É¡%¹ÁÕÑÌ€ô¥¹ÁÕÑÌ¹µ…À ¡•±•µ•¹Ð¤€ôø€¡ì•±•µ•¹Ð°Í½É”è¥¹ÁÕÑM½É”¡•±•µ•¹Ð¤ô¤¤(€€€€€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøÉ¥¡Ð¹Í½É”€´±•™Ð¹Í½É”¤ì(€€€€€€€½¹ÍÐ¥¹ÁÕÐ€ô•á…Ñ%¹ÁÕÐñðÍ•…É¡%¹ÁÕÑÍlÁtü¹•±•µ•¹Ðñð¹Õ±°ì(€€€€€€€¥˜€ …¥¹ÁÕÐñð€ …•á…Ñ%¹ÁÕÐ€˜˜Í•…É¡%¹ÁÕÑÍlÁt¹Í½É”€ð€ÈÀÀ¤¤ì(€€€€€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰MI!}%9AUQ}9=Q}=U9ˆ°¥¹ÁÕÑ½Õ¹Ðè¥¹ÁÕÑÌ¹±•¹Ñ ôì(€€€€€€€ô(€€€€€€€½¹ÍÐÉ•…‘M•…É¡MÑ…Ñ”€ô€ ¤€ôøì(€€€€€€€€€½¹ÍÐÉ½ÝÌ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰Ñ‰½‘äÑÈˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€€€€€½¹ÍÐÉ½ÝQ•áÑÌ€ôÉ½ÝÌ¹Í±¥” À°€ÌÀ¤¹µ…À ¡É½Ü¤€ôø(€€€€€€€€€€€MÑÉ¥¹œ¡É½Ü¹¥¹¹•ÉQ•áÐñðÉ½Ü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤(€€€€€€€€€€¤ì(€€€€€€€€€½¹ÍÐÉ½ÝQ•áÐ€ôÉ½ÝQ•áÑÌ¹©½¥¸ ‰qq¸ˆ¤ì(€€€€€€€€€½¹ÍÐÑ½Ñ…±Q•áÐ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰½‘ä€¨ˆ¥t(€€€€€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€€€€€¹µ…À ¡•±•µ•¹Ð¤€ôøMÑÉ¥¹œ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤¹ÑÉ¥´ ¤¤(€€€€€€€€€€€€¹™¥¹ ¡Ñ•áÐ¤€ôø€½{²ÒuqqÌ©mqq±t­qqÌ«ªÆÑqqÌ«ªÊÃªÎð¼¹Ñ•ÍÐ¡Ñ•áÐ¤¤ñð€ˆˆì(€€€€€€€€€½¹ÍÐÑ½Ñ…±½Õ¹Ð€ô9Õµ‰•È¡MÑÉ¥¹œ¡Ñ½Ñ…±Q•áÐ¤¹É•Á±…” ½mxÀ´åt½œ°€ˆˆ¤¤ñð€Àì(€€€€€€€€€É•ÑÕÉ¸ìÉ½ÝQ•áÐ°É½ÝQ•áÑÌ°Ñ½Ñ…±Q•áÐ°Ñ½Ñ…±½Õ¹Ðôì(€€€€€€€ôì(€€€€€€€½¹ÍÐ‰•™½É•M•…É €ôÉ•…‘M•…É¡MÑ…Ñ” ¤ì(€€€€€€€½¹ÍÐÉ•ÅÕ•ÍÑ•‘	É…¹‘-•åÌ€ô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Í•±±•É	É…¹‘5…Ñ¡-•åÌ¥ô(€€€€€€€€€€¹µ…À¡¹½Éµ…±¥é”¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€€€€€½¹ÍÐÉ•ÅÕ•ÍÑ•‘	É…¹‘I…Ñ¥¼€ô€¡ÍÑ…Ñ”¤€ôøì(€€€€€€€€€½¹ÍÐÉ½ÝÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ…Ñ”ü¹É½ÝQ•áÑÌ¤€üÍÑ…Ñ”¹É½ÝQ•áÑÌ¹™¥±Ñ•È¡	½½±•…¸¤€èmtì(€€€€€€€€€¥˜€ …É½ÝÌ¹±•¹Ñ ñð€…É•ÅÕ•ÍÑ•‘	É…¹‘-•åÌ¹±•¹Ñ ¤É•ÑÕÉ¸€Àì(€€€€€€€€€½¹ÍÐµ…Ñ¡•Ì€ôÉ½ÝÌ¹™¥±Ñ•È ¡É½Ü¤€ôøÉ•ÅÕ•ÍÑ•‘	É…¹‘-•åÌ¹Í½µ” ¡­•ä¤€ôøì(€€€€€€€€€€€½¹ÍÐ¹½Éµ…±¥é•‘-•ä€ô¹½Éµ…±¥é”¡­•ä¤¹Ñ½1½…±•1½Ý•É…Í” ¤ì(€€€€€€€€€€€¥˜€¡¹½Éµ…±¥é•‘-•ä¹±•¹Ñ €ø€Ì¤É•ÑÕÉ¸¹½Éµ…±¥é”¡É½Ü¤¹Ñ½1½…±•1½Ý•É…Í” ¤¹¥¹±Õ‘•Ì¡¹½Éµ…±¥é•‘-•ä¤ì(€€€€€€€€€€€½¹ÍÐÑ½­•¹Ì€ôMÑÉ¥¹œ¡É½Üñð€ˆˆ¤¹Ñ½1½…±•1½Ý•É…Í” ¤(€€€€€€€€€€€€€€¹ÍÁ±¥Ð ½my„µèÀ´çªÂ ·¶zt¬¼¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€€€€€€€€€É•ÑÕÉ¸Ñ½­•¹Ì¹¥¹±Õ‘•Ì¡MÑÉ¥¹œ¡­•äñð€ˆˆ¤¹ÑÉ¥´ ¤¹Ñ½1½…±•1½Ý•É…Í” ¤¤ì(€€€€€€€€€ô¤¤¹±•¹Ñ ì(€€€€€€€€€É•ÑÕÉ¸µ…Ñ¡•Ì€¼É½ÝÌ¹±•¹Ñ ì(€€€€€€€ôì(€€€€€€€½¹ÍÐ¡…ÍI•ÅÕ•ÍÑ•‘	É…¹€ô€¡ÍÑ…Ñ”¤€ôøÉ•ÅÕ•ÍÑ•‘	É…¹‘I…Ñ¥¼¡ÍÑ…Ñ”¤€øô€À¸àì(€€€€€€€½¹ÍÐÙ…±Õ•AÉ½Ñ½ÑåÁ”€ô¥¹ÁÕÐ¥¹ÍÑ…¹•½˜!Q51Q•áÑÉ•…±•µ•¹Ð(€€€€€€€€€€ü!Q51Q•áÑÉ•…±•µ•¹Ð¹ÁÉ½Ñ½ÑåÁ”(€€€€€€€€€€è!Q51%¹ÁÕÑ±•µ•¹Ð¹ÁÉ½Ñ½ÑåÁ”ì(€€€€€€€½¹ÍÐÍ•ÑÑ•È€ô=‰©•Ð¹•Ñ=Ý¹AÉ½Á•ÉÑå•ÍÉ¥ÁÑ½È¡Ù…±Õ•AÉ½Ñ½ÑåÁ”°€‰Ù…±Õ”ˆ¤ü¹Í•Ðì(€€€€€€€½¹ÍÐ…ÁÁ±åY…±Õ”€ô€¡Ù…±Õ”¤€ôøì(€€€€€€€€€½¹ÍÐÁÉ•Ù¥½ÕÍY…±Õ”€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹Ù…±Õ”ñð€ˆˆ¤ì(€€€€€€€€€¥¹ÁÕÐ¹™½ÕÌ ¤ì(€€€€€€€€€¥˜€¡Í•ÑÑ•È¤Í•ÑÑ•È¹…±°¡¥¹ÁÕÐ°Ù…±Õ”¤ì(€€€€€€€€€•±Í”¥¹ÁÕÐ¹Ù…±Õ”€ôÙ…±Õ”ì(€€€€€€€€€€¼¼A=%i=8ÕÍ•Ì„I•…Ðµ½¹ÑÉ½±±•±½‰…°Í•…É ¥¹ÁÕÐ¸I•Í•ÐI•…ÐÌ(€€€€€€€€€€¼¼Ù…±Õ”ÑÉ…­•ÈÑ¼Ñ¡”ÁÉ•Ù¥½ÕÌ=4Ù…±Õ”Í¼Ñ¡”Íå¹Ñ¡•Ñ¥Œ¥¹ÁÕÐ(€€€€€€€€€€¼¼•Ù•¹Ð¥ÌÉ•½¹¥é•…Ì„É•…°ÕÍ•È¡…¹”¥¹ÍÑ•…½˜‰•¥¹œ¥¹½É•(€€€€€€€€€€¼¼…¹¥µµ•‘¥…Ñ•±äÉ•¹‘•É•‰…¬Ñ¼…¸•µÁÑäÍÑÉ¥¹œ¸(€€€€€€€€€¥˜€¡¥¹ÁÕÐ¹}Ù…±Õ•QÉ…­•È€˜˜ÑåÁ•½˜¥¹ÁÕÐ¹}Ù…±Õ•QÉ…­•È¹Í•ÑY…±Õ”€ôôô€‰™Õ¹Ñ¥½¸ˆ¤ì(€€€€€€€€€€€¥¹ÁÕÐ¹}Ù…±Õ•QÉ…­•È¹Í•ÑY…±Õ”¡ÁÉ•Ù¥½ÕÍY…±Õ”¤ì(€€€€€€€€€ô(€€€€€€€€€¥¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü%¹ÁÕÑÙ•¹Ð ‰¥¹ÁÕÐˆ°ì(€€€€€€€€€€€‰Õ‰‰±•ÌèÑÉÕ”°(€€€€€€€€€€€½µÁ½Í•èÑÉÕ”°(€€€€€€€€€€€¥¹ÁÕÑQåÁ”èÙ…±Õ”€ü€‰¥¹Í•ÉÑQ•áÐˆ€è€‰‘•±•Ñ•½¹Ñ•¹Ñ	…­Ý…Éˆ°(€€€€€€€€€€€‘…Ñ„èÙ…±Õ”ñð¹Õ±°°(€€€€€€€€€ô¤¤ì(€€€€€€€€€¥¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ‰¡…¹”ˆ°ì‰Õ‰‰±•ÌèÑÉÕ”°½µÁ½Í•èÑÉÕ”ô¤¤ì(€€€€€€€ôì(€€€€€€€¥˜€¡MÑÉ¥¹œ¡¥¹ÁÕÐ¹Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤€„ôô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Í•±±•É	É…¹‘M•…É¡9…µ”¥ô¤ì(€€€€€€€€€…ÁÁ±åY…±Õ” ˆˆ¤ì(€€€€€€€€€…Ý…¥ÐÝ…¥Ð ÄØÀ¤ì(€€€€€€€€€…ÁÁ±åY…±Õ” ‘í)M=8¹ÍÑÉ¥¹¥™ä¡Í•±±•É	É…¹‘M•…É¡9…µ”¥ô¤ì(€€€€€€€€€…Ý…¥ÐÝ…¥Ð ÜÀÀ¤ì(€€€€€€€ô(€€€€€€€¥˜€¡MÑÉ¥¹œ¡¥¹ÁÕÐ¹Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤€„ôô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Í•±±•É	É…¹‘M•…É¡9…µ”¥ô¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€½¬è™…±Í”°(€€€€€€€€€€€ÍÑ•Àè€‰	I9}%9AUQ}9=Q}AA1%ˆ°(€€€€€€€€€€€…ÑÕ…±%¹ÁÕÑY…±Õ”èMÑÉ¥¹œ¡¥¹ÁÕÐ¹Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€€€€€€€•áÁ•Ñ•‘%¹ÁÕÑY…±Õ”è€‘í)M=8¹ÍÑÉ¥¹¥™ä¡Í•±±•É	É…¹‘M•…É¡9…µ”¥ô°(€€€€€€€€€ôì(€€€€€€€ô(€€€€€€€½¹ÍÐ‰ÕÑÑ½¹Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸tˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€€€½¹ÍÐ¥¹ÁÕÑI•Ð€ô¥¹ÁÕÐ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€½¹ÍÐÍ•…É¡…¹‘¥‘…Ñ•Ì€ô‰ÕÑÑ½¹Ì¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø(€€€€€€€€€€¿ªÊ²%qqÌ«®Â=qqÌ«²z²ÂÁñ{ªÊ²$‘ñ{ªÊ²'¶VcªâÀ‘óšBsžÒ‰óš~—¢¾‰ñÍ•…É ½¤¹Ñ•ÍÐ¡MÑÉ¥¹œ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤¹ÑÉ¥´ ¤¤(€€€€€€€€¤ì(€€€€€€€½¹ÍÐÍ•…É €ô•á…ÑM•…É¡	ÕÑÑ½¸ñðÍ•…É¡…¹‘¥‘…Ñ•Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôøì(€€€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€É•ÑÕÉ¸5…Ñ ¹…‰Ì ¡É•Ð¹Ñ½À€¬É•Ð¹¡•¥¡Ð€¼€È¤€´€¡¥¹ÁÕÑI•Ð¹Ñ½À€¬¥¹ÁÕÑI•Ð¹¡•¥¡Ð€¼€È¤¤€ð€äÀì(€€€€€€€ô¤ñðÍ•…É¡…¹‘¥‘…Ñ•ÍlÁtì(€€€€€€€½¹ÍÐÁÉ•ÍÍ¹Ñ•È€ô€ ¤€ôøì(€€€€€€€€€¥¹ÁÕÐ¹™½ÕÌ ¤ì(€€€€€€€€€™½È€¡½¹ÍÐÑåÁ”½˜l‰­•å‘½Ý¸ˆ°€‰­•åÁÉ•ÍÌˆ°€‰­•åÕÀ‰t¤ì(€€€€€€€€€€€¥¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü-•å‰½…É‘Ù•¹Ð¡ÑåÁ”°ì(€€€€€€€€€€€€€­•äè€‰¹Ñ•Èˆ°(€€€€€€€€€€€€€½‘”è€‰¹Ñ•Èˆ°(€€€€€€€€€€€€€­•å½‘”è€ÄÌ°(€€€€€€€€€€€€€Ý¡¥ è€ÄÌ°(€€€€€€€€€€€€€‰Õ‰‰±•ÌèÑÉÕ”°(€€€€€€€€€€€€€…¹•±…‰±”èÑÉÕ”(€€€€€€€€€€€ô¤¤ì(€€€€€€€€€ô(€€€€€€€ôì(€€€€€€€½¹ÍÐÝ…¥Ñ½ÉM•…É¡UÁ‘…Ñ”€ô…Íå¹Œ€ ¤€ôøì(€€€€€€€€€±•ÐÍÑ…‰±•M¥¹…ÑÕÉ”€ô€ˆˆì(€€€€€€€€€±•ÐÍÑ…‰±•½Õ¹Ð€ô€Àì(€€€€€€€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ØÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€€€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€€€€€€€½¹ÍÐÕÉÉ•¹Ð€ôÉ•…‘M•…É¡MÑ…Ñ” ¤ì(€€€€€€€€€€€½¹ÍÐ¡…¹•€ôÕÉÉ•¹Ð¹É½ÝQ•áÐ€„ôô‰•™½É•M•…É ¹É½ÝQ•áÐñðÕÉÉ•¹Ð¹Ñ½Ñ…±Q•áÐ€„ôô‰•™½É•M•…É ¹Ñ½Ñ…±Q•áÐì(€€€€€€€€€€€½¹ÍÐ¡…ÍI½ÝÌ€ôÕÉÉ•¹Ð¹É½ÝQ•áÐ¹±•¹Ñ €ø€Àì(€€€€€€€€€€€½¹ÍÐ‰É…¹‘5…Ñ¡•€ô¡…ÍI•ÅÕ•ÍÑ•‘	É…¹¡ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€€¼¼I•ÍÕ±ÐÉ½ÝÌ‘¼¹½Ð½¹Í¥ÍÑ•¹Ñ±äÉ•Á•…ÐÑ¡”‰É…¹±…‰•°¸É•…°(€€€€€€€€€€€€¼¼‰•™½É”½…™Ñ•ÈÉ¥¡…¹”¥ÌÙ…±¥•Ù¥‘•¹”™½È•Ù•Éä‰É…¹ì…¸(€€€€€€€€€€€€¼¼Õ¹¡…¹•ÍÑ…±”É¥ÍÑ¥±°É•ÅÕ¥É•ÌÑ¡”ÍÑÉ¥Ð‰É…¹µ…Ñ ¸(€€€€€€€€€€€½¹ÍÐÉ•ÍÕ±ÑUÁ‘…Ñ•€ô¡…¹•€˜˜ÕÉÉ•¹Ð¹É½ÝQ•áÑÌ¹±•¹Ñ €ø€Àì(€€€€€€€€€€€½¹ÍÐÍ•…É¡I•ÍÕ±Ñ½¹™¥Éµ•€ô‰É…¹‘5…Ñ¡•ñðÉ•ÍÕ±ÑUÁ‘…Ñ•ì(€€€€€€€€€€€½¹ÍÐÍ¥¹…ÑÕÉ”€ôÕÉÉ•¹Ð¹Ñ½Ñ…±Q•áÐ€¬€‰qq¸ˆ€¬ÕÉÉ•¹Ð¹É½ÝQ•áÐì(€€€€€€€€€€€€¼¼Q¡”Ý½É­¥¹œM•±±•È•¹Ñ•È­••ÁÌÑ¡”Ù¥Í¥‰±”€‹²Òt€ä°äÀÃªÆÐˆ±…‰•°(€€€€€€€€€€€€¼¼Õ¹¡…¹•…™Ñ•È„Í•…É ¸Q¡”É•¹‘•É•ÁÉ½‘ÕÐÉ½ÝÌ…É”Ñ¡”(€€€€€€€€€€€€¼¼…ÕÑ¡½É¥Ñ…Ñ¥Ù”Í¥¹…°Ñ¡…ÐÑ¡”‰É…¹Í•…É ½µÁ±•Ñ•¸(€€€€€€€€€€€€¼¼Q¡”Á¡åÍ¥…°±¥¬¡…ÁÁ•¹Ì‰•™½É”Ñ¡¥ÌÙ•É¥™¥•ÈÍÑ…ÉÑÌ¸=¸„(€€€€€€€€€€€€¼¼™…ÍÐÉ•ÍÁ½¹Í”Ñ¡”™¥ÉÍÐÍ¹…ÁÍ¡½Ð…¸…±É•…‘ä‰”Ñ¡”™¥±Ñ•É•(€€€€€€€€€€€€¼¼É•ÍÕ±Ð°Í¼µ…Ñ¡¥¹œÉ½ÝÌ…É”…ÕÑ¡½É¥Ñ…Ñ¥Ù”•Ù•¸Ý¡•¸Ñ¡”=4¹¼(€€€€€€€€€€€€¼¼±½¹•È‘¥™™•ÉÌ™É½´Ñ¡…ÐÍ¹…ÁÍ¡½Ð¸(€€€€€€€€€€€½¹ÍÐÉ•ÅÕ•ÍÑ•‘%¹ÁÕÑ½¹™¥Éµ•€ô¹½Éµ…±¥é”¡¥¹ÁÕÐ¹Ù…±Õ”¤¹Ñ½1½…±•1½Ý•É…Í” ¤(€€€€€€€€€€€€€€ôôô¹½Éµ…±¥é” ‘í)M=8¹ÍÑÉ¥¹¥™ä¡Í•±±•É	É…¹‘M•…É¡9…µ”¥ô¤¹Ñ½1½…±•1½Ý•É…Í” ¤ì(€€€€€€€€€€€€¼¼ÍÕ‰µ¥ÑÑ•¥¹ÁÕÐ¥Ì¹½ÐÁÉ½½˜Ñ¡…ÐA=%i=8¡…¹•Ñ¡”É•ÍÕ±Ð¸(€€€€€€€€€€€€¼¼áÁ½ÉÐ½¹±ä…™Ñ•ÈÑ¡”É•¹‘•É•ÁÉ½‘ÕÐÉ½ÝÌ…ÑÕ…±±äµ…Ñ Ñ¡”(€€€€€€€€€€€€¼¼É•ÅÕ•ÍÑ•‰É…¹ì½Ñ¡•ÉÝ¥Í”Ñ¡”ÁÉ•Ù¥½ÕÌ‰É…¹…¸‰”•áÁ½ÉÑ•¸(€€€€€€€€€€€¥˜€¡¡…ÍI½ÝÌ€˜˜Í•…É¡I•ÍÕ±Ñ½¹™¥Éµ•€˜˜É•ÅÕ•ÍÑ•‘%¹ÁÕÑ½¹™¥Éµ•¤ì(€€€€€€€€€€€€€ÍÑ…‰±•½Õ¹Ð€ôÍ¥¹…ÑÕÉ”€ôôôÍÑ…‰±•M¥¹…ÑÕÉ”€üÍÑ…‰±•½Õ¹Ð€¬€Ä€è€Äì(€€€€€€€€€€€€€ÍÑ…‰±•M¥¹…ÑÕÉ”€ôÍ¥¹…ÑÕÉ”ì(€€€€€€€€€€€€€¥˜€¡ÍÑ…‰±•½Õ¹Ð€øô€Ì¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€ÍÑ…‰±•½Õ¹Ð€ô€Àì(€€€€€€€€€€€€€ÍÑ…‰±•M¥¹…ÑÕÉ”€ô€ˆˆì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€ôì(€€€€€€€½¹ÍÐ…±É•…‘åMÕ‰µ¥ÑÑ•€ô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡	½½±•…¸¡Í•…É¡±É•…‘åMÕ‰µ¥ÑÑ•¤¥ôì(€€€€€€€¥˜€ ……±É•…‘åMÕ‰µ¥ÑÑ•¤ì(€€€€€€€€€¥˜€¡Í•…É ¤±¥­1¥­•UÍ•È¡Í•…É ¤ì(€€€€€€€€€•±Í”ÁÉ•ÍÍ¹Ñ•È ¤ì(€€€€€€€ô(€€€€€€€±•ÐÍ•…É¡ÁÁ±¥•€ô…Ý…¥ÐÝ…¥Ñ½ÉM•…É¡UÁ‘…Ñ” ¤ì(€€€€€€€¥˜€ …Í•…É¡ÁÁ±¥•€˜˜€……±É•…‘åMÕ‰µ¥ÑÑ•¤ì(€€€€€€€€€ÁÉ•ÍÍ¹Ñ•È ¤ì(€€€€€€€€€Í•…É¡ÁÁ±¥•€ô…Ý…¥ÐÝ…¥Ñ½ÉM•…É¡UÁ‘…Ñ” ¤ì(€€€€€€€ô(€€€€€€€¥˜€ …Í•…É¡ÁÁ±¥•€˜˜€……±É•…‘åMÕ‰µ¥ÑÑ•€˜˜Í•…É ¤ì(€€€€€€€€€±¥­1¥­•UÍ•È¡Í•…É ¤ì(€€€€€€€€€Í•…É¡ÁÁ±¥•€ô…Ý…¥ÐÝ…¥Ñ½ÉM•…É¡UÁ‘…Ñ” ¤ì(€€€€€€€ô(€€€€€€€¥˜€ …Í•…É¡ÁÁ±¥•(€€€€€€€€€€˜˜€‘í)M=8¹ÍÑÉ¥¹¥™ä¡‰É…¹‘-½%¹ÁÕÐ¥ô€„ôô€ˆˆ(€€€€€€€€€€˜˜€‘í)M=8¹ÍÑÉ¥¹¥™ä¡‰É…¹‘-½%¹ÁÕÐ¥ô€„ôô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡‰É…¹‘9…µ”¥ô¤ì(€€€€€€€€€…ÁÁ±åY…±Õ” ˆˆ¤ì(€€€€€€€€€…Ý…¥ÐÝ…¥Ð ÄØÀ¤ì(€€€€€€€€€…ÁÁ±åY…±Õ” ‘í)M=8¹ÍÑÉ¥¹¥™ä¡‰É…¹‘-½%¹ÁÕÐ¥ô¤ì(€€€€€€€€€…Ý…¥ÐÝ…¥Ð ÜÀÀ¤ì(€€€€€€€€€¥˜€¡Í•…É ¤±¥­1¥­•UÍ•È¡Í•…É ¤ì(€€€€€€€€€•±Í”ÁÉ•ÍÍ¹Ñ•È ¤ì(€€€€€€€€€Í•…É¡ÁÁ±¥•€ô…Ý…¥ÐÝ…¥Ñ½ÉM•…É¡UÁ‘…Ñ” ¤ì(€€€€€€€€€¥˜€ …Í•…É¡ÁÁ±¥•¤ì(€€€€€€€€€€€ÁÉ•ÍÍ¹Ñ•È ¤ì(€€€€€€€€€€€Í•…É¡ÁÁ±¥•€ô…Ý…¥ÐÝ…¥Ñ½ÉM•…É¡UÁ‘…Ñ” ¤ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€€€¥˜€ …Í•…É¡ÁÁ±¥•¤ì(€€€€€€€€€½¹ÍÐÕÉÉ•¹Ð€ôÉ•…‘M•…É¡MÑ…Ñ” ¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€½¬è™…±Í”°(€€€€€€€€€€€ÍÑ•Àè¡…ÍI•ÅÕ•ÍÑ•‘	É…¹¡ÕÉÉ•¹Ð¤€ü€‰MI!}IMU1Q}9=Q}UAQˆ€è€‰	I9}IMU1Q}5%M5Q ˆ°(€€€€€€€€€€€‰•™½É•Q½Ñ…°è‰•™½É•M•…É ¹Ñ½Ñ…±½Õ¹Ð°(€€€€€€€€€€€ÕÉÉ•¹ÑQ½Ñ…°èÕÉÉ•¹Ð¹Ñ½Ñ…±½Õ¹Ð(€€€€€€€€€ôì(€€€€€€€ô((€€€€€€€€¼¼Q¡”É•µ…¥¹¥¹œ½¹ÑÉ½±ÌµÕÍÐ‰”½Á•É…Ñ•Ñ¡É½Õ Ñ¡”Ù¥Í¥‰±”]¥¹‘½ÝÌ(€€€€€€€€¼¼ÕÉÍ½È¸I•ÑÕÉ¸…™Ñ•ÈÑ¡”ÁÉ½‘ÕÐÍ•…É ¡…Ì…ÑÕ…±±äÕÁ‘…Ñ•Í¼Ñ¡”(€€€€€€€€¼¼½ÕÑ•ÈÝ½É­™±½Ü…¸Á•É™½É´Í½ÉÑ¥¹œ…¹•áÁ½ÉÐÁ¡åÍ¥…±±ä¸(€€€€€€€½¹ÍÐÍ•…É¡•‘MÑ…Ñ”€ôÉ•…‘M•…É¡MÑ…Ñ” ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€½¬èÑÉÕ”°(€€€€€€€€€¥¹ÁÕÑY…±Õ”èMÑÉ¥¹œ¡¥¹ÁÕÐ¹Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€€€€€É•ÍÕ±ÑI½Ý½Õ¹ÐèÍ•…É¡•‘MÑ…Ñ”¹É½ÝQ•áÑÌ¹±•¹Ñ °(€€€€€€€€€™¥ÉÍÑI•ÍÕ±ÐèÍ•…É¡•‘MÑ…Ñ”¹É½ÝQ•áÑÍlÁtñð€ˆˆ°(€€€€€€€ôì((€€€½¹ÍÐ±½…±M…±•ÍA…ÑÑ•É¸€ô€½qqÕØÀÑqqÕåÁqqÌ©qqÕÌÄÁqqÕåÑqqÕÜäÁqqÌ©qqÕÕqqÕqqÌ¨ÌÁqqÕÜÝqqÌ©qqÕÌÄÁqqÕåÑqqÕÝä¼ì(€€€½¹ÍÐ±½…±M…±•Í!•…‘•ÉQ•áÐ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€‰Ñ °mÉ½±”ô½±Õµ¹¡•…‘•Èt°Ñ¡•…Ñ°Ñ¡•…‘¥Øˆ(€€€€¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø±½…±M…±•ÍA…ÑÑ•É¸¹Ñ•ÍÐ¡Ñ•áÑ=˜¡•±•µ•¹Ð¤¤¤(€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø„¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €´ˆ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ ¥lÁtì(€€€¥˜€ …±½…±M…±•Í!•…‘•ÉQ•áÐ¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°ÍÑ•Àè€‰1=1}M11I|ÌÁ}=1U59}9=Q}=U9ˆôì(€€€ô((€€€±•Ð±½…±M…±•Í!•…‘•È€ô±½…±M…±•Í!•…‘•ÉQ•áÐ¹±½Í•ÍÐ (€€€€€€‰Ñ °mÉ½±”ô½±Õµ¹¡•…‘•Èt°Ñ¡•…Ñˆ(€€€€¤ì(€€€¥˜€ …±½…±M…±•Í!•…‘•È¤ì(€€€€€±½…±M…±•Í!•…‘•È€ô±½…±M…±•Í!•…‘•ÉQ•áÐì(€€€€€™½È€¡±•Ð‘•ÁÑ €ô€Àì‘•ÁÑ €ð€Ø€˜˜±½…±M…±•Í!•…‘•È¹Á…É•¹Ñ±•µ•¹Ðì‘•ÁÑ €¬ô€Ä¤ì(€€€€€€€½¹ÍÐÁ…É•¹Ð€ô±½…±M…±•Í!•…‘•È¹Á…É•¹Ñ±•µ•¹Ðì(€€€€€€€½¹ÍÐÉ•Ð€ôÁ…É•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€¥˜€¡É•Ð¹Ý¥‘Ñ €ø€ÜÀ€˜˜É•Ð¹Ý¥‘Ñ €ð€ÌØÀ€˜˜±½…±M…±•ÍA…ÑÑ•É¸¹Ñ•ÍÐ¡Ñ•áÑ=˜¡Á…É•¹Ð¤¤¤ì(€€€€€€€€€±½…±M…±•Í!•…‘•È€ôÁ…É•¹Ðì(€€€€€€€ô•±Í”ì(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€ô(€€€ô((€€€½¹ÍÐÑ•áÑI•Ð€ô±½…±M…±•Í!•…‘•ÉQ•áÐ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€½¹ÍÐ¡•…‘•ÉI•Ð€ô±½…±M…±•Í!•…‘•È¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€½¹ÍÐ¡•…‘•ÉM•…É¡I½½Ð€ô±½…±M…±•Í!•…‘•È¹±½Í•ÍÐ ‰Ñ¡•…°mÉ½±”ôÉ½Ütˆ¤(€€€€€ñð±½…±M…±•Í!•…‘•È¹Á…É•¹Ñ±•µ•¹Ð(€€€€€ñð‘½Õµ•¹Ðì((€€€½¹ÍÐÍ½É•…¹‘¥‘…Ñ”€ô€¡•±•µ•¹Ð¤€ôøì(€€€€€½¹ÍÐÑ…É•Ð€ô•±•µ•¹Ð¹±½Í•ÍÐü¸ ‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸t°m±…ÍÌ¨ôÍ½ÉÐt°m±…ÍÌ¨ô™¥±Ñ•Èt°m…É¥„µ±…‰•±t°mÑ¥Ñ±•tˆ¤(€€€€€€€ñð•±•µ•¹Ðì(€€€€€½¹ÍÐÉ•Ð€ôÑ…É•Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€½¹ÍÐ¡¥¹Ð€ôl(€€€€€€€Ñ…É•Ð¹•ÑÑÑÉ¥‰ÕÑ”ü¸ ‰…É¥„µ±…‰•°ˆ¤°(€€€€€€€Ñ…É•Ð¹•ÑÑÑÉ¥‰ÕÑ”ü¸ ‰Ñ¥Ñ±”ˆ¤°(€€€€€€€Ñ…É•Ð¹±…ÍÍ9…µ”°(€€€€€€€Ñ…É•Ð¹Ñ•áÑ½¹Ñ•¹Ð(€€€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ ˆ€ˆ¤ì(€€€€€½¹ÍÐ•¹Ñ•Éd€ô€¡¡•…‘•ÉI•Ð¹Ñ½À€¬¡•…‘•ÉI•Ð¹‰½ÑÑ½´¤€¼€Èì(€€€€€½¹ÍÐ‘¥ÍÑ…¹”€ô5…Ñ ¹…‰Ì¡É•Ð¹±•™Ð€´Ñ•áÑI•Ð¹É¥¡Ð¤€¬5…Ñ ¹…‰Ì ¡É•Ð¹Ñ½À€¬É•Ð¹‰½ÑÑ½´¤€¼€È€´•¹Ñ•Éd¤ì(€€€€€½¹ÍÐ½µÁ…Ð€ôÉ•Ð¹Ý¥‘Ñ €ø€À€˜˜É•Ð¹Ý¥‘Ñ €ðô€ÔØ€˜˜É•Ð¹¡•¥¡Ð€ø€À€˜˜É•Ð¹¡•¥¡Ð€ðô€ÔØì(€€€€€½¹ÍÐ¥¹!•…‘•È€ôÉ•Ð¹±•™Ð€øô¡•…‘•ÉI•Ð¹±•™Ð€´€à(€€€€€€€€˜˜É•Ð¹É¥¡Ð€ðô¡•…‘•ÉI•Ð¹É¥¡Ð€¬€ÄÈ(€€€€€€€€˜˜É•Ð¹Ñ½À€øô¡•…‘•ÉI•Ð¹Ñ½À€´€à(€€€€€€€€˜˜É•Ð¹‰½ÑÑ½´€ðô¡•…‘•ÉI•Ð¹‰½ÑÑ½´€¬€àì(€€€€€½¹ÍÐÉ¥¡Ñ=™!•…‘•ÉQ•áÐ€ôÉ•Ð¹±•™Ð€øôÑ•áÑI•Ð¹É¥¡Ð€´€Ø(€€€€€€€€˜˜É•Ð¹±•™Ð€ðôÑ•áÑI•Ð¹É¥¡Ð€¬€ÜÈì(€€€€€É•ÑÕÉ¸ì(€€€€€€€Ñ…É•Ð°(€€€€€€€Í½É”è€ ½Í½ÉÑñ™¥±Ñ•Éñ‘•Íñ½É‘•È½¤¹Ñ•ÍÐ¡¡¥¹Ð¤€ü€ÄÀÀ€è€À¤(€€€€€€€€€€¬€¡É¥¡Ñ=™!•…‘•ÉQ•áÐ€ü€äÀ€è€À¤(€€€€€€€€€€¬€¡½µÁ…Ð€ü€ÐÔ€è€À¤(€€€€€€€€€€¬€¡¥¹!•…‘•È€ü€ÌÔ€è€À¤(€€€€€€€€€€´5…Ñ ¹µ¥¸¡‘¥ÍÑ…¹”°€ÄØÀ¤(€€€€€ôì(€€€ôì((€€€½¹ÍÐ…¹‘¥‘…Ñ•5…À€ô¹•Ü5…À ¤ì(€€€™½È€¡½¹ÍÐ•±•µ•¹Ð½˜¡•…‘•ÉM•…É¡I½½Ð¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸t°m±…ÍÌ¨ôÍ½ÉÐt°m±…ÍÌ¨ô™¥±Ñ•Èt°m…É¥„µ±…‰•±t°mÑ¥Ñ±•t°ÍÙœ°¤°ÍÁ…¸ˆ(€€€€¤¤ì(€€€€€¥˜€ …Ù¥Í¥‰±”¡•±•µ•¹Ð¤¤½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐ…¹‘¥‘…Ñ”€ôÍ½É•…¹‘¥‘…Ñ”¡•±•µ•¹Ð¤ì(€€€€€¥˜€ ……¹‘¥‘…Ñ•5…À¹¡…Ì¡…¹‘¥‘…Ñ”¹Ñ…É•Ð¤¤ì(€€€€€€€…¹‘¥‘…Ñ•5…À¹Í•Ð¡…¹‘¥‘…Ñ”¹Ñ…É•Ð°…¹‘¥‘…Ñ”¤ì(€€€€€ô(€€€ô(€€€½¹ÍÐÍ½ÉÑ…¹‘¥‘…Ñ•Ì€ôl¸¸¹…¹‘¥‘…Ñ•5…À¹Ù…±Õ•Ì ¥t(€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹Í½É”€´„¹Í½É”¤(€€€€€€¹Í±¥” À°€ÄÈ¤(€€€€€€¹µ…À ¡•¹ÑÉä¤€ôø•¹ÑÉä¹Ñ…É•Ð¤ì((€€€½¹ÍÐ•¹Ñ•Éd€ô€¡¡•…‘•ÉI•Ð¹Ñ½À€¬¡•…‘•ÉI•Ð¹‰½ÑÑ½´¤€¼€Èì(€€€½¹ÍÐÁÉ½‰•A½¥¹ÑÌ€ôl(€€€€€mÑ•áÑI•Ð¹É¥¡Ð€¬€Ø°•¹Ñ•Éet°(€€€€€mÑ•áÑI•Ð¹É¥¡Ð€¬€ÄÌ°•¹Ñ•Éet°(€€€€€mÑ•áÑI•Ð¹É¥¡Ð€¬€ÈÄ°•¹Ñ•Éet°(€€€€€m¡•…‘•ÉI•Ð¹É¥¡Ð€´€à°•¹Ñ•Éet°(€€€€€m¡•…‘•ÉI•Ð¹É¥¡Ð€´€ÄÔ°•¹Ñ•Éet°(€€€€€m¡•…‘•ÉI•Ð¹É¥¡Ð€´€ÄÀ°¡•…‘•ÉI•Ð¹‰½ÑÑ½´€´€ÄÁt(€€€tì((€€€½¹ÍÐ‘•Í•¹‘¥¹A…ÑÑ•É¸€ô€½yqÕÁÑqÕå	qÕÈáqÕÈÅ¼ì(€€€½¹ÍÐ™¥¹‘•Í•¹‘¥¹œ€ô€ ¤€ôøl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸t°mÉ½±”ôµ•¹Õ¥Ñ•´t°±…‰•°°±¤°ÍÁ…¸°‘¥Øˆ(€€€€¥t¹™¥¹ ¡•°¤€ôøÙ¥Í¥‰±”¡•°¤€˜˜‘•Í•¹‘¥¹A…ÑÑ•É¸¹Ñ•ÍÐ¡¹½Éµ…±¥é”¡•°¹Ñ•áÑ½¹Ñ•¹Ð¤¤¤ì((€€€½¹ÍÐ±¥­Ð€ô€¡à°ä¤€ôøì(€€€€€½¹ÍÐÑ…É•Ð€ô‘½Õµ•¹Ð¹•±•µ•¹ÑÉ½µA½¥¹Ð¡à°ä¤ì(€€€€€¥˜€ …Ñ…É•Ð¤É•ÑÕÉ¸™…±Í”ì(€€€€€Ñ…É•Ð¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü5½ÕÍ•Ù•¹Ð ‰µ½ÕÍ•‘½Ý¸ˆ°ì‰Õ‰‰±•ÌèÑÉÕ”°±¥•¹Ñ`èà°±¥•¹Ñdèäô¤¤ì(€€€€€Ñ…É•Ð¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü5½ÕÍ•Ù•¹Ð ‰µ½ÕÍ•ÕÀˆ°ì‰Õ‰‰±•ÌèÑÉÕ”°±¥•¹Ñ`èà°±¥•¹Ñdèäô¤¤ì(€€€€€Ñ…É•Ð¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•Ü5½ÕÍ•Ù•¹Ð ‰±¥¬ˆ°ì‰Õ‰‰±•ÌèÑÉÕ”°±¥•¹Ñ`èà°±¥•¹Ñdèäô¤¤ì(€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€ôì((€€€±•Ð‘•Í•¹‘¥¹œ€ô™¥¹‘•Í•¹‘¥¹œ ¤ì(€€€™½È€¡½¹ÍÐ…¹‘¥‘…Ñ”½˜Í½ÉÑ…¹‘¥‘…Ñ•Ì¤ì(€€€€€¥˜€¡‘•Í•¹‘¥¹œ¤‰É•…¬ì(€€€€€±¥­1¥­•UÍ•È¡…¹‘¥‘…Ñ”¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÐÔÀ¤ì(€€€€€‘•Í•¹‘¥¹œ€ô™¥¹‘•Í•¹‘¥¹œ ¤ì(€€€ô(€€€™½È€¡½¹ÍÐmà°åt½˜ÁÉ½‰•A½¥¹ÑÌ¤ì(€€€€€¥˜€¡‘•Í•¹‘¥¹œ¤‰É•…¬ì(€€€€€±¥­Ð¡à°ä¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÐÔÀ¤ì(€€€€€‘•Í•¹‘¥¹œ€ô™¥¹‘•Í•¹‘¥¹œ ¤ì(€€€ô(€€€¥˜€ …‘•Í•¹‘¥¹œ¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰1=1}M1M}M=IQ}%=9}9=Q}=U9ˆôì(€€€ô((€€€±¥­1¥­•UÍ•È¡‘•Í•¹‘¥¹œ¤ì(€€€…Ý…¥ÐÝ…¥Ð ÌÔÀ¤ì((€€€½¹ÍÐ½¹™¥ÉµA…ÑÑ•É¸€ô€½yqÕØÔÕqÕÜÜà¼ì(€€€½¹ÍÐ™¥¹‘½¹™¥É´€ô€ ¤€ôøl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸t°„°ÍÁ…¸°‘¥Øˆ(€€€€¥t¹™¥¹ ¡•°¤€ôøÙ¥Í¥‰±”¡•°¤€˜˜½¹™¥ÉµA…ÑÑ•É¸¹Ñ•ÍÐ¡¹½Éµ…±¥é”¡•°¹Ñ•áÑ½¹Ñ•¹Ð¤¤¤ì(€€€±•Ð½¹™¥Éµ½¹ÑÉ½°€ô™¥¹‘½¹™¥É´ ¤ì(€€€¥˜€ …½¹™¥Éµ½¹ÑÉ½°¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰1=1}M1M}M=IQ}=9%I5}9=Q}=U9ˆôì(€€€ô(€€€±¥­1¥­•UÍ•È¡½¹™¥Éµ½¹ÑÉ½°¤ì(€€€…Ý…¥ÐÝ…¥Ð ÜÀÀ¤ì(€€€½¹™¥Éµ½¹ÑÉ½°€ô™¥¹‘½¹™¥É´ ¤ì(€€€¥˜€¡½¹™¥Éµ½¹ÑÉ½°¤ì(€€€€€±¥­1¥­•UÍ•È¡½¹™¥Éµ½¹ÑÉ½°¤ì(€€€€€…Ý…¥ÐÝ…¥Ð äÀÀ¤ì(€€€ô((€€€±•Ð•áÁ½ÉÑ	ÕÑÑ½¸€ô¹Õ±°ì(€€€½¹ÍÐ•áÁ½ÉÑA…ÑÑ•É¸€ô€½yqÕàÀÑqÕÑqÌ©qÕÁÑqÕ	ÑqÕÁÑqÕÌÀ¼ì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÄÈ€˜˜€…•áÁ½ÉÑ	ÕÑÑ½¸ì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€•áÁ½ÉÑ	ÕÑÑ½¸€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸°mÉ½±”ô‰ÕÑÑ½¸t°„°ÍÁ…¸ˆ¥t(€€€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôøÙ¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜•áÁ½ÉÑA…ÑÑ•É¸¹Ñ•ÍÐ¡¹½Éµ…±¥é”¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¤¤¤ì(€€€€€¥˜€ …•áÁ½ÉÑ	ÕÑÑ½¸¤…Ý…¥ÐÝ…¥Ð ÐÀÀ¤ì(€€€ô(€€€¥˜€ …•áÁ½ÉÑ	ÕÑÑ½¸¤É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰aA=IQ}	UQQ=9}9=Q}=U9}QI}M=IPˆôì(€€€¥˜€¡•áÁ½ÉÑ	ÕÑÑ½¸¹‘¥Í…‰±•ñð•áÁ½ÉÑ	ÕÑÑ½¸¹•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ‘¥Í…‰±•ˆ¤€ôôô€‰ÑÉÕ”ˆ¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰aA=IQ}	UQQ=9}%M	1}QI}M=IPˆôì(€€€ô(€€€±¥­1¥­•UÍ•È¡•áÁ½ÉÑ	ÕÑÑ½¸¤ì(€€€…Ý…¥ÐÝ…¥Ð ÔÀÀ¤ì(€€€½¹ÍÐÙ•É¥™¥•‘MÑ…Ñ”€ôÉ•…‘M•…É¡MÑ…Ñ” ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬èÑÉÕ”°(€€€€€Í½ÉÐè€‰1=1}M11I}I9Q|ÌÁ}eM}Mˆ°(€€€€€•áÁ½ÉÑ±¥­•èÑÉÕ”°(€€€€€¥¹ÁÕÑY…±Õ”èMÑÉ¥¹œ¡¥¹ÁÕÐ¹Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€É•ÍÕ±ÑI½Ý½Õ¹ÐèÙ•É¥™¥•‘MÑ…Ñ”¹É½ÝQ•áÑÌ¹±•¹Ñ °(€€€€€™¥ÉÍÑI•ÍÕ±ÐèÙ•É¥™¥•‘MÑ…Ñ”¹É½ÝQ•áÑÍlÁtñð€ˆˆ°(€€€ôì(€ô¤ ¥€°ÑÉÕ”¤ì(€±•ÐÍ•…É¡•€ô¹Õ±°ì(€±•Ð±…ÍÑM•…É¡¥…¹½ÍÑ¥Ì€ô¹Õ±°ì(€±•Ð•áÁ½ÉÑ­¹½Ý±•‘•‘Ð€ô€Àì(€™½È€¡±•ÐÍ•…É¡%¹ÁÕÑÑÑ•µÁÐ€ô€ÄìÍ•…É¡%¹ÁÕÑÑÑ•µÁÐ€ðô€ÄìÍ•…É¡%¹ÁÕÑÑÑ•µÁÐ€¬ô€Ä¤ì(€€€½¹ÍÐ™É…µ•Ì€ôÍ•±±•É]¥¹‘½ÝÉ…µ•Ì ¤ì(€€€½¹ÍÐ™É…µ•…¹‘¥‘…Ñ•Ì€ômtì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€€€ÍÑ…ÑÕÌè€‰ÁÉ½‰¥¹œµÍ•…É µ™É…µ”ˆ°(€€€€€‰É…¹‘9…µ”°(€€€€€©½‰MÑ…Ñ”è€ˆÇ®.£ªÎ¼Ôƒ
Üƒ²¶J#ªÊ²$ƒ²z®‚—²Âôƒ²^ÃªÊÀƒ²’Dˆ°(€€€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
Üƒ²vG®.×¶Vc²ž ƒ²V+®*PA=%i=8ƒ®
Ó®Ú ƒ¶R®‚#²z²v €Ó²Ò ƒ¶nƒªÆÓ®#®r®.#®.¹€°(€€€ô¤ì(€€€½¹ÍÐÁÉ½‰•‘É…µ•Ì€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡™É…µ•Ì¹µ…À¡…Íå¹Œ€¡™É…µ”¤€ôøì(€€€€€½¹ÍÐÁÉ½‰”€ô…Ý…¥Ð•á•ÕÑ•M•±±•ÉÉ…µ•]¥Ñ¡Q¥µ•½ÕÐ¡™É…µ”°€  ¤€ôøì(€€€€€€€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€€€€€€€½¹ÍÐ¥¹ÁÕÑÌ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÐ°Ñ•áÑ…É•„ˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø€…•±•µ•¹Ð¹‘¥Í…‰±•€˜˜€…•±•µ•¹Ð¹É•…‘=¹±ä¤ì(€€€€€€€€€½¹ÍÐ‰½‘ä€ôMÑÉ¥¹œ¡‘½Õµ•¹Ð¹‰½‘äü¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¹Í±¥” À°€ÄÈÀÀ¤ì(€€€€€€€€€½¹ÍÐ¡¥¹Ð€ô€¿²¶J!ó®â3®zs®Nqó¶J#®Ê!óªÊ²%ñMAUñM-UñÁÉ½‘ÕÑñ‰É…¹‘ó–V–Nó–Nž&1ó¢ÒŸ–>ÝóšBsžÒˆ½¤¹Ñ•ÍÐ¡‰½‘ä¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€ÕÉ°è±½…Ñ¥½¸¹¡É•˜°(€€€€€€€€€€€Ñ¥Ñ±”è‘½Õµ•¹Ð¹Ñ¥Ñ±”°(€€€€€€€€€€€É•…‘åMÑ…Ñ”è‘½Õµ•¹Ð¹É•…‘åMÑ…Ñ”°(€€€€€€€€€€€¥¹ÁÕÑ½Õ¹Ðè¥¹ÁÕÑÌ¹±•¹Ñ °(€€€€€€€€€€€¡¥¹Ð°(€€€€€€€€€€€±½¥¸è€½±½¥¹ñÍ¥¹¥¹ñÁ…ÍÍÁ½ÉÐ½¤¹Ñ•ÍÐ¡±½…Ñ¥½¸¹¡É•˜¤°(€€€€€€€€€ôì(€€€€€€€ô¤ ¥€°€Ñ|ÀÀÀ°¹Õ±°¤ì(€€€€€É•ÑÕÉ¸ÁÉ½‰”€üì™É…µ”°ÁÉ½‰”ô€è¹Õ±°ì(€€€ô¤¤ì(€€€™É…µ•…¹‘¥‘…Ñ•Ì¹ÁÕÍ  ¸¸¹ÁÉ½‰•‘É…µ•Ì¹™¥±Ñ•È¡	½½±•…¸¤¤ì(€€€™É…µ•…¹‘¥‘…Ñ•Ì¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø(€€€€€9Õµ‰•È¡É¥¡Ð¹ÁÉ½‰”ü¹¥¹ÁÕÑ½Õ¹Ð€ø€À¤€´9Õµ‰•È¡±•™Ð¹ÁÉ½‰”ü¹¥¹ÁÕÑ½Õ¹Ð€ø€À¤(€€€€€ñð9Õµ‰•È¡É¥¡Ð¹ÁÉ½‰”ü¹¡¥¹Ð¤€´9Õµ‰•È¡±•™Ð¹ÁÉ½‰”ü¹¡¥¹Ð¤(€€€€€ñð9Õµ‰•È¡É¥¡Ð¹™É…µ”¹É½ÕÑ¥¹%€ôôôÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹µ…¥¹É…µ”¹É½ÕÑ¥¹%¤(€€€€€€€€´9Õµ‰•È¡±•™Ð¹™É…µ”¹É½ÕÑ¥¹%€ôôôÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹µ…¥¹É…µ”¹É½ÕÑ¥¹%¤(€€€€¤ì(€€€½¹ÍÐ±½¥¹É…µ”€ô™É…µ•…¹‘¥‘…Ñ•Ì¹™¥¹ ¡…¹‘¥‘…Ñ”¤€ôø…¹‘¥‘…Ñ”¹ÁÉ½‰”ü¹±½¥¸¤ì(€€€¥˜€¡±½¥¹É…µ”¤ì(€€€€€Í•…É¡•€ôì½¬è™…±Í”°ÍÑ•Àè€‰M11I}1=%9}IEU%Iˆ°‘¥…¹½ÍÑ¥Ìè±½¥¹É…µ”¹ÁÉ½‰”ôì(€€€€€‰É•…¬ì(€€€ô(€€€™½È€¡½¹ÍÐ…¹‘¥‘…Ñ”½˜™É…µ•…¹‘¥‘…Ñ•Ì¤ì(€€€€€¥˜€ ……¹‘¥‘…Ñ”¹ÁÉ½‰”ü¹¥¹ÁÕÑ½Õ¹Ð€˜˜€……¹‘¥‘…Ñ”¹ÁÉ½‰”ü¹¡¥¹Ð¤½¹Ñ¥¹Õ”ì(€€€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€€€€€ÍÑ…ÑÕÌè€‰Í•…É¡¥¹œµ‰É…¹µÁÉ½‘ÕÑÌˆ°(€€€€€€€‰É…¹‘9…µ”°(€€€€€€€©½‰MÑ…Ñ”è€Ç®.£ªÎ¼Ôƒ
Üƒ®â3®zs®Npƒ²z®‚—
ß²¶J ƒªÊ²$ƒ²’Dƒ
Ü€‘í‰É…¹‘9…µ•õ€°(€€€€€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
ÜƒªâÃ²†ÐƒªÊ²$ƒ²s®æ²*ƒ®Â§².w²ró®†pƒ®â3®zs®Ns®–ðƒ²z®‚—¶VcªÎ€ƒªÊ²'²vƒ².“¶Z'¶V§®.#®.¹€°(€€€€€ô¤ì(€€€€€€¼¼I•ÍÑ½É”Ñ¡”ÁÉ½Ù•¸ÁÉ”µµ½‘Õ±”M•±±•È•¹Ñ•ÈÉ½ÕÑ”…Ì½¹”Õ¹¥¹Ñ•ÉÉÕÁÑ•(€€€€€€¼¼½Á•É…Ñ¥½¸è•¹Ñ•ÈÑ¡”‰É…¹¥¸Ñ¡”¡¥‘‘•¸ÁÉ½‘ÕÐµÍ•…É É•¹‘•É•È°±¥¬(€€€€€€¼¼ƒªÊ²$ƒ®Â<ƒ²z²ÂÀ°Ù•É¥™äÑ¡”É•ÍÕ±Ð°Í½ÉÐ°…¹•áÁ½ÉÐ¥¸Ñ¡”Í…µ”Ý¥¹‘½Ü¸(€€€€€½¹ÍÐÉ•…±-•å‰½…É‘%¹ÁÕÐ€ô…Ý…¥ÐÑåÁ•M•±±•É	É…¹‘]¥Ñ¡I•…±-•å‰½…É¡…¹‘¥‘…Ñ”¹™É…µ”°Í•±±•É	É…¹‘M•…É¡9…µ”¤(€€€€€€€€¹…Ñ   ¤€ôø€¡ì½¬è™…±Í”°ÍÑ•Àè€‰I1}-e	=I}%9AUQ}%1ˆô¤¤ì(€€€€€¥˜€¡Í•±±•É]¥¹‘½Ü€˜˜€…Í•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤Í•±±•É]¥¹‘½Ü¹¡¥‘” ¤ì(€€€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€€€€€ÍÑ…ÑÕÌèÉ•…±-•å‰½…É‘%¹ÁÕÐü¹½¬€ü€‰Í•±±•Èµ‰É…¹µ¥¹ÁÕÐµ½¹™¥Éµ•ˆ€è€‰Í•±±•Èµ‰É…¹µ¥¹ÁÕÐµ™…±±‰…¬ˆ°(€€€€€€€‰É…¹‘9…µ”°(€€€€€€€©½‰MÑ…Ñ”èÉ•…±-•å‰½…É‘%¹ÁÕÐü¹½¬(€€€€€€€€€€ü€Ç®.£ªÎ¼Ôƒ
Üƒ²¶J#ªÊ²$ƒ®â3®zs®Npƒ²z®‚”ƒ²f®Ž0ƒ
Ü€‘í‰É…¹‘9…µ•õ€(€€€€€€€€€€è€Ç®.£ªÎ¼Ôƒ
Üƒ²¶J#ªÊ²$ƒ²z®‚”ƒ²z³².s®>ƒ
Ü€‘í‰É…¹‘9…µ•õ€°(€€€€€€€µ•ÍÍ…”èÉ•…±-•å‰½…É‘%¹ÁÕÐü¹½¬(€€€€€€€€€€ü€‘í‰É…¹‘9…µ•ôƒ
Üƒ¶2C®ž“²zC²ó¶Àƒ²®. ƒ²¶J#ªÊ²$ƒ²z®‚—²vƒ¶fW²vã¶VcªÎ€ƒªÊ²$ƒ®Â<ƒ²z²ÂÃ²vƒ².“¶Z'¶V§®.#®.¹€(€€€€€€€€€€è€‘í‰É…¹‘9…µ•ôƒ
Üƒ².“²‚pƒ¶
“®ÎÓ®Npƒ²z®‚—²vÐƒ¶fW²vã®Bc²ž ƒ²V+²Vƒ²zG²^²vƒ²’G®.£¶V§®.#®.¹€°(€€€€€ô¤ì(€€€€€¥˜€ …É•…±-•å‰½…É‘%¹ÁÕÐü¹½¬¤ì(€€€€€€€Í•…É¡•€ôÉ•…±-•å‰½…É‘%¹ÁÕÐñðì½¬è™…±Í”°ÍÑ•Àè€‰I1}-e	=I}%9AUQ}%1ˆôì(€€€€€€€±…ÍÑM•…É¡¥…¹½ÍÑ¥Ì€ô…¹‘¥‘…Ñ”¹ÁÉ½‰”ì(€€€€€€€‰É•…¬ì(€€€€€ô(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐAÉ½µ¥Í”¹É…”¡l(€€€€€€€€€ÉÕ¹M•±±•ÉM•…É ¡…¹‘¥‘…Ñ”¹™É…µ”°	½½±•…¸¡É•…±-•å‰½…É‘%¹ÁÕÐü¹ÍÕ‰µ¥ÑÑ•¤¤°(€€€€€€€€€¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ  ¤€ôøÉ•Í½±Ù”¡ì(€€€€€€€€€€€½¬è™…±Í”°(€€€€€€€€€€€ÍÑ•Àè€‰M11I}MI!}MQ}Q%5=UPˆ°(€€€€€€€€€ô¤°€ÜÁ|ÀÀÀ¤¤°(€€€€€€€t¤¹…Ñ  ¡•ÉÉ½È¤€ôø€¡ì(€€€€€€€€€½¬è™…±Í”°(€€€€€€€€€ÍÑ•Àè€‰M11I}MI!}MI%AQ}II=Hˆ°(€€€€€€€€€‘•Ñ…¥°èMÑÉ¥¹œ¡•ÉÉ½Èü¹µ•ÍÍ…”ñð•ÉÉ½Èñð€ˆˆ¤°(€€€€€€€ô¤¤ì(€€€€€±…ÍÑM•…É¡¥…¹½ÍÑ¥Ì€ô…¹‘¥‘…Ñ”¹ÁÉ½‰”ì(€€€€€¥˜€¡É•ÍÕ±Ðü¹½¬¤ì(€€€€€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€€€€€€€ÍÑ…ÑÕÌè€‰Ý…¥Ñ¥¹œµ™½ÈµÍ•±±•ÈµÉ•ÍÕ±Ðµ¹…Ù¥…Ñ¥½¸ˆ°(€€€€€€€€€‰É…¹‘9…µ”°(€€€€€€€€€©½‰MÑ…Ñ”è€Ë®.£ªÎ¼Ôƒ
ÜƒªÊÃªÎðƒ¶fS®¦Ðƒ²‚¶f`ƒ¶fW²vàƒ²’Dƒ
Ü€‘í‰É…¹‘9…µ•õ€°(€€€€€€€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
ÜA=%i=8ƒ¶fS®¦Ó²^C²pƒ².“²‚pƒ®ž#²jÃ²*“®†pƒªÊÃªÎðƒ¶fW²vã
ß²‚W®‚³
ß®
Ó®ÎÓ®
ÓªâÃ®–ðƒ²ž¶Z'¶V§®.#®.¸ƒ²zG²^ƒ²’G²^C®*Pƒ®ž#²jÃ²*“®–ðƒ²n²ž²vÓ²ž ƒ®ž#²ã²jP¹€°(€€€€€€€ô¤ì(€€€€€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€Å|ÈÀÀ¤¤ì(€€€€€€€½¹ÍÐÁ½ÍÑM•…É €ô…Ý…¥ÐÁ•É™½ÉµA¡åÍ¥…±M•±±•ÉM½ÉÑ¹‘áÁ½ÉÐ¡…¹‘¥‘…Ñ”¹™É…µ”¤(€€€€€€€€€€¹…Ñ  ¡•ÉÉ½È¤€ôø€¡ì(€€€€€€€€€€€½¬è™…±Í”°(€€€€€€€€€€€ÍÑ•Àè€‰A!eM%1}A=MQ}MI!}%1ˆ°(€€€€€€€€€€€‘•Ñ…¥°èMÑÉ¥¹œ¡•ÉÉ½Èü¹µ•ÍÍ…”ñð•ÉÉ½Èñð€ˆˆ¤°(€€€€€€€€€ô¤¤ì(€€€€€€€¥˜€¡Á½ÍÑM•…É ü¹½¬¤ì(€€€€€€€€€Í•±±•ÉAÉ½‘ÕÑÉ…µ•I½ÕÑ¥¹%€ô…¹‘¥‘…Ñ”¹™É…µ”¹É½ÕÑ¥¹%ì(€€€€€€€€€€¼¼A=%i=8…¸É•…Ñ”Ñ¡”•áÁ½ÉÐ©½ˆ¥µµ•‘¥…Ñ•±äÝ¡•¸€‹²‚²ÊÐƒ®
Ó®ÎÓ®
ÓªâÀˆ(€€€€€€€€€€¼¼¥Ì±¥­•°‰•™½É”€¡½ÈÝ¡¥±”¤Ñ¡”½¹™¥Éµ…Ñ¥½¸U$¥Ì½‰Í•ÉÙ•¸(€€€€€€€€€€¼¼9•Ù•ÈÉ•™É•Í Ñ¡”‰…Í•±¥¹”¡•É”è„™…ÍÐ¹•Ü©½ˆÝ½Õ±‰”É•½É‘•(€€€€€€€€€€¼¼…Ì…¸½±©½ˆ…¹½Õ±Ñ¡•¸¹•Ù•È‰”±¥¹­•Ñ¼Ñ¡¥Ì‰É…¹¸Q¡”(€€€€€€€€€€¼¼‰…Í•±¥¹”™É½é•¸‰•™½É”ÁÉ½‘ÕÐÍ•…É É•µ…¥¹Ì…ÕÑ¡½É¥Ñ…Ñ¥Ù”°Ý¡¥±”(€€€€€€€€€€¼¼Ñ¡”½¹™¥Éµ…Ñ¥½¸Ñ¥µ•ÍÑ…µÀ‰•±½ÜÉ•©•ÑÌ•¹Õ¥¹•±ä½±É½ÝÌ¸(€€€€€€€€€€¼¼±¥­¥¹œ€‹²‚²ÊÐƒ®
Ó®ÎÓ®
ÓªâÀˆ½¹±ä½Á•¹ÌA=%i=8Ì½¹™¥Éµ…Ñ¥½¸(€€€€€€€€€€¼¼‘¥…±½œ¸Q¡”½±É•‰Õ¥±ÐÁ…Ñ Í­¥ÁÁ•Ñ¡¥Ì•á¥ÍÑ¥¹œ½¹™¥Éµ…Ñ¥½¸(€€€€€€€€€€¼¼¡•±Á•È…¹Ñ¡•¸Ý…¥Ñ•Ñ¡É•”µ¥¹ÕÑ•Ì™½È„©½ˆÑ¡…Ð¡…¹•Ù•È(€€€€€€€€€€¼¼…ÑÕ…±±ä‰••¸ÍÕ‰µ¥ÑÑ•¸(€€€€€€€€€½¹ÍÐ½¹™¥Éµ…Ñ¥½¹MÑ…ÉÑ•‘Ð€ô…Ñ”¹¹½Ü ¤ì(€€€€€€€€€½¹ÍÐ½¹™¥Éµ…Ñ¥½¸€ô…Ý…¥Ð½¹™¥ÉµM•±±•ÉáÁ½ÉÑI•ÅÕ•ÍÑA¡åÍ¥…°¡…¹‘¥‘…Ñ”¹™É…µ”¤(€€€€€€€€€€€€¹…Ñ   ¤€ôø€¡ì(€€€€€€€€€€€€€½¬è™…±Í”°(€€€€€€€€€€€€€½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•è™…±Í”°(€€€€€€€€€€€€€½¹™¥Éµ…Ñ¥½¹±¥­•è™…±Í”°(€€€€€€€€€€€€€É•ÅÕ•ÍÑ­¹½Ý±•‘•è™…±Í”°(€€€€€€€€€€€ô¤¤ì(€€€€€€€€€€¼¼½±±½ÜÑ¡”Í…µ”ÁÉ½Ù•¸M•±±•È•¹Ñ•È™±½ÜÑ¡”ÕÍ•ÈÁ•É™½ÉµÌè(€€€€€€€€€€¼¼•áÁ½ÉÐ€´ø½¹™¥É´€´ø½Ý¹±½…•¹Ñ•ÈÍ¡½ÉÑÕÐ€´øÉ•…Ñ¡”©½ˆÉ½Ü¸(€€€€€€€€€€¼¼Í•Á…É…Ñ”¡¥‘‘•¸µ½¹¥Ñ½È…¸±…œ‰•¡¥¹Ñ¡”±¥Ù”MAÍ•ÍÍ¥½¸¸(€€€€€€€€€¥˜€ …½¹™¥Éµ…Ñ¥½¸ü¹É•ÅÕ•ÍÑ­¹½Ý±•‘•¤ì(€€€€€€€€€€€½¹ÍÐ‘…¥±å1¥µ¥Ð€ô…Ý…¥Ð‘•Ñ•ÑM•±±•É…¥±åM•…É¡1¥µ¥Ð ¤ì(€€€€€€€€€€€Í•…É¡•€ôì(€€€€€€€€€€€€€€¸¸¹É•ÍÕ±Ð°(€€€€€€€€€€€€€€¸¸¹Á½ÍÑM•…É °(€€€€€€€€€€€€€€¸¸¹½¹™¥Éµ…Ñ¥½¸°(€€€€€€€€€€€€€½¬è™…±Í”°(€€€€€€€€€€€€€ÍÑ•Àè‘…¥±å1¥µ¥Ð¹•á••‘•€ü€‰%1e}MI!}1%5%Q}aˆ€è€‰aA=IQ}=9%I5Q%=9}9=Q}-9=]1ˆ°(€€€€€€€€€€€€€½‘”è‘…¥±å1¥µ¥Ð¹•á••‘•€ü€‰%1e}MI!}1%5%Q}aˆ€è€‰aA=IQ}=9%I5Q%=9}9=Q}-9=]1ˆ°(€€€€€€€€€€€€€‘¥…¹½ÍÑ¥Ìè‘…¥±å1¥µ¥Ð¹•á••‘•€üìÉ•…Í½¸è‘…¥±å1¥µ¥Ð¹¹½Ñ¥”ô€èÕ¹‘•™¥¹•°(€€€€€€€€€€€ôì(€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€ô(€€€€€€€€€•áÁ½ÉÑ­¹½Ý±•‘•‘Ð€ô½¹™¥Éµ…Ñ¥½¹MÑ…ÉÑ•‘Ðì(€€€€€€€€€½¹ÍÐ‘½Ý¹±½…‘•¹Ñ•È€ô½¹™¥Éµ…Ñ¥½¸¹‘½Ý¹±½…‘•¹Ñ•É±¥­•(€€€€€€€€€€€€üì½¬èÑÉÕ”°±¥­•èÑÉÕ”°…±É•…‘å9…Ù¥…Ñ•èÑÉÕ”ô(€€€€€€€€€€€€è½¹™¥Éµ…Ñ¥½¸¹½¹™¥Éµ…Ñ¥½¹±¥­•(€€€€€€€€€€€€ü…Ý…¥Ð±¥­M•±±•É½Ý¹±½…‘•¹Ñ•ÉM¡½ÉÑÕÑA¡åÍ¥…°¡…¹‘¥‘…Ñ”¹™É…µ”¤¹…Ñ   ¤€ôø€¡ì(€€€€€€€€€€€€€½¬è™…±Í”°(€€€€€€€€€€€€€±¥­•è™…±Í”°(€€€€€€€€€€€€€½‘”è€‰=]91=}9QI}M!=IQUQ}9=Q}=U9ˆ°(€€€€€€€€€€€ô¤¤(€€€€€€€€€€€€èì½¬è™…±Í”°±¥­•è™…±Í”°½‘”è€‰aA=IQ}=9%I5Q%=9}9=Q}-9=]1ˆôì(€€€€€€€€€Í•…É¡•€ôì€¸¸¹É•ÍÕ±Ð°€¸¸¹Á½ÍÑM•…É °€¸¸¹½¹™¥Éµ…Ñ¥½¸°‘½Ý¹±½…‘•¹Ñ•È°½¬èÑÉÕ”ôì(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€€€Í•…É¡•€ôÁ½ÍÑM•…É ì(€€€€€€€‰É•…¬ì(€€€€€ô(€€€€€¥˜€¡É•ÍÕ±Ðü¹ÍÑ•À€„ôô€‰MI!}%9AUQ}9=Q}=U9ˆ¤ì(€€€€€€€Í•…É¡•€ôÉ•ÍÕ±Ðì(€€€€€€€‰É•…¬ì(€€€€€ô(€€€€€Í•…É¡•€ôÉ•ÍÕ±Ðì(€€€ô(€€€¥˜€¡Í•…É¡•ü¹½¬ñð€¡Í•…É¡•ü¹ÍÑ•À€˜˜Í•…É¡•¹ÍÑ•À€„ôô€‰MI!}%9AUQ}9=Q}=U9ˆ¤¤‰É•…¬ì(€ô(€¥˜€¡±•…É• ¤¤ì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ô€ˆˆì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰	I9}QQ5AQ}	=IQˆ°µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ²zG²^ƒ².sªÂ²vÐƒ²Ò#ªÎó®Bc²ZÐƒ®.“²v0ƒ®â3®zs®Ns®†pƒ²vÓ®>g¶V§®.#®.¹€ôì(€ô(€¥˜€ …Í•…É¡•ü¹½¬€˜˜Í•…É¡•ü¹ÍÑ•À€ôôô€‰MI!}%9AUQ}9=Q}=U9ˆ¤ì(€€€Í•…É¡•€ôì€¸¸¹Í•…É¡•°‘¥…¹½ÍÑ¥Ìè±…ÍÑM•…É¡¥…¹½ÍÑ¥Ìôì(€ô(€¥˜€ …Í•…É¡•ü¹½¬¤ì(€€€½¹ÍÐ‘¥…¹½ÍÑ¥A…Ñ €ô…Ý…¥Ð…ÁÑÕÉ•M•±±•É¥…¹½ÍÑ¥Œ¡‰É…¹‘9…µ”°MÑÉ¥¹œ¡Í•…É¡•ü¹ÍÑ•Àñð€‰Í•…É µ™…¥±•ˆ¤¹Ñ½1½Ý•É…Í” ¤¤ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ô€ˆˆì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€½‘”èÍ•…É¡•ü¹½‘”ñðÍ•…É¡•ü¹ÍÑ•Àñð€‰M11I}UQ=5Q%=9}%1ˆ°(€€€€€µ•ÍÍ…”è€‘íÍ•±±•É	É…¹‘áÁ½ÉÑ…¥±ÕÉ•5•ÍÍ…”¡Í•…É¡•ü¹½‘”ñðÍ•…É¡•ü¹ÍÑ•À°‰É…¹‘9…µ”¥ô‘í‘¥…¹½ÍÑ¥A…Ñ €ü€ƒ²ž®. ƒ¶fS®¦Ðè€‘í‘¥…¹½ÍÑ¥A…Ñ¡õ€€è€ˆ‰õ€°(€€€€€‘¥…¹½ÍÑ¥Ìèì€¸¸¸¡Í•…É¡•ü¹‘¥…¹½ÍÑ¥Ìñðíô¤°Á…Ñ è‘¥…¹½ÍÑ¥A…Ñ ô°(€€€ôì(€ô((€€¼¼Q¡”ÕÉÉ•¹Ð‰É…¹É•µ…¥¹Ì¥¸Ñ¡”±¥Ù”½Ý¹±½…•¹Ñ•ÈÕ¹Ñ¥°¥ÑÌ©½ˆ…¹(€€¼¼Ý½É­‰½½¬…É”½µÁ±•Ñ”¸Q¡”¹•áÐÅÕ•Õ•‰É…¹½Á•¹Ì„™É•Í ÁÉ½‘ÕÐµÍ•…É (€€¼¼Á…”°Í¼Ñ¡•É”¥Ì¹¼É•…Í½¸Ñ¼­••ÀÉ•±å¥¹œ½¸„ÍÑ…±”‰…­É½Õ¹Ñ…‰±”¸(€¥˜€¡Í•±±•É]¥¹‘½Ü€˜˜€…Í•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€àÀÀ¤¤ì(€€€Í•±±•É]¥¹‘½Ü¹¡¥‘” ¤ì(€ô((€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€ÍÑ…ÑÕÌè€‰Í•±±•ÈµÍ•…É µ•Ù¥‘•¹”ˆ°(€€€‰É…¹‘9…µ”°(€€€©½‰MÑ…Ñ”èÍ•…É¡•¹½¹™¥Éµ…Ñ¥½¹±¥­•(€€€€€€ü€ˆË®.£ªÎ¼Ôƒ
Üƒ®
Ó®ÎÓ®
ÓªâÀƒ¶fW²vàƒ²f®Ž0ƒ
Üƒ²zG²^®Ê#¶bàƒ²w²Äƒ¶fW²vàƒ²’Dˆ(€€€€€€è€ˆË®.£ªÎ¼Ôƒ
Üƒ²‚²ÊÐƒ®
Ó®ÎÓ®
ÓªâÀƒ¶Ó®š´ƒ
Üƒ²zG²^®Ê#¶bàƒ²w²Äƒ¶fW²vàƒ²’Dˆ°(€€€µ•ÍÍ…”èÍ•…É¡•¹½¹™¥Éµ…Ñ¥½¹±¥­•(€€€€€€ü€‘í‰É…¹‘9…µ•ôƒ
Üƒ¶b²ž €ÌÃ²vðƒ®
Ó®šó²Â£²"pƒ
ÜA=%i=8ƒ®
Ó®ÎÓ®
ÓªâÀƒ¶fW²vã²Âôƒ²Êc®š°ƒ²f®Ž0ƒ
Üƒ² ƒ²zG²^®Ê#¶bàƒ¶fW²vàƒ²’E€(€€€€€€è€‘í‰É…¹‘9…µ•ôƒ
Üƒ²‚²ÊÐƒ®
Ó®ÎÓ®
ÓªâÀƒ¶Ó®š´ƒ²f®Ž0ƒ
Üƒ¶fW²vã²Âôƒ²^²vÐƒ²zG²^®Ê#¶bãªÂ ƒ²w²Ç®Bc®*S²ž ƒ¶fW²vàƒ²’E€°(€ô¤ì((€½¹ÍÐ½µÁ±•Ñ•¹•ÍÌ€ôì(€€€½¬èÑÉÕ”°(€€€•áÁ•Ñ•è€À°(€€€Á…•½Õ¹Ðè€À°(€€€½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•è	½½±•…¸¡Í•…É¡•¹½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•¤°(€€€½¹™¥Éµ…Ñ¥½¹±¥­•è	½½±•…¸¡Í•…É¡•¹½¹™¥Éµ…Ñ¥½¹±¥­•¤°(€€€É•ÅÕ•ÍÑ­¹½Ý±•‘•è	½½±•…¸¡Í•…É¡•¹É•ÅÕ•ÍÑ­¹½Ý±•‘•¤°(€ôì((€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€ÍÑ…ÑÕÌè€‰Ý…¥Ñ¥¹œµ™½Èµ©½ˆµÉ•…Ñ¥½¸ˆ°(€€€‰É…¹‘9…µ”°(€€€©½‰MÑ…Ñ”è€ˆË®.£ªÎ¼Ôƒ
Üƒ²‚²ÊÐƒ®
Ó®ÎÓ®
ÓªâÀƒ¶Ó®š´ƒ²f®Ž0ƒ
Üƒ² ƒ²zG²^®Ê#¶bàƒ¶fW²vàƒ²’Dˆ°(€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
Üƒ²‚²ÊÐƒ®
Ó®ÎÓ®
ÓªâÃ®–ðƒ²f®Ž3¶Z#²*×®.#®.¸ƒ®Î®>ƒ¶fW²vàƒ²Â÷²^C²pƒ² ƒ²zG²^®Ê#¶bã®ž0ƒ¶fW²vã¶Vpƒ®Jƒ®.“²v0ƒ®â3®zs®Ns®†pƒ²vÓ®>g¶V§®.#®.¹€°(€ô¤ì((€±•ÐÉ•…Ñ•‘)½ˆ€ô¹Õ±°ì(€½¹ÍÐÙ•É¥™¥…Ñ¥½¹MÑ…ÉÑ•‘Ð€ô…Ñ”¹¹½Ü ¤ì(€½¹ÍÐÙ•É¥™¥…Ñ¥½¹Q¥µ•½ÕÑ5Ì€ô€ÄàÀÀÀÀì(€±•Ð±…ÍÑI•±½…‘Ð€ô€Àì(€±•Ð±…ÍÑAÉ½É•ÍÍÐ€ô€Àì(€±•Ð™…±±‰…­…¹‘¥‘…Ñ•)½‰%€ô€ˆˆì(€±•Ð™…±±‰…­…¹‘¥‘…Ñ•MÑ…‰±•I•…‘Ì€ô€Àì(€±•Ð±…Ñ•½¹™¥Éµ…Ñ¥½¹¡•­•€ô	½½±•…¸¡Í•…É¡•¹½¹™¥Éµ…Ñ¥½¹±¥­•¤ì(€±•Ð±…ÍÑÉ•Í¡I•…‘Ð€ô€Àì(€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€ÈÔÀÀ¤¤ì(€Ý¡¥±”€¡…Ñ”¹¹½Ü ¤€´Ù•É¥™¥…Ñ¥½¹MÑ…ÉÑ•‘Ð€ðÙ•É¥™¥…Ñ¥½¹Q¥µ•½ÕÑ5Ì¤ì(€€€¥˜€¡±•…É• ¤¤‰É•…¬ì(€€€½¹ÍÐ©½‰M½ÕÉ•Ì€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€€AÉ½µ¥Í”¹É…”¡l(€€€€€€€É•…‘M•±±•ÉáÁ½ÉÑ)½‰ÍÉ½µ5½¹¥Ñ½È ¤°(€€€€€€€¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ  ¤€ôøÉ•Í½±Ù”¡¹Õ±°¤°€ÄÕ|ÀÀÀ¤¤°(€€€€€t¤°(€€€€€AÉ½µ¥Í”¹É…”¡l(€€€€€€€É•…‘M•±±•ÉáÁ½ÉÑ)½‰Ì ¤°(€€€€€€€¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ  ¤€ôøÉ•Í½±Ù”¡¹Õ±°¤°€ÄÕ|ÀÀÀ¤¤°(€€€€€t¤°(€€€t¤¹…Ñ   ¤€ôømt¤ì(€€€±•ÐÕÉÉ•¹Ñ)½‰Ì€ôl¸¸¹¹•Ü5…À¡©½‰M½ÕÉ•Ì(€€€€€€¹™±…Ñ5…À ¡©½‰Ì¤€ôøÉÉ…ä¹¥ÍÉÉ…ä¡©½‰Ì¤€ü©½‰Ì€èmt¤(€€€€€€¹µ…À ¡©½ˆ¤€ôømMÑÉ¥¹œ¡©½ˆü¹¥ñð€ˆˆ¤¹ÑÉ¥´ ¤°©½‰t¤(€€€€€€¹™¥±Ñ•È ¡m¥‘t¤€ôø¥¤¤¹Ù…±Õ•Ì ¥tì(€€€½¹ÍÐ•±…ÁÍ•‘5Ì€ô…Ñ”¹¹½Ü ¤€´Ù•É¥™¥…Ñ¥½¹MÑ…ÉÑ•‘Ðì(€€€¥˜€¡•±…ÁÍ•‘5Ì€øô€ÄÁ|ÀÀÀ€˜˜…Ñ”¹¹½Ü ¤€´±…ÍÑÉ•Í¡I•…‘Ð€øô€ÄÕ|ÀÀÀ¤ì(€€€€€±…ÍÑÉ•Í¡I•…‘Ð€ô…Ñ”¹¹½Ü ¤ì(€€€€€½¹ÍÐ™É•Í¡)½‰Ì€ô…Ý…¥ÐAÉ½µ¥Í”¹É…”¡l(€€€€€€€É•…‘M•±±•ÉáÁ½ÉÑ)½‰ÍÉ•Í¡±ä ¤°(€€€€€€€¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ  ¤€ôøÉ•Í½±Ù”¡¹Õ±°¤°€ÈÁ|ÀÀÀ¤¤°(€€€€€t¤¹…Ñ   ¤€ôø¹Õ±°¤ì(€€€€€¥˜€¡ÉÉ…ä¹¥ÍÉÉ…ä¡™É•Í¡)½‰Ì¤¤ì(€€€€€€€½¹ÍÐµ•É•‘)½‰Ì€ô¹•Ü5…À ¤ì(€€€€€€€™½È€¡½¹ÍÐ©½ˆ½˜l¸¸¸¡ÉÉ…ä¹¥ÍÉÉ…ä¡ÕÉÉ•¹Ñ)½‰Ì¤€üÕÉÉ•¹Ñ)½‰Ì€èmt¤°€¸¸¹™É•Í¡)½‰Ít¤ì(€€€€€€€€€½¹ÍÐ¥€ôMÑÉ¥¹œ¡©½ˆü¹¥ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€€€€€¥˜€¡¥¤µ•É•‘)½‰Ì¹Í•Ð¡¥°©½ˆ¤ì(€€€€€€€ô(€€€€€€€ÕÉÉ•¹Ñ)½‰Ì€ôl¸¸¹µ•É•‘)½‰Ì¹Ù…±Õ•Ì ¥tì(€€€€€ô(€€€ô(€€€¥˜€¡ÉÉ…ä¹¥ÍÉÉ…ä¡ÕÉÉ•¹Ñ)½‰Ì¤¤ì(€€€€€½¹ÍÐÕ¹ÕÍ•‘)½‰Ì€ôÕÉÉ•¹Ñ)½‰Ì¹™¥±Ñ•È ¡©½ˆ¤€ôø€…‰É…¹‘áÁ½ÉÑ)½‰=Ý¹•È¡©½ˆü¹¥¤¤ì(€€€€€±•Ð…¹‘¥‘…Ñ”€ô™¥¹‘9•ÝM•±±•ÉáÁ½ÉÑ)½ˆ¡l¸¸¹‰…Í•±¥¹•)½‰%‘Ít°Õ¹ÕÍ•‘)½‰Ì°ì(€€€€€€€¹½Ñ	•™½É•5Ìè•áÁ½ÉÑ­¹½Ý±•‘•‘Ð°(€€€€€€€‰…Í•±¥¹•ÕÑ¡½É¥Ñ…Ñ¥Ù”è‰…Í•±¥¹•Ù…¥±…‰±”°(€€€€€€€€¼¼%˜•Ù•ÉäÁÉ”µ•áÁ½ÉÐÉ•…‘•ÈÝ…ÌÍÑ¥±°±½…‘¥¹œ°…•ÁÐ½¹±ä„ÍÑ…‰±”(€€€€€€€€¼¼Á½ÍÐµÉ•ÅÕ•ÍÐÕ¹½Ý¹•É½Ü…™Ñ•È€ÈÀÍ•½¹‘Ì¸Q¡”ÑÝ¼µÉ•……Ñ”‰•±½Ü(€€€€€€€€¼¼ÁÉ•Ù•¹ÑÌ„ÑÉ…¹Í¥•¹Ð½ÍÑ…±”MAÉ½Ü™É½´‰•¥¹œ…ÑÑ…¡•¥µµ•‘¥…Ñ•±ä¸(€€€€€€€…±±½Ý5¥ÍÍ¥¹Q¥µ•ÍÑ…µÀè€…‰…Í•±¥¹•Ù…¥±…‰±”€˜˜•±…ÁÍ•‘5Ì€øô€ÈÁ|ÀÀÀ°(€€€€€€€€¼¼A=%i=8…¹Ñ¡”±½…°A…¸‘¥™™•ÈÍ±¥¡Ñ±ä°‰ÕÐ„ÁÉ•Ù¥½ÕÌµ‘…ä©½ˆ(€€€€€€€€¼¼€¡ÍÕ …ÌÑ¡”AU5É½ÜÉ•ÕÍ•™½È-=1=8MA=IP¤µÕÍÐ…±Ý…åÌ‰”É•©•Ñ•¸(€€€€€€€…±±½Ý•‘±½­M­•Ý5Ìè€È€¨€ØÁ|ÀÀÀ°(€€€€€ô¤ì(€€€€€€¼¼Í±½Ü‰…Í•±¥¹”Ý¥¹‘½Ü…¸™¥¹¥Í …™Ñ•ÈA=%i=8¡…Ì…±É•…‘ä¥¹Í•ÉÑ•(€€€€€€¼¼Ñ¡”¹•ÜÉ½Ü…¹…¥‘•¹Ñ…±±ä±…ÍÍ¥™äÑ¡…ÐÉ½Ü…Ì½±¸Q¡”½Ý¹±½…(€€€€€€¼¼•¹Ñ•ÈÑ¥µ•ÍÑ…µÀ¥Ì¥¹‘•Á•¹‘•¹Ð•Ù¥‘•¹”è…¸Õ¹½Ý¹•©½ˆÉ•…Ñ•™½È(€€€€€€¼¼Ñ¡¥ÌÉ•ÅÕ•ÍÐµÕÍÐ‰”…ÑÑ…¡••Ù•¸¥˜¥Ð±•…­•¥¹Ñ¼Ñ¡”‰…Í•±¥¹”¸(€€€€€¥˜€ ……¹‘¥‘…Ñ”€˜˜•±…ÁÍ•‘5Ì€øô€ÄÁ|ÀÀÀ¤ì(€€€€€€€…¹‘¥‘…Ñ”€ô™¥¹‘I••¹ÑM•±±•ÉáÁ½ÉÑ)½ˆ¡Õ¹ÕÍ•‘)½‰Ì°ì(€€€€€€€€€¹½Ñ	•™½É•5Ìè•áÁ½ÉÑ­¹½Ý±•‘•‘Ð°(€€€€€€€€€…±±½Ý•‘±½­M­•Ý5Ìè€È€¨€ØÁ|ÀÀÀ°(€€€€€€€ô¤ì(€€€€€ô(€€€€€¥˜€¡…¹‘¥‘…Ñ”€˜˜‰…Í•±¥¹•Ù…¥±…‰±”¤ì(€€€€€€€É•…Ñ•‘)½ˆ€ô…¹‘¥‘…Ñ”ì(€€€€€ô•±Í”¥˜€¡…¹‘¥‘…Ñ”¤ì(€€€€€€€½¹ÍÐ…¹‘¥‘…Ñ•%€ôMÑÉ¥¹œ¡…¹‘¥‘…Ñ”¹¥ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€€€™…±±‰…­…¹‘¥‘…Ñ•MÑ…‰±•I•…‘Ì€ô…¹‘¥‘…Ñ•%€ôôô™…±±‰…­…¹‘¥‘…Ñ•)½‰%(€€€€€€€€€€ü™…±±‰…­…¹‘¥‘…Ñ•MÑ…‰±•I•…‘Ì€¬€Ä(€€€€€€€€€€è€Äì(€€€€€€€™…±±‰…­…¹‘¥‘…Ñ•)½‰%€ô…¹‘¥‘…Ñ•%ì(€€€€€€€¥˜€¡™…±±‰…­…¹‘¥‘…Ñ•MÑ…‰±•I•…‘Ì€øô€È¤É•…Ñ•‘)½ˆ€ô…¹‘¥‘…Ñ”ì(€€€€€ô•±Í”ì(€€€€€€€™…±±‰…­…¹‘¥‘…Ñ•)½‰%€ô€ˆˆì(€€€€€€€™…±±‰…­…¹‘¥‘…Ñ•MÑ…‰±•I•…‘Ì€ô€Àì(€€€€€ô(€€€ô(€€€¥˜€¡É•…Ñ•‘)½ˆ¤‰É•…¬ì((€€€€¼¼M½µ”M•±±•È•¹Ñ•ÈÉ•ÍÁ½¹Í•ÌÉ•¹‘•ÈÑ¡”½¹™¥Éµ…Ñ¥½¸µ½‘…°Í•Ù•É…°(€€€€¼¼Í•½¹‘Ì…™Ñ•ÈÑ¡”•áÁ½ÉÐ±¥¬¸¡•¬½¹”µ½É”‰•™½É”‘•±…É¥¹œÑ¡…Ð(€€€€¼¼¹¼©½ˆÝ…ÌÉ•…Ñ•ì‘¼¹½Ð±¥¬Ñ¡”•áÁ½ÉÐ‰ÕÑÑ½¸……¥¸…¹É¥Í¬„(€€€€¼¼‘ÕÁ±¥…Ñ”©½ˆ¸(€€€¥˜€ …±…Ñ•½¹™¥Éµ…Ñ¥½¹¡•­•€˜˜•±…ÁÍ•‘5Ì€øô€Õ|ÀÀÀ¤ì(€€€€€±…Ñ•½¹™¥Éµ…Ñ¥½¹¡•­•€ôÑÉÕ”ì(€€€€€½¹ÍÐ±…Ñ•½¹™¥Éµ…Ñ¥½¸€ô…Ý…¥Ð½¹™¥ÉµM•±±•ÉáÁ½ÉÑI•ÅÕ•ÍÑA¡åÍ¥…°¡ÕÉÉ•¹ÑM•±±•ÉAÉ½‘ÕÑÉ…µ” ¤¤(€€€€€€€€¹…Ñ   ¤€ôø¹Õ±°¤ì(€€€€€¥˜€¡±…Ñ•½¹™¥Éµ…Ñ¥½¸ü¹½¹™¥Éµ…Ñ¥½¹±¥­•¤ì(€€€€€€€½µÁ±•Ñ•¹•ÍÌ¹½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•€ôÑÉÕ”ì(€€€€€€€½µÁ±•Ñ•¹•ÍÌ¹½¹™¥Éµ…Ñ¥½¹±¥­•€ôÑÉÕ”ì(€€€€€€€½µÁ±•Ñ•¹•ÍÌ¹É•ÅÕ•ÍÑ­¹½Ý±•‘•€ôÑÉÕ”ì(€€€€€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€€€€€€€ÍÑ…ÑÕÌè€‰Ý…¥Ñ¥¹œµ™½Èµ©½ˆµÉ•…Ñ¥½¸ˆ°(€€€€€€€€€‰É…¹‘9…µ”°(€€€€€€€€€©½‰MÑ…Ñ”è€ˆË®.£ªÎ¼Ôƒ
Üƒ²ž²^Àƒ¶fW²vã²Âôƒ²Êc®š°ƒ²f®Ž0ƒ
Üƒ²zG²^®Ê#¶bàƒ²w²Äƒ¶fW²vàƒ²’Dˆ°(€€€€€€€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
Üƒ®*›ªÊ0ƒ¶Fs².s®BpA=%i=8ƒ®
Ó®ÎÓ®
ÓªâÀƒ¶fW²vã²Â÷²vƒ²Êc®š³¶Z#²*×®.#®.¹€°(€€€€€€€ô¤ì(€€€€€ô(€€€ô(€€€¥˜€¡•±…ÁÍ•‘5Ì€´±…ÍÑAÉ½É•ÍÍÐ€øô€ÄÀÀÀÀ¤ì(€€€€€±…ÍÑAÉ½É•ÍÍÐ€ô•±…ÁÍ•‘5Ìì(€€€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€€€€€ÍÑ…ÑÕÌè€‰Ý…¥Ñ¥¹œµ™½Èµ©½ˆµÉ•…Ñ¥½¸ˆ°(€€€€€€€‰É…¹‘9…µ”°(€€€€€€€©½‰MÑ…Ñ”è€Ë®.£ªÎ¼Ôƒ
Üƒ®.“²jÓ®†s®Ns²ó¶Àƒ²zG²^ƒ²w²Äƒ®2ªâÀƒ
Ü€‘í5…Ñ ¹™±½½È¡•±…ÁÍ•‘5Ì€¼€ÄÀÀÀ¥÷²Ò!€°(€€€€€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
Üƒ²‚²ÊÐƒ®
Ó®ÎÓ®
ÓªâÀƒ²jS²Ê´ƒ²f®Ž0ƒ
ÜA=%i=;²vÐƒ² ƒ²zG²^®Ê#¶bã®–ðƒ²w²Ç¶Vc®*Pƒ²’G²z®.#®.¸ƒ¶fS®¦Ó²vƒ®Âc®ÎÔƒ²Ò#ªâÃ¶fS¶Vc²ž ƒ²V+ªÎ€ƒªâÃ®.“®š÷®.#®.¹€°(€€€€€ô¤ì(€€€ô((€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€ÈÔÀÀ¤¤ì(€€€½¹ÍÐµ½¹¥Ñ½È€ô•¹ÍÕÉ•M•±±•É5½¹¥Ñ½É]¥¹‘½Ü ¤ì(€€€¥˜€¡•±…ÁÍ•‘5Ì€øô€ÄÔÀÀÀ€˜˜…Ñ”¹¹½Ü ¤€´±…ÍÑI•±½…‘Ð€øô€ÄÔÀÀÀ¤ì(€€€€€…Ý…¥Ðµ½¹¥Ñ½È¹Ý•‰½¹Ñ•¹ÑÌ¹É•±½…‘%¹½É¥¹…¡” ¤ì(€€€€€±…ÍÑI•±½…‘Ð€ô…Ñ”¹¹½Ü ¤ì(€€€ô(€ô(€¥˜€¡±•…É• ¤¤ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ô€ˆˆì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰	I9}QQ5AQ}	=IQˆ°µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ²zG²^ƒ².sªÂ²vÐƒ²Ò#ªÎó®Bc²ZÐƒ®.“²v0ƒ®â3®zs®Ns®†pƒ²vÓ®>g¶V§®.#®.¹€ôì(€ô(€¥˜€ …É•…Ñ•‘)½ˆ¤ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ô€ˆˆì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€Í•±±•É]¥¹‘½Ü¹¡¥‘” ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€½‘”è€‰aA=IQ})=	}9=Q}IQˆ°(€€€€€½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•è	½½±•…¸¡½µÁ±•Ñ•¹•ÍÌü¹½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•¤°(€€€€€½¹™¥Éµ…Ñ¥½¹±¥­•è	½½±•…¸¡½µÁ±•Ñ•¹•ÍÌü¹½¹™¥Éµ…Ñ¥½¹±¥­•¤°(€€€€€É•ÅÕ•ÍÑ­¹½Ý±•‘•è	½½±•…¸¡½µÁ±•Ñ•¹•ÍÌü¹É•ÅÕ•ÍÑ­¹½Ý±•‘•¤°(€€€€€µ•ÍÍ…”è½µÁ±•Ñ•¹•ÍÌü¹½¹™¥Éµ…Ñ¥½¹=‰Í•ÉÙ•€˜˜€…½µÁ±•Ñ•¹•ÍÌü¹½¹™¥Éµ…Ñ¥½¹±¥­•(€€€€€€€€ü€‰A=%i=8ƒ²‚²ÊÐƒ®
Ó®ÎÓ®
ÓªâÀƒ¶fW²vã²Â÷²vƒ²f®Ž3¶Vc²ž ƒ®ªï¶Z#²*×®.#®.¸ƒ¶fW²vã²Âôƒ²Êc®š°ƒ®†s²ž²vƒ®.“².pƒ²‚CªÊ¶VÐƒ²Žó²ã²jP¸ˆ(€€€€€€€€è€‹².“²‚pƒ²¶J#ªÊ²'ªÎðƒ²‚²ÊÐƒ®
Ó®ÎÓ®
ÓªâÀƒ²jS²Ê·²v ƒ².“¶Z'®BC²ž®ž0€Ï®Úƒ®>g²V ƒ² ƒ®¾ã²
³²j¤ƒ²zG²^®Ê#¶bã®–ðƒ¶fW²vã¶Vc²ž ƒ®ªï¶Z#²*×®.#®.¸ƒ®.“²jÓ®†s®Ns²ó¶Àƒ¶fS®¦ÐƒªÖ³²†Àƒ®bC®*Pƒ®†sªÞã²vàƒ²ã²c²vƒ¶fW²vã¶VÐƒ²Žó²ã²jP¸ˆ°(€€€ôì(€ô(€¥˜€¡±•…É• ¤¤É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰]=I-}1Iˆ°µ•ÍÍ…”è€‹²zG²^ƒªâÃ®†tƒ²
·²‚s®†pƒ²vÓ²‚ƒ²jS²Ê·²vƒ²’G®.£¶Z#²*×®.#®.¸ˆôì(€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ôMÑÉ¥¹œ¡É•…Ñ•‘)½ˆ¹¥ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€½¹ÍÐÉ•¥ÍÑ•É•‘)½‰%€ôÁ•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%ì(€½¹ÍÐ•á¥ÍÑ¥¹=Ý¹•È€ô‰É…¹‘áÁ½ÉÑ)½‰=Ý¹•È¡É•¥ÍÑ•É•‘)½‰%¤ì(€¥˜€¡•á¥ÍÑ¥¹=Ý¹•È¤ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ô€ˆˆì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€Í•±±•É]¥¹‘½Ü¹¡¥‘” ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€½‘”è€‰aA=IQ})=	}%}IUMˆ°(€€€€€µ•ÍÍ…”èƒ² ƒ²zG²^®Ê#¶bãªÂ ƒ²w²Ç®Bc²ž ƒ²V+²Vc²*×®.#®.¸ƒªâÃ²†Ðƒ²zG²^®Ê#¶bà€‘íÉ•¥ÍÑ•É•‘)½‰%‘÷®*P€‘í•á¥ÍÑ¥¹=Ý¹•È¹‰É…¹‘9…µ”ñð€‹®.“®–àƒ®â3®zs®Np‰ôƒ²zG²^²^@ƒ²vÓ®¾àƒ²^ÃªÊÃ®Bc²ZÐƒ²z#²*×®.#®.¹€°(€€€ôì(€ô(€½¹ÍÐÉ•¥ÍÑ•É•‘É•…Ñ•‘Ð€ô9Õµ‰•È¡É•…Ñ•‘)½ˆ¹ÍÑ…ÉÑÑ5Ìñð•áÁ½ÉÑ­¹½Ý±•‘•‘Ðñð…Ñ”¹¹½Ü ¤¤ì(€‰É…¹‘áÁ½ÉÑ)½‰Ì¹Í•Ð¡É•¥ÍÑ•É•‘)½‰%°ì(€€€©½‰%èÉ•¥ÍÑ•É•‘)½‰%°(€€€‰É…¹‘9…µ”°(€€€‰É…¹‘-¼°(€€€É•…Ñ•‘ÐèÉ•¥ÍÑ•É•‘É•…Ñ•‘Ð°(€€€‘½Ý¹±½…‘MÑ…ÉÑ•è™…±Í”°(€€€•áÁ•Ñ•‘AÉ½‘ÕÑ½Õ¹Ðè9Õµ‰•È¡½µÁ±•Ñ•¹•ÍÌ¹•áÁ•Ñ•ñðÍ•…É¡•¹•áÁ•Ñ•‘Q½Ñ…°ñð€À¤°(€ô¤ì(€…Ý…¥ÐÉ•µ•µ‰•É	É…¹‘áÁ½ÉÑ)½ˆ¡ì(€€€©½‰%èÉ•¥ÍÑ•É•‘)½‰%°(€€€‰É…¹‘9…µ”°(€€€‰É…¹‘-¼°(€€€É•…Ñ•‘ÐèÉ•¥ÍÑ•É•‘É•…Ñ•‘Ð°(€€€•áÁ•Ñ•‘AÉ½‘ÕÑ½Õ¹Ðè9Õµ‰•È¡½µÁ±•Ñ•¹•ÍÌ¹•áÁ•Ñ•ñðÍ•…É¡•¹•áÁ•Ñ•‘Q½Ñ…°ñð€À¤°(€€€Í•ÍÍ¥½¹•¹•É…Ñ¥½¸°(€ô¤ì(€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÁÉ½É•ÍÌˆ°ì(€€€ÍÑ…ÑÕÌè€‰©½ˆµÉ•…Ñ•ˆ°(€€€‰É…¹‘9…µ”°(€€€©½‰%èÉ•¥ÍÑ•É•‘)½‰%°(€€€©½‰MÑ…Ñ”è€‹²zG²^®Ê#¶bàƒ²w²Äƒ¶fW²vàƒ²f®Ž0ƒ
Üƒ²‚²ÊÐƒ®NÇ®†tƒ®2ªâÀˆ°(€€€µ•ÍÍ…”è€‘í‰É…¹‘9…µ•ôƒ
Üƒ² ƒ²zG²^®Ê#¶bà€‘íÉ•¥ÍÑ•É•‘)½‰%‘ôƒ²w²Äƒ¶fW²vàƒ²f®Ž0ƒ
Üƒ®.“²v0ƒ®â3®zs®Ns®†pƒ²vÓ®>e€°(€ô¤ì(€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ô€ˆˆì(€Í•±±•É]¥¹‘½Ü¹¡¥‘” ¤ì(€¥˜€ …¥¹ÁÕÐ¹‘•™•É5½¹¥Ñ½È¤Ù½¥Ý…Ñ¡±±M•±±•ÉáÁ½ÉÑ)½‰ÍÙ•ÉåQ•¹M•½¹‘Ì ¤ì(€É•ÑÕÉ¸ì(€€€½¬èÑÉÕ”°(€€€™½±‘•È°(€€€©½‰%èÉ•¥ÍÑ•É•‘)½‰%°(€€€•áÁ•Ñ•‘AÉ½‘ÕÑ½Õ¹Ðè9Õµ‰•È¡½µÁ±•Ñ•¹•ÍÌ¹•áÁ•Ñ•ñðÍ•…É¡•¹•áÁ•Ñ•‘Q½Ñ…°ñð€À¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Íå¹	É…¹‘…Ñ…±½É½µ-ÉA½¥é½¸ ¤ì(€½¹ÍÐÝ¥¹‘½Ü€ô¹•Ü	É½ÝÍ•É]¥¹‘½Ü¡ì(€€€Í¡½Üè™…±Í”°(€€€¥½¸èAA}%=9}AQ °(€€€Ý¥‘Ñ è€ÄÈàÀ°(€€€¡•¥¡Ðè€äÀÀ°(€€€Ý•‰AÉ•™•É•¹•Ìèì(€€€€€Á…ÉÑ¥Ñ¥½¸è€‰Á•ÉÍ¥ÍÐé…É½Õ¹µœµÁ½¥é½¸µ‰É…¹‘Ìˆ°(€€€€€½¹Ñ•áÑ%Í½±…Ñ¥½¸èÑÉÕ”°(€€€€€¹½‘•%¹Ñ•É…Ñ¥½¸è™…±Í”°(€€€€€Í…¹‘‰½àèÑÉÕ”°(€€€ô°(€ô¤ì(€ÑÉäì(€€€…Ý…¥ÐÝ¥¹‘½Ü¹±½…‘UI0¡-I}A=%i=9}	I9}1%MQ}UI0¤ì(€€€½¹ÍÐÍ½ÕÉ”€ô…Ý…¥ÐÝ¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ (€€€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ}}9aQ}Q}|ˆ¤ü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆ‰€°(€€€€€ÑÉÕ”(€€€€¤ì(€€€¥˜€ …Í½ÕÉ”¤Ñ¡É½Ü¹•ÜÉÉ½È ‰-I}A=%i=9}	I9}Q}9=Q}=U9ˆ¤ì(€€€½¹ÍÐ­½É•…¹	É…¹‘Ì€ôÁ…ÉÍ•-ÉA½¥é½¹	É…¹‘…Ñ„¡Í½ÕÉ”¤ì(€€€±•Ð•¹±¥Í¡	É…¹‘Ì€ômtì(€€€ÑÉäì(€€€€€…Ý…¥ÐÝ¥¹‘½Ü¹±½…‘UI0¡9}A=%i=9}	I9}1%MQ}UI0¤ì(€€€€€½¹ÍÐ•¹±¥Í¡M½ÕÉ”€ô…Ý…¥ÐÝ¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ (€€€€€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ}}9aQ}Q}|ˆ¤ü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆ‰€°(€€€€€€€ÑÉÕ”(€€€€€€¤ì(€€€€€¥˜€¡•¹±¥Í¡M½ÕÉ”¤•¹±¥Í¡	É…¹‘Ì€ôÁ…ÉÍ•-ÉA½¥é½¹	É…¹‘…Ñ„¡•¹±¥Í¡M½ÕÉ”¤ì(€€€ô…Ñ ì(€€€€€€¼¼ƒ¶VsªÖ´ƒªÎ×².tƒ®ª§®†w®ž0ƒ²f²‚¶Vc®¦Ðƒ²‚²ÊÐƒ®â3®zs®NpƒªÊ²'²vƒ®ž'²ž ƒ²V+®*S®.¸(€€€ô(€€€½¹ÍÐ‰É…¹‘Ì€ôµ•É•1½…±¥é•‘	É…¹‘…Ñ…±½œ¡­½É•…¹	É…¹‘Ì°•¹±¥Í¡	É…¹‘Ì¤ì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡‰É…¹‘Ì¤ñð‰É…¹‘Ì¹±•¹Ñ €ðU11}	I9}Q1=}5%9%5U4¤ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡-I}A=%i=9}	I9}=U9Q}%9Y1%|‘í‰É…¹‘Ìü¹±•¹Ñ ñð€Áõ€¤ì(€€€ô(€€€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡ì‰É…¹‘…Ñ…±½œè‰É…¹‘Ì°‰É…¹‘…Ñ…±½UÁ‘…Ñ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ô¤ì(€€€½¹ÍÐ½™™¥¥…±	É…¹‘I•¥ÍÑÉä€ô…Ý…¥Ð•¹ÍÕÉ•=™™¥¥…±½µ…¥¹I•¥ÍÑÉä¡‰É…¹‘Ì¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬èÑÉÕ”°(€€€€€‰É…¹‘Ìè‰É…¹‘Í]¥Ñ¡=™™¥¥…±½µ…¥¹MÑ…ÑÕÌ¡‰É…¹‘Ì°½™™¥¥…±	É…¹‘I•¥ÍÑÉä¤°(€€€€€½™™¥¥…±½µ…¥¹MÕµµ…Éäè½™™¥¥…±½µ…¥¹I•¥ÍÑÉåMÕµµ…Éä¡½™™¥¥…±	É…¹‘I•¥ÍÑÉä¤°(€€€€€Í½ÕÉ”è-I}A=%i=9}	I9}1%MQ}UI0°(€€€ôì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€•ÉÉ½Èèì(€€€€€€€½‘”è€‰-I}A=%i=9}	I9}Me9}%1ˆ°(€€€€€€€µ•ÍÍ…”è€‹ªâÃ²†Ðƒ¶³®†°ƒ®Â§².w²v`A=%i=8ƒ¶VsªÖ´ƒ®â3®zs®Npƒ®ª§®†w²vƒ²v÷²ž ƒ®ªï¶Z#²*×®.#®.¸ˆ°(€€€€€€€‘•Ñ…¥°è•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¤°(€€€€€ô°(€€€ôì(€ô™¥¹…±±äì(€€€¥˜€ …Ý¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤Ý¥¹‘½Ü¹‘•ÍÑÉ½ä ¤ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÅÕ•ÉåAÕ‰±¥	É…¹‘AÉ½‘ÕÑÌ¡¥¹ÁÕÐ¤ì(€½¹ÍÐ‰É…¹‘A…Ñ €ôÁÕ‰±¥	É…¹‘A…Ñ ¡ì(€€€ÁÉ½‘ÕÑUÉ°è¥¹ÁÕÐü¹‰É…¹‘UÉ°°(€€€¹…µ”è¥¹ÁÕÐü¹‰É…¹‘9…µ”°(€ô¤ì(€¥˜€ „½yp½‰É…¹‘p½m„µèÀ´åum„µèÀ´äµt¨½¤¹Ñ•ÍÐ¡‰É…¹‘A…Ñ ¤¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°•ÉÉ½Èèì½‘”è€‰A=%i=9}	I9}UI1}%9Y1%ˆ°µ•ÍÍ…”è€‰A=%i=8ƒ²b®²àƒ®â3®zs®Npƒ²Žó²3®–ðƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¸ˆôôì(€ô(€½¹ÍÐÝ¥¹‘½Ü€ô¹•Ü	É½ÝÍ•É]¥¹‘½Ü¡ì(€€€Í¡½Üè™…±Í”°(€€€¥½¸èAA}%=9}AQ °(€€€Ý¥‘Ñ è€ÄÈàÀ°(€€€¡•¥¡Ðè€äÀÀ°(€€€Ý•‰AÉ•™•É•¹•Ìèì(€€€€€Á…ÉÑ¥Ñ¥½¸è€‰Á•ÉÍ¥ÍÐé…É½Õ¹µœµÁ½¥é½¸µ‰É…¹‘Ìˆ°(€€€€€½¹Ñ•áÑ%Í½±…Ñ¥½¸èÑÉÕ”°(€€€€€¹½‘•%¹Ñ•É…Ñ¥½¸è™…±Í”°(€€€€€Í…¹‘‰½àèÑÉÕ”°(€€€ô°(€ô¤ì(€ÑÉäì(€€€½¹ÍÐÁÉ½‘ÕÑÍ	å-•ä€ô¹•Ü5…À ¤ì(€€€±•ÐÁ…•½Õ¹Ð€ô€Äì(€€€±•ÐÍ½ÕÉ•Q½Ñ…°€ô€Àì(€€€™½È€¡±•ÐÁ…•9Õ´€ô€ÄìÁ…•9Õ´€ðôÁ…•½Õ¹ÐìÁ…•9Õ´€¬ô€Ä¤ì(€€€€€½¹ÍÐÁ…•UÉ°€ô¹•ÜUI0¡‰É…¹‘A…Ñ °€‰¡ÑÑÁÌè¼½­È¹Á½¥é½¸¹½´ˆ¤ì(€€€€€¥˜€¡Á…•9Õ´€ø€Ä¤Á…•UÉ°¹Í•…É¡A…É…µÌ¹Í•Ð ‰Á…”ˆ°MÑÉ¥¹œ¡Á…•9Õ´¤¤ì(€€€€€…Ý…¥ÐÝ¥¹‘½Ü¹±½…‘UI0¡Á…•UÉ°¹¡É•˜¤ì(€€€€€½¹ÍÐÍ½ÕÉ”€ô…Ý…¥ÐÝ¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ (€€€€€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È ˆ}}9aQ}Q}|ˆ¤ü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆ‰€°(€€€€€€€ÑÉÕ”(€€€€€€¤ì(€€€€€¥˜€ …Í½ÕÉ”¤Ñ¡É½Ü¹•ÜÉÉ½È¡-I}A=%i=9}	I9}AI=UQM}9=Q}=U9}A|‘íÁ…•9Õµõ€¤ì(€€€€€½¹ÍÐÁ…•…Ñ„€ô)M=8¹Á…ÉÍ”¡Í½ÕÉ”¤ì(€€€€€½¹ÍÐÁ…•AÉ½‘ÕÑÌ€ôÁ…ÉÍ•AÕ‰±¥	É…¹‘AÉ½‘ÕÑÌ¡Á…•…Ñ„°¥¹ÁÕÐ¹‰É…¹‘%¤ì(€€€€€¥˜€¡Á…•9Õ´€ôôô€Ä¤ì(€€€€€€€Í½ÕÉ•Q½Ñ…°€ô5…Ñ ¹µ…à À°9Õµ‰•È¡Á…•…Ñ„ü¹ÁÉ½ÁÌü¹Á…•AÉ½ÁÌü¹Ñ½Ñ…°ñðÁ…•AÉ½‘ÕÑÌ¹±•¹Ñ ¤¤ì(€€€€€€€Á…•½Õ¹Ð€ôÁÕ‰±¥	É…¹‘A…•½Õ¹Ð¡Í½ÕÉ•Q½Ñ…°°Á…•AÉ½‘ÕÑÌ¹±•¹Ñ °€ÄÀÀ¤ì(€€€€€ô(€€€€€™½È€¡½¹ÍÐÁÉ½‘ÕÐ½˜Á…•AÉ½‘ÕÑÌ¤ì(€€€€€€€½¹ÍÐ­•ä€ô€‘íÁÉ½‘ÕÐ¹…ÉÑ¥±•9Õµ‰•Éôè‘íÁÉ½‘ÕÐ¹±½‰…±MÁÕ%ñðÁÉ½‘ÕÐ¹ÍÁÕ%ñð€ˆ‰õ€ì(€€€€€€€ÁÉ½‘ÕÑÍ	å-•ä¹Í•Ð¡­•ä°ÁÉ½‘ÕÐ¤ì(€€€€€ô(€€€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰•áÁ±½É•Èé‰É…¹µÁÉ½É•ÍÌˆ°ì(€€€€€€€Á•É•¹Ðè5…Ñ ¹É½Õ¹ ¡Á…•9Õ´€¼Á…•½Õ¹Ð¤€¨€ÄÀÀ¤°(€€€€€€€½Õ¹ÐèÁÉ½‘ÕÑÍ	å-•ä¹Í¥é”°(€€€€€€€Á…•9Õ´°(€€€€€€€Á…•½Õ¹Ð°(€€€€€ô¤ì(€€€€€¥˜€ …Á…•AÉ½‘ÕÑÌ¹±•¹Ñ ¤‰É•…¬ì(€€€ô(€€€¥˜€ …ÁÉ½‘ÕÑÍ	å-•ä¹Í¥é”¤Ñ¡É½Ü¹•ÜÉÉ½È ‰-I}A=%i=9}	I9}AI=UQM}5AQdˆ¤ì(€€€½¹ÍÐÍ…±•Í	åÉÑ¥±”€ô¥¹ÁÕÐü¹Í…±•Í	åÉÑ¥±”ñðíôì(€€€±•ÐÁÉ½‘ÕÑÌ€ôl¸¸¹ÁÉ½‘ÕÑÍ	å-•ä¹Ù…±Õ•Ì ¥t¹µ…À ¡ÁÉ½‘ÕÐ¤€ôøì(€€€€€½¹ÍÐÍ…±•ÍI•½É€ôÍ…±•Í	åÉÑ¥±•mÁÉ½‘ÕÐ¹…ÉÑ¥±•9Õµ‰•Étì(€€€€€½¹ÍÐ¡…ÍM…±•Í…Ñ„€ôÍ…±•ÍI•½É€„ôôÕ¹‘•™¥¹•ì(€€€€€½¹ÍÐ¡…Í1½…±M…±•Í…Ñ„€ôÍ…±•ÍI•½É€˜˜ÑåÁ•½˜Í…±•ÍI•½É€ôôô€‰½‰©•Ðˆ(€€€€€€€€˜˜Í…±•ÍI•½É¹±½…±M…±•ÌÌÁ€„ôôÕ¹‘•™¥¹•ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€€¸¸¹ÁÉ½‘ÕÐ°(€€€€€€€‰É…¹‘9…µ”èMÑÉ¥¹œ¡¥¹ÁÕÐ¹‰É…¹‘9…µ”ñð€ˆˆ¤°(€€€€€€€¡…ÍM…±•Í…Ñ„°(€€€€€€€¡…Í1½…±M…±•Í…Ñ„°(€€€€€€€Í…±•ÌÌÁè¡…ÍM…±•Í…Ñ„€ü9Õµ‰•È (€€€€€€€€€Í…±•ÍI•½É€˜˜ÑåÁ•½˜Í…±•ÍI•½É€ôôô€‰½‰©•Ðˆ€üÍ…±•ÍI•½É¹Í…±•ÌÌÁ€èÍ…±•ÍI•½É°(€€€€€€€€¤ñð€À€è€À°(€€€€€€€±½…±M…±•ÌÌÁè¡…Í1½…±M…±•Í…Ñ„€ü9Õµ‰•È¡Í…±•ÍI•½É¹±½…±M…±•ÌÌÁñð€À¤€è€À°(€€€€€ôì(€€€ô¤ì(€€€½¹ÍÐÍ…±•Í…Ñ…½Õ¹Ð€ôÁÉ½‘ÕÑÌ¹™¥±Ñ•È ¡ÁÉ½‘ÕÐ¤€ôøÁÉ½‘ÕÐ¹¡…ÍM…±•Í…Ñ„¤¹±•¹Ñ ì(€€€½¹ÍÐ±½…±M…±•Í…Ñ…½Õ¹Ð€ôÁÉ½‘ÕÑÌ¹™¥±Ñ•È ¡ÁÉ½‘ÕÐ¤€ôøÁÉ½‘ÕÐ¹¡…Í1½…±M…±•Í…Ñ„¤¹±•¹Ñ ì(€€€½¹ÍÐµ¥¹¥µÕµ¡¥¹…M…±•ÌÌÀ€ô¥¹ÁÕÐü¹µ¥¹¥µÕµ¡¥¹…M…±•ÌÌÀ€ôôô¹Õ±°ñð¥¹ÁÕÐü¹µ¥¹¥µÕµ¡¥¹…M…±•ÌÌÀ€ôôôÕ¹‘•™¥¹•ñð¥¹ÁÕÐü¹µ¥¹¥µÕµ¡¥¹…M…±•ÌÌÀ€ôôô€ˆˆ(€€€€€€ü€¡¥¹ÁÕÐü¹µ¥¹¥µÕµM…±•ÌÌÀ€ü€ÌÀ€è¹Õ±°¤(€€€€€€è5…Ñ ¹µ…à À°9Õµ‰•È¡¥¹ÁÕÐ¹µ¥¹¥µÕµ¡¥¹…M…±•ÌÌÀ¤ñð€À¤ì(€€€½¹ÍÐµ¥¹¥µÕµ1½…±M…±•ÌÌÀ€ô¥¹ÁÕÐü¹µ¥¹¥µÕµ1½…±M…±•ÌÌÀ€ôôô¹Õ±°ñð¥¹ÁÕÐü¹µ¥¹¥µÕµ1½…±M…±•ÌÌÀ€ôôôÕ¹‘•™¥¹•ñð¥¹ÁÕÐü¹µ¥¹¥µÕµ1½…±M…±•ÌÌÀ€ôôô€ˆˆ(€€€€€€ü€¡¥¹ÁÕÐü¹µ¥¹¥µÕµM…±•ÌÌÀ€ü€ÌÀ€è¹Õ±°¤(€€€€€€è5…Ñ ¹µ…à À°9Õµ‰•È¡¥¹ÁÕÐ¹µ¥¹¥µÕµ1½…±M…±•ÌÌÀ¤ñð€À¤ì(€€€¥˜€¡µ¥¹¥µÕµ¡¥¹…M…±•ÌÌÀ€„ôô¹Õ±°ñðµ¥¹¥µÕµ1½…±M…±•ÌÌÀ€„ôô¹Õ±°¤ì(€€€€€ÁÉ½‘ÕÑÌ€ôÁÉ½‘ÕÑÌ¹™¥±Ñ•È ¡ÁÉ½‘ÕÐ¤€ôø€ (€€€€€€€µ¥¹¥µÕµ¡¥¹…M…±•ÌÌÀ€ôôô¹Õ±°ñð€¡ÁÉ½‘ÕÐ¹¡…ÍM…±•Í…Ñ„€˜˜ÁÉ½‘ÕÐ¹Í…±•ÌÌÁ€øôµ¥¹¥µÕµ¡¥¹…M…±•ÌÌÀ¤(€€€€€€¤€˜˜€ (€€€€€€€µ¥¹¥µÕµ1½…±M…±•ÌÌÀ€ôôô¹Õ±°ñð€¡ÁÉ½‘ÕÐ¹¡…Í1½…±M…±•Í…Ñ„€˜˜ÁÉ½‘ÕÐ¹±½…±M…±•ÌÌÁ€øôµ¥¹¥µÕµ1½…±M…±•ÌÌÀ¤(€€€€€€¤¤ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€½¬èÑÉÕ”°(€€€€€ÁÉ½‘ÕÑÌ°(€€€€€Ñ½Ñ…°èÁÉ½‘ÕÑÌ¹±•¹Ñ °(€€€€€Í½ÕÉ•Q½Ñ…°°(€€€€€Á…•ÌèÁ…•½Õ¹Ð°(€€€€€Á…•9Õ´èÁ…•½Õ¹Ð°(€€€€€Í…±•Í¥±Ñ•ÉÙ…¥±…‰±”èÍ…±•Í…Ñ…½Õ¹Ð€ø€À°(€€€€€Í…±•Í…Ñ…½Õ¹Ð°(€€€€€±½…±M…±•Í…Ñ…½Õ¹Ð°(€€€€€µ¥¹¥µÕµ¡¥¹…M…±•ÌÌÀ°(€€€€€µ¥¹¥µÕµ1½…±M…±•ÌÌÀ°(€€€€€Í½ÕÉ•½Õ¹ÐèÁ…•½Õ¹Ð°(€€€€€™…¥±•‘M½ÕÉ•½Õ¹Ðè€À°(€€€€€ÁÕ‰±¥M½ÕÉ”èÑÉÕ”°(€€€ôì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€•ÉÉ½Èèì(€€€€€€€½‘”è€‰-I}A=%i=9}	I9}AI=UQM}%1ˆ°(€€€€€€€µ•ÍÍ…”è€‰A=%i=8ƒªÎ×ªÂpƒ®â3®zs®Npƒ²¶J#²vƒ²v÷²ž ƒ®ªï¶Z#²*×®.#®.¸ˆ°(€€€€€€€‘•Ñ…¥°è•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¤°(€€€€€ô°(€€€ôì(€ô™¥¹…±±äì(€€€¥˜€ …Ý¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤Ý¥¹‘½Ü¹‘•ÍÑÉ½ä ¤ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸…ÁÑÕÉ•M•±±•É•¹Ñ•ÉAÉ½‘ÕÑÌ ¤ì(€½¹ÍÐÉ•Ù•…±M•±±•É1½¥¸€ô€ ¤€ôøì(€€€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤É•ÑÕÉ¸ì(€€€¥˜€¡Í•±±•É]¥¹‘½Ü¹¥Í5¥¹¥µ¥é• ¤¤Í•±±•É]¥¹‘½Ü¹É•ÍÑ½É” ¤ì(€€€Í•±±•É]¥¹‘½Ü¹Í¡½Ü ¤ì(€€€Í•±±•É]¥¹‘½Ü¹™½ÕÌ ¤ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰Í•±±•Èé…ÁÑÕÉ”µÁÉ½É•ÍÌˆ°ì(€€€€€…ÑÑ•¹Ñ¥½¹I•ÅÕ¥É•èÑÉÕ”°(€€€€€µ•ÍÍ…”è€‰A=%i=8ƒ®†sªÞã²vàƒ®bC®*Pƒ®ÎÓ²V ƒ¶fW²vã²vÐƒ¶V²jS¶VÐƒ¶2C®ž“²zC²ó¶Àƒ²Â÷²vƒ¶Fs².s¶Z#²*×®.#®.¸ˆ°(€€€ô¤ì(€ôì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰Í•±±•Èé…ÁÑÕÉ”µÁÉ½É•ÍÌˆ°ìÁ•É•¹Ðè€È°½Õ¹Ðè€À°µ•ÍÍ…”è€‹¶2C®ž“²zC²ó¶Ã®–ðƒ²^³®*Pƒ²’Dˆô¤ì(€€€½Á•¹M•±±•É•¹Ñ•É]¥¹‘½Ü¡M11I}9QI}UI0°ìÙ¥Í¥‰±”è™…±Í”ô¤ì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÈÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÔÀÀ¤ì(€€€€€¥˜€¡Í•±±•É]¥¹‘½Ü€˜˜€…Í•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤€˜˜Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•ÑUI0 ¤¤‰É•…¬ì(€€€ô(€€€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹¶2C®ž“²zC²ó¶Àƒ²Â÷²vƒ²^Ó²ž ƒ®ªï¶Z#²*×®.#®.¸ˆôì(€€€ô(€ô(€¥˜€¡Í•±±•É]¥¹‘½Ü€˜˜€…Í•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€µ¥¹¥µ¥é•M•±±•ÉÕÑ½µ…Ñ¥½¹]¥¹‘½Ü ‰A=%i=8ƒ®†sªÞã²vàƒ²ã²c²vƒ®ÂÇªÞã®vó²jÓ®Ns²^C²pƒ¶fW²vàƒ²’G²z®.#®.¸ˆ¤ì(€ô(€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰Í•±±•Èé…ÁÑÕÉ”µÁÉ½É•ÍÌˆ°ìÁ•É•¹Ðè€Ô°½Õ¹Ðè€À°µ•ÍÍ…”è€‹®†sªÞã²vàƒ²ã²`ƒ¶fW²vàƒ²’Dˆô¤ì(€±•ÐÕÉÉ•¹ÑUÉ°€ôÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•ÑUI0 ¤ì(€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÈÀ€˜˜€…ÕÉÉ•¹ÑUÉ°ì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€…Ý…¥ÐÝ…¥Ð ÔÀÀ¤ì(€€€ÕÉÉ•¹ÑUÉ°€ôÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•ÑUI0 ¤ì(€ô(€¥˜€ …ÕÉÉ•¹ÑUÉ°¹ÍÑ…ÉÑÍ]¥Ñ  ‰¡ÑÑÁÌè¼½Í•±±•È¹Á½¥é½¸¹½´¼ˆ¤¤ì(€€€É•Ù•…±M•±±•É1½¥¸ ¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹¶2C®ž“²zC²ó¶Àƒ²vãªâÃ²¶J ƒ¶fS®¦Ó²ró®†pƒ²vÓ®>g¶VÐƒ²Žó²ã²jP¸ˆôì(€ô(€¥˜€ …ÕÉÉ•¹ÑUÉ°¹¥¹±Õ‘•Ì ˆ½µ…¥¸½‘…Ñ…•¹Ñ•È½µ•É¡…¹ÑI…¹­	½…Éˆ¤¤ì(€€€…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹±½…‘UI0¡M11I}9QI}UI0¤ì(€€€…Ý…¥ÐÝ…¥Ð Å|àÀÀ¤ì(€€€ÕÉÉ•¹ÑUÉ°€ôÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•ÑUI0 ¤ì(€€€¥˜€ …ÕÉÉ•¹ÑUÉ°¹¥¹±Õ‘•Ì ˆ½µ…¥¸½‘…Ñ…•¹Ñ•È½µ•É¡…¹ÑI…¹­	½…Éˆ¤¤ì(€€€€€É•Ù•…±M•±±•É1½¥¸ ¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹¶2C®ž“²zC²ó¶Àƒ®†sªÞã²vã²vƒ²f®Ž3¶VÐƒ²Žó²ã²jP¸ƒ®†sªÞã²vàƒ²ã²c²v ƒ®.“²v0ƒ².“¶Z'®Ú¶Àƒ²zC®>g²ró®†pƒ²rƒ²ž®B§®.#®.¸ˆôì(€€€ô(€ô(€Í•±±•É]¥¹‘½Ü¹µ…á¥µ¥é” ¤ì(€µ¥¹¥µ¥é•M•±±•ÉÕÑ½µ…Ñ¥½¹]¥¹‘½Ü ‰A=%i=8ƒ²vãªâÃ²¶J ƒ²†ÃªÆÓ²vƒ®ÂÇªÞã®vó²jÓ®Ns²^C²pƒ²‚²j¤ƒ²’G²z®.#®.¸ˆ¤ì(€…Ý…¥ÐÝ…¥Ð ÜÀÀ¤ì(€½¹ÍÐ¹•ÑÝ½É­AÉ½‘ÕÑÌ€ômtì(€±•Ð‘•‰Õ•É1¥ÍÑ•¹•Èì(€±•Ð‘•‰Õ•ÉÑÑ…¡•‘!•É”€ô™…±Í”ì(€ÑÉäì(€€€¥˜€ …Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹¥ÍÑÑ…¡• ¤¤ì(€€€€€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹…ÑÑ…  ˆÄ¸Ìˆ¤ì(€€€€€‘•‰Õ•ÉÑÑ…¡•‘!•É”€ôÑÉÕ”ì(€€€ô(€€€…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹Í•¹‘½µµ…¹ ‰9•ÑÝ½É¬¹•¹…‰±”ˆ¤ì(€€€‘•‰Õ•É1¥ÍÑ•¹•È€ô…Íå¹Œ€¡}•Ù•¹Ð°µ•Ñ¡½°Á…É…µÌ¤€ôøì(€€€€€¥˜€¡µ•Ñ¡½€„ôô€‰9•ÑÝ½É¬¹É•ÍÁ½¹Í•I••¥Ù•ˆñð€…l‰a!Hˆ°€‰•Ñ ‰t¹¥¹±Õ‘•Ì¡Á…É…µÌü¹ÑåÁ”¤¤É•ÑÕÉ¸ì(€€€€€¥˜€ …MÑÉ¥¹œ¡Á…É…µÌü¹É•ÍÁ½¹Í”ü¹ÕÉ°ñð€ˆˆ¤¹¥¹±Õ‘•Ì ‰Í•±±•È¹Á½¥é½¸¹½´ˆ¤¤É•ÑÕÉ¸ì(€€€€€ÑÉäì(€€€€€€€½¹ÍÐ‰½‘ä€ô…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹Í•¹‘½µµ…¹ ‰9•ÑÝ½É¬¹•ÑI•ÍÁ½¹Í•	½‘äˆ°ì(€€€€€€€€€É•ÅÕ•ÍÑ%èÁ…É…µÌ¹É•ÅÕ•ÍÑ%°(€€€€€€€ô¤ì(€€€€€€€½¹ÍÐÁ…ÉÍ•€ô)M=8¹Á…ÉÍ”¡‰½‘ä¹‰…Í”ØÑ¹½‘•(€€€€€€€€€€ü	Õ™™•È¹™É½´¡‰½‘ä¹‰½‘ä°€‰‰…Í”ØÐˆ¤¹Ñ½MÑÉ¥¹œ ‰ÕÑ˜àˆ¤(€€€€€€€€€€è‰½‘ä¹‰½‘ä¤ì(€€€€€€€¹•ÑÝ½É­AÉ½‘ÕÑÌ¹ÁÕÍ  ¸¸¹•áÑÉ…ÑM•±±•ÉÁ¥AÉ½‘ÕÑÌ¡Á…ÉÍ•°€ÈÀÀ¤¤ì(€€€€€ô…Ñ ì(€€€€€€€€¼¼)M=;²vÐƒ²V®.0ƒ²vG®.×²vÓ®
`ƒ®ÎÓ²V ƒ²vG®.×²v ƒ¶fS®¦Ðƒ²V#²‚W¶fPƒ²"c²žG²ró®†pƒ²Êc®š³¶V§®.#®.¸(€€€€€ô(€€€ôì(€€€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹½¸ ‰µ•ÍÍ…”ˆ°‘•‰Õ•É1¥ÍÑ•¹•È¤ì(€ô…Ñ ì(€€€‘•‰Õ•ÉÑÑ…¡•‘!•É”€ô™…±Í”ì(€ô(€½¹ÍÐÍÑ½Á9•ÑÝ½É­…ÁÑÕÉ”€ô€ ¤€ôøì(€€€¥˜€¡‘•‰Õ•É1¥ÍÑ•¹•È¤Í•±±•É]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹É•µ½Ù•1¥ÍÑ•¹•È ‰µ•ÍÍ…”ˆ°‘•‰Õ•É1¥ÍÑ•¹•È¤ì(€€€¥˜€¡‘•‰Õ•ÉÑÑ…¡•‘!•É”€˜˜Í•±±•É]¥¹‘½Ü€˜˜€…Í•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤€˜˜Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹¥ÍÑÑ…¡• ¤¤ì(€€€€€ÑÉäìÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹‘•Ñ…  ¤ìô…Ñ íô(€€€ô(€ôì(€±•Ð½¹‘¥Ñ¥½¹I•ÍÕ±ÑÌ€ômtì(€±•Ð™…¥±•‘½¹‘¥Ñ¥½¹Ì€ômtì(€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Äì…ÑÑ•µÁÐ€ðô€Ìì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰Í•±±•Èé…ÁÑÕÉ”µÁÉ½É•ÍÌˆ°ì(€€€€€Á•É•¹Ðè€Ô€¬…ÑÑ•µÁÐ°(€€€€€½Õ¹Ðè€À°(€€€€€µ•ÍÍ…”èƒ²vãªâÃ²¶J ƒ²†ÃªÆÐƒ²‚²j¤ƒ²’D€ ‘í…ÑÑ•µÁÑô¼Ì¥€°(€€€ô¤ì(€€€½¹‘¥Ñ¥½¹I•ÍÕ±ÑÌ€ô…Ý…¥Ð…ÁÁ±åM•±±•ÉA½ÁÕ±…É½¹‘¥Ñ¥½¹Ì ¤ì(€€€™…¥±•‘½¹‘¥Ñ¥½¹Ì€ô½¹‘¥Ñ¥½¹I•ÍÕ±ÑÌ¹™¥±Ñ•È ¡½¹‘¥Ñ¥½¸¤€ôø€ (€€€€€€…½¹‘¥Ñ¥½¸¹™½Õ¹(€€€€€ñð€¡½¹‘¥Ñ¥½¸¹…Ñ¥½¸€ôôô€‰Í•±•Ðˆ€˜˜€…½¹‘¥Ñ¥½¸¹Ù•É¥™¥•‘M•±•Ñ•¤(€€€€€ñð€¡½¹‘¥Ñ¥½¸¹…Ñ¥½¸€ôôô€‰™Õ±±ÍÉ••¸ˆ€˜˜€…½¹‘¥Ñ¥½¸¹•áÁ…¹‘•¤(€€€€¤¤ì(€€€¥˜€ …™…¥±•‘½¹‘¥Ñ¥½¹Ì¹±•¹Ñ ¤‰É•…¬ì(€€€…Ý…¥ÐÝ…¥Ð Å|ÔÀÀ€¨…ÑÑ•µÁÐ¤ì(€ô(€¥˜€¡™…¥±•‘½¹‘¥Ñ¥½¹Ì¹±•¹Ñ ¤ì(€€€ÍÑ½Á9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€µ•ÍÍ…”èƒ²vãªâÃ²¶J ƒ²†ÃªÆÐƒ¶fW²vàƒ².“¶2 è€‘í™…¥±•‘½¹‘¥Ñ¥½¹Ì¹µ…À ¡½¹‘¥Ñ¥½¸¤€ôø½¹‘¥Ñ¥½¸¹±…‰•°¤¹©½¥¸ ˆ°€ˆ¥ô¸ƒ²zc®ªï®Bpƒ®6Ã²vÓ¶Ã®*Pƒ²‚²z—¶Vc²ž ƒ²V+²Vc²*×®.#®.¹€°(€€€€€½¹‘¥Ñ¥½¹Ìè½¹‘¥Ñ¥½¹I•ÍÕ±ÑÌ°(€€€ôì(€ô(€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰Í•±±•Èé…ÁÑÕÉ”µÁÉ½É•ÍÌˆ°ì(€€€Á•É•¹Ðè€ÄÈ°(€€€½Õ¹Ðè€À°(€€€µ•ÍÍ…”è€‹²vó²Žó²vðƒ²‚ƒ
Üƒ²ŽóªÂƒ®2®æƒ
Üƒ¶2C®žƒ²vãªâÀƒ®K²v ƒ²"pƒ
ÜMATƒ
Üƒ²vãªâÃ²¶J ƒ²‚²ÊÓ¶fS®¦Ðƒ¶fW²vàƒ²f®Ž0ˆ°(€ô¤ì(€½¹ÍÐ™Õ±±ÍÉ••¹½¹‘¥Ñ¥½¸€ô½¹‘¥Ñ¥½¹I•ÍÕ±ÑÌ¹™¥¹ ¡½¹‘¥Ñ¥½¸¤€ôø½¹‘¥Ñ¥½¸¹­•ä€ôôô€‰™Õ±±ÍÉ••¸ˆ¤ì(€¥˜€ …™Õ±±ÍÉ••¹½¹‘¥Ñ¥½¸ü¹™½Õ¹¤ì(€€€ÍÑ½Á9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€µ•ÍÍ…”èƒ²vãªâÃ²¶J ƒ²‚²ÊÓ¶fS®¦Ðƒ®Ê¶*ó²vƒ®"®–Ó²ž ƒ®ªï¶Z#²*×®.#®.¸ƒ²zc®ªï®Bp€çªÂpƒ®ª§®†w²v ƒ²‚²z—¶Vc²ž ƒ²V+²*×®.#®.¸‘í™Õ±±ÍÉ••¹½¹‘¥Ñ¥½¸ü¹à€„ôôÕ¹‘•™¥¹•€ü€ƒ¶Ó®š´ƒ²Š3¶Fp€ ‘í™Õ±±ÍÉ••¹½¹‘¥Ñ¥½¸¹áô°€‘í™Õ±±ÍÉ••¹½¹‘¥Ñ¥½¸¹åô¤°ƒ®2²€‘í™Õ±±ÍÉ••¹½¹‘¥Ñ¥½¸¹Ñ…É•ÑQ…œñð€‹²^²v0‰õ€€è€ˆ‰õ€°(€€€€€½¹‘¥Ñ¥½¹Ìè½¹‘¥Ñ¥½¹I•ÍÕ±ÑÌ°(€€€ôì(€ô(€½¹ÍÐ™É…µ•Ì€ômÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹µ…¥¹É…µ”°€¸¸¸¡Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹µ…¥¹É…µ”¹™É…µ•Í%¹MÕ‰ÑÉ•”ñðmt¥t(€€€€¹™¥±Ñ•È ¡™É…µ”°¥¹‘•à°…±°¤€ôø…±°¹™¥¹‘%¹‘•à ¡…¹‘¥‘…Ñ”¤€ôø…¹‘¥‘…Ñ”¹É½ÕÑ¥¹%€ôôô™É…µ”¹É½ÕÑ¥¹%¤€ôôô¥¹‘•à¤ì(€½¹ÍÐ…ÁÑÕÉ•Ì€ômtì(€½¹ÍÐ±¥µ¥Ð€ô€ÈÀÀì(€½¹ÍÐ…ÁÑÕÉ•‘9½‘•Ì€ô¹•Ü5…À ¤ì(€½¹ÍÐÉ…¹­M±½ÑÌ€ô¹•Ü5…À ¤ì(€½¹ÍÐÍÑ…‰±•=‰Í•ÉÙ…Ñ¥½¹Ì€ô¹•Ü5…À ¤ì(€½¹ÍÐÉ…¹­A½Í¥Ñ¥½¹Ì€ô¹•Ü5…À ¤ì(€½¹ÍÐÉ…¹­%Í½µÁ±•Ñ”€ô€¡É…¹¬¤€ôøì(€€€½¹ÍÐÁÉ½‘ÕÐ€ôÉ…¹­M±½ÑÌ¹•Ð¡É…¹¬¤ì(€€€É•ÑÕÉ¸	½½±•…¸ (€€€€€MÑÉ¥¹œ¡ÁÉ½‘ÕÐü¹…ÉÑ¥±•9Õµ‰•Èñð€ˆˆ¤¹ÑÉ¥´ ¤(€€€€€€˜˜MÑÉ¥¹œ¡ÁÉ½‘ÕÐü¹¹…µ”ñð€ˆˆ¤¹ÑÉ¥´ ¤(€€€€€€˜˜9Õµ‰•È¡ÁÉ½‘ÕÐü¹…Ù•É…•AÉ¥”ñð€À¤€ø€À(€€€€€€˜˜ÁÉ½‘ÕÐü¹µ¥ÍÍ¥¹I…¹¬€„ôôÑÉÕ”(€€€€¤ì(€ôì(€½¹ÍÐ½µÁ±•Ñ•I…¹­½Õ¹Ð€ô€ ¤€ôøÁ½ÁÕ±…É½µÁ±•Ñ•¹•ÍÌ¡l¸¸¹É…¹­M±½ÑÌ¹Ù…±Õ•Ì ¥t°±¥µ¥Ð¤¹…ÁÑÕÉ•ì(€½¹ÍÐ…‘‘½¹™¥Éµ•‘AÉ½‘ÕÐ€ô€¡ÁÉ½‘ÕÐ¤€ôøì(€€€½¹ÍÐÉ…¹¬€ô9Õµ‰•È¡ÁÉ½‘ÕÐ¹É…¹¬ñð€À¤ì(€€€½¹ÍÐ…ÉÑ¥±•9Õµ‰•È€ôMÑÉ¥¹œ¡ÁÉ½‘ÕÐ¹…ÉÑ¥±•9Õµ‰•Èñð€ˆˆ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€½¹ÍÐ¹…µ”€ôMÑÉ¥¹œ¡ÁÉ½‘ÕÐ¹¹…µ”ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€¥˜€¡É…¹¬€ð€ÄñðÉ…¹¬€ø±¥µ¥Ðñð€ ……ÉÑ¥±•9Õµ‰•È€˜˜€…¹…µ”¤¤É•ÑÕÉ¸ì(€€€½¹ÍÐµ•É•€ôµ•É•M•±±•ÉAÉ½‘ÕÑÍ	åI…¹¬¡mmÉ…¹­M±½ÑÌ¹•Ð¡É…¹¬¥t°mì€¸¸¹ÁÉ½‘ÕÐ°…ÉÑ¥±•9Õµ‰•È°¹…µ”õut°±¥µ¥Ð¥lÁtì(€€€¥˜€¡µ•É•¤É…¹­M±½ÑÌ¹Í•Ð¡É…¹¬°µ•É•¤ì(€ôì(€½¹ÍÐ…‘‘9½‘•ÍQ½M±½ÑÌ€ô€¡¹½‘•Ì°ÍÉ½±±Q½À€ô€À°ÍÉ½±±5…á¥µÕ´€ô€À¤€ôøì(€€€™½È€¡½¹ÍÐÁÉ½‘ÕÐ½˜Á…ÉÍ•M•±±•É½µ9½‘•Ì¡¹½‘•Ì°±¥µ¥Ð¤¤ì(€€€€€½¹ÍÐÉ…¹¬€ô9Õµ‰•È¡ÁÉ½‘ÕÐ¹É…¹¬ñð€À¤ì(€€€€€½¹ÍÐ…ÉÑ¥±•9Õµ‰•È€ôMÑÉ¥¹œ¡ÁÉ½‘ÕÐ¹…ÉÑ¥±•9Õµ‰•Èñð€ˆˆ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€€€¥˜€ …ÁÉ½‘ÕÐ¹É…¹­•Ñ•Ñ•ñðÉ…¹¬€ð€ÄñðÉ…¹¬€ø±¥µ¥Ðñð€……ÉÑ¥±•9Õµ‰•È¤½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐÍ¥¹…ÑÕÉ”€ô)M=8¹ÍÑÉ¥¹¥™ä¡l(€€€€€€€…ÉÑ¥±•9Õµ‰•È°(€€€€€€€ÁÉ½‘ÕÐ¹¹…µ”°(€€€€€€€9Õµ‰•È¡ÁÉ½‘ÕÐ¹…Ù•É…•AÉ¥”ñð€À¤°(€€€€€€€9Õµ‰•È¡ÁÉ½‘ÕÐ¹±½Ý•ÍÑAÉ¥”ñð€À¤°(€€€€€€€9Õµ‰•È¡ÁÉ½‘ÕÐ¹¡¥¡•ÍÑAÉ¥”ñð€À¤°(€€€€€t¤ì(€€€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ôÍÑ…‰±•=‰Í•ÉÙ…Ñ¥½¹Ì¹•Ð¡É…¹¬¤ì(€€€€€½¹ÍÐ½‰Í•ÉÙ…Ñ¥½¸€ôÁÉ•Ù¥½ÕÌü¹Í¥¹…ÑÕÉ”€ôôôÍ¥¹…ÑÕÉ”(€€€€€€€€üìÍ¥¹…ÑÕÉ”°½Õ¹ÐèÁÉ•Ù¥½ÕÌ¹½Õ¹Ð€¬€Ä°ÁÉ½‘ÕÐô(€€€€€€€€èìÍ¥¹…ÑÕÉ”°½Õ¹Ðè€Ä°ÁÉ½‘ÕÐôì(€€€€€ÍÑ…‰±•=‰Í•ÉÙ…Ñ¥½¹Ì¹Í•Ð¡É…¹¬°½‰Í•ÉÙ…Ñ¥½¸¤ì(€€€€€¥˜€¡ÍÉ½±±5…á¥µÕ´€ø€À¤ì(€€€€€€€½¹ÍÐÉ…Ñ¥¼€ô5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ Ä°9Õµ‰•È¡ÍÉ½±±Q½Àñð€À¤€¼9Õµ‰•È¡ÍÉ½±±5…á¥µÕ´¤¤¤ì(€€€€€€€½¹ÍÐÁ½Í¥Ñ¥½¹Ì€ôÉ…¹­A½Í¥Ñ¥½¹Ì¹•Ð¡É…¹¬¤ñðmtì(€€€€€€€Á½Í¥Ñ¥½¹Ì¹ÁÕÍ ¡É…Ñ¥¼¤ì(€€€€€€€É…¹­A½Í¥Ñ¥½¹Ì¹Í•Ð¡É…¹¬°Á½Í¥Ñ¥½¹Ì¹Í±¥” ´à¤¤ì(€€€€€ô(€€€€€€¼¼‘•Ñ•Ñ•É…¹¬¥ÌÁ…ÍÑ•‘¥É•Ñ±ä¥¹Ñ¼Ñ¡”µ…Ñ¡¥¹œ€Ä´ÈÀÀÍ±½Ð¸(€€€€€€¼¼1…Ñ•È½‰Í•ÉÙ…Ñ¥½¹Ìµ…äÙ•É¥™ä¥Ð°‰ÕÐ„Í¥¹±”Ù…±¥É½Ü¥Ì¹•Ù•È(€€€€€€¼¼‘¥Í…É‘•µ•É•±ä‰•…ÕÍ”Ù¥ÉÑÕ…±¥é…Ñ¥½¸É•µ½Ù•¥Ð™É½´Ñ¡”ÍÉ••¸¸(€€€€€…‘‘½¹™¥Éµ•‘AÉ½‘ÕÐ¡ÁÉ½‘ÕÐ¤ì(€€€ô(€ôì(€½¹ÍÐ…ÁÑÕÉ•É…µ•]¥Ñ¡Q¥µ•½ÕÐ€ô…Íå¹Œ€¡™É…µ”°Ñ¥µ•½ÕÑ5Ì€ô€É|ÔÀÀ¤€ôøAÉ½µ¥Í”¹É…”¡l(€€€™É…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡M11I}AQUI}MI%AP°ÑÉÕ”¤°(€€€¹•ÜAÉ½µ¥Í” ¡|°É•©•Ð¤€ôøÍ•ÑQ¥µ•½ÕÐ (€€€€€€ ¤€ôøÉ•©•Ð¡¹•ÜÉÉ½È ‰Í•±±•È™É…µ”…ÁÑÕÉ”Ñ¥µ•½ÕÐˆ¤¤°(€€€€€Ñ¥µ•½ÕÑ5Ì°(€€€€¤¤°(€t¤ì(€½¹ÍÐ…ÁÑÕÉ•Y¥Í¥‰±•M±½ÑÌ€ô…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÍ¥¹…ÑÕÉ•Ì€ômtì(€€€™½È€¡½¹ÍÐ™É…µ”½˜™É…µ•Ì¤ì(€€€€€ÑÉäì(€€€€€€€½¹ÍÐ…ÁÑÕÉ•€ô…Ý…¥Ð…ÁÑÕÉ•É…µ•]¥Ñ¡Q¥µ•½ÕÐ¡™É…µ”¤ì(€€€€€€€¥˜€ ……ÁÑÕÉ•ü¹Í½Á•Y•É¥™¥•¤½¹Ñ¥¹Õ”ì(€€€€€€€…ÁÑÕÉ•Ì¹ÁÕÍ ¡…ÁÑÕÉ•¤ì(€€€€€€€¥˜€¡…ÁÑÕÉ•¹Í¥¹…ÑÕÉ”¤Í¥¹…ÑÕÉ•Ì¹ÁÕÍ ¡MÑÉ¥¹œ¡…ÁÑÕÉ•¹Í¥¹…ÑÕÉ”¤¤ì(€€€€€€€™½È€¡½¹ÍÐ¹½‘”½˜…ÁÑÕÉ•¹¹½‘•Ìñðmt¤ì(€€€€€€€€€…ÁÑÕÉ•‘9½‘•Ì¹Í•Ð¡€‘íMÑÉ¥¹œ¡¹½‘”¹Ñ•áÐñð€ˆˆ¥õq¸‘íMÑÉ¥¹œ¡¹½‘”¹¥µ…•UÉ°ñð€ˆˆ¥õ€°¹½‘”¤ì(€€€€€€€ô(€€€€€€€…‘‘9½‘•ÍQ½M±½ÑÌ¡…ÁÑÕÉ•¹¹½‘•Ìñðmt°…ÁÑÕÉ•¹ÍÉ½±±Q½À°…ÁÑÕÉ•¹ÍÉ½±±5…á¥µÕ´¤ì(€€€€€ô…Ñ ì(€€€€€€€€¼¼ƒ²‚GªÞó¶V€ƒ²"`ƒ²^®*PƒªÒGªÎ€¿®ÎÓ²V ƒ¶R®‚#²z²v ƒªÆÓ®#®r®.#®.¸(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸Í¥¹…ÑÕÉ•Ì¹Í½ÉÐ ¤¹©½¥¸ ‰q¸´µ™É…µ”´µq¸ˆ¤ì(€ôì(€µ¥¹¥µ¥é•M•±±•ÉÕÑ½µ…Ñ¥½¹]¥¹‘½Ü ‰A=%i=8ƒ²vãªâÃ²¶J €ÈÀÃªÆÓ²vƒ®ÂÇªÞã®vó²jÓ®Ns²^C²pƒ²"c²žDƒ²’G²z®.#®.¸ˆ¤ì(€½¹ÍÐ…ÁÑÕÉ•™Ñ•ÉI½Ý¡…¹”€ô…Íå¹Œ€¡ÁÉ•Ù¥½ÕÍM¥¹…ÑÕÉ”°…Ñ¹€ô™…±Í”¤€ôøì(€€€±•Ð±…Ñ•ÍÑM¥¹…ÑÕÉ”€ô€ˆˆì(€€€€¼¼Q¡”É…¹¬‰½…É¥ÌÙ¥ÉÑÕ…±¥é•…¹Í½µ•Ñ¥µ•ÌÁ…¥¹ÑÌ±…Ñ•ÈÑ¡…¸ÍÉ½±±Q½À¸(€€€€¼¼¼¹½Ð…‘Ù…¹”……¥¸Õ¹Ñ¥°Ñ¡”É•¹‘•É•É½ÜÍ•Ð…ÑÕ…±±ä¡…¹•Ì¸Ù•Éä(€€€€¼¼½‰Í•ÉÙ…Ñ¥½¸¥ÌÍÑ¥±°½±±•Ñ•°Í¼„Í¡½ÉÐµ±¥Ù•É½Ü…¹¹½Ð‰”Í­¥ÁÁ•¸(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÄÈì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€…Ý…¥ÐÝ…¥Ð¡…ÑÑ•µÁÐ€ôôô€À€ü€ÄÐÀ€è€ÄÄÀ€¬…ÑÑ•µÁÐ€¨€ÄÔ¤ì(€€€€€±…Ñ•ÍÑM¥¹…ÑÕÉ”€ô…Ý…¥Ð…ÁÑÕÉ•Y¥Í¥‰±•M±½ÑÌ ¤ì(€€€€€¥˜€¡…Ñ¹ñð€…ÁÉ•Ù¥½ÕÍM¥¹…ÑÕÉ”ñð€¡±…Ñ•ÍÑM¥¹…ÑÕÉ”€˜˜±…Ñ•ÍÑM¥¹…ÑÕÉ”€„ôôÁÉ•Ù¥½ÕÍM¥¹…ÑÕÉ”¤¤‰É•…¬ì(€€€ô(€€€É•ÑÕÉ¸±…Ñ•ÍÑM¥¹…ÑÕÉ”ñðÁÉ•Ù¥½ÕÍM¥¹…ÑÕÉ”ì(€ôì(€™½È€¡±•ÐÁ…ÍÌ€ô€ÀìÁ…ÍÌ€ð€Ì€˜˜½µÁ±•Ñ•I…¹­½Õ¹Ð ¤€ð±¥µ¥ÐìÁ…ÍÌ€¬ô€Ä¤ì(€€€…Ý…¥Ð‘É…M•±±•ÉMÉ½±±‰…ÉQ½I…Ñ¥¼ À¤ì(€€€…Ý…¥ÐÝ…¥Ð äÀÀ¤ì(€€€±•Ð…Ñ¹€ô™…±Í”ì(€€€±•Ð¥Ñ•É…Ñ¥½¸€ô€Àì(€€€±•ÐÙ¥Í¥‰±•M¥¹…ÑÕÉ”€ô€ˆˆì(€€€Ý¡¥±”€ ……Ñ¹€˜˜¥Ñ•É…Ñ¥½¸€ð€É|ÀÀÀ€˜˜½µÁ±•Ñ•I…¹­½Õ¹Ð ¤€ð±¥µ¥Ð¤ì(€€€€€¥Ñ•É…Ñ¥½¸€¬ô€Äì(€€€€€Ù¥Í¥‰±•M¥¹…ÑÕÉ”€ô…Ý…¥Ð…ÁÑÕÉ•Y¥Í¥‰±•M±½ÑÌ ¤ñðÙ¥Í¥‰±•M¥¹…ÑÕÉ”ì(€€€€€½¹ÍÐÍÉ½±±I•ÍÕ±Ð€ô…Ý…¥Ð•á•ÕÑ•É½ÍÍM•±±•ÉÉ…µ•Ì¡M11I}I=]}MI=11}MI%AP¤ì(€€€€€¥˜€ …ÍÉ½±±I•ÍÕ±Ðü¹™½Õ¹¤‰É•…¬ì(€€€€€…Ñ¹€ô	½½±•…¸¡ÍÉ½±±I•ÍÕ±Ð¹…Ñ¹¤ì(€€€€€Ù¥Í¥‰±•M¥¹…ÑÕÉ”€ô…Ý…¥Ð…ÁÑÕÉ•™Ñ•ÉI½Ý¡…¹”¡Ù¥Í¥‰±•M¥¹…ÑÕÉ”°…Ñ¹¤ì(€€€€€½¹ÍÐÑ…‰±•I…Ñ¥¼€ôÍÉ½±±I•ÍÕ±Ð¹µ…á¥µÕ´€ø€À(€€€€€€€€ü5…Ñ ¹µ¥¸ Ä°ÍÉ½±±I•ÍÕ±Ð¹…™Ñ•È€¼ÍÉ½±±I•ÍÕ±Ð¹µ…á¥µÕ´¤(€€€€€€€€è€Äì(€€€€€½¹ÍÐ‰…Í•A•É•¹Ð€ôÁ…ÍÌ€ôôô€À€ü€ÄÈ€è€àØ€¬€ ¡Á…ÍÌ€´€Ä¤€¨€Ø¤ì(€€€€€½¹ÍÐÁ…ÍÍI…¹”€ôÁ…ÍÌ€ôôô€À€ü€ÜÐ€è€Øì(€€€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰Í•±±•Èé…ÁÑÕÉ”µÁÉ½É•ÍÌˆ°ì(€€€€€€€Á•É•¹Ðè5…Ñ ¹µ¥¸ ää°5…Ñ ¹É½Õ¹¡‰…Í•A•É•¹Ð€¬Ñ…‰±•I…Ñ¥¼€¨Á…ÍÍI…¹”¤¤°(€€€€€€€½Õ¹Ðè½µÁ±•Ñ•I…¹­½Õ¹Ð ¤°(€€€€€€€Ñ…É•Ðè±¥µ¥Ð°(€€€€€€€µ¥ÍÍ¥¹œè±¥µ¥Ð€´½µÁ±•Ñ•I…¹­½Õ¹Ð ¤°(€€€€€€€µ•ÍÍ…”èÁ…ÍÌ€ôôô€À(€€€€€€€€€€ü€Åø‘í±¥µ¥Ñ÷²rƒ²*³®†¿²vƒ¶Vpƒ¶Z'²R¤ƒ¶fW²vàƒ²’Dƒ
Üƒ¶Fpƒ²r²æ`€‘í5…Ñ ¹É½Õ¹¡Ñ…‰±•I…Ñ¥¼€¨€ÄÀÀ¥ô•€(€€€€€€€€€€èƒ®"®vôƒ²*³®†¼ƒ²z³¶fW²và€‘íÁ…ÍÍô¼Èƒ
Üƒ¶Fpƒ²r²æ`€‘í5…Ñ ¹É½Õ¹¡Ñ…‰±•I…Ñ¥¼€¨€ÄÀÀ¥ô•€°(€€€€€ô¤ì(€€€ô(€€€…Ý…¥Ð…ÁÑÕÉ•Y¥Í¥‰±•M±½ÑÌ ¤ì(€ô(€¥˜€ ……ÁÑÕÉ•Ì¹±•¹Ñ ¤ì(€€€ÍÑ½Á9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€µ•ÍÍ…”è€‹¶2C®ž“²zC²ó¶Ã²v`ƒŠc²vãªâÃ²¶J#Šdƒ¶Fpƒ²b²^·²vƒ¶fW²vã¶Vc²ž ƒ®ªï¶Z#²*×®.#®.¸ƒŠc²vãªâÃ²¶J#Šdƒ²‚s®ª§ªÎðMAT½M-TƒªâÃ²’²vÐƒ¶V£ªî`ƒ®ÎÓ²vÓ®*Pƒ²¶s²^C²pƒ®.“².pƒ®"3®~°ƒ²Žó²ã²jP¸ˆ°(€€€ôì(€ô(€½¹ÍÐµ¥ÍÍ¥¹I…¹­É½ÕÁÌ€ô€ ¤€ôøì(€€€½¹ÍÐµ¥ÍÍ¥¹œ€ôÁ½ÁÕ±…É½µÁ±•Ñ•¹•ÍÌ¡l¸¸¹É…¹­M±½ÑÌ¹Ù…±Õ•Ì ¥t°±¥µ¥Ð¤¹µ¥ÍÍ¥¹I…¹­Ìì(€€€½¹ÍÐÉ½ÕÁÌ€ômtì(€€€™½È€¡½¹ÍÐÉ…¹¬½˜µ¥ÍÍ¥¹œ¤ì(€€€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ôÉ½ÕÁÌ¹…Ð ´Ä¤ì(€€€€€¥˜€¡ÁÉ•Ù¥½ÕÌ€˜˜ÁÉ•Ù¥½ÕÌ¹•¹€¬€Ä€ôôôÉ…¹¬¤ÁÉ•Ù¥½ÕÌ¹•¹€ôÉ…¹¬ì(€€€€€•±Í”É½ÕÁÌ¹ÁÕÍ ¡ìÍÑ…ÉÐèÉ…¹¬°•¹èÉ…¹¬ô¤ì(€€€ô(€€€É•ÑÕÉ¸É½ÕÁÌì(€ôì(€½¹ÍÐ½‰Í•ÉÙ•‘I…Ñ¥½½ÉI…¹¬€ô€¡É…¹¬¤€ôøì(€€€½¹ÍÐ½‰Í•ÉÙ…Ñ¥½¹Ì€ôl¸¸¹É…¹­A½Í¥Ñ¥½¹Ì¹•¹ÑÉ¥•Ì ¥t(€€€€€€¹µ…À ¡m½‰Í•ÉÙ•‘I…¹¬°É…Ñ¥½Ít¤€ôø€¡ì(€€€€€€€É…¹¬è9Õµ‰•È¡½‰Í•ÉÙ•‘I…¹¬¤°(€€€€€€€É…Ñ¥¼èÉ…Ñ¥½Ì¹É•‘Õ” ¡ÍÕ´°Ù…±Õ”¤€ôøÍÕ´€¬Ù…±Õ”°€À¤€¼5…Ñ ¹µ…à Ä°É…Ñ¥½Ì¹±•¹Ñ ¤°(€€€€€ô¤¤(€€€€€€¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø9Õµ‰•È¹¥Í¥¹¥Ñ”¡•¹ÑÉä¹É…Ñ¥¼¤¤(€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø±•™Ð¹É…¹¬€´É¥¡Ð¹É…¹¬¤ì(€€€½¹ÍÐ‰•™½É”€ôl¸¸¹½‰Í•ÉÙ…Ñ¥½¹Ít¹É•Ù•ÉÍ” ¤¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹É…¹¬€ðôÉ…¹¬¤ì(€€€½¹ÍÐ…™Ñ•È€ô½‰Í•ÉÙ…Ñ¥½¹Ì¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹É…¹¬€øôÉ…¹¬¤ì(€€€¥˜€¡‰•™½É”€˜˜…™Ñ•È€˜˜‰•™½É”¹É…¹¬€„ôô…™Ñ•È¹É…¹¬¤ì(€€€€€½¹ÍÐÁÉ½É•ÍÌ€ô€¡É…¹¬€´‰•™½É”¹É…¹¬¤€¼€¡…™Ñ•È¹É…¹¬€´‰•™½É”¹É…¹¬¤ì(€€€€€É•ÑÕÉ¸‰•™½É”¹É…Ñ¥¼€¬€¡…™Ñ•È¹É…Ñ¥¼€´‰•™½É”¹É…Ñ¥¼¤€¨ÁÉ½É•ÍÌì(€€€ô(€€€¥˜€¡‰•™½É”¤É•ÑÕÉ¸‰•™½É”¹É…Ñ¥¼ì(€€€¥˜€¡…™Ñ•È¤É•ÑÕÉ¸…™Ñ•È¹É…Ñ¥¼ì(€€€É•ÑÕÉ¸€¡É…¹¬€´€Ä¤€¼5…Ñ ¹µ…à Ä°±¥µ¥Ð€´€Ä¤ì(€ôì((€€¼¼I•Ù¥Í¥Ð½¹±äµ¥ÍÍ¥¹œÉ…¹¬É…¹•Ì¸A½Í¥Ñ¥½¹Ì½‰Í•ÉÙ•‘ÕÉ¥¹œÑ¡”™Õ±°Í…¸(€€¼¼…É”…ÕÑ¡½É¥Ñ…Ñ¥Ù”ìÑ¡”Í¥µÁ±”É…¹¬¼ÈÀÀÉ…Ñ¥¼¥ÌÕÍ•½¹±ä…Ì„™…±±‰…¬¸(€™½È€¡±•ÐÉ•½Ù•ÉåI½Õ¹€ô€ÀìÉ•½Ù•ÉåI½Õ¹€ð€Ô€˜˜½µÁ±•Ñ•I…¹­½Õ¹Ð ¤€ð±¥µ¥ÐìÉ•½Ù•ÉåI½Õ¹€¬ô€Ä¤ì(€€€™½È€¡½¹ÍÐÁÉ½‘ÕÐ½˜¹•ÑÝ½É­AÉ½‘ÕÑÌ¤…‘‘½¹™¥Éµ•‘AÉ½‘ÕÐ¡ÁÉ½‘ÕÐ¤ì(€€€½¹ÍÐÉ½ÕÁÌ€ôµ¥ÍÍ¥¹I…¹­É½ÕÁÌ ¤ì(€€€¥˜€ …É½ÕÁÌ¹±•¹Ñ ¤‰É•…¬ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰Í•±±•Èé…ÁÑÕÉ”µÁÉ½É•ÍÌˆ°ì(€€€€€Á•É•¹Ðè€äØ€¬5…Ñ ¹µ¥¸ Ì°É•½Ù•ÉåI½Õ¹¤°(€€€€€½Õ¹Ðè½µÁ±•Ñ•I…¹­½Õ¹Ð ¤°(€€€€€Ñ…É•Ðè±¥µ¥Ð°(€€€€€µ¥ÍÍ¥¹œè±¥µ¥Ð€´½µÁ±•Ñ•I…¹­½Õ¹Ð ¤°(€€€€€µ•ÍÍ…”èƒ®"®vôƒ²"s²r®ž0ƒ²‚W®Â ƒ²z³²"c²žD€‘íÉ•½Ù•ÉåI½Õ¹€¬€Åô¼Ôƒ
Ü€‘íÉ½ÕÁÌ¹µ…À ¡É½ÕÀ¤€ôøÉ½ÕÀ¹ÍÑ…ÉÐ€ôôôÉ½ÕÀ¹•¹€üÉ½ÕÀ¹ÍÑ…ÉÐ€è€‘íÉ½ÕÀ¹ÍÑ…ÉÑô´‘íÉ½ÕÀ¹•¹‘õ€¤¹Í±¥” À°€Äà¤¹©½¥¸ ˆ°€ˆ¥õ€°(€€€ô¤ì(€€€™½È€¡½¹ÍÐÉ½ÕÀ½˜É½ÕÁÌ¤ì(€€€€€½¹ÍÐÉ½ÕÁI…¹­Ì€ôÉÉ…ä¹™É½´¡ì±•¹Ñ èÉ½ÕÀ¹•¹€´É½ÕÀ¹ÍÑ…ÉÐ€¬€Äô°€¡}Ù…±Õ”°¥¹‘•à¤€ôøÉ½ÕÀ¹ÍÑ…ÉÐ€¬¥¹‘•à¤ì(€€€€€¥˜€¡É½ÕÁI…¹­Ì¹•Ù•Éä¡É…¹­%Í½µÁ±•Ñ”¤¤½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐÑ…É•ÑI…Ñ¥¼€ô5…Ñ ¹µ…à À°½‰Í•ÉÙ•‘I…Ñ¥½½ÉI…¹¬¡5…Ñ ¹µ…à Ä°É½ÕÀ¹ÍÑ…ÉÐ€´€È¤¤€´€À¸ÀÄÔ¤ì(€€€€€½¹ÍÐÑ…É•ÑI…¹¬€ô€Ä€¬Ñ…É•ÑI…Ñ¥¼€¨€¡±¥µ¥Ð€´€Ä¤ì(€€€€€…Ý…¥Ð•á•ÕÑ•É½ÍÍM•±±•ÉÉ…µ•Ì¡Í•±±•É)ÕµÁMÉ¥ÁÐ¡Ñ…É•ÑI…¹¬°±¥µ¥Ð¤¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ØÔÀ¤ì(€€€€€±•ÐÍ¥¹…ÑÕÉ”€ô…Ý…¥Ð…ÁÑÕÉ•Y¥Í¥‰±•M±½ÑÌ ¤ì(€€€€€½¹ÍÐµ…á¥µÕµM…¹Ì€ô5…Ñ ¹µ…à Äà°5…Ñ ¹µ¥¸ ÄØÀ°€¡É½ÕÀ¹•¹€´É½ÕÀ¹ÍÑ…ÉÐ€¬€à¤€¨€Ø¤¤ì(€€€€€™½È€¡±•ÐÍ…¸€ô€ÀìÍ…¸€ðµ…á¥µÕµM…¹ÌìÍ…¸€¬ô€Ä¤ì(€€€€€€€¥˜€¡É½ÕÁI…¹­Ì¹•Ù•Éä¡É…¹­%Í½µÁ±•Ñ”¤¤‰É•…¬ì(€€€€€€€½¹ÍÐÍÉ½±±I•ÍÕ±Ð€ô…Ý…¥Ð•á•ÕÑ•É½ÍÍM•±±•ÉÉ…µ•Ì¡M11I}I=]}MI=11}MI%AP¤ì(€€€€€€€¥˜€ …ÍÉ½±±I•ÍÕ±Ðü¹™½Õ¹¤‰É•…¬ì(€€€€€€€Í¥¹…ÑÕÉ”€ô…Ý…¥Ð…ÁÑÕÉ•™Ñ•ÉI½Ý¡…¹”¡Í¥¹…ÑÕÉ”°	½½±•…¸¡ÍÉ½±±I•ÍÕ±Ð¹…Ñ¹¤¤ì(€€€€€€€¥˜€¡ÍÉ½±±I•ÍÕ±Ð¹…Ñ¹¤‰É•…¬ì(€€€€€ô(€€€ô(€ô(€…Ý…¥ÐÝ…¥Ð ØÀÀ¤ì(€™½È€¡½¹ÍÐÁÉ½‘ÕÐ½˜¹•ÑÝ½É­AÉ½‘ÕÑÌ¤…‘‘½¹™¥Éµ•‘AÉ½‘ÕÐ¡ÁÉ½‘ÕÐ¤ì(€½¹ÍÐ…ÁÑÕÉ•½µÁ±•Ñ•¹•ÍÌ€ôÁ½ÁÕ±…É½µÁ±•Ñ•¹•ÍÌ¡l¸¸¹É…¹­M±½ÑÌ¹Ù…±Õ•Ì ¥t°±¥µ¥Ð¤ì(€¥˜€ ……ÁÑÕÉ•½µÁ±•Ñ•¹•ÍÌ¹½µÁ±•Ñ”¤ì(€€€ÍÑ½Á9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€€€½¹ÍÐµ¥ÍÍ¥¹1…‰•°€ô…ÁÑÕÉ•½µÁ±•Ñ•¹•ÍÌ¹µ¥ÍÍ¥¹I…¹­Ì¹Í±¥” À°€ÐÀ¤¹©½¥¸ ˆ°€ˆ¤ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰Í•±±•Èé…ÁÑÕÉ”µÁÉ½É•ÍÌˆ°ì(€€€€€Á•É•¹Ðè€ää°(€€€€€½Õ¹Ðè…ÁÑÕÉ•½µÁ±•Ñ•¹•ÍÌ¹…ÁÑÕÉ•°(€€€€€Ñ…É•Ðè±¥µ¥Ð°(€€€€€µ¥ÍÍ¥¹œè…ÁÑÕÉ•½µÁ±•Ñ•¹•ÍÌ¹µ¥ÍÍ¥¹I…¹­Ì¹±•¹Ñ °(€€€€€…ÑÑ•¹Ñ¥½¹I•ÅÕ¥É•èÑÉÕ”°(€€€€€µ•ÍÍ…”èƒ²f²‚ƒ²"c²žDƒ®¾ã®.°ƒ
Ü€‘í…ÁÑÕÉ•½µÁ±•Ñ•¹•ÍÌ¹…ÁÑÕÉ•‘ô¼‘í±¥µ¥Ñôƒ
Üƒ®"®vôƒ²"s²r€‘íµ¥ÍÍ¥¹1…‰•±ô‘í…ÁÑÕÉ•½µÁ±•Ñ•¹•ÍÌ¹µ¥ÍÍ¥¹I…¹­Ì¹±•¹Ñ €ø€ÐÀ€ü€‹Š˜ˆ€è€ˆ‰õ€°(€€€ô¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€½‘”è€‰A=AU1I}AQUI}%9=5A1Qˆ°(€€€€€É•ÑÉå…‰±”èÑÉÕ”°(€€€€€…ÁÑÕÉ•‘½Õ¹Ðè…ÁÑÕÉ•½µÁ±•Ñ•¹•ÍÌ¹…ÁÑÕÉ•°(€€€€€•áÁ•Ñ•‘½Õ¹Ðè±¥µ¥Ð°(€€€€€µ¥ÍÍ¥¹I…¹­Ìè…ÁÑÕÉ•½µÁ±•Ñ•¹•ÍÌ¹µ¥ÍÍ¥¹I…¹­Ì°(€€€€€µ•ÍÍ…”èƒ²vãªâÃ²¶J €‘í…ÁÑÕÉ•½µÁ±•Ñ•¹•ÍÌ¹…ÁÑÕÉ•‘ô¼‘í±¥µ¥Ñ÷ªÂs®ž0ƒ¶fW²vã®Bc²ZÐƒ²‚²z—¶Vc²ž ƒ²V+²Vc²*×®.#®.¸ƒ®"®vôƒ²"s²r€‘íµ¥ÍÍ¥¹1…‰•±ô‘í…ÁÑÕÉ•½µÁ±•Ñ•¹•ÍÌ¹µ¥ÍÍ¥¹I…¹­Ì¹±•¹Ñ €ø€ÐÀ€ü€‹Š˜ˆ€è€ˆ‰÷®–ðƒ®.“².pƒ²"c²žG¶VÐƒ²Žó²ã²jP¹€°(€€€ôì(€ô(€±•ÐÁÉ½‘ÕÑÌ€ômtì(€™½È€¡½¹ÍÐ…ÁÑÕÉ•½˜…ÁÑÕÉ•Ì¤ì(€€€½¹ÍÐÁ…ÉÍ•€ôÁ…ÉÍ•A½ÁÕ±…ÉAÉ½‘ÕÑÌ¡ìÑ•áÐè…ÁÑÕÉ•¹Ñ•áÐô¤ì(€€€¥˜€¡Á…ÉÍ•¹½¬€˜˜Á…ÉÍ•¹ÁÉ½‘ÕÑÌ¹±•¹Ñ €øÁÉ½‘ÕÑÌ¹±•¹Ñ ¤ÁÉ½‘ÕÑÌ€ôÁ…ÉÍ•¹ÁÉ½‘ÕÑÌì(€ô(€¥˜€ …ÁÉ½‘ÕÑÌ¹±•¹Ñ €˜˜…ÁÑÕÉ•Ì¹±•¹Ñ €ø€Ä¤ì(€€€½¹ÍÐ½µ‰¥¹•€ôÁ…ÉÍ•A½ÁÕ±…ÉAÉ½‘ÕÑÌ¡ìÑ•áÐè…ÁÑÕÉ•Ì¹µ…À ¡…ÁÑÕÉ”¤€ôø…ÁÑÕÉ”¹Ñ•áÐ¤¹©½¥¸ ‰q¸ˆ¤ô¤ì(€€€¥˜€¡½µ‰¥¹•¹½¬¤ÁÉ½‘ÕÑÌ€ô½µ‰¥¹•¹ÁÉ½‘ÕÑÌì(€ô(€½¹ÍÐ¹½‘•Ì€ôl¸¸¹…ÁÑÕÉ•‘9½‘•Ì¹Ù…±Õ•Ì ¥tì(€½¹ÍÐ¹½‘•AÉ½‘ÕÑÌ€ôÁ…ÉÍ•M•±±•É½µ9½‘•Ì¡¹½‘•Ì°±¥µ¥Ð¤ì(€¥˜€¡¹½‘•AÉ½‘ÕÑÌ¹±•¹Ñ €øÁÉ½‘ÕÑÌ¹±•¹Ñ ¤ÁÉ½‘ÕÑÌ€ô¹½‘•AÉ½‘ÕÑÌì(€½¹ÍÐÍ±½ÑAÉ½‘ÕÑÌ€ôl¸¸¹É…¹­M±½ÑÌ¹Ù…±Õ•Ì ¥t¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø±•™Ð¹É…¹¬€´É¥¡Ð¹É…¹¬¤ì(€ÁÉ½‘ÕÑÌ€ôµ•É•M•±±•ÉAÉ½‘ÕÑÍ	åI…¹¬¡l(€€€ÁÉ½‘ÕÑÌ°(€€€¹½‘•AÉ½‘ÕÑÌ°(€€€Í±½ÑAÉ½‘ÕÑÌ°(€€€¹•ÑÝ½É­AÉ½‘ÕÑÌ°(€t°±¥µ¥Ð¤ì(€½¹ÍÐÙ…±¥‘AÉ½‘ÕÑÌ€ôÁÉ½‘ÕÑÌ¹™¥±Ñ•È ¡ÁÉ½‘ÕÐ¤€ôøì(€€€½¹ÍÐ…ÉÑ¥±•9Õµ‰•È€ôMÑÉ¥¹œ¡ÁÉ½‘ÕÐ¹…ÉÑ¥±•9Õµ‰•Èñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ¹…µ”€ôMÑÉ¥¹œ¡ÁÉ½‘ÕÐ¹¹…µ”ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ¡…ÍI•…±ÉÑ¥±”€ô€……ÉÑ¥±•9Õµ‰•È(€€€€€ñð€½ymµhÀ´åumµhÀ´ä¹|¼µuìÈ°Ìåô üéqÌ­mµhÀ´åumµhÀ´ä¹|¼µuìÀ°Äåô¥ìÀ°Íô½¤¹Ñ•ÍÐ¡…ÉÑ¥±•9Õµ‰•È¤ì(€€€½¹ÍÐ¥Í!•…‘•È€ô€½x üéMATƒªâÃ²’ñM-TƒªâÃ²’ñMATƒªâÃ²’ M-TƒªâÃ²’ó²¶J#²‚W®ÎÑó¶>'ªÞ€ƒªÆÃ®zcªÂ  üéqp¡-I]qp¤¤ü¤½¤¹Ñ•ÍÐ¡¹…µ”¤ì(€€€É•ÑÕÉ¸¡…ÍI•…±ÉÑ¥±”€˜˜€…¥Í!•…‘•È€˜˜	½½±•…¸¡…ÉÑ¥±•9Õµ‰•Èñð¹…µ”¤ì(€ô¤ì(€¥˜€ …Ù…±¥‘AÉ½‘ÕÑÌ¹±•¹Ñ ¤ì(€€€ÍÑ½Á9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€€€½¹ÍÐ™É…µ•MÕµµ…Éä€ô…ÁÑÕÉ•Ì¹µ…À ¡…ÁÑÕÉ”¤€ôø€‘í…ÁÑÕÉ”¹Ñ¥Ñ±”ñð€‰™É…µ”‰ôè‘í…ÁÑÕÉ”¹Ñ•áÐ¹±•¹Ñ¡õ€¤¹©½¥¸ ˆ°€ˆ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€µ•ÍÍ…”èƒ²vãªâÃ²¶J ƒ¶Fs®*Pƒ¶fW²vã¶Z#²ž®ž0ƒ².“²‚pƒ¶J#®Ê#ªÎðƒªÂªÊ§²vÐƒ²z#®*Pƒ²¶J ƒ¶Z'²vƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¸ƒ¶Fs²v`€Ç²rƒ²¶J ƒ¶Z'²vÐƒ®ÎÓ²vÓ®>®†tƒ²*“¶³®†“¶Vpƒ®Jƒ®.“².pƒ®"3®~°ƒ²Žó²ã²jP¸‘í™É…µ•MÕµµ…Éä€ü€€£¶fW²vã¶Vpƒ¶fS®¦Ð€‘í…ÁÑÕÉ•Ì¹±•¹Ñ¡÷ªÂp¥€€è€ˆ‰õ€°(€€€ôì(€ô(€½¹ÍÐÁÉ•Í•ÉÙ•‘M±½ÑÌ€ô¹•Ü5…À ¤ì(€™½È€¡½¹ÍÐÁÉ½‘ÕÐ½˜Ù…±¥‘AÉ½‘ÕÑÌ¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôø9Õµ‰•È¡±•™Ð¹É…¹¬¤€´9Õµ‰•È¡É¥¡Ð¹É…¹¬¤¤¤ì(€€€½¹ÍÐÉ…¹¬€ô9Õµ‰•È¡ÁÉ½‘ÕÐ¹É…¹¬ñð€À¤ì(€€€½¹ÍÐ…ÉÑ¥±•9Õµ‰•È€ôMÑÉ¥¹œ¡ÁÉ½‘ÕÐ¹…ÉÑ¥±•9Õµ‰•Èñð€ˆˆ¤¹Ñ½UÁÁ•É…Í” ¤ì(€€€¥˜€¡É…¹¬€ð€ÄñðÉ…¹¬€ø±¥µ¥ÐñðÁÉ•Í•ÉÙ•‘M±½ÑÌ¹¡…Ì¡É…¹¬¤¤½¹Ñ¥¹Õ”ì(€€€ÁÉ•Í•ÉÙ•‘M±½ÑÌ¹Í•Ð¡É…¹¬°ì€¸¸¹ÁÉ½‘ÕÐ°…ÉÑ¥±•9Õµ‰•Èô¤ì(€ô(€½¹ÍÐ™¥¹…±½µÁ±•Ñ•¹•ÍÌ€ôÁ½ÁÕ±…É½µÁ±•Ñ•¹•ÍÌ¡l¸¸¹ÁÉ•Í•ÉÙ•‘M±½ÑÌ¹Ù…±Õ•Ì ¥t°±¥µ¥Ð¤ì(€¥˜€ …™¥¹…±½µÁ±•Ñ•¹•ÍÌ¹½µÁ±•Ñ”¤ì(€€€ÍÑ½Á9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€½‘”è€‰A=AU1I}AQUI}Y1%Q%=9}%1ˆ°(€€€€€É•ÑÉå…‰±”èÑÉÕ”°(€€€€€…ÁÑÕÉ•‘½Õ¹Ðè™¥¹…±½µÁ±•Ñ•¹•ÍÌ¹…ÁÑÕÉ•°(€€€€€•áÁ•Ñ•‘½Õ¹Ðè±¥µ¥Ð°(€€€€€µ¥ÍÍ¥¹I…¹­Ìè™¥¹…±½µÁ±•Ñ•¹•ÍÌ¹µ¥ÍÍ¥¹I…¹­Ì°(€€€€€µ•ÍÍ…”èƒ²"c²žDƒ¶nƒ¶J#®Ê ƒªÊ²šw²^C²p€‘í™¥¹…±½µÁ±•Ñ•¹•ÍÌ¹µ¥ÍÍ¥¹I…¹­Ì¹±•¹Ñ¡÷ªÂpƒ²"s²rªÂ ƒ²‚s²fã®Bc²ZÐƒ²‚²z—¶Vc²ž ƒ²V+²Vc²*×®.#®.¹€°(€€€ôì(€ô(€ÁÉ½‘ÕÑÌ€ôÉÉ…ä¹™É½´¡ì±•¹Ñ è±¥µ¥Ðô°€¡}Ù…±Õ”°¥¹‘•à¤€ôøÁÉ•Í•ÉÙ•‘M±½ÑÌ¹•Ð¡¥¹‘•à€¬€Ä¤¤ì(€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰Í•±±•Èé…ÁÑÕÉ”µÁÉ½É•ÍÌˆ°ì(€€€Á•É•¹Ðè€ÄÀÀ°(€€€½Õ¹ÐèÁÉ•Í•ÉÙ•‘M±½ÑÌ¹Í¥é”°(€€€Ñ…É•Ðè±¥µ¥Ð°(€€€µ¥ÍÍ¥¹œè€À°(€€€µ•ÍÍ…”è€Åø‘í±¥µ¥Ñ÷²rƒ²f²‚ƒ²"c²žDƒ¶fW²vàƒ
Üƒ²¶J €‘íÁÉ•Í•ÉÙ•‘M±½ÑÌ¹Í¥é•÷ªÂpƒ
Üƒ®"®vô€ÃªÂq€°(€ô¤ì(€ÍÑ½Á9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€½¹ÍÐ½‘•Ì€ôÁÉ½‘ÕÑÌ¹µ…À ¡ÁÉ½‘ÕÐ¤€ôøÁÉ½‘ÕÐ¹…ÉÑ¥±•9Õµ‰•È¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐ¥µ…•5…À€ôíôì(€™½È€¡½¹ÍÐ½‘”½˜½‘•Ì¤ì(€€€½¹ÍÐµ…Ñ¡¥¹9½‘”€ô¹½‘•Ì(€€€€€€¹™¥±Ñ•È ¡¹½‘”¤€ôø¹½‘”¹¥µ…•UÉ°€˜˜MÑÉ¥¹œ¡¹½‘”¹Ñ•áÐñð€ˆˆ¤¹¥¹±Õ‘•Ì¡½‘”¤¤(€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøMÑÉ¥¹œ¡±•™Ð¹Ñ•áÐñð€ˆˆ¤¹±•¹Ñ €´MÑÉ¥¹œ¡É¥¡Ð¹Ñ•áÐñð€ˆˆ¤¹±•¹Ñ ¥lÁtì(€€€¥˜€¡µ…Ñ¡¥¹9½‘”¤¥µ…•5…Ám½‘•t€ôµ…Ñ¡¥¹9½‘”¹¥µ…•UÉ°ì(€ô(€É•ÑÕÉ¸ì(€€€½¬èÑÉÕ”°(€€€Í½ÕÉ”è€‰Í•±±•Èµ•¹Ñ•Èµ‘¥É•Ðˆ°(€€€…ÁÑÕÉ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€Á…•UÉ°èÕÉÉ•¹ÑUÉ°°(€€€½¹‘¥Ñ¥½¹Ìè½¹‘¥Ñ¥½¹I•ÍÕ±ÑÌ°(€€€ÁÉ½‘ÕÑÌèÁÉ½‘ÕÑÌ¹µ…À ¡ÁÉ½‘ÕÐ¤€ôø€¡ì(€€€€€€¸¸¹ÁÉ½‘ÕÐ°(€€€€€±½½UÉ°è¥µ…•5…ÁmÁÉ½‘ÕÐ¹…ÉÑ¥±•9Õµ‰•Étñð€ˆˆ°(€€€€€Í•±±•É•¹Ñ•É¥É•ÐèÑÉÕ”°(€€€€€…Á¥5…Ñ¡•èÕ¹‘•™¥¹•°(€€€ô¤¤°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸…ÁÑÕÉ•M•±±•É	É…¹‘M…±•Ì¡¥¹ÁÕÐ€ôíô¤ì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€½Á•¹M•±±•É•¹Ñ•É]¥¹‘½Ü ¤ì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÈÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÔÀÀ¤ì(€€€€€¥˜€¡Í•±±•É]¥¹‘½Ü€˜˜€…Í•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤€˜˜Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•ÑUI0 ¤¤‰É•…¬ì(€€€ô(€ô(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹¶2C®ž“²zC²ó¶Àƒ²Â÷²vƒ²^Ó²ž ƒ®ªï¶Z#²*×®.#®.¸ˆôì(€ô(€¥˜€ ……Ý…¥Ð•¹Ñ•ÉM•±±•ÉAÉ½‘ÕÑM•…É¡Y¥…5•¹Ô ¤¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹¶2C®ž“²zC²ó¶Àƒ®†sªÞã²vã²vƒ¶fW²vã¶VÐƒ²Žó²ã²jP¸ˆôì(€ô(€½¹ÍÐ¹•ÑÝ½É­M•±±•ÉAÉ½‘ÕÑÌ€ômtì(€½¹ÍÐÁ•¹‘¥¹	É…¹‘I•ÍÁ½¹Í•Ì€ô¹•ÜM•Ð ¤ì(€±•Ð‰É…¹‘•‰Õ•É1¥ÍÑ•¹•Èì(€±•Ð‰É…¹‘•‰Õ•ÉÑÑ…¡•‘!•É”€ô™…±Í”ì(€½¹ÍÐÍÑ½Á	É…¹‘9•ÑÝ½É­…ÁÑÕÉ”€ô€ ¤€ôøì(€€€ÑÉäì(€€€€€¥˜€¡‰É…¹‘•‰Õ•É1¥ÍÑ•¹•È¤ì(€€€€€€€Í•±±•É]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹É•µ½Ù•1¥ÍÑ•¹•È ‰µ•ÍÍ…”ˆ°‰É…¹‘•‰Õ•É1¥ÍÑ•¹•È¤ì(€€€€€ô(€€€€€¥˜€¡‰É…¹‘•‰Õ•ÉÑÑ…¡•‘!•É”€˜˜Í•±±•É]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹¥ÍÑÑ…¡• ¤¤ì(€€€€€€€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹‘•Ñ…  ¤ì(€€€€€ô(€€€ô…Ñ íô(€ôì(€ÑÉäì(€€€½¹ÍÐÍ•±±•É•‰Õ•È€ôÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•Èì(€€€¥˜€ …Í•±±•É•‰Õ•È¹¥ÍÑÑ…¡• ¤¤ì(€€€€€Í•±±•É•‰Õ•È¹…ÑÑ…  ˆÄ¸Ìˆ¤ì(€€€€€‰É…¹‘•‰Õ•ÉÑÑ…¡•‘!•É”€ôÑÉÕ”ì(€€€ô(€€€…Ý…¥ÐÍ•±±•É•‰Õ•È¹Í•¹‘½µµ…¹ ‰9•ÑÝ½É¬¹•¹…‰±”ˆ¤ì(€€€‰É…¹‘•‰Õ•É1¥ÍÑ•¹•È€ô…Íå¹Œ€¡}•Ù•¹Ð°µ•Ñ¡½°Á…É…µÌ¤€ôøì(€€€€€¥˜€¡µ•Ñ¡½€ôôô€‰9•ÑÝ½É¬¹É•ÍÁ½¹Í•I••¥Ù•ˆ¤ì(€€€€€€€½¹ÍÐÉ•ÍÁ½¹Í”€ôÁ…É…µÌü¹É•ÍÁ½¹Í”ñðíôì(€€€€€€€¥˜€ …l‰a!Hˆ°€‰•Ñ ‰t¹¥¹±Õ‘•Ì¡Á…É…µÌü¹ÑåÁ”¤¤É•ÑÕÉ¸ì(€€€€€€€€¼¼M•±±•È•¹Ñ•ÈÍ•ÉÙ•ÌÁÉ½‘ÕÐµ•ÑÉ¥ÌÑ¡É½Õ Í•Ù•É…°…Ñ•Ý…ä¡½ÍÑÌ¸(€€€€€€€€¼¼Q¡¥Ì‘•‰Õ•È¥Ì…ÑÑ…¡•½¹±äÑ¼Ñ¡”‘•‘¥…Ñ•M•±±•È•¹Ñ•ÈÝ¥¹‘½Ü°(€€€€€€€€¼¼Í¼¥¹ÍÁ•Ð•Ù•Éäa!H½•Ñ É•ÍÁ½¹Í”¥¹ÍÑ•…½˜…ÍÍÕµ¥¹œ€¨¹Á½¥é½¸¹½´¸(€€€€€€€Á•¹‘¥¹	É…¹‘I•ÍÁ½¹Í•Ì¹…‘¡Á…É…µÌ¹É•ÅÕ•ÍÑ%¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€¥˜€¡µ•Ñ¡½€„ôô€‰9•ÑÝ½É¬¹±½…‘¥¹¥¹¥Í¡•ˆñð€…Á•¹‘¥¹	É…¹‘I•ÍÁ½¹Í•Ì¹¡…Ì¡Á…É…µÌü¹É•ÅÕ•ÍÑ%¤¤É•ÑÕÉ¸ì(€€€€€Á•¹‘¥¹	É…¹‘I•ÍÁ½¹Í•Ì¹‘•±•Ñ”¡Á…É…µÌ¹É•ÅÕ•ÍÑ%¤ì(€€€€€ÑÉäì(€€€€€€€½¹ÍÐÁ…å±½…€ô…Ý…¥ÐÍ•±±•É•‰Õ•È¹Í•¹‘½µµ…¹ ‰9•ÑÝ½É¬¹•ÑI•ÍÁ½¹Í•	½‘äˆ°ì(€€€€€€€€€É•ÅÕ•ÍÑ%èÁ…É…µÌ¹É•ÅÕ•ÍÑ%°(€€€€€€€ô¤ì(€€€€€€€½¹ÍÐÑ•áÐ€ôÁ…å±½…ü¹‰…Í”ØÑ¹½‘•(€€€€€€€€€€ü	Õ™™•È¹™É½´¡Á…å±½…¹‰½‘äñð€ˆˆ°€‰‰…Í”ØÐˆ¤¹Ñ½MÑÉ¥¹œ ‰ÕÑ˜àˆ¤(€€€€€€€€€€èMÑÉ¥¹œ¡Á…å±½…ü¹‰½‘äñð€ˆˆ¤ì(€€€€€€€¥˜€ „½yqÌ©mqmít¼¹Ñ•ÍÐ¡Ñ•áÐ¤¤É•ÑÕÉ¸ì(€€€€€€€¹•ÑÝ½É­M•±±•ÉAÉ½‘ÕÑÌ¹ÁÕÍ  ¸¸¹•áÑÉ…ÑM•±±•É	É…¹‘Á¥AÉ½‘ÕÑÌ¡)M=8¹Á…ÉÍ”¡Ñ•áÐ¤¤¤ì(€€€€€ô…Ñ íô(€€€ôì(€€€Í•±±•É•‰Õ•È¹½¸ ‰µ•ÍÍ…”ˆ°‰É…¹‘•‰Õ•É1¥ÍÑ•¹•È¤ì(€ô…Ñ íô(€€¼¼M•±±•È•¹Ñ•È­••ÁÌ‰É…¹¹…µ•Ì¥¸Ñ¡•¥È½É¥¥¹…°¹±¥Í ™½É´¸M•…É¡¥¹œ(€€¼¼„ÑÉ…¹Í±…Ñ•-½É•…¸±…‰•°™¥ÉÍÐ…¸±•…Ù”Ñ¡”Õ¹™¥±Ñ•É•€ä°äÀÀµÉ½ÜÑ…‰±”¸(€½¹ÍÐ‰É…¹‘9…µ•Ì€ôm¥¹ÁÕÐ¹‰É…¹‘9…µ”°¥¹ÁÕÐ¹‰É…¹‘-½t¹µ…À ¡Ù…±Õ”¤€ôøMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤¤¹™¥±Ñ•È¡	½½±•…¸¤ì(€½¹ÍÐÍ•±•Ñ•€ô…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐÍ•…É¡%¹ÁÕÐ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÐˆ¥t¹™¥¹ ¡•±•µ•¹Ð¤€ôø(€€€€€Ù¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜€¿²¶J#®ªqp¿²¶J#®Ê#¶báqp¿®â3®zs®Nqqp¿²æÓ¶3ªÎƒ®š±qp¿².s®š³²š ¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Á±…•¡½±‘•Èñð€ˆˆ¤(€€€€¤ì(€€€¥˜€¡Í•…É¡%¹ÁÕÐü¹Ù…±Õ”¤ì(€€€€€½¹ÍÐÍ•ÑÑ•È€ô=‰©•Ð¹•Ñ=Ý¹AÉ½Á•ÉÑå•ÍÉ¥ÁÑ½È¡!Q51%¹ÁÕÑ±•µ•¹Ð¹ÁÉ½Ñ½ÑåÁ”°€‰Ù…±Õ”ˆ¤¹Í•Ðì(€€€€€Í•ÑÑ•È¹…±°¡Í•…É¡%¹ÁÕÐ°€ˆˆ¤ì(€€€€€Í•…É¡%¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ‰¥¹ÁÕÐˆ°ì‰Õ‰‰±•ÌèÑÉÕ”ô¤¤ì(€€€€€Í•…É¡%¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ‰¡…¹”ˆ°ì‰Õ‰‰±•ÌèÑÉÕ”ô¤¤ì(€€€ô(€€€½¹ÍÐ±½‰…±I•Í•Ð€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹tˆ¥t¹™¥¹ ¡‰ÕÑÑ½¸¤€ôø(€€€€€Ù¥Í¥‰±”¡‰ÕÑÑ½¸¤€˜˜‰ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤€ôôô€‹²Ò#ªâÃ¶fPˆ(€€€€¤ì(€€€¥˜€¡±½‰…±I•Í•Ð¤ì(€€€€€±½‰…±I•Í•Ð¹±¥¬ ¤ì(€€€€€…Ý…¥ÐÝ…¥Ð àÀÀ¤ì(€€€ô(€€€€¼¼ƒ¶2C®ž“²zC²ó¶Àƒ².“²‚pƒ²¶J ƒªÊ²$ƒ¶fS®¦ÓªÎðƒ®>g²vó¶VpƒªâÃ®ÎàƒªÊ÷®†pè(€€€€¼¼ƒ²®. ƒ²¶J#²‚W®ÎÐƒ²z®‚—®z²^@ƒ²ƒ¶tƒ®â3®zs®Ns®–ðƒ²z®‚—¶VcªÎ€€‹ªÊ²$ƒ®Â<ƒ²z²ÂÀ‹²vƒ².“¶Z'¶Vs®.¸(€€€½¹ÍÐÁÉ•™•ÉÉ•‘9…µ•Ì€ô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡‰É…¹‘9…µ•Ì¥ôì(€€€€¼¼ƒ²®. ƒ¶×¶V§ªÊ²'²v I•…Ðƒ²¶sªÂ ƒ®Âc²b®Bc²ž ƒ²V+²Vƒ²‚²ÊÐ€ä°äÀÃªÆÓ²vÐƒªÞã®2®†p(€€€€¼¼ƒ®
£®*PƒªÊ÷²jÃªÂ ƒ²z#®.¸ƒ²‚W¶fW¶Vpƒ®â3®zs®Npƒ®Ns®†·®.“²jÐƒ¶V¶Ã®–ðƒ®¢ó²‚ ƒ²‚²j§¶VcªÎ€°(€€€€¼¼ƒ®Ns®†·®.“²jÓ²vƒ²Âû²ž ƒ®ªï¶Z#²vƒ®V3®ž0ƒ²®. ƒªÊ²'²vƒ®ÎÓ²†ÀƒªÊ÷®†s®†pƒ²
³²j§¶Vs®.¸(€€€½¹ÍÐ½Ý¹Q•áÐ€ô€¡•±•µ•¹Ð¤€ôøl¸¸¹•±•µ•¹Ð¹¡¥±‘9½‘•Ít(€€€€€€¹™¥±Ñ•È ¡¹½‘”¤€ôø¹½‘”¹¹½‘•QåÁ”€ôôô9½‘”¹QaQ}9=¤(€€€€€€¹µ…À ¡¹½‘”¤€ôø¹½‘”¹Ñ•áÑ½¹Ñ•¹Ð¤(€€€€€€¹©½¥¸ ˆˆ¤(€€€€€€¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ‰É…¹‘1…‰•°€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹t±±…‰•°±ÍÁ…¸±‘¥Øˆ¥t(€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøÙ¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜€¡½Ý¹Q•áÐ¡•±•µ•¹Ð¤€ôôô€‹®â3®zs®Npˆñð•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤€ôôô€‹®â3®zs®Npˆ¤¤(€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø„¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €´ˆ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ ¥lÁtì(€€€½¹ÍÐ‰É…¹‘	ÕÑÑ½¸€ô‰É…¹‘1…‰•°ü¹±½Í•ÍÐ ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹t°¹…¹ÐµÍ•±•Ð°¹…¹Ðµ‘É½Á‘½Ý¸µÑÉ¥•È°¹Í•µ¤µÍ•±•Ð°¹Í•µ¤µ‘É½Á‘½Ý¸µÑÉ¥•Èˆ¤(€€€€€ñð‰É…¹‘1…‰•°ì(€€€½¹ÍÐ¹…µ•Ì€ô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡‰É…¹‘9…µ•Ì¥ôì(€€€½¹ÍÐÍ•…É¡É½µQ½À€ô…Íå¹Œ€ ¤€ôøì(€€€€€½¹ÍÐÑ½ÁM•…É¡	ÕÑÑ½¸€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹tˆ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€¹™¥¹ ¡‰ÕÑÑ½¸¤€ôø€¿ªÊ²%qÌ«®Â=qÌ«²z²ÂÁóªÊ²$¼¹Ñ•ÍÐ¡‰ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤ì(€€€€€½¹ÍÐÑ½ÁM•…É¡%¹ÁÕÐ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÐˆ¥t(€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøÙ¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜l‰Ñ•áÐˆ°€‰Í•…É ˆ°€ˆ‰t¹¥¹±Õ‘•Ì¡•±•µ•¹Ð¹ÑåÁ”¤¤(€€€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €´„¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ ¥lÁtì(€€€€€¥˜€ …Ñ½ÁM•…É¡%¹ÁÕÐñð€…Ñ½ÁM•…É¡	ÕÑÑ½¸ñð€…¹…µ•ÍlÁt¤É•ÑÕÉ¸¹Õ±°ì(€€€€€½¹ÍÐÍ•ÑÑ•È€ô=‰©•Ð¹•Ñ=Ý¹AÉ½Á•ÉÑå•ÍÉ¥ÁÑ½È¡!Q51%¹ÁÕÑ±•µ•¹Ð¹ÁÉ½Ñ½ÑåÁ”°€‰Ù…±Õ”ˆ¤¹Í•Ðì(€€€€€Í•ÑÑ•È¹…±°¡Ñ½ÁM•…É¡%¹ÁÕÐ°¹…µ•ÍlÁt¤ì(€€€€€Ñ½ÁM•…É¡%¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ‰¥¹ÁÕÐˆ°ì‰Õ‰‰±•ÌèÑÉÕ”ô¤¤ì(€€€€€Ñ½ÁM•…É¡%¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ‰¡…¹”ˆ°ì‰Õ‰‰±•ÌèÑÉÕ”ô¤¤ì(€€€€€Ñ½ÁM•…É¡	ÕÑÑ½¸¹±¥¬ ¤ì(€€€€€…Ý…¥ÐÝ…¥Ð Å|ÔÀÀ¤ì(€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°Í•±•Ñ•è¹…µ•ÍlÁt°É½ÕÑ”è€‰Q=A}AI=UQ}MI ˆôì(€€€ôì(€€€¥˜€ …‰É…¹‘	ÕÑÑ½¸¤ì(€€€€€É•ÑÕÉ¸…Ý…¥ÐÍ•…É¡É½µQ½À ¤ñðì½¬è™…±Í”°É•…Í½¸è€‰	I9}	UQQ=9}9}Q=A}MI!}9=Q}=U9ˆôì(€€€ô(€€€‰É…¹‘	ÕÑÑ½¸¹±¥¬ ¤ì(€€€…Ý…¥ÐÝ…¥Ð ÔÀÀ¤ì(€€€½¹ÍÐÁ½ÁÕÀ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° mÉ½±”ô‰Ñ½½±Ñ¥À‰t±mÉ½±”ô‰‘¥…±½œ‰t°¹…¹ÐµÁ½Á½Ù•È°¹…¹Ðµ‘É½Á‘½Ý¸°¹…¹ÐµÍ•±•Ðµ‘É½Á‘½Ý¸°¹Í•µ¤µÁ½ÉÑ…°°¹Í•µ¤µÁ½Á½Ù•È°¹Í•µ¤µÍ•±•Ðµ‘É½Á‘½Ý¸œ¥t(€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤¹…Ð ´Ä¤ñð‘½Õµ•¹Ð¹‰½‘äì(€€€¥˜€ …Á½ÁÕÀ¤É•ÑÕÉ¸ì½¬è™…±Í”°É•…Í½¸è€‰	I9}A=AUA}9=Q}=U9ˆôì(€€€½¹ÍÐÉ•Í•Ð€ôl¸¸¹Á½ÁÕÀ¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹tˆ¥t¹™¥¹ ¡‰ÕÑÑ½¸¤€ôø(€€€€€Ù¥Í¥‰±”¡‰ÕÑÑ½¸¤€˜˜‰ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤€ôôô€‹²Ò#ªâÃ¶fPˆ(€€€€¤ì(€€€¥˜€¡É•Í•Ð¤ì(€€€€€É•Í•Ð¹±¥¬ ¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÌÔÀ¤ì(€€€ô(€€€½¹ÍÐ¥¹ÁÕÐ€ôl¸¸¹Á½ÁÕÀ¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÐˆ¥t¹™¥¹ ¡•±•µ•¹Ð¤€ôø(€€€€€Ù¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜l‰Ñ•áÐˆ°€‰Í•…É ˆ°€ˆ‰t¹¥¹±Õ‘•Ì¡•±•µ•¹Ð¹ÑåÁ”¤(€€€€¤ì(€€€™½È€¡½¹ÍÐ¹…µ”½˜¹…µ•Ì¤ì(€€€€€¥˜€¡¥¹ÁÕÐ¤ì(€€€€€€€½¹ÍÐÍ•ÑÑ•È€ô=‰©•Ð¹•Ñ=Ý¹AÉ½Á•ÉÑå•ÍÉ¥ÁÑ½È¡!Q51%¹ÁÕÑ±•µ•¹Ð¹ÁÉ½Ñ½ÑåÁ”°€‰Ù…±Õ”ˆ¤¹Í•Ðì(€€€€€€€Í•ÑÑ•È¹…±°¡¥¹ÁÕÐ°¹…µ”¤ì(€€€€€€€¥¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ‰¥¹ÁÕÐˆ°ì‰Õ‰‰±•ÌèÑÉÕ”ô¤¤ì(€€€€€€€¥¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ‰¡…¹”ˆ°ì‰Õ‰‰±•ÌèÑÉÕ”ô¤¤ì(€€€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€ô(€€€€€½¹ÍÐ•áÁ•Ñ•€ô¹…µ•Ì¹µ…À ¡Ù…±Õ”¤€ôøÙ…±Õ”¹Ñ½1½Ý•É…Í” ¤¤ì(€€€€€±•Ð½ÁÑ¥½¸ì(€€€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÈÀ€˜˜€…½ÁÑ¥½¸ì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€€€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° (€€€€€€€€€€œ¹…¹ÐµÁ½Á½Ù•Èé¹½Ð ¹…¹ÐµÁ½Á½Ù•Èµ¡¥‘‘•¸¤±¤¹…¹Ðµ±¥ÍÐµ¥Ñ•´±mÉ½±”õ½ÁÑ¥½¹t°¹…¹ÐµÍ•±•Ðµ¥Ñ•´µ½ÁÑ¥½¸°¹Í•µ¤µÍ•±•Ðµ½ÁÑ¥½¸œ(€€€€€€€€¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€€€½ÁÑ¥½¸€ô…¹‘¥‘…Ñ•Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôøì(€€€€€€€€€½¹ÍÐÑ•áÐ€ô•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤ì(€€€€€€€€€É•ÑÕÉ¸•áÁ•Ñ•¹Í½µ” ¡Ù…±Õ”¤€ôøÑ•áÐ€ôôôÙ…±Õ”ñðÑ•áÐ¹ÍÑ…ÉÑÍ]¥Ñ ¡Ù…±Õ”€¬€ˆ€ˆ¤ñðÑ•áÐ¹¥¹±Õ‘•Ì¡Ù…±Õ”¤¤ì(€€€€€€€ô¤ì(€€€€€ô(€€€€€¥˜€¡½ÁÑ¥½¸¤ì(€€€€€€€½ÁÑ¥½¸¹±¥¬ ¤ì(€€€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€€€½¹ÍÐ½¹™¥É´€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹tˆ¥t¹™¥¹ ¡‰ÕÑÑ½¸¤€ôø(€€€€€€€€€Ù¥Í¥‰±”¡‰ÕÑÑ½¸¤€˜˜€½x£¶fW²váó²‚²j¥óªÊ²$¤¼¹Ñ•ÍÐ¡‰ÕÑÑ½¸¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤(€€€€€€€€¤ì(€€€€€€€¥˜€¡½¹™¥É´¤½¹™¥É´¹±¥¬ ¤ì(€€€€€€€…Ý…¥ÐÝ…¥Ð Å|ÈÀÀ¤ì(€€€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°Í•±•Ñ•è½ÁÑ¥½¸¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤°É½ÕÑ”è€‰aQ}	I9}%1QHˆôì(€€€€€ô(€€€ô(€€€€¼¼ƒ¶2C®ž“²zC²ó¶ÃªÂ ƒ®â3®zs®Npƒ¶2w²^ƒªÖ³²†Ã®–ðƒ®ÎªÊ÷¶VpƒªÊ÷²jÀƒ²®. ƒ¶×¶V¤ƒªÊ²'²Â÷²ró®†pƒ²‚¶fc¶Vs®.¸(€€€€¼¼ƒ²¶J#²‚W®ÎÐƒªÊ²'²v ƒ®â3®zs®Ns®ª®>ƒ²ž²nC¶Vc®¦Àƒ²vÐƒªÊ÷®†sªÂ ƒ¶fS®¦ÐƒªÂs¶:ã²v`ƒ²b¶Z—²vƒ®6pƒ®Âo®*S®.¸(€€€É•ÑÕÉ¸…Ý…¥ÐÍ•…É¡É½µQ½À ¤ñðì½¬è™…±Í”°É•…Í½¸è€‰	I9}=AQ%=9}9}Q=A}MI!}9=Q}=U9ˆôì(€ô¤ ¥€°ÑÉÕ”¤ì(€¥˜€ …Í•±•Ñ•ü¹½¬¤ì(€€€ÍÑ½Á	É…¹‘9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”èƒ¶2C®ž“²zC²ó¶Àƒ®â3®zs®Npƒ¶V¶Ã®–ðƒ²‚²j§¶Vc²ž ƒ®ªï¶Z#²*×®.#®.¸€ ‘íÍ•±•Ñ•ü¹É•…Í½¸ñð€‰U9-9=]8‰ô¥€ôì(€ô(€µ…¥¹]¥¹‘½Üü¹Í¡½Ü ¤ì(€µ…¥¹]¥¹‘½Üü¹™½ÕÌ ¤ì(€Í•±±•É]¥¹‘½Ü¹¡¥‘” ¤ì(€€¼¼ƒªÊ²$ƒ®Ê¶*ðƒ¶Ó®š´ƒ²ž¶n²^C®*PƒªâÃ²†Ðƒ¶FsªÂ ƒ²zƒ².pƒ®
£²Vƒ²z#®.¸ƒ²¶J ƒ®Ê#¶bãªÂ ƒ²z#®*P(€€¼¼ƒ² ƒªÊÃªÎðƒ¶Fs²f ƒ¶×ªÎƒ²^Ó²vÐƒ².“²‚s®†pƒ®‚3®6S®ž®B€ƒ®V3ªæ3²ž ƒªâÃ®.“®šÀƒ®Jƒ²"c²žG¶Vs®.¸(€…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€àÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€½¹ÍÐ¡•…‘•ÉÌ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰Ñ…‰±”Ñ¡•…Ñ ˆ¥t(€€€€€€€€¹µ…À ¡•±°¤€ôøMÑÉ¥¹œ¡•±°¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤¤ì(€€€€€½¹ÍÐÉ½ÝÌ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰Ñ…‰±”Ñ‰½‘äÑÈˆ¥t(€€€€€€€€¹µ…À ¡É½Ü¤€ôøMÑÉ¥¹œ¡É½Ü¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¤ì(€€€€€¥˜€ (€€€€€€€É½ÝÌ¹Í½µ” ¡Ñ•áÐ¤€ôø€¿²¶J!qqÌ«®Ê#¶báqqÌ©lë¾òit¼¹Ñ•ÍÐ¡Ñ•áÐ¤¤(€€€€€€€€˜˜¡•…‘•ÉÌ¹Í½µ” ¡Ñ•áÐ¤€ôø€¿²ÖsªÞñqqÌ¨ÌÃ²vñqqÌ«¶2C®ž“®~$¼¹Ñ•ÍÐ¡Ñ•áÐ¤¤(€€€€€€¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€ô(€€€É•ÑÕÉ¸™…±Í”ì(€ô¤ ¥€°ÑÉÕ”¤ì(€…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐÕÉÉ•¹Ð€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÍ•±•ÐµÍ•±•Ñ¥½¸µ¥Ñ•´ˆ¥t¹™¥¹ ¡•±•µ•¹Ð¤€ôø(€€€€€Ù¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜€¿ªÆÑqp¿¶:c²vÓ²ž ¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¤(€€€€¤ì(€€€¥˜€ …ÕÉÉ•¹Ðñð€¼ÈÁqqÌ«ªÆÑqp¿¶:c²vÓ²ž ¼¹Ñ•ÍÐ¡ÕÉÉ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¤¤É•ÑÕÉ¸ì(€€€ÕÉÉ•¹Ð¹±½Í•ÍÐ ˆ¹…¹ÐµÍ•±•Ðˆ¤ü¹ÅÕ•ÉåM•±•Ñ½È ˆ¹…¹ÐµÍ•±•ÐµÍ•±•Ñ½Èˆ¤ü¹±¥¬ ¤ì(€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€½¹ÍÐ½ÁÑ¥½¸€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° mÉ½±”ô‰½ÁÑ¥½¸‰t°¹…¹ÐµÍ•±•Ðµ¥Ñ•´µ½ÁÑ¥½¸œ¥t(€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôøÙ¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜€¼ÈÁqqÌ«ªÆÑqp¿¶:c²vÓ²ž ¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¤¤ì(€€€½ÁÑ¥½¸ü¹±¥¬ ¤ì(€€€…Ý…¥ÐÝ…¥Ð äÀÀ¤ì(€ô¤ ¥€°ÑÉÕ”¤ì(€€¼¼Q¡”±•…äÍ•±•Ñ½È…‰½Ù”É•ÅÕ•ÍÑ•€ÈÀÉ½ÝÌ¸%µµ•‘¥…Ñ•±äÍÝ¥Ñ Ñ¡”(€€¼¼Á…¥¹…Ñ¥½¸½¹ÑÉ½°Ñ¼Ñ¡”±…É•ÍÐ½ÁÑ¥½¸•áÁ½Í•‰äM•±±•È•¹Ñ•ÈÍ¼„(€€¼¼€ä°äÀÀµÉ½Ü‰É…¹‘½•Ì¹½ÐÉ•ÅÕ¥É”É½Õ¡±ä€ÐäÔÁ…”ÑÉ…¹Í¥Ñ¥½¹Ì¸(€…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐÍ¥é•¡…¹•È€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ½ÁÑ¥½¹ÌµÍ¥é”µ¡…¹•È°¹…¹ÐµÁ…¥¹…Ñ¥½¸µ½ÁÑ¥½¹Ìˆ¥t(€€€€€€¹™¥¹¡Ù¥Í¥‰±”¤ì(€€€½¹ÍÐÍ•±•Ñ½È€ôÍ¥é•¡…¹•Èü¹ÅÕ•ÉåM•±•Ñ½È ˆ¹…¹ÐµÍ•±•ÐµÍ•±•Ñ½Èˆ¤ì(€€€¥˜€ …Í•±•Ñ½È¤É•ÑÕÉ¸™…±Í”ì(€€€Í•±•Ñ½È¹±¥¬ ¤ì(€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€½¹ÍÐ½ÁÑ¥½¹Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° mÉ½±”ô‰½ÁÑ¥½¸‰t°¹…¹ÐµÍ•±•Ðµ¥Ñ•´µ½ÁÑ¥½¸œ¥t(€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¹µ…À ¡•±•µ•¹Ð¤€ôø€¡ì•±•µ•¹Ð°Í¥é”è9Õµ‰•È¡MÑÉ¥¹œ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆ¤¹µ…Ñ  ½qq¬¼¤ü¹lÁtñð€À¤ô¤¤(€€€€€€¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä¹Í¥é”€ø€À¤(€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøÉ¥¡Ð¹Í¥é”€´±•™Ð¹Í¥é”¤ì(€€€¥˜€ …½ÁÑ¥½¹ÍlÁt¤É•ÑÕÉ¸™…±Í”ì(€€€½ÁÑ¥½¹ÍlÁt¹•±•µ•¹Ð¹±¥¬ ¤ì(€€€…Ý…¥ÐÝ…¥Ð Å|ÀÀÀ¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô¤ ¥€°ÑÉÕ”¤ì(€½¹ÍÐÁ…•Ì€ômtì(€±•ÐÍ•±±•ÉM½ÕÉ•Q½Ñ…°€ô€Àì(€±•Ð…ÁÑÕÉ•‘I½Ý½Õ¹Ð€ô€Àì(€±•ÐÁ…•QÉ…¹Í¥Ñ¥½¹…¥±ÕÉ”€ô¹Õ±°ì(€™½È€¡±•ÐÁ…”€ô€ÄìÁ…”€ðô€Å|ÀÀÀìÁ…”€¬ô€Ä¤ì(€€€½¹ÍÐ…ÁÑÕÉ”€ô…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€  ¤€ôøì(€€€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€€€½¹ÍÐ¡•…‘•ÉÌ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰Ñ…‰±”Ñ¡•…Ñ ˆ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€¹µ…À ¡•±°¤€ôøMÑÉ¥¹œ¡•±°¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¹É•Á±…” ½qqÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤¤ì(€€€€€½¹ÍÐÉ½Ý±•µ•¹ÑÌ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰Ñ…‰±”Ñ‰½‘äÑÈˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€½¹ÍÐÉ½ÝÌ€ôÉ½Ý±•µ•¹ÑÌ¹µ…À ¡É½Ü¤€ôø€¡ì(€€€€€€€Ñ•áÐèÉ½Ü¹¥¹¹•ÉQ•áÐñð€ˆˆ°(€€€€€€€•±±Ìèl¸¸¹É½Ü¹ÅÕ•ÉåM•±•Ñ½É±° ‰Ñˆ¥t¹µ…À ¡•±°¤€ôø•±°¹¥¹¹•ÉQ•áÐñð€ˆˆ¤°(€€€€€€€¡•…‘•ÉÌ°(€€€€€€€¥µ…•UÉ°èÉ½Ü¹ÅÕ•ÉåM•±•Ñ½È ‰¥µœˆ¤ü¹ÍÉŒñð€ˆˆ(€€€€€ô¤¤¹™¥±Ñ•È ¡É½Ü¤€ôø€¿²¶J!qqÌ«®Ê#¶báqqÌ©lë¾òit¼¹Ñ•ÍÐ¡É½Ü¹Ñ•áÐ¤¤ì(€€€€€½¹ÍÐ¹•áÐ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ¹•áÐˆ¥t¹™¥¹¡Ù¥Í¥‰±”¤ì(€€€€€½¹ÍÐ…Ñ¥Ù•A…”€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ¥Ñ•´µ…Ñ¥Ù”ˆ¥t(€€€€€€€€¹™¥¹¡Ù¥Í¥‰±”¤ì(€€€€€½¹ÍÐÑ½Ñ…±5…Ñ €ôMÑÉ¥¹œ¡‘½Õµ•¹Ð¹‰½‘äü¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¹µ…Ñ  ¿²ÒuqqÌ¨¡mqq±t¬¥qqÌ«ªÆÑqqÌ«ªÊÃªÎð¼¤ì(€€€€€½¹ÍÐÑ½Ñ…±½Õ¹Ð€ô9Õµ‰•È¡MÑÉ¥¹œ¡Ñ½Ñ…±5…Ñ ü¹lÅtñð€ˆÀˆ¤¹É•Á±…” ¼°½œ°€ˆˆ¤¤ì(€€€€€½¹ÍÐÕÉÉ•¹ÑA…”€ô9Õµ‰•È¡…Ñ¥Ù•A…”ü¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤ñð€‘íÁ…•ôì(€€€€€½¹ÍÐÙ¥Í¥‰±•A…•9Õµ‰•ÉÌ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ¥Ñ•´ˆ¥t(€€€€€€€€¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€€€¹µ…À ¡¥Ñ•´¤€ôø9Õµ‰•È¡¥Ñ•´¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤(€€€€€€€€¹™¥±Ñ•È¡9Õµ‰•È¹¥Í¥¹¥Ñ”¤ì(€€€€€½¹ÍÐÁ…•M¥é•Q•áÐ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÍ•±•ÐµÍ•±•Ñ¥½¸µ¥Ñ•´ˆ¥t(€€€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôøÙ¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜€¿ªÆÑqp¿¶:c²vÓ²ž ¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¤¤ü¹Ñ•áÑ½¹Ñ•¹Ðñð€ˆˆì(€€€€€½¹ÍÐÁ…•M¥é”€ô9Õµ‰•È¡Á…•M¥é•Q•áÐ¹µ…Ñ  ¼¡qq¬¥qqÌ«ªÆÑqp¿¶:c²vÓ²ž ¼¤ü¹lÅt¤ñðÉ½ÝÌ¹±•¹Ñ ñð€ÄÀì(€€€€€½¹ÍÐÁ…•½Õ¹Ð€ôÑ½Ñ…±½Õ¹Ð€ø€À(€€€€€€€€ü5…Ñ ¹•¥°¡Ñ½Ñ…±½Õ¹Ð€¼Á…•M¥é”¤(€€€€€€€€è5…Ñ ¹µ…à¡ÕÉÉ•¹ÑA…”°€¸¸¹Ù¥Í¥‰±•A…•9Õµ‰•ÉÌ°€Ä¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€É½ÝÌ°(€€€€€€€¡…Í9•áÐè	½½±•…¸¡¹•áÐ€˜˜€…¹•áÐ¹±…ÍÍ1¥ÍÐ¹½¹Ñ…¥¹Ì ‰…¹ÐµÁ…¥¹…Ñ¥½¸µ‘¥Í…‰±•ˆ¤€˜˜ÕÉÉ•¹ÑA…”€ðÁ…•½Õ¹Ð¤°(€€€€€€€™¥ÉÍÐèÉ½ÝÍlÁtü¹Ñ•áÐñð€ˆˆ°(€€€€€€€ÕÉÉ•¹ÑA…”°(€€€€€€€Á…•½Õ¹Ð°(€€€€€€€Ñ½Ñ…±½Õ¹Ð(€€€€€ôì(€€€ô¤ ¥€°ÑÉÕ”¤ì(€€€Á…•Ì¹ÁÕÍ ¡…ÁÑÕÉ”¹É½ÝÌñðmt¤ì(€€€…ÁÑÕÉ•‘I½Ý½Õ¹Ð€¬ô9Õµ‰•È¡…ÁÑÕÉ”¹É½ÝÌü¹±•¹Ñ ñð€À¤ì(€€€Í•±±•ÉM½ÕÉ•Q½Ñ…°€ô5…Ñ ¹µ…à¡Í•±±•ÉM½ÕÉ•Q½Ñ…°°9Õµ‰•È¡…ÁÑÕÉ”¹Ñ½Ñ…±½Õ¹Ðñð€À¤¤ì(€€€¥˜€ (€€€€€Á…”€ôôô€Ä(€€€€€€˜˜Í•±•Ñ•¹É½ÕÑ”€„ôô€‰aQ}	I9}%1QHˆ(€€€€€€˜˜9Õµ‰•È¡…ÁÑÕÉ”¹Ñ½Ñ…±½Õ¹Ðñð€À¤€øô€å|ÀÀÀ(€€€€¤ì(€€€€€ÍÑ½Á	É…¹‘9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€½¬è™…±Í”°(€€€€€€€µ•ÍÍ…”è€‹²ƒ¶tƒ®â3®zs®Npƒ¶V¶ÃªÂ ƒ²‚²j§®Bc²ž ƒ²V+²Vƒ¶2C®ž“²zC²ó¶Àƒ²‚²ÊÐƒªÊÃªÎóªÂ ƒ¶Fs².s®Bc²^#²*×®.#®.¸ƒ²‚²ÊÐƒ²"c²žG²v ƒ²’G®.£¶Z#²*×®.#®.¸ˆ°(€€€€€€€½‘”è€‰M11I}	I9}%1QI}9=Q}AA1%ˆ°(€€€€€ôì(€€€ô(€€€½¹ÍÐÁÉ½‘ÕÑÌ€ôµ•É•M•±±•É	É…¹‘A…•Ì¡Á…•Ì¤ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰•áÁ±½É•Èé‰É…¹µÁÉ½É•ÍÌˆ°ì(€€€€€Á•É•¹Ðè…ÁÑÕÉ”¹¡…Í9•áÐ(€€€€€€€€ü5…Ñ ¹µ¥¸ ää°€ÜÀ€¬5…Ñ ¹É½Õ¹ ¡…ÁÑÕÉ”¹ÕÉÉ•¹ÑA…”€¼5…Ñ ¹µ…à¡…ÁÑÕÉ”¹ÕÉÉ•¹ÑA…”°…ÁÑÕÉ”¹Á…•½Õ¹Ðñð…ÁÑÕÉ”¹ÕÉÉ•¹ÑA…”¤¤€¨€Èä¤¤(€€€€€€€€è€ää°(€€€€€½Õ¹ÐèÁÉ½‘ÕÑÌ¹±•¹Ñ °(€€€€€Á…•9Õ´è…ÁÑÕÉ”¹ÕÉÉ•¹ÑA…”°(€€€€€Á…•½Õ¹Ðè…ÁÑÕÉ”¹Á…•½Õ¹Ð°(€€€€€µ•ÍÍ…”èƒ¶2C®ž“²zC²ó¶Àƒ¶b²ž €ÌÃ²vðƒ¶2C®ž“®~$ƒ²"c²žD€‘í…ÁÑÕÉ”¹ÕÉÉ•¹ÑA…•ô¼‘í…ÁÑÕÉ”¹Á…•½Õ¹Ñ÷¶:c²vÓ²ž€°(€€€ô¤ì(€€€¥˜€ ……ÁÑÕÉ”¹¡…Í9•áÐ¤‰É•…¬ì(€€€½¹ÍÐ•áÁ•Ñ•‘9•áÑA…”€ô…ÁÑÕÉ”¹ÕÉÉ•¹ÑA…”€¬€Äì(€€€±•Ð…‘Ù…¹•€ô™…±Í”ì(€€€™½È€¡±•Ð±¥­ÑÑ•µÁÐ€ô€Àì±¥­ÑÑ•µÁÐ€ð€Ì€˜˜€……‘Ù…¹•ì±¥­ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€½¹ÍÐ±¥­•€ô…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€  ¤€ôøì(€€€€€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€€€€€½¹ÍÐ•áÁ•Ñ•€ô€‘í•áÁ•Ñ•‘9•áÑA…•ôì(€€€€€€€½¹ÍÐ‘¥É•ÑA…”€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ¥Ñ•´ˆ¥t(€€€€€€€€€€¹™¥¹ ¡¥Ñ•´¤€ôøÙ¥Í¥‰±”¡¥Ñ•´¤€˜˜9Õµ‰•È¡¥Ñ•´¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤€ôôô•áÁ•Ñ•¤ì(€€€€€€€½¹ÍÐ¹•áÐ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ¹•áÐé¹½Ð ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ‘¥Í…‰±•¤ˆ¥t(€€€€€€€€€€¹™¥¹¡Ù¥Í¥‰±”¤ì(€€€€€€€½¹ÍÐÑ…É•Ð€ô‘¥É•ÑA…”ñð¹•áÐì(€€€€€€€½¹ÍÐ‰ÕÑÑ½¸€ôÑ…É•Ðü¹ÅÕ•ÉåM•±•Ñ½È ‰‰ÕÑÑ½¸±„ˆ¤ñðÑ…É•Ðì(€€€€€€€¥˜€ …‰ÕÑÑ½¸¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€‰ÕÑÑ½¸¹±¥¬ ¤ì(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€€€ô¤ ¥€°ÑÉÕ”¤ì(€€€€€¥˜€ …±¥­•¤½¹Ñ¥¹Õ”ì(€€€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÌÈì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€€€½¹ÍÐ…Ñ¥Ù•A…”€ô…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ (€€€€€€€€€€  ¤€ôøì(€€€€€€€€€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€€€€€€€€€½¹ÍÐ…Ñ¥Ù”€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ¥Ñ•´µ…Ñ¥Ù”ˆ¥t¹™¥¹¡Ù¥Í¥‰±”¤ì(€€€€€€€€€€€É•ÑÕÉ¸9Õµ‰•È¡…Ñ¥Ù”ü¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤ñð€Àì(€€€€€€€€€ô¤ ¥€°(€€€€€€€€€ÑÉÕ”°(€€€€€€€€¤ì(€€€€€€€¥˜€¡…Ñ¥Ù•A…”€ôôô•áÁ•Ñ•‘9•áÑA…”¤ì(€€€€€€€€€€¼¼]…¥Ð™½ÈÑ¡”Ñ…‰±”‰½‘äÑ¼™¥¹¥Í É•Á±…¥¹œÑ¡”ÁÉ•Ù¥½ÕÌÁ…”¸(€€€€€€€€€…Ý…¥ÐÝ…¥Ð ÐÔÀ¤ì(€€€€€€€€€…‘Ù…¹•€ôÑÉÕ”ì(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€ô(€€€ô(€€€¥˜€ ……‘Ù…¹•¤ì(€€€€€€¼¼=¹”™¥¹…°‘¥É•ÐµÁ…”…ÑÑ•µÁÐ¡…¹‘±•ÌÁ…¥¹…Ñ¥½¸½¹ÑÉ½±ÌÑ¡…Ð½¹±ä(€€€€€€¼¼•áÁ½Í”Ñ¡”É•ÅÕ•ÍÑ•Á…”…™Ñ•ÈÑ¡”¹•áÐµ…ÉÉ½ÜÕÁ‘…Ñ•ÌÑ¡”É…¹”¸(€€€€€…‘Ù…¹•€ô…Ý…¥ÐÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡€¡…Íå¹Œ€ ¤€ôøì(€€€€€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€€€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€€€€€½¹ÍÐ•áÁ•Ñ•€ô€‘í•áÁ•Ñ•‘9•áÑA…•ôì(€€€€€€€½¹ÍÐ¥Ñ•´€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ¥Ñ•´ˆ¥t(€€€€€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôøÙ¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜9Õµ‰•È¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤€ôôô•áÁ•Ñ•¤ì(€€€€€€€½¹ÍÐ‰ÕÑÑ½¸€ô¥Ñ•´ü¹ÅÕ•ÉåM•±•Ñ½È ‰‰ÕÑÑ½¸±„ˆ¤ñð¥Ñ•´ì(€€€€€€€¥˜€ …‰ÕÑÑ½¸¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€‰ÕÑÑ½¸¹±¥¬ ¤ì(€€€€€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÈÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€€€€€½¹ÍÐ…Ñ¥Ù”€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹ÐµÁ…¥¹…Ñ¥½¸µ¥Ñ•´µ…Ñ¥Ù”ˆ¥t¹™¥¹¡Ù¥Í¥‰±”¤ì(€€€€€€€€€¥˜€¡9Õµ‰•È¡…Ñ¥Ù”ü¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤€ôôô•áÁ•Ñ•¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€€€ô(€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€ô¤ ¥€°ÑÉÕ”¤ì(€€€ô(€€€¥˜€ ……‘Ù…¹•¤ì(€€€€€Á…•QÉ…¹Í¥Ñ¥½¹…¥±ÕÉ”€ôìÁ…”è…ÁÑÕÉ”¹ÕÉÉ•¹ÑA…”°•áÁ•Ñ•‘9•áÑA…”ôì(€€€€€‰É•…¬ì(€€€ô(€ô(€½¹ÍÐ•áÁ•Ñ•‘	É…¹‘Ì€ô¹•ÜM•Ð (€€€mÍ•±•Ñ•¹Í•±•Ñ•°¥¹ÁÕÐ¹‰É…¹‘-¼°¥¹ÁÕÐ¹‰É…¹‘9…µ•t(€€€€€€¹µ…À ¡Ù…±Õ”¤€ôøMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤¤(€€€€€€¹™¥±Ñ•È¡	½½±•…¸¤°(€€¤ì(€½¹ÍÐ‘½µAÉ½‘ÕÑÌ€ôµ•É•M•±±•É	É…¹‘A…•Ì¡Á…•Ì¤ì(€½¹ÍÐ…±±AÉ½‘ÕÑÌ€ôµ•É•M•±±•É	É…¹‘AÉ½‘ÕÑÌ¡‘½µAÉ½‘ÕÑÌ°¹•ÑÝ½É­M•±±•ÉAÉ½‘ÕÑÌ¤ì(€½¹ÍÐµ…Ñ¡•‘AÉ½‘ÕÑÌ€ô…±±AÉ½‘ÕÑÌ¹™¥±Ñ•È ¡ÁÉ½‘ÕÐ¤€ôøì(€€€½¹ÍÐÉ½Ý	É…¹€ôMÑÉ¥¹œ¡ÁÉ½‘ÕÐ¹‰É…¹‘9…µ”ñð€ˆˆ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤ì(€€€¥˜€ …É½Ý	É…¹¤É•ÑÕÉ¸ÑÉÕ”ì(€€€É•ÑÕÉ¸l¸¸¹•áÁ•Ñ•‘	É…¹‘Ít¹Í½µ” ¡•áÁ•Ñ•¤€ôø(€€€€€É½Ý	É…¹€ôôô•áÁ•Ñ•ñðÉ½Ý	É…¹¹¥¹±Õ‘•Ì¡•áÁ•Ñ•¤ñð•áÁ•Ñ•¹¥¹±Õ‘•Ì¡É½Ý	É…¹¤(€€€€¤ì(€ô¤ì(€€¼¼ƒ¶2C®ž“²zC²ó¶Ã²v`ƒ®â3®zs®Npƒ¶FsªâÃªÂ ƒ²b®²à¿¶Vsªâ ¿®ÊW²vã®ª²ró®†pƒ®.³®vðƒ²vó²æc¶Vc²ž ƒ²V+®6S®vó®>(€€¼¼ƒ²vÓ®¾àƒ®â3®zs®NpƒªÊ²'²ró®†pƒ²Zï²v ƒ²nC®Îàƒ¶Z'²v ƒ²
·²‚s¶Vc²ž ƒ²V+®*S®.¸(€½¹ÍÐÁÉ½‘ÕÑÌ€ôµ…Ñ¡•‘AÉ½‘ÕÑÌ¹±•¹Ñ €üµ…Ñ¡•‘AÉ½‘ÕÑÌ€è…±±AÉ½‘ÕÑÌì(€½¹ÍÐ‘¥…¹½ÍÑ¥Ì€ôÍ•±±•É	É…¹‘¥…¹½ÍÑ¥Ì¡Á…•Ì¤ì(€ÍÑ½Á	É…¹‘9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€É•ÑÕÉ¸ì(€€€½¬èÑÉÕ”°(€€€ÁÉ½‘ÕÑÌ°(€€€Ñ½Ñ…°èÁÉ½‘ÕÑÌ¹±•¹Ñ °(€€€Í½ÕÉ•Q½Ñ…°èÍ•±±•ÉM½ÕÉ•Q½Ñ…°ñðÁÉ½‘ÕÑÌ¹±•¹Ñ °(€€€…ÁÑÕÉ•‘I½Ý½Õ¹Ð°(€€€µ¥ÍÍ¥¹½Õ¹Ðè5…Ñ ¹µ…à À°€¡Í•±±•ÉM½ÕÉ•Q½Ñ…°ñðÁÉ½‘ÕÑÌ¹±•¹Ñ ¤€´ÁÉ½‘ÕÑÌ¹±•¹Ñ ¤°(€€€Í•±•Ñ•‘	É…¹èÍ•±•Ñ•¹Í•±•Ñ•°(€€€‘¥…¹½ÍÑ¥Ìèì(€€€€€€¸¸¹‘¥…¹½ÍÑ¥Ì°(€€€€€‘½µAÉ½‘ÕÑ½Õ¹Ðè‘½µAÉ½‘ÕÑÌ¹±•¹Ñ °(€€€€€¹•ÑÝ½É­AÉ½‘ÕÑ½Õ¹Ðèµ•É•M•±±•É	É…¹‘AÉ½‘ÕÑÌ¡¹•ÑÝ½É­M•±±•ÉAÉ½‘ÕÑÌ¤¹±•¹Ñ °(€€€€€µ•É•‘AÉ½‘ÕÑ½Õ¹Ðè…±±AÉ½‘ÕÑÌ¹±•¹Ñ °(€€€ô°(€€€Á…•QÉ…¹Í¥Ñ¥½¹…¥±ÕÉ”°(€ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±½½­ÕÁM•±±•ÉQÉ…¹Í…Ñ¥½¹AÉ¥”¡¥¹ÁÕÐ€ôíô¤ì(€½¹ÍÐ…ÉÑ¥±•9Õµ‰•È€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹…ÉÑ¥±•9Õµ‰•Èñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€¥˜€ ……ÉÑ¥±•9Õµ‰•È¤É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰IQ%1}IEU%Iˆ°µ•ÍÍ…”è€‹²¶J#®Ê#¶bãªÂ ƒ²^²*×®.#®.¸ˆôì(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤½Á•¹M•±±•É•¹Ñ•É]¥¹‘½Ü¡M11I}9QI}UI0¤ì(€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÌÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€¥˜€¡Í•±±•É]¥¹‘½Ü€˜˜€…Í•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤€˜˜Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹•ÑUI0 ¤¤‰É•…¬ì(€€€…Ý…¥ÐÝ…¥Ð ÌÀÀ¤ì(€ô(€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰M11I}]%9=]}U9Y%1	1ˆ°µ•ÍÍ…”è€‹¶2C®ž“²zC²ó¶Àƒ²Â÷²vƒ²^Ó²ž ƒ®ªï¶Z#²*×®.#®.¸ˆôì(€ô(€¥˜€ ……Ý…¥Ð•¹Ñ•ÉM•±±•ÉAÉ½‘ÕÑM•…É¡Y¥…5•¹Ô ¤¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰M11I}1=%9}IEU%Iˆ°µ•ÍÍ…”è€‹¶2C®ž“²zC²ó¶Àƒ®†sªÞã²vã²vƒ¶fW²vã¶VÐƒ²Žó²ã²jP¸ˆôì(€ô(€Í•±±•É]¥¹‘½Ü¹Í¡½Ý%¹…Ñ¥Ù” ¤ì(€±•ÐÁÉ½‘ÕÑÉ…µ”€ô¹Õ±°ì(€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÐÀ€˜˜€…ÁÉ½‘ÕÑÉ…µ”ì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€½¹ÍÐ™É…µ•Ì€ôÍ•±±•É]¥¹‘½ÝÉ…µ•Ì ¤ì(€€€½¹ÍÐÁÉ½‰•Ì€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡™É…µ•Ì¹µ…À¡…Íå¹Œ€¡™É…µ”¤€ôø€¡ì(€€€€€™É…µ”°(€€€€€µ…Ñ¡•è…Ý…¥Ð•á•ÕÑ•M•±±•ÉÉ…µ•]¥Ñ¡Q¥µ•½ÕÐ¡™É…µ”°€  ¤€ôøì(€€€€€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€€€€€½¹ÍÐ¥¹ÁÕÑÌ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÐˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€€€½¹ÍÐ‰ÕÑÑ½¹Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹tˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€€€€€É•ÑÕÉ¸¥¹ÁÕÑÌ¹Í½µ” ¡•±•µ•¹Ð¤€ôø€¿²¶J#®ªó²¶J#®Ê#¶báó®â3®zs®Nqó²æÓ¶3ªÎƒ®š±ó².s®š³²š ¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Á±…•¡½±‘•Èñð€ˆˆ¤¤(€€€€€€€€€€˜˜‰ÕÑÑ½¹Ì¹Í½µ” ¡•±•µ•¹Ð¤€ôø€¿ªÊ²%qqÌ«®Â=qqÌ«²z²ÂÁñ{ªÊ²$¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤ì(€€€€€ô¤ ¥€°€É|ÀÀÀ°™…±Í”¤°(€€€ô¤¤¤ì(€€€ÁÉ½‘ÕÑÉ…µ”€ôÁÉ½‰•Ì¹™¥¹ ¡…¹‘¥‘…Ñ”¤€ôø…¹‘¥‘…Ñ”¹µ…Ñ¡•¤ü¹™É…µ”ñð¹Õ±°ì(€€€¥˜€ …ÁÉ½‘ÕÑÉ…µ”¤…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€ô(€¥˜€ …ÁÉ½‘ÕÑÉ…µ”¤ì(€€€Í¡½Ý½±±•Ñ½É]¥¹‘½Ü ¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰MI!}=9QI=1}9=Q}=U9ˆ°µ•ÍÍ…”è€‘í…ÉÑ¥±•9Õµ‰•Éôƒ²¶J#ªÊ²$ƒ®
Ó®Ú ƒ¶fS®¦Ó²vƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¹€ôì(€ô(€Í•±±•ÉAÉ½‘ÕÑÉ…µ•I½ÕÑ¥¹%€ôÁÉ½‘ÕÑÉ…µ”¹É½ÕÑ¥¹%ì(€…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐ‰…¬€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±„±mÉ½±”õ‰ÕÑÑ½¹t±ÍÁ…¸ˆ¥t¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø(€€€€€Ù¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹±•™Ð€ø¥¹¹•É]¥‘Ñ €¨€À¸ÔÔ(€€€€¤¹™¥¹ ¡•±•µ•¹Ð¤€ôø€¿®J“®†sªÂªâÀ¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤ì(€€€½¹ÍÐ±½Í”€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹tˆ¥t¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø(€€€€€Ù¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹±•™Ð€ø¥¹¹•É]¥‘Ñ €¨€À¸ÔÔ(€€€€¤(€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôø€¿®.¯ªâÁñ±½Í”½¤¹Ñ•ÍÐ ¡•±•µ•¹Ð¹•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ±…‰•°ˆ¤ñð€ˆˆ¤€¬€ˆ€ˆ€¬€¡•±•µ•¹Ð¹Ñ¥Ñ±”ñð€ˆˆ¤¤¤ì(€€€½¹ÍÐÑ…É•Ð€ô‰…¬ü¹±½Í•ÍÐ ‰‰ÕÑÑ½¸±„±mÉ½±”õ‰ÕÑÑ½¹tˆ¤ñð‰…¬ñð±½Í”ì(€€€¥˜€ …Ñ…É•Ð¤É•ÑÕÉ¸™…±Í”ì(€€€Ñ…É•Ð¹±¥¬ ¤ì(€€€…Ý…¥ÐÝ…¥Ð ÔÀÀ¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø™…±Í”¤ì(€½¹ÍÐÑÉ…¹Í…Ñ¥½¹9•ÑÝ½É­I•ÍÁ½¹Í•Ì€ômtì(€½¹ÍÐÁ•¹‘¥¹QÉ…¹Í…Ñ¥½¹I•ÅÕ•ÍÑÌ€ô¹•ÜM•Ð ¤ì(€½¹ÍÐÑÉ…¹Í…Ñ¥½¹	½‘åQ…Í­Ì€ô¹•ÜM•Ð ¤ì(€±•ÐÑÉ…¹Í…Ñ¥½¹…ÁÑÕÉ•Ñ¥Ù”€ôÑÉÕ”ì(€±•ÐÑÉ…¹Í…Ñ¥½¹•‰Õ•É1¥ÍÑ•¹•Èì(€±•ÐÑÉ…¹Í…Ñ¥½¹•‰Õ•ÉÑÑ…¡•‘!•É”€ô™…±Í”ì(€½¹ÍÐÍÑ½ÁQÉ…¹Í…Ñ¥½¹9•ÑÝ½É­…ÁÑÕÉ”€ô…Íå¹Œ€ ¤€ôøì(€€€ÑÉ…¹Í…Ñ¥½¹…ÁÑÕÉ•Ñ¥Ù”€ô™…±Í”ì(€€€…Ý…¥ÐAÉ½µ¥Í”¹…±±M•ÑÑ±•¡l¸¸¹ÑÉ…¹Í…Ñ¥½¹	½‘åQ…Í­Ít¤ì(€€€ÑÉäì(€€€€€¥˜€¡ÑÉ…¹Í…Ñ¥½¹•‰Õ•É1¥ÍÑ•¹•È¤Í•±±•É]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹É•µ½Ù•1¥ÍÑ•¹•È ‰µ•ÍÍ…”ˆ°ÑÉ…¹Í…Ñ¥½¹•‰Õ•É1¥ÍÑ•¹•È¤ì(€€€€€¥˜€¡ÑÉ…¹Í…Ñ¥½¹•‰Õ•ÉÑÑ…¡•‘!•É”€˜˜Í•±±•É]¥¹‘½Ü€˜˜€…Í•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤€˜˜Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹¥ÍÑÑ…¡• ¤¤ì(€€€€€€€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•È¹‘•Ñ…  ¤ì(€€€€€ô(€€€ô…Ñ íô(€ôì(€ÑÉäì(€€€½¹ÍÐÍ•±±•É•‰Õ•È€ôÍ•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹‘•‰Õ•Èì(€€€¥˜€ …Í•±±•É•‰Õ•È¹¥ÍÑÑ…¡• ¤¤ì(€€€€€Í•±±•É•‰Õ•È¹…ÑÑ…  ˆÄ¸Ìˆ¤ì(€€€€€ÑÉ…¹Í…Ñ¥½¹•‰Õ•ÉÑÑ…¡•‘!•É”€ôÑÉÕ”ì(€€€ô(€€€…Ý…¥ÐÍ•±±•É•‰Õ•È¹Í•¹‘½µµ…¹ ‰9•ÑÝ½É¬¹•¹…‰±”ˆ¤ì(€€€ÑÉ…¹Í…Ñ¥½¹•‰Õ•É1¥ÍÑ•¹•È€ô€¡}•Ù•¹Ð°µ•Ñ¡½°Á…É…µÌ¤€ôøì(€€€€€¥˜€¡µ•Ñ¡½€ôôô€‰9•ÑÝ½É¬¹É•ÍÁ½¹Í•I••¥Ù•ˆ€˜˜ÑÉ…¹Í…Ñ¥½¹…ÁÑÕÉ•Ñ¥Ù”€˜˜l‰a!Hˆ°€‰•Ñ ‰t¹¥¹±Õ‘•Ì¡Á…É…µÌü¹ÑåÁ”¤¤ì(€€€€€€€Á•¹‘¥¹QÉ…¹Í…Ñ¥½¹I•ÅÕ•ÍÑÌ¹…‘¡Á…É…µÌ¹É•ÅÕ•ÍÑ%¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€¥˜€¡µ•Ñ¡½€„ôô€‰9•ÑÝ½É¬¹±½…‘¥¹¥¹¥Í¡•ˆñð€…Á•¹‘¥¹QÉ…¹Í…Ñ¥½¹I•ÅÕ•ÍÑÌ¹¡…Ì¡Á…É…µÌü¹É•ÅÕ•ÍÑ%¤¤É•ÑÕÉ¸ì(€€€€€Á•¹‘¥¹QÉ…¹Í…Ñ¥½¹I•ÅÕ•ÍÑÌ¹‘•±•Ñ”¡Á…É…µÌ¹É•ÅÕ•ÍÑ%¤ì(€€€€€½¹ÍÐÑ…Í¬€ôÍ•±±•É•‰Õ•È¹Í•¹‘½µµ…¹ ‰9•ÑÝ½É¬¹•ÑI•ÍÁ½¹Í•	½‘äˆ°ìÉ•ÅÕ•ÍÑ%èÁ…É…µÌ¹É•ÅÕ•ÍÑ%ô¤(€€€€€€€€¹Ñ¡•¸ ¡Á…å±½…¤€ôøì(€€€€€€€€€½¹ÍÐ‰½‘ä€ôÁ…å±½…ü¹‰…Í”ØÑ¹½‘•(€€€€€€€€€€€€ü	Õ™™•È¹™É½´¡Á…å±½…¹‰½‘äñð€ˆˆ°€‰‰…Í”ØÐˆ¤¹Ñ½MÑÉ¥¹œ ‰ÕÑ˜àˆ¤(€€€€€€€€€€€€èMÑÉ¥¹œ¡Á…å±½…ü¹‰½‘äñð€ˆˆ¤ì(€€€€€€€€€¥˜€ ½yqÌ©mqmít¼¹Ñ•ÍÐ¡‰½‘ä¤€˜˜‰½‘ä¹±•¹Ñ €ðô€Õ|ÀÀÁ|ÀÀÀ¤ÑÉ…¹Í…Ñ¥½¹9•ÑÝ½É­I•ÍÁ½¹Í•Ì¹ÁÕÍ ¡ì‰½‘äô¤ì(€€€€€€€ô¤¹…Ñ   ¤€ôøíô¤ì(€€€€€ÑÉ…¹Í…Ñ¥½¹	½‘åQ…Í­Ì¹…‘¡Ñ…Í¬¤ì(€€€€€Ñ…Í¬¹™¥¹…±±ä  ¤€ôøÑÉ…¹Í…Ñ¥½¹	½‘åQ…Í­Ì¹‘•±•Ñ”¡Ñ…Í¬¤¤ì(€€€ôì(€€€Í•±±•É•‰Õ•È¹½¸ ‰µ•ÍÍ…”ˆ°ÑÉ…¹Í…Ñ¥½¹•‰Õ•É1¥ÍÑ•¹•È¤ì(€ô…Ñ íô(€…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€  ¤€ôøì(€€€½¹ÍÐÍÑ½É…•-•ä€ô€‰}}…É½Õ¹‘=ÁÑ¥½¹I•ÍÁ½¹Í•Ìˆì(€€€Ý¥¹‘½ÝmÍÑ½É…•-•åt€ômtì(€€€½¹ÍÐÉ•½É€ô€¡ÕÉ°°‰½‘ä¤€ôøì(€€€€€½¹ÍÐÑ•áÐ€ôMÑÉ¥¹œ¡‰½‘äñð€ˆˆ¤ì(€€€€€¥˜€ …Ñ•áÐñðÑ•áÐ¹±•¹Ñ €ø€Í|ÀÀÁ|ÀÀÀ¤É•ÑÕÉ¸ì(€€€€€¥˜€ „½ÁÉ¥•ñÍ…±•ÍñÍ½±‘ñÙ½±Õµ•ñÍ¥é•ñÍ­Õñ½ÁÑ¥½¹ó’îßš‚ñó–R»’îÝó¦R¦=ó–Âëž‚ó¶2C®ž“®~%óªÂªÊ¤½¤¹Ñ•ÍÐ¡Ñ•áÐ¤¤É•ÑÕÉ¸ì(€€€€€Ý¥¹‘½ÝmÍÑ½É…•-•åt¹ÁÕÍ ¡ìÕÉ°èMÑÉ¥¹œ¡ÕÉ°ñð€ˆˆ¤°‰½‘äèÑ•áÐ°Ñ¥µ”è…Ñ”¹¹½Ü ¤ô¤ì(€€€€€¥˜€¡Ý¥¹‘½ÝmÍÑ½É…•-•åt¹±•¹Ñ €ø€àÀ¤Ý¥¹‘½ÝmÍÑ½É…•-•åt¹ÍÁ±¥” À°Ý¥¹‘½ÝmÍÑ½É…•-•åt¹±•¹Ñ €´€àÀ¤ì(€€€ôì(€€€¥˜€ …Ý¥¹‘½Ü¹}}…É½Õ¹‘•Ñ¡!½½­•€˜˜ÑåÁ•½˜Ý¥¹‘½Ü¹™•Ñ €ôôô€‰™Õ¹Ñ¥½¸ˆ¤ì(€€€€€Ý¥¹‘½Ü¹}}…É½Õ¹‘•Ñ¡!½½­•€ôÑÉÕ”ì(€€€€€½¹ÍÐ½É¥¥¹…±•Ñ €ôÝ¥¹‘½Ü¹™•Ñ ¹‰¥¹¡Ý¥¹‘½Ü¤ì(€€€€€Ý¥¹‘½Ü¹™•Ñ €ô…Íå¹Œ€ ¸¸¹…ÉÌ¤€ôøì(€€€€€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð½É¥¥¹…±•Ñ  ¸¸¹…ÉÌ¤ì(€€€€€€€É•ÍÁ½¹Í”¹±½¹” ¤¹Ñ•áÐ ¤¹Ñ¡•¸ ¡‰½‘ä¤€ôøÉ•½É¡É•ÍÁ½¹Í”¹ÕÉ°ñð…ÉÍlÁt°‰½‘ä¤¤¹…Ñ   ¤€ôøíô¤ì(€€€€€€€É•ÑÕÉ¸É•ÍÁ½¹Í”ì(€€€€€ôì(€€€ô(€€€¥˜€ …Ý¥¹‘½Ü¹}}…É½Õ¹‘a¡É!½½­•€˜˜Ý¥¹‘½Ü¹a51!ÑÑÁI•ÅÕ•ÍÐ¤ì(€€€€€Ý¥¹‘½Ü¹}}…É½Õ¹‘a¡É!½½­•€ôÑÉÕ”ì(€€€€€½¹ÍÐ½É¥¥¹…±=Á•¸€ôa51!ÑÑÁI•ÅÕ•ÍÐ¹ÁÉ½Ñ½ÑåÁ”¹½Á•¸ì(€€€€€½¹ÍÐ½É¥¥¹…±M•¹€ôa51!ÑÑÁI•ÅÕ•ÍÐ¹ÁÉ½Ñ½ÑåÁ”¹Í•¹ì(€€€€€a51!ÑÑÁI•ÅÕ•ÍÐ¹ÁÉ½Ñ½ÑåÁ”¹½Á•¸€ô™Õ¹Ñ¥½¸¡µ•Ñ¡½°ÕÉ°°€¸¸¹É•ÍÐ¤ì(€€€€€€€Ñ¡¥Ì¹}}…É½Õ¹‘UÉ°€ôÕÉ°ì(€€€€€€€É•ÑÕÉ¸½É¥¥¹…±=Á•¸¹…±°¡Ñ¡¥Ì°µ•Ñ¡½°ÕÉ°°€¸¸¹É•ÍÐ¤ì(€€€€€ôì(€€€€€a51!ÑÑÁI•ÅÕ•ÍÐ¹ÁÉ½Ñ½ÑåÁ”¹Í•¹€ô™Õ¹Ñ¥½¸ ¸¸¹…ÉÌ¤ì(€€€€€€€Ñ¡¥Ì¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±½…ˆ°€ ¤€ôøì(€€€€€€€€€ÑÉäì¥˜€ …Ñ¡¥Ì¹É•ÍÁ½¹Í•QåÁ”ñðÑ¡¥Ì¹É•ÍÁ½¹Í•QåÁ”€ôôô€‰Ñ•áÐˆ¤É•½É¡Ñ¡¥Ì¹É•ÍÁ½¹Í•UI0ñðÑ¡¥Ì¹}}…É½Õ¹‘UÉ°°Ñ¡¥Ì¹É•ÍÁ½¹Í•Q•áÐ¤ìô…Ñ íô(€€€€€€€ô°ì½¹”èÑÉÕ”ô¤ì(€€€€€€€É•ÑÕÉ¸½É¥¥¹…±M•¹¹…ÁÁ±ä¡Ñ¡¥Ì°…ÉÌ¤ì(€€€€€ôì(€€€ô(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø™…±Í”¤ì(€½¹ÍÐÍ•…É¡•€ô…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐ…ÉÑ¥±”€ô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡…ÉÑ¥±•9Õµ‰•È¥ôì(€€€½¹ÍÐ¹½Éµ…±¥é”€ô€¡Ù…±Õ”¤€ôøMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹Ñ½UÁÁ•É…Í” ¤¹É•Á±…” ½myµhÀ´åt½œ°€ˆˆ¤ì(€€€½¹ÍÐ¥¹ÁÕÑÌ€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÐˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€½¹ÍÐ¥¹ÁÕÐ€ô¥¹ÁÕÑÌ¹™¥¹ ¡•±•µ•¹Ð¤€ôø€¿²¶J#®ªó²¶J#®Ê#¶báó®â3®zs®Nqó²æÓ¶3ªÎƒ®š±ó².s®š³²š ¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Á±…•¡½±‘•Èñð€ˆˆ¤¤(€€€€€ñð¥¹ÁÕÑÌ¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €´„¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ ¥lÁtì(€€€½¹ÍÐ‰ÕÑÑ½¸€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹tˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¹™¥¹ ¡•±•µ•¹Ð¤€ôø€¿ªÊ²%qÌ«®Â=qÌ«²z²ÂÁñ{ªÊ²$¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤ì(€€€¥˜€ …¥¹ÁÕÐñð€…‰ÕÑÑ½¸¤É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰MI!}=9QI=1}9=Q}=U9ˆôì(€€€½¹ÍÐÍ•ÑÑ•È€ô=‰©•Ð¹•Ñ=Ý¹AÉ½Á•ÉÑå•ÍÉ¥ÁÑ½È¡!Q51%¹ÁÕÑ±•µ•¹Ð¹ÁÉ½Ñ½ÑåÁ”°€‰Ù…±Õ”ˆ¤¹Í•Ðì(€€€Í•ÑÑ•È¹…±°¡¥¹ÁÕÐ°…ÉÑ¥±”¤ì(€€€¥¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ‰¥¹ÁÕÐˆ°ì‰Õ‰‰±•ÌèÑÉÕ”ô¤¤ì(€€€¥¹ÁÕÐ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð ‰¡…¹”ˆ°ì‰Õ‰‰±•ÌèÑÉÕ”ô¤¤ì(€€€‰ÕÑÑ½¸¹±¥¬ ¤ì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÄÈÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€€€€¼¼A=%i=8É•¹‘•ÉÌÍ•…É É•ÍÕ±ÑÌ…ÌÙ¥ÉÑÕ…°‘¥ØÉ½ÝÌ°¹½Ð½¹±äÑ…‰±”É½ÝÌ¸(€€€€€€¼¼1½…Ñ”Ñ¡”Íµ…±±•ÍÐÙ¥Í¥‰±”É•ÍÕ±Ð½¹Ñ…¥¹•ÈÑ¡…Ð½¹Ñ…¥¹Ì‰½Ñ Ñ¡”(€€€€€€¼¼•á…Ð…ÉÑ¥±”¹Õµ‰•È…¹Ñ¡”É½ÜÌ€‹²¶J ƒ®6Ã²vÓ¶Àˆ…Ñ¥½¸¸(€€€€€½¹ÍÐ¹½Éµ…±¥é•‘ÉÑ¥±”€ô¹½Éµ…±¥é”¡…ÉÑ¥±”¤ì(€€€€€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰ÑÈ±mÉ½±”õÉ½Ýt±±¤±‘¥Ø±Í•Ñ¥½¸±…ÉÑ¥±”ˆ¥t(€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøì(€€€€€€€€€¥˜€ …Ù¥Í¥‰±”¡•±•µ•¹Ð¤¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€€€½¹ÍÐÙ…±Õ”€ô¹½Éµ…±¥é”¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐ¤ì(€€€€€€€€€¥˜€ …Ù…±Õ”¹¥¹±Õ‘•Ì¡¹½Éµ…±¥é•‘ÉÑ¥±”¤¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€€€É•ÑÕÉ¸l¸¸¹•±•µ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰„±‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹t±ÍÁ…¸±‘¥Øˆ¥t(€€€€€€€€€€€€¹Í½µ” ¡¥Ñ•´¤€ôøÙ¥Í¥‰±”¡¥Ñ•´¤€˜˜€¿²¶J!qÌ«®6Ã²vÓ¶À¼¹Ñ•ÍÐ¡¥Ñ•´¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤ì(€€€€€€€ô¤(€€€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøì(€€€€€€€€€½¹ÍÐ±•™ÑI•Ð€ô±•™Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€½¹ÍÐÉ¥¡ÑI•Ð€ôÉ¥¡Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€É•ÑÕÉ¸±•™ÑI•Ð¹Ý¥‘Ñ €¨±•™ÑI•Ð¹¡•¥¡Ð€´É¥¡ÑI•Ð¹Ý¥‘Ñ €¨É¥¡ÑI•Ð¹¡•¥¡Ðì(€€€€€€€ô¤ì(€€€€€±•ÐÉ½Ü€ô…¹‘¥‘…Ñ•ÍlÁtì(€€€€€€¼¼9•ÑÝ½É¬Í•…É …¸™¥¹¥Í ‰•™½É”Ñ¡”Ù¥ÉÑÕ…°±¥ÍÐ•áÁ½Í•Ì„ÍÑ…‰±”(€€€€€€¼¼É½ÜÝÉ…ÁÁ•È¸]¥Ñ …¸•á…Ð…ÉÑ¥±”ÅÕ•Éä°„Í¥¹±”Ù¥Í¥‰±”(€€€€€€¼¼€‹²¶J ƒ®6Ã²vÓ¶Àˆ…Ñ¥½¸¥ÌÑ¡”Í•…É¡•ÁÉ½‘ÕÐ…¹…¸Í…™•±ä‰”ÕÍ•(€€€€€€¼¼½¹±ä…Ì„ÑÉ¥•È™½ÈÑ¡”¥¹Ñ•É¹…°‘•Ñ…¥°É•ÍÁ½¹Í”¸(€€€€€¥˜€ …É½Ü€˜˜…ÑÑ•µÁÐ€øô€ÄÈ¤ì(€€€€€€€½¹ÍÐ…Ñ¥½¹Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰„±‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹t±ÍÁ…¸±‘¥Øˆ¥t(€€€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøÙ¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜€¿²¶J!qÌ«®6Ã²vÓ¶À¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤(€€€€€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøì(€€€€€€€€€€€½¹ÍÐ±•™ÑI•Ð€ô±•™Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€€€½¹ÍÐÉ¥¡ÑI•Ð€ôÉ¥¡Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€€€É•ÑÕÉ¸±•™ÑI•Ð¹Ý¥‘Ñ €¨±•™ÑI•Ð¹¡•¥¡Ð€´É¥¡ÑI•Ð¹Ý¥‘Ñ €¨É¥¡ÑI•Ð¹¡•¥¡Ðì(€€€€€€€€€ô¤ì(€€€€€€€€¼¼A=%i=8½™Ñ•¸½µ¥ÑÌÑ¡”Í•…É¡•…ÉÑ¥±”¹Õµ‰•È™É½´Ñ¡”É•¹‘•É•(€€€€€€€€¼¼Ù¥ÉÑÕ…°É½Ü•Ù•¸Ñ¡½Õ Ñ¡”•á…ÐÍ•…É É•ÑÕÉ¹•ÁÉ½‘ÕÑÌ¸I…¹¬…¸(€€€€€€€€¼¼…Ñ¥½¸Ý¡½Í”…¹•ÍÑ½ÉÌ½¹Ñ…¥¸Ñ¡”…ÉÑ¥±”™¥ÉÍÐì½Ñ¡•ÉÝ¥Í”ÕÍ”Ñ¡”(€€€€€€€€¼¼™¥ÉÍÐÙ¥Í¥‰±”É•ÍÕ±Ð…Ñ¥½¸¸Q¡”Í•…É É•ÅÕ•ÍÐ¥ÑÍ•±˜¥Ì•á…Ð°Í¼(€€€€€€€€¼¼É•ÅÕ¥É¥¹œÑ¡”…ÉÑ¥±”Ñ¼‰”É•¹‘•É•……¥¸É•…Ñ•Ì„™…±Í”(€€€€€€€€¼¼€‰ÁÉ½‘ÕÐ¹½Ð™½Õ¹ˆÉ•ÍÕ±Ð¸(€€€€€€€½¹ÍÐ…Ñ¥½¸€ô…Ñ¥½¹Ì¹™¥¹ ¡¥Ñ•´¤€ôøì(€€€€€€€€€±•Ð…¹‘¥‘…Ñ”€ô¥Ñ•´ì(€€€€€€€€€™½È€¡±•Ð‘•ÁÑ €ô€Àì…¹‘¥‘…Ñ”€˜˜‘•ÁÑ €ð€ÄÈì‘•ÁÑ €¬ô€Ä°…¹‘¥‘…Ñ”€ô…¹‘¥‘…Ñ”¹Á…É•¹Ñ±•µ•¹Ð¤ì(€€€€€€€€€€€¥˜€¡¹½Éµ…±¥é”¡…¹‘¥‘…Ñ”¹¥¹¹•ÉQ•áÐ¤¹¥¹±Õ‘•Ì¡¹½Éµ…±¥é•‘ÉÑ¥±”¤¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€€€€€ô(€€€€€€€€€É•ÑÕÉ¸™…±Í”ì(€€€€€€€ô¤ñð…Ñ¥½¹ÍlÁtì(€€€€€€€¥˜€¡…Ñ¥½¸¤ì(€€€€€€€€€±•Ð…¹‘¥‘…Ñ”€ô…Ñ¥½¸ì(€€€€€€€€€™½È€¡±•Ð‘•ÁÑ €ô€Àì…¹‘¥‘…Ñ”€˜˜‘•ÁÑ €ð€ÄÈì‘•ÁÑ €¬ô€Ä°…¹‘¥‘…Ñ”€ô…¹‘¥‘…Ñ”¹Á…É•¹Ñ±•µ•¹Ð¤ì(€€€€€€€€€€€¥˜€¡¹½Éµ…±¥é”¡…¹‘¥‘…Ñ”¹¥¹¹•ÉQ•áÐ¤¹¥¹±Õ‘•Ì¡¹½Éµ…±¥é•‘ÉÑ¥±”¤¤ì(€€€€€€€€€€€€€É½Ü€ô…¹‘¥‘…Ñ”ì(€€€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€€€É½Üñðô…Ñ¥½¸¹Á…É•¹Ñ±•µ•¹Ðñð…Ñ¥½¸ì(€€€€€€€ô(€€€€€ô(€€€€€¥˜€ …É½Ü¤½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐÉ½ÝQ•áÐ€ôMÑÉ¥¹œ¡É½Ü¹¥¹¹•ÉQ•áÐñð€ˆˆ¤ì(€€€€€½¹ÍÐÍ…±•Í5…Ñ €ôÉ½ÝQ•áÐ¹µ…Ñ  ¼ üë²ÖsªÞñqÌ¨ÌÃ²vñqÌ«¶2C®ž“®~%q¨¤ ðýqÌ©mq±t­p¬ü¤½¤¤ì(€€€€€½¹ÍÐÍ…±•ÍI…Ü€ôMÑÉ¥¹œ¡Í…±•Í5…Ñ ü¹lÅtñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€½¹ÍÐ‘…Ñ…1…‰•±Ì€ôl¸¸¹É½Ü¹ÅÕ•ÉåM•±•Ñ½É±° ‰„±‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹t±ÍÁ…¸±‘¥Øˆ¥t(€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøÙ¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜€¿²¶J!qÌ«®6Ã²vÓ¶À¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤(€€€€€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøì(€€€€€€€€€½¹ÍÐ±•™ÑI•Ð€ô±•™Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€½¹ÍÐÉ¥¡ÑI•Ð€ôÉ¥¡Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€É•ÑÕÉ¸±•™ÑI•Ð¹Ý¥‘Ñ €¨±•™ÑI•Ð¹¡•¥¡Ð€´É¥¡ÑI•Ð¹Ý¥‘Ñ €¨É¥¡ÑI•Ð¹¡•¥¡Ðì(€€€€€€€ô¤ì(€€€€€½¹ÍÐ‘…Ñ…1…‰•°€ô‘…Ñ…1…‰•±ÍlÁtì(€€€€€½¹ÍÐÑ…É•Ð€ô‘…Ñ…1…‰•°ü¹±½Í•ÍÐ ‰„±‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹tˆ¤ñð‘…Ñ…1…‰•°ì(€€€€€¥˜€ …Ñ…É•Ð¤½¹Ñ¥¹Õ”ì(€€€€€Ñ…É•Ð¹ÍÉ½±±%¹Ñ½Y¥•Ü¡ì‰±½¬è€‰•¹Ñ•Èˆ°¥¹±¥¹”è€‰•¹Ñ•Èˆô¤ì(€€€€€½¹ÍÐÉ•Ð€ôÑ…É•Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€½¬èÑÉÕ”°(€€€€€€€Í…±•ÍI…Ü°(€€€€€€€É½ÝQ•áÐ°(€€€€€€€ÁÉ½‘ÕÑ…Ñ…A½¥¹Ðèì(€€€€€€€€€àè5…Ñ ¹É½Õ¹¡É•Ð¹±•™Ð€¬É•Ð¹Ý¥‘Ñ €¼€È¤°(€€€€€€€€€äè5…Ñ ¹É½Õ¹¡É•Ð¹Ñ½À€¬É•Ð¹¡•¥¡Ð€¼€È¤°(€€€€€€€ô°(€€€€€ôì(€€€ô(€€€½¹ÍÐÙ¥Í¥‰±•…Ñ…Ñ¥½¹Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰„±‰ÕÑÑ½¸±mÉ½±”õ‰ÕÑÑ½¹t±ÍÁ…¸±‘¥Øˆ¥t(€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøÙ¥Í¥‰±”¡•±•µ•¹Ð¤€˜˜€¿²¶J!qÌ«®6Ã²vÓ¶À¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤¹±•¹Ñ ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰AI=UQ}I=]}9=Q}=U9ˆ°Ù¥Í¥‰±•…Ñ…Ñ¥½¹Ìôì(€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø€¡ì½¬è™…±Í”°½‘”è€‰AI=UQ}MI!}%1ˆô¤¤ì(€¥˜€ …Í•…É¡•ü¹½¬¤ì(€€€Í¡½Ý½±±•Ñ½É]¥¹‘½Ü ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…±Í”°(€€€€€½‘”èÍ•…É¡•ü¹½‘”ñð€‰AI=UQ}MI!}%1ˆ°(€€€€€µ•ÍÍ…”è€‘í…ÉÑ¥±•9Õµ‰•ÉôƒªÊ²$ƒªÊÃªÎðƒ²^ÓªâÀƒ².“¶2 ƒ
Üƒ²¶J ƒ®6Ã²vÓ¶Àƒ®Ê¶*ð€‘í9Õµ‰•È¡Í•…É¡•ü¹Ù¥Í¥‰±•…Ñ…Ñ¥½¹Ìñð€À¥÷ªÂq€°(€€€ôì(€ô(€½¹ÍÐÁÉ½‘ÕÑ…Ñ…±¥­•€ô…Ý…¥ÐÁ¡åÍ¥…±M•±±•ÉA½¥¹Ñ±¥¬¡Í•…É¡•¹ÁÉ½‘ÕÑ…Ñ…A½¥¹Ð°€Å|ÐÀÀ¤ì(€¥˜€ …ÁÉ½‘ÕÑ…Ñ…±¥­•¤ì(€€€Í¡½Ý½±±•Ñ½É]¥¹‘½Ü ¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰AI=UQ}Q}1%-}A=%9Q}9=Q}=U9ˆ°µ•ÍÍ…”è€‘í…ÉÑ¥±•9Õµ‰•Éôƒ²¶J ƒ®6Ã²vÓ¶Àƒ®Ê¶*ó²vƒ¶Ó®š·¶Vc²ž ƒ®ªï¶Z#²*×®.#®.¹€ôì(€ô(€½¹ÍÐÁÉ½‘ÕÑA…¹•±=Á•¹•€ô…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐ…ÉÑ¥±”€ô€‘í)M=8¹ÍÑÉ¥¹¥™ä¡…ÉÑ¥±•9Õµ‰•È¹Ñ½UÁÁ•É…Í” ¤¹É•Á±…” ½myµhÀ´åt½œ°€ˆˆ¤¥ôì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÐÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€½¹ÍÐÁ…¹•°€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹Ðµ‘É…Ý•Èµ½¹Ñ•¹Ð±mÉ½±”õ‘¥…±½t±…Í¥‘”°¹…¹Ðµ‘É…Ý•È±Í•Ñ¥½¸ˆ¥t¹™¥¹ ¡•±•µ•¹Ð¤€ôøì(€€€€€€€¥˜€ …Ù¥Í¥‰±”¡•±•µ•¹Ð¤¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€½¹ÍÐ½¹Ñ•¹Ð€ôMÑÉ¥¹œ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¹Ñ½UÁÁ•É…Í” ¤¹É•Á±…” ½myµhÀ´åt½œ°€ˆˆ¤ì(€€€€€€€É•ÑÕÉ¸É•Ð¹±•™Ð€ø¥¹¹•É]¥‘Ñ €¨€À¸ÔÔ€˜˜É•Ð¹Ý¥‘Ñ €ø€ÈÐÀ(€€€€€€€€€€˜˜€¿²¶J!qÌ«®6Ã²vÓ¶À¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð€ˆˆ¤(€€€€€€€€€€˜˜€¡½¹Ñ•¹Ð¹¥¹±Õ‘•Ì¡…ÉÑ¥±”¤ñð€¿ªÆÃ®zaqÌ«®
Ó²^µóªÂªÊ¥qÌ«²ÚS²vÐ¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¤ì(€€€€€ô¤ì(€€€€€¥˜€¡Á…¹•°¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€ô(€€€É•ÑÕÉ¸™…±Í”ì(€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø™…±Í”¤ì(€¥˜€ …ÁÉ½‘ÕÑA…¹•±=Á•¹•¤ì(€€€Í¡½Ý½±±•Ñ½É]¥¹‘½Ü ¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰AI=UQ}Q}A91}9=Q}=A9ˆ°µ•ÍÍ…”è€‘í…ÉÑ¥±•9Õµ‰•Éôƒ²¶J ƒ®6Ã²vÓ¶Àƒ¶fS®¦Ó²ró®†pƒ²‚¶fc®Bc²ž ƒ²V+²Vc²*×®.#®.¹€ôì(€ô(€±•ÐÍ…±•ÍI…Ü€ôMÑÉ¥¹œ¡Í•…É¡•¹Í…±•ÍI…Üñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€¥˜€ …Í…±•ÍI…Ü¤ì(€€€½¹ÍÐÉ½ÝQ•áÐ€ôMÑÉ¥¹œ¡Í•…É¡•¹É½ÝQ•áÐñð€ˆˆ¤ì(€€€½¹ÍÐµ…Ñ¡•Ì€ôl¸¸¹É½ÝQ•áÐ¹µ…Ñ¡±° ¼ üéyñqÌ¤ ðýqÌ©mq±t¬¥p¬ü üõqÍð¤½œ¥t¹µ…À ¡µ…Ñ ¤€ôøµ…Ñ¡lÅt¤ì(€€€Í…±•ÍI…Ü€ôµ…Ñ¡•Ì¹…Ð ´Ä¤ñð€ˆˆì(€ô(€…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€  ¤€ôøì(€€€Ý¥¹‘½Ü¹}}…É½Õ¹‘=ÁÑ¥½¹I•ÍÁ½¹Í•Ì€ômtì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø™…±Í”¤ì(€½¹ÍÐÑÉ…¹Í…Ñ¥½¹!¥ÍÑ½ÉåQ…‰A½¥¹Ð€ô…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€  ¤€ôøì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐÁ…¹•±Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹Ðµ‘É…Ý•Èµ½¹Ñ•¹Ð±mÉ½±”õ‘¥…±½t±…Í¥‘”°¹…¹Ðµ‘É…Ý•È±Í•Ñ¥½¸ˆ¥t(€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøì(€€€€€€€¥˜€ …Ù¥Í¥‰±”¡•±•µ•¹Ð¤¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€É•ÑÕÉ¸É•Ð¹±•™Ð€ø¥¹¹•É]¥‘Ñ €¨€À¸ÔÔ€˜˜É•Ð¹Ý¥‘Ñ €ø€ÈÐÀ€˜˜€¿²¶J!qÌ«®6Ã²vÓ¶À¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð€ˆˆ¤ì(€€€€€ô¤¹Í½ÉÐ ¡„°ˆ¤€ôø„¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €´ˆ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ ¤ì(€€€½¹ÍÐÁ…¹•°€ôÁ…¹•±ÍlÁtì(€€€½¹ÍÐ±…‰•°€ôl¸¸¸¡Á…¹•°ü¹ÅÕ•ÉåM•±•Ñ½É±° ‰mÉ½±”õÑ…‰t±‰ÕÑÑ½¸±„±ÍÁ…¸±‘¥Øˆ¤ñðmt¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø€¿ªÆÃ®zaqÌ«®
Ó²^´¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤(€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø„¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €´ˆ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ ¥lÁtì(€€€½¹ÍÐÑ…É•Ð€ô±…‰•°ü¹±½Í•ÍÐ ‰mÉ½±”õÑ…‰t±‰ÕÑÑ½¸±„ˆ¤ñð±…‰•°ì(€€€¥˜€ …Ñ…É•Ð¤É•ÑÕÉ¸¹Õ±°ì(€€€Ñ…É•Ð¹ÍÉ½±±%¹Ñ½Y¥•Ü¡ì‰±½¬è€‰•¹Ñ•Èˆ°¥¹±¥¹”è€‰•¹Ñ•Èˆô¤ì(€€€½¹ÍÐÉ•Ð€ôÑ…É•Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€É•ÑÕÉ¸ìàè5…Ñ ¹É½Õ¹¡É•Ð¹±•™Ð€¬É•Ð¹Ý¥‘Ñ €¼€È¤°äè5…Ñ ¹É½Õ¹¡É•Ð¹Ñ½À€¬É•Ð¹¡•¥¡Ð€¼€È¤ôì(€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø¹Õ±°¤ì(€¥˜€ …ÑÉ…¹Í…Ñ¥½¹!¥ÍÑ½ÉåQ…‰A½¥¹Ð¤ì(€€€…Ý…¥ÐÍÑ½ÁQÉ…¹Í…Ñ¥½¹9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€€€Í¡½Ý½±±•Ñ½É]¥¹‘½Ü ¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰QI9MQ%=9}!%MQ=Ie}Q	}9=Q}=U9ˆ°µ•ÍÍ…”è€‘í…ÉÑ¥±•9Õµ‰•Éôƒ²¶J ƒ®6Ã²vÓ¶Ã²v`ƒªÆÃ®z`ƒ®
Ó²^´ƒ®ž¶³®–ðƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¹€ôì(€ô(€…Ý…¥ÐÁ¡åÍ¥…±M•±±•ÉA½¥¹Ñ±¥¬¡ÑÉ…¹Í…Ñ¥½¹!¥ÍÑ½ÉåQ…‰A½¥¹Ð°€Å|ÈÀÀ¤ì(€½¹ÍÐÑÉ…¹Í…Ñ¥½¹!¥ÍÑ½ÉåQ…‰=Á•¹•€ô…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÝ…¥Ð€ô€¡µÌ¤€ôø¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°µÌ¤¤ì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€™½È€¡±•Ð…ÑÑ•µÁÐ€ô€Àì…ÑÑ•µÁÐ€ð€ÐÀì…ÑÑ•µÁÐ€¬ô€Ä¤ì(€€€€€½¹ÍÐÁ…¹•°€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹Ðµ‘É…Ý•Èµ½¹Ñ•¹Ð±mÉ½±”õ‘¥…±½t±…Í¥‘”°¹…¹Ðµ‘É…Ý•È±Í•Ñ¥½¸ˆ¥t¹™¥¹ ¡•±•µ•¹Ð¤€ôøì(€€€€€€€¥˜€ …Ù¥Í¥‰±”¡•±•µ•¹Ð¤¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€É•ÑÕÉ¸É•Ð¹±•™Ð€ø¥¹¹•É]¥‘Ñ €¨€À¸ÔÔ€˜˜É•Ð¹Ý¥‘Ñ €ø€ÈÐÀ(€€€€€€€€€€˜˜€¿ªÆÃ®zaqÌ«®
Ó²^´¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð€ˆˆ¤(€€€€€€€€€€˜˜€¿²‚²ÊÑqÌ©p£²b×²aqÌ«²ƒ¶up¥ó²b×²aqÌ«²ƒ¶t¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð€ˆˆ¤ì(€€€€€ô¤ì(€€€€€¥˜€¡Á…¹•°¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€…Ý…¥ÐÝ…¥Ð ÈÔÀ¤ì(€€€ô(€€€É•ÑÕÉ¸™…±Í”ì(€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø™…±Í”¤ì(€¥˜€ …ÑÉ…¹Í…Ñ¥½¹!¥ÍÑ½ÉåQ…‰=Á•¹•¤ì(€€€…Ý…¥ÐÍÑ½ÁQÉ…¹Í…Ñ¥½¹9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€€€Í¡½Ý½±±•Ñ½É]¥¹‘½Ü ¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰QI9MQ%=9}!%MQ=Ie}Q	}9=Q}=A9ˆ°µ•ÍÍ…”è€‘í…ÉÑ¥±•9Õµ‰•ÉôƒªÆÃ®z`ƒ®
Ó²^´ƒ¶fS®¦Ó²ró®†pƒ²‚¶fc®Bc²ž ƒ²V+²Vc²*×®.#®.¹€ôì(€ô(€½¹ÍÐ½ÁÑ¥½¹½¹ÑÉ½°€ô…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€  ¤€ôøì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐÁ…¹•±Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹Ðµ‘É…Ý•Èµ½¹Ñ•¹Ð±mÉ½±”õ‘¥…±½t±…Í¥‘”°¹…¹Ðµ‘É…Ý•È±Í•Ñ¥½¸ˆ¥t(€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøì(€€€€€€€¥˜€ …Ù¥Í¥‰±”¡•±•µ•¹Ð¤¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€É•ÑÕÉ¸É•Ð¹±•™Ð€ø¥¹¹•É]¥‘Ñ €¨€À¸ÔÔ€˜˜É•Ð¹Ý¥‘Ñ €ø€ÈÐÀ(€€€€€€€€€€˜˜€¿ªÆÃ®zaqÌ«®
Ó²^´¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð€ˆˆ¤ì(€€€€€ô¤¹Í½ÉÐ ¡„°ˆ¤€ôø„¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €´ˆ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ ¤ì(€€€½¹ÍÐÁ…¹•°€ôÁ…¹•±ÍlÁtñð‘½Õµ•¹Ð¹‰½‘äì(€€€½¹ÍÐ½¹ÑÉ½±Ì€ôl¸¸¹Á…¹•°¹ÅÕ•ÉåM•±•Ñ½É±° ‰Í•±•Ð±mÉ½±”õ½µ‰½‰½át±‰ÕÑÑ½¸±m…É¥„µ¡…ÍÁ½ÁÕÀõ±¥ÍÑ‰½át±¥¹ÁÕÐ°¹…¹ÐµÍ•±•ÐµÍ•±•Ñ½Èˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€½¹ÍÐ½¹ÑÉ½°€ô½¹ÑÉ½±Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôø€¿²‚²ÊÑó²b×²aqÌ«²ƒ¶t¼¹Ñ•ÍÐ ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð•±•µ•¹Ð¹Ù…±Õ”ñð•±•µ•¹Ð¹Á±…•¡½±‘•Èñð•±•µ•¹Ð¹Á…É•¹Ñ±•µ•¹Ðü¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¹ÑÉ¥´ ¤¤¤ì(€€€¥˜€ …½¹ÑÉ½°¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÑ…É•Ð€ô½¹ÑÉ½°¹±½Í•ÍÐ ‰Í•±•Ð±mÉ½±”õ½µ‰½‰½át±‰ÕÑÑ½¸±m…É¥„µ¡…ÍÁ½ÁÕÀõ±¥ÍÑ‰½át°¹…¹ÐµÍ•±•ÐµÍ•±•Ñ½Èˆ¤ñð½¹ÑÉ½°ì(€€€½¹ÍÐÉ•Ð€ôÑ…É•Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€É•ÑÕÉ¸ì(€€€€€½Á•¹•èÑÉÕ”°(€€€€€Ñ•áÐèMÑÉ¥¹œ¡Ñ…É•Ð¹¥¹¹•ÉQ•áÐñðÑ…É•Ð¹Ù…±Õ”ñðÑ…É•Ð¹Á…É•¹Ñ±•µ•¹Ðü¹¥¹¹•ÉQ•áÐñð€ˆˆ¤°(€€€€€àè5…Ñ ¹É½Õ¹¡É•Ð¹±•™Ð€¬É•Ð¹Ý¥‘Ñ €¼€È¤°(€€€€€äè5…Ñ ¹É½Õ¹¡É•Ð¹Ñ½À€¬É•Ð¹¡•¥¡Ð€¼€È¤°(€€€ôì(€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø¹Õ±°¤ì(€¥˜€ …½ÁÑ¥½¹½¹ÑÉ½°¤ì(€€€…Ý…¥ÐÍÑ½ÁQÉ…¹Í…Ñ¥½¹9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€€€Í¡½Ý½±±•Ñ½É]¥¹‘½Ü ¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰=AQ%=9}=9QI=1}9=Q}=U9ˆ°µ•ÍÍ…”è€‘í…ÉÑ¥±•9Õµ‰•ÉôƒªÆÃ®z`ƒ®
Ó²^·²v`ƒ²‚²ÊÐƒ²b×²`ƒ²ƒ¶w²Â÷²vƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¹€ôì(€ô(€…Ý…¥ÐÁ¡åÍ¥…±M•±±•ÉA½¥¹Ñ±¥¬¡½ÁÑ¥½¹½¹ÑÉ½°°€ÔÀÀ¤ì(€…Ý…¥ÐÝ…¥Ð ÐÀÀ¤ì(€½¹ÍÐ…±±=ÁÑ¥½¸€ô…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€  ¤€ôøì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐ½ÁÑ¥½¹Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰mÉ½±”õ½ÁÑ¥½¹t°¹…¹ÐµÍ•±•Ðµ¥Ñ•´µ½ÁÑ¥½¸±±¤ˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤(€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôø€½{²‚²ÊÐ üéqÍñp¡ð¤¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤(€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø„¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €´ˆ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ ¤ì(€€€½¹ÍÐ½ÁÑ¥½¸€ô½ÁÑ¥½¹ÍlÁtì(€€€¥˜€ …½ÁÑ¥½¸¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÉ•Ð€ô½ÁÑ¥½¸¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€É•ÑÕÉ¸ìàè5…Ñ ¹É½Õ¹¡É•Ð¹±•™Ð€¬É•Ð¹Ý¥‘Ñ €¼€È¤°äè5…Ñ ¹É½Õ¹¡É•Ð¹Ñ½À€¬É•Ð¹¡•¥¡Ð€¼€È¤ôì(€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø¹Õ±°¤ì(€¥˜€¡…±±=ÁÑ¥½¸¤ì(€€€…Ý…¥ÐÁ¡åÍ¥…±M•±±•ÉA½¥¹Ñ±¥¬¡…±±=ÁÑ¥½¸°€äÀÀ¤ì(€ô•±Í”ì(€€€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰­•å½Ý¸ˆ°­•å½‘”è€‰Mˆô¤ì(€€€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰­•åUÀˆ°­•å½‘”è€‰Mˆô¤ì(€ô(€…Ý…¥ÐÝ…¥Ð ÜÀÀ¤ì(€½¹ÍÐ…ÁÑÕÉ•‘I½ÝÌ€ômtì(€±•ÐÁÉ•Ù¥½ÕÍMÉ½±°€ô€´Äì(€™½È€¡±•ÐÁ…ÍÌ€ô€ÀìÁ…ÍÌ€ð€ÐÀìÁ…ÍÌ€¬ô€Ä¤ì(€€€½¹ÍÐ…ÁÑÕÉ”€ô…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€  ¤€ôøì(€€€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€€€½¹ÍÐÁ…¹•±Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ˆ¹…¹Ðµ‘É…Ý•Èµ½¹Ñ•¹Ð±mÉ½±”õ‘¥…±½t±…Í¥‘”°¹…¹Ðµ‘É…Ý•È±Í•Ñ¥½¸ˆ¥t(€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøì(€€€€€€€€€¥˜€ …Ù¥Í¥‰±”¡•±•µ•¹Ð¤¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€É•ÑÕÉ¸É•Ð¹±•™Ð€ø¥¹¹•É]¥‘Ñ €¨€À¸ÔÔ€˜˜É•Ð¹Ý¥‘Ñ €ø€ÈÐÀ(€€€€€€€€€€€€˜˜€¿ªÆÃ®zaqÌ«®
Ó²^´¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð€ˆˆ¤ì(€€€€€€€ô¤¹Í½ÉÐ ¡„°ˆ¤€ôø„¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ €´ˆ¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹Ý¥‘Ñ ¤ì(€€€€€½¹ÍÐÁ…¹•°€ôÁ…¹•±ÍlÁtñð‘½Õµ•¹Ð¹‰½‘äì(€€€€€½¹ÍÐ±•…™Q•áÐ€ôl¸¸¹Á…¹•°¹ÅÕ•ÉåM•±•Ñ½É±° ‰ÍÁ…¸±À±‘¥Ø±Ñˆ¥t¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøì(€€€€€€€¥˜€ …Ù¥Í¥‰±”¡•±•µ•¹Ð¤¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€½¹ÍÐÙ…±Õ”€ôMÑÉ¥¹œ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€€€¥˜€ …Ù…±Õ”ñðÙ…±Õ”¹±•¹Ñ €ø€àÀ¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€É•ÑÕÉ¸€…l¸¸¹•±•µ•¹Ð¹¡¥±‘É•¹t¹Í½µ” ¡¡¥±¤€ôøMÑÉ¥¹œ¡¡¥±¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¹ÑÉ¥´ ¤€ôôôÙ…±Õ”¤ì(€€€€€ô¤¹µ…À ¡•±•µ•¹Ð¤€ôø€¡ì•±•µ•¹Ð°Ñ•áÐèMÑÉ¥¹œ¡•±•µ•¹Ð¹¥¹¹•ÉQ•áÐñð€ˆˆ¤¹ÑÉ¥´ ¤°É•Ðè•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ô¤¤ì(€€€€€½¹ÍÐÁÉ¥•9½‘•Ì€ô±•…™Q•áÐ¹™¥±Ñ•È ¡¹½‘”¤€ôø€½x üéoŠ
§¾þ™uqÌ©mq±t¬ üéqÌ¨µqÌ©oŠ
§¾þ™týqÌ©mq±t¬¤ýñmq±t­qÌ«²n@¤¼¹Ñ•ÍÐ¡¹½‘”¹Ñ•áÐ¤¤ì(€€€€€½¹ÍÐÉ½ÝÌ€ômtì(€€€€€½¹ÍÐÉ½ÕÁ•€ômtì(€€€€€™½È€¡½¹ÍÐ¹½‘”½˜ÁÉ¥•9½‘•Ì¤ì(€€€€€€€±•ÐÉ½ÕÀ€ôÉ½ÕÁ•¹™¥¹ ¡¥Ñ•´¤€ôø5…Ñ ¹…‰Ì¡¥Ñ•´¹ä€´¹½‘”¹É•Ð¹Ñ½À¤€ð€à¤ì(€€€€€€€¥˜€ …É½ÕÀ¤ìÉ½ÕÀ€ôìäè¹½‘”¹É•Ð¹Ñ½À°ÁÉ¥•ÌèmtôìÉ½ÕÁ•¹ÁÕÍ ¡É½ÕÀ¤ìô(€€€€€€€É½ÕÀ¹ÁÉ¥•Ì¹ÁÕÍ ¡¹½‘”¤ì(€€€€€ô(€€€€€™½È€¡½¹ÍÐÉ½ÕÀ½˜É½ÕÁ•¤ì(€€€€€€€½¹ÍÐ™¥ÉÍÑAÉ¥”€ôÉ½ÕÀ¹ÁÉ¥•Ì¹Í½ÉÐ ¡„°ˆ¤€ôø„¹É•Ð¹±•™Ð€´ˆ¹É•Ð¹±•™Ð¥lÁtì(€€€€€€€½¹ÍÐÍ…±•Í9½‘”€ô±•…™Q•áÐ¹™¥±Ñ•È ¡¹½‘”¤€ôø€¿¶2C®ž“®~%qÌ©lë¾òitýqÌ¨ðýqÌ©mq±t­p¬ü½¤¹Ñ•ÍÐ¡¹½‘”¹Ñ•áÐ¤(€€€€€€€€€€˜˜5…Ñ ¹…‰Ì¡¹½‘”¹É•Ð¹±•™Ð€´™¥ÉÍÑAÉ¥”¹É•Ð¹±•™Ð¤€ð€ØÔ(€€€€€€€€€€˜˜¹½‘”¹É•Ð¹Ñ½À€øô™¥ÉÍÑAÉ¥”¹É•Ð¹Ñ½À€´€Ô€˜˜¹½‘”¹É•Ð¹Ñ½À€ðô™¥ÉÍÑAÉ¥”¹É•Ð¹‰½ÑÑ½´€¬€ÌÐ¤(€€€€€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø„¹É•Ð¹Ñ½À€´ˆ¹É•Ð¹Ñ½À¥lÁtì(€€€€€€€½¹ÍÐ±…‰•±Ì€ô±•…™Q•áÐ¹™¥±Ñ•È ¡¹½‘”¤€ôø¹½‘”¹É•Ð¹É¥¡Ð€ðô™¥ÉÍÑAÉ¥”¹É•Ð¹±•™Ð€¬€à(€€€€€€€€€€˜˜¹½‘”¹É•Ð¹±•™Ð€øôÁ…¹•°¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹±•™Ð(€€€€€€€€€€˜˜¹½‘”¹É•Ð¹Ñ½À€øô™¥ÉÍÑAÉ¥”¹É•Ð¹Ñ½À€´€ÈÔ€˜˜¹½‘”¹É•Ð¹‰½ÑÑ½´€ðô€¡Í…±•Í9½‘”ü¹É•Ð¹‰½ÑÑ½´ñð™¥ÉÍÑAÉ¥”¹É•Ð¹‰½ÑÑ½´€¬€ÌÀ¤€¬€ÄÀ(€€€€€€€€€€˜˜€„½oŠ
§¾þ›²nAuó¶2C®ž“®~$¼¹Ñ•ÍÐ¡¹½‘”¹Ñ•áÐ¤¤(€€€€€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø„¹É•Ð¹Ñ½À€´ˆ¹É•Ð¹Ñ½Àñð„¹É•Ð¹±•™Ð€´ˆ¹É•Ð¹±•™Ð¤ì(€€€€€€€½¹ÍÐ½ÁÑ¥½¸€ôl¸¸¹¹•ÜM•Ð¡±…‰•±Ì¹µ…À ¡¹½‘”¤€ôø¹½‘”¹Ñ•áÐ¤¥t¹©½¥¸ ˆ€ˆ¤¹É•Á±…” ½qÌ¬½œ°€ˆ€ˆ¤¹ÑÉ¥´ ¤ì(€€€€€€€½¹ÍÐÁÉ¥”€ô9Õµ‰•È ¡™¥ÉÍÑAÉ¥”¹Ñ•áÐ¹µ…Ñ  ¼ üéoŠ
§¾þ™uqÌ¨¤ü¡mq±t¬¥qÌ«²n@ü¼¤ü¹lÅtñð€ˆˆ¤¹É•Á±…” ¼°½œ°€ˆˆ¤¤ì(€€€€€€€½¹ÍÐÍ…±•Ì€ô€¡Í…±•Í9½‘”ü¹Ñ•áÐ¹µ…Ñ  ¿¶2C®ž“®~%qÌ©lë¾òitýqÌ¨ ðýqÌ©mq±t¬¥p¬ü½¤¤ü¹lÅtñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€€€¥˜€¡½ÁÑ¥½¸€˜˜ÁÉ¥”€˜˜Í…±•Ì¤É½ÝÌ¹ÁÕÍ ¡ìÑ•áÐè½ÁÑ¥½¸€¬€ˆ€ˆ€¬™¥ÉÍÑAÉ¥”¹Ñ•áÐ€¬€ˆ€ˆ€¬Í…±•Í9½‘”¹Ñ•áÐ°½ÁÑ¥½¸°ÁÉ¥”°Í…±•Ìô¤ì(€€€€€ô(€€€€€½¹ÍÐÍÉ½±±•È€ômÁ…¹•°°€¸¸¹Á…¹•°¹ÅÕ•ÉåM•±•Ñ½É±° ‰‘¥Ø±Í•Ñ¥½¸ˆ¥t(€€€€€€€€¹™¥±Ñ•È ¡•±•µ•¹Ð¤€ôøì(€€€€€€€€€¥˜€ …Ù¥Í¥‰±”¡•±•µ•¹Ð¤ñð•±•µ•¹Ð¹ÍÉ½±±!•¥¡Ð€ðô•±•µ•¹Ð¹±¥•¹Ñ!•¥¡Ð€¬€ÈÀ¤É•ÑÕÉ¸™…±Í”ì(€€€€€€€€€½¹ÍÐÉ•Ð€ô•±•µ•¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€€€€€É•ÑÕÉ¸É•Ð¹±•™Ð€øôÁ…¹•°¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤¹±•™Ð€´€È€˜˜É•Ð¹Ý¥‘Ñ €ø€ÄàÀì(€€€€€€€ô¤¹Í½ÉÐ ¡„°ˆ¤€ôø€¡ˆ¹ÍÉ½±±!•¥¡Ð€´ˆ¹±¥•¹Ñ!•¥¡Ð¤€´€¡„¹ÍÉ½±±!•¥¡Ð€´„¹±¥•¹Ñ!•¥¡Ð¤¥lÁtì(€€€€€¥˜€ …ÍÉ½±±•È¤É•ÑÕÉ¸ìÉ½ÝÌ°ÍÉ½±±Q½Àè€À°…Ñ¹èÑÉÕ”°ÍÉ½±±A½¥¹Ðè¹Õ±°ôì(€€€€€½¹ÍÐÉ•Ð€ôÍÉ½±±•È¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€É½ÝÌ°(€€€€€€€ÍÉ½±±Q½ÀèÍÉ½±±•È¹ÍÉ½±±Q½À°(€€€€€€€…Ñ¹èÍÉ½±±•È¹ÍÉ½±±Q½À€¬ÍÉ½±±•È¹±¥•¹Ñ!•¥¡Ð€øôÍÉ½±±•È¹ÍÉ½±±!•¥¡Ð€´€Ð°(€€€€€€€ÍÉ½±±A½¥¹ÐèìàèÉ•Ð¹±•™Ð€¬É•Ð¹Ý¥‘Ñ €¼€È°äè5…Ñ ¹µ¥¸¡É•Ð¹‰½ÑÑ½´€´€ÈÀ°É•Ð¹Ñ½À€¬É•Ð¹¡•¥¡Ð€¨€À¸ÜÈ¤ô°(€€€€€ôì(€€€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø€¡ìÉ½ÝÌèmt°…Ñ¹èÑÉÕ”°ÍÉ½±±Q½Àè€Àô¤¤ì(€€€…ÁÑÕÉ•‘I½ÝÌ¹ÁÕÍ  ¸¸¸¡…ÁÑÕÉ”¹É½ÝÌñðmt¤¤ì(€€€¥˜€¡…ÁÑÕÉ”¹…Ñ¹ñð9Õµ‰•È¡…ÁÑÕÉ”¹ÍÉ½±±Q½À¤€ôôôÁÉ•Ù¥½ÕÍMÉ½±°¤‰É•…¬ì(€€€ÁÉ•Ù¥½ÕÍMÉ½±°€ô9Õµ‰•È¡…ÁÑÕÉ”¹ÍÉ½±±Q½À¤ì(€€€¥˜€¡…ÁÑÕÉ”¹ÍÉ½±±A½¥¹Ð¤ì(€€€€€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰µ½ÕÍ•5½Ù”ˆ°àè5…Ñ ¹É½Õ¹¡…ÁÑÕÉ”¹ÍÉ½±±A½¥¹Ð¹à¤°äè5…Ñ ¹É½Õ¹¡…ÁÑÕÉ”¹ÍÉ½±±A½¥¹Ð¹ä¤ô¤ì(€€€€€Í•±±•É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹‘%¹ÁÕÑÙ•¹Ð¡ìÑåÁ”è€‰µ½ÕÍ•]¡••°ˆ°àè5…Ñ ¹É½Õ¹¡…ÁÑÕÉ”¹ÍÉ½±±A½¥¹Ð¹à¤°äè5…Ñ ¹É½Õ¹¡…ÁÑÕÉ”¹ÍÉ½±±A½¥¹Ð¹ä¤°‘•±Ñ…dè€ÐÈÀ°‘•±Ñ…`è€À°…¹MÉ½±°èÑÉÕ”ô¤ì(€€€ô(€€€…Ý…¥ÐÝ…¥Ð ÌÔÀ¤ì(€ô(€½¹ÍÐÕ¹¥ÅÕ•I½ÝÌ€ôl¸¸¹¹•Ü5…À¡…ÁÑÕÉ•‘I½ÝÌ¹µ…À ¡É½Ü¤€ôøm€‘íÉ½Ü¹½ÁÑ¥½¹õð‘íÉ½Ü¹ÁÉ¥•õð‘íÉ½Ü¹Í…±•Íõ€°É½Ýt¤¤¹Ù…±Õ•Ì ¥tì(€…Ý…¥ÐÝ…¥Ð ÔÀÀ¤ì(€…Ý…¥ÐÍÑ½ÁQÉ…¹Í…Ñ¥½¹9•ÑÝ½É­…ÁÑÕÉ” ¤ì(€½¹ÍÐÍ•±±•ÉI•ÍÁ½¹Í•Ì€ô…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€  ¤€ôøÉÉ…ä¹¥ÍÉÉ…ä¡Ý¥¹‘½Ü¹}}…É½Õ¹‘=ÁÑ¥½¹I•ÍÁ½¹Í•Ì¤(€€€€üÝ¥¹‘½Ü¹}}…É½Õ¹‘=ÁÑ¥½¹I•ÍÁ½¹Í•Ì¹Í±¥” ´àÀ¤(€€€€èmt¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôømt¤ì(€½¹ÍÐÉ•ÍÁ½¹Í•I½ÝÌ€ô½ÁÑ¥½¹I½ÝÍÉ½µM•±±•ÉI•ÍÁ½¹Í•Ì¡l(€€€€¸¸¹ÑÉ…¹Í…Ñ¥½¹9•ÑÝ½É­I•ÍÁ½¹Í•Ì°(€€€€¸¸¹Í•±±•ÉI•ÍÁ½¹Í•Ì°(€t¤ì(€€¼¼Q¡”Í•±±•ÈA$…¸É•ÑÕÉ¸Á…ÉÑ¥…°½‰…­É½Õ¹Á…å±½…‘Ì¸9•Ù•È±•Ð½¹”(€€¼¼¥¹½µÁ±•Ñ”A$É½Ü‘¥Í…ÉÙ…±¥½ÁÑ¥½¸É½ÝÌ½±±•Ñ•™É½´Ñ¡”Ù¥Í¥‰±”(€€¼¼ÑÉ…¹Í…Ñ¥½¸µ¡¥ÍÑ½Éä±¥ÍÐ¸(€½¹ÍÐÁÉ¥•I½ÝÌ€ôl¸¸¹¹•Ü5…À (€€€l¸¸¹Õ¹¥ÅÕ•I½ÝÌ°€¸¸¹É•ÍÁ½¹Í•I½ÝÍt¹µ…À ¡É½Ü¤€ôøl(€€€€€€‘íMÑÉ¥¹œ¡É½Üü¹½ÁÑ¥½¸ñð€ˆˆ¤¹ÑÉ¥´ ¥õð‘í9Õµ‰•È¡É½Üü¹ÁÉ¥”ñð€À¥õð‘íMÑÉ¥¹œ¡É½Üü¹Í…±•Ìñð€ˆˆ¤¹ÑÉ¥´ ¥õ€°(€€€€€É½Ü°(€€€t¤(€€¤¹Ù…±Õ•Ì ¥tì(€½¹ÍÐÍ¥é•=ÁÑ¥½¹Ì€ôÅÕ…±¥™¥•‘=ÁÑ¥½¹AÉ¥•Ì¡ÁÉ¥•I½ÝÌ°€À¤(€€€€¹Í½ÉÐ ¡±•™Ð°É¥¡Ð¤€ôøMÑÉ¥¹œ¡±•™Ð¹½ÁÑ¥½¸ñð€ˆˆ¤¹±½…±•½µÁ…É”¡MÑÉ¥¹œ¡É¥¡Ð¹½ÁÑ¥½¸ñð€ˆˆ¤°€‰­¼ˆ°ì¹Õµ•É¥ŒèÑÉÕ”ô¤¤ì(€½¹ÍÐÉ•ÍÕ±Ð€ô¡¥¡•ÍÑEÕ…±¥™¥•‘=ÁÑ¥½¹AÉ¥”¡ìÉ½ÝÌèÁÉ¥•I½ÝÌ°µ¥¹¥µÕµM…±•Ìè€ÌÀô¤ì(€…Ý…¥ÐÁÉ½‘ÕÑÉ…µ”¹•á•ÕÑ•)…Ù…MÉ¥ÁÐ¡MÑÉ¥¹œ¹É…Ý€  ¤€ôøì(€€€½¹ÍÐÙ¥Í¥‰±”€ô€¡•±•µ•¹Ð¤€ôø•±•µ•¹Ð€˜˜•±•µ•¹Ð¹•Ñ±¥•¹ÑI•ÑÌ ¤¹±•¹Ñ €ø€Àì(€€€½¹ÍÐ±…‰•±Ì€ôl¸¸¹‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‰ÕÑÑ½¸±„±mÉ½±”õ‰ÕÑÑ½¹t±ÍÁ…¸ˆ¥t¹™¥±Ñ•È¡Ù¥Í¥‰±”¤ì(€€€½¹ÍÐ‰…¬€ô±…‰•±Ì¹™¥¹ ¡•±•µ•¹Ð¤€ôø€¿®J“®†sªÂªâÀ¼¹Ñ•ÍÐ¡•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð¹ÑÉ¥´ ¤¤¤ì(€€€½¹ÍÐÑ…É•Ð€ô‰…¬ü¹±½Í•ÍÐ ‰‰ÕÑÑ½¸±„±mÉ½±”õ‰ÕÑÑ½¹tˆ¤ñð‰…¬ì(€€€¥˜€¡Ñ…É•Ð¤Ñ…É•Ð¹±¥¬ ¤ì(€€€É•ÑÕÉ¸	½½±•…¸¡Ñ…É•Ð¤ì(€ô¤ ¥€°ÑÉÕ”¤¹…Ñ   ¤€ôø™…±Í”¤ì(€Í¡½Ý½±±•Ñ½É]¥¹‘½Ü ¤ì(€¥˜€ …É•ÍÕ±Ð¹ÁÉ¥”¤ì(€€€Í•±±•É]¥¹‘½Ü¹Í¡½Ý%¹…Ñ¥Ù” ¤ì(€€€É•ÑÕÉ¸ì½¬è™…±Í”°•±¥¥‰±”è™…±Í”°½‘”è€‰EU1%%}=AQ%=9}AI%}9=Q}=U9ˆ°Í¥é•=ÁÑ¥½¹Ì°Í…±•ÌÌÁè9Õµ‰•È¡MÑÉ¥¹œ¡Í…±•ÍI…Ü¤¹É•Á±…” ½mxÀ´åt½œ°€ˆˆ¤¤ñð€À°µ•ÍÍ…”è€‘í…ÉÑ¥±•9Õµ‰•Éôƒ²b×²`ƒªÂªÊ¤ƒ¶fW²vàƒ².“¶2 ƒ
Üƒ¶fS®¦Ð€‘íÕ¹¥ÅÕ•I½ÝÌ¹±•¹Ñ¡÷¶Z$ƒ
Üƒ²vG®.Ô€‘íÉ•ÍÁ½¹Í•I½ÝÌ¹±•¹Ñ¡÷¶Z$ƒ
Üƒ¶2C®ž€ÌÃªÆÐƒ²vÓ²€Ã¶Z%€ôì(€ô(€Í•±±•É]¥¹‘½Ü¹¡¥‘” ¤ì(€É•ÑÕÉ¸ì(€€€½¬èÑÉÕ”°(€€€…ÉÑ¥±•9Õµ‰•È°(€€€Í…±•ÌÌÁè9Õµ‰•È¡MÑÉ¥¹œ¡Í…±•ÍI…Ü¤¹É•Á±…” ½mxÀ´åt½œ°€ˆˆ¤¤ñð€À°(€€€€¸¸¹É•ÍÕ±Ð°(€€€Í¥é•=ÁÑ¥½¹Ì°(€€€Í½ÕÉ”èÕ¹¥ÅÕ•I½ÝÌ¹±•¹Ñ €˜˜É•ÍÁ½¹Í•I½ÝÌ¹±•¹Ñ (€€€€€€ü€‰Í•±±•ÈµÁÉ½‘ÕÐµÑÉ…¹Í…Ñ¥½¸µ¡¥ÍÑ½Éäµ½ÁÑ¥½¹Ì­…Á¤ˆ(€€€€€€èÉ•ÍÁ½¹Í•I½ÝÌ¹±•¹Ñ (€€€€€€€€ü€‰Í•±±•ÈµÁÉ½‘ÕÐµÑÉ…¹Í…Ñ¥½¸µ…Á¤ˆ(€€€€€€€€è€‰Í•±±•ÈµÁÉ½‘ÕÐµÑÉ…¹Í…Ñ¥½¸µ¡¥ÍÑ½Éäµ½ÁÑ¥½¹Ìˆ°(€ôì)ô()™Õ¹Ñ¥½¸Í•¹‘]••­±åM¥Ñ•!•…±Ñ¡MÑ…ÑÕÌ¡Á…å±½…€ôíô¤ì(€½¹ÍÐÍÑ…ÑÕÌ€ôì(€€€€¸¸¹ÍÑ½É”ü¹Í¹…ÁÍ¡½Ð ¤ü¹Í•ÑÑ¥¹Ìü¹Ý••­±åM¥Ñ•!•…±Ñ °(€€€€¸¸¹Á…å±½…°(€€€Í¡•‘Õ±•1…‰•°è€‹®ž“²Žðƒ²"c²jS²vðƒ®Â€ÄË².pˆ°(€€€¹•áÑIÕ¹Ðè¹•áÑ]••­±åM¥Ñ•!•…±Ñ¡Ð¡¹•Ü…Ñ” ¤¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€ôì(€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰Ý••­±äµÍ¥Ñ”µ¡•…±Ñ éÍÑ…ÑÕÌˆ°ÍÑ…ÑÕÌ¤ì(€É•ÑÕÉ¸ÍÑ…ÑÕÌì)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹ÍÁ•ÑM¥Ñ•!•…±Ñ¡Q…É•Ð¡Ñ…É•Ð¤ì(€½¹ÍÐÍÑ…ÉÑ•‘Ð€ô¹•Ü…Ñ” ¤ì(€ÑÉäì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡Ñ…É•Ð¹ÕÉ°°ì(€€€€€É•‘¥É•Ðè€‰™½±±½Üˆ°(€€€€€Í¥¹…°è‰½ÉÑM¥¹…°¹Ñ¥µ•½ÕÐ¡M%Q}!1Q!}Q%5=UQ}5L¤°(€€€€€¡•…‘•ÉÌèì(€€€€€€€€‰…•ÁÐµ±…¹Õ…”ˆè€‰­¼µ-H±­¼íÄôÀ¸ä±•¸íÄôÀ¸Üˆ°(€€€€€€€€‰ÕÍ•Èµ…•¹Ðˆè€‰5½é¥±±„¼Ô¸À€¡]¥¹‘½ÝÌ9P€ÄÀ¸Àì]¥¸ØÐìàØÐ¤ÁÁ±•]•‰-¥Ð¼ÔÌÜ¸ÌØÉ½Õ¹‘µM¥Ñ•!•…±Ñ ¼Ä¸Àˆ°(€€€€€ô°(€€€ô¤ì(€€€½¹ÍÐ•¹‘•‘Ð€ô¹•Ü…Ñ” ¤ì(€€€€¼¼€ÐÀÄ¼ÐÀÌµ•…¹ÌÑ¡…ÐÑ¡”Í•ÉÙ•È¥ÑÍ•±˜É•ÍÁ½¹‘•…¹„±½¥¸½Í•ÕÉ¥Ñä(€€€€¼¼Í•ÍÍ¥½¸¥ÌÉ•ÅÕ¥É•¸I•½É¥ÐÍ•Á…É…Ñ•±ä¥¹ÍÑ•…½˜µ¥ÍÉ•Á½ÉÑ¥¹œ„(€€€€¼¼¹•ÑÝ½É¬½ÕÑ…”¸(€€€½¹ÍÐÉ•…¡…‰±”€ôÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ€ø€À€˜˜É•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ€ð€ÔÀÀì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹Ñ…É•Ð°(€€€€€½¬èÉ•…¡…‰±”°(€€€€€É•ÍÕ±ÐèÉ•…¡…‰±”€ü€¡É•ÍÁ½¹Í”¹½¬€ü€‹²‚W²ˆ€è€‹²‚G²4ƒªÂ®*—
ß®†sªÞã²và¿®ÎÓ²V ƒ¶fW²vàƒ¶V²jPˆ¤€è€‹²b“®–`ˆ°(€€€€€ÍÑ…ÑÕÍ½‘”èÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ°(€€€€€É•ÍÁ½¹Í•5Ìè•¹‘•‘Ð¹•ÑQ¥µ” ¤€´ÍÑ…ÉÑ•‘Ð¹•ÑQ¥µ” ¤°(€€€€€ÍÑ…ÉÑ•‘ÐèÍÑ…ÉÑ•‘Ð¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€•¹‘•‘Ðè•¹‘•‘Ð¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€™¥¹…±UÉ°èÉ•ÍÁ½¹Í”¹ÕÉ°ñðÑ…É•Ð¹ÕÉ°°(€€€€€•ÉÉ½ÈèÉ•…¡…‰±”€ü€ˆˆ€è!QQ@€‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍõ€°(€€€ôì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€½¹ÍÐ•¹‘•‘Ð€ô¹•Ü…Ñ” ¤ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹Ñ…É•Ð°(€€€€€½¬è™…±Í”°(€€€€€É•ÍÕ±Ðè€‹²b“®–`ˆ°(€€€€€ÍÑ…ÑÕÍ½‘”è€À°(€€€€€É•ÍÁ½¹Í•5Ìè•¹‘•‘Ð¹•ÑQ¥µ” ¤€´ÍÑ…ÉÑ•‘Ð¹•ÑQ¥µ” ¤°(€€€€€ÍÑ…ÉÑ•‘ÐèÍÑ…ÉÑ•‘Ð¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€•¹‘•‘Ðè•¹‘•‘Ð¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€™¥¹…±UÉ°èÑ…É•Ð¹ÕÉ°°(€€€€€•ÉÉ½Èè•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¤°(€€€ôì(€ô)ô()™Õ¹Ñ¥½¸É•Á½ÉÑQ¥µ•ÍÑ…µÀ¡‘…Ñ”¤ì(€½¹ÍÐÁ…€ô€¡Ù…±Õ”¤€ôøMÑÉ¥¹œ¡Ù…±Õ”¤¹Á…‘MÑ…ÉÐ È°€ˆÀˆ¤ì(€É•ÑÕÉ¸€‘í‘…Ñ”¹•ÑÕ±±e•…È ¥ô´‘íÁ…¡‘…Ñ”¹•Ñ5½¹Ñ  ¤€¬€Ä¥ô´‘íÁ…¡‘…Ñ”¹•Ñ…Ñ” ¤¥õ|‘íÁ…¡‘…Ñ”¹•Ñ!½ÕÉÌ ¤¥ô´‘íÁ…¡‘…Ñ”¹•Ñ5¥¹ÕÑ•Ì ¤¥õ€ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÝÉ¥Ñ•]••­±åM¥Ñ•!•…±Ñ¡I•Á½ÉÐ¡ÍÑ…ÉÑ•‘Ð°•¹‘•‘Ð°É•ÍÕ±ÑÌ°ÍÕµµ…Éä¤ì(€½¹ÍÐ™½±‘•È€ôÕÉÉ•¹Ñ	É…¹‘áÁ½ÉÑ½±‘•È ¤ì(€…Ý…¥Ðµ­‘¥È¡™½±‘•È°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€½¹ÍÐ™¥±•A…Ñ €ô©½¥¸¡™½±‘•È°ƒ²^Ã®>g²s®Ê²‚WªâÃ²‚CªÊ|‘íÉ•Á½ÉÑQ¥µ•ÍÑ…µÀ¡ÍÑ…ÉÑ•‘Ð¥ô¹á±Íá€¤ì(€½¹ÍÐ¹•áÑIÕ¸€ô¹•áÑ]••­±åM¥Ñ•!•…±Ñ¡Ð¡•¹‘•‘Ð¤ì(€½¹ÍÐ½Ù•ÉÙ¥•Ü€ôl(€€€l‹¶V·®ª¤ˆ°€‹®
Ó²j¤‰t°(€€€l‹²‚CªÊ ƒªÖ³®Úˆ°€‹²^Ã®>dƒ²s®Êƒ²ŽóªÂƒ²‚WªâÃ²‚CªÊ ‰t°(€€€l‹²‚CªÊ ƒ²vó²‚Tˆ°€‹®ž“²Žðƒ²"c²jS²vðƒ®Â€ÄË².p€£®ª§²jS²vð€ÀÀèÀÀ¤‰t°(€€€l‹²‚CªÊ ƒ².s²zDˆ°ÍÑ…ÉÑ•‘Ð¹Ñ½1½…±•MÑÉ¥¹œ ‰­¼µ-Hˆ¥t°(€€€l‹²‚CªÊ ƒ²Š®Ž0ˆ°•¹‘•‘Ð¹Ñ½1½…±•MÑÉ¥¹œ ‰­¼µ-Hˆ¥t°(€€€l‹²‚²ÊÐƒªÊÃªÎðˆ°ÍÕµµ…Éä¹½¬€ü€‹²‚²ÊÐƒ²‚W²ˆ€è€‘íÍÕµµ…Éä¹™…¥±•‘÷ªÂpƒ²
³²vÓ¶*àƒ²‚CªÊ ƒ¶V²jQt°(€€€l‹²‚W²ˆ°ÍÕµµ…Éä¹Á…ÍÍ•‘t°(€€€l‹²‚CªÊ ƒ¶V²jPˆ°ÍÕµµ…Éä¹™…¥±•‘t°(€€€l‹®.“²v0ƒ²‚CªÊ ƒ²b#²‚Tˆ°¹•áÑIÕ¸¹Ñ½1½…±•MÑÉ¥¹œ ‰­¼µ-Hˆ¥t°(€tì(€½¹ÍÐ‘•Ñ…¥°€ôl(€€€l‹®Ê#¶bàˆ°€‹²^Ã®>dƒ²s®Êˆ°€‹²‚CªÊ ƒ²Žó²0ˆ°€‹²‚CªÊ ƒ².s²zDˆ°€‹²‚CªÊ ƒ²Š®Ž0ˆ°€‰!QQ@ƒ²¶pˆ°€‹²vG®.Ôƒ².sªÂ¡µÌ¤ˆ°€‹²‚CªÊ ƒªÊÃªÎðˆ°€‹²b“®–`ƒ®
Ó²j¤‰t°(€€€€¸¸¹É•ÍÕ±ÑÌ¹µ…À ¡É•ÍÕ±Ð°¥¹‘•à¤€ôøl(€€€€€¥¹‘•à€¬€Ä°(€€€€€É•ÍÕ±Ð¹¹…µ”°(€€€€€É•ÍÕ±Ð¹™¥¹…±UÉ°ñðÉ•ÍÕ±Ð¹ÕÉ°°(€€€€€¹•Ü…Ñ”¡É•ÍÕ±Ð¹ÍÑ…ÉÑ•‘Ð¤¹Ñ½1½…±•MÑÉ¥¹œ ‰­¼µ-Hˆ¤°(€€€€€¹•Ü…Ñ”¡É•ÍÕ±Ð¹•¹‘•‘Ð¤¹Ñ½1½…±•MÑÉ¥¹œ ‰­¼µ-Hˆ¤°(€€€€€É•ÍÕ±Ð¹ÍÑ…ÑÕÍ½‘”ñð€‹²vG®.Ôƒ²^²v0ˆ°(€€€€€É•ÍÕ±Ð¹É•ÍÁ½¹Í•5Ì°(€€€€€É•ÍÕ±Ð¹É•ÍÕ±Ð°(€€€€€É•ÍÕ±Ð¹•ÉÉ½Èñð€ˆˆ°(€€€t¤°(€tì(€½¹ÍÐÝ½É­‰½½¬€ô€¡É½ÝÌ°Ý¥‘Ñ¡Ì¤€ôø€¡ì(€€€‘…Ñ„èÉ½ÝÌ¹µ…À ¡É½Ü°É½Ý%¹‘•à¤€ôøÉ½Ü¹µ…À ¡Ù…±Õ”¤€ôøÉ½Ý%¹‘•à€ôôô€À(€€€€€€üìÙ…±Õ”°™½¹Ñ]•¥¡Ðè€‰‰½±ˆ°‰…­É½Õ¹‘½±½Èè€ˆàˆô(€€€€€€èìÙ…±Õ”ô¤¤°(€€€½±Õµ¹ÌèÝ¥‘Ñ¡Ì¹µ…À ¡Ý¥‘Ñ ¤€ôø€¡ìÝ¥‘Ñ ô¤¤°(€€€ÍÑ¥­åI½ÝÍ½Õ¹Ðè€Ä°(€ô¤ì(€…Ý…¥ÐÝÉ¥Ñ•a±Íá¥±”¡l(€€€ì€¸¸¹Ý½É­‰½½¬¡½Ù•ÉÙ¥•Ü°lÈÐ°€ØÑt¤°Í¡••Ðè€‹²‚CªÊ ƒ²jS²Vôˆô°(€€€ì€¸¸¹Ý½É­‰½½¬¡‘•Ñ…¥°°là°€ÈÐ°€Øà°€ÈÐ°€ÈÐ°€ÄÐ°€Äà°€Èà°€ÔÑt¤°Í¡••Ðè€‹²s®Ê®Îƒ²‚CªÊ ƒªÊÃªÎðˆô°(€t¤¹Ñ½¥±”¡™¥±•A…Ñ ¤ì(€É•ÑÕÉ¸™¥±•A…Ñ ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸ÉÕ¹]••­±åM¥Ñ•!•…±Ñ¡¡•¬¡ìµ…¹Õ…°€ô™…±Í”ô€ôíô¤ì(€¥˜€¡Ý••­±åM¥Ñ•!•…±Ñ¡IÕ¹¹¥¹œ¤É•ÑÕÉ¸Í•¹‘]••­±åM¥Ñ•!•…±Ñ¡MÑ…ÑÕÌ¡ìÉÕ¹¹¥¹œèÑÉÕ”°µ•ÍÍ…”è€‹²^Ã®>dƒ²s®Êƒ²‚WªâÃ²‚CªÊ²vÐƒ²vÓ®¾àƒ²ž¶Z$ƒ²’G²z®.#®.¸ˆô¤ì(€Ý••­±åM¥Ñ•!•…±Ñ¡IÕ¹¹¥¹œ€ôÑÉÕ”ì(€½¹ÍÐÍÑ…ÉÑ•‘Ð€ô¹•Ü…Ñ” ¤ì(€Í•¹‘]••­±åM¥Ñ•!•…±Ñ¡MÑ…ÑÕÌ¡ìÉÕ¹¹¥¹œèÑÉÕ”°ÍÑ…Ñ”è€‰ÉÕ¹¹¥¹œˆ°ÍÑ…ÉÑ•‘ÐèÍÑ…ÉÑ•‘Ð¹Ñ½%M=MÑÉ¥¹œ ¤°µ•ÍÍ…”è€‹®ª£®N€ƒ²^Ã®>dƒ²s®Êƒ²‚WªâÃ²‚CªÊ²vƒ².s²zG¶Z#²*×®.#®.¸ˆ°½µÁ±•Ñ•è€À°Ñ½Ñ…°èM%Q}!1Q!}QIQL¹±•¹Ñ ô¤ì(€½¹ÍÐÉ•ÍÕ±ÑÌ€ômtì(€ÑÉäì(€€€™½È€¡½¹ÍÐÑ…É•Ð½˜M%Q}!1Q!}QIQL¤ì(€€€€€Í•¹‘]••­±åM¥Ñ•!•…±Ñ¡MÑ…ÑÕÌ¡ìÉÕ¹¹¥¹œèÑÉÕ”°ÍÑ…Ñ”è€‰ÉÕ¹¹¥¹œˆ°µ•ÍÍ…”è€‘íÑ…É•Ð¹¹…µ•ôƒ²^Ã®>dƒ²¶s®–ðƒ²‚CªÊ¶VcªÎ€ƒ²z#²*×®.#®.¹€°½µÁ±•Ñ•èÉ•ÍÕ±ÑÌ¹±•¹Ñ °Ñ½Ñ…°èM%Q}!1Q!}QIQL¹±•¹Ñ ô¤ì(€€€€€É•ÍÕ±ÑÌ¹ÁÕÍ ¡…Ý…¥Ð¥¹ÍÁ•ÑM¥Ñ•!•…±Ñ¡Q…É•Ð¡Ñ…É•Ð¤¤ì(€€€ô(€€€½¹ÍÐ•¹‘•‘Ð€ô¹•Ü…Ñ” ¤ì(€€€½¹ÍÐÍÕµµ…Éä€ôÝ••­±åM¥Ñ•!•…±Ñ¡MÕµµ…Éä¡É•ÍÕ±ÑÌ¤ì(€€€½¹ÍÐÉ•Á½ÉÑA…Ñ €ô…Ý…¥ÐÝÉ¥Ñ•]••­±åM¥Ñ•!•…±Ñ¡I•Á½ÉÐ¡ÍÑ…ÉÑ•‘Ð°•¹‘•‘Ð°É•ÍÕ±ÑÌ°ÍÕµµ…Éä¤ì(€€€½¹ÍÐµ•ÍÍ…”€ôÍÕµµ…Éä¹½¬(€€€€€€üƒ²^Ã®>dƒ²s®Ê€‘íÍÕµµ…Éä¹Ñ½Ñ…±÷ªÎÌƒ²‚WªâÃ²‚CªÊ²vÐƒ®ª£®F@ƒ²‚W²ƒ²f®Ž3®Bc²^#²*×®.#®.¹€(€€€€€€èƒ²‚WªâÃ²‚CªÊ ƒ²f®Ž0è€‘íÍÕµµ…Éä¹Á…ÍÍ•‘÷ªÎÌƒ²‚W²°€‘íÍÕµµ…Éä¹™…¥±•‘÷ªÎÌƒ²‚CªÊ²vÐƒ¶V²jS¶V§®.#®.¹€ì(€€€½¹ÍÐÍ…Ù•€ôì(€€€€€ÉÕ¹¹¥¹œè™…±Í”°(€€€€€ÍÑ…Ñ”èÍÕµµ…Éä¹½¬€ü€‰½µÁ±•Ñ•ˆ€è€‰½µÁ±•Ñ•‘}Ý¥Ñ¡}•ÉÉ½ÉÌˆ°(€€€€€µ…¹Õ…°°(€€€€€ÍÑ…ÉÑ•‘ÐèÍÑ…ÉÑ•‘Ð¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€•¹‘•‘Ðè•¹‘•‘Ð¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€±…ÍÑIÕ¹Ðè•¹‘•‘Ð¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€µ•ÍÍ…”°(€€€€€É•Á½ÉÑA…Ñ °(€€€€€É•ÍÕ±ÑÌ°(€€€€€€¸¸¹ÍÕµµ…Éä°(€€€ôì(€€€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡ìÝ••­±åM¥Ñ•!•…±Ñ èÍ…Ù•ô¤ì(€€€Í•¹‘]••­±åM¥Ñ•!•…±Ñ¡MÑ…ÑÕÌ¡Í…Ù•¤ì(€€€¥˜€¡9½Ñ¥™¥…Ñ¥½¸¹¥ÍMÕÁÁ½ÉÑ• ¤¤¹•Ü9½Ñ¥™¥…Ñ¥½¸¡ìÑ¥Ñ±”è€‰É½Õ¹ƒ²‚WªâÃ²‚CªÊ ƒ²f®Ž0ˆ°‰½‘äè€‘íµ•ÍÍ…•õq¹á•°ƒ®ÎÓªÎƒ²sªÂ ƒ²‚²z—®Bc²^#²*×®.#®.¹€ô¤¹Í¡½Ü ¤ì(€€€É•ÑÕÉ¸Í…Ù•ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€½¹ÍÐ™…¥±•€ôì(€€€€€ÉÕ¹¹¥¹œè™…±Í”°(€€€€€ÍÑ…Ñ”è€‰™…¥±•ˆ°(€€€€€ÍÑ…ÉÑ•‘ÐèÍÑ…ÉÑ•‘Ð¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€•¹‘•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€µ•ÍÍ…”èƒ²‚WªâÃ²‚CªÊ ƒ²Êc®š°ƒ²b“®–`è€‘í•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¥õ€°(€€€€€É•ÍÕ±ÑÌ°(€€€ôì(€€€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡ìÝ••­±åM¥Ñ•!•…±Ñ è™…¥±•ô¤ì(€€€Í•¹‘]••­±åM¥Ñ•!•…±Ñ¡MÑ…ÑÕÌ¡™…¥±•¤ì(€€€É•ÑÕÉ¸™…¥±•ì(€ô™¥¹…±±äì(€€€Ý••­±åM¥Ñ•!•…±Ñ¡IÕ¹¹¥¹œ€ô™…±Í”ì(€€€Í¡•‘Õ±•]••­±åM¥Ñ•!•…±Ñ¡¡•¬ ¤ì(€ô)ô()™Õ¹Ñ¥½¸Í¡•‘Õ±•]••­±åM¥Ñ•!•…±Ñ¡¡•¬ ¤ì(€¥˜€¡Ý••­±åM¥Ñ•!•…±Ñ¡Q¥µ•È¤±•…ÉQ¥µ•½ÕÐ¡Ý••­±åM¥Ñ•!•…±Ñ¡Q¥µ•È¤ì(€½¹ÍÐ¹½Ü€ô¹•Ü…Ñ” ¤ì(€½¹ÍÐ¹•áÐ€ô¹•áÑ]••­±åM¥Ñ•!•…±Ñ¡Ð¡¹½Ü¤ì(€Ý••­±åM¥Ñ•!•…±Ñ¡Q¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôøÙ½¥ÉÕ¹]••­±åM¥Ñ•!•…±Ñ¡¡•¬ ¤°5…Ñ ¹µ…à Å|ÀÀÀ°¹•áÐ¹•ÑQ¥µ” ¤€´¹½Ü¹•ÑQ¥µ” ¤¤¤ì(€Ý••­±åM¥Ñ•!•…±Ñ¡Q¥µ•È¹Õ¹É•˜ü¸ ¤ì(€Í•¹‘]••­±åM¥Ñ•!•…±Ñ¡MÑ…ÑÕÌ¡ì¹•áÑIÕ¹Ðè¹•áÐ¹Ñ½%M=MÑÉ¥¹œ ¤ô¤ì)ô()™Õ¹Ñ¥½¸‘½µ•ÍÑ¥1½¥¹M½ÕÉ”¡Í½ÕÉ•%¤ì(€É•ÑÕÉ¸=5MQ%}1=%9}M=UIL¹™¥¹ ¡Í½ÕÉ”¤€ôøÍ½ÕÉ”¹¥€ôôôMÑÉ¥¹œ¡Í½ÕÉ•%ñð€ˆˆ¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸‘½µ•ÍÑ¥1½¥¹MÑ…ÑÕÍ•Ì ¤ì(€½¹ÍÐÁ•ÉÍ¥ÍÑ•¹ÑM•ÍÍ¥½¸€ôÍ•ÍÍ¥½¸¹™É½µA…ÉÑ¥Ñ¥½¸¡=5MQ%}MI!}AIQ%Q%=8¤ì(€É•ÑÕÉ¸AÉ½µ¥Í”¹…±°¡=5MQ%}1=%9}M=UIL¹µ…À¡…Íå¹Œ€¡Í½ÕÉ”¤€ôøì(€€€½¹ÍÐ½½­¥•É½ÕÁÌ€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡Í½ÕÉ”¹‘½µ…¥¹Ì¹µ…À ¡‘½µ…¥¸¤€ôøÁ•ÉÍ¥ÍÑ•¹ÑM•ÍÍ¥½¸¹½½­¥•Ì¹•Ð¡ì‘½µ…¥¸ô¤¹…Ñ   ¤€ôømt¤¤¤ì(€€€½¹ÍÐ½½­¥•Ì€ô½½­¥•É½ÕÁÌ¹™±…Ð ¤ì(€€€É•ÑÕÉ¸ì(€€€€€¥èÍ½ÕÉ”¹¥°(€€€€€¹…µ”èÍ½ÕÉ”¹¹…µ”°(€€€€€ÕÉ°èÍ½ÕÉ”¹ÕÉ°°(€€€€€¡…ÍM•ÍÍ¥½¸è½½­¥•Ì¹±•¹Ñ €ø€À°(€€€€€Ý¥¹‘½Ý=Á•¸è	½½±•…¸¡‘½µ•ÍÑ¥1½¥¹]¥¹‘½ÝÌ¹•Ð¡Í½ÕÉ”¹¥¤€˜˜€…‘½µ•ÍÑ¥1½¥¹]¥¹‘½ÝÌ¹•Ð¡Í½ÕÉ”¹¥¤¹¥Í•ÍÑÉ½å• ¤¤°(€€€ôì(€ô¤¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸½Á•¹½µ•ÍÑ¥1½¥¸¡Í½ÕÉ•%¤ì(€½¹ÍÐÍ½ÕÉ”€ô‘½µ•ÍÑ¥1½¥¹M½ÕÉ”¡Í½ÕÉ•%¤ì(€¥˜€ …Í½ÕÉ”¤É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹²ž²nC¶Vc²ž ƒ²V+®*Pƒ²3².Ç®ªÃ²z®.#®.¸ˆôì(€½¹ÍÐ•á¥ÍÑ¥¹œ€ô‘½µ•ÍÑ¥1½¥¹]¥¹‘½ÝÌ¹•Ð¡Í½ÕÉ”¹¥¤ì(€¥˜€¡•á¥ÍÑ¥¹œ€˜˜€…•á¥ÍÑ¥¹œ¹¥Í•ÍÑÉ½å• ¤¤ì(€€€•á¥ÍÑ¥¹œ¹Í¡½Ü ¤ì(€€€•á¥ÍÑ¥¹œ¹™½ÕÌ ¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°½Á•¹•èÑÉÕ”ôì(€ô(€½¹ÍÐ±½¥¹]¥¹‘½Ü€ô¹•Ü	É½ÝÍ•É]¥¹‘½Ü¡ì(€€€Ñ¥Ñ±”è€‘íÍ½ÕÉ”¹¹…µ•ôƒ®†sªÞã²vàƒ
ÜÉ½Õ¹€°(€€€Ý¥‘Ñ è€ÄÈàÀ°(€€€¡•¥¡Ðè€àØÀ°(€€€Í¡½ÜèÑÉÕ”°(€€€…ÕÑ½!¥‘•5•¹Õ	…ÈèÑÉÕ”°(€€€Ý•‰AÉ•™•É•¹•ÌèìÁ…ÉÑ¥Ñ¥½¸è=5MQ%}MI!}AIQ%Q%=8°Í…¹‘‰½àèÑÉÕ”°½¹Ñ•áÑ%Í½±…Ñ¥½¸èÑÉÕ”ô°(€ô¤ì(€‘½µ•ÍÑ¥1½¥¹]¥¹‘½ÝÌ¹Í•Ð¡Í½ÕÉ”¹¥°±½¥¹]¥¹‘½Ü¤ì(€±½¥¹]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•Ñ]¥¹‘½Ý=Á•¹!…¹‘±•È ¡ìÕÉ°ô¤€ôøì(€€€¥˜€ ½y¡ÑÑÁÌép½p¼½¤¹Ñ•ÍÐ¡ÕÉ°¤¤±½¥¹]¥¹‘½Ü¹±½…‘UI0¡ÕÉ°¤¹…Ñ   ¤€ôøíô¤ì(€€€É•ÑÕÉ¸ì…Ñ¥½¸è€‰‘•¹äˆôì(€ô¤ì(€±½¥¹]¥¹‘½Ü¹½¸ ‰±½Í•ˆ°€ ¤€ôøì(€€€‘½µ•ÍÑ¥1½¥¹]¥¹‘½ÝÌ¹‘•±•Ñ”¡Í½ÕÉ”¹¥¤ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‘½µ•ÍÑ¥Œµ±½¥¸é¡…¹•ˆ°ìÍ½ÕÉ•%èÍ½ÕÉ”¹¥ô¤ì(€ô¤ì(€…Ý…¥Ð±½¥¹]¥¹‘½Ü¹±½…‘UI0¡Í½ÕÉ”¹ÕÉ°¤¹…Ñ   ¤€ôøíô¤ì(€É•ÑÕÉ¸ì½¬èÑÉÕ”°½Á•¹•èÑÉÕ”ôì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±•…É½µ•ÍÑ¥1½¥¸¡Í½ÕÉ•%¤ì(€½¹ÍÐÍ½ÕÉ”€ô‘½µ•ÍÑ¥1½¥¹M½ÕÉ”¡Í½ÕÉ•%¤ì(€¥˜€ …Í½ÕÉ”¤É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹²ž²nC¶Vc²ž ƒ²V+®*Pƒ²3².Ç®ªÃ²z®.#®.¸ˆôì(€½¹ÍÐÁ•ÉÍ¥ÍÑ•¹ÑM•ÍÍ¥½¸€ôÍ•ÍÍ¥½¸¹™É½µA…ÉÑ¥Ñ¥½¸¡=5MQ%}MI!}AIQ%Q%=8¤ì(€™½È€¡½¹ÍÐ‘½µ…¥¸½˜Í½ÕÉ”¹‘½µ…¥¹Ì¤ì(€€€½¹ÍÐ½½­¥•Ì€ô…Ý…¥ÐÁ•ÉÍ¥ÍÑ•¹ÑM•ÍÍ¥½¸¹½½­¥•Ì¹•Ð¡ì‘½µ…¥¸ô¤¹…Ñ   ¤€ôømt¤ì(€€€™½È€¡½¹ÍÐ½½­¥”½˜½½­¥•Ì¤ì(€€€€€½¹ÍÐÍ¡•µ”€ô½½­¥”¹Í•ÕÉ”€ü€‰¡ÑÑÁÌˆ€è€‰¡ÑÑÀˆì(€€€€€½¹ÍÐ¡½ÍÐ€ôMÑÉ¥¹œ¡½½­¥”¹‘½µ…¥¸ñð‘½µ…¥¸¤¹É•Á±…” ½yp¸¼°€ˆˆ¤ì(€€€€€…Ý…¥ÐÁ•ÉÍ¥ÍÑ•¹ÑM•ÍÍ¥½¸¹½½­¥•Ì¹É•µ½Ù”¡€‘íÍ¡•µ•ôè¼¼‘í¡½ÍÑô‘í½½­¥”¹Á…Ñ ñð€ˆ¼‰õ€°½½­¥”¹¹…µ”¤¹…Ñ   ¤€ôøíô¤ì(€€€ô(€ô(€‘½µ•ÍÑ¥1½¥¹]¥¹‘½ÝÌ¹•Ð¡Í½ÕÉ”¹¥¤ü¹±½Í” ¤ì(€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì)ô()…ÁÀ¹Ý¡•¹I•…‘ä ¤¹Ñ¡•¸¡…Íå¹Œ€ ¤€ôøì(€…ÁÀ¹Í•ÑÁÁUÍ•É5½‘•±% ‰­È¹…É½Õ¹‘œ¹Á½¥é½¸ˆ¤ì(€½¹ÍÐÕÍ•É…Ñ…½±‘•È€ô…ÁÀ¹•ÑA…Ñ  ‰ÕÍ•É…Ñ„ˆ¤ì(€½¹ÍÐ¡…‘1½…±…Ñ„€ô	½½±•…¸¡…Ý…¥ÐÍÑ…Ð¡©½¥¸¡ÕÍ•É…Ñ…½±‘•È°€‰…É½Õ¹µœµ‘…Ñ„¹©Í½¸ˆ¤¤¹…Ñ   ¤€ôø¹Õ±°¤¤ì(€ÍÑ½É”€ô¹•Ü)Í½¹MÑ½É”¡ÕÍ•É…Ñ…½±‘•È¤ì(€…Ý…¥ÐÍÑ½É”¹±½… ¤ì(€½¹ÍÐÁÉ•Ù¥½ÕÍY•ÉÍ¥½¸€ôMÑÉ¥¹œ¡ÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤ü¹Í•ÑÑ¥¹Ìü¹±…ÍÑ1…Õ¹¡•‘Y•ÉÍ¥½¸ñð€ˆˆ¤ì(€½¹ÍÐÕÉÉ•¹ÑY•ÉÍ¥½¸€ô…ÁÀ¹•ÑY•ÉÍ¥½¸ ¤ì(€¥˜€¡…ÁÀ¹¥ÍA…­…•€˜˜ÁÉ•Ù¥½ÕÍY•ÉÍ¥½¸€˜˜ÁÉ•Ù¥½ÕÍY•ÉÍ¥½¸€„ôôÕÉÉ•¹ÑY•ÉÍ¥½¸¤ì(€€€…Ý…¥Ð…‘‘AÉ½É…µ9½Ñ¥™¥…Ñ¥½¸¡ì(€€€€€ÑåÁ”è€‰ÍÕ•ÍÌˆ°Ñ¥Ñ±”è€‹²^®6Ã²vÓ¶*àƒ²“²æ`ƒ²f®Ž0ˆ°(€€€€€µ•ÍÍ…”èÉ½Õ¹Ø‘íÕÉÉ•¹ÑY•ÉÍ¥½¹ôƒ²^®6Ã²vÓ¶*ãªÂ ƒ²f®Ž3®Bc²^#²*×®.#®.¹€°(€€€€€­•äèÕÁ‘…Ñ”é¥¹ÍÑ…±±•è‘íÕÉÉ•¹ÑY•ÉÍ¥½¹õ€°Ý¥¹‘½ÝÌèÑÉÕ”°(€€€ô¤ì(€ô(€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡ì±…ÍÑ1…Õ¹¡•‘Y•ÉÍ¥½¸èÕÉÉ•¹ÑY•ÉÍ¥½¸ô¤ì(€¥˜€¡ÁÉ½•ÍÌ¹…ÉØ¹¥¹±Õ‘•Ì ˆ´µµ¥É…Ñ”µ½¹±äˆ¤¤ì(€€€…ÁÀ¹ÅÕ¥Ð ¤ì(€€€É•ÑÕÉ¸ì(€ô(€…Ý…¥ÐÉ•ÍÑ½É•A½ÉÑ…‰±•=¹•É¥Ù•	…­ÕÁ%™É•Í ¡¡…‘1½…±…Ñ„¤¹…Ñ   ¤€ôøíô¤ì(€€¼¼MÑ…ÉÑ¥¹œÑ¡”ÁÉ½É…´É•…Ñ•Ì„±•…¸Ù¥Í¥‰±”Í½ÕÉ¥¹œÍ•ÍÍ¥½¸¸AÉ•Í•ÉÙ”(€€¼¼Ñ¡”©½ˆµÑ¼µ‰É…¹…¡”½¹±ä…Ì¡¥‘‘•¸É•½Ù•Éä•Ù¥‘•¹”Í¼…¸¥¹Ñ•ÉÉÕÁÑ•(€€¼¼ÕÁ‘…Ñ”…¸É•½¹¹•ÐÑ¡”Í…µ”Í•±•Ñ•‰É…¹Ý¥Ñ¡½ÕÐ…ÕÑ¼µÍ•±•Ñ¥¹œ½È(€€¼¼µ¥á¥¹œ…¹äÁÉ•Ù¥½ÕÌ‰É…¹¥¹Ñ¼Ñ¡”¹•ÜÍÉ••¸¸(€…Ý…¥Ð¥¹¥Ñ¥…±¥é•=¹•É¥Ù•A½¥é½¹	…­ÕÀ ¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰ÍÑ½É”éÍ¹…ÁÍ¡½Ðˆ°€ ¤€ôøÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰ÍÑ½É”éÕÁÍ•ÉÐˆ°€¡}•Ù•¹Ð°½±±•Ñ¥½¸°¥Ñ•´¤€ôøÍÑ½É”¹ÕÁÍ•ÉÐ¡½±±•Ñ¥½¸°¥Ñ•´¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰ÍÑ½É”é‰Õ±¬µÕÁÍ•ÉÐˆ°€¡}•Ù•¹Ð°½±±•Ñ¥½¸°¥Ñ•µÌ¤€ôøÍÑ½É”¹‰Õ±­UÁÍ•ÉÐ¡½±±•Ñ¥½¸°¥Ñ•µÌ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰ÍÑ½É”éÉ•µ½Ù”ˆ°€¡}•Ù•¹Ð°½±±•Ñ¥½¸°¥¤€ôøÍÑ½É”¹É•µ½Ù”¡½±±•Ñ¥½¸°¥¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰½±±•Ñ½Èé¡•¬ˆ°€¡}•Ù•¹Ð°¥¹ÁÕÐ¤€ôøÍÑ½É”¹ÕÁ‘…Ñ•½±±•Ñ½È¡¥¹ÁÕÐ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰…ÁÀé¥¹™¼ˆ°€ ¤€ôø€¡ì(€€€¹…µ”è…ÁÀ¹•Ñ9…µ” ¤°(€€€Ù•ÉÍ¥½¸è…ÁÀ¹•ÑY•ÉÍ¥½¸ ¤°(€€€Á…­…•è…ÁÀ¹¥ÍA…­…•°(€€€…ÕÑ½µ…Ñ¥UÁ‘…Ñ•Ìè…ÁÀ¹¥ÍA…­…•°(€ô¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰…­ÕÀéÍÑ…ÑÕÌˆ°€ ¤€ôø½¹•É¥Ù•	…­ÕÁMÑ…ÑÕÌ¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰…­ÕÀéÉÕ¸ˆ°€ ¤€ôøÉÕ¹=¹•É¥Ù•I•½Ù•Éå	…­ÕÀ ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰ÕÁ‘…Ñ”é¡•¬ˆ°…Íå¹Œ€ ¤€ôøì(€€€¥˜€ ……ÁÀ¹¥ÍA…­…•¤É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹ªÂs®Âpƒ®ª£®Ns²^C²s®*Pƒ²^®6Ã²vÓ¶*ã®–ðƒ¶fW²vã¶Vc²ž ƒ²V+²*×®.#®.¸ˆôì(€€€É•ÑÕÉ¸¡•­½ÉUÁ‘…Ñ•ÍÕÑ½µ…Ñ¥…±±ä ¤ì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰ÕÁ‘…Ñ”é¥¹ÍÑ…±°ˆ°…Íå¹Œ€ ¤€ôøì(€€€ÑÉäì(€€€€€¥˜€ ……ÕÑ½UÁ‘…Ñ•È¹ÕÁ‘…Ñ•%¹™½¹‘AÉ½Ù¥‘•È¤ì(€€€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð…ÕÑ½UÁ‘…Ñ•È¹¡•­½ÉUÁ‘…Ñ•Ì ¤ì(€€€€€€€¥˜€ …É•ÍÕ±Ðü¹¥ÍUÁ‘…Ñ•Ù…¥±…‰±”¤É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹²“²æc¶V€ƒ² ƒ®Ê²‚²vÐƒ²^²*×®.#®.¸ˆôì(€€€€€ô(€€€€€…Ý…¥Ð…ÕÑ½UÁ‘…Ñ•È¹‘½Ý¹±½…‘UÁ‘…Ñ” ¤ì(€€€€€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¤ôì(€€€ô(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰ÕÁ‘…Ñ”éÉ•ÍÑ…ÉÐˆ°€ ¤€ôøì(€€€¥˜€ …ÕÁ‘…Ñ•I•…‘ä¤É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹²“²æc¶V€ƒ²^®6Ã²vÓ¶*àƒ®.“²jÓ®†s®NsªÂ ƒ²f®Ž3®Bc²ž ƒ²V+²Vc²*×®.#®.¸ˆôì(€€€Í•Ñ%µµ•‘¥…Ñ”  ¤€ôø…ÕÑ½UÁ‘…Ñ•È¹ÅÕ¥Ñ¹‘%¹ÍÑ…±°¡ÑÉÕ”°ÑÉÕ”¤¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰¹½Ñ¥™¥…Ñ¥½¹Ìé±¥ÍÐˆ°€ ¤€ôøì(€€€½¹ÍÐ¥Ñ•µÌ€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤ü¹Í•ÑÑ¥¹Ìü¹ÁÉ½É…µ9½Ñ¥™¥…Ñ¥½¹Ìì(€€€É•ÑÕÉ¸ÉÉ…ä¹¥ÍÉÉ…ä¡¥Ñ•µÌ¤€ü¥Ñ•µÌ€èmtì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰¹½Ñ¥™¥…Ñ¥½¹Ìéµ…É¬µÉ•…ˆ°…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐ¥Ñ•µÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡ÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤ü¹Í•ÑÑ¥¹Ìü¹ÁÉ½É…µ9½Ñ¥™¥…Ñ¥½¹Ì¤(€€€€€€üÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ì¹ÁÉ½É…µ9½Ñ¥™¥…Ñ¥½¹Ì€èmtì(€€€½¹ÍÐÁÉ½É…µ9½Ñ¥™¥…Ñ¥½¹Ì€ô¥Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø€¡ì€¸¸¹¥Ñ•´°É•…èÑÉÕ”ô¤¤ì(€€€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡ìÁÉ½É…µ9½Ñ¥™¥…Ñ¥½¹Ìô¤ì(€€€É•ÑÕÉ¸ÁÉ½É…µ9½Ñ¥™¥…Ñ¥½¹Ìì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰¹½Ñ¥™¥…Ñ¥½¹Ìé±•…Èˆ°…Íå¹Œ€ ¤€ôøì(€€€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡ìÁÉ½É…µ9½Ñ¥™¥…Ñ¥½¹Ìèmtô¤ì(€€€É•ÑÕÉ¸mtì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰½¹™¥œé•Ðˆ°€ ¤€ôøÁÕ‰±¥½¹™¥œ ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‘½µ•ÍÑ¥Œµ±½¥¸é±¥ÍÐˆ°€ ¤€ôø‘½µ•ÍÑ¥1½¥¹MÑ…ÑÕÍ•Ì ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‘½µ•ÍÑ¥Œµ±½¥¸é½Á•¸ˆ°€¡}•Ù•¹Ð°Í½ÕÉ•%¤€ôø½Á•¹½µ•ÍÑ¥1½¥¸¡Í½ÕÉ•%¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‘½µ•ÍÑ¥Œµ±½¥¸é±•…Èˆ°€¡}•Ù•¹Ð°Í½ÕÉ•%¤€ôø±•…É½µ•ÍÑ¥1½¥¸¡Í½ÕÉ•%¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰½¹™¥œéÍ…Ù”ˆ°…Íå¹Œ€¡}•Ù•¹Ð°½¹™¥œ¤€ôøì(€€€½¹ÍÐ¹•áÐ€ôì(€€€€€…ÁÁ-•äèMÑÉ¥¹œ¡½¹™¥œ¹…ÁÁ-•äñð€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€…Á¥	…Í•UÉ°èMÑÉ¥¹œ¡½¹™¥œ¹…Á¥	…Í•UÉ°ñð€‰¡ÑÑÁÌè¼½½Á•¸¹Á½¥é½¸¹½´ˆ¤¹ÑÉ¥´ ¤°(€€€€€Á½¥é½¹1½¥¹%èMÑÉ¥¹œ¡½¹™¥œ¹Á½¥é½¹1½¥¹%ñð€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€¹¥­•1½¥¹%èMÑÉ¥¹œ¡½¹™¥œ¹¹¥­•1½¥¹%ñð€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€…‘¥‘…Í1½¥¹%èMÑÉ¥¹œ¡½¹™¥œ¹…‘¥‘…Í1½¥¹%ñð€ˆˆ¤¹ÑÉ¥´ ¤°(€€€ôì(€€€¥˜€¡½¹™¥œ¹…ÁÁM•É•Ð¤¹•áÐ¹…ÁÁM•É•Ñ¹ÉåÁÑ•€ô•¹ÉåÁÑ•¡½¹™¥œ¹…ÁÁM•É•Ð¤ì(€€€¥˜€¡½¹™¥œ¹…•ÍÍQ½­•¸¤¹•áÐ¹…•ÍÍQ½­•¹¹ÉåÁÑ•€ô•¹ÉåÁÑ•¡½¹™¥œ¹…•ÍÍQ½­•¸¤ì(€€€¥˜€¡½¹™¥œ¹Á½¥é½¹A…ÍÍÝ½É¤¹•áÐ¹Á½¥é½¹A…ÍÍÝ½É‘¹ÉåÁÑ•€ô•¹ÉåÁÑ•¡½¹™¥œ¹Á½¥é½¹A…ÍÍÝ½É¤ì(€€€¥˜€¡½¹™¥œ¹¹¥­•A…ÍÍÝ½É¤¹•áÐ¹¹¥­•A…ÍÍÝ½É‘¹ÉåÁÑ•€ô•¹ÉåÁÑ•¡½¹™¥œ¹¹¥­•A…ÍÍÝ½É¤ì(€€€¥˜€¡½¹™¥œ¹…‘¥‘…ÍA…ÍÍÝ½É¤¹•áÐ¹…‘¥‘…ÍA…ÍÍÝ½É‘¹ÉåÁÑ•€ô•¹ÉåÁÑ•¡½¹™¥œ¹…‘¥‘…ÍA…ÍÍÝ½É¤ì(€€€¥˜€¡ÑåÁ•½˜½¹™¥œ¹±•‘•É]•‰¡½½­UÉ°€ôôô€‰ÍÑÉ¥¹œˆ¤¹•áÐ¹±•‘•É]•‰¡½½­UÉ°€ô½¹™¥œ¹±•‘•É]•‰¡½½­UÉ°¹ÑÉ¥´ ¤ì(€€€¥˜€¡½¹™¥œ¹±•‘•ÉM•É•Ð¤¹•áÐ¹±•‘•ÉM•É•Ñ¹ÉåÁÑ•€ô•¹ÉåÁÑ•¡½¹™¥œ¹±•‘•ÉM•É•Ð¤ì(€€€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡¹•áÐ¤ì(€€€É•ÑÕÉ¸ÁÕ‰±¥½¹™¥œ ¤ì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰±•‘•Èé½Á•¸µµÕÍ¥¹Í„ˆ°€ ¤€ôø½Á•¹5ÕÍ¥¹Í…1•‘•É]¥¹‘½Ü ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰±•‘•Èé…ÁÑÕÉ”µµÕÍ¥¹Í„ˆ°€ ¤€ôø…ÁÑÕÉ•5ÕÍ¥¹Í…1•‘•É=É‘•È ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰±•‘•ÈéÍå¹Œˆ°€¡}•Ù•¹Ð°¥¹ÁÕÐ¤€ôøÍå¹AÕÉ¡…Í•1•‘•È¡¥¹ÁÕÐ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰•áÁ±½É•Èéµ•Ñ„ˆ°…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÍ•ÑÑ¥¹Ì€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ìì(€€€½¹ÍÐ…¡•€ôÍ•ÑÑ¥¹Ì¹‰É…¹‘…Ñ…±½œì(€€€½¹ÍÐ‰É…¹‘Ì€ôÉÉ…ä¹¥ÍÉÉ…ä¡…¡•¤€˜˜…¡•¹±•¹Ñ €ü…¡•€è•áÁ±½É•É5•Ñ…‘…Ñ„ ¤¹‰É…¹‘Ìì(€€€€¼¼	É…¹Í•±•Ñ¥½¸µÕÍÐÉ•µ…¥¸…Ù…¥±…‰±”•Ù•¸Ý¡•¸Ñ¡”µÕ ±…É•È½™™¥¥…°(€€€€¼¼‘½µ…¥¸É•¥ÍÑÉä…¹¹½Ð‰”Á•ÉÍ¥ÍÑ•½ÈÉ•™É•Í¡•¸(€€€½¹ÍÐ½™™¥¥…±	É…¹‘I•¥ÍÑÉä€ôÍ…™•=™™¥¥…±½µ…¥¹I•¥ÍÑÉä¡‰É…¹‘Ì¤ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹•áÁ±½É•É5•Ñ…‘…Ñ„ ¤°(€€€€€‰É…¹‘ÌèÁÉ¥½É¥Ñ¥é•	É…¹‘…Ñ…±½	åM…±•Ì (€€€€€€€ÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹ÁÉ½‘ÕÑÌ°(€€€€€€€‰É…¹‘Í]¥Ñ¡=™™¥¥…±½µ…¥¹MÑ…ÑÕÌ¡‰É…¹‘Ì°½™™¥¥…±	É…¹‘I•¥ÍÑÉä¤°(€€€€€€€€ÈÀÀ(€€€€€€¤°(€€€€€½™™¥¥…±½µ…¥¹MÕµµ…Éäè½™™¥¥…±½µ…¥¹I•¥ÍÑÉåMÕµµ…Éä¡½™™¥¥…±	É…¹‘I•¥ÍÑÉä¤°(€€€€€½™™¥¥…±½µ…¥¹Õ‘¥Ðè½™™¥¥…±½µ…¥¹Õ‘¥ÑM¹…ÁÍ¡½Ð¡½™™¥¥…±	É…¹‘I•¥ÍÑÉä¤°(€€€€€‰É…¹‘…Ñ…±½UÁ‘…Ñ•‘ÐèMÑÉ¥¹œ¡Í•ÑÑ¥¹Ì¹‰É…¹‘…Ñ…±½UÁ‘…Ñ•‘Ðñð€ˆˆ¤°(€€€€€¹••‘Í	É…¹‘Må¹Œè‰É…¹‘…Ñ…±½9••‘ÍMå¹Œ¡…¡•°Í•ÑÑ¥¹Ì¹‰É…¹‘…Ñ…±½UÁ‘…Ñ•‘Ð¤°(€€€€€™Õ±±	É…¹‘5¥¹¥µÕ´èU11}	I9}Q1=}5%9%5U4°(€€€ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰•áÁ±½É•ÈéÍå¹Œµ‰É…¹‘Ìˆ°…Íå¹Œ€ ¤€ôøì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰•áÁ±½É•Èé‰É…¹µÁÉ½É•ÍÌˆ°ìÁ•É•¹Ðè€ÄÀ°½Õ¹Ðè€Àô¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÍå¹	É…¹‘…Ñ…±½É½µ-ÉA½¥é½¸ ¤ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰•áÁ±½É•Èé‰É…¹µÁÉ½É•ÍÌˆ°ì(€€€€€Á•É•¹ÐèÉ•ÍÕ±Ð¹½¬€ü€ÄÀÀ€è€À°(€€€€€½Õ¹ÐèÉ•ÍÕ±Ð¹½¬€üÉ•ÍÕ±Ð¹‰É…¹‘Ì¹±•¹Ñ €è€À°(€€€ô¤ì(€€€¥˜€¡É•ÍÕ±Ð¹½¬¤É•ÑÕÉ¸É•ÍÕ±Ðì(€€€½¹ÍÐÍ•ÑÑ¥¹Ì€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ìì(€€€½¹ÍÐÁÉ•Í•ÉÙ•€ôÉÉ…ä¹¥ÍÉÉ…ä¡Í•ÑÑ¥¹Ì¹‰É…¹‘…Ñ…±½œ¤€˜˜Í•ÑÑ¥¹Ì¹‰É…¹‘…Ñ…±½œ¹±•¹Ñ (€€€€€€üÍ•ÑÑ¥¹Ì¹‰É…¹‘…Ñ…±½œ(€€€€€€è•áÁ±½É•É5•Ñ…‘…Ñ„ ¤¹‰É…¹‘Ìì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹É•ÍÕ±Ð°(€€€€€ÁÉ•Í•ÉÙ•‘	É…¹‘ÌèÁÉ¥½É¥Ñ¥é•	É…¹‘…Ñ…±½œ¡ÁÉ•Í•ÉÙ•¤°(€€€€€ÁÉ•Í•ÉÙ•‘½Õ¹ÐèÁÉ•Í•ÉÙ•¹±•¹Ñ °(€€€ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰½™™¥¥…°µ‘½µ…¥¸é…Õ‘¥ÐµÍÑ…ÑÕÌˆ°…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÍ•ÑÑ¥¹Ì€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ìì(€€€½¹ÍÐ‰É…¹‘Ì€ôÍ•ÑÑ¥¹Ì¹‰É…¹‘…Ñ…±½œñð•áÁ±½É•É5•Ñ…‘…Ñ„ ¤¹‰É…¹‘Ìì(€€€½¹ÍÐÉ•¥ÍÑÉä€ô…Ý…¥Ð•¹ÍÕÉ•=™™¥¥…±½µ…¥¹I•¥ÍÑÉä¡‰É…¹‘Ì¤ì(€€€É•ÑÕÉ¸½™™¥¥…±½µ…¥¹Õ‘¥ÑM¹…ÁÍ¡½Ð¡É•¥ÍÑÉä¤ì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰½™™¥¥…°µ‘½µ…¥¸é…Õ‘¥ÐµÍÑ…ÉÐˆ°…Íå¹Œ€¡}•Ù•¹Ð°½ÁÑ¥½¹Ì€ôíô¤€ôøì(€€€±•…ÉQ¥µ•½ÕÐ¡½™™¥¥…±½µ…¥¹Õ‘¥ÑI•ÍÕµ•Q¥µ•È¤ì(€€€½™™¥¥…±½µ…¥¹Õ‘¥ÑI•ÍÕµ•Q¥µ•È€ô¹Õ±°ì(€€€¥˜€ …½™™¥¥…±½µ…¥¹Õ‘¥ÑIÕ¹¹¥¹œ¤Ù½¥ÉÕ¹=™™¥¥…±½µ…¥¹Õ‘¥Ð¡ìÉ•¡•­±°è½ÁÑ¥½¹Ìü¹É•¡•­±°€ôôôÑÉÕ”ô¤ì(€€€½¹ÍÐÍ•ÑÑ¥¹Ì€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ìì(€€€½¹ÍÐÉ•¥ÍÑÉä€ô…Ý…¥Ð•¹ÍÕÉ•=™™¥¥…±½µ…¥¹I•¥ÍÑÉä¡Í•ÑÑ¥¹Ì¹‰É…¹‘…Ñ…±½œñð•áÁ±½É•É5•Ñ…‘…Ñ„ ¤¹‰É…¹‘Ì¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°…Õ‘¥Ðè½™™¥¥…±½µ…¥¹Õ‘¥ÑM¹…ÁÍ¡½Ð¡É•¥ÍÑÉä°ìÉÕ¹¹¥¹œèÑÉÕ”°ÍÑ…Ñ”è€‰ÉÕ¹¹¥¹œˆô¤ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰½™™¥¥…°µ‘½µ…¥¸é…Õ‘¥ÐµÍÑ½Àˆ°…Íå¹Œ€ ¤€ôøì(€€€½™™¥¥…±½µ…¥¹Õ‘¥ÑMÑ½ÁI•ÅÕ•ÍÑ•€ôÑÉÕ”ì(€€€½™™¥¥…±½µ…¥¹Õ‘¥Ñ‰½ÉÑÕÉÉ•¹Ðü¸ ¤ì(€€€½™™¥¥…±½µ…¥¹Õ‘¥Ñ‰½ÉÑÕÉÉ•¹Ð€ô¹Õ±°ì(€€€¥˜€¡½™™¥¥…±½µ…¥¹Õ‘¥Ñ]¥¹‘½Ü€˜˜€…½™™¥¥…±½µ…¥¹Õ‘¥Ñ]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€€€½™™¥¥…±½µ…¥¹Õ‘¥Ñ]¥¹‘½Ü¹‘•ÍÑÉ½ä ¤ì(€€€ô(€€€½™™¥¥…±½µ…¥¹Õ‘¥Ñ]¥¹‘½Ü€ô¹Õ±°ì(€€€±•…ÉQ¥µ•½ÕÐ¡½™™¥¥…±½µ…¥¹Õ‘¥ÑI•ÍÕµ•Q¥µ•È¤ì(€€€½™™¥¥…±½µ…¥¹Õ‘¥ÑI•ÍÕµ•Q¥µ•È€ô¹Õ±°ì(€€€€¼¼]…¥Ð™½ÈÑ¡”…Õ‘¥Ð±½½ÀÌ…‰½ÉÐÉ…”…¹±•…¹ÕÀ°…±±½Ý¥¹œ…¸¥µµ•‘¥…Ñ”(€€€€¼¼½¹Ñ¥¹Õ”±¥¬Ñ¼ÍÑ…ÉÐ•á…Ñ±ä½¹”É•Á±…•µ•¹ÐÝ½É­•È¸(€€€½¹ÍÐÍÑ½Á•…‘±¥¹”€ô…Ñ”¹¹½Ü ¤€¬€É|ÀÀÀì(€€€Ý¡¥±”€¡½™™¥¥…±½µ…¥¹Õ‘¥ÑIÕ¹¹¥¹œ€˜˜…Ñ”¹¹½Ü ¤€ðÍÑ½Á•…‘±¥¹”¤…Ý…¥ÐÝ…¥Ð ÈÔ¤ì(€€€½¹ÍÐÍ•ÑÑ¥¹Ì€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ìì(€€€½¹ÍÐ‰É…¹‘Ì€ôÍ•ÑÑ¥¹Ì¹‰É…¹‘…Ñ…±½œñð•áÁ±½É•É5•Ñ…‘…Ñ„ ¤¹‰É…¹‘Ìì(€€€½¹ÍÐÉ•¥ÍÑÉä€ô…Ý…¥Ð•¹ÍÕÉ•=™™¥¥…±½µ…¥¹I•¥ÍÑÉä¡‰É…¹‘Ì¤ì(€€€½¹ÍÐÍ…Ù•‘Õ‘¥Ð€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ì¹½™™¥¥…±½µ…¥¹Õ‘¥Ðñðíôì(€€€½¹ÍÐÁ…ÕÍ•‘Õ‘¥Ð€ôì(€€€€€€¸¸¹Í…Ù•‘Õ‘¥Ð°(€€€€€ÍÑ…Ñ”è€‰Á…ÕÍ•ˆ°(€€€€€ÕÉÉ•¹Ñ	É…¹è€ˆˆ°(€€€€€‰±½­•è™…±Í”°(€€€€€Á¡…Í”è€‰Á…ÕÍ•ˆ°(€€€€€ÕÁ‘…Ñ•‘Ðè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€ôì(€€€…Ý…¥ÐÁ•ÉÍ¥ÍÑ=™™¥¥…±½µ…¥¹Õ‘¥Ð¡É•¥ÍÑÉä°Á…ÕÍ•‘Õ‘¥Ð¤ì(€€€½¹ÍÐ…Õ‘¥Ð€ôÍ•¹‘=™™¥¥…±½µ…¥¹Õ‘¥ÑAÉ½É•ÍÌ¡É•¥ÍÑÉä°ì€¸¸¹Á…ÕÍ•‘Õ‘¥Ð°ÉÕ¹¹¥¹œè™…±Í”ô¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°…Õ‘¥Ðôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰Ý••­±äµÍ¥Ñ”µ¡•…±Ñ éÍÑ…ÑÕÌˆ°€ ¤€ôøÍ•¹‘]••­±åM¥Ñ•!•…±Ñ¡MÑ…ÑÕÌ ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰Ý••­±äµÍ¥Ñ”µ¡•…±Ñ éÉÕ¸ˆ°€ ¤€ôøÉÕ¹]••­±åM¥Ñ•!•…±Ñ¡¡•¬¡ìµ…¹Õ…°èÑÉÕ”ô¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰Í•±±•Èé½Á•¸ˆ°€ ¤€ôøì(€€€½Á•¹M•±±•É•¹Ñ•É]¥¹‘½Ü ¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰Í•±±•Èé½Á•¸µÁÉ½‘ÕÐµÍ•…É ˆ°…Íå¹Œ€ ¤€ôøì(€€€¥˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€€€½Á•¹M•±±•É•¹Ñ•É]¥¹‘½Ü¡M11I}9QI}UI0¤ì(€€€ô•±Í”ì(€€€€€Í•±±•É]¥¹‘½Ü¹Í¡½Ü ¤ì(€€€€€Í•±±•É]¥¹‘½Ü¹™½ÕÌ ¤ì(€€€ô(€€€É•ÑÕÉ¸ì½¬è…Ý…¥Ð•¹Ñ•ÉM•±±•ÉAÉ½‘ÕÑM•…É¡Y¥…5•¹Ô ¤ôì(€ô¤ì(€½¹ÍÐ…‰½ÉÑM•±±•É	É…¹‘áÁ½ÉÑÑÑ•µÁÐ€ô…Íå¹Œ€ ¤€ôøì(€‰É…¹‘áÁ½ÉÑÑÑ•µÁÑ•¹•É…Ñ¥½¸€¬ô€Äì(€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ô€ˆˆì(€Í•±±•ÉAÉ½‘ÕÑÉ…µ•I½ÕÑ¥¹%€ô¹Õ±°ì(€ÑÉäì(€€€Í•±±•É]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹ÍÑ½À ¤ì(€€€¥˜€¡Í•±±•É]¥¹‘½Ü€˜˜€…Í•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€€€Í•±±•É]¥¹‘½Ü¹¡¥‘” ¤ì(€€€ô(€ô…Ñ íô(€Í¡½Ý½±±•Ñ½É]¥¹‘½Ü ¤ì(€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì(€ôì(€¥Á5…¥¸¹¡…¹‘±” ‰Í•±±•Èé‰É…¹µ•áÁ½ÉÐˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ¤€ôøì(€€€±•ÐÑ¥µ•½ÕÐì(€€€½¹ÍÐÑ¥µ•‘=ÕÐ€ô¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøì(€€€€€Ñ¥µ•½ÕÐ€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôøÉ•Í½±Ù”¡ì(€€€€€€€½¬è™…±Í”°(€€€€€€€½‘”è€‰	I9}UQ=5Q%=9}Q%5=UPˆ°(€€€€€€€µ•ÍÍ…”è€‘íMÑÉ¥¹œ¡¥¹ÁÕÐü¹‰É…¹‘9…µ”ñð€‹²ƒ¶tƒ®â3®zs®Npˆ¥ôƒ²zG²^²vÐ€ÈÃ®Úƒ²V#²^@ƒ®w®
c²ž ƒ²V+²VƒªÂW²‚pƒ²Š®Ž3¶Z#²*×®.#®.¸ƒ®.“²v0ƒ®â3®zs®Ns®†pƒ²vÓ®>g¶V§®.#®.¹€°(€€€€€ô¤°M11I}	I9}aA=IQ}!I}Q%5=UQ}5L¤ì(€€€ô¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐAÉ½µ¥Í”¹É…”¡m…ÕÑ½µ…Ñ•M•±±•É	É…¹‘áÁ½ÉÐ¡¥¹ÁÕÐ¤°Ñ¥µ•‘=ÕÑt¤ì(€€€±•…ÉQ¥µ•½ÕÐ¡Ñ¥µ•½ÕÐ¤ì(€€€¥˜€¡É•ÍÕ±Ðü¹½‘”€ôôô€‰	I9}UQ=5Q%=9}Q%5=UPˆ¤ì(€€€€€…Ý…¥Ð…‰½ÉÑM•±±•É	É…¹‘áÁ½ÉÑÑÑ•µÁÐ ¤ì(€€€€€É•ÑÕÉ¸ì€¸¸¹É•ÍÕ±Ð°…‰½ÉÑ•èÑÉÕ”ôì(€€€ô(€€€É•ÑÕÉ¸É•ÍÕ±Ðì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰Í•±±•Èé‰•¥¸µ‰É…¹µÍ•…É µÍ•ÍÍ¥½¸ˆ°…Íå¹Œ€ ¤€ôøì(€€€€¼¼±¥¬½¸€‹®â3®zs®NpƒªÊ²$ˆ…±Ý…åÌÍÑ…ÉÑÌ„¹•ÜA=%i=8•áÁ½ÉÐÉ•ÅÕ•ÍÐ¸(€€€€¼¼-••ÀÑ¡”Í…Ù•…¡”½¹±ä…Ì„‰…Í•±¥¹”Í¼…¸½±©½ˆ¹Õµ‰•È…¸¹•Ù•È(€€€€¼¼‰”±…¥µ•‰äÑ¡¥ÌÉÕ¸°Ý¡¥±”±•…É¥¹œ…Ñ¥Ù”µ½¹¥Ñ½É¥¹œÍÑ…Ñ”Ñ¡…Ð(€€€€¼¼‰•±½¹ÌÑ¼Ñ¡”ÁÉ•Ù¥½ÕÌ½µÁ±•Ñ•ÉÕ¸¸(€€€‰É…¹‘]½É­M•ÍÍ¥½¹•¹•É…Ñ¥½¸€¬ô€Äì(€€€‰É…¹‘áÁ½ÉÑÑÑ•µÁÑ•¹•É…Ñ¥½¸€¬ô€Äì(€€€‰É…¹‘áÁ½ÉÑ)½‰Ì¹±•…È ¤ì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ô€ˆˆì(€€€‰É…¹‘½Ý¹±½…‘MÑ…ÉÑ•€ô™…±Í”ì(€€€…Ñ¥Ù•	É…¹‘½Ý¹±½…‘)½‰%€ô€ˆˆì(€€€‰É…¹‘áÁ½ÉÑ±±½µÁ±•Ñ•M•¹Ð€ô™…±Í”ì(€€€±…ÍÑ	É…¹‘áÁ½ÉÑM¥¹…ÑÕÉ”€ô€‰}}9]}	I9}MI!}MMM%=9}|ˆì(€€€¥˜€¡‰É…¹‘áÁ½ÉÑ5½¹¥Ñ½ÉI•ÍÑ…ÉÑQ¥µ•È¤ì(€€€€€±•…ÉQ¥µ•½ÕÐ¡‰É…¹‘áÁ½ÉÑ5½¹¥Ñ½ÉI•ÍÑ…ÉÑQ¥µ•È¤ì(€€€€€‰É…¹‘áÁ½ÉÑ5½¹¥Ñ½ÉI•ÍÑ…ÉÑQ¥µ•È€ô¹Õ±°ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€½¬èÑÉÕ”°(€€€€€Í•ÍÍ¥½¹•¹•É…Ñ¥½¸è‰É…¹‘]½É­M•ÍÍ¥½¹•¹•É…Ñ¥½¸°(€€€€€¡¥ÍÑ½É¥…±)½‰½Õ¹ÐèÍ…Ù•‘	É…¹‘áÁ½ÉÑ)½‰Ì ¤¹±•¹Ñ °(€€€ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰Í•±±•Èé…‰½ÉÐµ‰É…¹µ•áÁ½ÉÐµ…ÑÑ•µÁÐˆ°…‰½ÉÑM•±±•É	É…¹‘áÁ½ÉÑÑÑ•µÁÐ¤ì((€¥Á5…¥¸¹¡…¹‘±” ‰Í•±±•ÈéÍÑ½Àµ‰É…¹µÝ½É¬ˆ°…Íå¹Œ€ ¤€ôøì(€€€‰É…¹‘]½É­M•ÍÍ¥½¹•¹•É…Ñ¥½¸€¬ô€Äì(€€€¥˜€¡‰É…¹‘áÁ½ÉÑ5½¹¥Ñ½ÉI•ÍÑ…ÉÑQ¥µ•È¤ì(€€€€€±•…ÉQ¥µ•½ÕÐ¡‰É…¹‘áÁ½ÉÑ5½¹¥Ñ½ÉI•ÍÑ…ÉÑQ¥µ•È¤ì(€€€€€‰É…¹‘áÁ½ÉÑ5½¹¥Ñ½ÉI•ÍÑ…ÉÑQ¥µ•È€ô¹Õ±°ì(€€€ô(€€€‰É…¹‘áÁ½ÉÑ)½‰Ì¹±•…È ¤ì(€€€‰É…¹‘áÁ½ÉÑ±±½µÁ±•Ñ•M•¹Ð€ôÑÉÕ”ì(€€€‰É…¹‘½Ý¹±½…‘MÑ…ÉÑ•€ô™…±Í”ì(€€€…Ñ¥Ù•	É…¹‘½Ý¹±½…‘)½‰%€ô€ˆˆì(€€€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡ì‰É…¹‘áÁ½ÉÑ)½‰…¡”èmtô¤ì(€€€…Ý…¥Ð…‰½ÉÑM•±±•É	É…¹‘áÁ½ÉÑÑÑ•µÁÐ ¤ì(€€€¥˜€¡Í•±±•É5½¹¥Ñ½É]¥¹‘½Ü€˜˜€…Í•±±•É5½¹¥Ñ½É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€€€Í•±±•É5½¹¥Ñ½É]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹ÍÑ½À ¤ì(€€€€€Í•±±•É5½¹¥Ñ½É]¥¹‘½Ü¹‘•ÍÑÉ½ä ¤ì(€€€ô(€€€Í•±±•É5½¹¥Ñ½É]¥¹‘½Ü€ô¹Õ±°ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°ÍÑ½ÁÁ•èÑÉÕ”ôì(€ô¤ì()¥Á5…¥¸¹¡…¹‘±” ‰Í•±±•ÈéÍÑ…ÉÐµ‰É…¹µ•áÁ½ÉÐµµ½¹¥Ñ½Èˆ°€ ¤€ôøì(€€€¥˜€¡‰É…¹‘áÁ½ÉÑ)½‰Ì¹Í¥é”€˜˜€ …Í•±±•É]¥¹‘½ÜñðÍ•±±•É]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤¤ì(€€€€€½Á•¹M•±±•É•¹Ñ•É]¥¹‘½Ü¡M11I}aA=IQ}9QI}UI0°ìÙ¥Í¥‰±”è™…±Í”ô¤ì(€€€ô(€€€¥˜€¡‰É…¹‘áÁ½ÉÑ)½‰Ì¹Í¥é”¤•¹ÍÕÉ•M•±±•É5½¹¥Ñ½É]¥¹‘½Ü ¤ì(€€€Í¡•‘Õ±•	É…¹‘áÁ½ÉÑ5½¹¥Ñ½È À¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°©½‰Ìè‰É…¹‘áÁ½ÉÑ)½‰Ì¹Í¥é”ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰Í•±±•ÈéÝ…¥Ðµ‰É…¹µ•áÁ½ÉÐµ½µÁ±•Ñ”ˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ€ôíô¤€ôøì(€€€½¹ÍÐ©½‰%€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹©½‰%ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÍ•ÍÍ¥½¹•¹•É…Ñ¥½¸€ô‰É…¹‘]½É­M•ÍÍ¥½¹•¹•É…Ñ¥½¸ì(€€€½¹ÍÐÑ¥µ•½ÕÑ5Ì€ô5…Ñ ¹µ¥¸ (€€€€€M11I}	I9}aA=IQ}!I}Q%5=UQ}5L°(€€€€€5…Ñ ¹µ…à ÌÁ|ÀÀÀ°9Õµ‰•È¡¥¹ÁÕÐ¹Ñ¥µ•½ÕÑ5Ì¤ñðM11I}	I9}aA=IQ}!I}Q%5=UQ}5L¤°(€€€€¤ì(€€€½¹ÍÐÍÑ…ÉÑ•‘Ð€ô…Ñ”¹¹½Ü ¤ì(€€€¥˜€ …©½‰%¤É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰)=	}%}5%MM%9ˆôì(€€€Í¡•‘Õ±•	É…¹‘áÁ½ÉÑ5½¹¥Ñ½È À¤ì(€€€Ý¡¥±”€¡‰É…¹‘áÁ½ÉÑ)½‰Ì¹¡…Ì¡©½‰%¤¤ì(€€€€€¥˜€¡Í•ÍÍ¥½¹•¹•É…Ñ¥½¸€„ôô‰É…¹‘]½É­M•ÍÍ¥½¹•¹•É…Ñ¥½¸¤ì(€€€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰	I9}MMM%=9}!9ˆ°ÍÑ½ÁÁ•èÑÉÕ”ôì(€€€€€ô(€€€€€¥˜€¡…Ñ”¹¹½Ü ¤€´ÍÑ…ÉÑ•‘Ð€øôÑ¥µ•½ÕÑ5Ì¤ì(€€€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è€‰	I9}=]91=}Q%5=UPˆ°©½‰%ôì(€€€€€ô(€€€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€Å|ÀÀÀ¤¤ì(€€€ô(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”°½µÁ±•Ñ•èÑÉÕ”°©½‰%ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰É…¹µ•áÁ½ÉÐéÁ•¹‘¥¹œµ©½‰Ìˆ°€ ¤€ôøÉ•ÍÑ½É•A•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰Ì ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰É…¹µ•áÁ½ÉÐé½Á•¸µ™¥±”ˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ€ôíô¤€ôøì(€€€½¹ÍÐ™¥±•A…Ñ €ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹Á…Ñ ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …™¥±•A…Ñ ¤É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹²^Ðƒ¶23²vðƒªÊ÷®†sªÂ ƒ²^²*×®.#®.¸ˆôì(€€€½Á•¹%¹Ù•¹Ñ½Éå]¥¹‘½Ü¡™¥±•A…Ñ °MÑÉ¥¹œ¡¥¹ÁÕÐ¹‰É…¹ñð€ˆˆ¤¹ÑÉ¥´ ¤¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰É…¹µ•áÁ½ÉÐéÉ•Ù•…°µ™¥±”ˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ€ôíô¤€ôøì(€€€½¹ÍÐ™¥±•A…Ñ €ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹Á…Ñ ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …™¥±•A…Ñ ¤É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹¶23²vðƒªÊ÷®†sªÂ ƒ²^²*×®.#®.¸ˆôì(€€€Í¡•±°¹Í¡½Ý%Ñ•µ%¹½±‘•È¡™¥±•A…Ñ ¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰É…¹µ•áÁ½ÉÐé½Á•¸µ½É¥¥¹…°ˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ€ôíô¤€ôøì(€€€½¹ÍÐ™¥±•A…Ñ €ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹Á…Ñ ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …™¥±•A…Ñ ¤É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è€‹¶23²vðƒªÊ÷®†sªÂ ƒ²^²*×®.#®.¸ˆôì(€€€½¹ÍÐ•ÉÉ½È€ô…Ý…¥ÐÍ¡•±°¹½Á•¹A…Ñ ¡™¥±•A…Ñ ¤ì(€€€É•ÑÕÉ¸•ÉÉ½È€üì½¬è™…±Í”°µ•ÍÍ…”è•ÉÉ½Èô€èì½¬èÑÉÕ”ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰•á•°éÁÉ•Ù¥•Üˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ€ôíô¤€ôøì(€€€ÑÉäì(€€€€€É•ÑÕÉ¸…Ý…¥ÐÁÉ•Ù¥•Ýá•±¥±”¡¥¹ÁÕÐ¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¤ôì(€€€ô(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰É…¹µ•áÁ½ÉÐé±¥ÍÐµ™¥±•Ìˆ°€ ¤€ôø±¥ÍÑ	É…¹‘áÁ½ÉÑ¥±•Ì ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰É…¹µ•áÁ½ÉÐéÑÉ…Í µ™¥±•Ìˆ°…Íå¹Œ€¡}•Ù•¹Ð°Á…Ñ¡Ì€ômt¤€ôøì(€€€½¹ÍÐÉ•ÅÕ•ÍÑ•€ôl¸¸¹¹•ÜM•Ð ¡ÉÉ…ä¹¥ÍÉÉ…ä¡Á…Ñ¡Ì¤€üÁ…Ñ¡Ì€èmt¤¹µ…À ¡Ù…±Õ”¤€ôøMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤¤¹™¥±Ñ•È¡	½½±•…¸¤¥t¹Í±¥” À°€ÔÀÀ¤ì(€€€½¹ÍÐÉ½½Ð€ôÉ•Í½±Ù”¡ÕÉÉ•¹Ñ	É…¹‘áÁ½ÉÑ½±‘•È ¤¤ì(€€€±•Ð‘•±•Ñ•€ô€Àì(€€€½¹ÍÐ™…¥±•€ômtì(€€€™½È€¡½¹ÍÐÉ•ÅÕ•ÍÑ•‘A…Ñ ½˜É•ÅÕ•ÍÑ•¤ì(€€€€€½¹ÍÐÑ…É•Ð€ôÉ•Í½±Ù”¡É•ÅÕ•ÍÑ•‘A…Ñ ¤ì(€€€€€½¹ÍÐ¹•ÍÑ•€ôÉ•±…Ñ¥Ù”¡É½½Ð°Ñ…É•Ð¤ì(€€€€€¥˜€ …¹•ÍÑ•ñð¹•ÍÑ•¹ÍÑ…ÉÑÍ]¥Ñ  ˆ¸¸ˆ¤ñðÉ•Í½±Ù”¡É½½Ð°¹•ÍÑ•¤€„ôôÑ…É•Ðñð€„½p¹á±Íà½¤¹Ñ•ÍÐ¡Ñ…É•Ð¤¤ì(€€€€€€€™…¥±•¹ÁÕÍ ¡ìÁ…Ñ èÉ•ÅÕ•ÍÑ•‘A…Ñ °µ•ÍÍ…”è€‹¶^#²j§®Bpá•°ƒ²‚²z”ƒ¶>Ó®6Pƒ®Â[²v`ƒ¶23²vó²z®.#®.¸ˆô¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€ÑÉäì(€€€€€€€½¹ÍÐ¥¹™¼€ô…Ý…¥ÐÍÑ…Ð¡Ñ…É•Ð¤ì(€€€€€€€¥˜€ …¥¹™¼¹¥Í¥±” ¤¤Ñ¡É½Ü¹•ÜÉÉ½È ‰á•°ƒ¶23²vó²vÐƒ²V®.g®.#®.¸ˆ¤ì(€€€€€€€…Ý…¥ÐÍ¡•±°¹ÑÉ…Í¡%Ñ•´¡Ñ…É•Ð¤ì(€€€€€€€‘•±•Ñ•€¬ô€Äì(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€™…¥±•¹ÁÕÍ ¡ìÁ…Ñ èÉ•ÅÕ•ÍÑ•‘A…Ñ °µ•ÍÍ…”è•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¤ô¤ì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€½¬è™…¥±•¹±•¹Ñ €ôôô€À°(€€€€€‘•±•Ñ•°(€€€€€™…¥±•°(€€€€€µ•ÍÍ…”è™…¥±•¹±•¹Ñ €ü€‘í‘•±•Ñ•‘÷ªÂpƒ²
·²‚pƒ
Ü€‘í™…¥±•¹±•¹Ñ¡÷ªÂpƒ².“¶2¡€€è€ˆˆ°(€€€ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰É…¹µ•áÁ½ÉÐé±•…ÈµÍ•ÍÍ¥½¸ˆ°…Íå¹Œ€ ¤€ôøì(€€€‰É…¹‘]½É­M•ÍÍ¥½¹•¹•É…Ñ¥½¸€¬ô€Äì(€€€‰É…¹‘áÁ½ÉÑ)½‰Ì¹±•…È ¤ì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ9…µ”€ô€ˆˆì(€€€Á•¹‘¥¹	É…¹‘áÁ½ÉÑ)½‰%€ô€ˆˆì(€€€…Ñ¥Ù•	É…¹‘½Ý¹±½…‘)½‰%€ô€ˆˆì(€€€‰É…¹‘áÁ½ÉÑ)½‰A•¹‘¥¹œ€ô™…±Í”ì(€€€‰É…¹‘½Ý¹±½…‘MÑ…ÉÑ•€ô™…±Í”ì(€€€±…ÍÑ	É…¹‘áÁ½ÉÑM¥¹…ÑÕÉ”€ô€‰}}	M1%9}a%MQ%9}%1M}|ˆì(€€€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡ì‰É…¹‘áÁ½ÉÑ)½‰…¡”èmtô¤ì(€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÍ•ÍÍ¥½¸µ±•…É•ˆ¤ì(€€€™½È€¡½¹ÍÐ¥¹Ù•¹Ñ½Éå]¥¹‘½Ü½˜¥¹Ù•¹Ñ½Éå]¥¹‘½ÝÌ¤ì(€€€€€¥˜€ …¥¹Ù•¹Ñ½Éå]¥¹‘½Ü¹¥Í•ÍÑÉ½å• ¤¤ì(€€€€€€€¥¹Ù•¹Ñ½Éå]¥¹‘½Ü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰‰É…¹µ•áÁ½ÉÐéÍ•ÍÍ¥½¸µ±•…É•ˆ¤ì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰É…¹µ•áÁ½ÉÐéÍ•±•Ðµ™½±‘•Èˆ°…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð‘¥…±½œ¹Í¡½Ý=Á•¹¥…±½œ¡ì(€€€€€ÁÉ½Á•ÉÑ¥•Ìèl‰½Á•¹¥É•Ñ½Éäˆ°€‰É•…Ñ•¥É•Ñ½Éä‰t°(€€€€€‘•™…Õ±ÑA…Ñ èÕÉÉ•¹Ñ	É…¹‘áÁ½ÉÑ½±‘•È ¤°(€€€ô¤ì(€€€¥˜€¡É•ÍÕ±Ð¹…¹•±•ñð€…É•ÍÕ±Ð¹™¥±•A…Ñ¡ÍlÁt¤É•ÑÕÉ¸ì…¹•±•èÑÉÕ”ôì(€€€½¹ÍÐ™½±‘•È€ôÉ•ÍÕ±Ð¹™¥±•A…Ñ¡ÍlÁtì(€€€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡ì‰É…¹‘áÁ½ÉÑ½±‘•Èè™½±‘•Èô¤ì(€€€±…ÍÑ	É…¹‘áÁ½ÉÑM¥¹…ÑÕÉ”€ô€‰}}	M1%9}a%MQ%9}%1M}|ˆì(€€€ÍÑ…ÉÑ	É…¹‘áÁ½ÉÑ½±‘•ÉA½±±¥¹œ ¤ì(€€€É•ÑÕÉ¸ì…¹•±•è™…±Í”°™½±‘•Èôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰É…¹µ•áÁ½ÉÐé•Ðµ™½±‘•Èˆ°€ ¤€ôø€¡ì(€€€™½±‘•ÈèÕÉÉ•¹Ñ	É…¹‘áÁ½ÉÑ½±‘•È ¤°(€ô¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‰É…¹µ•áÁ½ÉÐéÍÑ…ÉÐµ™½±‘•ÈµÁ½±±¥¹œˆ°€ ¤€ôøì(€€€ÍÑ…ÉÑ	É…¹‘áÁ½ÉÑ½±‘•ÉA½±±¥¹œ ¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰Í•±±•Èé…ÁÑÕÉ”ˆ°€ ¤€ôø…ÁÑÕÉ•M•±±•É•¹Ñ•ÉAÉ½‘ÕÑÌ ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰•á•°éÍÑ…”µÁ½ÁÕ±…ÈµÁÉ½‘ÕÑÌˆ°…Íå¹Œ€¡}•Ù•¹Ð°ÁÉ½‘ÕÑÌ¤€ôøì(€€€ÑÉäì(€€€€€½¹ÍÐ±¥µ¥Ð€ô€ÈÀÀì(€€€€€½¹ÍÐ‰•™½É•á•°€ôÁ½ÁÕ±…É½µÁ±•Ñ•¹•ÍÌ¡ÁÉ½‘ÕÑÌ°±¥µ¥Ð¤ì(€€€€€¥˜€ …‰•™½É•á•°¹½µÁ±•Ñ”¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€½¬è™…±Í”°(€€€€€€€€€½‘”è€‰A=AU1I}a1}%9=5A1Qˆ°(€€€€€€€€€µ¥ÍÍ¥¹œè‰•™½É•á•°¹µ¥ÍÍ¥¹I…¹­Ì°(€€€€€€€€€µ•ÍÍ…”èƒ²vãªâÃ²¶J €‘í‰•™½É•á•°¹…ÁÑÕÉ•‘ô¼‘í±¥µ¥Ñ÷ªÂs®ž0ƒ¶fW²vã®Bc²ZÐƒ®Ú#²f²‚¶Vpá•³²v ƒ²‚²z—¶Vc²ž ƒ²V+²*×®.#®.¹€°(€€€€€€€ôì(€€€€€ô(€€€€€½¹ÍÐÍ±½ÑÌ€ôÉ•…Ñ•A½ÁÕ±…ÉM±½ÑÌ¡ÁÉ½‘ÕÑÌ°±¥µ¥Ð¤ì(€€€€€½¹ÍÐ™½±‘•È€ô½¹•É¥Ù•A½ÁÕ±…ÉáÁ½ÉÑ½±‘•È ¤(€€€€€€€ñð©½¥¸¡…ÁÀ¹•ÑA…Ñ  ‰‘•Í­Ñ½Àˆ¤°€‰É½Õ¹A=%i=8ˆ¤ì(€€€€€…Ý…¥Ðµ­‘¥È¡™½±‘•È°ìÉ•ÕÉÍ¥Ù”èÑÉÕ”ô¤ì(€€€€€½¹ÍÐÍÑ…µÀ€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹É•Á±…” ½l´ét½œ°€ˆˆ¤¹É•Á±…” ‰Pˆ°€ˆ´ˆ¤¹Í±¥” À°€ÄÔ¤ì(€€€€€½¹ÍÐ™¥±•A…Ñ €ô©½¥¸¡™½±‘•È°A=%i=8·²vãªâÃ²¶J ·²nC®Îà´‘íÍÑ…µÁô¹á±Íá€¤ì(€€€€€½¹ÍÐ‘…Ñ„€ôÁ½ÁÕ±…ÉM±½ÑÍQ½á•±…Ñ„¡Í±½ÑÌ¤ì(€€€€€…Ý…¥ÐÝÉ¥Ñ•a±Íá¥±”¡‘…Ñ„°ì(€€€€€€€Í¡••Ðè€‰A=%i=9}I\ˆ°(€€€€€€€ÍÑ¥­åI½ÝÍ½Õ¹Ðè€Ä°(€€€€€€€½±Õµ¹Ìèl(€€€€€€€€€ìÝ¥‘Ñ è€àô°ìÝ¥‘Ñ è€ÐØô°ìÝ¥‘Ñ è€ÈÀô°ìÝ¥‘Ñ è€ÔÐô°ìÝ¥‘Ñ è€Äàô°(€€€€€€€€€ìÝ¥‘Ñ è€ÄÔô°ìÝ¥‘Ñ è€ÄÔô°ìÝ¥‘Ñ è€ÄÔô°ìÝ¥‘Ñ è€ÐÈô°ìÝ¥‘Ñ è€ÄÈô°(€€€€€€€t°(€€€€€ô¤¹Ñ½¥±”¡™¥±•A…Ñ ¤ì((€€€€€½¹ÍÐÉ½ÝÌ€ô…Ý…¥ÐÉ•…‘M¡••Ð¡…Ý…¥ÐÉ•…‘¥±”¡™¥±•A…Ñ ¤°€‰A=%i=9}I\ˆ¤ì(€€€€€½¹ÍÐ¥µÁ½ÉÑ•€ô•á•±I½ÝÍQ½A½ÁÕ±…ÉAÉ½‘ÕÑÌ¡É½ÝÌ¤ì(€€€€€½¹ÍÐ…™Ñ•Éá•°€ôÁ½ÁÕ±…É½µÁ±•Ñ•¹•ÍÌ¡¥µÁ½ÉÑ•°±¥µ¥Ð¤ì(€€€€€¥˜€ ……™Ñ•Éá•°¹½µÁ±•Ñ”¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€½¬è™…±Í”°(€€€€€€€€€½‘”è€‰A=AU1I}a1}I=U9QI%A}%9=5A1Qˆ°(€€€€€€€€€Á…Ñ è™¥±•A…Ñ °(€€€€€€€€€µ¥ÍÍ¥¹œè…™Ñ•Éá•°¹µ¥ÍÍ¥¹I…¹­Ì°(€€€€€€€€€µ•ÍÍ…”èá•°ƒ²z³ªÊ²štƒªÊÃªÎð€‘í…™Ñ•Éá•°¹…ÁÑÕÉ•‘ô¼‘í±¥µ¥Ñ÷ªÂs®ž0ƒ¶fW²vã®Bc²ZÐƒ®ª§®†w²^@ƒ®Âc²b¶Vc²ž ƒ²V+²*×®.#®.¹€°(€€€€€€€ôì(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€€€€€½¬èÑÉÕ”°(€€€€€€€Á…Ñ è™¥±•A…Ñ °(€€€€€€€ÁÉ½‘ÕÑÌè¥µÁ½ÉÑ•°(€€€€€€€¥µÁ½ÉÑ•è¥µÁ½ÉÑ•¹™¥±Ñ•È ¡ÁÉ½‘ÕÐ¤€ôø€…ÁÉ½‘ÕÐ¹µ¥ÍÍ¥¹I…¹¬¤¹±•¹Ñ °(€€€€€€€µ¥ÍÍ¥¹œè¥µÁ½ÉÑ•¹™¥±Ñ•È ¡ÁÉ½‘ÕÐ¤€ôøÁÉ½‘ÕÐ¹µ¥ÍÍ¥¹I…¹¬¤¹µ…À ¡ÁÉ½‘ÕÐ¤€ôøÁÉ½‘ÕÐ¹É…¹¬¤°(€€€€€ôì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¤ôì(€€€ô(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰Á½ÁÕ±…ÈéÝ½É­™±½Üµ•Ðˆ°€ ¤€ôøì(€€€½¹ÍÐÍ•ÑÑ¥¹Ì€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ìì(€€€É•ÑÕÉ¸ì(€€€€€Á•É¥½èÍ•ÑÑ¥¹Ì¹Á½ÁÕ±…ÉA•É¥½ñð€‰Ý••¬ˆ°(€€€€€½µÁ…É”èÍ•ÑÑ¥¹Ì¹Á½ÁÕ±…É½µÁ…É”ñð€‰Ý••¬ˆ°(€€€€€Õ¹¥ÐèÍ•ÑÑ¥¹Ì¹Á½ÁÕ±…ÉU¹¥Ðñð€‰MATˆ°(€€€€€±¥µ¥Ðè€ÈÀÀ°(€€€€€É•µ¥¹‘•Èè™…±Í”°(€€€€€±…ÍÑMå¹ÐèÍ•ÑÑ¥¹Ì¹Á½ÁÕ±…É1…ÍÑMå¹Ðñð€ˆˆ°(€€€ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰Á½ÁÕ±…ÈéÝ½É­™±½ÜµÍ…Ù”ˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ¤€ôøì(€€€½¹ÍÐ…±±½Ý•€ôì(€€€€€Á•É¥½è¹•ÜM•Ð¡l‰‘…äˆ°€‰Ý••¬ˆ°€‰µ½¹Ñ ˆ°€‰ÅÕ…ÉÑ•È‰t¤°(€€€€€½µÁ…É”è¹•ÜM•Ð¡l‰¹½¹”ˆ°€‰å•…Èˆ°€‰‘…äˆ°€‰Ý••¬ˆ°€‰µ½¹Ñ ‰t¤°(€€€€€Õ¹¥Ðè¹•ÜM•Ð¡l‰MATˆ°€‰M-T‰t¤°(€€€ôì(€€€½¹ÍÐ¹•áÐ€ôì(€€€€€Á½ÁÕ±…ÉA•É¥½è…±±½Ý•¹Á•É¥½¹¡…Ì¡¥¹ÁÕÐ¹Á•É¥½¤€ü¥¹ÁÕÐ¹Á•É¥½€è€‰Ý••¬ˆ°(€€€€€Á½ÁÕ±…É½µÁ…É”è…±±½Ý•¹½µÁ…É”¹¡…Ì¡¥¹ÁÕÐ¹½µÁ…É”¤€ü¥¹ÁÕÐ¹½µÁ…É”€è€‰Ý••¬ˆ°(€€€€€Á½ÁÕ±…ÉU¹¥Ðè…±±½Ý•¹Õ¹¥Ð¹¡…Ì¡¥¹ÁÕÐ¹Õ¹¥Ð¤€ü¥¹ÁÕÐ¹Õ¹¥Ð€è€‰MATˆ°(€€€€€Á½ÁÕ±…É1¥µ¥Ðè€ÈÀÀ°(€€€€€Á½ÁÕ±…ÉI•µ¥¹‘•Èè™…±Í”°(€€€ôì(€€€¥˜€¡¥¹ÁÕÐ¹µ…É­Må¹•¤¹•áÐ¹Á½ÁÕ±…É1…ÍÑMå¹Ð€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì(€€€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡¹•áÐ¤ì(€€€É•ÑÕÉ¸ì(€€€€€Á•É¥½è¹•áÐ¹Á½ÁÕ±…ÉA•É¥½°(€€€€€½µÁ…É”è¹•áÐ¹Á½ÁÕ±…É½µÁ…É”°(€€€€€Õ¹¥Ðè¹•áÐ¹Á½ÁÕ±…ÉU¹¥Ð°(€€€€€±¥µ¥Ðè¹•áÐ¹Á½ÁÕ±…É1¥µ¥Ð°(€€€€€É•µ¥¹‘•Èè¹•áÐ¹Á½ÁÕ±…ÉI•µ¥¹‘•È°(€€€€€±…ÍÑMå¹Ðè¹•áÐ¹Á½ÁÕ±…É1…ÍÑMå¹ÐñðÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ì¹Á½ÁÕ±…É1…ÍÑMå¹Ðñð€ˆˆ°(€€€ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‘½µ•ÍÑ¥ŒéÍ•…É ˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ¤€ôøì(€€€½¹ÍÐÍ•…É¡•¹•É…Ñ¥½¸€ô‘½µ•ÍÑ¥M•…É¡•¹•É…Ñ¥½¸ì(€€€½¹ÍÐÑ•¡¹¥…±]…É¹¥¹Ì€ômtì(€€€½¹ÍÐÉ•µ•µ‰•É]…É¹¥¹œ€ô€¡ÍÑ…”°•ÉÉ½È¤€ôøì(€€€€€Ñ•¡¹¥…±]…É¹¥¹Ì¹ÁÕÍ ¡ì(€€€€€€€ÍÑ…”°(€€€€€€€µ•ÍÍ…”è•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½Èñð€‹²V0ƒ²"`ƒ²^®*Pƒ²b“®–`ˆ¤°(€€€€€ô¤ì(€€€ôì(€€€ÑÉäì(€€€€€€¼¼%¹Ù•¹Ñ½Éä½Í•…É Á…•ÌµÕÍÐ‰”™•Ñ¡•™É½´Ñ¡”¹•ÑÝ½É¬™½È•Ù•Éä¹•Ü(€€€€€€¼¼É•ÅÕ•ÍÐ¸-••À½½­¥•ÌÍ¼…ÕÑ¡•¹Ñ¥…Ñ•½™™¥¥…°µµ…±°Í•ÍÍ¥½¹ÌÍÕÉÙ¥Ù”¸(€€€€€ÑÉäì(€€€€€€€…Ý…¥ÐÍ•ÍÍ¥½¸¹™É½µA…ÉÑ¥Ñ¥½¸¡=5MQ%}MI!}AIQ%Q%=8¤¹±•…É…¡” ¤ì(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€É•µ•µ‰•É]…É¹¥¹œ ‰Í•…É¡}…¡•}±•…Èˆ°•ÉÉ½È¤ì(€€€€€ô(€€€€€½¹ÍÐÍ•ÑÑ¥¹Ì€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ìì(€€€€€½¹ÍÐÁÉ½™¥±•-•ä€ô‰É…¹‘M•…É¡AÉ½™¥±•-•ä¡¥¹ÁÕÐü¹‰É…¹°¥¹ÁÕÐü¹‰É…¹‘%¤ì(€€€€€½¹ÍÐÍ•…É¡AÉ½™¥±•Ì€ôÍ•ÑÑ¥¹Ì¹‰É…¹‘M•…É¡AÉ½™¥±•Ìñðíôì(€€€€€½¹ÍÐÍ•…É¡MÑÉ…Ñ•ä€ôÍ•±•Ñ	É…¹‘M•…É¡MÑÉ…Ñ•ä¡Í•…É¡AÉ½™¥±•ÍmÁÉ½™¥±•-•åt¤ì(€€€€€½¹ÍÐ½™™¥¥…±	É…¹‘I•½É€ô½™™¥¥…±½µ…¥¹I•½É‘½É	É…¹ (€€€€€€€Í•ÑÑ¥¹Ì¹½™™¥¥…±	É…¹‘I•¥ÍÑÉä°(€€€€€€€MÑÉ¥¹œ¡¥¹ÁÕÐü¹‰É…¹ñð€ˆˆ¤¹ÑÉ¥´ ¤(€€€€€€¤ì(€€€€€€¼¼9½Éµ…±¥é”½¹”…ÐÑ¡”%A‰½Õ¹‘…ÉäÍ¼•Ù•Éä‘½Ý¹ÍÑÉ•…´Á±…Ñ™½É´°(€€€€€€¼¼Á¡åÍ¥…°­•å‰½…É¥¹ÁÕÐ°UI0‰Õ¥±‘•È°…¹‘•Ñ…¥°µÁ…”½µÁ…É¥Í½¸ÕÍ•Ì(€€€€€€¼¼Ñ¡”Í…µ”!…¸µ™É•”‘½µ•ÍÑ¥ŒÍ•…É ¥‘•¹Ñ¥Ñä¸(€€€€€½¹ÍÐÍ•…É¡ÉÑ¥±•9Õµ‰•È€ôÍ…¹¥Ñ¥é•½µ•ÍÑ¥AÉ½‘ÕÑ½‘”¡¥¹ÁÕÐü¹…ÉÑ¥±•9Õµ‰•È¤ì(€€€€€½¹ÍÐÍ•…É¡AÉ½‘ÕÑ½‘”€ôÍ…¹¥Ñ¥é•½µ•ÍÑ¥AÉ½‘ÕÑ½‘”¡¥¹ÁÕÐü¹ÁÉ½‘ÕÑ½‘”¤ì(€€€€€½¹ÍÐÍ•…É¡	É…¹€ôÍ…¹¥Ñ¥é•½µ•ÍÑ¥EÕ•Éä¡¥¹ÁÕÐü¹‰É…¹¤ì(€€€€€½¹ÍÐÍ•…É¡Q¥Ñ±”€ôÍ…¹¥Ñ¥é•½µ•ÍÑ¥EÕ•Éä¡¥¹ÁÕÐü¹Ñ¥Ñ±”¤ì(€€€€€½¹ÍÐ…±±½Ý•‘M½ÕÉ•É½ÕÁÌ€ô¹•ÜM•Ð¡l‰½™™¥¥…°ˆ°€‰µÕÍ¥¹Í„ˆ°€‰¹…Ù•Èˆ°€‰ÍÍœˆ°€‰±½ÑÑ”ˆ°€‰Á…É…±±•°ˆ°€‰É•Ñ…¥±•ÉÌ‰t¤ì(€€€€€½¹ÍÐ•¹…‰±•‘M½ÕÉ•É½ÕÁÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡¥¹ÁÕÐü¹Í½ÕÉ•É½ÕÁÌ¤(€€€€€€€€ü¥¹ÁÕÐ¹Í½ÕÉ•É½ÕÁÌ¹™¥±Ñ•È ¡É½ÕÀ¤€ôø…±±½Ý•‘M½ÕÉ•É½ÕÁÌ¹¡…Ì¡É½ÕÀ¤¤€è¹Õ±°ì(€€€€€½¹ÍÐ‘…Ñ„€ô…Ý…¥ÐÅÕ•Éå½µ•ÍÑ¥AÉ½‘ÕÑÌ¡ì(€€€€€€€ÅÕ•ÉäèÍ…¹¥Ñ¥é•½µ•ÍÑ¥EÕ•Éä¡¥¹ÁÕÐü¹ÅÕ•Éä¤°(€€€€€€€…ÉÑ¥±•9Õµ‰•ÈèÍ•…É¡ÉÑ¥±•9Õµ‰•È°(€€€€€€€ÁÉ½‘ÕÑ½‘”èÍ•…É¡AÉ½‘ÕÑ½‘”°(€€€€€€€‰É…¹èÍ•…É¡	É…¹°(€€€€€€€Ñ¥Ñ±”èÍ•…É¡Q¥Ñ±”°(€€€€€€€ÁÉ•™•ÉQ¥Ñ±”è€…MÑÉ¥¹œ¡¥¹ÁÕÐü¹¥µ…•UÉ°ñð€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€€€Ù•É¥™å1¥¹­½Õ¹ÑÌè™…±Í”°(€€€€€€€½™™¥¥…±	É…¹‘I•½É°(€€€€€€€Í•…É¡MÑÉ…Ñ•ä°(€€€€€€€•¹…‰±•‘M½ÕÉ•É½ÕÁÌ°(€€€€€ô¤ì(€€€€€¥˜€¡‘½µ•ÍÑ¥M•…É¡…¹•±•¡Í•…É¡•¹•É…Ñ¥½¸¤¤É•ÑÕÉ¸ì½¬è™…±Í”°…¹•±•èÑÉÕ”°µ•ÍÍ…”è€‹ªÊ²'²vÐƒ²’G²ž®Bc²^#²*×®.#®.¸ˆôì(€€€€€€¼¼½É”É•Ñ…¥±•ÈÉ•ÍÕ±ÑÌ…É”…ÕÑ¡½É¥Ñ…Ñ¥Ù”¸=ÁÑ¥½¹…°•¹É¥¡µ•¹ÐµÕÍÐ¹•Ù•È(€€€€€€¼¼ÑÕÉ¸„ÍÕ•ÍÍ™Õ°Í•…É ¥¹Ñ¼„™Õ±°µÉ½Ü™…¥±ÕÉ”¸(€€€€€±•Ðµ…Ñ¡•€ô‘…Ñ„ì(€€€€€ÑÉäì(€€€€€€€µ…Ñ¡•€ô…Ý…¥Ð…‘‘5…Ñ¡½¹™¥‘•¹”¡µ…Ñ¡•°¥¹ÁÕÐñðíô¤ì(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€É•µ•µ‰•É]…É¹¥¹œ ‰µ…Ñ¡}½¹™¥‘•¹”ˆ°•ÉÉ½È¤ì(€€€€€ô(€€€€€¥˜€¡¥¹ÁÕÐü¹Ù•É¥™å1¥¹­½Õ¹ÑÌ€ôôôÑÉÕ”¤ì(€€€€€€€ÑÉäì(€€€€€€€€€µ…Ñ¡•€ô…Ý…¥Ð…‘‘I•¹‘•É•‘M•…É¡½Õ¹ÑÌ (€€€€€€€€€€€µ…Ñ¡•°(€€€€€€€€€€€Í•…É¡ÉÑ¥±•9Õµ‰•È°(€€€€€€€€€€€Í•…É¡	É…¹°(€€€€€€€€€€€Í•…É¡Q¥Ñ±”°(€€€€€€€€€€€Í•…É¡•¹•É…Ñ¥½¸(€€€€€€€€€€¤ì(€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€É•µ•µ‰•É]…É¹¥¹œ ‰É•¹‘•É•‘}Í•…É¡}½Õ¹ÑÌˆ°•ÉÉ½È¤ì(€€€€€€€ô(€€€€€€€¥˜€¡‘½µ•ÍÑ¥M•…É¡…¹•±•¡Í•…É¡•¹•É…Ñ¥½¸¤¤É•ÑÕÉ¸ì½¬è™…±Í”°…¹•±•èÑÉÕ”°µ•ÍÍ…”è€‹ªÊ²'²vÐƒ²’G²ž®Bc²^#²*×®.#®.¸ˆôì(€€€€€€€ÑÉäì(€€€€€€€€€µ…Ñ¡•€ô…Ý…¥Ð…‘‘5…Ñ¡½¹™¥‘•¹”¡µ…Ñ¡•°¥¹ÁÕÐñðíô¤ì(€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€É•µ•µ‰•É]…É¹¥¹œ ‰Ù•É¥™¥•‘}µ…Ñ¡}½¹™¥‘•¹”ˆ°•ÉÉ½È¤ì(€€€€€€€ô(€€€€€€€ÑÉäì(€€€€€€€€€µ…Ñ¡•€ô…Ý…¥ÐÙ•É¥™å±±MÑ½É•Í]¥Ñ¡5ÕÍ¥¹Í…%µ…”¡µ…Ñ¡•°¥¹ÁÕÐñðíô¤ì(€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€É•µ•µ‰•É]…É¹¥¹œ ‰ÍÑ½É•}¥µ…•}Ù•É¥™¥…Ñ¥½¸ˆ°•ÉÉ½È¤ì(€€€€€€€ô(€€€€€ô(€€€€€½¹ÍÐÁÉ½‘ÕÑÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡µ…Ñ¡•ü¹ÁÉ½‘ÕÑÌ¤€üµ…Ñ¡•¹ÁÉ½‘ÕÑÌ€èmtì(€€€€€½¹ÍÐ•á…Ñ5…Ñ €ôÁÉ½‘ÕÑÌ¹Í½µ” ¡ÁÉ½‘ÕÐ¤€ôø(€€€€€€€9Õµ‰•È¡ÁÉ½‘ÕÐ¹Í¥¹…±Ìü¹½‘•M½É”ñð€À¤€ôôô€Ä(€€€€€€€€˜˜ÁÉ½‘ÕÐ¹…ÉÑ¥±•½¹™±¥Ð€„ôôÑÉÕ”(€€€€€€€€˜˜ÁÉ½‘ÕÐ¹Í¥¹…±Ìü¹½‘•½¹™±¥Ð€„ôôÑÉÕ”(€€€€€€¤ì(€€€€€±•Ð±•…É¹¥¹M…Ù•€ô™…±Í”ì(€€€€€ÑÉäì(€€€€€€€½¹ÍÐ‰É…¹‘M•…É¡AÉ½™¥±•Ì€ôÉ•½É‘	É…¹‘M•…É¡=ÕÑ½µ”¡Í•…É¡AÉ½™¥±•Ì°ì(€€€€€€€€€‰É…¹èMÑÉ¥¹œ¡¥¹ÁÕÐü¹‰É…¹ñð€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€€€€€‰É…¹‘%èMÑÉ¥¹œ¡¥¹ÁÕÐü¹‰É…¹‘%ñð€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€€€€€ÍÑÉ…Ñ•äèÍ•…É¡MÑÉ…Ñ•ä°(€€€€€€€€€•á…Ñ5…Ñ °(€€€€€€€€€É•ÍÕ±Ñ½Õ¹ÐèÁÉ½‘ÕÑÌ¹±•¹Ñ °(€€€€€€€ô¤ì(€€€€€€€…Ý…¥ÐÍÑ½É”¹Í•ÑM•ÑÑ¥¹Ì¡ì‰É…¹‘M•…É¡AÉ½™¥±•Ìô¤ì(€€€€€€€±•…É¹¥¹M…Ù•€ôÑÉÕ”ì(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€É•µ•µ‰•É]…É¹¥¹œ ‰Í•…É¡}±•…É¹¥¹}Í…Ù”ˆ°•ÉÉ½È¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€€€€€½¬èÑÉÕ”°(€€€€€€€‘…Ñ„èì(€€€€€€€€€€¸¸¹µ…Ñ¡•°(€€€€€€€€€ÁÉ½‘ÕÑÌ°(€€€€€€€€€Ñ•¡¹¥…±]…É¹¥¹Ì°(€€€€€€€€€Í•…É¡1•…É¹¥¹œèì(€€€€€€€€€€€ÍÑÉ…Ñ•äèÍ•…É¡MÑÉ…Ñ•ä°(€€€€€€€€€€€•á…Ñ5…Ñ °(€€€€€€€€€€€Í…Ù•è±•…É¹¥¹M…Ù•°(€€€€€€€€€ô°(€€€€€€€ô°(€€€€€ôì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€¥˜€¡‘½µ•ÍÑ¥M•…É¡…¹•±•¡Í•…É¡•¹•É…Ñ¥½¸¤ñð€½=5MQ%}MI!}91½¤¹Ñ•ÍÐ¡MÑÉ¥¹œ¡•ÉÉ½Èü¹µ•ÍÍ…”ñð•ÉÉ½Èñð€ˆˆ¤¤¤ì(€€€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°…¹•±•èÑÉÕ”°µ•ÍÍ…”è€‹ªÊ²'²vÐƒ²’G²ž®Bc²^#²*×®.#®.¸ˆôì(€€€€€ô(€€€€€É•ÑÕÉ¸ì½¬è™…±Í”°µ•ÍÍ…”è•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€èMÑÉ¥¹œ¡•ÉÉ½È¤ôì(€€€ô(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‘½µ•ÍÑ¥Œé…¹•°ˆ°€ ¤€ôø…¹•±½µ•ÍÑ¥M•…É¡•Ì ¤¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰‘½µ•ÍÑ¥ŒµÁÉ¥”é±½½­ÕÀˆ°€¡}•Ù•¹Ð°¥¹ÁÕÐ¤€ôøì(€€€½¹ÍÐÑ…Í¬€ô‘½µ•ÍÑ¥AÉ¥•1½½­ÕÁEÕ•Õ”¹Ñ¡•¸ (€€€€€€ ¤€ôø±½½­ÕÁ9…Ù•É½µ•ÍÑ¥AÉ¥”¡¥¹ÁÕÐ¤°(€€€€€€ ¤€ôø±½½­ÕÁ9…Ù•É½µ•ÍÑ¥AÉ¥”¡¥¹ÁÕÐ¤°(€€€€¤ì(€€€‘½µ•ÍÑ¥AÉ¥•1½½­ÕÁEÕ•Õ”€ôÑ…Í¬¹Ñ¡•¸  ¤€ôøÕ¹‘•™¥¹•°€ ¤€ôøÕ¹‘•™¥¹•¤ì(€€€É•ÑÕÉ¸Ñ…Í¬ì(€ô¤ì(€±•Ð…Ñ•½ÉåM•…É¡•¹•É…Ñ¥½¸€ô€Àì(€¥Á5…¥¸¹¡…¹‘±” ‰•áÁ±½É•Èé…¹•°µ…Ñ•½Éäˆ°€ ¤€ôøì(€€€…Ñ•½ÉåM•…É¡•¹•É…Ñ¥½¸€¬ô€Äì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰•áÁ±½É•ÈéÅÕ•Éäˆ°€¡}•Ù•¹Ð°¥¹ÁÕÐ¤€ôøì(€€€½¹ÍÐÍ•ÑÑ¥¹Ì€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤¹Í•ÑÑ¥¹Ìì(€€€½¹ÍÐ…Ñ…±½œ€ôÍ•ÑÑ¥¹Ì¹‰É…¹‘…Ñ…±½œñð•áÁ±½É•É5•Ñ…‘…Ñ„ ¤¹‰É…¹‘Ìì(€€€½¹ÍÐÉ•ÅÕ•ÍÑ•‘	É…¹‘%‘Ì€ô€¡ÉÉ…ä¹¥ÍÉÉ…ä¡¥¹ÁÕÐü¹‰É…¹‘%‘Ì¤€ü¥¹ÁÕÐ¹‰É…¹‘%‘Ì€èmt¤¹µ…À¡9Õµ‰•È¤¹™¥±Ñ•È¡9Õµ‰•È¹¥Í¥¹¥Ñ”¤ì(€€€½¹ÍÐ…Ñ…±½	å%€ô¹•Ü5…À¡…Ñ…±½œ¹µ…À ¡‰É…¹¤€ôøm9Õµ‰•È¡‰É…¹¹¥¤°‰É…¹‘t¤¤ì(€€€½¹ÍÐ…Ñ•½Éå	É…¹‘Ì€ô¥¹ÁÕÐü¹µ½‘”€ôôô€‰…Ñ•½Éäˆ(€€€€€€üÉ•ÅÕ•ÍÑ•‘	É…¹‘%‘Ì¹µ…À ¡¥¤€ôø…Ñ…±½	å%¹•Ð¡¥¤¤¹™¥±Ñ•È¡	½½±•…¸¤(€€€€€€èmtì(€€€½¹ÍÐÉ•ÅÕ•ÍÑ•¹•É…Ñ¥½¸€ô…Ñ•½ÉåM•…É¡•¹•É…Ñ¥½¸ì(€€€É•ÑÕÉ¸ÅÕ•ÉåáÁ±½É•È¡Í•É•Ñ½¹™¥œ ¤°ì(€€€€€€¸¸¹¥¹ÁÕÐ°(€€€€€‰É…¹‘%‘Ìè¥¹ÁÕÐü¹µ½‘”€ôôô€‰…Ñ•½Éäˆ€ü…Ñ•½Éå	É…¹‘Ì¹µ…À ¡‰É…¹¤€ôø‰É…¹¹¥¤€è¥¹ÁÕÐü¹‰É…¹‘%‘Ì°(€€€€€É…¹­•‘	É…¹‘½Õ¹Ðè…Ñ•½Éå	É…¹‘Ì¹±•¹Ñ °(€€€€€Í¡½Õ±‘MÑ½Àè€ ¤€ôø¥¹ÁÕÐü¹µ½‘”€ôôô€‰…Ñ•½Éäˆ€˜˜É•ÅÕ•ÍÑ•¹•É…Ñ¥½¸€„ôô…Ñ•½ÉåM•…É¡•¹•É…Ñ¥½¸°(€€€€€½¹AÉ½É•ÍÌè€¡Á…•9Õ´°Á…•½Õ¹Ð°‘•Ñ…¥°€ôíô¤€ôøì(€€€€€€€½¹ÍÐÁ•É•¹Ð€ô5…Ñ ¹µ¥¸ ÜÀ°5…Ñ ¹µ…à È°5…Ñ ¹É½Õ¹ ¡Á…•9Õ´€¼5…Ñ ¹µ…à Ä°Á…•½Õ¹Ð¤¤€¨€ÜÀ¤¤¤ì(€€€€€€€µ…¥¹]¥¹‘½Üü¹Ý•‰½¹Ñ•¹ÑÌ¹Í•¹ ‰•áÁ±½É•Èé‰É…¹µÁÉ½É•ÍÌˆ°ì(€€€€€€€€€½¹Ñ•áÐè¥¹ÁÕÐü¹µ½‘”€ôôô€‰…Ñ•½Éäˆ€ü€‰…Ñ•½Éäˆ€è€‰‰É…¹ˆ°(€€€€€€€€€Á•É•¹Ð°(€€€€€€€€€Á…•9Õ´°(€€€€€€€€€Á…•½Õ¹Ð°(€€€€€€€€€½Õ¹Ðè9Õµ‰•È¡‘•Ñ…¥°¹½Õ¹Ðñð€À¤°(€€€€€€€€€‰É…¹‘AÉ½‘ÕÑ½Õ¹Ðè9Õµ‰•È¡‘•Ñ…¥°¹‰É…¹‘AÉ½‘ÕÑ½Õ¹Ðñð€À¤°(€€€€€€€€€Á¡…Í”èMÑÉ¥¹œ¡‘•Ñ…¥°¹Á¡…Í”ñð€‰ÁÉ½É•ÍÌˆ¤°(€€€€€€€€€‰É…¹‘9…µ”è¥¹ÁÕÐü¹µ½‘”€ôôô€‰…Ñ•½Éäˆ€üMÑÉ¥¹œ¡…Ñ•½Éå	É…¹‘Ì¹™¥¹ ¡‰É…¹¤€ôø9Õµ‰•È¡‰É…¹¹¥¤€ôôô9Õµ‰•È¡‘•Ñ…¥°¹‰É…¹‘%¤¤ü¹¹…µ”ñð€ˆˆ¤€è€ˆˆ°(€€€€€€€€€‰É…¹‘1½½UÉ°è¥¹ÁÕÐü¹µ½‘”€ôôô€‰…Ñ•½Éäˆ€üMÑÉ¥¹œ¡…Ñ•½Éå	É…¹‘Ì¹™¥¹ ¡‰É…¹¤€ôø9Õµ‰•È¡‰É…¹¹¥¤€ôôô9Õµ‰•È¡‘•Ñ…¥°¹‰É…¹‘%¤¤ü¹±½½UÉ°ñð€ˆˆ¤€è€ˆˆ°(€€€€€€€€€µ•ÍÍ…”è¥¹ÁÕÐü¹µ½‘”€ôôô€‰…Ñ•½Éäˆ(€€€€€€€€€€€€üƒ²šCªÊ£²ÂûªâÀƒ®â3®zs®Np€‘íÁ…•9Õµô¼‘íÁ…•½Õ¹Ñôƒ
Üƒ²ƒ¶tƒ²æÓ¶3ªÎƒ®š°ƒ²‚²ÊÐƒ²¶J ƒ²†Ã¶j0ƒ²’E€(€€€€€€€€€€€€èA=%i=8A$€‘íÁ…•9Õµô¼‘íÁ…•½Õ¹Ñ÷¶:c²vÓ²ž ƒ²"c²žDƒ²’E€°(€€€€€€€ô¤ì(€€€€€ô°(€€€ô¤ì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰•áÑ•É¹…°é½Á•¸ˆ°…Íå¹Œ€¡}•Ù•¹Ð°ÕÉ°¤€ôøì(€€€É•ÑÕÉ¸½Á•¹áÑ•É¹…±%¹¡É½µ•Q…ˆ¡ÕÉ°¤ì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰½™™¥¥…°é½Á•¸µ¥¹Ñ•É¹…°µÍ•…É ˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ¤€ôøì(€€€ÑÉäì(€€€€€É•ÑÕÉ¸…Ý…¥Ð½Á•¹=™™¥¥…±5…±±%¹Ñ•É¹…±M•…É ¡¥¹ÁÕÐü¹¡½µ•Á…•UÉ°°¥¹ÁÕÐü¹ÅÕ•Éä¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€½¹ÍÐµ•ÍÍ…”€ôMÑÉ¥¹œ¡•ÉÉ½Èü¹µ•ÍÍ…”ñð•ÉÉ½Èñð€ˆˆ¤ì(€€€€€¥˜€ ½=‰©•Ð¡…Ì‰••¸‘•ÍÑÉ½å•‘ñI•¹‘•È™É…µ”Ý…Ì‘¥ÍÁ½Í•‘ñ]•‰½¹Ñ•¹ÑÌÝ…Ì‘•ÍÑÉ½å•½¤¹Ñ•ÍÐ¡µ•ÍÍ…”¤¤ì(€€€€€€€É•ÑÕÉ¸±½Í•‘%¹Ñ•É¹…±M•…É¡I•ÍÕ±Ð ‰¥Á}‰½Õ¹‘…Éäˆ¤ì(€€€€€ô(€€€€€Ñ¡É½Ü•ÉÉ½Èì(€€€ô(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰½™™¥¥…°é½Á•¸µÍ•…É ˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ¤€ôøì(€€€½¹ÍÐ‘¥Í½Ù•Éä€ô¹•ÜUI0¡MÑÉ¥¹œ¡¥¹ÁÕÐü¹‘¥Í½Ù•ÉåUÉ°ñð€ˆˆ¤¤ì(€€€½¹ÍÐÁÉ½‘ÕÐ€ô¹•ÜUI0¡MÑÉ¥¹œ¡¥¹ÁÕÐü¹ÁÉ½‘ÕÑUÉ°ñð€ˆˆ¤¤ì(€€€¥˜€ …m‘¥Í½Ù•Éä¹ÁÉ½Ñ½½°°ÁÉ½‘ÕÐ¹ÁÉ½Ñ½½±t¹•Ù•Éä ¡ÁÉ½Ñ½½°¤€ôøl‰¡ÑÑÁÌèˆ°€‰¡ÑÑÀè‰t¹¥¹±Õ‘•Ì¡ÁÉ½Ñ½½°¤¤¤ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‰%9Y1%}UI0ˆ¤ì(€€€ô(€€€…Ý…¥Ð½Á•¹áÑ•É¹…±%¹¡É½µ•Q…ˆ¡‘¥Í½Ù•Éä¹¡É•˜¤ì(€€€…Ý…¥ÐÝ…¥Ð Å|ÔÀÀ¤ì(€€€…Ý…¥Ð½Á•¹áÑ•É¹…±%¹¡É½µ•Q…ˆ¡ÁÉ½‘ÕÐ¹¡É•˜¤ì(€€€É•ÑÕÉ¸ì½¬èÑÉÕ”ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰•á•°é¥µÁ½ÉÐˆ°…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð‘¥…±½œ¹Í¡½Ý=Á•¹¥…±½œ¡ìÁÉ½Á•ÉÑ¥•Ìèl‰½Á•¹¥±”‰t°™¥±Ñ•ÉÌèmì¹…µ”è€‰á•°ˆ°•áÑ•¹Í¥½¹Ìèl‰á±Íà‰tõtô¤ì(€€€¥˜€¡É•ÍÕ±Ð¹…¹•±•ñð€…É•ÍÕ±Ð¹™¥±•A…Ñ¡ÍlÁt¤É•ÑÕÉ¸ì…¹•±•èÑÉÕ”ôì(€€€½¹ÍÐ™¥±•A…Ñ €ôÉ•ÍÕ±Ð¹™¥±•A…Ñ¡ÍlÁtì(€€€½¹ÍÐÍ¡••Ð€ô…Ý…¥ÐÉ•…‘¥ÉÍÑ…Ñ…M¡••Ð¡…Ý…¥ÐÉ•…‘¥±”¡™¥±•A…Ñ ¤¤ì(€€€½¹ÍÐ¡•…‘•ÉÌ€ô€¡Í¡••ÑlÁtñðmt¤¹µ…À ¡Ù…±Õ”¤€ôøMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤¤ì(€€€½¹ÍÐÉ½ÝÌ€ôÍ¡••Ð¹Í±¥” Ä¤¹µ…À ¡Ù…±Õ•Ì¤€ôø=‰©•Ð¹™É½µ¹ÑÉ¥•Ì (€€€€€¡•…‘•ÉÌ¹™±…Ñ5…À ¡¡•…‘•È°¥¹‘•à¤€ôø¡•…‘•È€ümm¡•…‘•È°Ù…±Õ•Ím¥¹‘•át€üü€ˆ‰ut€èmt¤(€€€€¤¤ì(€€€±•Ð¥µÁ½ÉÑ•€ô€Àì(€€€™½È€¡½¹ÍÐÉ½Ü½˜É½ÝÌ¤ì(€€€€€½¹ÍÐ…ÉÑ¥±•9Õµ‰•È€ôMÑÉ¥¹œ¡É½Ýl‹²¶J#®Ê#¶bà‰tñðÉ½Ü¹…ÉÑ¥±•9Õµ‰•ÈñðÉ½Ýl‹¶J#®Ê ‰tñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€½¹ÍÐ¹…µ”€ôMÑÉ¥¹œ¡É½Ýl‹²¶J#®ª‰tñðÉ½Ü¹¹…µ”ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€¥˜€ ……ÉÑ¥±•9Õµ‰•È€˜˜€…¹…µ”¤½¹Ñ¥¹Õ”ì(€€€€€…Ý…¥ÐÍÑ½É”¹ÕÁÍ•ÉÐ ‰ÁÉ½‘ÕÑÌˆ°ì(€€€€€€€…ÉÑ¥±•9Õµ‰•È°(€€€€€€€¹…µ”°(€€€€€€€‰É…¹èMÑÉ¥¹œ¡É½Ýl‹®â3®zs®Np‰tñðÉ½Ü¹‰É…¹ñð€ˆˆ¤°(€€€€€€€ÍÁÕ%èMÑÉ¥¹œ¡É½Ýl‰MAT%‰tñðÉ½Ü¹ÍÁÕ%ñð€ˆˆ¤°(€€€€€€€Á½¥é½¹AÉ¥”è9Õµ‰•È¡É½Ýl‰A=%i=8ƒªÂªÊ¤‰tñðÉ½Ü¹Á½¥é½¹AÉ¥”ñð€À¤°(€€€€€€€‘½µ•ÍÑ¥AÉ¥”è9Õµ‰•È¡É½Ýl‹ªÖ·®
ÐƒªÂªÊ¤‰tñðÉ½Ü¹‘½µ•ÍÑ¥AÉ¥”ñð€À¤°(€€€€€€€Í½ÕÉ”è€‰•á•°ˆ(€€€€€ô¤ì(€€€€€¥µÁ½ÉÑ•€¬ô€Äì(€€€ô(€€€É•ÑÕÉ¸ì…¹•±•è™…±Í”°¥µÁ½ÉÑ•ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰•á•°é¥µÁ½ÉÐµ‰É…¹µÍ½ÕÉ”ˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ€ôíô¤€ôøì(€€€±•Ð™¥±•A…Ñ €ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹Á…Ñ ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ•áÁ•Ñ•‘	É…¹€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹•áÁ•Ñ•‘	É…¹ñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€¥˜€ …™¥±•A…Ñ ¤ì(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð‘¥…±½œ¹Í¡½Ý=Á•¹¥…±½œ¡ì(€€€€€€€ÁÉ½Á•ÉÑ¥•Ìèl‰½Á•¹¥±”‰t°(€€€€€€€™¥±Ñ•ÉÌèmì¹…µ”è€‰A=%i=8á•°ˆ°•áÑ•¹Í¥½¹Ìèl‰á±Íà‰tõt°(€€€€€ô¤ì(€€€€€¥˜€¡É•ÍÕ±Ð¹…¹•±•ñð€…É•ÍÕ±Ð¹™¥±•A…Ñ¡ÍlÁt¤É•ÑÕÉ¸ì…¹•±•èÑÉÕ”ôì(€€€€€m™¥±•A…Ñ¡t€ôÉ•ÍÕ±Ð¹™¥±•A…Ñ¡Ìì(€€€ô(€€€½¹ÍÐ™¥±•	Õ™™•È€ô…Ý…¥ÐÉ•…‘¥±”¡™¥±•A…Ñ ¤ì(€€€½¹ÍÐÝ½É­‰½½¬€ô…Ý…¥ÐÉ•…‘M¡••Ð¡É•Á…¥ÉA½¥é½¹]½É­Í¡••Ñ¥µ•¹Í¥½¹Ì¡™¥±•	Õ™™•È¤¤ì(€€€½¹ÍÐÍ½ÕÉ•M¡••Ð€ô•ÑA½¥é½¹]½É­Í¡••ÑI½ÝÌ¡Ý½É­‰½½¬¤ì(€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡Í½ÕÉ•M¡••Ð¤ñðÍ½ÕÉ•M¡••Ð¹±•¹Ñ €ð€È¤ì(€€€€€É•ÑÕÉ¸ì…¹•±•è™…±Í”°½¬è™…±Í”°µ•ÍÍ…”è€‰á•°ƒ¶23²vó²^@ƒ²¶J ƒ®6Ã²vÓ¶ÃªÂ ƒ²^²*×®.#®.¸ˆôì(€€€ô(€€€½¹ÍÐ™¥±Ñ•É•€ô™¥±Ñ•ÉA½¥é½¹I½ÝÍ	åQ½Ñ…±M…±•Ì¡Í½ÕÉ•M¡••Ð°A=%i=9}5%9%5U5}Q=Q1}M1L¤ì(€€€¥˜€ …™¥±Ñ•É•¹½¬¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€…¹•±•è™…±Í”°(€€€€€€€½¬è™…±Í”°(€€€€€€€½‘”è™¥±Ñ•É•¹½‘”°(€€€€€€€µ•ÍÍ…”è™¥±Ñ•É•¹µ•ÍÍ…”°(€€€€€ôì(€€€ô(€€€¥˜€¡™¥±Ñ•É•¹™¥±Ñ•É•‘I½ÝÌ€ôôô€À¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€…¹•±•è™…±Í”°(€€€€€€€½¬è™…±Í”°(€€€€€€€½‘”è€‰A=%i=9}M1M}%1QI}5AQdˆ°(€€€€€€€µ•ÍÍ…”èƒ²’GªÖ´ƒ²Òtƒ¶2C®ž“®~$ƒ®bC®*Pƒ¶b²ž ƒ¶2C®ž“²z@ƒ²Òtƒ¶2C®ž“®~'²vÐ€‘íA=%i=9}5%9%5U5}Q=Q1}M1M÷ªÆÐƒ²vÓ²²vàƒ²¶J#²vÐƒ²^²*×®.#®.¹€°(€€€€€€€Í½ÕÉ•I½ÝÌè™¥±Ñ•É•¹Í½ÕÉ•I½ÝÌ°(€€€€€€€™¥±Ñ•É•‘I½ÝÌè€À°(€€€€€ôì(€€€ô(€€€½¹ÍÐÍ¡••Ð€ô™¥±Ñ•É•¹Í¡••Ðì(€€€½¹ÍÐ¡•…‘•ÉÌ€ôÍ¡••ÑlÁtñðmtì(€€€½¹ÍÐ™¥¹‘½±Õµ¸€ô€ ¸¸¹¹…µ•Ì¤€ôø™¥¹‘A½¥é½¹½±Õµ¸¡¡•…‘•ÉÌ°€¸¸¹¹…µ•Ì¤ì(€€€½¹ÍÐ½±Õµ¹Ì€ôì(€€€€€ÍÁÕ%è™¥¹‘½±Õµ¸ ‰MAT%ˆ°€‰MAU}%ˆ¤°(€€€€€¥µ…”è™¥¹‘½±Õµ¸ ‰MATƒ²vÓ®¾ã²ž ˆ°€‹²¶J ƒ²vÓ®¾ã²ž ˆ°€‹²vÓ®¾ã²ž ˆ¤°(€€€€€…ÉÑ¥±•9Õµ‰•Èè™¥¹‘½±Õµ¸ ‹²¶J ƒ®Ê#¶bàˆ°€‹²¶J#®Ê#¶bàˆ°€‹¶J#®Ê ˆ¤°(€€€€€Ñ¥Ñ±”è™¥¹‘½±Õµ¸ ‹²¶J#®ªˆ°€‹²b®²àƒ²¶J#®ªˆ¤°(€€€€€‰É…¹è™¥¹‘½±Õµ¸ ‹²¶J ƒ®â3®zs®Npˆ°€‹®â3®zs®Npˆ¤°(€€€€€…Ñ•½ÉäÄè™¥¹‘½±Õµ¸ ‹²æÓ¶3ªÎƒ®š°ƒ®2®Ú®–`ˆ°€‹®2®Ú®–`ˆ¤°(€€€€€…Ñ•½ÉäÈè™¥¹‘½±Õµ¸ ‹²æÓ¶3ªÎƒ®š°ƒ²’G®Ú®–`ˆ°€‹²’G®Ú®–`ˆ¤°(€€€€€…Ñ•½ÉäÌè™¥¹‘½±Õµ¸ ‹²æÓ¶3ªÎƒ®š°ƒ²3®Ú®–`ˆ°€‹²3®Ú®–`ˆ¤°(€€€€€½ÁÑ¥½¸è™¥¹‘½±Õµ¸ ‹²
³²vÓ²š ¿²b×²`¿²'²ˆ°€‹²b×²`ˆ¤°(€€€€€Í­Õ%è™¥¹‘½±Õµ¸ ‰M-T%ˆ°€‰M-U}%ˆ¤°(€€€€€…Ù•É…•AÉ¥”è™¥¹‘½±Õµ¸ ‹²ÖsªÞð€ÌÃ²vóªÂƒ¶>'ªÞ€ƒªÆÃ®zcªÂ ˆ°€‹²ÖsªÞð€ÌÃ²vðƒ¶>'ªÞ€ƒªÆÃ®zcªÂ ˆ¤°(€€€€€Í…±•ÌÌÁè™¥¹‘½±Õµ¸ ‹²ÖsªÞð€ÌÃ²vðƒ¶2C®ž“®~$ˆ°€‹²ÖsªÞðÌÃ²vó¶2C®ž“®~$ˆ¤°(€€€€€±½…±M…±•ÌÌÁè™¥¹‘½±Õµ¸ ‹¶b²ž ƒ¶2C®ž“²z@ƒ²ÖsªÞð€ÌÃ²vðƒ¶2C®ž“®~$ˆ°€‹¶b²ž¶2C®ž“²zC²ÖsªÞðÌÃ²vó¶2C®ž“®~$ˆ¤°(€€€€€Ñ½Ñ…±M…±•Ìè™¥¹‘½±Õµ¸ ‹²’GªÖ´ƒ²Òtƒ¶2C®ž“®~$ˆ°€‹²Òtƒ¶2C®ž“®~$ˆ¤°(€€€€€±½…±Q½Ñ…±M…±•Ìè™¥¹‘½±Õµ¸ ‹¶b²ž ƒ¶2C®ž“²z@ƒ²Òtƒ¶2C®ž“®~$ˆ°€‹¶b²ž¶2C®ž“²zC²Òw¶2C®ž“®~$ˆ¤°(€€€ôì(€€€¥˜€¡½±Õµ¹Ì¹ÍÁÕ%€ð€À€˜˜½±Õµ¹Ì¹…ÉÑ¥±•9Õµ‰•È€ð€À¤ì(€€€€€É•ÑÕÉ¸ì…¹•±•è™…±Í”°½¬è™…±Í”°µ•ÍÍ…”è€‰A=%i=8ƒ²¶J#ªÊ²$ƒ²‚²ÊÐƒ®
Ó®ÎÓ®
ÓªâÀƒ²ZG².w²vÐƒ²V®.g®.#®.¸ˆôì(€€€ô(€€€½¹ÍÐ•±°€ô€¡É½Ü°¥¹‘•à¤€ôø¥¹‘•à€øô€À€üÉ½Ým¥¹‘•át€è€ˆˆì(€€€½¹ÍÐ¹Õµ•É¥Œ€ô€¡Ù…±Õ”¤€ôøì(€€€€€¥˜€¡ÑåÁ•½˜Ù…±Õ”€ôôô€‰¹Õµ‰•Èˆ€˜˜9Õµ‰•È¹¥Í¥¹¥Ñ”¡Ù…±Õ”¤¤É•ÑÕÉ¸Ù…±Õ”ì(€€€€€½¹ÍÐÁ…ÉÍ•€ô9Õµ‰•È¡MÑÉ¥¹œ¡Ù…±Õ”€üü€ˆˆ¤¹É•Á±…” ½myq¸µt½œ°€ˆˆ¤¤ì(€€€€€É•ÑÕÉ¸9Õµ‰•È¹¥Í¥¹¥Ñ”¡Á…ÉÍ•¤€üÁ…ÉÍ•€è€Àì(€€€ôì(€€€½¹ÍÐÉ…Ý5•ÑÉ¥Œ€ô€¡Ù…±Õ”¤€ôøMÑÉ¥¹œ¡Ù…±Õ”€üü€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€½¹ÍÐÁÉ½‘ÕÑÍ	å-•ä€ô¹•Ü5…À ¤ì(€€€±•Ð¥µÁ½ÉÑ•‘I½ÝÌ€ô€Àì(€€€™½È€¡½¹ÍÐÉ½Ü½˜Í¡••Ð¹Í±¥” Ä¤¤ì(€€€€€½¹ÍÐÍÁÕ%€ôMÑÉ¥¹œ¡•±°¡É½Ü°½±Õµ¹Ì¹ÍÁÕ%¤€üü€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€½¹ÍÐ…ÉÑ¥±•9Õµ‰•È€ôMÑÉ¥¹œ¡•±°¡É½Ü°½±Õµ¹Ì¹…ÉÑ¥±•9Õµ‰•È¤€üü€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€½¹ÍÐÑ¥Ñ±”€ôMÑÉ¥¹œ¡•±°¡É½Ü°½±Õµ¹Ì¹Ñ¥Ñ±”¤€üü€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€¥˜€ …ÍÁÕ%€˜˜€……ÉÑ¥±•9Õµ‰•È€˜˜€…Ñ¥Ñ±”¤½¹Ñ¥¹Õ”ì(€€€€€¥µÁ½ÉÑ•‘I½ÝÌ€¬ô€Äì(€€€€€½¹ÍÐ­•ä€ôÍÁÕ%€üMATè‘íÍÁÕ%‘õ€€è…ÉÑ¥±•9Õµ‰•È€üIQ%1è‘í…ÉÑ¥±•9Õµ‰•È¹Ñ½UÁÁ•É…Í” ¥õ€€èI=\è‘í¥µÁ½ÉÑ•‘I½ÝÍõ€ì(€€€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ôÁÉ½‘ÕÑÍ	å-•ä¹•Ð¡­•ä¤ñðíôì(€€€€€½¹ÍÐ½ÁÑ¥½¸€ôMÑÉ¥¹œ¡•±°¡É½Ü°½±Õµ¹Ì¹½ÁÑ¥½¸¤€üü€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€½¹ÍÐ½ÁÑ¥½¹Ì€ô¹•ÜM•Ð¡ÁÉ•Ù¥½ÕÌ¹½ÁÑ¥½¹Ìñðmt¤ì(€€€€€¥˜€¡½ÁÑ¥½¸¤½ÁÑ¥½¹Ì¹…‘¡½ÁÑ¥½¸¤ì(€€€€€½¹ÍÐÍ…±•ÌÌÁ€ô¹Õµ•É¥Œ¡•±°¡É½Ü°½±Õµ¹Ì¹Í…±•ÌÌÁ¤¤ì(€€€€€½¹ÍÐ±½…±M…±•ÌÌÁ€ô¹Õµ•É¥Œ¡•±°¡É½Ü°½±Õµ¹Ì¹±½…±M…±•ÌÌÁ¤¤ì(€€€€€½¹ÍÐÑ½Ñ…±M…±•Ì€ô¹Õµ•É¥Œ¡•±°¡É½Ü°½±Õµ¹Ì¹Ñ½Ñ…±M…±•Ì¤¤ì(€€€€€½¹ÍÐ±½…±Q½Ñ…±M…±•Ì€ô¹Õµ•É¥Œ¡•±°¡É½Ü°½±Õµ¹Ì¹±½…±Q½Ñ…±M…±•Ì¤¤ì(€€€€€½¹ÍÐÙ…É¥…¹Ð€ôì(€€€€€€€Í½ÕÉ•I½Üè¥µÁ½ÉÑ•‘I½ÝÌ€¬€Ä°(€€€€€€€Í­Õ%èMÑÉ¥¹œ¡•±°¡É½Ü°½±Õµ¹Ì¹Í­Õ%¤€üü€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€€€½ÁÑ¥½¸°(€€€€€€€Í…±•ÌÌÁ°(€€€€€€€Í…±•ÌÌÁ‘I…ÜèÉ…Ý5•ÑÉ¥Œ¡•±°¡É½Ü°½±Õµ¹Ì¹Í…±•ÌÌÁ¤¤°(€€€€€€€±½…±M…±•ÌÌÁ°(€€€€€€€±½…±M…±•ÌÌÁ‘I…ÜèÉ…Ý5•ÑÉ¥Œ¡•±°¡É½Ü°½±Õµ¹Ì¹±½…±M…±•ÌÌÁ¤¤°(€€€€€€€Ñ½Ñ…±M…±•Ì°(€€€€€€€Ñ½Ñ…±M…±•ÍI…ÜèÉ…Ý5•ÑÉ¥Œ¡•±°¡É½Ü°½±Õµ¹Ì¹Ñ½Ñ…±M…±•Ì¤¤°(€€€€€€€±½…±Q½Ñ…±M…±•Ì°(€€€€€€€±½…±Q½Ñ…±M…±•ÍI…ÜèÉ…Ý5•ÑÉ¥Œ¡•±°¡É½Ü°½±Õµ¹Ì¹±½…±Q½Ñ…±M…±•Ì¤¤°(€€€€€ôì(€€€€€ÁÉ½‘ÕÑÍ	å-•ä¹Í•Ð¡­•ä°ì(€€€€€€€€¸¸¹ÁÉ•Ù¥½ÕÌ°(€€€€€€€ÍÁÕ%èÁÉ•Ù¥½ÕÌ¹ÍÁÕ%ñðÍÁÕ%°(€€€€€€€…ÉÑ¥±•9Õµ‰•ÈèÁÉ•Ù¥½ÕÌ¹…ÉÑ¥±•9Õµ‰•Èñð…ÉÑ¥±•9Õµ‰•È°(€€€€€€€Ñ¥Ñ±”èÁÉ•Ù¥½ÕÌ¹Ñ¥Ñ±”ñðÑ¥Ñ±”°(€€€€€€€…Á¥Q¥Ñ±”èÁÉ•Ù¥½ÕÌ¹…Á¥Q¥Ñ±”ñðÑ¥Ñ±”°(€€€€€€€±½½UÉ°èÁÉ•Ù¥½ÕÌ¹±½½UÉ°ñðMÑÉ¥¹œ¡•±°¡É½Ü°½±Õµ¹Ì¹¥µ…”¤€üü€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€€€‰É…¹‘9…µ”èÁÉ•Ù¥½ÕÌ¹‰É…¹‘9…µ”ñðMÑÉ¥¹œ¡•±°¡É½Ü°½±Õµ¹Ì¹‰É…¹¤€üü€ˆˆ¤¹ÑÉ¥´ ¤°(€€€€€€€…Ñ•½Éå9…µ”èÁÉ•Ù¥½ÕÌ¹…Ñ•½Éå9…µ”ñðl(€€€€€€€€€•±°¡É½Ü°½±Õµ¹Ì¹…Ñ•½ÉäÄ¤°•±°¡É½Ü°½±Õµ¹Ì¹…Ñ•½ÉäÈ¤°•±°¡É½Ü°½±Õµ¹Ì¹…Ñ•½ÉäÌ¤°(€€€€€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹µ…À¡MÑÉ¥¹œ¤¹©½¥¸ ˆ€¼€ˆ¤°(€€€€€€€…Ù•É…•AÉ¥”è5…Ñ ¹µ…à¡9Õµ‰•È¡ÁÉ•Ù¥½ÕÌ¹…Ù•É…•AÉ¥”ñð€À¤°¹Õµ•É¥Œ¡•±°¡É½Ü°½±Õµ¹Ì¹…Ù•É…•AÉ¥”¤¤¤°(€€€€€€€¡…ÍAÉ¥•…Ñ„è½±Õµ¹Ì¹…Ù•É…•AÉ¥”€øô€À°(€€€€€€€¡…ÍM…±•Í…Ñ„è½±Õµ¹Ì¹Í…±•ÌÌÁ€øô€À°(€€€€€€€¡…Í1½…±M…±•Í…Ñ„è½±Õµ¹Ì¹±½…±M…±•ÌÌÁ€øô€À°(€€€€€€€¡…ÍQ½Ñ…±M…±•Í…Ñ„è½±Õµ¹Ì¹Ñ½Ñ…±M…±•Ì€øô€À°(€€€€€€€¡…Í1½…±Q½Ñ…±M…±•Í…Ñ„è½±Õµ¹Ì¹±½…±Q½Ñ…±M…±•Ì€øô€À°(€€€€€€€½ÁÑ¥½¹Ìèl¸¸¹½ÁÑ¥½¹Ít°(€€€€€€€Ù…É¥…¹ÑÌèl¸¸¸¡ÁÉ•Ù¥½ÕÌ¹Ù…É¥…¹ÑÌñðmt¤°Ù…É¥…¹Ñt°(€€€€€€€Í½ÕÉ”è€‰Á½¥é½¸µ•á•°µ•áÁ½ÉÐˆ°(€€€€€ô¤ì(€€€ô(€€€½¹ÍÐÕÍ•Q½Ñ…±M…±•Ì€ô½±Õµ¹Ì¹Ñ½Ñ…±M…±•Ì€øô€À€˜˜½±Õµ¹Ì¹±½…±Q½Ñ…±M…±•Ì€øô€Àì(€€€™½È€¡½¹ÍÐÁÉ½‘ÕÐ½˜ÁÉ½‘ÕÑÍ	å-•ä¹Ù…±Õ•Ì ¤¤ì(€€€€€½¹ÍÐÙ…É¥…¹ÑÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡ÁÉ½‘ÕÐ¹Ù…É¥…¹ÑÌ¤€üÁÉ½‘ÕÐ¹Ù…É¥…¹ÑÌ€èmtì(€€€€€½¹ÍÐÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù”€ôÙ…É¥…¹ÑÌ¹É•‘Õ” ¡‰•ÍÐ°Ù…É¥…¹Ð¤€ôøì(€€€€€€€¥˜€ …‰•ÍÐ¤É•ÑÕÉ¸Ù…É¥…¹Ðì(€€€€€€€½¹ÍÐ±½…±-•ä€ôÕÍ•Q½Ñ…±M…±•Ì€ü€‰±½…±Q½Ñ…±M…±•Ìˆ€è€‰±½…±M…±•ÌÌÁˆì(€€€€€€€½¹ÍÐ¡¥¹…-•ä€ôÕÍ•Q½Ñ…±M…±•Ì€ü€‰Ñ½Ñ…±M…±•Ìˆ€è€‰Í…±•ÌÌÁˆì(€€€€€€€É•ÑÕÉ¸9Õµ‰•È¡Ù…É¥…¹Ñm±½…±-•åtñð€À¤€ø9Õµ‰•È¡‰•ÍÑm±½…±-•åtñð€À¤(€€€€€€€€€ñð€¡9Õµ‰•È¡Ù…É¥…¹Ñm±½…±-•åtñð€À¤€ôôô9Õµ‰•È¡‰•ÍÑm±½…±-•åtñð€À¤(€€€€€€€€€€€€˜˜9Õµ‰•È¡Ù…É¥…¹Ñm¡¥¹…-•åtñð€À¤€ø9Õµ‰•È¡‰•ÍÑm¡¥¹…-•åtñð€À¤¤(€€€€€€€€€€üÙ…É¥…¹Ð(€€€€€€€€€€è‰•ÍÐì(€€€€€ô°¹Õ±°¤ì(€€€€€¥˜€¡É•ÁÉ•Í•¹Ñ…Ñ¥Ù”¤ì(€€€€€€€™½È€¡½¹ÍÐµ•ÑÉ¥Œ½˜l‰Í…±•ÌÌÁˆ°€‰±½…±M…±•ÌÌÁˆ°€‰Ñ½Ñ…±M…±•Ìˆ°€‰±½…±Q½Ñ…±M…±•Ì‰t¤ì(€€€€€€€€€ÁÉ½‘ÕÑmµ•ÑÉ¥t€ôÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù•mµ•ÑÉ¥tì(€€€€€€€€€ÁÉ½‘ÕÑm€‘íµ•ÑÉ¥õI…Ýt€ôÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù•m€‘íµ•ÑÉ¥õI…Ýtì(€€€€€€€ô(€€€€€€€ÁÉ½‘ÕÐ¹É•ÁÉ•Í•¹Ñ…Ñ¥Ù•M­Õ%€ôÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù”¹Í­Õ%ì(€€€€€€€ÁÉ½‘ÕÐ¹É•ÁÉ•Í•¹Ñ…Ñ¥Ù•=ÁÑ¥½¸€ôÉ•ÁÉ•Í•¹Ñ…Ñ¥Ù”¹½ÁÑ¥½¸ì(€€€€€ô(€€€ô(€€€½¹ÍÐÁÉ½‘ÕÑÌ€ôl¸¸¹ÁÉ½‘ÕÑÍ	å-•ä¹Ù…±Õ•Ì ¥tì(€€€½¹ÍÐ‰É…¹‘%¹Ñ•É¥Ñä€ô•áÁ•Ñ•‘	É…¹€ü…¹…±åé•	É…¹‘5…Ñ ¡•áÁ•Ñ•‘	É…¹°ÁÉ½‘ÕÑÌ¤€è¹Õ±°ì(€€€¥˜€¡‰É…¹‘%¹Ñ•É¥Ñä€˜˜€…‰É…¹‘%¹Ñ•É¥Ñä¹½¬¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€…¹•±•è™…±Í”°(€€€€€€€½¬è™…±Í”°(€€€€€€€½‘”è€‰	I9}a1}5%M5Q ˆ°(€€€€€€€µ•ÍÍ…”è‰É…¹‘5¥Íµ…Ñ¡5•ÍÍ…”¡‰É…¹‘%¹Ñ•É¥Ñä¤°(€€€€€€€‰É…¹‘%¹Ñ•É¥Ñä°(€€€€€ôì(€€€ô(€€€½¹ÍÐÁÉ½•ÍÍ•‘9…µ”€ôÁÉ½•ÍÍ•‘	É…¹‘áÁ½ÉÑ9…µ”¡‰…Í•¹…µ”¡™¥±•A…Ñ ¤¤ì(€€€½¹ÍÐÁÉ½•ÍÍ•‘A…Ñ €ô©½¥¸¡‘¥É¹…µ”¡™¥±•A…Ñ ¤°ÁÉ½•ÍÍ•‘9…µ”¤ì(€€€½¹ÍÐ•áÁ½ÉÑ…Ñ„€ôl(€€€€€¡•…‘•ÉÌ¹µ…À ¡Ù…±Õ”¤€ôø€¡ì(€€€€€€€Ù…±Õ”èMÑÉ¥¹œ¡Ù…±Õ”€üü€ˆˆ¤°(€€€€€€€™½¹Ñ]•¥¡Ðè€‰‰½±ˆ°(€€€€€€€‰…­É½Õ¹‘½±½Èè€ˆàˆ°(€€€€€ô¤¤°(€€€€€€¸¸¹™¥±Ñ•É•¹É½ÝÌ¹µ…À ¡É½Ü¤€ôøÉ½Ü¹µ…À ¡É…Ü°¥¹‘•à¤€ôøì(€€€€€€€¥˜€¡¥¹‘•à€ôôô™¥±Ñ•É•¹Ñ½Ñ…±M…±•Í½±Õµ¸ñð¥¹‘•à€ôôô™¥±Ñ•É•¹±½…±Q½Ñ…±M…±•Í½±Õµ¸¤ì(€€€€€€€€€É•ÑÕÉ¸ìÙ…±Õ”è9Õµ‰•È¡É…Üñð€À¤°ÑåÁ”è9Õµ‰•È°™½Éµ…Ðè€ˆŒ°ŒŒÀˆôì(€€€€€€€ô(€€€€€€€½¹ÍÐÙ…±Õ”€ôÉ…Ü¥¹ÍÑ…¹•½˜…Ñ”ñðl‰ÍÑÉ¥¹œˆ°€‰¹Õµ‰•Èˆ°€‰‰½½±•…¸‰t¹¥¹±Õ‘•Ì¡ÑåÁ•½˜É…Ü¤(€€€€€€€€€€üÉ…Ü(€€€€€€€€€€èÉ…Ü€ôôô¹Õ±°ñðÉ…Ü€ôôôÕ¹‘•™¥¹•€ü¹Õ±°€èMÑÉ¥¹œ¡É…Ü¤ì(€€€€€€€É•ÑÕÉ¸ìÙ…±Õ”ôì(€€€€€ô¤¤°(€€€tì(€€€…Ý…¥ÐÝÉ¥Ñ•a±Íá¥±”¡mì(€€€€€‘…Ñ„è•áÁ½ÉÑ…Ñ„°(€€€€€Í¡••Ðè€‰A=%i=9}Q=Q1|ÔÁ}=Hˆ°(€€€€€ÍÑ¥­åI½ÝÍ½Õ¹Ðè€Ä°(€€€€€½±Õµ¹Ìè¡•…‘•ÉÌ¹µ…À ¡¡•…‘•È°¥¹‘•à¤€ôø€¡ì(€€€€€€€Ý¥‘Ñ è¥¹‘•à€ôôô½±Õµ¹Ì¹Ñ¥Ñ±”€ü€ÔÐ(€€€€€€€€€€è¥¹‘•à€ôôô½±Õµ¹Ì¹¥µ…”€ü€Ìà(€€€€€€€€€€€€è5…Ñ ¹µ…à ÄÈ°5…Ñ ¹µ¥¸ ÈØ°MÑÉ¥¹œ¡¡•…‘•Èñð€ˆˆ¤¹±•¹Ñ €¬€Ø¤¤°(€€€€€ô¤¤°(€€€õt¤¹Ñ½¥±”¡ÁÉ½•ÍÍ•‘A…Ñ ¤ì(€€€É•ÑÕÉ¸ì(€€€€€…¹•±•è™…±Í”°(€€€€€½¬èÑÉÕ”°(€€€€€Á…Ñ èÁÉ½•ÍÍ•‘A…Ñ °(€€€€€ÁÉ½•ÍÍ•‘A…Ñ °(€€€€€ÁÉ½•ÍÍ•‘9…µ”°(€€€€€½É¥¥¹…±A…Ñ è™¥±•A…Ñ °(€€€€€Í½ÕÉ•I½ÝÌè™¥±Ñ•É•¹Í½ÕÉ•I½ÝÌ°(€€€€€™¥±Ñ•É•‘I½ÝÌè™¥±Ñ•É•¹™¥±Ñ•É•‘I½ÝÌ°(€€€€€Õ¹¥ÅÕ•MÁÕ½Õ¹ÐèÁÉ½‘ÕÑÌ¹±•¹Ñ °(€€€€€µ¥¹¥µÕµM…±•ÌèA=%i=9}5%9%5U5}Q=Q1}M1L°(€€€€€ÁÉ½‘ÕÑÌ°(€€€€€‰É…¹‘%¹Ñ•É¥Ñä°(€€€ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰•á•°é•áÁ½ÉÐˆ°…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð‘¥…±½œ¹Í¡½ÝM…Ù•¥…±½œ¡ì‘•™…Õ±ÑA…Ñ èÉ½Õ¹µ´‘í¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¥ô¹á±Íá€°™¥±Ñ•ÉÌèmì¹…µ”è€‰á•°ˆ°•áÑ•¹Í¥½¹Ìèl‰á±Íà‰tõtô¤ì(€€€¥˜€¡É•ÍÕ±Ð¹…¹•±•ñð€…É•ÍÕ±Ð¹™¥±•A…Ñ ¤É•ÑÕÉ¸ì…¹•±•èÑÉÕ”ôì(€€€½¹ÍÐ‘…Ñ„€ôÍÑ½É”¹Í¹…ÁÍ¡½Ð ¤ì(€€€½¹ÍÐÍ¡••ÑÌ€ômtì(€€€™½È€¡½¹ÍÐm¹…µ”°É½ÝÍt½˜ml‹²¶J ˆ°‘…Ñ„¹ÁÉ½‘ÕÑÍt°l‹²z—®Ú ˆ°‘…Ñ„¹±•‘•Ét°l‹²Žó®²àˆ°‘…Ñ„¹½É‘•ÉÍt°l‹ªÒ².³²¶J ˆ°‘…Ñ„¹™…Ù½É¥Ñ•Íut¤ì(€€€€€½¹ÍÐ½±Õµ¹Ì€ôl¸¸¹¹•ÜM•Ð¡É½ÝÌ¹™±…Ñ5…À ¡É½Ü¤€ôø=‰©•Ð¹­•åÌ¡É½Ü¤¤¥tì(€€€€€½¹ÍÐ•±±Ì€ôl(€€€€€€€½±Õµ¹Ì¹µ…À ¡Ù…±Õ”¤€ôø€¡ìÙ…±Õ”°™½¹Ñ]•¥¡Ðè€‰‰½±ˆ°‰…­É½Õ¹‘½±½Èè€ˆÑàˆô¤¤°(€€€€€€€€¸¸¹É½ÝÌ¹µ…À ¡É½Ü¤€ôø½±Õµ¹Ì¹µ…À ¡­•ä¤€ôøì(€€€€€€€€€½¹ÍÐÉ…Ü€ôÉ½Ým­•åtì(€€€€€€€€€½¹ÍÐÙ…±Õ”€ôÉ…Ü¥¹ÍÑ…¹•½˜…Ñ”ñðl‰ÍÑÉ¥¹œˆ°€‰¹Õµ‰•Èˆ°€‰‰½½±•…¸‰t¹¥¹±Õ‘•Ì¡ÑåÁ•½˜É…Ü¤(€€€€€€€€€€€€üÉ…Ü(€€€€€€€€€€€€èÉ…Ü€ôôô¹Õ±°ñðÉ…Ü€ôôôÕ¹‘•™¥¹•€ü¹Õ±°€è)M=8¹ÍÑÉ¥¹¥™ä¡É…Ü¤ì(€€€€€€€€€É•ÑÕÉ¸ìÙ…±Õ”ôì(€€€€€€€ô¤¤°(€€€€€tì(€€€€€Í¡••ÑÌ¹ÁÕÍ ¡ì(€€€€€€€‘…Ñ„è•±±Ì°(€€€€€€€Í¡••Ðè¹…µ”°(€€€€€€€ÍÑ¥­åI½ÝÍ½Õ¹Ðè€Ä°(€€€€€€€½±Õµ¹Ìè½±Õµ¹Ì¹µ…À ¡­•ä¤€ôø€¡ìÝ¥‘Ñ è5…Ñ ¹µ…à ÄÈ°5…Ñ ¹µ¥¸ ÌØ°­•ä¹±•¹Ñ €¬€Ð¤¤ô¤¤°(€€€€€ô¤ì(€€€ô(€€€…Ý…¥ÐÝÉ¥Ñ•a±Íá¥±”¡Í¡••ÑÌ¤¹Ñ½¥±”¡É•ÍÕ±Ð¹™¥±•A…Ñ ¤ì(€€€É•ÑÕÉ¸ì…¹•±•è™…±Í”°Á…Ñ èÉ•ÍÕ±Ð¹™¥±•A…Ñ ôì(€ô¤ì(€¥Á5…¥¸¹¡…¹‘±” ‰•á•°é•áÁ½ÉÐµ•áÁ±½É•Èˆ°…Íå¹Œ€¡}•Ù•¹Ð°¥¹ÁÕÐ€ôíô¤€ôøì(€€€½¹ÍÐÍ…™•Q¥Ñ±”€ôMÑÉ¥¹œ¡¥¹ÁÕÐ¹Ñ¥Ñ±”ñð€‰A=%i=8·²¶J#ªÊ²$ˆ¤¹É•Á±…” ½mqp¼è¨üˆðùñt½œ°€‰|ˆ¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥Ð‘¥…±½œ¹Í¡½ÝM…Ù•¥…±½œ¡ì(€€€€€‘•™…Õ±ÑA…Ñ è€‘íÍ…™•Q¥Ñ±•ô´‘í¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¥ô¹á±Íá€°(€€€€€™¥±Ñ•ÉÌèmì¹…µ”è€‰á•°ˆ°•áÑ•¹Í¥½¹Ìèl‰á±Íà‰tõt°(€€€ô¤ì(€€€¥˜€¡É•ÍÕ±Ð¹…¹•±•ñð€…É•ÍÕ±Ð¹™¥±•A…Ñ ¤É•ÑÕÉ¸ì…¹•±•èÑÉÕ”ôì(€€€½¹ÍÐÉ½ÝÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡¥¹ÁÕÐ¹ÁÉ½‘ÕÑÌ¤€ü¥¹ÁÕÐ¹ÁÉ½‘ÕÑÌ€èmtì(€€€½¹ÍÐ¡•…‘•ÉÌ€ôl(€€€€€€‹²ƒ¶tˆ°€‹²¶J ƒ²vÓ®¾ã²ž ˆ°€‹²¶J ƒ®Ê#¶bàˆ°€‹²b®²àƒ²¶J#®ªˆ°€‰MAT%ˆ°€‹®â3®zs®Npˆ°€‹²æÓ¶3ªÎƒ®š°ˆ°(€€€€€€‹²ÖsªÞð€ÌÃ²vðƒ¶>'ªÞ€ƒªÆÃ®zcªÂ ˆ°€‹²’GªÖ´ƒªÖ³®ž“²z@ƒ¶:c²vÓ²ž ƒ®ã²Úpˆ°(€€€€€€‹²Òtƒ¶2C®ž“®~$ˆ°€‹¶b²ž ƒ¶2C®ž“²z@ƒ²Òtƒ¶2C®ž“®~$ˆ°(€€€€€€‹²ÖsªÞð€ÌÃ²vðƒ¶2C®ž“®~$ˆ°€‹¶b²ž ƒ¶2C®ž“²z@ƒ²ÖsªÞð€ÌÃ²vðƒ¶2C®ž“®~$ˆ°(€€€tì(€€€½¹ÍÐµ•ÑÉ¥•±°€ô€¡É½Ü°¹Õµ•É¥¥•±°É…Ý¥•±°…Ù…¥±…‰±•¥•±¤€ôøì(€€€€€¥˜€¡É½Ým…Ù…¥±…‰±•¥•±‘t€ôôô™…±Í”¤É•ÑÕÉ¸ìÙ…±Õ”è€ˆ´´ˆôì(€€€€€½¹ÍÐ¹Õµ•É¥Y…±Õ”€ô9Õµ‰•È¡É½Ým¹Õµ•É¥¥•±‘t¤ì(€€€€€¥˜€ …9Õµ‰•È¹¥Í¥¹¥Ñ”¡¹Õµ•É¥Y…±Õ”¤¤É•ÑÕÉ¸ìÙ…±Õ”è€ˆ´´ˆôì(€€€€€½¹ÍÐÉ…ÝY…±Õ”€ôMÑÉ¥¹œ¡É½ÝmÉ…Ý¥•±‘t€üü€ˆˆ¤¹É•Á±…” ¼°½œ°€ˆˆ¤¹ÑÉ¥´ ¤ì(€€€€€¥˜€ ½xñqÌ¨Ô½¤¹Ñ•ÍÐ¡É…ÝY…±Õ”¤¤ì(€€€€€€€É•ÑÕÉ¸ìÙ…±Õ”è¹Õµ•É¥Y…±Õ”°ÑåÁ”è9Õµ‰•È°™½Éµ…Ðè€œˆðÔˆœôì(€€€€€ô(€€€€€¥˜€ ½yq¬ üép¹q¬¤ýp¬¼¹Ñ•ÍÐ¡É…ÝY…±Õ”¤¤ì(€€€€€€€É•ÑÕÉ¸ìÙ…±Õ”è¹Õµ•É¥Y…±Õ”°ÑåÁ”è9Õµ‰•È°™½Éµ…Ðè€œŒ°ŒŒÀˆ¬ˆœôì(€€€€€ô(€€€€€É•ÑÕÉ¸ìÙ…±Õ”è¹Õµ•É¥Y…±Õ”°ÑåÁ”è9Õµ‰•È°™½Éµ…Ðè€ˆŒ°ŒŒÀˆôì(€€€ôì(€€€½¹ÍÐ‘…Ñ„€ôl(€€€€€¡•…‘•ÉÌ¹µ…À ¡Ù…±Õ”¤€ôø€¡ìÙ…±Õ”°™½¹Ñ]•¥¡Ðè€‰‰½±ˆ°‰…­É½Õ¹‘½±½Èè€ˆàˆô¤¤°(€€€€€€¸¸¹É½ÝÌ¹µ…À ¡É½Ü¤€ôøl(€€€€€€€ìÙ…±Õ”èÉ½Ü¹Í•±•Ñ•€ü€‹²ƒ¶tˆ€è€ˆˆô°(€€€€€€€ìÙ…±Õ”èMÑÉ¥¹œ¡É½Ü¹±½½UÉ°ñð€ˆˆ¤ô°(€€€€€€€ìÙ…±Õ”èMÑÉ¥¹œ¡É½Ü¹…ÉÑ¥±•9Õµ‰•Èñð€ˆˆ¤ô°(€€€€€€€ìÙ…±Õ”èMÑÉ¥¹œ¡É½Ü¹Ñ¥Ñ±”ñðÉ½Ü¹¹…µ”ñð€ˆˆ¤ô°(€€€€€€€ìÙ…±Õ”èMÑÉ¥¹œ¡É½Ü¹ÍÁÕ%ñð€ˆˆ¤ô°(€€€€€€€ìÙ…±Õ”èMÑÉ¥¹œ¡É½Ü¹‰É…¹‘9…µ”ñðÉ½Ü¹‰É…¹ñð€ˆˆ¤ô°(€€€€€€€ìÙ…±Õ”èMÑÉ¥¹œ¡É½Ü¹…Ñ•½Éå9…µ”ñðÉ½Ü¹…Ñ•½Éäñð€ˆˆ¤ô°(€€€€€€€É½Ü¹¡…ÍAÉ¥•…Ñ„€ôôô™…±Í”(€€€€€€€€€€üìÙ…±Õ”è€‹®6Ã²vÓ¶Àƒ²^²v0ˆô(€€€€€€€€€€èìÙ…±Õ”è9Õµ‰•È¡É½Ü¹…Ù•É…•AÉ¥”ñð€À¤°ÑåÁ”è9Õµ‰•È°™½Éµ…Ðè€ˆŒ°ŒŒÀˆô°(€€€€€€€É½Ü¹¡…Í	Õå•ÉáÁ½ÍÕÉ•…Ñ„€ôôô™…±Í”(€€€€€€€€€€üìÙ…±Õ”è€‹®6Ã²vÓ¶Àƒ²^²v0ˆô(€€€€€€€€€€èìÙ…±Õ”è9Õµ‰•È¡É½Ü¹‰Õå•ÉáÁ½ÍÕÉ”ñð€À¤°ÑåÁ”è9Õµ‰•È°™½Éµ…Ðè€ˆŒ°ŒŒÀˆô°(€€€€€€€µ•ÑÉ¥•±°¡É½Ü°€‰Ñ½Ñ…±M…±•Ìˆ°€‰Ñ½Ñ…±M…±•ÍI…Üˆ°€‰¡…ÍQ½Ñ…±M…±•Í…Ñ„ˆ¤°(€€€€€€€µ•ÑÉ¥•±°¡É½Ü°€‰±½…±Q½Ñ…±M…±•Ìˆ°€‰±½…±Q½Ñ…±M…±•ÍI…Üˆ°€‰¡…Í1½…±Q½Ñ…±M…±•Í…Ñ„ˆ¤°(€€€€€€€µ•ÑÉ¥•±°¡É½Ü°€‰Í…±•ÌÌÁˆ°€‰Í…±•ÌÌÁ‘I…Üˆ°€‰¡…ÍM…±•Í…Ñ„ˆ¤°(€€€€€€€µ•ÑÉ¥•±°¡É½Ü°€‰±½…±M…±•ÌÌÁˆ°€‰±½…±M…±•ÌÌÁ‘I…Üˆ°€‰¡…Í1½…±M…±•Í…Ñ„ˆ¤°(€€€€€t¤°(€€€tì(€€€…Ý…¥ÐÝÉ¥Ñ•a±Íá¥±”¡mì(€€€€€‘…Ñ„°(€€€€€Í¡••Ðè€‹²¶J ƒªÊ²$ƒªÊÃªÎðˆ°(€€€€€ÍÑ¥­åI½ÝÍ½Õ¹Ðè€Ä°(€€€€€½±Õµ¹Ìèl(€€€€€€€ìÝ¥‘Ñ è€äô°ìÝ¥‘Ñ è€ÌØô°ìÝ¥‘Ñ è€ÈÈô°ìÝ¥‘Ñ è€ØÐô°ìÝ¥‘Ñ è€ÄØô°(€€€€€€€ìÝ¥‘Ñ è€ÈÀô°ìÝ¥‘Ñ è€Èàô°ìÝ¥‘Ñ è€ÈÈô°ìÝ¥‘Ñ è€ÈÈô°ìÝ¥‘Ñ è€ÈÀô°ìÝ¥‘Ñ è€ÈÐô°(€€€€€€€ìÝ¥‘Ñ è€ÈÀô°ìÝ¥‘Ñ è€Èàô°(€€€€€t°(€€€õt¤¹Ñ½¥±”¡É•ÍÕ±Ð¹™¥±•A…Ñ ¤ì(€€€É•ÑÕÉ¸ì…¹•±•è™…±Í”°Á…Ñ èÉ•ÍÕ±Ð¹™¥±•A…Ñ ôì(€ô¤ì((€½¹™¥ÕÉ•UÁ‘…Ñ•È ¤ì(€É•…Ñ•]¥¹‘½Ü ¤ì(€Í•ÑQ¥µ•½ÕÐ  ¤€ôøÙ½¥ÉÕ¹=¹•É¥Ù•I•½Ù•Éå	…­ÕÀ ¤°€Ô€¨€ØÀ€¨€Å|ÀÀÀ¤ì(€Í•Ñ%¹Ñ•ÉÙ…°  ¤€ôøÙ½¥ÉÕ¹=¹•É¥Ù•I•½Ù•Éå	…­ÕÀ ¤°€ÌÀ€¨€ØÀ€¨€Å|ÀÀÀ¤¹Õ¹É•˜ü¸ ¤ì(€Í¡•‘Õ±•]••­±åM¥Ñ•!•…±Ñ¡¡•¬ ¤ì(€€¼¼Õ±°½™™¥¥…°µµ…±°Ù•É¥™¥…Ñ¥½¸¥Ìµ…¹Õ…°µ½¹±ä¸MÑ…ÉÑÕÀ…¹ÕÁ‘…Ñ•ÌµÕÍÐ(€€¼¼¹•Ù•ÈÉ•…Ñ”¥ÑÌ‰É½ÝÍ•ÈÝ¥¹‘½Ü°Ñ¥µ•È°…Ñ…±½œÍå¹Œ°½È¹•ÑÝ½É¬ÑÉ…™™¥Œ¸(€¥˜€¡…ÁÀ¹¥ÍA…­…•¤Í¡•‘Õ±•UÁ‘…Ñ•¡•¬ Õ|ÀÀÀ¤ì(€…ÁÀ¹½¸ ‰…Ñ¥Ù…Ñ”ˆ°€ ¤€ôøì(€€€¥˜€¡	É½ÝÍ•É]¥¹‘½Ü¹•Ñ±±]¥¹‘½ÝÌ ¤¹±•¹Ñ €ôôô€À¤É•…Ñ•]¥¹‘½Ü ¤ì(€ô¤ì)ô¤ì()…ÁÀ¹½¸ ‰Ý¥¹‘½Üµ…±°µ±½Í•ˆ°€ ¤€ôøì(€¥˜€¡ÁÉ½•ÍÌ¹Á±…Ñ™½É´€„ôô€‰‘…ÉÝ¥¸ˆ¤…ÁÀ¹ÅÕ¥Ð ¤ì)ô¤ì)…ÁÀ¹½¸ ‰‰•™½É”µÅÕ¥Ðˆ°€ ¤€ôøì(€¥˜€¡‰É…¹‘áÁ½ÉÑA½±±Q¥µ•È¤±•…É%¹Ñ•ÉÙ…°¡‰É…¹‘áÁ½ÉÑA½±±Q¥µ•È¤ì(€¥˜€¡‰É…¹‘áÁ½ÉÑ5½¹¥Ñ½ÉI•ÍÑ…ÉÑQ¥µ•È¤±•…ÉQ¥µ•½ÕÐ¡‰É…¹‘áÁ½ÉÑ5½¹¥Ñ½ÉI•ÍÑ…ÉÑQ¥µ•È¤ì(€¥˜€¡ÕÁ‘…Ñ•¡•­Q¥µ•È¤±•…ÉQ¥µ•½ÕÐ¡ÕÁ‘…Ñ•¡•­Q¥µ•È¤ì(€¥˜€¡ÕÁ‘…Ñ•%¹ÍÑ…±±Q¥µ•È¤±•…ÉQ¥µ•½ÕÐ¡ÕÁ‘…Ñ•%¹ÍÑ…±±Q¥µ•È¤ì(€¥˜€¡½™™¥¥…±½µ…¥¹Õ‘¥ÑI•ÍÕµ•Q¥µ•È¤±•…ÉQ¥µ•½ÕÐ¡½™™¥¥…±½µ…¥¹Õ‘¥ÑI•ÍÕµ•Q¥µ•È¤ì(€¥˜€¡Ý••­±åM¥Ñ•!•…±Ñ¡Q¥µ•È¤±•…ÉQ¥µ•½ÕÐ¡Ý••­±åM¥Ñ•!•…±Ñ¡Q¥µ•È¤ì)ô¤ì(