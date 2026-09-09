Warning: truncated output (original token count: 151672)
Total output lines: 12091

import { readReviewWorkbook, checkReviewWorkbookRevision } from "./services/poizon-review-workbook.mjs";
import { assertPoizonPageReadyForCorrection, isPoizonSkuScopeDeferredRow, selectPoizonPageCorrectionProducts } from "./services/live-poizon-crosscheck.mjs";
import { syncPoizonPageCheckpoint } from "./services/poizon-page-checkpoint.mjs";
import { createPageCrossCheck, verificationConditionLabel } from "./services/live-poizon-crosscheck.mjs";
import { paintReviewPage as paintSellerVerification } from "./services/poizon-review-paint.mjs";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, nativeTheme, Notification, safeStorage, screen, session, shell } from "electron";
import { mkdirSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { readSheet } from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import { readFirstDataSheet } from "./services/excel-reader.mjs";
import { applyPoizonScreenSalesToWorkbook } from "./services/poizon-screen-excel-sync.mjs";
import {
  findPoizonColumn,
  findPoizonRecentSalesColumns,
  findPoizonTotalSalesColumns,
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
import { sellerPaginationTransitionStatus } from "./services/seller-pagination-state.mjs";
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
import { createDomesticSearchLinkResult, finalizeNaverFashionTownResult, isNaverRenderedResultReady } from "./services/naver-fashiontown-result.mjs";
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
let sellerExcelVerificationLayout = null;
const sellerVerificationActionWaiters = new Map();
const cancelledSellerVerificationRuns = new Set();

function sellerVerificationActionKey(runId, productKey) {
  return `${String(runId || '')}\u0000${String(productKey || '')}`;
}

function waitForSellerVerificationAction(runId, productKey, requiredAction) {
  const key = sellerVerificationActionKey(runId, productKey);
  if (!runId || !productKey || sellerVerificationActionWaiters.has(key)) {
    return Promise.reject(new Error('상품 수정 승인 대기 상태를 만들지 못했습니다.'));
  }
  return new Promise((resolve) => sellerVerificationActionWaiters.set(key, { requiredAction, resolve }));
}

function resolveSellerVerificationAction(input = {}) {
  const key = sellerVerificationActionKey(input.runId, input.productKey);
  const waiter = sellerVerificationActionWaiters.get(key);
  if (!waiter || input.action !== waiter.requiredAction) {
    return { ok:false, message:'현재 상품에 필요한 작업과 일치하지 않습니다.' };
  }
  sellerVerificationActionWaiters.delete(key);
  waiter.resolve(input.action);
  return { ok:true };
}

function cancelSellerExcelVerification(runId) {
  const id = String(runId || '').trim();
  if (!id) return { ok:false, message:'중지할 대조 작업을 찾지 못했습니다.' };
  cancelledSellerVerificationRuns.add(id);
  for (const [key, waiter] of sellerVerificationActionWaiters) {
    if (!key.startsWith(`${id}\u0000`)) continue;
    sellerVerificationActionWaiters.delete(key);
    waiter.resolve('cancel');
  }
  return { ok:true, stopped:true };
}

function beginSellerExcelVerificationWindows(input = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, message: "Around G 메인 창을 찾지 못했습니다." };
  if (!sellerWindow || sellerWindow.isDestroyed()) {
    openSellerCenterWindow(SELLER_CENTER_URL, { visible: false, activate: false });
  }
  if (!sellerWindow || sellerWindow.isDestroyed()) return { ok: false, message: "POIZON 판매자센터 창을 열지 못했습니다." };
  if (!sellerExcelVerificationLayout) {
    sellerExcelVerificationLayout = {
      mainMinimum: mainWindow.getMinimumSize?.() || [1040, 700],
      sellerMinimum: sellerWindow.getMinimumSize?.() || [1000, 700],
      mainBounds: mainWindow.getBounds(),
      mainMaximized: mainWindow.isMaximized(),
      sellerBounds: sellerWindow.getBounds(),
      sellerMaximized: sellerWindow.isMaximized(),
      sellerVisible: sellerWindow.isVisible(),
      sellerOpacity: sellerWindow.getOpacity?.() ?? 1,
    };
  }
  // POIZON navigation and capture continue in its hidden BrowserWindow.
  // A separate review window is the only verification surface shown to users.
  sellerWindow.setSkipTaskbar?.(true);
  sellerWindow.setOpacity?.(0);
  sellerWindow.showInactive();
  mainWindow.show();
  mainWindow.focus();
  return {
    ok: true,
    backgroundSeller: true,
    foregroundReview: true,
    brandName: String(input.brandName || ""),
    fileName: String(input.fileName || ""),
  };
}

function endSellerExcelVerificationWindows() {
  const saved = sellerExcelVerificationLayout;
  sellerExcelVerificationLayout = null;
  if (sellerWindow && !sellerWindow.isDestroyed()) {
    sellerWindow.setOpacity?.(saved?.sellerOpacity ?? 1);
    sellerWindow.setSkipTaskbar?.(false);
    void sellerWindow.webContents.executeJavaScript(`(() => {
      document.getElementById("around-g-live-verification")?.remove();
      for (const row of document.querySelectorAll("[data-around-g-verification]")) {
        if (row.dataset.aroundGReviewStyle) { Object.assign(row.style, JSON.parse(row.dataset.aroundGReviewStyle)); delete row.dataset.aroundGReviewStyle; }
        else { row.style.outline = ""; row.style.outlineOffset = ""; }
        delete row.dataset.aroundGVerification; delete row.dataset.aroundGReviewKey;
      }
    })()`, true).catch(() => {});
  }
  if (!saved) {
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
    return { ok: true, restored: false };
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setMinimumSize?.(...saved.mainMinimum);
    mainWindow.setBounds(saved.mainBounds);
    if (saved.mainMaximized) mainWindow.maximize();
    mainWindow.show();
  }
  if (sellerWindow && !sellerWindow.isDestroyed()) {
    if (sellerWindow.isMaximized()) sellerWindow.unmaximize();
    sellerWindow.setMinimumSize?.(...saved.sellerMinimum);
    sellerWindow.setBounds(saved.sellerBounds);
    if (saved.sellerMaximized) sellerWindow.maximize();
    sellerWindow.hide();
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  return { ok: true, restored: true };
}

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
    const verifiedNaverIdentity = String(product?.sourceStore || product?.store || "") === "네이버 패션타운"
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
    if (store === "네이버 패션타운"
      && product?.domesticSellerVerified === true
      && product?.articleNumberVerified === true) {
      return {
        ...product,
        musinsaImageCompared: false,
        imageVerificationLabel: "네이버 상세 품번 확인",
      };
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
  const exactQuery = sanitizeDomesticProductCode(query) || sanitizeDomesticQuery(query);
  if (!exactQuery) return false;
  const previousUrl = String(searchWindow.webContents.getURL() || homepageUrl);
  const submitted = await submitOfficialMallSearch(searchWindow, exactQuery);
  if (!submitted) return false;
  await wait(2_000);
  return officialMallSearchWasExecuted(searchWindow, exactQuery, previousUrl);
}

async function collectOfficialMallSearchProducts(searchWindow, query) {
  if (!browserWindowUsable(searchWindow)) return [];
  let captureAttempt = 0;
  while (captureAttempt < 16) {
    if (captureAttempt > 0) await wait(500);
    captureAttempt += 1;
    const products = await searchWindow.webContents.executeJavaScript(`(() => {
      const query = ${JSON.stringify(String(query || ""))};
      const compact = (value) => String(value || "").replace(/[^A-Z0-9가-힣]/gi, "").toUpperCase();
      const expected = compact(query);
      const productPath = /\\/(?:goods|product|products|pd|item|shop|p)\\//i;
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const money = (value) => {
        const match = String(value || "").match(/(?:₩|￦|원)\\s*([\\d,]{3,})|([\\d,]{3,})\\s*원/);
        return Number(String(match?.[1] || match?.[2] || "").replace(/,/g, "")) || 0;
      };
      const found = new Map();
      for (const link of [...document.querySelectorAll('a[href]')]) {
        if (!visible(link) || !productPath.test(String(link.href || ""))) continue;
        let card = link.closest('li,article,[class*="product" i],[class*="goods" i],[class*="item" i]') || link;
        const rawText = String(card.innerText || link.innerText || "").replace(/\\s+/g, " ").trim();
        if (!rawText || rawText.length > 1200) continue;
        const image = card.querySelector('img[src]') || link.querySelector('img[src]');
        const heading = card.querySelector('h1,h2,h3,h4,h5,[class*="name" i],[class*="title" i]');
        const title = String(heading?.textContent || image?.alt || link.getAttribute('title') || rawText)
          .replace(/\\s+/g, " ").trim().slice(0, 240);
        const articleMatch = rawText.match(/(?=[A-Z0-9._/-]{4,32}\\b)(?=[A-Z0-9._/-]*[A-Z])(?=[A-Z0-9._/-]*\\d)[A-Z0-9][A-Z0-9._/-]{3,31}/i);
        const articleNumber = articleMatch?.[0] || (expected && compact(rawText).includes(expected) ? query : "");
        const url = String(link.href || "").split('#')[0];
        if (!url || found.has(url)) continue;
        found.set(url, {
          id: url,
          store: "브랜드 공식몰",
          sourceStore: "브랜드 공식몰",
          retailerName: document.title || location.hostname,
          title,
          name: title,
          articleNumber,
          price: money(rawText),
          imageUrl: String(image?.currentSrc || image?.src || ""),
          url,
          inStock: null,
          linkOnly: true,
          officialStoreVerified: Boolean(expected && compact(rawText).includes(expected)),
          sourceTrustLabel: "공식몰 검색 결과",
        });
      }
      return [...found.values()].slice(0, 50);
    })()`, true).catch(() => []);
    if (Array.isArray(products) && products.length) return products;
  }
  return [];
}

function renderedSearchFailure(reason, searchWindow = null, details = {}) {
  const verificationReason = String(reason || "unknown_search_failure");
  const resolvedSearchUrl = String(
    details.resolvedSearchUrl
    || (!searchWindow?.isDestroyed?.() ? searchWindow?.webContents?.getURL?.() : "")
    || "",
  );
  const stageByReason = {
    naver_shopping_click_failed: "naver_navigation",
    fashion_town_click_failed: "naver_navigation",
    search_submission_failed: "search_submission",
    search_query_missing: "search_submission",
    result_parse_failed: "result_capture",
    result_analysis_failed: "result_capture",
    overview_channel_card_collection_failed: "result_capture",
    channel_count_detection_failed: "result_capture",
    page_load_timeout: "page_navigation",
    page_load_failed: "page_navigation",
    network_error: "page_navigation",
    security_verification_required: "access_verification",
    login_required: "access_verification",
  };
  const verificationStage = String(details.verificationStage || stageByReason[verificationReason] || "unknown");
  return {
    count: null,
    products: [],
    searchCompleted: false,
    searchSubmitted: details.searchSubmitted === true,
    verificationReason,
    verificationStage,
    verificationDiagnostics: {
      stage: verificationStage,
      reason: verificationReason,
      resolvedUrl: resolvedSearchUrl,
      errorMessage: String(details.errorMessage || ""),
      visibleResultCount: null,
      productCardCount: 0,
    },
    securityVerificationRequired: details.securityVerificationRequired === true,
    loginRequired: details.loginRequired === true,
    resolvedSearchUrl,
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
              .filter((line) => /판매(?:중)?인?\\s*상품|공식\\s*판매처|브랜드\\s*(?:공식|직영)|공식\\s*(?:브랜드|스토어|온라인몰)|직영\\s*(?:스토어|온라인몰)|관부가세|해외\\s*직구|구매\\s*대행/i.test(line))
              .slice(0, 20).join(" ");
            const titleText = [...document.querySelectorAll('h1,[itemprop="name"],[class*="product" i][class*="title" i],[class*="goods" i][class*="name" i]')]
              .map((element) => String(element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim())
              .filter(Boolean).slice(0, 8).join(" ").slice(0, 2000);
            const identityLabel = /품\\s*번|상품\\s*(?:번호|코드)|제품\\s*(?:번호|코드)|모델\\s*(?:명|번호|코드)?|스타일\\s*(?:번호|코드)?|style\\s*(?:no|number|code)?|model\\s*(?:no|number|code)?|sku|mpn/i;
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
        JSON.stringify(snapshot), "네이버 패션타운", articleNumber, brand, title,
      );
      const candidates = (analyzed?.products || [])
        .filter((candidate) => Number(candidate?.price || 0) > 0)
        .sort((left, right) => Number(left.price) - Number(right.price))
        .slice(0, 5);
      if (candidates.length) {
        const approvedCandidates = await filterApprovedNaverDomesticProducts(candidates);
        if (approvedCandidates.length) return { ok: true, searchUrl, candidates: approvedCandidates };
        return { ok: true, searchUrl, candidates: [], message: "승인된 국내 정품 판매처 상품이 없습니다." };
      }
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
    // Reaching the exact query result URL proves the input and magnifier action
    // succeeded. Final capture decides product presence or authoritative zero.
    if (isNaverRenderedResultReady(state, exactQuery)) return true;
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
    const target = await searchWindow.webContents.executeJa…91672 tokens truncated…andNames);
  // Reuse the proven POIZON 상품정보 workflow first: focus the same top
  // product-search input, type with Electron's real keyboard events and click
  // 검색 및 입찰 with real pointer events. The exact brand dropdown remains a
  // compatibility fallback for Seller Center layouts without that input.
  const existingBrandSearch = await typeSellerBrandWithRealKeyboard(
    sellerWindow.webContents.mainFrame,
    sellerBrandSearchName,
  ).catch(() => ({ ok: false, step: "REAL_KEYBOARD_INPUT_FAILED" }));
  const selected = existingBrandSearch?.ok
    ? { ok: true, selected: sellerBrandSearchName, route: "EXISTING_POIZON_BRAND_SEARCH" }
    : await sellerWindow.webContents.executeJavaScript(`(async () => {
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
    return {
      ok: false,
      code: "SELLER_BRAND_SEARCH_FAILED",
      message: `판매자센터 브랜드 검색을 실행하지 못했습니다. (${selected?.reason || selected?.step || "UNKNOWN"})`,
    };
  }
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
  // Start at the first 20-row page. Synchronization physically visits every
  // bottom pagination tab so every value visible in Seller Center is checked.
  await sellerWindow.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => element && element.getClientRects().length > 0;
    const active = [...document.querySelectorAll(".ant-pagination-item-active")].find(visible);
    if (Number(active?.textContent.trim()) === 1) return true;
    const first = [...document.querySelectorAll(".ant-pagination-item")]
      .find((element) => visible(element) && Number(element.textContent.trim()) === 1);
    const button = first?.querySelector("button,a") || first;
    if (!button) return false;
    button.click();
    for (let attempt = 0; attempt < 32; attempt += 1) {
      await wait(250);
      const current = [...document.querySelectorAll(".ant-pagination-item-active")].find(visible);
      if (Number(current?.textContent.trim()) === 1) {
        await wait(450);
        return true;
      }
    }
    return false;
  })()`, true);
  await wait(sellerPageSettleMs);
  const pages = [];
  let sellerSourceTotal = 0;
  let capturedRowCount = 0;
  let pageTransitionFailure = null;
  let lastCapturedPage = 0;
  let expectedPageCount = 1;
  const capturedPageSignatures = new Set();
  const bulkCorrectionApproval = checkpointSummary.enabled
    ? waitForSellerVerificationAction(input.verification.runId, '__ALL__', 'auto')
    : Promise.resolve('auto');
  let bulkCorrectionApproved = !checkpointSummary.enabled;
  for (let page = 1; page <= 1_000; page += 1) {
    assertVerificationRunning();
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
      const pagination = [...document.querySelectorAll(".ant-pagination")]
        .filter((element) => visible(element) && element.querySelector(".ant-pagination-next"))
        .at(-1);
      const next = pagination?.querySelector(".ant-pagination-next");
      const activePage = pagination?.querySelector(".ant-pagination-item-active");
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
        pageSize,
        totalCount,
        rowSignature: rows.map((row) => String(row.text || "").replace(/\\s+/g, " ").trim()).join("␞")
      };
    })()`, true);
    if (Number(capture.currentPage || 0) !== page) {
      pageTransitionFailure = { page: capture.currentPage, expectedPage: page, reason: "ACTIVE_PAGE_MISMATCH" };
      break;
    }
    if (capturedPageSignatures.has(capture.rowSignature)) {
      pageTransitionFailure = { page: capture.currentPage, expectedPage: page, reason: "DUPLICATE_PAGE_ROWS" };
      break;
    }
    capturedPageSignatures.add(capture.rowSignature);
    pages.push(capture.rows || []);
    capturedRowCount += Number(capture.rows?.length || 0);
    sellerSourceTotal = Math.max(sellerSourceTotal, Number(capture.totalCount || 0));
    lastCapturedPage = Number(capture.currentPage || 0);
    expectedPageCount = Math.max(expectedPageCount, Number(capture.pageCount || 1));
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
    // Compare the actual current page against the unfiltered workbook BEFORE
    // the next pagination click. Only the view, never source capture, is filtered.
    if (liveVerifier) {
      const currentPageProducts = mergeSellerBrandPages([capture.rows || []]);
      let livePage;
      // Walk the visible page one product at a time. Excel row order is never
      // used: acceptPage resolves every item against the full workbook by SPU.
      for (let productIndex = 0; productIndex < currentPageProducts.length; productIndex += 1) {
        livePage = liveVerifier.acceptPage(currentPageProducts.slice(0, productIndex + 1), {
          pageNum: capture.currentPage, pageCount: capture.pageCount,
        });
        livePage.activeKey = livePage.rows.at(-1)?.key || '';
        livePage.pageReadCount = productIndex + 1;
        livePage.pageProductCount = currentPageProducts.length;
        mainWindow?.webContents.send("seller:verification-progress", livePage);
        await sellerWindow.webContents.executeJavaScript(
          "(" + paintSellerVerification.toString() + ")(document," + JSON.stringify({
            ...livePage, label: "공통 검증 조건: " + verificationConditionLabel(liveVerifier.conditions),
          }) + ")", true,
        );
        const currentRow = livePage.rows.at(-1);
        if (!currentRow) {
          throw new Error(`POIZON ${capture.currentPage}페이지 · ${currentRow?.status || '상품 확인 필요'} · 현재 상품에서 중단합니다.`);
        }
        if (currentRow.autoCorrectionBlocked) {
          if (!isPoizonSkuScopeDeferredRow(currentRow)) {
            throw new Error(`POIZON ${capture.currentPage}페이지 · ${currentRow.status || '상품 확인 필요'} · 현재 상품에서 중단합니다.`);
          }
          mainWindow?.webContents.send("seller:verification-progress", {
            runId: input.verification.runId, phase: 'product-action-complete',
            activeKey: currentRow.key, productKey: currentRow.key,
            pageNum: capture.currentPage, pageCount: capture.pageCount,
            message: '옵션별 판매량 확인 · SPU 자동수정 제외 · Excel 원본 유지 및 검증 완료 · OK',
          });
          await wait(180);
          continue;
        }
        if (!currentRow.equal) {
          const requiredAction = currentRow.matched ? 'correct' : 'add';
          if (!bulkCorrectionApproved) {
            mainWindow?.webContents.send("seller:verification-progress", {
              runId: input.verification.runId, phase: 'bulk-action-required',
              activeKey: currentRow.key, productKey: currentRow.key, requiredAction,
              pageNum: capture.currentPage, pageCount: capture.pageCount,
              message: '수정·추가 대상이 있습니다. 전체 자동 수정 시작을 한 번만 눌러 주세요.',
            });
            const approvalResult = await bulkCorrectionApproval;
            if (approvalResult === 'cancel') throw new Error('사용자가 상품 대조를 중지했습니다. 완료된 페이지까지 저장되었습니다.');
            bulkCorrectionApproved = true;
          }
          mainWindow?.webContents.send("seller:verification-progress", {
            runId: input.verification.runId, phase: 'product-action-required',
            activeKey: currentRow.key, productKey: currentRow.key,
            requiredAction,
            pageNum: capture.currentPage, pageCount: capture.pageCount,
            message: requiredAction === 'add' ? '현재 페이지 일괄 상품 추가 대기' : '현재 페이지 일괄 값 수정 대기',
          });
        }
        await wait(180);
      }
      if (!livePage || livePage.rows.length !== currentPageProducts.length) {
        throw new Error(`POIZON ${capture.currentPage}페이지 상품 ${currentPageProducts.length}개 전체 인식을 완료하지 못했습니다.`);
      }
      if (typeof checkpointSummary !== 'undefined' && checkpointSummary.enabled) {
        mainWindow?.webContents.send("seller:verification-progress", {
          runId: input.verification.runId, phase: "page-checkpoint",
          message: `POIZON ${capture.currentPage}/${capture.pageCount}페이지 · Excel 반영 및 저장 후 재검증 중`,
        });
        // POIZON_SKU_SAFE_PAGE_SELECTION: SKU-only Excel values are preserved and deferred.
        // Only same-scope SPU evidence or true missing rows may be written on this page.
        const pageCorrection = selectPoizonPageCorrectionProducts(currentPageProducts, livePage.rows, capture.currentPage);
        const checkpoint = pageCorrection.products.length
          ? await syncPoizonPageCheckpoint({
              filePath: checkpointSummary.filePath,
              products: pageCorrection.products,
              pageNum: capture.currentPage,
              backupPath: checkpointSummary.backupPath,
            })
          : { ok: true, reverified: true, changedRows: 0, changedCells: 0, addedRows: 0, addedProducts: 0, verifiedCells: 0, changes: [], backupPath: checkpointSummary.backupPath };
        checkpoint.deferredProducts = Number(pageCorrection.deferredProducts || 0);
        if (!checkpoint?.ok || checkpoint.reverified !== true) {
          throw new Error(checkpoint?.message || `POIZON ${capture.currentPage}페이지 Excel 체크포인트에 실패했습니다.`);
        }
        checkpointSummary.backupPath = checkpoint.backupPath || checkpointSummary.backupPath;
        checkpointSummary.changedRows += Number(checkpoint.changedRows || 0);
        checkpointSummary.changedCells += Number(checkpoint.changedCells || 0);
        checkpointSummary.addedRows += Number(checkpoint.addedRows || 0);
        checkpointSummary.addedProducts += Number(checkpoint.addedProducts || 0);
        checkpointSummary.verifiedCells += Number(checkpoint.verifiedCells || 0);
        checkpointSummary.deferredProducts += Number(checkpoint.deferredProducts || 0);
        checkpointSummary.changes.push(...(checkpoint.changes || []));
        checkpointPages.add(Number(capture.currentPage));
        checkpointSummary.pagesCompleted = checkpointPages.size;
        for (const row of livePage.rows.filter((item) => !item.equal && !item.autoCorrectionBlocked)) {
          mainWindow?.webContents.send("seller:verification-progress", {
            runId: input.verification.runId, phase: 'product-action-complete',
            activeKey: row.key, productKey: row.key,
            pageNum: capture.currentPage, pageCount: capture.pageCount,
            message: row.matched ? '페이지 일괄 값 수정 및 재검증 완료 · OK' : '페이지 일괄 상품 추가 및 재검증 완료 · OK',
          });
        }
        mainWindow?.webContents.send("seller:verification-progress", {
          runId: input.verification.runId, phase: "page-checkpoint-complete",
          activeKey: '', pageNum: capture.currentPage, pageCount: capture.pageCount,
          message: `POIZON ${capture.currentPage}/${capture.pageCount}페이지 확정 · 상품 ${currentPageProducts.length}개 · 수정 ${Number(checkpoint.changedRows || 0)}행 · 실제 누락 추가 ${Number(checkpoint.addedRows || 0)}행 · 옵션 비교 보류 ${Number(checkpoint.deferredProducts || 0)}개 · 저장 후 재검증 완료`,
        });
        await sellerWindow.webContents.executeJavaScript(
          "(" + paintSellerVerification.toString() + ")(document," + JSON.stringify({
            ...livePage, activeKey: '', label: "공통 검증 조건: " + verificationConditionLabel(liveVerifier.conditions),
          }) + ")", true,
        );
      }
    }
    reportCaptureProgress({
      percent: capture.hasNext
        ? Math.min(99, 70 + Math.round((capture.currentPage / Math.max(capture.currentPage, capture.pageCount || capture.currentPage)) * 29))
        : 99,
      count: products.length,
      pageNum: capture.currentPage,
      pageCount: capture.pageCount,
      message: `판매자센터 현지 30일 판매량 수집 ${capture.currentPage}/${capture.pageCount}페이지`,
    });
    if (!capture.hasNext) break;
    if (capture.currentPage % sellerBatchPauseEvery === 0) {
      reportCaptureProgress({
        percent: Math.min(99, 70 + Math.round((capture.currentPage / Math.max(capture.currentPage, capture.pageCount || capture.currentPage)) * 29)),
        count: products.length,
        pageNum: capture.currentPage,
        pageCount: capture.pageCount,
        message: `판매자센터 ${capture.currentPage}페이지 완료 · 서버 보호를 위해 45초 휴식 중`,
      });
      await waitVerification(sellerBatchPauseMs);
    } else {
      await waitVerification(sellerPageDelayMs);
    }
    const expectedNextPage = capture.currentPage + 1;
    const expectedNextRowCount = Number(capture.totalCount || 0) > 0 && Number(capture.pageSize || 0) > 0
      ? expectedNextPage < Number(capture.pageCount || expectedNextPage)
        ? Number(capture.pageSize)
        : Math.max(1, Number(capture.totalCount) - (Number(capture.pageSize) * (Number(capture.pageCount) - 1)))
      : 0;
    let advanced = false;
    // Ant pagination changes the visible number range after page 5. A DOM
    // element.click() at that boundary is occasionally ignored by React, so
    // scroll the exact control into view and send a real Electron mouse click.
    // Retry transient page loads without discarding the pages already checked.
    for (let clickAttempt = 0; clickAttempt < 5 && !advanced; clickAttempt += 1) {
      const targetPoint = await sellerWindow.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const visible = (element) => element && element.getClientRects().length > 0;
        const expected = ${expectedNextPage};
        const pagination = [...document.querySelectorAll(".ant-pagination")]
          .filter((element) => visible(element) && Number(element.querySelector(".ant-pagination-item-active")?.textContent.trim()) === ${capture.currentPage})
          .at(-1);
        const directPage = [...(pagination || document).querySelectorAll(".ant-pagination-item")]
          .find((item) => visible(item) && Number(item.textContent.trim()) === expected);
        const next = [...(pagination || document).querySelectorAll(".ant-pagination-next:not(.ant-pagination-disabled)")]
          .find(visible);
        const target = directPage || next;
        const button = target?.querySelector("button,a") || target;
        if (!button) return null;
        button.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        await wait(150);
        const rect = button.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return null;
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          route: directPage ? "DIRECT_PAGE" : "NEXT_ARROW"
        };
      })()`, true);
      if (!targetPoint) continue;
      reportCaptureProgress({
        percent: Math.min(99, 70 + Math.round((capture.currentPage / Math.max(capture.currentPage, capture.pageCount || capture.currentPage)) * 29)),
        count: products.length,
        pageNum: capture.currentPage,
        pageCount: capture.pageCount,
        message: clickAttempt > 0
          ? `판매자센터 ${expectedNextPage}페이지 이동 재시도 ${clickAttempt + 1}/5`
          : `판매자센터 ${expectedNextPage}/${capture.pageCount}페이지로 이동 중`,
      });
      await physicalSellerPointClick(targetPoint, 300);
      for (let attempt = 0; attempt < sellerPageResponseAttempts; attempt += 1) {
        await wait(250);
        const nextState = await sellerWindow.webContents.executeJavaScript(
          `(() => {
            const visible = (element) => element && element.getClientRects().length > 0;
            const pagination = [...document.querySelectorAll(".ant-pagination")]
              .filter((element) => visible(element) && element.querySelector(".ant-pagination-next"))
              .at(-1);
            const active = pagination?.querySelector(".ant-pagination-item-active");
            const rows = [...document.querySelectorAll("table tbody tr")]
              .filter(visible)
              .map((row) => String(row.innerText || ""))
              .filter((text) => /상품\\s*번호\\s*[:：]/.test(text));
            return {
              page: Number(active?.textContent.trim()) || 0,
              rowCount: rows.length,
              rowSignature: rows.map((text) => text.replace(/\\s+/g, " ").trim()).join("␞")
            };
          })()`,
          true,
        );
        const transition = sellerPaginationTransitionStatus({
          expectedPage: expectedNextPage,
          currentPage: nextState?.page,
          rowCount: nextState?.rowCount,
          expectedRowCount: expectedNextRowCount,
          previousSignature: capture.rowSignature,
          currentSignature: nextState?.rowSignature,
        });
        if (transition.ready) {
          advanced = true;
          break;
        }
      }
    }
    if (!advanced) {
      // Final compatibility fallback for layouts that reject physical events.
      advanced = await sellerWindow.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const visible = (element) => element && element.getClientRects().length > 0;
        const expected = ${expectedNextPage};
        const pagination = [...document.querySelectorAll(".ant-pagination")]
          .filter((element) => visible(element) && Number(element.querySelector(".ant-pagination-item-active")?.textContent.trim()) === ${capture.currentPage})
          .at(-1);
        const item = [...(pagination || document).querySelectorAll(".ant-pagination-item")]
          .find((element) => visible(element) && Number(element.textContent.trim()) === expected);
        const next = [...(pagination || document).querySelectorAll(".ant-pagination-next:not(.ant-pagination-disabled)")]
          .find(visible);
        const target = item || next;
        const button = target?.querySelector("button,a") || target;
        if (!button) return false;
        button.click();
        for (let attempt = 0; attempt < ${sellerPageResponseAttempts}; attempt += 1) {
          await wait(250);
          const currentPagination = [...document.querySelectorAll(".ant-pagination")]
            .filter((element) => visible(element) && element.querySelector(".ant-pagination-next"))
            .at(-1);
          const active = currentPagination?.querySelector(".ant-pagination-item-active");
          const rows = [...document.querySelectorAll("table tbody tr")]
            .filter(visible)
            .map((row) => String(row.innerText || ""))
            .filter((text) => /상품\\s*번호\\s*[:：]/.test(text));
          const rowSignature = rows.map((text) => text.replace(/\\s+/g, " ").trim()).join("␞");
          if (Number(active?.textContent.trim()) === expected
            && rows.length >= Math.max(1, ${expectedNextRowCount})
            && rowSignature !== ${JSON.stringify(capture.rowSignature || "")}) return true;
        }
        return false;
      })()`, true);
    }
    if (!advanced) {
      pageTransitionFailure = { page: capture.currentPage, expectedNextPage, reason: "NEXT_PAGE_NOT_VERIFIED" };
      break;
    }
    await wait(sellerPageSettleMs);
  }
  const paginationComplete = !pageTransitionFailure
    && lastCapturedPage >= expectedPageCount;
  const rowCountComplete = !sellerSourceTotal || capturedRowCount >= sellerSourceTotal;
  if (!paginationComplete || !rowCountComplete) {
    const reachedLastPage = !pageTransitionFailure && lastCapturedPage >= expectedPageCount;
    stopBrandNetworkCapture();
    return {
      ok: false,
      code: reachedLastPage ? "SELLER_ROW_COUNT_INCOMPLETE" : "SELLER_PAGINATION_INCOMPLETE",
      message: reachedLastPage
        ? `판매자센터 ${lastCapturedPage}/${expectedPageCount}페이지까지 모두 확인했지만 화면 상품을 ${capturedRowCount}/${sellerSourceTotal}건만 읽었습니다. 누락 행을 재확인해야 하므로 부분 데이터는 저장하지 않습니다.`
        : `판매자센터 하단 페이지 검증이 ${lastCapturedPage}/${expectedPageCount}페이지에서 중단되었습니다. 다음 페이지를 90초씩 재시도했지만 응답하지 않았습니다. 부분 데이터는 저장하지 않습니다.`,
      sourceTotal: sellerSourceTotal,
      capturedRowCount,
      pageTransitionFailure,
    };
  }
  const expectedBrands = new Set(
    [selected.selected, input.brandKo, input.brandName]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const domProducts = mergeSellerBrandPages(pages);
  const allProducts = input.verification?.screenOnly ? domProducts : mergeSellerBrandProducts(domProducts, networkSellerProducts);
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
  sellerVerificationActionWaiters.delete(sellerVerificationActionKey(input.verification?.runId, '__ALL__'));
  stopBrandNetworkCapture();
  if (!sellerExcelVerificationLayout && sellerWindow && !sellerWindow.isDestroyed()) sellerWindow.hide();
  mainWindow?.show();
  mainWindow?.focus();
  return {
    ok: true,
    products,
    total: products.length,
    sourceTotal: sellerSourceTotal || products.length,
    capturedRowCount,
    missingCount: Math.max(0, (sellerSourceTotal || products.length) - products.length),
    checkpointSync: { ...checkpointSummary, changes: [...checkpointSummary.changes] },
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
  const previousVersion = String(store.snapshot()?.settings?.lastLaunchedVersion || "");
  const currentVersion = app.getVersion();
  if (app.isPackaged && previousVersion && previousVersion !== currentVersion) {
    await addProgramNotification({
      type: "success", title: "업데이트 설치 완료",
      message: `Around G v${currentVersion} 업데이트가 완료되었습니다.`,
      key: `update:installed:${currentVersion}`, windows: true,
    });
  }
  await store.setSettings({ lastLaunchedVersion: currentVersion });
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
  ipcMain.handle("notifications:list", () => {
    const items = store.snapshot()?.settings?.programNotifications;
    return Array.isArray(items) ? items : [];
  });
  ipcMain.handle("notifications:mark-read", async () => {
    const items = Array.isArray(store.snapshot()?.settings?.programNotifications)
      ? store.snapshot().settings.programNotifications : [];
    const programNotifications = items.map((item) => ({ ...item, read: true }));
    await store.setSettings({ programNotifications });
    return programNotifications;
  });
  ipcMain.handle("notifications:clear", async () => {
    await store.setSettings({ programNotifications: [] });
    return [];
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
    if (typeof config.ledgerWebhookUrl === "string") next.ledgerWebhookUrl = config.ledgerWebhookUrl.trim();
    if (config.ledgerSecret) next.ledgerSecretEncrypted = encrypted(config.ledgerSecret);
    await store.setSettings(next);
    return publicConfig();
  });
  ipcMain.handle("ledger:open-musinsa", () => openMusinsaLedgerWindow());
  ipcMain.handle("ledger:capture-musinsa", () => captureMusinsaLedgerOrder());
  ipcMain.handle("ledger:sync", (_event, input) => syncPurchaseLedger(input));
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
  ipcMain.handle("official-domain:audit-start", async (_event, options = {}) => {
    clearTimeout(officialDomainAuditResumeTimer);
    officialDomainAuditResumeTimer = null;
    if (!officialDomainAuditRunning) void runOfficialDomainAudit({ recheckAll: options?.recheckAll === true });
    const settings = store.snapshot().settings;
    const registry = await ensureOfficialDomainRegistry(settings.brandCatalog || explorerMetadata().brands);
    return { ok: true, audit: officialDomainAuditSnapshot(registry, { running: true, state: "running" }) };
  });
  ipcMain.handle("official-domain:audit-stop", async () => {
    officialDomainAuditStopRequested = true;
    officialDomainAuditAbortCurrent?.();
    officialDomainAuditAbortCurrent = null;
    if (officialDomainAuditWindow && !officialDomainAuditWindow.isDestroyed()) {
      officialDomainAuditWindow.destroy();
    }
    officialDomainAuditWindow = null;
    clearTimeout(officialDomainAuditResumeTimer);
    officialDomainAuditResumeTimer = null;
    // Wait for the audit loop's abort race and cleanup, allowing an immediate
    // Continue click to start exactly one replacement worker.
    const stopDeadline = Date.now() + 2_000;
    while (officialDomainAuditRunning && Date.now() < stopDeadline) await wait(25);
    const settings = store.snapshot().settings;
    const brands = settings.brandCatalog || explorerMetadata().brands;
    const registry = await ensureOfficialDomainRegistry(brands);
    const savedAudit = store.snapshot().settings.officialDomainAudit || {};
    const pausedAudit = {
      ...savedAudit,
      state: "paused",
      currentBrand: "",
      blocked: false,
      phase: "paused",
      updatedAt: new Date().toISOString(),
    };
    await persistOfficialDomainAudit(registry, pausedAudit);
    const audit = sendOfficialDomainAuditProgress(registry, { ...pausedAudit, running: false });
    return { ok: true, audit };
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
  ipcMain.handle("seller:excel-verification-start", (_event, input = {}) => beginSellerExcelVerificationWindows(input));
  ipcMain.handle("seller:excel-verification-cancel", (_event, runId) => cancelSellerExcelVerification(runId));
  ipcMain.handle("seller:verification-action", (_event, input = {}) => resolveSellerVerificationAction(input));
  ipcMain.handle("seller:excel-verification-end", () => endSellerExcelVerificationWindows());
  ipcMain.handle("seller:capture-brand-sales", (_event, input = {}) => captureSellerBrandSales(input));
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
  ipcMain.handle("excel:review-snapshot", (_event, input = {}) => readReviewWorkbook(input, buildExcelPreviewProducts));
  ipcMain.handle("excel:review-revision", (_event, input = {}) => checkReviewWorkbookRevision(input));
  ipcMain.handle("excel:preview", async (_event, input = {}) => {
    try {
      return await previewExcelFile(input);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  const screenSyncFilesInProgress = new Set();
  ipcMain.handle("excel:sync-seller-screen", async (_event, input = {}) => {
    const filePath = String(input?.path || "").trim();
    if (!filePath || !/\.xlsx$/i.test(filePath)) return { ok: false, message: "수정할 원본 Excel 경로가 올바르지 않습니다." };
    const lock = resolve(filePath).toLowerCase();
    if (screenSyncFilesInProgress.has(lock)) return { ok: false, message: "동일 Excel 파일을 저장 중입니다." };
    screenSyncFilesInProgress.add(lock);
    let temporary = "";
    try {
      const original = await readFile(filePath);
      const products = Array.isArray(input.products) ? input.products : [];
      const applied = applyPoizonScreenSalesToWorkbook(original, products);
      const { buffer, ...summary } = applied;
      if (!applied.ok || !applied.changed) return { ...summary, path: filePath };
      const stamp = new Date().toISOString().replace(/[-:.]/g, "") + "-" + Math.random().toString(36).slice(2);
      const backupPath = `${filePath}.before-poizon-screen-sync-${stamp}.bak`;
      temporary = `${filePath}.poizon-${stamp}.tmp`;
      await writeFile(temporary, buffer, { flag: "wx" });
      const persisted = await readFile(temporary);
      if (!persisted.equals(buffer)) throw new Error("임시 Excel 저장 내용이 일치하지 않습니다.");
      await readFirstDataSheet(persisted);
      const checked = applyPoizonScreenSalesToWorkbook(persisted, products);
      if (!checked.ok || checked.changed || checked.matchedRows !== applied.matchedRows) throw new Error("저장 후 판매량 재검증에 실패했습니다.");
      if (!(await readFile(filePath)).equals(original)) throw new Error("검증 도중 원본 Excel이 변경되어 덮어쓰지 않았습니다.");
      await writeFile(backupPath, original, { flag: "wx" });
      await writeFile(backupPath + ".json", JSON.stringify({ verifiedAt: new Date().toISOString(), scope: "POIZON screen source-of-truth recent30", ...summary }, null, 2), { flag: "wx" });
      await rename(temporary, filePath);
      temporary = "";
      excelPreviewCache.clear();
      const info = await stat(filePath);
      return { ...summary, path: filePath, backupPath, auditPath: backupPath + ".json", fileSize: info.size, fileTime: info.mtimeMs };
    } catch (error) {
      return { ok: false, code: "EXCEL_SAFE_SYNC_FAILED", message: error.message };
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
      screenSyncFilesInProgress.delete(lock);
    }
  });
  ipcMain.handle("brand-export:list-files", (_event, options = {}) => listBrandExportFiles({
    emitRecoveryProgress: options?.recoveryProgress === true,
  }));
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
      const beforeExcel = popularCompleteness(products, limit);
      if (!beforeExcel.complete) {
        return {
          ok: false,
          code: "POPULAR_EXCEL_INCOMPLETE",
          missing: beforeExcel.missingRanks,
          message: `인기상품 ${beforeExcel.captured}/${limit}개만 확인되어 불완전한 Excel은 저장하지 않습니다.`,
        };
      }
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
      const afterExcel = popularCompleteness(imported, limit);
      if (!afterExcel.complete) {
        return {
          ok: false,
          code: "POPULAR_EXCEL_ROUNDTRIP_INCOMPLETE",
          path: filePath,
          missing: afterExcel.missingRanks,
          message: `Excel 재검증 결과 ${afterExcel.captured}/${limit}개만 확인되어 목록에 반영하지 않습니다.`,
        };
      }
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
  ipcMain.handle("explorer:query", async (_event, input) => {
    const settings = store.snapshot().settings;
    const catalog = settings.brandCatalog || explorerMetadata().brands;
    const requestedBrandIds = (Array.isArray(input?.brandIds) ? input.brandIds : []).map(Number).filter(Number.isFinite);
    const catalogById = new Map(catalog.map((brand) => [Number(brand.id), brand]));
    const categoryBrands = input?.mode === "category"
      ? requestedBrandIds.map((id) => catalogById.get(id)).filter(Boolean)
      : [];
    const requestGeneration = categorySearchGeneration;
    const queryInput = {
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
    };
    const apiResult = await queryExplorer(secretConfig(), queryInput);
    if (apiResult?.ok || input?.mode !== "category" || categoryBrands.length !== 1) return apiResult;
    const [brand] = categoryBrands;
    const publicResult = await queryPublicBrandProducts({
      ...queryInput,
      brandId: brand.id,
      brandName: brand.name || brand.ko || "",
      brandUrl: brand.productUrl || "",
    });
    return publicResult?.ok ? publicResult : {
      ...apiResult,
      fallbackError: publicResult?.error || null,
    };
  });
  ipcMain.handle("external:open", async (_event, url) => {
    return openExternalInChromeTab(url);
  });
  ipcMain.handle("official:open-internal-search", async (_event, input) => {
    try {
      return await openOfficialMallInternalSearch(input?.homepageUrl, input?.query);
    } catch (error) {
      const message = String(error?.message || error || "");
      if (/Object has been destroyed|Render frame was disposed|WebContents was destroyed/i.test(message)) {
        return closedInternalSearchResult("ipc_boundary");
      }
      throw error;
    }
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
