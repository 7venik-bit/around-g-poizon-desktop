const $ = (selector) => document.querySelector(selector);
const money = (value) => `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
let state = { products: [], ledger: [], orders: [], favorites: [] };
let entryCollection = "ledger";
let explorerMeta = { brands: [], categories: [] };
let selectedBrandId = null;
let selectedCategory = "전체";
let currentExplorerProducts = [];
const domesticResults = new Map();
const selectedExplorerKeys = new Set();
let domesticBatchRunning = false;
let domesticBatchVerifyCounts = false;
let brandProgressActive = false;
let brandWorkbenchProducts = [];
let selectedBrandName = localStorage.getItem("around-g-selected-brand-name") || "";
let selectedBrandIds = new Set();
let brandSelectionHistory = [];
let brandExportQueue = [];
let brandExportFailureCount = 0;
let brandBatchTotal = 0;
const brandBatchStates = new Map();
const BRAND_AUTOMATION_TIMEOUT_MS = 20 * 60 * 1000;
const BRAND_INPUT_RETRY_DELAY_MS = 60 * 1000;
const BRAND_INPUT_RETRY_LIMIT = 2;
let activeExportBrand = null;
let brandSelectionBusy = false;
const brandExportJobs = new Map();
let downloadedBrandFiles = [];
let brandCompletedShowAll = false;
let activeExcelPreview = null;
let excelPreviewRequestId = 0;
const selectedExcelPreviewProducts = new Set();
let activeExcelPreviewPath = "";
let excelFilesListScrollPosition = 0;
let excelPreviewProductMode = true;
let excelPreviewPageProducts = [];
let excelPreviewPageKeys = [];
let excelPreviewBatchSearching = false;
const excelPreviewProductCache = new Map();
const excelPreviewSearchResults = new Map();
const detectedBrandImportQueue = [];
const queuedBrandImportPaths = new Set();
const completedBrandImportPaths = new Set();
const completedBrandImportJobIds = new Set();
let detectedBrandImportRunning = false;
let brandWorkHistoryGeneration = 0;
let acceptBrandWorkEvents = true;
let brandActivityTimer = null;
let brandActivityStartedAt = 0;
let brandActivityUpdatedAt = 0;
let brandActivityMessage = "";
let brandMainAllComplete = false;
const WORK_HISTORY_RESET_KEY = "around-g-work-history-reset-v2.10.4";
const BRAND_INTEGRITY_MIGRATION_KEY = "around-g-brand-integrity-v2";
const DOWNLOAD_STATUS_MIGRATION_KEY = "around-g-download-status-v2.10.29";
const LIVE_JOB_UI_MIGRATION_KEY = "around-g-live-job-ui-v2.10.34";

function renderBrandExportFolder(folder = "") {
  const path = $("#brand-export-folder-path");
  if (!path) return;
  const normalizedFolder = String(folder || "").trim();
  path.textContent = normalizedFolder
    ? `브랜드별 저장 폴더: ${normalizedFolder}\\브랜드명`
    : "원본 Excel 저장 폴더가 설정되지 않았습니다.";
  path.title = normalizedFolder || "원본 Excel 저장 폴더가 설정되지 않았습니다.";
}

if (localStorage.getItem(WORK_HISTORY_RESET_KEY) !== "done") {
  [
    "around-g-selected-brand-name",
    "around-g-selected-brand-ids",
    "around-g-brand-selection-history",
    "around-g-brand-download-files",
  ].forEach((key) => localStorage.removeItem(key));
  localStorage.setItem(WORK_HISTORY_RESET_KEY, "done");
  selectedBrandName = "";
}

if (localStorage.getItem(DOWNLOAD_STATUS_MIGRATION_KEY) !== "done") {
  // v2.10.27 could persist a validation result as the last visible job state.
  // The download UI now reports only whether the data-center file was received,
  // so discard that legacy state before the startup restore can render it.
  localStorage.removeItem("around-g-last-brand-export-job");
  localStorage.setItem(DOWNLOAD_STATUS_MIGRATION_KEY, "done");
}

if (localStorage.getItem(LIVE_JOB_UI_MIGRATION_KEY) !== "done") {
  // A renderer restart cannot prove that a previously persisted POIZON job is
  // still active. Restoring that number made an old brand look like the newly
  // selected brand, so live jobs now exist only for the current app process.
  localStorage.removeItem("around-g-last-brand-export-job");
  localStorage.setItem(LIVE_JOB_UI_MIGRATION_KEY, "done");
}

try {
  selectedBrandIds = new Set(JSON.parse(localStorage.getItem("around-g-selected-brand-ids") || "[]").map(Number));
  brandSelectionHistory = JSON.parse(localStorage.getItem("around-g-brand-selection-history") || "[]");
  downloadedBrandFiles = JSON.parse(localStorage.getItem("around-g-brand-download-files") || "[]");
  if (!Array.isArray(downloadedBrandFiles)) downloadedBrandFiles = [];
  if (localStorage.getItem(BRAND_INTEGRITY_MIGRATION_KEY) !== "done") {
    // Older builds could save Jordan rows under an Adidas filename. Preserve the
    // original Excel files, but discard their unverified UI history.
    downloadedBrandFiles = [];
    localStorage.removeItem("around-g-brand-download-files");
    localStorage.removeItem("around-g-last-brand-export-job");
    localStorage.setItem(BRAND_INTEGRITY_MIGRATION_KEY, "done");
  }
} catch {
  selectedBrandIds = new Set();
  brandSelectionHistory = [];
  downloadedBrandFiles = [];
}

function saveBrandSelections() {
  localStorage.setItem("around-g-selected-brand-ids", JSON.stringify([...selectedBrandIds]));
  localStorage.setItem("around-g-brand-selection-history", JSON.stringify(brandSelectionHistory.slice(0, 100)));
}

function brandTime(value = Date.now()) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(value));
}

function excelFileSize(value = 0) {
  const bytes = Number(value || 0);
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("ko-KR")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function brandActivityDuration(milliseconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function brandJobIsFinished(state = "") {
  return /확인완료|완료됨|실패|오류|중단|취소/.test(String(state || ""));
}

function brandJobIsDownloaded(state = "") {
  return /확인완료/.test(String(state || ""));
}


function brandBatchKey(value = "") {
  return normalizeBrandKey(value) || String(value || "").trim().toLocaleLowerCase();
}

function updateBrandBatchState(brandName = "", state = "등록 대기", jobId = "") {
  const key = brandBatchKey(brandName);
  if (!key) return;
  const previous = brandBatchStates.get(key) || {};
  brandBatchStates.set(key, {
    brandName: String(brandName || previous.brandName || "선택 브랜드").trim(),
    state: String(state || previous.state || "등록 대기"),
    jobId: String(jobId || previous.jobId || "").trim(),
    updatedAt: Date.now(),
  });
  renderBrandBatchProgress();
}

function renderBrandBatchProgress() {
  const panel = $("#brand-batch-progress");
  const summary = $("#brand-batch-summary");
  const list = $("#brand-batch-list");
  if (!panel || !summary || !list) return;
  const items = [...brandBatchStates.values()];
  const total = Math.max(brandBatchTotal, items.length);
  const completed = items.filter((item) => /확인완료/.test(item.state)).length;
  const failed = items.filter((item) => /실패|오류|중단|취소/.test(item.state)).length;
  const registered = items.filter((item) => Boolean(item.jobId)).length;
  const processing = items.filter((item) => item.jobId && !/확인완료|실패|오류|중단|취소/.test(item.state)).length;
  panel.hidden = total === 0;
  summary.textContent = `등록 ${registered}/${total} · 처리 중 ${processing} · 완료 ${completed} · 실패 ${failed}`;
  list.innerHTML = items.map((item) => {
    const stateClass = /확인완료/.test(item.state) ? " is-complete"
      : /실패|오류|중단|취소/.test(item.state) ? " is-error"
        : item.jobId ? " is-processing" : " is-registering";
    return `<div class="brand-batch-row${stateClass}"><strong>${text(item.brandName)}</strong><code>${item.jobId ? `작업번호 ${text(item.jobId)}` : "작업번호 생성 전"}</code><span>${text(item.state)}</span></div>`;
  }).join("");
}

function renderBrandCompletedJobs() {
  const panel = $("#brand-export-completed");
  const list = $("#brand-export-completed-list");
  const count = $("#brand-export-completed-count");
  const latest = $("#brand-export-completed-latest");
  const toggle = $("#brand-export-completed-toggle");
  const more = $("#brand-export-completed-more");
  if (!panel || !list || !count || !latest || !toggle || !more) return;
  const seen = new Set();
  const completed = downloadedBrandFiles.filter((file) => {
    const key = String(file.jobId || "").trim() || brandImportPathKey(file.path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => Number(right.time || 0) - Number(left.time || 0));
  const grouped = new Map();
  for (const file of completed) {
    const brandName = String(file.brandName || "선택 브랜드").trim();
    const key = brandBatchKey(brandName) || brandName;
    const group = grouped.get(key);
    if (group) group.historyCount += 1;
    else grouped.set(key, { ...file, brandName, historyCount: 0 });
  }
  const brandGroups = [...grouped.values()];
  const visibleGroups = brandCompletedShowAll ? brandGroups : brandGroups.slice(0, 3);
  panel.hidden = completed.length === 0;
  count.textContent = `${completed.length}건`;
  latest.textContent = completed[0] ? `최근 ${completed[0].brandName || "선택 브랜드"} · ${brandTime(completed[0].time)}` : "";
  toggle.textContent = panel.open ? "목록 접기" : "목록 보기";
  list.innerHTML = visibleGroups.map((file) => `
    <div class="brand-export-completed-row">
      <div class="brand-export-completed-brand"><strong>${text(file.brandName)}</strong>${file.historyCount ? `<small>이전 기록 ${file.historyCount}건</small>` : ""}</div>
      <code>${file.jobId ? `작업번호 ${text(file.jobId)}` : "과거 파일 · 작업번호 기록 없음"}</code>
      <time>${text(brandTime(file.time))}</time>
    </div>`).join("");
  more.hidden = !panel.open || brandGroups.length <= 3;
  more.textContent = brandCompletedShowAll ? "최근 3개 브랜드만 보기" : `전체 브랜드 보기 (${brandGroups.length}개)`;
}

function renderBrandExportJobs() {
  const panel = $("#brand-export-job");
  const list = $("#brand-export-jobs-list");
  if (!list) return;
  const now = Date.now();
  const activeEntries = [...brandExportJobs.entries()].filter(([_id, job]) => !brandJobIsDownloaded(job.state));
  if (panel) panel.hidden = activeEntries.length === 0;
  list.innerHTML = activeEntries
    .map(([id, job]) => {
      const finished = brandJobIsFinished(job.state);
      const stateClass = /실패|오류|중단|취소/.test(String(job.state || ""))
        ? " is-error"
        : finished ? " is-success" : " is-running";
      const running = finished ? "" : '<span class="brand-export-job-spinner" aria-hidden="true"></span>';
      const elapsed = finished ? "" : ` · ${brandActivityDuration(now - Number(job.startedAt || now))}`;
      return `<div class="brand-export-job-row${stateClass}"><strong>${text(job.brandName)}</strong><code>작업번호 ${text(id)}</code><span class="brand-export-job-state">${running}${text(job.state)}${text(elapsed)}</span></div>`;
    })
    .join("");
  renderBrandCompletedJobs();
  renderBrandBatchProgress();
}

function renderBrandActivity() {
  const panel = $("#brand-activity");
  if (!panel || !brandActivityStartedAt) return;
  const now = Date.now();
  const idleSeconds = Math.max(0, Math.floor((now - brandActivityUpdatedAt) / 1000));
  const waiting = idleSeconds >= 60;
  panel.hidden = false;
  panel.classList.toggle("is-waiting", waiting);
  $("#brand-activity-title").textContent = waiting
    ? "POIZON 응답 대기 중 · 작업은 계속 실행 중"
    : brandActivityMessage || "작업 진행 중";
  $("#brand-activity-elapsed").textContent = `진행 ${brandActivityDuration(now - brandActivityStartedAt)}`;
  $("#brand-activity-updated").textContent = idleSeconds < 2 ? "방금 상태 갱신" : `${idleSeconds}초 전 상태 갱신`;
  renderBrandExportJobs();
}

function touchBrandActivity(message = "") {
  const now = Date.now();
  if (!brandActivityStartedAt) brandActivityStartedAt = now;
  brandActivityUpdatedAt = now;
  if (message) brandActivityMessage = String(message);
  if (!brandActivityTimer) brandActivityTimer = setInterval(renderBrandActivity, 1000);
  renderBrandActivity();
}

function stopBrandActivity() {
  if (brandActivityTimer) clearInterval(brandActivityTimer);
  brandActivityTimer = null;
  brandActivityStartedAt = 0;
  brandActivityUpdatedAt = 0;
  brandActivityMessage = "";
  const panel = $("#brand-activity");
  if (panel) {
    panel.hidden = true;
    panel.classList.remove("is-waiting");
  }
}

$("#brand-seller-diagnostic")?.addEventListener("click", () => {
  void window.aroundG.openSellerProductSearch();
});

$("#brand-stop-current")?.addEventListener("click", () => {
  if (!brandSelectionBusy && !activeExportBrand && !brandExportJobs.size) return;
  $("#brand-export-selected")?.click();
});

function finalizeBrandActivityAfterMainCompletion() {
  if (!brandMainAllComplete || detectedBrandImportRunning || detectedBrandImportQueue.length) return false;
  for (const [jobId, job] of brandExportJobs.entries()) {
    if (!brandJobIsFinished(job.state)) {
      brandExportJobs.set(jobId, { ...job, state: "완료됨", updatedAt: Date.now() });
    }
  }
  for (const [key, item] of brandBatchStates.entries()) {
    if (item.jobId && !/확인완료|실패|오류|중단|취소/.test(item.state)) {
      brandBatchStates.set(key, { ...item, state: "확인완료", updatedAt: Date.now() });
    }
  }
  renderBrandExportJobs();
  renderBrandBatchProgress();
  stopBrandActivity();
  const activePanel = $("#brand-export-job");
  if (activePanel) activePanel.hidden = true;
  return true;
}

function normalizeBrandKey(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function brandImportPathKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/[\\/]+/g, "\\")
    .toLocaleLowerCase();
}

function hasCompletedBrandDownload(brand = {}) {
  const keys = new Set([normalizeBrandKey(brand.name), normalizeBrandKey(brand.ko)].filter(Boolean));
  return downloadedBrandFiles.some((file) =>
    keys.has(normalizeBrandKey(file.brandName || file.brand))
  );
}

function renderDownloadedBrandFiles() {
  const list = $("#brand-download-files");
  const count = $("#brand-download-count");
  if (!list || !count) return;
  const normalizeBrand = (value) => String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
  const grouped = [];
  const groupMap = new Map();

  downloadedBrandFiles.forEach((file, index) => {
    const brandName = file.brandName || file.brand || "선택 브랜드";
    const key = normalizeBrand(brandName) || "selected-brand";
    if (!groupMap.has(key)) {
      const meta = explorerMeta.brands.find((brand) =>
        normalizeBrand(brand.name) === key || normalizeBrand(brand.ko) === key
      );
      const group = { brandName, meta, files: [] };
      groupMap.set(key, group);
      grouped.push(group);
    }
    groupMap.get(key).files.push({ file, index });
  });

  count.textContent = grouped.length
    ? `${grouped.length}개 브랜드 · ${downloadedBrandFiles.length}개 파일`
    : "0개";
  list.innerHTML = grouped.length
    ? `<div class="brand-download-list-head" aria-hidden="true">
        <span>브랜드</span><span>원본 Excel 파일</span><span>작업번호</span><span>받은 시각</span><span>크기</span><span>열기</span>
      </div>${grouped.map(({ brandName, meta, files }) => {
      const [latest, ...history] = files;
      const logo = meta?.logoUrl
        ? `<img src="${text(meta.logoUrl)}" alt="${text(brandName)} 로고"><b>${text(brandName.slice(0, 1))}</b>`
        : `<b>${text(brandName.slice(0, 1))}</b>`;
      const historyRow = ({ file, index }) => `
        <div class="brand-download-history-row" data-open-brand-file-index="${index}" role="button" tabindex="0">
          <span></span>
          <strong title="${text(file.path || "")}">${text(file.name || file.path || "Excel 파일")}</strong>
          <code>${text(file.jobId || "-")}</code>
          <time>${text(brandTime(file.time))}</time>
          <span>${text(excelFileSize(file.size))}</span>
          <button type="button" data-open-brand-file-index="${index}">데이터 보기</button>
        </div>`;
      return `
        <article class="brand-download-row-group">
          <div class="brand-download-row" data-open-brand-file-index="${latest.index}" role="button" tabindex="0">
            <span class="brand-download-brand">
            <i class="brand-download-logo">${logo}</i>
            <span class="brand-download-name">
              <strong>${text(brandName)}</strong>
              <small>POIZON 원본 · 확인완료</small>
            </span>
            </span>
            <strong class="brand-download-filename" title="${text(latest.file.path || "")}">${text(latest.file.name || latest.file.path || "Excel 파일")}</strong>
            <code>${text(latest.file.jobId || "-")}</code>
            <time>${text(brandTime(latest.file.time))}</time>
            <b class="brand-download-badge">${text(excelFileSize(latest.file.size))}</b>
            <button type="button" data-open-brand-file-index="${latest.index}">데이터 보기</button>
          </div>
          ${history.length ? `
            <details class="brand-download-history">
              <summary>이전 파일 ${history.length}개</summary>
              <div class="brand-download-history-list">
                ${history.map(historyRow).join("")}
              </div>
            </details>` : ""}
        </article>`;
    }).join("")}`
    : '<p class="empty">다운로드가 완료되면 원본 Excel 파일이 여기에 표시됩니다.</p>';
}

function currentExcelPreviewFilters() {
  return {
    minimumTotal: $("#excel-filter-min-total")?.value ?? "",
    minimumLocalTotal: $("#excel-filter-min-local-total")?.value ?? "",
    matchMode: $("#excel-filter-match")?.value === "all" ? "all" : "any",
    productView: excelPreviewProductMode,
  };
}

function excelProductColumnIndex(headers = []) {
  return headers.findIndex((header) => /^(상품\s*번호|품번|article\s*(number|no)?|product\s*(number|no)?|货号|商品编号)$/i.test(String(header || "").trim()));
}

function excelPreviewProductKey(filePath, row = [], rowNumber = 0, productColumn = -1) {
  const productNumber = productColumn >= 0 ? String(row[productColumn] || "").trim() : "";
  return `${brandImportPathKey(filePath)}::${productNumber || `row-${rowNumber}`}`;
}

function updateExcelPreviewSelectionUi(pageKeys = []) {
  const uniquePageKeys = [...new Set(pageKeys)];
  const selectedOnPage = uniquePageKeys.filter((key) => selectedExcelPreviewProducts.has(key)).length;
  const selectPage = $("#excel-preview-select-page");
  const count = $("#excel-preview-selected-count");
  const clear = $("#excel-preview-selection-clear");
  const profit = $("#excel-preview-profit");
  const search = $("#excel-preview-search-selected");
  if (count) count.textContent = `${selectedExcelPreviewProducts.size.toLocaleString("ko-KR")}개 제품 선택`;
  if (clear) clear.disabled = selectedExcelPreviewProducts.size === 0;
  if (profit) profit.disabled = selectedExcelPreviewProducts.size === 0;
  if (search) {
    search.disabled = selectedExcelPreviewProducts.size === 0 && !excelPreviewBatchSearching;
    search.textContent = excelPreviewBatchSearching ? "검색 중지" : "선택 상품 일괄 검색";
  }
  if (selectPage) {
    selectPage.checked = uniquePageKeys.length > 0 && selectedOnPage === uniquePageKeys.length;
    selectPage.indeterminate = selectedOnPage > 0 && selectedOnPage < uniquePageKeys.length;
  }
  document.querySelectorAll("[data-excel-product-select]").forEach((checkbox) => {
    checkbox.checked = selectedExcelPreviewProducts.has(decodeURIComponent(checkbox.dataset.excelProductSelect));
  });
}

function excelProductMetric(raw, value) {
  return text(String(raw || "").trim() || Number(value || 0).toLocaleString("ko-KR"));
}

function renderExcelProductRows(file, products = []) {
  const pageKeys = products.map((product) => `${brandImportPathKey(file.path)}::${product.articleNumber || product.spuId || product.key}`);
  products.forEach((product, index) => excelPreviewProductCache.set(pageKeys[index], product));
  $("#excel-preview-columns").innerHTML = `<tr><th class="excel-product-select-column">선택</th><th>이미지</th><th>상품번호</th><th>상품명</th><th>브랜드</th><th>카테고리</th><th>평균가격</th><th>중국 총판매</th><th>현지 총판매</th><th>상품 검색</th></tr>`;
  $("#excel-preview-rows").innerHTML = products.length ? products.map((product, index) => {
    const key = pageKeys[index];
    const result = excelPreviewSearchResults.get(key);
    const status = result?.loading ? "검색 중…" : result?.error ? "검색 실패" : result ? `${(result.products || []).length}개 결과` : "상품 검색";
    return `<tr class="excel-product-row">
      <td class="excel-product-select-column"><input type="checkbox" data-excel-product-select="${encodeURIComponent(key)}" aria-label="제품 선택"></td>
      <td class="excel-product-image">${product.logoUrl ? `<img src="${text(product.logoUrl)}" alt="">` : "-"}</td>
      <td><b>${text(product.articleNumber || "-")}</b></td><td title="${text(product.title)}">${text(product.title || "-")}</td>
      <td>${text(product.brandName || "-")}</td><td title="${text(product.categoryName)}">${text(product.categoryName || "-")}</td>
      <td>${product.averagePrice ? money(product.averagePrice) : "-"}</td>
      <td>${excelProductMetric(product.totalSalesRaw, product.totalSales)}</td><td>${excelProductMetric(product.localTotalSalesRaw, product.localTotalSales)}</td>
      <td><button type="button" class="excel-product-search" data-excel-search-product="${encodeURIComponent(key)}" ${result?.loading ? "disabled" : ""}>${status}</button></td>
    </tr>${result && !result.loading ? `<tr class="excel-product-search-detail"><td colspan="10">${renderDomestic(result)}</td></tr>` : ""}`;
  }).join("") : `<tr><td class="empty" colspan="10">조건에 맞는 상품이 없습니다.</td></tr>`;
  return pageKeys;
}

async function searchExcelPreviewProduct(key) {
  const product = excelPreviewProductCache.get(key);
  if (!product) return;
  excelPreviewSearchResults.set(key, { loading: true, products: [], sources: [] });
  const file = activeExcelPreview?.file;
  if (file) renderExcelProductRows(file, excelPreviewPageProducts);
  const query = [product.brandName, product.articleNumber, product.title].filter(Boolean).join(" ");
  const response = await window.aroundG.searchDomestic({
    query, articleNumber: product.articleNumber || "", brand: product.brandName || "",
    title: product.title || "", imageUrl: product.logoUrl || "", verifyLinkCounts: true,
  });
  excelPreviewSearchResults.set(key, response.ok ? response.data : { products: [], sources: [], error: response.message });
  if (file) renderExcelProductRows(file, excelPreviewPageProducts);
  updateExcelPreviewSelectionUi(excelPreviewPageProducts.map((item) => `${brandImportPathKey(file?.path)}::${item.articleNumber || item.spuId || item.key}`));
}

async function showExcelPreview(file, offset = 0, filters = currentExcelPreviewFilters()) {
  if (!file?.path) return;
  const filesPanel = $("#explorer-files");
  const productsView = $("#products");
  if (!filesPanel?.classList.contains("excel-preview-mode")) {
    excelFilesListScrollPosition = window.scrollY;
  }
  filesPanel?.classList.add("excel-preview-mode");
  productsView?.classList.add("excel-data-view-open");
  document.body.classList.add("excel-preview-active");
  if (activeExcelPreviewPath !== file.path) {
    selectedExcelPreviewProducts.clear();
    excelPreviewProductCache.clear();
    excelPreviewSearchResults.clear();
    excelPreviewProductMode = true;
    filters = { ...filters, productView: true };
    activeExcelPreviewPath = file.path;
  }
  const requestId = ++excelPreviewRequestId;
  const preview = $("#excel-preview");
  const loading = $("#excel-preview-loading");
  const grid = $("#excel-preview-grid");
  const pager = $("#excel-preview-pager");
  preview.hidden = false;
  loading.hidden = false;
  loading.textContent = "Excel을 프로그램 안에서 불러오는 중입니다.";
  grid.hidden = true;
  pager.hidden = true;
  $("#excel-preview-name").textContent = file.name || "Excel 미리보기";
  filesPanel?.scrollIntoView({ behavior: "auto", block: "start" });
  const result = await window.aroundG.previewExcelFile(file.path, offset, 100, filters);
  if (requestId !== excelPreviewRequestId) return;
  if (!result?.ok) {
    activeExcelPreview = null;
    loading.className = "excel-preview-loading error";
    loading.textContent = `파일 열기 실패: ${result?.message || "파일을 읽을 수 없습니다."}`;
    return;
  }
  const totalRows = Number.isFinite(Number(result.totalRows)) ? Math.max(0, Number(result.totalRows)) : 0;
  const totalColumns = Number.isFinite(Number(result.totalColumns)) ? Math.max(0, Number(result.totalColumns)) : 0;
  const headers = Array.isArray(result.headers) ? result.headers : [];
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const products = Array.isArray(result.products) ? result.products : [];
  const rowNumbers = Array.isArray(result.rowNumbers) ? result.rowNumbers : [];
  const productColumn = excelProductColumnIndex(headers);
  excelPreviewPageProducts = products;
  const pageProductKeys = result.productView
    ? products.map((product) => `${brandImportPathKey(file.path)}::${product.articleNumber || product.spuId || product.key}`)
    : rows.map((row, index) => excelPreviewProductKey(file.path, row, rowNumbers[index] || result.offset + index + 2, productColumn));
  excelPreviewPageKeys = pageProductKeys;
  const sourceTotalRows = Number.isFinite(Number(result.sourceTotalRows))
    ? Math.max(0, Number(result.sourceTotalRows))
    : totalRows;
  const sourceTotalProducts = Number.isFinite(Number(result.sourceTotalProducts))
    ? Math.max(0, Number(result.sourceTotalProducts))
    : totalRows;
  activeExcelPreview = { file, offset: result.offset, limit: result.limit, totalRows, filters, viewMode: result.productView ? "products" : "raw" };
  preview.classList.toggle("product-view", Boolean(result.productView));
  $("#excel-view-products").classList.toggle("active", Boolean(result.productView));
  $("#excel-view-raw").classList.toggle("active", !result.productView);
  loading.className = "excel-preview-loading";
  loading.hidden = true;
  grid.hidden = false;
  pager.hidden = false;
  const startRow = totalRows ? result.offset + 1 : 0;
  const endRow = Math.min(totalRows, result.offset + rows.length);
  $("#excel-preview-summary").textContent = result.productView
    ? `상품 검색용 보기 · 필터 결과 ${totalRows.toLocaleString("ko-KR")}개 / 전체 ${sourceTotalProducts.toLocaleString("ko-KR")}개 제품 · 현재 ${startRow.toLocaleString("ko-KR")}~${Math.min(totalRows, result.offset + products.length).toLocaleString("ko-KR")}번째 제품`
    : result.filterApplied
      ? `원본 데이터 · 필터 결과 ${totalRows.toLocaleString("ko-KR")}행 / 전체 ${sourceTotalRows.toLocaleString("ko-KR")}행 · ${totalColumns.toLocaleString("ko-KR")}열 · 현재 ${startRow.toLocaleString("ko-KR")}~${endRow.toLocaleString("ko-KR")}번째 결과`
      : `원본 데이터 · ${totalRows.toLocaleString("ko-KR")}행 · ${totalColumns.toLocaleString("ko-KR")}열 · 현재 ${startRow.toLocaleString("ko-KR")}~${endRow.toLocaleString("ko-KR")}행`;
  const missingColumns = [
    result.totalSalesColumn < 0 ? "중국 총 판매량" : "",
    result.localTotalSalesColumn < 0 ? "현지 판매자 총 판매량" : "",
  ].filter(Boolean);
  $("#excel-filter-status").textContent = missingColumns.length
    ? `${missingColumns.join(" · ")} 열을 찾지 못해 해당 조건은 적용되지 않습니다.`
    : result.filterApplied
      ? result.productView
        ? `전체 ${sourceTotalProducts.toLocaleString("ko-KR")}개 제품 중 ${totalRows.toLocaleString("ko-KR")}개 · ${result.matchMode === "all" ? "두 조건 모두 충족(AND)" : "둘 중 하나 충족(OR)"}`
        : `전체 ${sourceTotalRows.toLocaleString("ko-KR")}행 중 ${totalRows.toLocaleString("ko-KR")}행 · ${result.matchMode === "all" ? "두 조건 모두 충족(AND)" : "둘 중 하나 충족(OR)"}`
      : `판매량 필터를 사용하지 않고 전체 ${sourceTotalRows.toLocaleString("ko-KR")}행을 표시합니다.`;
  $("#excel-preview-selection").hidden = false;
  if (result.productView) {
    renderExcelProductRows(file, products);
  } else {
    $("#excel-preview-columns").innerHTML = `<tr><th class="excel-product-select-column">선택</th><th class="excel-row-number">행</th>${headers.map((header) => `<th title="${text(header)}">${text(header)}</th>`).join("")}</tr>`;
    $("#excel-preview-rows").innerHTML = rows.length
      ? rows.map((row, index) => `<tr><td class="excel-product-select-column"><input type="checkbox" data-excel-product-select="${encodeURIComponent(pageProductKeys[index])}" aria-label="제품 선택"></td><th class="excel-row-number">${Number(rowNumbers[index] || result.offset + index + 2).toLocaleString("ko-KR")}</th>${row.map((cell) => `<td title="${text(cell)}">${text(cell)}</td>`).join("")}</tr>`).join("")
      : `<tr><td class="empty" colspan="${Math.max(1, totalColumns + 2)}">표시할 데이터 행이 없습니다.</td></tr>`;
  }
  $("#excel-preview-select-page").onchange = (event) => {
    [...new Set(pageProductKeys)].forEach((key) => {
      if (event.target.checked) selectedExcelPreviewProducts.add(key);
      else selectedExcelPreviewProducts.delete(key);
    });
    updateExcelPreviewSelectionUi(pageProductKeys);
  };
  $("#excel-preview-selection-clear").onclick = () => {
    selectedExcelPreviewProducts.clear();
    updateExcelPreviewSelectionUi(pageProductKeys);
  };
  updateExcelPreviewSelectionUi(pageProductKeys);
  const totalPages = Math.max(1, Math.ceil(totalRows / result.limit));
  const currentPage = Math.floor(result.offset / result.limit) + 1;
  $("#excel-preview-page").textContent = `${currentPage.toLocaleString("ko-KR")} / ${totalPages.toLocaleString("ko-KR")}페이지`;
  $("#excel-preview-prev").disabled = result.offset <= 0;
  $("#excel-preview-next").disabled = result.offset + result.limit >= totalRows;
  document.querySelectorAll(".brand-download-row.is-open,.brand-download-history-row.is-open").forEach((row) => row.classList.remove("is-open"));
  document.querySelectorAll(`[data-open-brand-file-index="${downloadedBrandFiles.indexOf(file)}"]`).forEach((element) => element.closest(".brand-download-row,.brand-download-history-row")?.classList.add("is-open"));
}

function addDownloadedBrandFile(file = {}) {
  const path = String(file.path || "").trim();
  const pathKey = brandImportPathKey(path);
  const jobId = String(file.jobId || "").trim();
  if (!pathKey) return;
  downloadedBrandFiles = [
    {
      path,
      name: String(file.name || ""),
      brandName: String(file.brandName || "선택 브랜드"),
      jobId,
      originalPath: String(file.originalPath || ""),
      size: Number(file.size || 0),
      time: Number(file.time) || Date.now(),
      brandIntegrity: file.brandIntegrity || null,
    },
    ...downloadedBrandFiles.filter((item) =>
      brandImportPathKey(item.path) !== pathKey
      && (!jobId || String(item.jobId || "").trim() !== jobId)
    ),
  ].slice(0, 500);
  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));
  renderDownloadedBrandFiles();
  renderBrandCompletedJobs();
  renderBrandCards($("#brand-filter")?.value || "");
}

function clearBrandWorkHistoryUi() {
  brandWorkHistoryGeneration += 1;
  acceptBrandWorkEvents = false;
  downloadedBrandFiles = [];
  detectedBrandImportQueue.length = 0;
  queuedBrandImportPaths.clear();
  completedBrandImportPaths.clear();
  completedBrandImportJobIds.clear();
  brandWorkbenchProducts = [];
  selectedBrandIds.clear();
  brandSelectionHistory = [];
  selectedBrandName = "";
  brandExportQueue = [];
  activeExportBrand = null;
  brandSelectionBusy = false;
  brandExportJobs.clear();
  brandBatchTotal = 0;
  brandBatchStates.clear();
  renderBrandBatchProgress();
  stopBrandActivity();
  [
    "around-g-selected-brand-name",
    "around-g-selected-brand-ids",
    "around-g-brand-selection-history",
    "around-g-brand-download-files",
    "around-g-last-brand-export-job",
  ].forEach((key) => localStorage.removeItem(key));
  $("#brand-export-job").hidden = true;
  $("#brand-export-jobs-list").innerHTML = "";
  renderDownloadedBrandFiles();
  renderBrandCompletedJobs();
  renderBrandWorkbench();
  retainSelectedBrandName("");
  renderBrandCards($("#brand-filter")?.value || "");
}

async function restoreDownloadedBrandFiles() {
  const generation = brandWorkHistoryGeneration;
  const result = await window.aroundG?.listBrandExportFiles?.();
  if (generation !== brandWorkHistoryGeneration) return;
  if (!result?.ok || !Array.isArray(result.files)) return;
  const savedByPath = new Map(downloadedBrandFiles.map((file) => [brandImportPathKey(file.path), file]));
  downloadedBrandFiles = result.files
    .map((file) => {
      const path = String(file.path || "");
      const saved = savedByPath.get(brandImportPathKey(path)) || {};
      return {
        ...saved,
        ...file,
        path,
        brandName: String(file.brandName || saved.brandName || "선택 브랜드"),
        jobId: String(file.jobId || saved.jobId || ""),
        time: Number(file.time || file.mtimeMs || saved.time || 0),
        brandIntegrity: file.brandIntegrity || saved.brandIntegrity || null,
      };
    })
    .filter((file) => file.path)
    .sort((a, b) => Number(b.time || 0) - Number(a.time || 0))
    .slice(0, 500);
  completedBrandImportPaths.clear();
  completedBrandImportJobIds.clear();
  downloadedBrandFiles.forEach((file) => {
    const pathKey = brandImportPathKey(file.path);
    const jobId = String(file.jobId || "").trim();
    if (pathKey) completedBrandImportPaths.add(pathKey);
    if (jobId) completedBrandImportJobIds.add(jobId);
  });
  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));
  renderDownloadedBrandFiles();
  renderBrandCompletedJobs();
  renderBrandCards($("#brand-filter")?.value || "");
}

async function restorePendingBrandExportJobs() {
  const generation = brandWorkHistoryGeneration;
  const jobs = await window.aroundG?.listPendingBrandExportJobs?.();
  if (!acceptBrandWorkEvents || generation !== brandWorkHistoryGeneration || !Array.isArray(jobs)) return;
  const pending = jobs.filter((job) => String(job?.jobId || "").trim() && String(job?.brandName || "").trim());
  if (!pending.length) return;
  brandBatchTotal = Math.max(brandBatchTotal, pending.length);
  for (const job of pending) {
    updateBrandBatchState(job.brandName, "재시작 복원 · 다운로드센터 확인 중", job.jobId);
    updateBrandExportJob(
      job.jobId,
      "재시작 복원 · 다운로드센터 성공 여부 확인 중",
      job.brandName,
    );
  }
  touchBrandActivity(`미다운로드 작업 ${pending.length}개 복원 · POIZON 다운로드센터 감시 재개`);
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `이전 실행의 미다운로드 작업 ${pending.length}개를 복원해 자동 감시를 재개합니다.`;
  await window.aroundG.startSellerBrandExportMonitor();
}

function recordBrandSelection(brand, action, details = {}) {
  brandSelectionHistory.unshift({
    brandId: Number(brand.id),
    brandName: brand.name,
    action,
    jobId: String(details.jobId || ""),
    time: Date.now(),
  });
  saveBrandSelections();
}

function updateBrandExportJob(jobId = "", state = "", brandName = "") {
  const panel = $("#brand-export-job");
  if (!panel) return;
  const normalizedId = String(jobId || "").trim();
  if (!normalizedId) return;
  const previous = brandExportJobs.get(normalizedId) || {};
  const previousBrand = String(previous.brandName || "").trim();
  const incomingBrand = String(brandName || "").trim();
  const stableBrandName = previousBrand && previousBrand !== "선택 브랜드"
    ? previousBrand
    : incomingBrand || previousBrand || "선택 브랜드";
  brandExportJobs.set(normalizedId, {
    brandName: stableBrandName,
    state: state || previous.state || "감시 중",
    startedAt: previous.startedAt || Date.now(),
    updatedAt: Date.now(),
  });
  panel.hidden = false;
  renderBrandExportJobs();
}

function resolveRendererBrandJobId(file = {}) {
  const explicit = String(file?.jobId || "").trim();
  if (explicit) return explicit;
  const key = normalizeBrandKey(file?.brandName || file?.detectedBrandName || "");
  if (!key) return "";
  const matches = [...brandExportJobs.entries()].filter(([_jobId, job]) =>
    normalizeBrandKey(job?.brandName) === key
  );
  const unfinished = matches.filter(([_jobId, job]) => !brandJobIsFinished(job?.state));
  if (unfinished.length === 1) return unfinished[0][0];
  return matches.length === 1 ? matches[0][0] : "";
}

function toggleBrandSelection(brandId) {
  const id = Number(brandId);
  const brand = explorerMeta.brands.find((item) => Number(item.id) === id);
  if (!brand) return null;
  if (selectedBrandIds.has(id)) {
    selectedBrandIds.delete(id);
  } else {
    selectedBrandIds.add(id);
    recordBrandSelection(brand, "선택");
  }
  selectedBrandId = selectedBrandIds.size === 1 ? [...selectedBrandIds][0] : null;
  saveBrandSelections();
  renderBrandCards($("#brand-filter")?.value || "");
  return brand;
}

function updateBrandSelectionControls() {
  const selectedCount = selectedBrandIds.size;
  const count = $("#brand-selected-count");
  const clear = $("#brand-selection-clear");
  const search = $("#brand-export-selected");
  const stopCurrent = $("#brand-stop-current");
  if (count) count.textContent = `${selectedCount}개 선택`;
  if (clear) clear.disabled = selectedCount === 0 || brandSelectionBusy;
  if (search) {
    search.disabled = brandSelectionBusy ? false : selectedCount === 0;
    search.classList.toggle("is-running", brandSelectionBusy);
    const label = search.querySelector("span");
    if (label) label.textContent = brandSelectionBusy ? "작업 중지" : "브랜드 검색";
  }
  if (stopCurrent) stopCurrent.disabled = !brandSelectionBusy && !activeExportBrand && !brandExportJobs.size;
}

function selectedBrandsForExport() {
  return [...selectedBrandIds]
    .map((brandId) => explorerMeta.brands.find((brand) => Number(brand.id) === Number(brandId)))
    .filter(Boolean);
}

async function exportNextSelectedBrand(generation = brandWorkHistoryGeneration) {
  if (!acceptBrandWorkEvents || generation !== brandWorkHistoryGeneration) return;
  if (!brandExportQueue.length) {
    activeExportBrand = null;
    brandSelectionBusy = false;
    renderBrandCards($("#brand-filter")?.value || "");
    const failureCount = brandExportFailureCount;
    $("#brand-status").className = failureCount ? "status error" : "status success";
    $("#brand-status").textContent = failureCount
      ? `전체 브랜드 내보내기 완료 · ${failureCount}개 브랜드 실패 · 다운로드센터 감시를 시작합니다.`
      : `전체 ${brandExportJobs.size}개 브랜드 내보내기 완료 · 다운로드센터를 갱신하며 성공 파일을 확인합니다.`;
    brandExportFailureCount = 0;
    if (!brandExportJobs.size) stopBrandActivity();
    else touchBrandActivity("POIZON 파일 처리 상태 자동 감시 중");
    await window.aroundG.startSellerBrandExportMonitor();
    return;
  }
  activeExportBrand = brandExportQueue.shift();
  const retryWaitMs = Math.max(0, Number(activeExportBrand?.retryAfter || 0) - Date.now());
  if (retryWaitMs > 0) {
    brandExportQueue.unshift(activeExportBrand);
    activeExportBrand = null;
    brandSelectionBusy = true;
    $("#brand-status").className = "status";
    $("#brand-status").textContent = `입력 실패 브랜드를 ${Math.ceil(retryWaitMs / 1000)}초 후 다시 진행합니다.`;
    setTimeout(() => exportNextSelectedBrand(generation), retryWaitMs);
    return;
  }
  brandSelectionBusy = true;
  selectedBrandId = Number(activeExportBrand.id);
  retainSelectedBrandName(activeExportBrand.name);
  renderBrandCards($("#brand-filter")?.value || "");
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `${activeExportBrand.name} · 1단계/5 · 판매자센터 연결 후 실제 상품검색 시작 중`;
  updateBrandBatchState(activeExportBrand.name, "상품검색·내보내기 등록 중");
  touchBrandActivity(`${activeExportBrand.name} · 실제 상품검색 실행 중`);
  const automationRequest = window.aroundG.automateSellerBrandExport({
    brandName: activeExportBrand.name || "",
    brandKo: activeExportBrand.ko || "",
    brandId: selectedBrandId,
    deferMonitor: true,
  });
  const automation = await Promise.race([
    automationRequest,
    new Promise((resolve) => setTimeout(() => resolve({
      ok: false,
      code: "BRAND_AUTOMATION_TIMEOUT",
      message: `${activeExportBrand?.name || "선택 브랜드"} 작업이 20분 안에 끝나지 않아 다음 브랜드로 이동합니다.`,
    }), BRAND_AUTOMATION_TIMEOUT_MS)),
  ]);
  if (automation?.code === "BRAND_AUTOMATION_TIMEOUT" && !automation?.aborted) {
    // The main process owns the hard timeout as well. Do not block queue
    // recovery while its hidden Seller Center page is being reset.
    void window.aroundG.abortSellerBrandExportAttempt?.();
  }
  if (!acceptBrandWorkEvents || generation !== brandWorkHistoryGeneration) return;
  if (!automation?.ok) {
    recordBrandSelection(activeExportBrand, "데이터 가져오기 실패");
    const failedBrandName = activeExportBrand?.name || "선택 브랜드";
    const failureCode = String(automation?.code || "");
    const recoverableRetryCodes = new Set([
      "SEARCH_INPUT_NOT_FOUND",
      "REAL_KEYBOARD_INPUT_FAILED",
      "REAL_KEYBOARD_INPUT_VERIFY_TIMEOUT",
      "REAL_KEYBOARD_INPUT_VERIFY_FAILED",
      "BRAND_INPUT_NOT_APPLIED",
      "LOCAL_SALES_SORT_ICON_NOT_FOUND",
      "LOCAL_SALES_SORT_CONFIRM_NOT_FOUND",
      "EXPORT_BUTTON_NOT_FOUND_AFTER_SORT",
    ]);
    const retryCount = Number(activeExportBrand?.retryCount || 0);
    const shouldRetryInput = recoverableRetryCodes.has(failureCode) && retryCount < BRAND_INPUT_RETRY_LIMIT;
    if (shouldRetryInput) {
      brandExportQueue.unshift({
        ...activeExportBrand,
        retryCount: retryCount + 1,
        retryAfter: Date.now() + BRAND_INPUT_RETRY_DELAY_MS,
      });
    }
    const remainingCount = brandExportQueue.length;
    if (!shouldRetryInput) brandExportFailureCount += 1;
    const failureReason = String(automation?.diagnostics?.reason || "").trim();
    updateBrandBatchState(
      failedBrandName,
      shouldRetryInput
        ? `입력 지연 · 60초 후 재진행 ${retryCount + 1}/${BRAND_INPUT_RETRY_LIMIT}`
        : `실패 · ${failureCode || "자동화 오류"}${failureReason ? ` · ${failureReason}` : ""}`,
    );
    activeExportBrand = null;
    if (failureCode === "SELLER_LOGIN_REQUIRED") {
      brandExportQueue = [];
      brandSelectionBusy = false;
      renderBrandCards($("#brand-filter")?.value || "");
      $("#brand-status").className = "status error";
      $("#brand-status").textContent = `${failedBrandName} 작업 중 판매자센터 로그인이 필요합니다. 로그인 후 다시 실행해 주세요.`;
      stopBrandActivity();
      return;
    }
    brandSelectionBusy = remainingCount > 0;
    renderBrandCards($("#brand-filter")?.value || "");
    $("#brand-status").className = shouldRetryInput ? "status" : "status error";
    $("#brand-status").textContent = shouldRetryInput
      ? `${failedBrandName} 단계를 완료하지 못해 60초 후 같은 브랜드를 다시 진행합니다. 완료 전에는 다음 브랜드로 이동하지 않습니다.`
      : remainingCount
      ? `${failedBrandName} 작업 실패 · ${automation?.message || "판매자센터 자동화에 실패했습니다."} · 다음 ${remainingCount}개 브랜드 작업을 계속합니다.`
      : `${failedBrandName} 작업 실패 · ${automation?.message || "판매자센터 자동화에 실패했습니다."}`;
    if (brandExportJobs.size) touchBrandActivity("남은 브랜드의 작업번호 생성을 계속합니다.");
    if (remainingCount > 0) {
      setTimeout(() => exportNextSelectedBrand(generation), 900);
    } else if (!brandExportJobs.size) {
      stopBrandActivity();
    }
    return;
  } else {
    renderBrandExportFolder(automation.folder);
    updateBrandExportJob(automation.jobId, "2단계 완료 · 전체 브랜드 내보내기 대기", activeExportBrand.name);
    updateBrandBatchState(activeExportBrand.name, "2단계 완료 · 다음 브랜드 내보내기", automation.jobId);
    recordBrandSelection(activeExportBrand, "전체 내보내기 요청", { jobId: automation.jobId });
    $("#brand-status").className = "status success";
    $("#brand-status").textContent = `${activeExportBrand.name} · 2단계 내보내기 완료${automation.jobId ? ` · ${automation.jobId}` : ""} · 다음 브랜드를 시작합니다.`;
    activeExportBrand = null;
    // Do not leave the next brand to an unobserved timer. The renderer can
    // refresh several job/progress rows when the first job number arrives,
    // which previously allowed the queued callback to be lost. Continue the
    // snapshotted queue directly after step two is confirmed.
    await exportNextSelectedBrand(generation);
    return;
  }
}

function retainSelectedBrandName(brandName = "") {
  selectedBrandName = String(brandName || selectedBrandName || "").trim();
  if (selectedBrandName) {
    localStorage.setItem("around-g-selected-brand-name", selectedBrandName);
  }
}

function setupBrandLayout() {
  const panel = $("#explorer-brand");
  const toolbar = panel?.querySelector(".brand-toolbar");
  const selectionActions = panel?.querySelector(".brand-selection-actions");
  const cards = $("#brand-cards");
  const status = panel?.querySelector(".explorer-actions");
  if (!panel || !toolbar || !selectionActions || !cards || $("#brand-picker")) return;

  const picker = document.createElement("details");
  picker.id = "brand-picker";
  picker.className = "brand-picker";
  picker.open = !brandWorkbenchProducts.length;
  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.textContent = "브랜드 선택 목록";
  summary.append(title);

  picker.append(summary, toolbar, selectionActions, cards);
  if (status) status.insertAdjacentElement("afterend", picker);
  else panel.append(picker);
}

function renderBrandWorkbench() {
  const rows = $("#brand-data-rows");
  if (!rows) return;
  const query = String($("#brand-data-search")?.value || "").trim().toLowerCase();
  const products = brandWorkbenchProducts.filter((product) => [
    product.articleNumber,
    product.apiTitle,
    product.title,
    product.name,
    product.spuId,
    product.globalSpuId,
    product.brandName,
    product.brand,
    product.categoryName,
    product.category,
  ].some((value) => String(value || "").toLowerCase().includes(query)));
  $("#brand-data-count").textContent = `${products.length.toLocaleString("ko-KR")}개`;
  $("#brand-data-download").disabled = brandWorkbenchProducts.length === 0;
  rows.innerHTML = products.length ? products.map((product) => `
    <tr>
      <td>${product.logoUrl ? `<img class="brand-data-image" src="${text(product.logoUrl)}" alt="">` : ""}</td>
      <td>${text(product.articleNumber || "")}</td>
      <td>${text(product.apiTitle || product.title || product.name || "")}</td>
      <td>${text(product.spuId || product.globalSpuId || "")}</td>
      <td>${text(product.brandName || product.brand || "")}</td>
      <td>${text(product.categoryName || product.category || "")}</td>
      <td>${product.hasPriceData === false ? "" : money(product.averagePrice || product.minPrice?.value || 0)}</td>
      <td>${product.hasSalesData === false ? "" : Number(product.sales30d || 0).toLocaleString("ko-KR")}</td>
      <td>${product.hasLocalSalesData === false ? "" : Number(product.localSales30d || 0).toLocaleString("ko-KR")}</td>
      <td>${product.hasTotalSalesData === false ? "" : Number(product.totalSales || 0).toLocaleString("ko-KR")}</td>
      <td>${product.hasLocalTotalSalesData === false ? "" : Number(product.localTotalSales || 0).toLocaleString("ko-KR")}</td>
    </tr>`).join("") : `<tr><td colspan="11" class="empty">${query ? "검색 결과가 없습니다." : "불러온 브랜드 데이터가 없습니다."}</td></tr>`;
}

function popularWorkflowInput(markSynced = false) {
  return {
    period: "week",
    compare: "week",
    unit: "SPU",
    limit: 200,
    reminder: false,
    markSynced,
  };
}

function text(value) {
  const span = document.createElement("span");
  span.textContent = value ?? "";
  return span.innerHTML;
}

function showRuntimeError(error) {
  const status = $("#popular-status");
  if (!status) return;
  const message = error instanceof Error ? error.message : String(error || "UNKNOWN_ERROR");
  status.className = "status error";
  status.textContent = `처리 오류: ${message}`;
}

window.addEventListener("error", (event) => showRuntimeError(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  showRuntimeError(event.reason);
});

function renderRecords(collection) {
  const host = $(`#${collection}-list`);
  host.innerHTML = state[collection].length
    ? state[collection].map((row) => `<div class="record"><div><strong>${text(row.name)}</strong><small>${text(row.brand)} · ${text(row.articleNumber)}</small></div><div>${money(row.price)} <button data-remove="${collection}:${row.id}">삭제</button></div></div>`).join("")
    : `<div class="empty">저장된 항목이 없습니다.</div>`;
}

function salesByArticle() {
  return Object.fromEntries(state.products
    .filter((product) => product.articleNumber && Number(product.sales30d) >= 0)
    .map((product) => [product.articleNumber, Number(product.sales30d)]));
}

function renderOfficialDomainAudit(audit = {}) {
  const total = Number(audit.total || explorerMeta.officialDomainSummary?.total || 0);
  const inspected = Number(audit.inspected || 0);
  const verified = Number(audit.verified || 0);
  const unsupported = Number(audit.searchUnsupported || 0);
  const pending = Number(audit.pending || 0);
  const percent = total ? Math.min(100, Math.round((inspected / total) * 100)) : 0;
  const status = $("#official-domain-audit-status");
  const button = $("#official-domain-audit-toggle");
  if (!status || !button) return;
  const phaseLabel = {
    starting: "검색 준비 중",
    naver_search: "네이버 검색 중",
    logo_compare: "브랜드 로고 확인 중",
    official_site: "공식 홈페이지 연결 확인 중",
    retrying: "재시도 중",
    saved: "검사 결과 저장 중",
    security_wait: "보안 확인 대기 중",
    timed_out: "응답 지연·다음 브랜드로 이동",
  }[String(audit.phase || "")] || "";
  const stateLabel = audit.state === "cooldown" ? "보안 확인으로 일시 정지 · 검증 계속 버튼을 눌러주세요"
    : audit.state === "blocked" ? "보안 확인으로 일시 정지 · 검증 계속 버튼을 눌러주세요"
    : audit.state === "paused" ? "일시 정지"
      : audit.state === "completed_with_pending" ? "1차 전수검사 완료·미확정 검토 필요"
        : audit.state === "completed" ? "전체 검증 완료"
          : audit.running ? "검증 진행 중" : "대기";
  const attempt = Number(audit.attempt || 0);
  const current = audit.currentBrand ? ` · 현재 ${audit.currentBrand}${phaseLabel ? ` · ${phaseLabel}` : ""}${attempt === 2 ? " · 2차 확인" : ""}` : "";
  status.textContent = `${stateLabel} · 검사 ${inspected.toLocaleString("ko-KR")}/${total.toLocaleString("ko-KR")} (${percent}%) · 공식몰 검색 확인 ${verified.toLocaleString("ko-KR")} · 검색 미지원 ${unsupported.toLocaleString("ko-KR")} · 미확정 ${pending.toLocaleString("ko-KR")}${current}`;
  button.dataset.running = audit.running ? "true" : "false";
  button.textContent = audit.running ? "검증 일시 정지" : inspected ? "검증 계속" : "전체 검증 시작";
  button.classList.toggle("primary", !audit.running);
  explorerMeta.officialDomainAudit = audit;
  explorerMeta.officialDomainSummary = {
    ...(explorerMeta.officialDomainSummary || {}), total, verified, pending,
    searchUnsupported: unsupported, noOfficialStore: Number(audit.noOfficialStore || 0),
  };
}

function renderBrandCards(filter = "") {
  const normalized = filter.trim().toLowerCase();
  const matchedBrands = explorerMeta.brands.filter((brand) =>
    !normalized || `${brand.name} ${brand.ko}`.toLowerCase().includes(normalized)
  );
  // The synchronized catalog is the selectable source of truth. Do not hide
  // most brands behind the former 200/300-card display cap.
  const brands = matchedBrands;
  $("#brand-cards").innerHTML = brands.map((brand) => {
    const downloadComplete = hasCompletedBrandDownload(brand);
    return `<button type="button" class="brand-card ${selectedBrandIds.has(Number(brand.id)) ? "selected" : ""}${downloadComplete ? " download-complete" : ""}" data-brand-id="${brand.id}" aria-pressed="${selectedBrandIds.has(Number(brand.id))}"${brandSelectionBusy ? " disabled aria-busy=\"true\"" : ""}>
    <i class="brand-logo">${brand.logoUrl ? `<img src="${text(brand.logoUrl)}" alt="${text(brand.name)} 로고"><b>${text(brand.name.slice(0, 1))}</b>` : `<b>${text(brand.name.slice(0, 1))}</b>`}</i><span><strong>${text(brand.name)}</strong>${downloadComplete ? '<em class="brand-download-complete">다운완료</em>' : ""}<small>${text(brand.ko)} · Brand ID ${brand.id}</small></span>
  </button>`;
  }).join("");
  document.querySelectorAll(".brand-logo img").forEach((image) => {
    image.addEventListener("load", () => image.parentElement?.classList.add("loaded"), { once: true });
    image.addEventListener("error", () => image.remove(), { once: true });
  });
  const limited = ` · ${brands.length.toLocaleString("ko-KR")}개 표시`;
  const domainSummary = explorerMeta.officialDomainSummary || {};
  const domainStatus = domainSummary.total
    ? ` · 공식몰 확인 ${Number(domainSummary.verified || 0).toLocaleString("ko-KR")}개 · 검증 대기 ${Number(domainSummary.pending || 0).toLocaleString("ko-KR")}개`
    : "";
  $("#brand-summary").textContent = `${explorerMeta.brands.length.toLocaleString("ko-KR")}개 POIZON 브랜드${domainStatus} · 검색 결과 ${matchedBrands.length.toLocaleString("ko-KR")}개${limited}`;
  updateBrandSelectionControls();
}

function renderCategoryButtons() {
  $("#category-buttons").innerHTML = explorerMeta.categories.map((category) =>
    `<button class="category-button ${category === selectedCategory ? "selected" : ""}" data-category="${text(category)}"><strong>${text(category)}</strong><span>›</span></button>`
  ).join("");
}

function domesticKey(product, index) {
  return product.articleNumber || product.spuId || `row-${index}`;
}

function updateExplorerSelectionUi() {
  const selectableKeys = currentExplorerProducts
    .map((product, index) => ({ product, key: domesticKey(product, index) }))
    .filter(({ product }) => !product?.missingRank)
    .map(({ key }) => key);
  const selectedCount = selectableKeys.filter((key) => selectedExplorerKeys.has(key)).length;
  const count = $("#selected-product-count");
  const all = $("#select-visible-products");
  const search = $("#search-selected-domestic");
  if (count) count.textContent = `${selectedCount}개 선택`;
  if (all) {
    all.checked = selectableKeys.length > 0 && selectedCount === selectableKeys.length;
    all.indeterminate = selectedCount > 0 && selectedCount < selectableKeys.length;
  }
  if (search) {
    search.disabled = selectedCount === 0 && !domesticBatchRunning;
    search.textContent = domesticBatchRunning ? "선택 검색 중지" : "선택 상품 국내 재고 검색";
  }
}

function bindExplorerSelectionControls() {
  document.querySelectorAll("[data-product-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const key = decodeURIComponent(checkbox.dataset.productSelect);
      if (checkbox.checked) selectedExplorerKeys.add(key);
      else selectedExplorerKeys.delete(key);
      updateExplorerSelectionUi();
    });
  });
  $("#select-visible-products")?.addEventListener("change", (event) => {
    currentExplorerProducts.forEach((product, index) => {
      if (product?.missingRank) return;
      const key = domesticKey(product, index);
      if (event.target.checked) selectedExplorerKeys.add(key);
      else selectedExplorerKeys.delete(key);
    });
    document.querySelectorAll("[data-product-select]").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });
    updateExplorerSelectionUi();
  });
  $("#clear-product-selection")?.addEventListener("click", () => {
    selectedExplorerKeys.clear();
    document.querySelectorAll("[data-product-select]").forEach((checkbox) => {
      checkbox.checked = false;
    });
    updateExplorerSelectionUi();
  });
  $("#search-selected-domestic")?.addEventListener("click", () => {
    runDomesticBatch({ selectedOnly: true });
  });
  updateExplorerSelectionUi();
}

function domesticStatus(result) {
  if (!result) return { label: "확인 전", className: "pending" };
  if (result.loading) return { label: "검색 중", className: "loading" };
  if (result.error) return { label: "확인 실패", className: "error" };
  const products = result.products || [];
  const verifiedCount = (result.sources || []).reduce((sum, source) =>
    sum + (source.countVerified ? Number(source.count || 0) : 0), 0);
  if (!products.length && verifiedCount > 0) return { label: "판매처 발견", className: "available" };
  if (!products.length) return { label: "상품 없음", className: "missing" };
  if (!products.some((product) => product.inStock)) return { label: "재고 없음", className: "soldout" };
  return { label: "구매 가능", className: "available" };
}

function renderDomestic(result) {
  if (!result) return `<span class="inventory-help">재고 검색을 누르면 공식몰 → 무신사 → 네이버·SSG·롯데온의 공식스토어·백화점·아울렛을 각각 확인합니다.</span>`;
  if (result.loading) return `<span class="inventory-help">국내 플랫폼을 순서대로 확인하고 있습니다…</span>`;
  if (result.error) return `<span class="inventory-help error">국내 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.</span>`;
  const products = (result.products || []).filter((product) => product && (product.name || product.title));
  const verifiedCount = (result.sources || []).reduce((sum, source) =>
    sum + (source.countVerified ? Number(source.count || 0) : 0), 0);
  const sourceByStore = new Map((result.sources || []).map((source) => [source.store, source]));
  const productRows = products.map((product) => {
    const source = sourceByStore.get(product.store) || {};
    const sizes = product?.sizes || [];
    const sourceState = product.inStock ? "available" : "soldout";
    const sourceLabel = product.inStock ? "재고 있음" : "재고 없음";
    const confidenceClass = Number(product?.confidence || 0) >= 75 ? "high"
      : Number(product?.confidence || 0) >= 45 ? "medium" : "low";
    const candidateName = product?.title || product?.name || product?.articleNumber || "";
    return `<div class="platform-row">
      <span class="platform-priority">${source.priority || ""}</span>
      <strong>${text(product.store)}</strong>
      <div class="candidate-summary ${product?.imageUrl ? "" : "no-image"}">
        ${product?.imageUrl ? `<img class="candidate-image" src="${text(product.imageUrl)}" alt="${text(candidateName)}">` : ""}
        <span><b>${text(candidateName || source.store + " 검색 결과")}</b>${product?.price ? `<small>${money(product.price)}</small>` : ""}</span>
      </div>
      <span class="stock-state ${sourceState}">${sourceLabel}</span>
      <span class="confidence ${confidenceClass}">신뢰도 ${Number(product.confidence || 0)}%</span>
      <div class="size-list">${sizes.length
        ? sizes.map((size) => `<span class="size-chip ${size.inStock ? "available" : "soldout"}">${text(size.label)}</span>`).join("")
        : `<span class="size-chip unknown">사이즈 정보 없음</span>`}</div>
      <div class="match-signals"><span>코드 ${text(product.signals?.code)}</span><span>상품명 ${text(product.signals?.title)}</span><span>이미지 ${text(product.signals?.image)}</span></div>
      <button data-url="${encodeURIComponent(product?.url || source.searchUrl)}">${product?.inStock ? "구매" : "확인"}</button>
    </div>`;
  }).join("");
  const sourceResult = (source) => source.verificationFailed
    ? `<small class="source-check-failed">확인 실패</small>`
    : source.countVerified
      ? `<b class="source-count">${Number(source.count || 0) > 0 ? Number(source.count) : "없음"}</b>`
      : `<small>결과 확인</small>`;
  const directLinks = (result.sources || []).map((source) =>
    source.officialProductUrl
      ? `<button class="source-link" data-official-discovery="${encodeURIComponent(source.searchUrl)}" data-official-product="${encodeURIComponent(source.officialProductUrl)}"><span>${text(source.store)}</span>${sourceResult(source)}</button>`
      : `<button class="source-link" data-url="${encodeURIComponent(source.searchUrl)}"><span>${text(source.store)}</span>${source.officialStatus === "pending" ? `<small>도메인 확인 필요</small>` : source.officialStatus === "no_official_store" ? `<small>등록된 공식몰 없음</small>` : source.officialStatus === "search_unsupported" ? `<small>사이트 검색 미지원</small>` : sourceResult(source)}</button>`
  ).join("");
  const emptyMessage = verifiedCount > 0
    ? `판매처에서 ${verifiedCount}개 결과를 확인했습니다. 상세 상품은 아래 판매처에서 확인해 주세요.`
    : "일치하는 국내 판매 상품을 찾지 못했습니다.";
  return `<div class="platform-list">${productRows || `<span class="inventory-help">${emptyMessage}</span>`}</div>
    ${directLinks ? `<div class="source-links">${directLinks}</div>` : ""}`;
}

function renderExplorerResults(title, products, preserveDomestic = false) {
  currentExplorerProducts = products;
  if (!preserveDomestic) {
    domesticResults.clear();
    selectedExplorerKeys.clear();
  }
  $("#explorer-results").hidden = false;
  $("#explorer-result-title").textContent = title;
  $("#explorer-result-count").textContent = `${products.length.toLocaleString("ko-KR")}개 표시`;
  $("#explorer-product-grid").innerHTML = products.length ? `
    <div class="product-selection-toolbar">
      <label><input id="select-visible-products" type="checkbox"> 전체 선택</label>
      <strong id="selected-product-count">0개 선택</strong>
      <button id="clear-product-selection" type="button">선택 해제</button>
      <button id="search-selected-domestic" type="button" class="primary">선택 상품 국내 재고 검색</button>
    </div>
    ${products.map((product, index) => {
    const key = domesticKey(product, index);
    const result = domesticResults.get(key);
    const status = domesticStatus(result);
    if (product.missingRank) return `<article class="explorer-product-row missing-rank-slot">
      <div class="rank-number">${product.rank || index + 1}</div>
      <div class="product-summary missing-rank-summary">
        <div class="image-placeholder">순위 유지</div>
        <div><div class="product-badges"><span class="badge muted">수집 누락</span></div>
        <h3>${text(product.name || `${index + 1}번 상품 수집 누락`)}</h3>
        <p>원본 순위를 삭제하지 않고 빈 슬롯으로 유지합니다.</p></div>
      </div>
    </article>`;
    return `<article class="explorer-product-row">
      <div class="rank-number">${index + 1}</div>
      <div class="product-summary">
        ${product.logoUrl ? `<img src="${text(product.logoUrl)}" alt="">` : `<div class="image-placeholder">POIZON</div>`}
        <div>
          <div class="product-badges"><span class="badge">${text(product.categoryGroup || "인기상품")}</span>${product.apiMatched ? `<span class="badge">API 연결</span>` : product.apiMatched === false ? `<span class="badge muted">API 미일치</span>` : ""}</div>
          <h3>${text(product.title || product.name)}</h3>
          <p>${text(product.brandName || product.brand || "")}</p>
          <div class="explorer-product-meta"><code>${text(product.articleNumber || "")}</code><span>${product.averagePrice || product.minPrice?.value ? money(product.averagePrice || product.minPrice.value) : ""}</span></div>
        </div>
      </div>
      <label class="product-select-option"><input type="checkbox" data-product-select="${encodeURIComponent(key)}" ${selectedExplorerKeys.has(key) ? "checked" : ""}> 선택</label>
      <div class="domestic-inventory">
        <div class="inventory-heading"><span class="inventory-status ${status.className}">${status.label}</span><button data-domestic="${encodeURIComponent(key)}" data-index="${index}" class="primary">국내 재고 검색</button></div>
        ${renderDomestic(result)}
      </div>
    </article>`;
  }).join("")}` : `<div class="empty">조건에 맞는 상품이 없습니다.</div>`;
  bindExplorerSelectionControls();
}

function renderBrandSellerResults(title, products, sourceTotal = products.length) {
  const allProducts = [...products];
  brandWorkbenchProducts = allProducts;
  renderBrandWorkbench();
  const categories = [...new Set(allProducts.map((product) => product.categoryName || product.category).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "ko"));
  domesticResults.clear();
  selectedExplorerKeys.clear();
  $("#explorer-results").hidden = false;
  $("#explorer-result-title").textContent = title;
  $("#explorer-result-count").textContent = "";
  $("#explorer-product-grid").innerHTML = `
    <div class="poizon-result-tabs"><button class="active">상품 검색</button><button type="button">조회 내역</button></div>
    <div class="poizon-filter-strip">
      <button type="button">브랜드⌄</button>
      <select id="brand-result-category"><option value="">카테고리⌄</option>${categories.map((category) => `<option value="${text(category)}">${text(category)}</option>`).join("")}</select>
      <select disabled><option>사이즈 유형⌄</option></select>
      <input id="brand-result-min-total" type="number" min="0" value="50" placeholder="중국 총 판매량 최소" title="중국 총 판매량 최소">
      <input id="brand-result-max-total" type="number" min="0" placeholder="중국 총 판매량 최대" title="중국 총 판매량 최대">
      <input id="brand-result-min-local-total" type="number" min="0" value="50" placeholder="현지 판매자 총 판매량 최소" title="현지 판매자 총 판매량 최소">
      <input id="brand-result-max-local-total" type="number" min="0" placeholder="현지 판매자 총 판매량 최대" title="현지 판매자 총 판매량 최대">
      <select id="brand-result-sales-match" title="두 판매량 조건 결합 방식">
        <option value="any">둘 중 하나 충족 (OR)</option>
        <option value="all">두 조건 모두 충족 (AND)</option>
      </select>
      <select id="brand-result-data-option">
        <option value="">누락값 포함</option>
        <option value="available">두 총 판매량 확인 가능</option>
        <option value="missing">누락값만 표시</option>
      </select>
      <button id="brand-result-reset" type="button" class="poizon-reset">초기화</button>
    </div>
    <div class="poizon-result-summary">
      <strong>총 ${Number(sourceTotal).toLocaleString("ko-KR")}건 결과</strong>
      <span id="brand-collection-audit">수집 ${allProducts.length.toLocaleString("ko-KR")}건</span>
      <select id="brand-result-sort"><option value="total-desc">중국 총 판매량 내림차순</option><option value="total-asc">중국 총 판매량 오름차순</option><option value="local-total-desc">현지 판매자 총 판매량 내림차순</option><option value="local-total-asc">현지 판매자 총 판매량 오름차순</option></select>
      <label class="seller-select-all"><input id="brand-select-visible" type="checkbox"> 전체 선택</label>
      <strong id="brand-selected-count">0개 선택</strong>
      <button id="brand-clear-selection" type="button">선택 해제</button>
      <button id="brand-selected-domestic" type="button" class="primary" disabled>선택 상품 국내 재고 검색</button>
      <button id="brand-filter-domestic" type="button" class="primary">필터 상품 국내 재고 목록</button>
      <button id="brand-result-export" type="button" class="primary">현재 결과 Excel 저장</button>
    </div>
    <div class="seller-result-table">
      <div class="seller-result-head">
        <span>POIZON 상품 정보</span><span>브랜드/카테고리</span>
        <span>최근 30일 평균 거래가</span><span>중국 총 판매량</span><span>현지 판매자 총 판매량</span>
        <span>최근 30일 판매량</span><span>현지 판매자 최근 30일 판매량</span><span>관리</span>
      </div>
      <div id="brand-result-rows"></div>
    </div>`;

  const renderRows = () => {
    const category = $("#brand-result-category").value;
    const minTotalText = $("#brand-result-min-total").value;
    const maxTotalText = $("#brand-result-max-total").value;
    const minLocalTotalText = $("#brand-result-min-local-total").value;
    const maxLocalTotalText = $("#brand-result-max-local-total").value;
    const minimumTotal = minTotalText === "" ? null : Math.max(0, Number(minTotalText));
    const maximumTotal = maxTotalText === "" ? null : Math.max(0, Number(maxTotalText));
    const minimumLocalTotal = minLocalTotalText === "" ? null : Math.max(0, Number(minLocalTotalText));
    const maximumLocalTotal = maxLocalTotalText === "" ? null : Math.max(0, Number(maxLocalTotalText));
    const salesMatch = $("#brand-result-sales-match").value;
    const dataOption = $("#brand-result-data-option").value;
    currentExplorerProducts = allProducts.filter((product) => {
      const chinaFilterActive = minimumTotal !== null || maximumTotal !== null;
      const localFilterActive = minimumLocalTotal !== null || maximumLocalTotal !== null;
      const chinaMatches = product.hasTotalSalesData
        && (minimumTotal === null || Number(product.totalSales) >= minimumTotal)
        && (maximumTotal === null || Number(product.totalSales) <= maximumTotal);
      const localMatches = product.hasLocalTotalSalesData
        && (minimumLocalTotal === null || Number(product.localTotalSales) >= minimumLocalTotal)
        && (maximumLocalTotal === null || Number(product.localTotalSales) <= maximumLocalTotal);
      const activeMatches = [
        ...(chinaFilterActive ? [chinaMatches] : []),
        ...(localFilterActive ? [localMatches] : []),
      ];
      const salesMatches = activeMatches.length === 0
        || (salesMatch === "all" ? activeMatches.every(Boolean) : activeMatches.some(Boolean));
      return (!category || (product.categoryName || product.category || "") === category)
        && salesMatches
        && (dataOption !== "available" || (product.hasTotalSalesData && product.hasLocalTotalSalesData))
        && (dataOption !== "missing" || !product.hasTotalSalesData || !product.hasLocalTotalSalesData);
    });
    const sort = $("#brand-result-sort").value;
    currentExplorerProducts.sort((left, right) => sort === "total-asc"
      ? Number(left.totalSales || 0) - Number(right.totalSales || 0)
      : sort === "local-total-desc"
        ? (Number(right.localTotalSales || 0) - Number(left.localTotalSales || 0))
          || (Number(right.totalSales || 0) - Number(left.totalSales || 0))
        : sort === "local-total-asc"
          ? Number(left.localTotalSales || 0) - Number(right.localTotalSales || 0)
          : Number(right.totalSales || 0) - Number(left.totalSales || 0));
    $("#explorer-result-count").textContent = `${currentExplorerProducts.length.toLocaleString("ko-KR")}개 표시 / 전체 ${allProducts.length.toLocaleString("ko-KR")}개`;
    $("#brand-result-rows").innerHTML = currentExplorerProducts.length ? currentExplorerProducts.map((product, index) => `
      <article class="seller-result-row">
        <div class="seller-product-info">
          <label class="seller-row-select" title="상품 선택"><input type="checkbox" data-product-select="${encodeURIComponent(domesticKey(product, index))}" ${selectedExplorerKeys.has(domesticKey(product, index)) ? "checked" : ""}></label>
          ${product.logoUrl ? `<img src="${text(product.logoUrl)}" alt="">` : `<div class="image-placeholder">POIZON</div>`}
          <div><code>상품 번호: <b>${text(product.articleNumber || "")}</b></code>
          <strong>${text(product.title || product.name || "")}</strong>
          ${product.spuId ? `<small>SPU_ID：${text(product.spuId)}</small>` : ""}</div>
        </div>
        <div class="seller-brand-category"><strong>${text(product.brandName || product.brand || "")}</strong><small>${text(product.categoryName || product.category || "")}</small></div>
        <b>${product.hasPriceData === false ? "데이터 없음" : money(product.averagePrice || product.minPrice?.value || 0)}</b>
        <b>${product.hasTotalSalesData ? text(product.totalSalesRaw || Number(product.totalSales || 0).toLocaleString("ko-KR")) : "확인 불가"}</b>
        <b class="seller-local-total-sales">${product.hasLocalTotalSalesData ? text(product.localTotalSalesRaw || Number(product.localTotalSales || 0).toLocaleString("ko-KR")) : "확인 불가"}</b>
        <b>${product.hasSalesData === false ? "데이터 없음" : `${Number(product.sales30d || 0).toLocaleString("ko-KR")}+`}</b>
        <b class="seller-local-sales">${product.hasLocalSalesData ? text(product.localSales30dRaw || Number(product.localSales30d || 0).toLocaleString("ko-KR")) : "확인 불가"}</b>
        <button data-domestic="${encodeURIComponent(domesticKey(product, index))}" data-index="${index}" class="primary">국내 재고 검색</button>
      </article>`).join("") : `<div class="empty">현재 필터 조건에 맞는 상품이 없습니다.</div>`;
    const visibleKeys = currentExplorerProducts.map((product, index) => domesticKey(product, index));
    const updateBrandSelection = () => {
      const selectedCount = visibleKeys.filter((key) => selectedExplorerKeys.has(key)).length;
      $("#brand-selected-count").textContent = `${selectedCount}개 선택`;
      $("#brand-selected-domestic").disabled = selectedCount === 0 && !domesticBatchRunning;
      $("#brand-selected-domestic").textContent = domesticBatchRunning
        ? "선택 검색 중지"
        : "선택 상품 국내 재고 검색";
      $("#brand-select-visible").checked = visibleKeys.length > 0 && selectedCount === visibleKeys.length;
      $("#brand-select-visible").indeterminate = selectedCount > 0 && selectedCount < visibleKeys.length;
    };
    document.querySelectorAll("#brand-result-rows [data-product-select]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const key = decodeURIComponent(checkbox.dataset.productSelect);
        if (checkbox.checked) selectedExplorerKeys.add(key);
        else selectedExplorerKeys.delete(key);
        updateBrandSelection();
      });
    });
    updateBrandSelection();
  };
  ["#brand-result-category", "#brand-result-min-total", "#brand-result-max-total", "#brand-result-min-local-total", "#brand-result-max-local-total", "#brand-result-sales-match", "#brand-result-data-option", "#brand-result-sort"]
    .forEach((selector) => $(selector).addEventListener("input", renderRows));
  $("#brand-result-reset").addEventListener("click", () => {
    $("#brand-result-category").value = "";
    $("#brand-result-min-total").value = "";
    $("#brand-result-max-total").value = "";
    $("#brand-result-min-local-total").value = "";
    $("#brand-result-max-local-total").value = "";
    $("#brand-result-sales-match").value = "any";
    $("#brand-result-data-option").value = "";
    renderRows();
  });
  $("#brand-select-visible").addEventListener("change", (event) => {
    currentExplorerProducts.forEach((product, index) => {
      const key = domesticKey(product, index);
      if (event.target.checked) selectedExplorerKeys.add(key);
      else selectedExplorerKeys.delete(key);
    });
    renderRows();
  });
  $("#brand-clear-selection").addEventListener("click", () => {
    selectedExplorerKeys.clear();
    renderRows();
  });
  $("#brand-selected-domestic").addEventListener("click", () => {
    runDomesticBatch({ selectedOnly: true });
  });
  $("#brand-filter-domestic").addEventListener("click", () => {
    runDomesticBatch();
  });
  $("#brand-result-export").addEventListener("click", async () => {
    const result = await window.aroundG.exportExplorerExcel({
      title,
      products: currentExplorerProducts.map((product, index) => ({
        ...product,
        selected: selectedExplorerKeys.has(domesticKey(product, index)),
      })),
    });
    if (!result.canceled && result.path) {
      $("#brand-collection-audit").textContent = `Excel 저장 완료: ${result.path}`;
    }
  });
  renderRows();
}

function clearExplorerResults() {
  domesticBatchRunning = false;
  currentExplorerProducts = [];
  domesticResults.clear();
  $("#explorer-results").hidden = true;
  $("#explorer-result-title").textContent = "탐색 결과";
  $("#explorer-result-count").textContent = "";
  $("#explorer-product-grid").innerHTML = "";
  $("#domestic-batch-status").className = "status";
  $("#domestic-batch-status").textContent = "";
  $("#domestic-search-all").textContent = "표시 목록 국내 재고 검색";
}

async function searchDomesticAt(index) {
  const product = currentExplorerProducts[index];
  if (!product) return;
  const key = domesticKey(product, index);
  domesticResults.set(key, { loading: true, products: [], sources: [] });
  const query = [product.brandName || product.brand, product.articleNumber, product.title || product.name].filter(Boolean).join(" ");
  const response = await window.aroundG.searchDomestic({
    query,
    articleNumber: product.articleNumber || "",
    brand: product.brandName || product.brand || "",
    title: product.apiTitle || product.title || product.name || "",
    imageUrl: product.logoUrl || "",
    verifyLinkCounts: !domesticBatchRunning || domesticBatchVerifyCounts,
  });
  domesticResults.set(key, response.ok ? response.data : { products: [], sources: [], error: response.message });
  renderExplorerResults($("#explorer-result-title").textContent, currentExplorerProducts, true);
}

async function refresh() {
  state = await window.aroundG.snapshot();
  renderRecords("ledger");
  renderRecords("orders");
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest(".nav");
  if (nav) {
    if (nav.dataset.view !== "products") clearExplorerResults();
    document.querySelectorAll(".nav,.view").forEach((item) => item.classList.remove("active"));
    nav.classList.add("active");
    $(`#${nav.dataset.view}`).classList.add("active");
    const pageTitle = $("#page-title");
    if (pageTitle) pageTitle.textContent = nav.textContent;
  }
  const remove = event.target.dataset.remove;
  if (remove) {
    const [collection, id] = remove.split(":");
    await window.aroundG.remove(collection, id);
    await refresh();
  }
  const searchButton = event.target.closest("[data-search]");
  const query = searchButton?.dataset.search;
  if (query) {
    const naverUrl = new URL("https://search.naver.com/search.naver");
    naverUrl.searchParams.set("where", "shopping");
    naverUrl.searchParams.set("query", query);
    await window.aroundG.openExternal(naverUrl.toString());
  }
  const externalButton = event.target.closest("[data-url]");
  const externalUrl = externalButton?.dataset.url;
  if (externalUrl) {
    let resolvedUrl = externalUrl;
    try {
      resolvedUrl = decodeURIComponent(externalUrl);
    } catch {
      // Keep an already-decoded URL intact instead of aborting the click.
    }
    await window.aroundG.openExternal(resolvedUrl);
  }
  const officialButton = event.target.closest("[data-official-discovery][data-official-product]");
  const officialDiscovery = officialButton?.dataset.officialDiscovery;
  const officialProduct = officialButton?.dataset.officialProduct;
  if (officialDiscovery && officialProduct) {
    await window.aroundG.openOfficialSearch({
      discoveryUrl: decodeURIComponent(officialDiscovery),
      productUrl: decodeURIComponent(officialProduct),
    });
  }
  const domesticButton = event.target.closest("[data-domestic][data-index]");
  const domesticIndex = domesticButton?.dataset.index;
  if (domesticButton && domesticIndex !== undefined) await searchDomesticAt(Number(domesticIndex));
  const brandButton = event.target.closest(".brand-card[data-brand-id]");
  if (brandButton) {
    if (brandSelectionBusy || activeExportBrand) {
      $("#brand-status").className = "status";
      $("#brand-status").textContent = `${activeExportBrand?.name || selectedBrandName || "선택 브랜드"} 원본 데이터 작업을 등록하고 있습니다.`;
      return;
    }
    toggleBrandSelection(brandButton.dataset.brandId);
    return;
  }
  const category = event.target.closest("[data-category]")?.dataset.category;
  if (category) {
    selectedCategory = category;
    renderCategoryButtons();
  }
});

document.querySelectorAll(".explorer-mode").forEach((button) => button.addEventListener("click", () => {
  const currentMode = document.querySelector(".explorer-mode.active")?.dataset.explorer;
  if (currentMode !== button.dataset.explorer) clearExplorerResults();
  document.querySelectorAll(".explorer-mode,.explorer-panel").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  $(`#explorer-${button.dataset.explorer}`).classList.add("active");
}));

$("#brand-filter").addEventListener("input", (event) => renderBrandCards(event.target.value));
$("#brand-selection-clear")?.addEventListener("click", () => {
  if (brandSelectionBusy) return;
  selectedBrandIds.clear();
  selectedBrandId = null;
  saveBrandSelections();
  renderBrandCards($("#brand-filter")?.value || "");
});
$("#brand-export-selected")?.addEventListener("click", async () => {
  if (brandSelectionBusy || activeExportBrand || brandExportJobs.size) {
    const stoppedBrand = String(activeExportBrand?.name || "").trim();
    brandWorkHistoryGeneration += 1;
    acceptBrandWorkEvents = false;
    brandExportQueue = [];
    detectedBrandImportQueue.length = 0;
    queuedBrandImportPaths.clear();
    activeExportBrand = null;
    if (stoppedBrand) updateBrandBatchState(stoppedBrand, "사용자 중지");
    for (const [key, item] of brandBatchStates.entries()) {
      if (!brandJobIsFinished(item.state)) {
        brandBatchStates.set(key, { ...item, state: "사용자 중지", updatedAt: Date.now() });
      }
    }
    for (const [jobId, job] of brandExportJobs.entries()) {
      if (!brandJobIsFinished(job.state)) {
        brandExportJobs.set(jobId, { ...job, state: "사용자 중지", updatedAt: Date.now() });
      }
    }
    renderBrandBatchProgress();
    stopBrandActivity();
    $("#brand-status").className = "status";
    $("#brand-status").textContent = "브랜드 검색과 다운로드 감시를 모두 중지했습니다.";
    await window.aroundG.stopSellerBrandWork?.();
    brandSelectionBusy = false;
    renderBrandCards($("#brand-filter")?.value || "");
    return;
  }
  const selectedBrands = selectedBrandsForExport();
  if (!selectedBrands.length) return;
  acceptBrandWorkEvents = true;
  brandMainAllComplete = false;
  const generation = brandWorkHistoryGeneration;
  brandExportFailureCount = 0;
  brandBatchTotal = selectedBrands.length;
  brandBatchStates.clear();
  selectedBrands.forEach((brand) => updateBrandBatchState(brand.name, "등록 대기"));
  // Snapshot the exact brands shown as selected. Later catalog rendering or a
  // stale singular brand name must never change the active export queue.
  brandExportQueue = selectedBrands.map((brand) => ({
    id: Number(brand.id),
    name: String(brand.name || "").trim(),
    ko: String(brand.ko || "").trim(),
  }));
  brandSelectionBusy = true;
  clearExplorerResults();
  brandWorkbenchProducts = [];
  renderBrandWorkbench();
  renderBrandCards($("#brand-filter")?.value || "");
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `${selectedBrands.length}개 브랜드 검색 작업을 순서대로 등록합니다.`;
  stopBrandActivity();
  touchBrandActivity(`${selectedBrands.length}개 브랜드 작업 시작`);
  void exportNextSelectedBrand(generation);
});
async function syncFullBrandCatalog({ automatic = false } = {}) {
  const button = $("#brand-sync");
  const status = $("#brand-status");
  button.disabled = true;
  status.className = "status";
  status.textContent = automatic ? "POIZON 공식 브랜드 전체 목록을 자동으로 갱신하는 중…" : "POIZON 공식 브랜드 전체 목록을 불러오는 중…";
  const result = await window.aroundG.syncBrands();
  button.disabled = false;
  if (!result.ok) {
    try {
      const preservedMeta = await window.aroundG.explorerMeta();
      if (Array.isArray(preservedMeta?.brands) && preservedMeta.brands.length) {
        explorerMeta = preservedMeta;
        renderBrandCards($("#brand-filter")?.value || "");
      }
    } catch {}
    status.className = "status error";
    const preservedCount = Number(result.preservedCount || explorerMeta.brands?.length || 0);
    status.textContent = preservedCount
      ? `새 목록 갱신에 실패해 저장된 브랜드 ${preservedCount.toLocaleString("ko-KR")}개를 유지합니다.`
      : [result.error?.message, result.error?.code].filter(Boolean).join(" · ") || "브랜드 동기화에 실패했습니다.";
    return false;
  }
  explorerMeta = await window.aroundG.explorerMeta();
  selectedBrandId = null;
  $("#brand-search").disabled = true;
  renderBrandCards($("#brand-filter").value);
  status.className = "status success";
  status.textContent = `POIZON 공식 브랜드 ${result.brands.length.toLocaleString("ko-KR")}개 검색 등록 완료`;
  return true;
}
$("#brand-sync").addEventListener("click", () => syncFullBrandCatalog());
$("#official-domain-audit-toggle")?.addEventListener("click", async () => {
  const button = $("#official-domain-audit-toggle");
  button.disabled = true;
  if (button.dataset.running === "true") {
    await window.aroundG.stopOfficialDomainAudit();
  } else {
    const result = await window.aroundG.startOfficialDomainAudit();
    if (result?.audit) renderOfficialDomainAudit(result.audit);
  }
  button.disabled = false;
});

async function acceptSellerCenterProducts(products, sourceLabel) {
  const limited = products.slice(0, 200);
  const storedProducts = limited.filter((product) => !product.missingRank).map((product) => ({
    brand: product.brandName || "",
    name: product.name,
    articleNumber: product.articleNumber,
    poizonPrice: product.averagePrice,
    sales30d: product.sales30d,
    popularityRank: product.rank,
    logoUrl: product.logoUrl || "",
    source: "seller-center-direct",
  }));
  await window.aroundG.bulkUpsert("products", storedProducts);
  await window.aroundG.savePopularWorkflow(popularWorkflowInput(true));
  await refresh();
  $("#popular-status").className = "status success";
  $("#popular-status").textContent = `${sourceLabel} · 판매자센터 인기상품 ${limited.length}개를 직접 가져왔습니다.`;
  renderExplorerResults("POIZON 판매자센터 인기상품", limited.map((product) => ({
    ...product,
    hasSalesData: Number(product.sales30d) > 0,
  })));
}

window.aroundG.onSellerCaptureProgress((progress) => {
  const host = $("#popular-progress");
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
  host.hidden = false;
  host.querySelector("i").style.width = `${percent}%`;
  host.querySelector("span").textContent = `${percent}%`;
});
$("#popular-capture").addEventListener("click", async () => {
  const button = $("#popular-capture");
  button.disabled = true;
  $("#popular-progress").hidden = false;
  $("#popular-progress").querySelector("i").style.width = "0%";
  $("#popular-progress").querySelector("span").textContent = "0%";
  $("#popular-status").className = "status";
  $("#popular-status").textContent = "";
  try {
    await window.aroundG.openSellerCenter();
    const result = await window.aroundG.captureSellerCenter();
    if (!result.ok) {
      $("#popular-status").className = "status error";
      $("#popular-status").textContent = result.message;
      return;
    }
    const excelResult = await window.aroundG.stagePopularProductsInExcel(result.products);
    if (!excelResult.ok) {
      $("#popular-status").className = "status error";
      $("#popular-status").textContent = `Excel 저장 또는 다시 불러오기 실패: ${excelResult.message}`;
      return;
    }
    const verifiedProducts = excelResult.products;
    const missingRanks = Array.isArray(excelResult.missing) ? excelResult.missing : [];
    const missingLabel = missingRanks.length
      ? ` · 누락 ${missingRanks.length}개 (${missingRanks.join(", ")})`
      : " · 누락 0개";
    const sourceLabel = `바탕화면 Excel 재검증 완료 ${excelResult.imported}/200${missingLabel} · ${excelResult.path}`;
    await acceptSellerCenterProducts(verifiedProducts, sourceLabel);
    const completedProducts = verifiedProducts.filter((product) => !product.missingRank);
    if (completedProducts.length > 0) {
      await runDomesticBatch();
    } else {
      $("#domestic-batch-status").className = "status error";
      $("#domestic-batch-status").textContent = "재검증된 상품이 없어 국내 재고 검색을 시작하지 않았습니다.";
    }
  } finally {
    button.disabled = false;
  }
});
async function runDomesticBatch(options = {}) {
  const selectedOnly = Boolean(options?.selectedOnly);
  const button = $("#domestic-search-all");
  if (domesticBatchRunning) {
    domesticBatchRunning = false;
    domesticBatchVerifyCounts = false;
    button.textContent = "표시 목록 국내 재고 검색";
    updateExplorerSelectionUi();
    $("#domestic-batch-status").textContent = "국내 재고 검색을 중지했습니다.";
    return;
  }
  domesticBatchRunning = true;
  domesticBatchVerifyCounts = selectedOnly;
  button.textContent = "검색 중지";
  updateExplorerSelectionUi();
  const searchableIndexes = currentExplorerProducts
    .map((product, index) => ({ product, index }))
    .filter(({ product, index }) => !product?.missingRank
      && (!selectedOnly || selectedExplorerKeys.has(domesticKey(product, index))))
    .map(({ index }) => index);
  if (!searchableIndexes.length) {
    domesticBatchRunning = false;
    domesticBatchVerifyCounts = false;
    button.textContent = "표시 목록 국내 재고 검색";
    $("#domestic-batch-status").className = "status error";
    $("#domestic-batch-status").textContent = selectedOnly
      ? "국내 재고를 검색할 상품을 먼저 선택해 주세요."
      : "검색할 상품이 없습니다.";
    updateExplorerSelectionUi();
    return;
  }
  let processed = 0;
  for (const index of searchableIndexes) {
    if (!domesticBatchRunning) break;
    $("#domestic-batch-status").className = "status";
    $("#domestic-batch-status").textContent = selectedOnly
      ? `국내 재고 및 네이버 결과 확인 ${processed + 1}/${searchableIndexes.length}`
      : `국내 재고 검색 ${processed + 1}/${searchableIndexes.length} · 누락 슬롯은 유지하고 확보된 상품부터 진행합니다.`;
    await searchDomesticAt(index);
    processed += 1;
  }
  domesticBatchRunning = false;
  domesticBatchVerifyCounts = false;
  button.textContent = "표시 목록 국내 재고 검색";
  updateExplorerSelectionUi();
  $("#domestic-batch-status").className = "status success";
  const missingCount = currentExplorerProducts.length - searchableIndexes.length;
  $("#domestic-batch-status").textContent = `국내 재고 검색 완료 ${processed}/${searchableIndexes.length} · 원본 누락 슬롯 ${missingCount}개 유지`;
}
$("#domestic-search-all").addEventListener("click", () => runDomesticBatch());
$("#brand-data-search")?.addEventListener("input", renderBrandWorkbench);
async function importDetectedBrandExport(file, generation = brandWorkHistoryGeneration) {
  if (!acceptBrandWorkEvents || generation !== brandWorkHistoryGeneration) return false;
  const jobId = String(file?.jobId || "").trim();
  const registeredBrand = String(brandExportJobs.get(jobId)?.brandName || "").trim();
  const detectedBrand = String(file?.detectedBrandName || "").trim();
  const expectedBrand = detectedBrand || registeredBrand;
  if (!jobId || !expectedBrand) return false;
  if (detectedBrand && normalizeBrandKey(detectedBrand) !== normalizeBrandKey(registeredBrand)) {
    const previous = brandExportJobs.get(jobId) || {};
    brandExportJobs.set(jobId, {
      ...previous,
      brandName: detectedBrand,
      updatedAt: Date.now(),
    });
  }
  retainSelectedBrandName(expectedBrand);
  addDownloadedBrandFile({
    ...file,
    path: file.path,
    name: file.name,
    originalPath: file.path,
  });
  updateBrandExportJob(file?.jobId, "확인완료", file?.brandName);
  updateBrandBatchState(expectedBrand, "확인완료", jobId);
  const unfinishedJobs = [...brandExportJobs.values()].some((job) => !brandJobIsFinished(job.state));
  if (!brandExportQueue.length && !activeExportBrand && !unfinishedJobs) stopBrandActivity();
  $("#brand-status").className = "status success";
  const countLabel = "";
  const jobs = [...brandExportJobs.values()];
  const remainingJobs = jobs.filter((job) => !brandJobIsFinished(job.state)).length;
  const completedJobs = jobs.filter((job) => brandJobIsDownloaded(job.state)).length;
  const completionLabel = `다운로드 완료 ${completedJobs}/${jobs.length}개`;
  $("#brand-status").textContent = remainingJobs
    ? `${expectedBrand} 확인완료${countLabel} · ${completionLabel} · 남은 ${remainingJobs}개 브랜드 작업을 계속 감시합니다.`
    : `${expectedBrand} 확인완료${countLabel} · ${completionLabel} · 받은 Excel 파일 메뉴에서 확인하세요.`;
  const fileStatus = $("#excel-files-status");
  if (fileStatus) {
    fileStatus.className = "status success";
    fileStatus.textContent = "원본 Excel을 그대로 보관했습니다. 파일을 클릭하면 프로그램 안에서 확인할 수 있습니다.";
  }
  return true;
}

async function drainDetectedBrandImports() {
  if (detectedBrandImportRunning) return;
  detectedBrandImportRunning = true;
  try {
    while (detectedBrandImportQueue.length) {
      const file = detectedBrandImportQueue.shift();
      const pathKey = brandImportPathKey(file?.path);
      const jobId = String(file?.jobId || "").trim();
      if (!pathKey || completedBrandImportPaths.has(pathKey) || completedBrandImportJobIds.has(jobId)) {
        queuedBrandImportPaths.delete(pathKey);
        continue;
      }
      updateBrandExportJob(jobId, "Excel 다운로드 등록 중", file?.brandName);
      try {
        const generation = brandWorkHistoryGeneration;
        const imported = await importDetectedBrandExport(file, generation);
        if (imported) {
          completedBrandImportPaths.add(pathKey);
          completedBrandImportJobIds.add(jobId);
        }
      } catch (error) {
        $("#brand-status").className = "status error";
        $("#brand-status").textContent = `원본 Excel 등록 실패: ${error?.message || "UNKNOWN_ERROR"}`;
      } finally {
        queuedBrandImportPaths.delete(pathKey);
      }
    }
  } finally {
    detectedBrandImportRunning = false;
    if (detectedBrandImportQueue.length) void drainDetectedBrandImports();
    else finalizeBrandActivityAfterMainCompletion();
  }
}

window.aroundG.onBrandExportDetected((file) => {
  if (!acceptBrandWorkEvents) return;
  const pathKey = brandImportPathKey(file?.path);
  if (!pathKey || completedBrandImportPaths.has(pathKey) || queuedBrandImportPaths.has(pathKey)) return;
  const resolvedJobId = resolveRendererBrandJobId(file);
  if (!resolvedJobId || completedBrandImportJobIds.has(resolvedJobId)) return;
  const registeredBrand = String(brandExportJobs.get(resolvedJobId)?.brandName || "").trim();
  if (!registeredBrand) return;
  const normalizedFile = {
    ...file,
    jobId: resolvedJobId,
    brandName: registeredBrand,
  };
  updateBrandExportJob(normalizedFile.jobId, "Excel 다운로드 완료 · 프로그램 등록 중", normalizedFile.brandName);
  queuedBrandImportPaths.add(pathKey);
  detectedBrandImportQueue.push(normalizedFile);
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `${normalizedFile.brandName} · Excel 다운로드 완료 · 프로그램에 등록합니다.`;
  void drainDetectedBrandImports();
});
$("#brand-download-files").addEventListener("click", async (event) => {
  const target = event.target.closest("[data-open-brand-file-index]");
  if (!target) return;
  const file = downloadedBrandFiles[Number(target.dataset.openBrandFileIndex)];
  if (!file?.path) return;
  await showExcelPreview(file, 0);
});
$("#brand-download-files").addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const target = event.target.closest(".brand-download-row[data-open-brand-file-index],.brand-download-history-row[data-open-brand-file-index]");
  if (!target) return;
  event.preventDefault();
  const file = downloadedBrandFiles[Number(target.dataset.openBrandFileIndex)];
  if (file?.path) void showExcelPreview(file, 0);
});
$("#excel-preview-close")?.addEventListener("click", () => {
  excelPreviewRequestId += 1;
  activeExcelPreview = null;
  excelPreviewProductMode = true;
  excelPreviewBatchSearching = false;
  $("#excel-preview").hidden = true;
  $("#explorer-files")?.classList.remove("excel-preview-mode");
  $("#products")?.classList.remove("excel-data-view-open");
  document.body.classList.remove("excel-preview-active");
  document.querySelectorAll(".brand-download-row.is-open,.brand-download-history-row.is-open").forEach((row) => row.classList.remove("is-open"));
  requestAnimationFrame(() => window.scrollTo({ top: excelFilesListScrollPosition, left: 0, behavior: "auto" }));
});
$("#excel-view-products")?.addEventListener("click", () => {
  if (!activeExcelPreview || excelPreviewProductMode) return;
  excelPreviewProductMode = true;
  void showExcelPreview(activeExcelPreview.file, 0, currentExcelPreviewFilters());
});
$("#excel-view-raw")?.addEventListener("click", () => {
  if (!activeExcelPreview || !excelPreviewProductMode) return;
  excelPreviewProductMode = false;
  void showExcelPreview(activeExcelPreview.file, 0, currentExcelPreviewFilters());
});
$("#excel-preview-grid")?.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-excel-product-select]");
  if (!checkbox) return;
  const key = decodeURIComponent(checkbox.dataset.excelProductSelect);
  if (checkbox.checked) selectedExcelPreviewProducts.add(key);
  else selectedExcelPreviewProducts.delete(key);
  updateExcelPreviewSelectionUi(excelPreviewPageKeys);
});
$("#excel-preview-grid")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-excel-search-product]");
  if (!button) return;
  void searchExcelPreviewProduct(decodeURIComponent(button.dataset.excelSearchProduct));
});
$("#excel-preview-profit")?.addEventListener("click", async () => {
  const button = $("#excel-preview-profit");
  const keys = [...selectedExcelPreviewProducts].filter((key) => excelPreviewProductCache.has(key));
  if (!keys.length) return;
  button.disabled = true;
  button.textContent = "국내 가격 확인 중…";
  for (const key of keys) {
    if (!excelPreviewSearchResults.has(key) || excelPreviewSearchResults.get(key)?.error) {
      await searchExcelPreviewProduct(key);
    }
  }
  const shipping = Number($("#shipping").value || 0);
  const extra = Number($("#extra").value || 0);
  const feeRate = Number($("#fee").value || 0) / 100;
  const comparisons = keys.map((key) => {
    const product = excelPreviewProductCache.get(key);
    const result = excelPreviewSearchResults.get(key);
    const domestic = (result?.products || [])
      .filter((candidate) => Number(candidate?.price || 0) > 0)
      .sort((left, right) => Number(right?.inStock) - Number(left?.inStock) || Number(left.price) - Number(right.price))[0];
    const domesticSource = (result?.sources || []).find((source) => source?.store === domestic?.store);
    const purchaseUrl = String(domestic?.url || domesticSource?.officialProductUrl || domesticSource?.searchUrl || "");
    const poizonPrice = Number(product?.averagePrice || 0);
    const domesticPrice = Number(domestic?.price || 0);
    const totalCost = poizonPrice + shipping + extra;
    const netProfit = domesticPrice > 0 ? domesticPrice * (1 - feeRate) - totalCost : 0;
    const marginRate = domesticPrice > 0 ? netProfit / domesticPrice * 100 : 0;
    return { product, domestic, purchaseUrl, poizonPrice, domesticPrice, totalCost, netProfit, marginRate };
  });
  const comparable = comparisons.filter((item) => item.poizonPrice > 0 && item.domesticPrice > 0);
  const totals = comparable.reduce((sum, item) => ({
    poizonPrice: sum.poizonPrice + item.poizonPrice,
    domesticPrice: sum.domesticPrice + item.domesticPrice,
    totalCost: sum.totalCost + item.totalCost,
    netProfit: sum.netProfit + item.netProfit,
  }), { poizonPrice: 0, domesticPrice: 0, totalCost: 0, netProfit: 0 });
  $("#cost").value = String(Math.round(totals.poizonPrice));
  $("#sale-price").textContent = money(totals.domesticPrice);
  $("#sale-price-label").textContent = "국내 최저가 합계";
  $("#total-cost").textContent = money(totals.totalCost);
  $("#net-profit").textContent = money(totals.netProfit);
  const summary = $("#profit-selection-summary");
  summary.hidden = false;
  summary.textContent = `선택 ${keys.length.toLocaleString("ko-KR")}개 · 국내 가격 비교 완료 ${comparable.length.toLocaleString("ko-KR")}개 · 판매 수수료 ${Number($("#fee").value || 0).toLocaleString("ko-KR")}%`;
  $("#profit-comparison").hidden = false;
  $("#profit-comparison-count").textContent = `${comparable.length.toLocaleString("ko-KR")}개 비교`;
  $("#profit-comparison-rows").innerHTML = comparisons.map((item) => `<tr>
    <td><b>${text(item.product?.articleNumber || "-")}</b><small>${text(item.product?.title || "")}</small></td>
    <td>${item.poizonPrice ? money(item.poizonPrice) : "가격 없음"}</td>
    <td>${item.domesticPrice ? money(item.domesticPrice) : "검색 결과 없음"}</td>
    <td>${item.purchaseUrl
      ? `<button type="button" class="profit-store-link" data-url="${encodeURIComponent(item.purchaseUrl)}" title="구매 페이지 열기">${text(item.domestic?.store || "판매처 열기")} ↗</button>`
      : "-"}</td>
    <td>${item.poizonPrice ? money(item.totalCost) : "-"}</td>
    <td class="${item.netProfit >= 0 ? "profit-positive" : "profit-negative"}">${item.domesticPrice ? money(item.netProfit) : "-"}</td>
    <td class="${item.marginRate >= 0 ? "profit-positive" : "profit-negative"}">${item.domesticPrice ? `${item.marginRate.toFixed(1)}%` : "-"}</td>
  </tr>`).join("");
  document.querySelector('.nav[data-view="profit"]')?.click();
  button.textContent = "수익계산";
  updateExcelPreviewSelectionUi(excelPreviewPageKeys);
});
$("#profit-back-to-list")?.addEventListener("click", () => {
  document.querySelector('.nav[data-view="products"]')?.click();
  requestAnimationFrame(() => {
    if (activeExcelPreview) $("#excel-preview")?.scrollIntoView({ behavior: "auto", block: "start" });
  });
});
$("#excel-preview-search-selected")?.addEventListener("click", async () => {
  if (excelPreviewBatchSearching) {
    excelPreviewBatchSearching = false;
    updateExcelPreviewSelectionUi([]);
    return;
  }
  const keys = [...selectedExcelPreviewProducts].filter((key) => excelPreviewProductCache.has(key));
  if (!keys.length) return;
  excelPreviewBatchSearching = true;
  updateExcelPreviewSelectionUi([]);
  for (const key of keys) {
    if (!excelPreviewBatchSearching) break;
    await searchExcelPreviewProduct(key);
  }
  excelPreviewBatchSearching = false;
  updateExcelPreviewSelectionUi(excelPreviewPageKeys);
});
$("#excel-preview-prev")?.addEventListener("click", () => {
  if (activeExcelPreview) void showExcelPreview(activeExcelPreview.file, Math.max(0, activeExcelPreview.offset - activeExcelPreview.limit), activeExcelPreview.filters);
});
$("#excel-preview-next")?.addEventListener("click", () => {
  if (activeExcelPreview) void showExcelPreview(activeExcelPreview.file, activeExcelPreview.offset + activeExcelPreview.limit, activeExcelPreview.filters);
});
$("#excel-filter-apply")?.addEventListener("click", () => {
  if (activeExcelPreview) void showExcelPreview(activeExcelPreview.file, 0, currentExcelPreviewFilters());
});
$("#excel-preview-filters")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !activeExcelPreview) return;
  event.preventDefault();
  void showExcelPreview(activeExcelPreview.file, 0, currentExcelPreviewFilters());
});
$("#excel-filter-reset")?.addEventListener("click", () => {
  $("#excel-filter-min-total").value = "";
  $("#excel-filter-min-local-total").value = "";
  $("#excel-filter-match").value = "any";
  if (activeExcelPreview) void showExcelPreview(activeExcelPreview.file, 0, currentExcelPreviewFilters());
});
$("#brand-download-clear")?.addEventListener("click", async () => {
  await restoreDownloadedBrandFiles();
  const status = $("#excel-files-status");
  if (status) {
    status.className = "status success";
    status.textContent = "저장 폴더의 원본 Excel 파일 목록을 새로고침했습니다.";
  }
});
$("#brand-export-folder-select")?.addEventListener("click", async () => {
  const button = $("#brand-export-folder-select");
  const status = $("#brand-status");
  button.disabled = true;
  button.textContent = "선택 중…";
  try {
    const result = await window.aroundG.selectBrandExportFolder();
    if (result?.canceled) return;
    renderBrandExportFolder(result?.folder);
    status.className = "status success";
    status.textContent = `원본 Excel 저장 폴더를 변경했습니다: ${result.folder}`;
  } catch (error) {
    status.className = "status error";
    status.textContent = `폴더 지정 실패: ${error?.message || "폴더를 선택할 수 없습니다."}`;
  } finally {
    button.disabled = false;
    button.textContent = "폴더 지정";
  }
});
window.aroundG.onBrandWorkHistoryCleared?.(() => clearBrandWorkHistoryUi());
window.aroundG.onBrandExportProgress((progress) => {
  if (!acceptBrandWorkEvents) return;
  if (progress?.status === "all-complete") {
    brandMainAllComplete = true;
    renderBrandCompletedJobs();
    finalizeBrandActivityAfterMainCompletion();
    $("#brand-status").className = "status success";
    $("#brand-status").textContent = progress?.message || "모든 작업이 확인완료되었습니다.";
    return;
  }
  updateBrandExportJob(progress?.jobId, progress?.jobState || "자동 감시 중", progress?.brandName);
  if (progress?.brandName) updateBrandBatchState(progress.brandName, progress?.jobState || "자동 감시 중", progress?.jobId);
  touchBrandActivity(progress?.jobState || progress?.message || "POIZON 작업 진행 중");
  $("#brand-status").className = progress?.status === "monitor-recovering" ? "status error" : "status";
  $("#brand-status").textContent = progress?.message || "다운로드를 시작했습니다.";
});
window.aroundG.onBrandExportError((error) => {
  if (!acceptBrandWorkEvents) return;
  updateBrandExportJob(error?.jobId, error?.jobState || "데이터 가져오기 실패", error?.brandName);
  if (error?.brandName) updateBrandBatchState(error.brandName, error?.jobState || "데이터 가져오기 실패", error?.jobId);
  $("#brand-status").className = "status error";
  $("#brand-status").textContent = error.message || "데이터 가져오기 중 오류가 발생했습니다.";
  const unfinishedJobs = [...brandExportJobs.values()].some((job) => !brandJobIsFinished(job.state));
  if (!brandExportQueue.length && !activeExportBrand && !unfinishedJobs) stopBrandActivity();
});
$("#brand-data-download")?.addEventListener("click", async () => {
  if (!brandWorkbenchProducts.length) return;
  const brand = explorerMeta.brands.find((item) => item.id === selectedBrandId);
  const result = await window.aroundG.exportExplorerExcel({
    title: `${brand?.name || "POIZON"}-브랜드-소싱`,
    products: brandWorkbenchProducts,
  });
  if (!result.canceled && result.path) {
    $("#brand-status").className = "status success";
    $("#brand-status").textContent = `Excel 저장 완료: ${result.path}`;
  }
});
retainSelectedBrandName();
renderBrandWorkbench();
renderDownloadedBrandFiles();
$("#brand-export-completed")?.addEventListener("toggle", () => {
  if (!$("#brand-export-completed")?.open) brandCompletedShowAll = false;
  renderBrandCompletedJobs();
});
$("#brand-export-completed-more")?.addEventListener("click", () => {
  brandCompletedShowAll = !brandCompletedShowAll;
  renderBrandCompletedJobs();
});
renderBrandCompletedJobs();
void restoreDownloadedBrandFiles();
void restorePendingBrandExportJobs();
$("#brand-search").addEventListener("click", async () => {
  const button = $("#brand-search");
  const status = $("#brand-status");
  const progress = $("#brand-progress");
  const progressBar = progress.querySelector("i");
  const progressText = progress.querySelector("span");
  const brand = explorerMeta.brands.find((item) => item.id === selectedBrandId);
  button.disabled = true;
  brandProgressActive = true;
  progress.hidden = false;
  progressBar.style.width = "1%";
  progressText.textContent = "1%";
  status.className = "status";
  status.textContent = "";
  let finalPercent = 1;
  try {
    const result = await window.aroundG.queryExplorer({
      mode: "brand",
      brandId: selectedBrandId,
      brandName: brand?.name || "",
      brandUrl: brand?.productUrl || "",
      pageNum: 1,
      pageSize: 100,
      allPages: true,
      minimumSales30: false,
    });
    if (!result.ok) {
      status.className = "status error";
      status.textContent = [result.error?.message, result.error?.code].filter(Boolean).join(" · ");
      return;
    }
    const apiProducts = result.products.map((product) => ({
      ...product,
      brandName: brand?.name || product.brandName || product.brand || "",
    }));
    const apiSourceTotal = Number(result.sourceTotal || result.total || apiProducts.length);
    // API paging is the first 70% of the complete workflow. Seller-centre
    // enrichment owns 70–99%, so the UI must not appear frozen at 98%.
    finalPercent = 70;
    progressBar.style.width = `${finalPercent}%`;
    progressText.textContent = `${finalPercent}%`;
    status.className = "status success";
    status.textContent = `POIZON API ${apiProducts.length.toLocaleString("ko-KR")}건 확인 · 판매자센터 브랜드 통계를 가져오는 중입니다.`;
    status.textContent = `POIZON API ${apiProducts.length.toLocaleString("ko-KR")}건 표시 완료 · 판매자센터 보완 중 (최대 60초)`;
    // Large brands can require roughly 100 Seller Center pages. A fixed
    // 60-second renderer timeout discarded the eventual complete result and
    // left most API-only rows marked as "데이터 없음".
    const sellerResult = await window.aroundG.captureSellerBrandSales({
      brandName: brand?.name || "",
      brandKo: brand?.ko || "",
    });
    if (!sellerResult.ok) {
      // The API collection is complete even when optional seller-centre
      // enrichment is unavailable. Do not leave a completed workflow at 98%.
      finalPercent = 100;
      status.className = "status error";
      status.textContent = sellerResult.message || `판매자센터 브랜드 통계를 가져오지 못했습니다. (${sellerResult.code || "UNKNOWN"})`;
      return;
    }
    if (!sellerResult.ok) {
      status.className = "status error";
      status.textContent = sellerResult.message || "판매자센터 브랜드 전체 상품을 가져오지 못했습니다.";
      return;
    }
    const productMergeKey = (product) => {
      const article = String(product.articleNumber || "").trim().toUpperCase();
      if (article) return `ARTICLE:${article}`;
      const spuId = String(product.spuId || product.globalSpuId || "").trim();
      return spuId ? `SPU:${spuId}` : "";
    };
    const normalizedArticle = (value) => String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const sellerByArticle = new Map();
    const sellerByNormalizedArticle = new Map();
    const sellerBySpu = new Map();
    for (const product of sellerResult.products) {
      const article = String(product.articleNumber || "").trim().toUpperCase();
      const normalized = normalizedArticle(article);
      const spuId = String(product.spuId || product.globalSpuId || "").trim();
      if (article) sellerByArticle.set(article, product);
      if (normalized) sellerByNormalizedArticle.set(normalized, product);
      if (spuId) sellerBySpu.set(spuId, product);
    }
    const products = [];
    const mergedArticles = new Set();
    for (const apiProduct of apiProducts) {
      const articleKey = String(apiProduct.articleNumber || "").trim().toUpperCase();
      const spuKey = String(apiProduct.spuId || apiProduct.globalSpuId || "").trim();
      const sellerProduct = sellerByArticle.get(articleKey)
        || sellerByNormalizedArticle.get(normalizedArticle(articleKey))
        || sellerBySpu.get(spuKey)
        || {};
      products.push({
        ...apiProduct,
        ...sellerProduct,
        averagePrice: Number(sellerProduct.hasPriceData ? sellerProduct.averagePrice : (apiProduct.averagePrice ?? apiProduct.poizonPrice ?? 0)),
        buyerExposure: Number(sellerProduct.hasBuyerExposureData ? sellerProduct.buyerExposure : (apiProduct.buyerExposure ?? 0)),
        sales30d: Number(sellerProduct.hasSalesData ? sellerProduct.sales30d : (apiProduct.sales30d ?? 0)),
        localSales30d: Number(sellerProduct.hasLocalSalesData ? sellerProduct.localSales30d : (apiProduct.localSales30d ?? 0)),
        totalSales: Number(sellerProduct.hasTotalSalesData ? sellerProduct.totalSales : (apiProduct.totalSales ?? 0)),
        localTotalSales: Number(sellerProduct.hasLocalTotalSalesData ? sellerProduct.localTotalSales : (apiProduct.localTotalSales ?? 0)),
        sales30dRaw: sellerProduct.sales30dRaw ?? apiProduct.sales30dRaw ?? "",
        localSales30dRaw: sellerProduct.localSales30dRaw ?? apiProduct.localSales30dRaw ?? "",
        totalSalesRaw: sellerProduct.totalSalesRaw ?? apiProduct.totalSalesRaw ?? "",
        localTotalSalesRaw: sellerProduct.localTotalSalesRaw ?? apiProduct.localTotalSalesRaw ?? "",
        hasPriceData: sellerProduct.hasPriceData ?? Boolean(apiProduct.averagePrice || apiProduct.minPrice?.value),
        hasBuyerExposureData: sellerProduct.hasBuyerExposureData ?? Boolean(apiProduct.buyerExposure),
        hasSalesData: sellerProduct.hasSalesData ?? apiProduct.hasSalesData ?? false,
        hasLocalSalesData: sellerProduct.hasLocalSalesData ?? apiProduct.hasLocalSalesData ?? false,
        hasTotalSalesData: sellerProduct.hasTotalSalesData ?? apiProduct.hasTotalSalesData ?? false,
        hasLocalTotalSalesData: sellerProduct.hasLocalTotalSalesData ?? apiProduct.hasLocalTotalSalesData ?? false,
        // Seller Center is used only for statistics. Keep POIZON API's
        // original English product title instead of replacing it with the
        // localized Seller Center label.
        title: apiProduct.apiTitle || apiProduct.title || apiProduct.name || "",
        logoUrl: sellerProduct.logoUrl || apiProduct.logoUrl || "",
        brandName: brand?.name || apiProduct.brandName || sellerProduct.brandName || "",
        apiMatched: true,
      });
      if (articleKey) mergedArticles.add(`ARTICLE:${articleKey}`);
      if (spuKey) mergedArticles.add(`SPU:${spuKey}`);
      const sellerMatchedKey = productMergeKey(sellerProduct);
      if (sellerMatchedKey) mergedArticles.add(sellerMatchedKey);
    }
    // Keep every Seller Center source row. A formatting difference in an
    // article number or a temporarily missing public API item must never erase
    // the original sales metrics shown by POIZON.
    for (const sellerProduct of sellerResult.products) {
      const mergeKey = productMergeKey(sellerProduct);
      if (!mergeKey || mergedArticles.has(mergeKey)) continue;
      products.push({
        ...sellerProduct,
        title: sellerProduct.title || sellerProduct.name || "",
        brandName: sellerProduct.brandName || brand?.name || "",
        apiMatched: false,
      });
      mergedArticles.add(mergeKey);
    }
    const sourceTotal = Math.max(
      Number(result.sourceTotal || result.total || apiProducts.length),
      Number(sellerResult.sourceTotal || sellerResult.total || 0),
      products.length,
    );
    const missingCount = Math.max(0, sourceTotal - products.length);
    // Progress represents workflow completion, not equality between the seller
    // centre's displayed row count and the number of unique product identities.
    // Count differences are reported separately below and must not leave a
    // completed collection stuck at 98–99%.
    finalPercent = 100;
    status.className = "status success";
    status.textContent = missingCount
      ? `수집 완료 · 판매자센터 표시 총계 ${sourceTotal.toLocaleString("ko-KR")}건 · 상품번호/SPU 기준 고유 상품 ${products.length.toLocaleString("ko-KR")}개 · 표시 총계 차이 ${missingCount.toLocaleString("ko-KR")}건`
      : `판매자센터 원본 ${sourceTotal.toLocaleString("ko-KR")}건 전체 수집 완료 · POIZON API ${apiProducts.length.toLocaleString("ko-KR")}건과 품번 연결`;
    renderBrandSellerResults(`${brand?.name || ""} 브랜드 검색`, products, sourceTotal);
  } finally {
    brandProgressActive = false;
    button.disabled = false;
    progressBar.style.width = `${finalPercent}%`;
    progressText.textContent = `${finalPercent}%`;
    window.setTimeout(() => {
      if (finalPercent === 100) progress.hidden = true;
    }, 1200);
  }
});

$("#category-search").addEventListener("click", async () => {
  const status = $("#category-status");
  status.className = "status";
  status.textContent = "검증 브랜드를 조회하고 카테고리를 분류하는 중…";
  const result = await window.aroundG.queryExplorer({
    mode: "category",
    category: selectedCategory,
    pageNum: 1,
    pageSize: 100,
    minimumSales30: $("#category-min-sales").checked,
    salesByArticle: salesByArticle(),
  });
  if (!result.ok) {
    status.className = "status error";
    status.textContent = result.error.message;
    return;
  }
  status.className = "status success";
  status.textContent = `${selectedCategory} ${result.products.length}개 분류 완료 · 브랜드 ${result.sourceCount}개 응답${result.failedSourceCount ? ` · ${result.failedSourceCount}개 일시 실패` : ""}`;
  renderExplorerResults(`${selectedCategory} 카테고리 검색`, result.products);
});

$("#import-button").addEventListener("click", async () => {
  const result = await window.aroundG.importExcel();
  if (!result.canceled) {
    await refresh();
    alert(`${result.imported}개 상품을 로컬에 가져왔습니다.`);
  }
});
$("#export-button").addEventListener("click", async () => {
  const result = await window.aroundG.exportExcel();
  if (!result.canceled) alert("백업 Excel을 저장했습니다.");
});

function openEntry(collection) {
  entryCollection = collection;
  $("#dialog-title").textContent = collection === "ledger" ? "장부 추가" : "주문 추가";
  ["#entry-brand","#entry-name","#entry-article","#entry-price"].forEach((selector) => $(selector).value = "");
  $("#entry-dialog").showModal();
}
document.querySelectorAll(".add-record").forEach((button) => button.addEventListener("click", () => openEntry(button.dataset.collection)));
$("#entry-save").addEventListener("click", async (event) => {
  event.preventDefault();
  if (!$("#entry-name").value.trim()) return;
  const base = { brand: $("#entry-brand").value.trim(), name: $("#entry-name").value.trim(), articleNumber: $("#entry-article").value.trim() };
  base.price = Number($("#entry-price").value || 0);
  await window.aroundG.upsert(entryCollection, base);
  $("#entry-dialog").close();
  await refresh();
});

function profitResult(costValue, shippingValue, extraValue, feePercent, marginPercent) {
  const cost = Number(costValue || 0) + Number(shippingValue || 0) + Number(extraValue || 0);
  const fee = Number(feePercent || 0) / 100;
  const target = Number(marginPercent || 0) / 100;
  const price = cost > 0 && 1 - fee - target > 0 ? Math.ceil(cost / (1 - fee - target) / 100) * 100 : 0;
  return { cost, price, netProfit: price * (1 - fee) - cost };
}

function calculate(margin) {
  const result = profitResult($("#cost").value, $("#shipping").value, $("#extra").value, $("#fee").value, margin);
  $("#sale-price").textContent = money(result.price);
  $("#sale-price-label").textContent = "예상 판매가";
  $("#total-cost").textContent = money(result.cost);
  $("#net-profit").textContent = money(result.netProfit);
}
document.querySelectorAll("[data-margin]").forEach((button) => button.addEventListener("click", () => calculate(button.dataset.margin)));

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await window.aroundG.saveConfig({ appKey:$("#app-key").value, appSecret:$("#app-secret").value, accessToken:$("#access-token").value, apiBaseUrl:$("#api-base-url").value });
  $("#app-secret").value = "";
  $("#access-token").value = "";
  $("#settings-status").className = "status success";
  $("#settings-status").textContent = "Windows 암호화 저장소에 설정했습니다.";
});
$("#guard-check").addEventListener("click", async () => {
  const result = await window.aroundG.collectorCheck({ page:Number($("#guard-page").value), fingerprint:$("#guard-fingerprint").value, captcha:$("#guard-captcha").checked });
  $("#guard-result").className = result.status === "ready" ? "status success" : "status error";
  $("#guard-result").textContent = result.status === "ready" ? "다음 단계 진행 가능" : result.reason;
});

let updateButtonState = "idle";
let updateButtonResetTimer;
let updatePanelCloseTimer;
const setUpdateButton = (label, { disabled = false, alert = false } = {}) => {
  clearTimeout(updateButtonResetTimer);
  const button = $("#update-check");
  button.childNodes[0].textContent = label;
  button.disabled = disabled;
  $("#update-alert").hidden = !alert;
};
const updatePanel = $("#update-panel");
const appVersionState = $("#app-version-state");
const renderInstalledVersion = (version = "", automaticUpdates = true) => {
  const normalizedVersion = String(version || "").trim();
  appVersionState.querySelector("span").textContent = normalizedVersion ? `현재 v${normalizedVersion}` : "현재 버전 확인 중";
  appVersionState.querySelector("strong").textContent = automaticUpdates ? "자동 확인 켜짐" : "개발 모드";
  appVersionState.classList.toggle("disabled", !automaticUpdates);
};
const showUpdatePanel = () => {
  clearTimeout(updatePanelCloseTimer);
  updatePanel.hidden = false;
};
const closeUpdatePanelLater = (seconds) => {
  clearTimeout(updatePanelCloseTimer);
  updatePanelCloseTimer = setTimeout(() => {
    updatePanel.hidden = true;
  }, seconds * 1000);
};
const renderUpdatePanel = (payload) => {
  if (payload.currentVersion) renderInstalledVersion(payload.currentVersion, true);
  const status = payload.status || "checking";
  const percent = Math.max(0, Math.min(100, Math.round(Number(payload.percent || 0))));
  const state = $("#update-live-state");
  state.className = "update-live-state";
  $("#update-title").textContent = status === "error" ? "연결 재시도 예정" : "자동 업데이트";
  $("#update-message").textContent = payload.message || "업데이트 상태를 확인하고 있습니다.";
  const progress = $("#update-progress");
  const progressText = $("#update-progress-text");
  const showProgress = ["checking", "available", "downloading", "downloaded", "installing"].includes(status);
  const displayPercent = status === "checking" ? 8 : status === "available" ? 12 : status === "downloaded" ? 100 : status === "installing" ? 100 : percent;
  progress.hidden = !showProgress;
  progressText.hidden = !showProgress;
  progress.querySelector("i").style.width = `${displayPercent}%`;
  progressText.textContent = status === "checking" ? "확인 중" : status === "installing" ? "설치 중" : `${displayPercent}%`;
  if (status === "checking") {
    state.classList.add("busy"); $("#update-title").textContent = "업데이트 확인 중";
    $("#update-help").textContent = "확인이 끝나면 자동으로 다음 단계가 진행됩니다.";
  } else if (status === "downloading" || status === "available") {
    state.classList.add("busy"); $("#update-title").textContent = "자동 다운로드 중";
    $("#update-help").textContent = "다운로드 중에도 프로그램을 계속 사용할 수 있습니다.";
  } else if (status === "downloaded") {
    state.classList.add("ready"); $("#update-title").textContent = payload.waitingForWork ? "작업 후 자동 설치" : "자동 설치 준비";
    $("#update-help").textContent = payload.waitingForWork ? "현재 데이터 작업을 안전하게 마친 뒤 자동 설치합니다." : "잠시 후 프로그램이 자동으로 다시 시작됩니다.";
  } else if (status === "installing") {
    state.classList.add("ready"); $("#update-title").textContent = "자동 설치 중";
    $("#update-help").textContent = "설치 후 프로그램이 자동으로 다시 시작됩니다.";
  } else if (status === "current") {
    $("#update-title").textContent = "최신 버전 사용 중";
    $("#update-help").textContent = "6시간마다 새 버전을 자동으로 확인합니다.";
    closeUpdatePanelLater(3);
  } else if (status === "error") {
    state.classList.add("error"); $("#update-title").textContent = "15분 후 다시 확인";
    $("#update-help").textContent = "인터넷 연결을 확인하며 15분 후 자동으로 다시 시도합니다.";
    closeUpdatePanelLater(10);
  }
};
$("#update-check").addEventListener("click", async () => {
  if (updateButtonState !== "idle" && updateButtonState !== "current" && updateButtonState !== "error") {
    return;
  }
  if (updateButtonState === "downloaded") {
    setUpdateButton("설치 중…", { disabled: true, alert: true });
    const restart = await window.aroundG.restartForUpdate();
    if (!restart.ok) setUpdateButton("설치 오류", { alert: true });
    return;
  }
  updateButtonState = "checking";
  setUpdateButton("확인 중…", { disabled: true });
  const result = await window.aroundG.checkForUpdates();
  if (!result.ok) {
    updateButtonState = "error";
    setUpdateButton("확인 오류", { alert: true });
    updateButtonResetTimer = setTimeout(() => setUpdateButton("자동 업데이트"), 4000);
  }
});
window.aroundG.onUpdateStatus((payload) => {
  showUpdatePanel();
  renderUpdatePanel(payload);
  updateButtonState = payload.status;
  if (payload.status === "checking") setUpdateButton("확인 중…", { disabled: true });
  else if (payload.status === "available") setUpdateButton("다운로드 준비", { disabled: true, alert: true });
  else if (payload.status === "downloading") {
    const percent = Math.max(0, Math.min(100, Math.round(Number(payload.percent || 0))));
    setUpdateButton(`다운로드 ${percent}%`, { disabled: true, alert: true });
  } else if (payload.status === "downloaded") {
    setUpdateButton(payload.waitingForWork ? "작업 후 자동 설치" : "자동 설치 준비", { disabled: true, alert: true });
  } else if (payload.status === "installing") {
    setUpdateButton("자동 설치 중…", { disabled: true, alert: true });
  } else if (payload.status === "current") {
    setUpdateButton("최신 버전", { disabled: true });
    updateButtonResetTimer = setTimeout(() => {
      updateButtonState = "idle";
      setUpdateButton("자동 업데이트");
    }, 3000);
  } else if (payload.status === "error") {
    setUpdateButton("업데이트 오류", { alert: true });
    updateButtonResetTimer = setTimeout(() => {
      updateButtonState = "idle";
      setUpdateButton("자동 업데이트");
    }, 4000);
  }
});

(async () => {
  try {
    const appInfo = await window.aroundG.getAppInfo();
    renderInstalledVersion(appInfo?.version, appInfo?.automaticUpdates !== false);
  } catch {
    renderInstalledVersion("2.10.17", true);
  }
  setupBrandLayout();
  // Do not restore a job number as live work. The main process will emit
  // progress only for jobs actually registered in this running session.
  localStorage.removeItem("around-g-last-brand-export-job");
  window.aroundG.onBrandSyncProgress((progress) => {
    if (!brandProgressActive && selectedBrandId) return;
    const status = $("#brand-status");
    const loading = $("#brand-progress");
    const reportedPercent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    const currentPercent = Number.parseFloat(loading.querySelector("i").style.width) || 0;
    const percent = Math.max(currentPercent, reportedPercent);
    loading.hidden = false;
    loading.querySelector("i").style.width = `${percent}%`;
    loading.querySelector("span").textContent = `${percent}%`;
    if (!selectedBrandId) {
      status.className = "status";
      status.textContent = "";
    }
  });
  window.aroundG.onOfficialDomainAuditProgress((audit) => {
    renderOfficialDomainAudit(audit);
    renderBrandCards($("#brand-filter")?.value || "");
  });
  explorerMeta = await window.aroundG.explorerMeta();
  renderOfficialDomainAudit(explorerMeta.officialDomainAudit || {});
  renderDownloadedBrandFiles();
  renderBrandCards();
  renderCategoryButtons();
  if (explorerMeta.needsBrandSync) await syncFullBrandCatalog({ automatic: true });
  const config = await window.aroundG.getConfig();
  const exportFolder = await window.aroundG.getBrandExportFolder();
  renderBrandExportFolder(exportFolder.folder);
  $("#app-key").value = config.appKey;
  $("#api-base-url").value = config.apiBaseUrl;
  $("#app-secret").placeholder = config.hasAppSecret ? "저장됨 · 변경할 때만 입력" : "필수";
  $("#access-token").placeholder = config.hasAccessToken ? "저장됨 · 변경할 때만 입력" : "선택 사항";
  await refresh();
})();
