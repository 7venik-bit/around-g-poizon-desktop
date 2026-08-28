const $ = (selector) => document.querySelector(selector);
const money = (value) => `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
let state = { products: [], ledger: [], orders: [], favorites: [] };
let entryCollection = "ledger";
let explorerMeta = { brands: [], categories: [] };
let selectedBrandId = null;
let selectedCategory = "전체";
let selectedCategoryDetail = "";
const CATEGORY_DETAILS = {
  "전체": ["전체 상품"], "신발": ["운동화", "러닝화", "농구화", "축구화", "샌들·슬리퍼", "구두·부츠"],
  "의류": ["티셔츠", "셔츠", "맨투맨·후드", "바지", "원피스·스커트", "스포츠웨어"],
  "아우터": ["재킷", "바람막이", "패딩", "코트", "베스트"], "가방": ["백팩", "크로스백", "토트백", "숄더백", "파우치"],
  "모자": ["캡", "비니", "버킷햇", "스포츠 모자"], "액세서리": ["양말", "벨트", "지갑", "주얼리", "시계", "기타 소품"],
  "기타": ["라이프스타일", "스포츠용품", "전자기기", "수집품", "기타 상품"],
};
let currentExplorerProducts = [];
let allExplorerProducts = [];
const domesticResults = new Map();
const selectedExplorerKeys = new Set();
let domesticStockOnly = false;
let domesticBatchRunning = false;
let domesticBatchVerifyCounts = false;
let domesticBatchStopRequested = false;
const DOMESTIC_BATCH_PROGRESS_KEY = "around-g-domestic-batch-progress-v3";
const DOMESTIC_RESULT_POLICY_VERSION = 6;
let brandProgressActive = false;
let categorySearchActive = false;
let categorySearchRunId = 0;
let categoryLoadingStartedAt = 0;
let categoryLoadingTimer = null;
let categoryCompletedBrands = [];
let categoryBrandIds = new Set();
let brandWorkbenchProducts = [];
let selectedBrandName = localStorage.getItem("around-g-selected-brand-name") || "";
let selectedBrandIds = new Set();
let pinnedBrandIds = [];
let brandSelectionHistory = [];
let brandExportQueue = [];
let brandExportFailureCount = 0;
let brandBatchTotal = 0;
const brandBatchStates = new Map();
const selectedBrandBatchKeys = new Set();
const BRAND_AUTOMATION_TIMEOUT_MS = 20 * 60 * 1000;
const BRAND_INPUT_RETRY_DELAY_MS = 60 * 1000;
const BRAND_INPUT_RETRY_LIMIT = 2;
let activeExportBrand = null;
let brandSelectionBusy = false;
const brandExportJobs = new Map();
let downloadedBrandFiles = [];
const selectedDownloadedFilePaths = new Set();
let brandCompletedShowAll = false;
let completedBrandShowAll = false;
let activeExcelPreview = null;
let excelPreviewRequestId = 0;
const selectedExcelPreviewProducts = new Set();
let activeExcelPreviewPath = "";
let excelFilesListScrollPosition = 0;
let excelPreviewProductMode = false;
let excelPreviewPageProducts = [];
let excelPreviewPageKeys = [];
let excelPreviewBatchSearching = false;
let excelPreviewIntegrated = false;
let excelPreviewFilesParent = null;
let excelPreviewIntegratedHostId = "brand-integrated-preview-host";
let excelPreviewIntegratedWorkspaceId = "brand-product-workspace";
const EXCEL_SEARCH_RESULTS_KEY = "around-g-excel-search-results-v2";
// Domestic retailer results are live page evidence. A previous run\'s
// "상품 없음" must never become the initial state of a newly started app.
try {
  localStorage.removeItem(EXCEL_SEARCH_RESULTS_KEY);
} catch {}
const excelPreviewProductCache = new Map();
const excelPreviewSearchResults = new Map();
const domesticIdentitySearchCache = new Map();
const detectedBrandImportQueue = [];
const queuedBrandImportPaths = new Set();
const completedBrandImportPaths = new Set();
const completedBrandImportJobIds = new Set();
let detectedBrandImportRunning = false;
let brandWorkHistoryGeneration = 0;
let acceptBrandWorkEvents = true;
let startupRecoveryRunning = false;
let brandActivityTimer = null;
let brandActivityStartedAt = 0;
let brandActivityUpdatedAt = 0;
let brandActivityMessage = "";
let brandMainAllComplete = false;
let favoriteCatalogFallbackActive = false;
const WORK_HISTORY_RESET_KEY = "around-g-work-history-reset-v2.10.4";
const BRAND_INTEGRITY_MIGRATION_KEY = "around-g-brand-integrity-v2";
const DOWNLOAD_STATUS_MIGRATION_KEY = "around-g-download-status-v2.10.29";
const LIVE_JOB_UI_MIGRATION_KEY = "around-g-live-job-ui-v2.10.34";
const PINNED_BRAND_RECOVERY_KEY = "around-g-pinned-brand-recovery-v2.10.322";
const PINNED_BRAND_FORCE_RESTORE_KEY = "around-g-pinned-brand-force-restore-v2.10.328";
const PINNED_BRAND_NAMES_KEY = "around-g-pinned-brand-names";
const LAST_KNOWN_PINNED_BRAND_NAMES = [
  "Adidas Originals", "Converse", "Jordan", "Adidas", "Nike", "COACH",
  "Under Armour", "Skechers", "THE NORTH FACE", "Columbia", "Patagonia",
  "New Balance", "ASICS", "Tommy Hilfiger", "FILA", "Vans", "SALOMON",
  "Polo Ralph Lauren", "PUMA", "Crocs", "MLB", "Lululemon",
];
const FALLBACK_PINNED_BRANDS = LAST_KNOWN_PINNED_BRAND_NAMES.map((name, index) => ({
  id: -10_000 - index,
  name,
  ko: name,
  recoveryFallback: true,
}));

function validExplorerMetadata(value) {
  return value && Array.isArray(value.brands) && value.brands.length > 0;
}

function showFavoriteCatalogFallback() {
  favoriteCatalogFallbackActive = true;
  explorerMeta = { ...explorerMeta, brands: FALLBACK_PINNED_BRANDS, needsBrandSync: false };
  pinnedBrandIds = FALLBACK_PINNED_BRANDS.map((brand) => Number(brand.id));
  renderBrandCards();
  renderCategoryButtons();
}

function applyLoadedExplorerMetadata(metadata) {
  if (!validExplorerMetadata(metadata)) return false;
  explorerMeta = metadata;
  favoriteCatalogFallbackActive = false;
  renderBrandCards($("#brand-filter")?.value || "");
  renderCategoryButtons();
  return true;
}

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

// A new app process always starts with an empty brand selection. Read each
// persistent collection independently: a damaged download/history JSON value
// must never erase a valid favorites list.
localStorage.removeItem("around-g-selected-brand-ids");
selectedBrandIds = new Set();
try {
  const parsed = JSON.parse(localStorage.getItem("around-g-pinned-brand-ids") || "[]");
  pinnedBrandIds = Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
} catch {
  pinnedBrandIds = [];
}
try {
  const parsed = JSON.parse(localStorage.getItem("around-g-brand-selection-history") || "[]");
  brandSelectionHistory = Array.isArray(parsed) ? parsed : [];
} catch {
  brandSelectionHistory = [];
}
try {
  const parsed = JSON.parse(localStorage.getItem("around-g-brand-download-files") || "[]");
  downloadedBrandFiles = Array.isArray(parsed) ? parsed : [];
} catch {
  downloadedBrandFiles = [];
}
try {
  if (localStorage.getItem(BRAND_INTEGRITY_MIGRATION_KEY) !== "done") {
    // Older builds could save Jordan rows under an Adidas filename. Preserve the
    // original Excel files, but discard their unverified UI history.
    downloadedBrandFiles = [];
    localStorage.removeItem("around-g-brand-download-files");
    localStorage.removeItem("around-g-last-brand-export-job");
    localStorage.setItem(BRAND_INTEGRITY_MIGRATION_KEY, "done");
  }
} catch {}

function restoreKnownPinnedBrandsIfMissing() {
  const brands = Array.isArray(explorerMeta.brands) ? explorerMeta.brands : [];
  // Never mark recovery complete before the catalog is available. Startup job
  // inspection can be slow, but favorites must wait for real brand records.
  if (!brands.length) return false;
  const forceKnownList = localStorage.getItem(PINNED_BRAND_FORCE_RESTORE_KEY) !== "done";
  let storedNames = null;
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_BRAND_NAMES_KEY) || "null");
    if (Array.isArray(parsed)) storedNames = parsed.map(String).filter(Boolean);
  } catch {}
  const currentNames = pinnedBrandIds
    .map((id) => brands.find((brand) => Number(brand.id) === Number(id))?.name)
    .filter(Boolean);
  // v2.10.322 could mistake stale numeric IDs for valid current brands. Restore
  // the operator's known list once, then preserve every later user edit,
  // including an intentionally empty list. Resolve in desired-name order so the
  // favorite cards do not get rearranged by catalog order.
  const desiredNames = forceKnownList
    ? LAST_KNOWN_PINNED_BRAND_NAMES
    : storedNames ?? (currentNames.length ? currentNames : LAST_KNOWN_PINNED_BRAND_NAMES);
  const resolvedBrands = desiredNames
    .map((name) => {
      const normalizedName = normalizeBrand(name);
      return brands.find((brand) => normalizeBrand(brand.name) === normalizedName
        || normalizeBrand(brand.ko) === normalizedName);
    })
    .filter((brand, index, matches) => brand
      && matches.findIndex((match) => Number(match?.id) === Number(brand.id)) === index);
  pinnedBrandIds = resolvedBrands.map((brand) => Number(brand.id)).filter(Number.isFinite);
  localStorage.setItem("around-g-pinned-brand-ids", JSON.stringify(pinnedBrandIds));
  localStorage.setItem(PINNED_BRAND_NAMES_KEY, JSON.stringify(desiredNames));
  localStorage.setItem(PINNED_BRAND_RECOVERY_KEY, "done");
  localStorage.setItem(PINNED_BRAND_FORCE_RESTORE_KEY, "done");
  return true;
}

function saveBrandSelections() {
  const pinnedBrandNames = pinnedBrandIds
    .map((id) => explorerMeta.brands.find((brand) => Number(brand.id) === Number(id))?.name)
    .filter(Boolean);
  localStorage.setItem("around-g-selected-brand-ids", JSON.stringify([...selectedBrandIds]));
  // The emergency in-memory catalog keeps the screen usable while IPC is
  // delayed. Never replace the operator's real favorites with its temporary IDs.
  if (!favoriteCatalogFallbackActive) {
    localStorage.setItem("around-g-pinned-brand-ids", JSON.stringify(pinnedBrandIds));
    localStorage.setItem(PINNED_BRAND_NAMES_KEY, JSON.stringify(pinnedBrandNames));
  }
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
  const normalizedJobId = String(jobId || "").trim();
  if (normalizedJobId) {
    for (const [existingKey, existing] of brandBatchStates.entries()) {
      if (existingKey !== key && String(existing?.jobId || "").trim() === normalizedJobId) {
        brandBatchStates.delete(existingKey);
      }
    }
  }
  const previous = brandBatchStates.get(key) || {};
  brandBatchStates.set(key, {
    brandName: String(brandName || previous.brandName || "선택 브랜드").trim(),
    state: String(state || previous.state || "등록 대기"),
    jobId: String(normalizedJobId || previous.jobId || "").trim(),
    createdAt: Number(previous.createdAt || (normalizedJobId ? Date.now() : 0)),
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
  for (const key of [...selectedBrandBatchKeys]) {
    if (!brandBatchStates.has(key)) selectedBrandBatchKeys.delete(key);
  }
  const total = Math.max(brandBatchTotal, items.length);
  const completed = items.filter((item) => /확인완료/.test(item.state)).length;
  const failed = items.filter((item) => /실패|오류|중단|취소/.test(item.state)).length;
  const registered = items.filter((item) => Boolean(item.jobId)).length;
  const processing = items.filter((item) => item.jobId && !/확인완료|실패|오류|중단|취소/.test(item.state)).length;
  panel.hidden = total === 0;
  summary.textContent = `작업번호 생성 ${registered}/${total} · 처리 중 ${processing} · 완료 ${completed} · 실패 ${failed}`;
  list.innerHTML = items.map((item, index) => {
    const key = brandBatchKey(item.brandName);
    const stateClass = /확인완료/.test(item.state) ? " is-complete"
      : /실패|오류|중단|취소/.test(item.state) ? " is-error"
        : item.jobId ? " is-processing" : " is-registering";
    const createdTime = item.createdAt ? brandTime(item.createdAt) : "생성 대기";
    return `<div class="brand-batch-row${stateClass}" data-brand-batch-key="${text(key)}"><label class="brand-batch-check"><input type="checkbox" ${selectedBrandBatchKeys.has(key) ? "checked" : ""} aria-label="${text(item.brandName)} 선택"></label><b class="brand-batch-order">${index + 1}</b><strong>${text(item.brandName)}</strong><code>${item.jobId ? text(item.jobId) : "생성 전"}</code><time>${text(createdTime)}</time><span>${text(item.state)}</span></div>`;
  }).join("");
  const selectAll = $("#brand-batch-select-all");
  const deleteButton = $("#brand-batch-delete");
  if (selectAll) {
    selectAll.checked = items.length > 0 && selectedBrandBatchKeys.size === items.length;
    selectAll.indeterminate = selectedBrandBatchKeys.size > 0 && selectedBrandBatchKeys.size < items.length;
  }
  if (deleteButton) deleteButton.disabled = selectedBrandBatchKeys.size === 0;
}

function downloadedFileByEncodedPath(encodedPath = "") {
  const path = decodeURIComponent(String(encodedPath || ""));
  return downloadedBrandFiles.find((file) => brandImportPathKey(file.path) === brandImportPathKey(path)) || null;
}

async function openIntegratedBrandExcel(file, productSearch = false) {
  if (!file?.path) return;
  // Opening a downloaded workbook must never apply a sales filter on the
  // user's behalf. Filters run only after the user enters values and presses
  // the manual "필터 적용" button.
  const minimum = "";
  $("#excel-filter-min-total").value = "";
  $("#excel-filter-min-local-total").value = "";
  $("#brand-product-workspace-title").textContent = `${file.brandName || "선택 브랜드"} · 원본 Excel 전체 보기`;
  $("#brand-product-workspace-meta").textContent = `작업번호 ${file.jobId || "-"} · ${file.name || file.path}`;
  // Always start with the untouched worksheet rows. Product grouping and
  // filters are optional manual actions chosen by the user afterward.
  excelPreviewProductMode = false;
  await showExcelPreview(file, 0, {
    minimumTotal: minimum,
    minimumLocalTotal: minimum,
    fixedTotalAnd: true,
    matchMode: "all",
    productView: false,
  }, { integrated: true, preserveFilters: false, productView: false });
}

async function openIntegratedPopularExcel(file) {
  if (!file?.path) return;
  $("#popular-product-workspace-title").textContent = "POIZON 인기리스트 · 원본 Excel 상품검색";
  $("#popular-product-workspace-meta").textContent = `${file.name || file.path} · 우측 마지막 칸에서 국내 상품과 구매 링크를 확인합니다.`;
  excelPreviewProductMode = false;
  await showExcelPreview(file, 0, {
    minimumTotal: "",
    minimumLocalTotal: "",
    fixedTotalAnd: true,
    matchMode: "all",
    productView: false,
  }, {
    integrated: true,
    integratedHostId: "popular-integrated-preview-host",
    integratedWorkspaceId: "popular-product-workspace",
    preserveFilters: false,
    productView: false,
  });
}

$("#brand-export-completed-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-completed-action]");
  const row = button?.closest("[data-completed-file-path]");
  if (!button || !row) return;
  const file = downloadedFileByEncodedPath(row.dataset.completedFilePath);
  if (!file) return;
  if (button.dataset.completedAction === "folder") {
    await window.aroundG.revealBrandExportFile(file.path);
    return;
  }
  await openIntegratedBrandExcel(file, button.dataset.completedAction === "search");
});
$("#brand-product-workspace-close")?.addEventListener("click", () => $("#excel-preview-close")?.click());
$("#popular-product-workspace-close")?.addEventListener("click", () => $("#excel-preview-close")?.click());

$("#brand-batch-list")?.addEventListener("change", (event) => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  const row = checkbox?.closest("[data-brand-batch-key]");
  const key = String(row?.dataset.brandBatchKey || "");
  if (!key) return;
  checkbox.checked ? selectedBrandBatchKeys.add(key) : selectedBrandBatchKeys.delete(key);
  renderBrandBatchProgress();
});
$("#brand-batch-select-all")?.addEventListener("change", (event) => {
  selectedBrandBatchKeys.clear();
  if (event.target.checked) for (const key of brandBatchStates.keys()) selectedBrandBatchKeys.add(key);
  renderBrandBatchProgress();
});
$("#brand-batch-delete")?.addEventListener("click", () => {
  for (const key of selectedBrandBatchKeys) brandBatchStates.delete(key);
  selectedBrandBatchKeys.clear();
  brandBatchTotal = brandBatchStates.size;
  renderBrandBatchProgress();
});

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
    <div class="brand-export-completed-row" data-completed-file-path="${encodeURIComponent(file.path || "")}">
      <div class="brand-export-completed-brand"><strong>${text(file.brandName)}</strong>${file.historyCount ? `<small>이전 기록 ${file.historyCount}건</small>` : ""}</div>
      <code>${file.jobId ? `작업번호 ${text(file.jobId)}` : "과거 파일 · 작업번호 기록 없음"}</code>
      <time>${text(brandTime(file.time))}</time>
      <div class="brand-export-completed-actions">
        <button type="button" class="primary" data-completed-action="search">상품검색</button>
        <button type="button" data-completed-action="excel">Excel 보기</button>
        <button type="button" data-completed-action="folder">폴더 열기</button>
      </div>
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

function rendererBrandsMatch(left = "", right = "") {
  const leftKey = normalizeBrandKey(left);
  const rightKey = normalizeBrandKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  return leftKey.length >= 5 && rightKey.length >= 5
    && (leftKey.includes(rightKey) || rightKey.includes(leftKey));
}

function brandImportPathKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/[\\/]+/g, "\\")
    .toLocaleLowerCase();
}

function hasCompletedBrandDownload(brand = {}) {
  return Boolean(latestCompletedBrandDownload(brand));
}

function latestCompletedBrandDownload(brand = {}) {
  const names = [brand.name, brand.ko].filter(Boolean);
  return downloadedBrandFiles
    .filter((file) => names.some((name) => rendererBrandsMatch(name, file.brandName || file.brand)))
    .sort((left, right) => Number(right.time || right.mtimeMs || right.lastDownloadedAt || 0)
      - Number(left.time || left.mtimeMs || left.lastDownloadedAt || 0))[0] || null;
}

function completedDownloadBrands() {
  const completed = [];
  const seen = new Set();
  for (const file of [...downloadedBrandFiles].sort((left, right) =>
    Number(right.time || right.mtimeMs || right.lastDownloadedAt || 0)
      - Number(left.time || left.mtimeMs || left.lastDownloadedAt || 0))) {
    const fileBrandName = String(file.brandName || file.brand || "").trim();
    const brand = explorerMeta.brands.find((item) =>
      rendererBrandsMatch(item.name, fileBrandName) || rendererBrandsMatch(item.ko, fileBrandName)
    );
    const brandId = Number(brand?.id);
    if (!brand || !Number.isFinite(brandId) || seen.has(brandId)) continue;
    seen.add(brandId);
    completed.push(brand);
  }
  return completed;
}

function brandDownloadCardTime(value = 0) {
  const date = new Date(Number(value || 0));
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "날짜 확인 불가";
  const two = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}.${two(date.getMonth() + 1)}.${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
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
        <span>선택</span><span>브랜드</span><span>원본 Excel 파일</span><span>작업번호</span><span>받은 시각</span><span>크기</span><span>열기</span>
      </div>${grouped.map(({ brandName, meta, files }) => {
      const [latest, ...history] = files;
      const logo = meta?.logoUrl
        ? `<img src="${text(meta.logoUrl)}" alt="${text(brandName)} 로고"><b>${text(brandName.slice(0, 1))}</b>`
        : `<b>${text(brandName.slice(0, 1))}</b>`;
      const historyRow = ({ file, index }) => `
        <div class="brand-download-history-row" data-open-brand-file-index="${index}" role="button" tabindex="0">
          <label class="brand-download-check"><input type="checkbox" data-select-brand-file-index="${index}" ${selectedDownloadedFilePaths.has(brandImportPathKey(file.path)) ? "checked" : ""} aria-label="${text(file.name || "Excel 파일")} 선택"></label>
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
            <label class="brand-download-check"><input type="checkbox" data-select-brand-file-index="${latest.index}" ${selectedDownloadedFilePaths.has(brandImportPathKey(latest.file.path)) ? "checked" : ""} aria-label="${text(latest.file.name || "Excel 파일")} 선택"></label>
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
  const selectedCount = downloadedBrandFiles.filter((file) => selectedDownloadedFilePaths.has(brandImportPathKey(file.path))).length;
  const selectAll = $("#brand-download-select-all");
  const deleteButton = $("#brand-download-delete");
  if (selectAll) {
    selectAll.checked = downloadedBrandFiles.length > 0 && selectedCount === downloadedBrandFiles.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < downloadedBrandFiles.length;
  }
  if (deleteButton) {
    deleteButton.disabled = selectedCount === 0;
    deleteButton.textContent = selectedCount ? `선택 삭제 ${selectedCount}개` : "선택 삭제";
  }
}

function currentExcelPreviewFilters() {
  return {
    minimumTotal: $("#excel-filter-min-total")?.value ?? "",
    minimumLocalTotal: $("#excel-filter-min-local-total")?.value ?? "",
    fixedTotalAnd: true,
    matchMode: "all",
    productView: excelPreviewProductMode,
  };
}

function excelProductColumnIndex(headers = []) {
  return headers.findIndex((header) => /^(상품\s*번호|상품\s*코드|품번|article\s*(number|no)?|product\s*(number|no)?|货号|商品编号)$/i.test(String(header || "").trim()));
}

function excelImageColumn(header = "") {
  return /^(?:SPU\s*이미지|SKU\s*이미지|상품\s*이미지|이미지(?:\s*URL)?)$/i.test(String(header || "").trim());
}

function renderRawExcelCell(cell, header = "", columnIndex = 0) {
  const value = String(cell ?? "").trim();
  if (excelImageColumn(header) && /^https:\/\//i.test(value)) {
    return `<td class="excel-raw-data-cell excel-image-cell" data-excel-column-index="${columnIndex}" title="${text(value)}"><a href="${text(value)}" target="_blank" rel="noreferrer" aria-label="제품 이미지 크게 보기"><img src="${text(value)}" alt="제품 이미지" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('a').hidden=true"></a></td>`;
  }
  const displayValue = !value ? "숨김" : cell;
  return `<td class="excel-raw-data-cell" data-excel-column-index="${columnIndex}" title="${text(displayValue)}">${text(displayValue)}</td>`;
}

function rawExcelDomesticResultLinks(result = {}) {
  const links = [];
  const seen = new Set();
  let naverOverviewAdded = false;
  const add = (label, url) => {
    const value = String(url || "").trim();
    if (!/^https?:\/\//i.test(value) || seen.has(value)) return;
    seen.add(value);
    links.push({ label: String(label || "판매처").trim() || "판매처", url: value });
  };
  for (const product of result.products || []) {
    if (/^네이버(?:\s|$)/.test(String(product.retailerName || product.store || ""))) continue;
    add(product.retailerName || product.store || "상품 링크", product.url);
  }
  for (const source of result.sources || []) {
    if (/^네이버(?:\s|$)/.test(String(source.store || ""))) {
      if (!naverOverviewAdded) {
        const naverOverviewUrl = source.resultsUrl || source.searchResultsUrl || source.searchUrl;
        if (/^https?:\/\//i.test(String(naverOverviewUrl || ""))) {
          add("네이버 전체 결과", naverOverviewUrl);
          naverOverviewAdded = true;
        }
      }
      continue;
    }
    add(
      source.store || "판매처 검색",
      source.verifiedProductUrl || source.officialProductUrl || source.officialSearchUrl
        || source.homepageUrl || source.searchUrl,
    );
  }
  return links.slice(0, 4);
}

function renderRawExcelDomesticCell(key, product, result) {
  if (!product) return `<td class="excel-raw-search-cell"><span class="excel-raw-search-state muted">검색 정보 없음</span></td>`;
  if (result?.loading) {
    return `<td class="excel-raw-search-cell"><span class="excel-raw-search-state loading">검색 중…</span></td>`;
  }
  if (!result) {
    return `<td class="excel-raw-search-cell"><button type="button" class="excel-product-search" data-excel-search-product="${encodeURIComponent(key)}">상품검색</button></td>`;
  }
  const products = Array.isArray(result.products) ? result.products : [];
  const verifiedCount = (result.sources || []).reduce((sum, source) =>
    sum + (source?.countVerified ? Number(source?.count || 0) : 0), 0);
  const needsReview = Boolean(result.error) || (result.sources || []).some((source) =>
    source?.verificationPending || source?.verificationFailed || source?.securityVerificationRequired || source?.loginRequired
  );
  const state = products.length
    ? { label: `상품 있음 · ${products.length.toLocaleString("ko-KR")}개`, className: "available" }
    : verifiedCount > 0
      ? { label: `상품 있음 · ${verifiedCount.toLocaleString("ko-KR")}개`, className: "available" }
      : needsReview
        ? { label: "검색 실패", className: "error" }
        : { label: "상품 없음", className: "missing" };
  const links = rawExcelDomesticResultLinks(result);
  return `<td class="excel-raw-search-cell">
    <div class="excel-raw-search-summary"><span class="excel-raw-search-state ${state.className}">${text(state.label)}</span><button type="button" class="excel-raw-search-again" data-excel-search-product="${encodeURIComponent(key)}">다시 검색</button></div>
    <div class="excel-raw-search-links">${links.length
      ? links.map((link) => `<button type="button" data-url="${encodeURIComponent(link.url)}" title="${text(link.label)} 열기">${text(link.label)} ↗</button>`).join("")
      : `<span>확인된 링크 없음</span>`}</div>
  </td>`;
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
    search.textContent = excelPreviewBatchSearching ? "검색 중지" : "상품검색";
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

function verifiedExcelProductPoizonPrice(product) {
  return Number(product?.averagePrice || 0);
}

function normalizedProductIdentity(value = "") {
  return String(value || "").toLocaleLowerCase().replace(/[^a-z0-9가-힣]/g, "");
}

function productCrossCheckIdentity(product = {}) {
  const article = normalizedProductIdentity(product.articleNumber || product.productCode || product.spuId);
  const brandCode = normalizedProductIdentity(product.brandCode || product.brandId);
  const brand = normalizedProductIdentity(product.brandName || product.brand);
  if (article) return `code:${brandCode || brand}:${article}`;
  const title = normalizedProductIdentity(product.apiTitle || product.title || product.name);
  const image = String(product.logoUrl || product.imageUrl || "").trim().split(/[?#]/)[0].toLocaleLowerCase();
  // An image is supporting evidence only.  It can never identify or merge a
  // product unless the normalized brand and full title are also identical.
  return `text:${brandCode || brand}:${title}:${image}`;
}

async function cachedDomesticSearch(product, verifyLinkCounts = true) {
  const identity = productCrossCheckIdentity(product);
  if (domesticIdentitySearchCache.has(identity)) return domesticIdentitySearchCache.get(identity);
  const articleNumber = product.articleNumber || "";
  const productCode = product.productCode || product.spuId || product.globalSpuId || "";
  const brandName = product.brandName || product.brand || "";
  const productName = product.apiTitle || product.title || product.name || "";
  const request = window.aroundG.searchDomestic({
    query: articleNumber
      ? [brandName, articleNumber].filter(Boolean).join(" ")
      : [brandName, productName].filter(Boolean).join(" "),
    articleNumber,
    productCode,
    brand: brandName,
    brandId: product.brandCode || product.brandId || "",
    title: productName,
    imageUrl: product.logoUrl || product.imageUrl || "",
    verifyLinkCounts,
  });
  domesticIdentitySearchCache.set(identity, request);
  const response = await request;
  if (!response?.ok) domesticIdentitySearchCache.delete(identity);
  return response;
}

function clearDomesticIdentityCache(product) {
  domesticIdentitySearchCache.delete(productCrossCheckIdentity(product));
}

function poizonServiceFee(price, categoryName = "") {
  const amount = Number(price || 0);
  if (amount <= 0) return 0;
  const premiumCategory = /가방|캐리어|시계|액세서리/.test(String(categoryName || ""));
  const rate = premiumCategory ? 0.14 : 0.10;
  const minimum = premiumCategory ? 18_000 : 15_000;
  return Math.min(45_000, Math.max(minimum, Math.round(amount * rate)));
}

function renderExcelProductRows(file, products = []) {
  const pageKeys = products.map((product) => `${brandImportPathKey(file.path)}::${product.key || product.articleNumber || product.spuId}`);
  products.forEach((product, index) => excelPreviewProductCache.set(pageKeys[index], product));
  $("#excel-preview-columns").innerHTML = `<tr><th class="excel-product-select-column">선택</th><th>이미지</th><th>상품번호</th><th>상품명</th><th>브랜드</th><th>카테고리</th><th>평균가격</th><th>중국 총판매</th><th>현지 총판매</th><th>상품 검색</th></tr>`;
  $("#excel-preview-rows").innerHTML = products.length ? products.map((product, index) => {
    const key = pageKeys[index];
    const result = excelPreviewSearchResults.get(key);
    const poizonPrice = verifiedExcelProductPoizonPrice(product);
    const outcome = result && !result.loading ? domesticStatus(result) : null;
    const status = result?.loading ? "검색 중…" : result?.error ? "검색 실패" : result
      ? outcome?.className === "available" ? `${(result.products || []).length}개 상품 있음`
        : outcome?.className === "soldout" ? "상품 있음·재고 없음"
          : outcome?.className === "pending" ? "추가 확인 필요"
            : "국내 상품 없음"
      : "상품 검색";
    const groupClass = index % 2 === 0 ? "excel-product-group-blue" : "excel-product-group-amber";
    const outcomeClass = outcome ? `excel-search-outcome-${outcome.className}` : "";
    const productLabel = [product.articleNumber, product.title].filter(Boolean).join(" · ") || "선택 상품";
    return `<tr class="excel-product-row ${groupClass} ${outcomeClass}">
      <td class="excel-product-select-column"><input type="checkbox" data-excel-product-select="${encodeURIComponent(key)}" aria-label="제품 선택"></td>
      <td class="excel-product-image">${product.logoUrl ? `<img src="${text(product.logoUrl)}" alt="">` : "-"}</td>
      <td><b>${text(product.articleNumber || "-")}</b></td><td title="${text(product.title)}">${text(product.title || "-")}</td>
      <td>${text(product.brandName || "-")}</td><td title="${text(product.categoryName)}">${text(product.categoryName || "-")}</td>
      <td>${poizonPrice ? money(poizonPrice) : "가격 없음"}</td>
      <td>${excelProductMetric(product.totalSalesRaw, product.totalSales)}</td><td>${excelProductMetric(product.localTotalSalesRaw, product.localTotalSales)}</td>
      <td><button type="button" class="excel-product-search" data-excel-search-product="${encodeURIComponent(key)}" ${result?.loading ? "disabled" : ""}>${status}</button></td>
    </tr>${result && !result.loading ? `<tr class="excel-product-search-detail ${groupClass} ${outcomeClass}"><td colspan="10"><div class="excel-product-search-result-label"><span></span><strong>${text(productLabel)}</strong>의 국내 검색 결과 <b class="excel-search-outcome-label">${text(outcome?.label || "확인 완료")}</b></div>${renderDomestic(result, product)}</td></tr>` : ""}`;
  }).join("") : `<tr><td class="empty" colspan="10">조건에 맞는 상품이 없습니다.</td></tr>`;
  return pageKeys;
}

function restoreSavedExcelSearchResults(filePath = "") {
  excelPreviewSearchResults.clear();
  // Search results are live inventory evidence, not workbook data. Never
  // restore an earlier run when a workbook is opened again.
  try {
    localStorage.removeItem(EXCEL_SEARCH_RESULTS_KEY);
  } catch {}
}

function persistExcelSearchResults(filePath = "") {
  // Keep current-run results in memory only. A loading or parsing failure must
  // not reappear as "상품 없음" after the next program launch.
  try {
    localStorage.removeItem(EXCEL_SEARCH_RESULTS_KEY);
  } catch {}
}

async function searchExcelPreviewProduct(key, { forceRefresh = true } = {}) {
  const product = excelPreviewProductCache.get(key);
  if (!product) return;
  // A direct row-button click is an explicit refresh. A selected-row batch,
  // however, reuses the first verified result for duplicate POIZON rows with
  // the same normalized brand and article number.
  if (forceRefresh) clearDomesticIdentityCache(product);
  excelPreviewSearchResults.delete(key);
  excelPreviewSearchResults.set(key, { loading: true, products: [], sources: [] });
  const file = activeExcelPreview?.file;
  if (file && activeExcelPreview?.viewMode === "products") renderExcelProductRows(file, excelPreviewPageProducts);
  else if (file) void showExcelPreview(file, activeExcelPreview?.offset || 0, activeExcelPreview?.filters || currentExcelPreviewFilters(), { preserveFilters: true });
  const response = await cachedDomesticSearch(product, true);
  const result = response.ok ? response.data : { products: [], sources: [], error: response.message };
  excelPreviewSearchResults.set(key, result);
  if (file?.path) persistExcelSearchResults(file.path);
  if (file && activeExcelPreview?.viewMode === "products") renderExcelProductRows(file, excelPreviewPageProducts);
  else if (file) void showExcelPreview(file, activeExcelPreview?.offset || 0, activeExcelPreview?.filters || currentExcelPreviewFilters(), { preserveFilters: true });
  updateExcelPreviewSelectionUi(excelPreviewPageProducts.map((item) => `${brandImportPathKey(file?.path)}::${item.key || item.articleNumber || item.spuId}`));
}

async function showExcelPreview(file, offset = 0, filters = currentExcelPreviewFilters(), options = {}) {
  if (!file?.path) return;
  const filesPanel = $("#explorer-files");
  const productsView = $("#products");
  const preview = $("#excel-preview");
  const integrated = options.integrated ?? excelPreviewIntegrated;
  if (!excelPreviewFilesParent) excelPreviewFilesParent = preview?.parentElement || filesPanel;
  excelPreviewIntegrated = Boolean(integrated);
  if (excelPreviewIntegrated) {
    if (options.integratedHostId) excelPreviewIntegratedHostId = options.integratedHostId;
    if (options.integratedWorkspaceId) excelPreviewIntegratedWorkspaceId = options.integratedWorkspaceId;
    $(`#${excelPreviewIntegratedHostId}`)?.append(preview);
    const integratedWorkspace = $(`#${excelPreviewIntegratedWorkspaceId}`);
    if (integratedWorkspace) integratedWorkspace.hidden = false;
    filesPanel?.classList.remove("excel-preview-mode");
    productsView?.classList.remove("excel-data-view-open");
    document.body.classList.remove("excel-preview-active");
    $("#excel-preview-close").textContent = "상품검색 닫기";
  } else {
    if (excelPreviewFilesParent && preview?.parentElement !== excelPreviewFilesParent) excelPreviewFilesParent.append(preview);
    $("#brand-product-workspace").hidden = true;
    $("#popular-product-workspace").hidden = true;
    $("#excel-preview-close").textContent = "← 파일 목록으로";
  }
  if (!excelPreviewIntegrated) {
    if (!filesPanel?.classList.contains("excel-preview-mode")) excelFilesListScrollPosition = window.scrollY;
    filesPanel?.classList.add("excel-preview-mode");
    productsView?.classList.add("excel-data-view-open");
    document.body.classList.add("excel-preview-active");
  }
  if (activeExcelPreviewPath !== file.path) {
    if (!options.preserveFilters) {
      $("#excel-filter-min-total").value = "";
      $("#excel-filter-min-local-total").value = "";
      filters = { ...filters, minimumTotal: "", minimumLocalTotal: "" };
    }
    selectedExcelPreviewProducts.clear();
    excelPreviewProductCache.clear();
    restoreSavedExcelSearchResults(file.path);
    excelPreviewProductMode = Boolean(options.productView ?? filters.productView);
    filters = { ...filters, productView: excelPreviewProductMode };
    activeExcelPreviewPath = file.path;
  }
  const requestId = ++excelPreviewRequestId;
  const loading = $("#excel-preview-loading");
  const grid = $("#excel-preview-grid");
  const pager = $("#excel-preview-pager");
  preview.hidden = false;
  loading.hidden = false;
  loading.textContent = "Excel을 프로그램 안에서 불러오는 중입니다.";
  grid.hidden = true;
  pager.hidden = true;
  $("#excel-preview-name").textContent = file.name || "Excel 미리보기";
  (excelPreviewIntegrated ? $(`#${excelPreviewIntegratedWorkspaceId}`) : filesPanel)?.scrollIntoView({ behavior: "auto", block: "start" });
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
  const productsByRow = new Map(products.map((product) => [Number(product.sourceRowNumber), product]));
  const pageProductsByRow = rows.map((_row, index) => productsByRow.get(Number(rowNumbers[index] || result.offset + index + 2)) || null);
  const pageProductKeys = result.productView
    ? products.map((product) => `${brandImportPathKey(file.path)}::${product.key || product.articleNumber || product.spuId}`)
    : pageProductsByRow.map((product, index) => product
      ? `${brandImportPathKey(file.path)}::${product.key || product.articleNumber || product.spuId}`
      : excelPreviewProductKey(file.path, rows[index], rowNumbers[index] || result.offset + index + 2, productColumn));
  products.forEach((product) => {
    const key = `${brandImportPathKey(file.path)}::${product.key || product.articleNumber || product.spuId}`;
    excelPreviewProductCache.set(key, product);
  });
  excelPreviewPageKeys = pageProductKeys;
  const sourceTotalRows = Number.isFinite(Number(result.sourceTotalRows))
    ? Math.max(0, Number(result.sourceTotalRows))
    : totalRows;
  const sourceTotalProducts = Number.isFinite(Number(result.sourceTotalProducts))
    ? Math.max(0, Number(result.sourceTotalProducts))
    : totalRows;
  const filteredSourceRows = Number.isFinite(Number(result.filteredSourceRows))
    ? Math.max(0, Number(result.filteredSourceRows))
    : totalRows;
  activeExcelPreview = { file, offset: result.offset, limit: result.limit, totalRows, filters, viewMode: result.productView ? "products" : "raw" };
  preview.classList.toggle("product-view", Boolean(result.productView));
  $("#excel-view-products")?.classList.toggle("active", Boolean(result.productView));
  $("#excel-view-raw")?.classList.toggle("active", !result.productView);
  loading.className = "excel-preview-loading";
  loading.hidden = true;
  grid.hidden = false;
  pager.hidden = false;
  const startRow = totalRows ? result.offset + 1 : 0;
  const endRow = Math.min(totalRows, result.offset + rows.length);
  $("#excel-preview-summary").textContent = result.productView
    ? result.filterApplied
      ? `수동 필터 적용 · 원본 ${filteredSourceRows.toLocaleString("ko-KR")}행 · 고유 상품 ${totalRows.toLocaleString("ko-KR")}개 / 전체 ${sourceTotalProducts.toLocaleString("ko-KR")}개 제품 · 현재 ${startRow.toLocaleString("ko-KR")}~${Math.min(totalRows, result.offset + products.length).toLocaleString("ko-KR")}번째 제품`
      : `필터 미적용 · 원본 전체 ${sourceTotalRows.toLocaleString("ko-KR")}행 · 고유 상품 ${totalRows.toLocaleString("ko-KR")}개 · 현재 ${startRow.toLocaleString("ko-KR")}~${Math.min(totalRows, result.offset + products.length).toLocaleString("ko-KR")}번째 제품`
    : result.filterApplied
      ? `원본 데이터 · 필터 결과 ${totalRows.toLocaleString("ko-KR")}행 / 전체 ${sourceTotalRows.toLocaleString("ko-KR")}행 · ${totalColumns.toLocaleString("ko-KR")}열 · 현재 ${startRow.toLocaleString("ko-KR")}~${endRow.toLocaleString("ko-KR")}번째 결과`
      : `원본 Excel 그대로 · ${totalRows.toLocaleString("ko-KR")}행 · ${totalColumns.toLocaleString("ko-KR")}열 · 현재 ${startRow.toLocaleString("ko-KR")}~${endRow.toLocaleString("ko-KR")}행`;
  const missingColumns = [
    result.totalSalesColumn < 0 ? "중국 총 판매량" : "",
    result.localTotalSalesColumn < 0 ? "현지 판매자 총 판매량" : "",
  ].filter(Boolean);
  const diagnostics = result.filterDiagnostics || {};
  const diagnosticText = result.filterApplied && !missingColumns.length
    ? `전체 상품 ${Number(diagnostics.sourceProducts || 0).toLocaleString("ko-KR")}개 · 중국 조건 ${Number(diagnostics.chinaQualifiedProducts || 0).toLocaleString("ko-KR")}개 · 현지 조건 ${Number(diagnostics.localQualifiedProducts || 0).toLocaleString("ko-KR")}개 · 최종 AND ${Number(diagnostics.filteredProducts || 0).toLocaleString("ko-KR")}개 · 값 누락 중국 ${Number(diagnostics.missingChinaProducts || 0).toLocaleString("ko-KR")}개/현지 ${Number(diagnostics.missingLocalProducts || 0).toLocaleString("ko-KR")}개 · 적용 열 ${text(diagnostics.totalSalesHeader || "-")}(${Number(diagnostics.totalSalesColumnNumber || 0)}열), ${text(diagnostics.localTotalSalesHeader || "-")}(${Number(diagnostics.localTotalSalesColumnNumber || 0)}열)`
    : "";
  $("#excel-filter-status").textContent = missingColumns.length
    ? `${missingColumns.join(" · ")} 열을 찾지 못해 해당 조건은 적용되지 않습니다.`
    : result.filterApplied
      ? diagnosticText
      : result.productView ? `판매량 필터를 사용하지 않고 전체 ${sourceTotalRows.toLocaleString("ko-KR")}행을 표시합니다.` : "원본 Excel의 행·열·빈칸·값 순서를 변경하지 않고 표시합니다.";
  $("#excel-preview-selection").hidden = false;
  if (result.productView) {
    renderExcelProductRows(file, products);
  } else {
    $("#excel-preview-columns").innerHTML = `<tr><th class="excel-product-select-column">선택</th>${headers.map((header, columnIndex) => `<th class="excel-raw-data-heading${excelImageColumn(header) ? " excel-image-column" : ""}" data-excel-column-index="${columnIndex}" title="${text(header)}">${text(header)}</th>`).join("")}<th class="excel-raw-search-heading">상품 검색 결과 · 링크</th></tr>`;
    $("#excel-preview-rows").innerHTML = rows.length
      ? rows.map((row, index) => {
          const product = pageProductsByRow[index];
          const key = pageProductKeys[index];
          const searchResult = product ? excelPreviewSearchResults.get(key) : null;
          return `<tr><td class="excel-product-select-column">${product ? `<input type="checkbox" data-excel-product-select="${encodeURIComponent(key)}" aria-label="제품 선택">` : ""}</td>${row.map((cell, columnIndex) => renderRawExcelCell(cell, headers[columnIndex], columnIndex)).join("")}${renderRawExcelDomesticCell(key, product, searchResult)}</tr>`;
        }).join("")
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
  if (!pending.length) return 0;
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
  return pending.length;
}

async function recoverInterruptedBrandWorkOnDemand() {
  const status = $("#brand-status");
  if (status) {
    status.className = "status";
    status.textContent = "이전 다운로드 파일과 중단된 POIZON 작업을 확인하고 있습니다.";
  }
  await restoreDownloadedBrandFiles();
  const pendingCount = await restorePendingBrandExportJobs();
  if (!pendingCount && status) {
    status.className = "status success";
    status.textContent = "수동 확인 완료 · 기존 완료 파일을 반영했고 대기 중인 POIZON 작업이 없습니다.";
  }
  return pendingCount;
}

function renderStartupRecoveryProgress(payload = {}) {
  const panel = $("#startup-recovery");
  const bar = $("#startup-recovery-bar");
  const percentLabel = $("#startup-recovery-percent");
  const message = $("#startup-recovery-message");
  if (!panel || !bar || !percentLabel || !message) return;
  const percent = Math.max(0, Math.min(100, Number(payload.percent) || 0));
  panel.hidden = false;
  panel.classList.toggle("complete", percent >= 100);
  panel.classList.toggle("running", payload.running === undefined
    ? startupRecoveryRunning
    : Boolean(payload.running));
  bar.style.width = `${percent}%`;
  percentLabel.textContent = `${percent}%`;
  message.textContent = payload.message || "기존 POIZON 작업과 변경 사항을 확인하고 있습니다.";
}

window.aroundG.onStartupRecoveryProgress(renderStartupRecoveryProgress);

async function runManualPoizonRecovery() {
  if (startupRecoveryRunning) return;
  const button = $("#startup-recovery-run");
  startupRecoveryRunning = true;
  if (button) {
    button.disabled = true;
    button.textContent = "확인 중…";
  }
  renderStartupRecoveryProgress({
    percent: 0,
    running: true,
    message: "사용자 요청으로 기존 POIZON 작업 및 변경 사항을 확인합니다.",
  });
  try {
    acceptBrandWorkEvents = true;
    const pendingCount = await recoverInterruptedBrandWorkOnDemand();
    renderStartupRecoveryProgress({
      percent: 100,
      message: pendingCount
        ? `기존 작업 확인 완료 · 중단된 ${pendingCount}개 작업의 감시를 재개했습니다.`
        : "기존 POIZON 작업 및 변경 사항 확인을 완료했습니다.",
    });
    if (pendingCount) await window.aroundG.startBrandExportFolderPolling();
  } catch (error) {
    renderStartupRecoveryProgress({
      percent: 100,
      message: `수동 확인을 마쳤지만 일부 파일을 확인하지 못했습니다: ${error?.message || "확인 필요"}`,
    });
  } finally {
    startupRecoveryRunning = false;
    if (button) {
      button.disabled = false;
      button.textContent = "다시 확인";
    }
  }
}

$("#startup-recovery-run")?.addEventListener("click", () => void runManualPoizonRecovery());

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

function updateBrandExportJob(jobId = "", state = "", brandName = "", options = {}) {
  const panel = $("#brand-export-job");
  if (!panel) return;
  const normalizedId = String(jobId || "").trim();
  if (!normalizedId) return;
  const previous = brandExportJobs.get(normalizedId) || {};
  const previousBrand = String(previous.brandName || "").trim();
  const incomingBrand = String(brandName || "").trim();
  const stableBrandName = options.replaceBrand && incomingBrand
    ? incomingBrand
    : previousBrand && previousBrand !== "선택 브랜드"
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
    rendererBrandsMatch(job?.brandName, file?.brandName || file?.detectedBrandName)
  );
  const unfinished = matches.filter(([_jobId, job]) => !brandJobIsFinished(job?.state));
  if (unfinished.length === 1) return unfinished[0][0];
  return matches.length === 1 ? matches[0][0] : "";
}

function toggleBrandSelection(brandId, brandButton = null) {
  const id = Number(brandId);
  const brand = explorerMeta.brands.find((item) => Number(item.id) === id);
  if (!brand) return null;
  const selected = !selectedBrandIds.has(id);
  if (selected) {
    selectedBrandIds.add(id);
    recordBrandSelection(brand, "선택");
  } else {
    selectedBrandIds.delete(id);
    saveBrandSelections();
  }
  selectedBrandId = selectedBrandIds.size === 1 ? [...selectedBrandIds][0] : null;

  // Update only the clicked card. Rebuilding all 3,000+ brand cards on every
  // click made the selection feedback appear several seconds late.
  if (brandButton) {
    brandButton.classList.toggle("selected", selected);
    brandButton.setAttribute("aria-pressed", String(selected));
    brandButton.classList.remove("selection-feedback");
    void brandButton.offsetWidth;
    brandButton.classList.add("selection-feedback");
  }
  updateBrandSelectionControls();
  const status = $("#brand-status");
  if (status) {
    status.className = selected ? "status success" : "status";
    status.textContent = `${brand.name} ${selected ? "선택됨" : "선택 해제됨"} · 총 ${selectedBrandIds.size}개 선택`;
  }
  return brand;
}

function updateBrandSelectionControls() {
  const selectedCount = selectedBrandIds.size;
  const completedCount = completedDownloadBrands().length;
  const count = $("#brand-selected-count");
  const clear = $("#brand-selection-clear");
  const search = $("#brand-export-selected");
  const frequentSearch = $("#frequent-brand-export");
  const domesticSearch = $("#completed-brand-domestic-search");
  const stopCurrent = $("#brand-stop-current");
  if (count) count.textContent = `${selectedCount}개 선택`;
  if (clear) clear.disabled = selectedCount === 0 || brandSelectionBusy;
  [search, frequentSearch].filter(Boolean).forEach((button) => {
    button.disabled = brandSelectionBusy
      ? false
      : button === frequentSearch ? selectedCount === 0 && completedCount === 0 : selectedCount === 0;
    button.classList.toggle("is-running", brandSelectionBusy);
    const label = button.querySelector("span");
    if (label) label.textContent = brandSelectionBusy ? "작업 중지" : "포이즌 상품정보";
  });
  if (domesticSearch) {
    domesticSearch.disabled = brandSelectionBusy || completedCount === 0;
  }
  if (stopCurrent) stopCurrent.disabled = !brandSelectionBusy && !activeExportBrand && !hasActiveBrandExportJobs();
  const lamps = $("#onedrive-lamps");
  if (lamps) {
    const sourcing = brandSelectionBusy || Boolean(activeExportBrand) || hasActiveBrandExportJobs();
    lamps.classList.toggle("sourcing", sourcing);
    if (sourcing) {
      lamps.setAttribute("aria-label", "POIZON 자동 로그인·소싱 작업 진행 중");
      lamps.title = "POIZON 자동 로그인·소싱 작업 진행 중";
    }
  }
}

function selectedBrandsForExport() {
  return [...selectedBrandIds]
    .map((brandId) => explorerMeta.brands.find((brand) => Number(brand.id) === Number(brandId)))
    .filter(Boolean);
}

function hasActiveBrandExportJobs() {
  return [...brandExportJobs.values()].some((job) => !brandJobIsFinished(job?.state));
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
      ? `브랜드 순차 작업 종료 · ${failureCount}개 브랜드 실패`
      : hasActiveBrandExportJobs()
        ? "선택한 모든 브랜드의 작업번호 생성 완료 · 다운로드센터 자동 감시 중입니다."
        : "선택한 모든 브랜드의 내보내기·다운로드가 완료되었습니다.";
    brandExportFailureCount = 0;
    stopBrandActivity();
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
    brandUrl: activeExportBrand.productUrl || "",
    officialHomepageUrl: activeExportBrand.officialHomepageUrl || "",
    deferMonitor: false,
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
    // Detailed Seller Center DOM text belongs in the diagnostic file. Rendering
    // it repeatedly in the status table made the whole application stutter.
    const failureReason = String(automation?.diagnostics?.reason || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
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
    if (failureCode === "DAILY_SEARCH_LIMIT_EXCEEDED") {
      brandExportQueue = [];
      brandSelectionBusy = false;
      renderBrandCards($("#brand-filter")?.value || "");
      $("#brand-status").className = "status error";
      $("#brand-status").textContent = "포이즌 검색 데이터는 하루 20번만 가능합니다. 오늘 사용 가능 횟수를 초과했습니다.";
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
    const completedBrand = activeExportBrand;
    updateBrandExportJob(automation.jobId, "작업번호 생성 완료 · 처리·다운로드 대기", completedBrand.name);
    updateBrandBatchState(completedBrand.name, "작업번호 생성 완료 · 다운로드 완료 대기", automation.jobId);
    recordBrandSelection(activeExportBrand, "전체 내보내기 요청", { jobId: automation.jobId });
    $("#brand-status").className = "status";
    $("#brand-status").textContent = `${completedBrand.name} · 작업번호 ${automation.jobId} 생성 확인 완료 · 다음 브랜드로 이동합니다.`;
    touchBrandActivity(`${completedBrand.name} · 작업번호 등록 완료 · 다운로드 감시 중`);
    void window.aroundG.startSellerBrandExportMonitor();
    activeExportBrand = null;
    // The generated job number is the ownership boundary. Once it is recorded,
    // the shared monitor can track that download independently while the visible
    // Seller Center starts the next brand.
    await new Promise((resolve) => setTimeout(resolve, 900));
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
  const noOfficialStore = Number(audit.noOfficialStore || 0);
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
      : audit.state === "scheduled" ? "수동 검증 대기"
      : audit.state === "paused" ? "수동 검증 대기"
      : audit.state === "completed_with_pending" ? "1차 전수검사 완료·공식몰 추가 확인 필요"
        : audit.state === "completed" ? "전체 검증 완료"
          : audit.running ? "검증 진행 중" : "대기";
  const attempt = Number(audit.attempt || 0);
  const current = audit.currentBrand ? ` · 현재 ${audit.currentBrand}${phaseLabel ? ` · ${phaseLabel}` : ""}${attempt === 2 ? " · 2차 확인" : ""}` : "";
  const notFoundExcel = audit.notFoundExcelPath
    ? ` · 네이버 공식몰 미발견 Excel ${Number(audit.notFoundCount || 0).toLocaleString("ko-KR")}개 저장`
    : audit.notFoundExportError ? " · 미발견 Excel 저장 실패" : "";
  status.textContent = `${stateLabel} · 검사 ${inspected.toLocaleString("ko-KR")}/${total.toLocaleString("ko-KR")} (${percent}%) · 공식몰·상품검색 확인 ${verified.toLocaleString("ko-KR")} · 공식몰 확인·상품검색 연결 불가 ${unsupported.toLocaleString("ko-KR")} · 공식몰 미발견·재확인 필요 ${pending.toLocaleString("ko-KR")}${current}${notFoundExcel}`;
  button.dataset.running = audit.running ? "true" : "false";
  button.textContent = audit.running ? "검증 일시 정지" : pending ? "미연동 브랜드 재점검" : inspected ? "검증 완료" : "전체 검증 시작";
  button.classList.toggle("primary", !audit.running);
  explorerMeta.officialDomainAudit = audit;
  explorerMeta.officialDomainSummary = {
    ...(explorerMeta.officialDomainSummary || {}), total, verified, pending,
    searchUnsupported: unsupported, noOfficialStore,
  };
}

function renderWeeklySiteHealth(health = {}) {
  const panel = $("#weekly-site-health");
  const status = $("#weekly-site-health-status");
  const report = $("#weekly-site-health-report");
  const button = $("#weekly-site-health-run");
  if (!panel || !status || !report || !button) return;
  panel.classList.toggle("running", Boolean(health.running));
  panel.classList.toggle("success", !health.running && health.state === "completed");
  panel.classList.toggle("error", !health.running && ["failed", "completed_with_errors"].includes(health.state));
  const completed = Number(health.completed || 0);
  const total = Number(health.total || 0);
  const progress = health.running && total ? ` (${completed}/${total})` : "";
  status.textContent = `${health.message || "매주 수요일 밤 12시에 모든 연동 서버를 자동 점검합니다."}${progress}`;
  const nextRun = health.nextRunAt ? new Date(health.nextRunAt).toLocaleString("ko-KR") : "";
  report.textContent = health.reportPath
    ? `Excel 보고서: ${health.reportPath}${nextRun ? ` · 다음 점검 ${nextRun}` : ""}`
    : nextRun ? `다음 점검 ${nextRun}` : "";
  button.disabled = Boolean(health.running);
  button.textContent = health.running ? "점검 중…" : "지금 점검";
}

function renderBrandCards(filter = "") {
  const normalized = filter.trim().toLowerCase();
  const matchedBrands = explorerMeta.brands.filter((brand) =>
    !normalized || `${brand.name} ${brand.ko}`.toLowerCase().includes(normalized)
  );
  // The top group is derived only from original Excel files that still exist
  // in the configured download folder. It is deduplicated and ordered by the
  // newest workbook, so stale favorite storage can never affect this list.
  const completedBrands = completedDownloadBrands();
  const completedOrder = new Map(completedBrands.map((brand, index) => [Number(brand.id), index]));
  pinnedBrandIds = completedBrands.map((brand) => Number(brand.id));
  const visibleCompletedBrands = matchedBrands.filter((brand) => completedOrder.has(Number(brand.id)))
    .sort((left, right) => completedOrder.get(Number(left.id)) - completedOrder.get(Number(right.id)));
  const displayedCompletedBrands = normalized || completedBrandShowAll
    ? visibleCompletedBrands
    : visibleCompletedBrands.slice(0, 10);
  const regularBrands = matchedBrands.filter((brand) => !completedOrder.has(Number(brand.id)));
  const brandMarkup = (brands) => brands.map((brand) => {
    const latestDownload = latestCompletedBrandDownload(brand);
    const downloadComplete = Boolean(latestDownload);
    const latestDownloadTime = brandDownloadCardTime(latestDownload?.time || latestDownload?.mtimeMs || latestDownload?.lastDownloadedAt);
    const selected = selectedBrandIds.has(Number(brand.id));
    const downloadGroup = completedOrder.has(Number(brand.id));
    const officialLinked = ["verified", "search_unsupported"].includes(String(brand.officialDomainStatus || ""));
    const officialMissing = String(brand.officialDomainStatus || "") === "no_official_store";
    const officialDomain = (() => {
      try { return new URL(String(brand.officialHomepageUrl || "")).hostname.replace(/^www\./, ""); } catch { return ""; }
    })();
    return `<button type="button" class="brand-card ${selected ? "selected" : ""}${downloadGroup ? " brand-pinned" : ""}${downloadComplete ? " download-complete" : ""}${officialLinked ? " official-linked" : ""}${officialMissing ? " official-missing" : ""}" data-brand-id="${brand.id}" aria-pressed="${selected}"${officialDomain ? ` title="공식몰: ${text(brand.officialHomepageUrl)}"` : ""}${brandSelectionBusy ? " disabled aria-busy=\"true\"" : ""}>
    ${officialLinked ? '<em class="brand-official-badge" aria-label="공식몰 연동 완료">공식</em>' : ""}
    ${officialMissing ? '<em class="brand-official-badge missing" aria-label="국내 공식몰 없음">공식몰 없음</em>' : ""}
    <i class="brand-logo">${brand.logoUrl ? `<img src="${text(brand.logoUrl)}" alt="${text(brand.name)} 로고"><b>${text(brand.name.slice(0, 1))}</b>` : `<b>${text(brand.name.slice(0, 1))}</b>`}</i><span><strong>${text(brand.name)}</strong>${brand.salesPriority ? `<small class="brand-sales-rank">판매 상위 ${Number(brand.salesRank).toLocaleString("ko-KR")}위</small>` : ""}${downloadComplete ? `<em class="brand-download-complete">다운완료</em><small class="brand-download-date">${text(latestDownloadTime)}${latestDownload?.jobId ? ` · 작업번호 ${text(latestDownload.jobId)}` : ""}</small><small class="brand-download-open" role="button" tabindex="0" data-open-brand-download="${encodeURIComponent(latestDownload.path || "")}">Excel 열기</small>` : ""}<small>${text(brand.ko)} · Brand ID ${brand.id}</small></span>${officialDomain ? `<small class="brand-official-domain" title="${text(officialDomain)}">${text(officialDomain)}</small>` : ""}
  </button>`;
  }).join("");
  $("#frequent-brand-cards").innerHTML = displayedCompletedBrands.length
    ? brandMarkup(displayedCompletedBrands)
    : '<p class="empty">저장 폴더에 다운로드 완료된 원본 Excel 파일이 없습니다.</p>';
  $("#brand-cards").innerHTML = brandMarkup(regularBrands);
  const frequentGroup = $("#frequent-brand-group");
  frequentGroup.hidden = false;
  $("#frequent-brand-count").textContent = `${visibleCompletedBrands.length.toLocaleString("ko-KR")}개`;
  const completedToggle = $("#completed-brand-toggle");
  if (completedToggle) {
    completedToggle.hidden = Boolean(normalized) || visibleCompletedBrands.length <= 10;
    completedToggle.textContent = completedBrandShowAll
      ? "최근 10개"
      : `전체보기 (${visibleCompletedBrands.length.toLocaleString("ko-KR")}개)`;
  }
  $("#all-brand-count").textContent = `${regularBrands.length.toLocaleString("ko-KR")}개`;
  document.querySelectorAll(".brand-logo img").forEach((image) => {
    image.addEventListener("load", () => image.parentElement?.classList.add("loaded"), { once: true });
    image.addEventListener("error", () => image.remove(), { once: true });
  });
  const visibleCount = displayedCompletedBrands.length + regularBrands.length;
  const limited = ` · ${visibleCount.toLocaleString("ko-KR")}개 표시`;
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
  const details = CATEGORY_DETAILS[selectedCategory] || ["전체 상품"];
  $("#category-detail-section").hidden = false;
  $("#category-detail-buttons").innerHTML = details.map((detail) =>
    `<button type="button" class="category-detail-button ${detail === selectedCategoryDetail ? "selected" : ""}" data-category-detail="${text(detail)}">${text(detail)}</button>`
  ).join("");
  $("#category-selection-path").textContent = selectedCategoryDetail ? `${selectedCategory} 〉 ${selectedCategoryDetail}` : `${selectedCategory} 〉 세부 메뉴를 선택해 주세요.`;
  renderCategoryFavoriteBrands();
  $("#category-search").disabled = !selectedCategoryDetail || !categoryBrandIds.size;
}

function renderCategoryFavoriteBrands({ reset = false } = {}) {
  const favoriteIds = pinnedBrandIds.map(Number).filter(Number.isFinite);
  const favoriteSet = new Set(favoriteIds);
  if (reset) categoryBrandIds = new Set(favoriteIds);
  else categoryBrandIds = new Set([...categoryBrandIds].filter((id) => favoriteSet.has(Number(id))));
  const brands = favoriteIds.map((id) => explorerMeta.brands.find((brand) => Number(brand.id) === id)).filter(Boolean);
  $("#category-brand-cards").innerHTML = brands.length ? brands.map((brand) => {
    const selected = categoryBrandIds.has(Number(brand.id));
    return `<button type="button" class="category-brand-card ${selected ? "selected" : ""}" data-category-brand-id="${brand.id}" aria-pressed="${selected}"><i>${brand.logoUrl ? `<img src="${text(brand.logoUrl)}" alt="">` : text(brand.name.slice(0, 1))}</i><span><strong>${text(brand.name)}</strong><small>${text(brand.ko || "")} · ID ${brand.id}</small></span><b>${selected ? "선택됨" : "선택"}</b></button>`;
  }).join("") : '<p class="empty">다운로드가 완료된 브랜드가 없습니다.</p>';
  $("#category-brand-count").textContent = `${categoryBrandIds.size}/${brands.length}개 선택`;
  $("#category-brand-select-all").disabled = !brands.length || categoryBrandIds.size === brands.length;
  $("#category-brand-clear").disabled = !categoryBrandIds.size;
  $("#category-search").disabled = !selectedCategoryDetail || !categoryBrandIds.size;
}

function domesticKey(product, index) {
  return product.articleNumber || product.spuId || `row-${index}`;
}

function domesticBatchId(products = allExplorerProducts) {
  const first = products.find((product) => !product?.missingRank);
  const last = [...products].reverse().find((product) => !product?.missingRank);
  return [selectedCategory, products.length, domesticKey(first || {}, 0), domesticKey(last || {}, products.length - 1)]
    .map((value) => String(value || "").replace(/[^a-z0-9가-힣._-]/gi, "_"))
    .join(":");
}

function readDomesticBatchProgress(batchId) {
  try {
    const saved = JSON.parse(localStorage.getItem(DOMESTIC_BATCH_PROGRESS_KEY) || "null");
    return saved?.batchId === batchId && !saved?.complete ? saved : null;
  } catch {
    return null;
  }
}

function saveDomesticBatchProgress(progress) {
  localStorage.setItem(DOMESTIC_BATCH_PROGRESS_KEY, JSON.stringify({ ...progress, updatedAt: new Date().toISOString() }));
}

async function restoreDomesticStockResults(batchId) {
  state = await window.aroundG.snapshot();
  for (const saved of state.domesticSearches || []) {
    if (saved.policyVersion === DOMESTIC_RESULT_POLICY_VERSION && saved.batchId === batchId && saved.key && saved.result) domesticResults.set(saved.key, saved.result);
  }
}

async function clearSavedDomesticStockResults(batchId) {
  state = await window.aroundG.snapshot();
  const stale = (state.domesticSearches || []).filter((saved) =>
    saved.batchId === batchId || saved.policyVersion !== DOMESTIC_RESULT_POLICY_VERSION
  );
  for (const saved of stale) await window.aroundG.remove("domesticSearches", saved.id);
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
  if (result.error) return { label: "상품없음", className: "missing" };
  const products = result.products || [];
  const verifiedCount = (result.sources || []).reduce((sum, source) =>
    sum + (source.countVerified ? Number(source.count || 0) : 0), 0);
  const needsReview = (result.sources || []).some((source) => source.verificationPending || source.verificationFailed);
  if (!products.length && verifiedCount > 0) return { label: "판매처 발견", className: "available" };
  if (!products.length && needsReview) return { label: "추가 확인 필요", className: "pending" };
  if (!products.length) return { label: "없음 확인", className: "missing" };
  if (!products.some((product) => product.inStock)) return { label: "재고 없음", className: "soldout" };
  return { label: "구매 가능", className: "available" };
}

function hasDomesticStock(result) {
  return Boolean(result && !result.loading && !result.error
    && (result.products || []).some((product) => product?.inStock));
}

function domesticStockProducts() {
  return allExplorerProducts.filter((product, index) =>
    hasDomesticStock(domesticResults.get(domesticKey(product, index))));
}

function updateDomesticStockFilter() {
  const button = $("#domestic-stock-filter");
  if (!button) return;
  const availableCount = domesticStockProducts().length;
  button.hidden = allExplorerProducts.length === 0;
  button.classList.toggle("active", domesticStockOnly);
  button.setAttribute("aria-pressed", String(domesticStockOnly));
  button.textContent = domesticStockOnly
    ? `전체 상품 보기 · 국내 재고 ${availableCount.toLocaleString("ko-KR")}개`
    : `국내 재고만 보기 · ${availableCount.toLocaleString("ko-KR")}개`;
}

function renderDomestic(result, sourceProduct = {}) {
  if (!result) return `<span class="inventory-help">재고 검색을 누르면 공식몰 → 무신사 → 네이버·SSG·롯데온의 공식스토어·백화점·아울렛을 각각 확인합니다.</span>`;
  if (result.loading) return `<span class="inventory-help">국내 플랫폼을 순서대로 확인하고 있습니다…</span>`;
  if (result.error) return `<span class="inventory-help">상품없음</span>`;
  const products = (result.products || []).filter((product) => product && (product.name || product.title));
  const verifiedCount = (result.sources || []).reduce((sum, source) =>
    sum + (source.countVerified ? Number(source.count || 0) : 0), 0);
  const sources = result.sources || [];
  const sourceOwnsProduct = (source, product) => {
    const sourceStore = String(source?.store || "");
    const productStore = String(product?.store || "");
    if (sourceStore === String(product?.sourceStore || "")) return true;
    if (sourceStore === productStore) return true;
    if (sourceStore === "SSG" && /^SSG(?:\s|$)/.test(productStore)) return true;
    if (sourceStore === "병행수입·편집샵" && (/병행수입/.test(productStore)
      || String(product?.retailerName || "").startsWith("병행수입"))) return true;
    return false;
  };
  const renderProductRow = (product, source = {}, sourcingLabel = "") => {
    const sizes = product?.sizes || [];
    const sourceState = product.inStock === true ? "available" : product.inStock === false ? "soldout" : "pending";
    const sourceLabel = product.stockStatus === "login_required" ? "로그인 필요" : product.inStock === true ? "재고 있음" : product.inStock === false ? "품절" : "확인 필요";
    const confidenceClass = Number(product?.confidence || 0) >= 75 ? "high"
      : Number(product?.confidence || 0) >= 45 ? "medium" : "low";
    const candidateName = product?.title || product?.name || product?.articleNumber || "";
    const officialVerified = product?.officialStoreVerified === true;
    const confidenceLabel = officialVerified
      ? text(product.sourceTrustLabel || "공식몰 확인완료")
      : `신뢰도 ${Number(product.confidence || 0)}%`;
    const matchSignals = officialVerified
      ? `<span>품번 정확히 일치</span><span>상품 일치도 ${Number(product.productMatchConfidence || 95)}%</span><span>${text(product.imageVerificationLabel || "이미지 확인 필요")}</span>`
      : `<span>코드 ${text(product.signals?.code)}</span><span>상품명 ${text(product.signals?.title)}</span><span>이미지 ${text(product.signals?.image)}</span>`;
    return `<div class="platform-row">
      <span class="platform-priority">${source.priority || ""}</span>
      <strong>${text(product.retailerName || product.store)}</strong>
      <div class="candidate-summary ${product?.imageUrl ? "" : "no-image"}">
        ${product?.imageUrl ? `<img class="candidate-image" src="${text(product.imageUrl)}" alt="${text(candidateName)}">` : ""}
        <span><b>${text(candidateName || source.store + " 검색 결과")}</b>${product?.price ? `<small>${money(product.price)}</small>` : ""}</span>
      </div>
      <span class="stock-state ${sourceState}">${sourceLabel}</span>
      <span class="confidence ${confidenceClass} ${officialVerified ? "official" : ""}">${confidenceLabel}</span>
      <div class="size-list">${sizes.length
        ? sizes.map((size) => `<span class="size-chip ${size.inStock ? "available" : "soldout"}">${text(size.label)}</span>`).join("")
        : `<span class="size-chip unknown">옵션 확인 필요</span>`}</div>
      <div class="match-signals">${matchSignals}</div>
      <button data-url="${encodeURIComponent(product?.url || source.searchUrl)}">${sourcingLabel || (product?.inStock === true ? "구매" : "확인")}</button>
    </div>`;
  };
  const sourceAction = (source, label = "판매처 검색") => {
    const openUrl = String(source.verifiedProductUrl || source.officialProductUrl || source.officialSearchUrl || source.homepageUrl || source.searchUrl || "");
    const query = source.searchQuery || sourceProduct.articleNumber || sourceProduct.productCode || sourceProduct.spuId || result.queryCandidates?.[0] || "";
    if (!openUrl) return `<button class="source-platform-action" type="button" disabled>${label}</button>`;
    if (source.officialStatus) {
      return `<button class="source-platform-action" type="button" data-official-homepage="${encodeURIComponent(source.homepageUrl || openUrl)}" data-official-query="${encodeURIComponent(query)}">${label}</button>`;
    }
    return `<button class="source-platform-action" type="button" data-url="${encodeURIComponent(openUrl)}">${label}</button>`;
  };
  const sourceStatus = (source, matchedProducts) => {
    const available = matchedProducts.filter((product) => product.inStock === true).length;
    if (available) return { label: `재고 ${available}개`, className: "available" };
    if (matchedProducts.length && matchedProducts.every((product) => product.inStock === false)) {
      return { label: "재고 없음", className: "soldout" };
    }
    if (matchedProducts.length) return { label: "재고·사이즈 확인 필요", className: "pending" };
    if (source.securityVerificationRequired) return { label: "보안 확인 필요", className: "pending" };
    if (source.loginRequired) return { label: "로그인 필요", className: "pending" };
    const failureLabels = {
      fashion_town_click_failed: "패션타운 진입 실패",
      search_submission_failed: "검색 입력 실패",
      channel_selection_failed: "채널 선택 실패",
      channel_count_detection_failed: "채널 숫자 인식 실패",
      channel_card_evidence_mismatch: "채널 상품카드 확인 실패",
      ssg_channel_evidence_mismatch: "SSG 채널·상품카드 확인 실패",
      official_filter_failed: "공식몰 필터 실패",
      page_load_timeout: "응답 지연",
      network_error: "접속 실패",
      page_load_failed: "페이지 연결 실패",
      result_parse_failed: "결과 확인 실패",
      result_analysis_failed: "결과 확인 실패",
      search_query_missing: "검색어 확인 필요",
      unknown_search_failure: "검색 실패",
    };
    if (source.verificationFailed) {
      return { label: failureLabels[source.verificationReason] || "검색 실패", className: "pending" };
    }
    if (source.verificationPending) return { label: "상세 확인 필요", className: "pending" };
    if (source.countVerified && Number(source.count || 0) > 0) return { label: `상품 ${Number(source.count)}개`, className: "pending" };
    if (source.countVerified || source.absenceConfirmed) return { label: "상품 없음", className: "missing" };
    return { label: "검색 필요", className: "pending" };
  };
  const renderedProductKeys = new Set();
  const sourceSections = sources.map((source) => {
    const matchedProducts = products.filter((product) => sourceOwnsProduct(source, product));
    matchedProducts.forEach((product) => renderedProductKeys.add(`${product.store}:${product.id || product.url}`));
    if (source.store === "병행수입·편집샵" && !matchedProducts.length && Number(source.count || 0) <= 0) return "";
    const status = sourceStatus(source, matchedProducts);
    const rows = matchedProducts.map((product) => renderProductRow(
      product,
      source,
      source.store === "병행수입·편집샵" ? "상품 소싱" : "",
    )).join("");
    const failureDescriptions = {
      security_verification_required: "네이버 보안 확인 화면이 나타나 상품 검색을 완료하지 못했습니다.",
      login_required: "로그인이 확인되지 않아 공식몰 상품 검색을 완료하지 못했습니다.",
      fashion_town_click_failed: "패션타운 메뉴를 실제로 클릭하지 못해 검색을 중단했습니다.",
      search_submission_failed: "상품코드를 검색창에 입력하고 검색 버튼을 누르는 단계에서 중단됐습니다.",
      channel_selection_failed: "검색 후 요청한 백화점·아울렛 채널을 실제로 선택하지 못했습니다.",
      channel_count_detection_failed: "브랜드직영몰·백화점·아울렛 숫자 3개를 모두 인식하지 못했습니다.",
      channel_card_evidence_mismatch: "상단 채널 숫자와 하단 상품카드·채널 문구가 일치하지 않아 클릭하지 않았습니다.",
      ssg_channel_evidence_mismatch: "SSG 상단 채널과 하단 상품카드의 백화점·아울렛 문구가 일치하지 않아 클릭하지 않았습니다.",
      official_filter_failed: "검색 후 공식 브랜드 필터를 실제로 선택하지 못했습니다.",
      page_load_timeout: "판매처 검색 페이지의 응답 시간이 초과됐습니다.",
      network_error: "판매처 검색 페이지에 연결하지 못했습니다.",
      page_load_failed: "판매처 검색 페이지를 불러오지 못했습니다.",
      result_parse_failed: "검색 화면은 열렸지만 상품 목록을 읽지 못했습니다.",
      result_analysis_failed: "검색 화면은 열렸지만 일치 상품을 판정하지 못했습니다.",
      search_query_missing: "검색에 사용할 상품코드나 상품명이 없습니다.",
      unknown_search_failure: "판매처 검색이 완료되기 전에 중단됐습니다.",
    };
    const detailPending = source.verificationReason
      ? failureDescriptions[source.verificationReason] || "판매처 검색이 완료되기 전에 중단됐습니다."
      : !matchedProducts.length && Number(source.count || 0) > 0
        ? `검색 결과 ${Number(source.count)}개를 확인했습니다. 재고·사이즈 상세 수집이 필요합니다.`
        : source.absenceConfirmed
          ? "상품코드→상품명→상품명+상품코드 순서로 검색을 완료했으며 일치 상품이 없습니다."
          : Number(source.candidateCount || 0) > 0
            ? "일치 후보 상품을 찾았지만 상세 페이지의 재고·사이즈 확인이 완료되지 않았습니다."
            : !matchedProducts.length ? "검색은 완료했지만 재고·사이즈 판정 근거가 부족합니다." : "";
    return `<section class="domestic-source-section ${status.className}${source.store === "병행수입·편집샵" ? " parallel-import-panel" : ""}">
      <div class="domestic-source-heading"><strong>${text(source.store)}</strong><span class="stock-state ${status.className}">${text(status.label)}</span>${sourceAction(source, matchedProducts.length ? "판매처 열기" : "판매처 검색")}</div>
      ${rows ? `<div class="platform-list">${rows}</div>` : `<div class="domestic-source-empty"><span>${text(detailPending)}</span>${sourceAction(source, "검색·재고 확인")}</div>`}
    </section>`;
  }).join("");
  const unmatchedRows = products.filter((product) => !renderedProductKeys.has(`${product.store}:${product.id || product.url}`))
    .map((product) => renderProductRow(product)).join("");
  const emptyMessage = verifiedCount > 0
    ? `판매처에서 ${verifiedCount}개 결과를 확인했습니다. 상세 상품은 아래 판매처에서 확인해 주세요.`
    : "일치하는 국내 판매 상품을 찾지 못했습니다.";
  return `<div class="domestic-source-list">${sourceSections || `<span class="inventory-help">${emptyMessage}</span>`}</div>
    ${unmatchedRows ? `<section class="domestic-source-section"><div class="domestic-source-heading"><strong>추가 판매처</strong></div><div class="platform-list">${unmatchedRows}</div></section>` : ""}`;
}

function renderExplorerResults(title, products, preserveDomestic = false) {
  if (!preserveDomestic) {
    allExplorerProducts = [...products];
    domesticStockOnly = false;
  }
  currentExplorerProducts = products;
  if (!preserveDomestic) {
    domesticResults.clear();
    selectedExplorerKeys.clear();
  }
  $("#explorer-results").hidden = false;
  $("#explorer-result-title").textContent = title;
  $("#explorer-result-count").textContent = domesticStockOnly
    ? `국내 재고 ${products.length.toLocaleString("ko-KR")}개 표시 / 전체 ${allExplorerProducts.length.toLocaleString("ko-KR")}개`
    : `${products.length.toLocaleString("ko-KR")}개 표시`;
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
        ${renderDomestic(result, product)}
      </div>
    </article>`;
  }).join("")}` : `<div class="empty">${domesticStockOnly ? "국내 재고가 확인된 상품이 없습니다." : "조건에 맞는 상품이 없습니다."}</div>`;
  bindExplorerSelectionControls();
  updateDomesticStockFilter();
}

function totalSalesAndMatched(product, chinaMinimum = 30, localMinimum = 30) {
  return Boolean(product?.hasTotalSalesData)
    && Boolean(product?.hasLocalTotalSalesData)
    && Number(product.totalSales) >= chinaMinimum
    && Number(product.localTotalSales) >= localMinimum;
}

function renderBrandSellerResults(title, products, sourceTotal = products.length, comparison = {}) {
  const allProducts = [...products];
  brandWorkbenchProducts = allProducts;
  renderBrandWorkbench();
  const categories = [...new Set(allProducts.map((product) => product.categoryName || product.category).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "ko"));
  domesticResults.clear();
  selectedExplorerKeys.clear();
  allExplorerProducts = [];
  domesticStockOnly = false;
  $("#domestic-stock-filter").hidden = true;
  $("#explorer-results").hidden = false;
  $("#explorer-result-title").textContent = title;
  $("#explorer-result-count").textContent = "";
  $("#explorer-product-grid").innerHTML = `
    <div class="poizon-result-tabs"><button class="active">상품 검색</button><button type="button">조회 내역</button></div>
    <div class="poizon-filter-strip">
      <button type="button">브랜드⌄</button>
      <select id="brand-result-category"><option value="">카테고리⌄</option>${categories.map((category) => `<option value="${text(category)}">${text(category)}</option>`).join("")}</select>
      <select disabled><option>사이즈 유형⌄</option></select>
      <input id="brand-result-min-total" type="number" min="30" value="30" readonly title="중국 총 판매량 30건 이상 고정">
      <input id="brand-result-min-local-total" type="number" min="30" value="30" readonly title="현지 판매자 총 판매량 30건 이상 고정">
      <strong class="seller-filter-fixed">두 조건 모두 충족 (AND)</strong>
      <button id="brand-result-reset" type="button" class="poizon-reset">초기화</button>
    </div>
    <div class="poizon-result-summary">
      <strong>총 ${Number(sourceTotal).toLocaleString("ko-KR")}건 결과</strong>
      <span id="brand-collection-audit">판매자센터 AND ${Number(comparison.sellerCount || 0).toLocaleString("ko-KR")}개 · 프로그램 AND ${Number(comparison.programCount || 0).toLocaleString("ko-KR")}개 · 차이 ${Number(comparison.difference || 0).toLocaleString("ko-KR")}개</span>
      <select id="brand-result-sort"><option value="local-desc">현지 판매자 총 판매량 내림차순</option><option value="china-desc">중국 총 판매량 내림차순</option></select>
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
    const minimumTotal = Math.max(30, Number($("#brand-result-min-total").value) || 30);
    const minimumLocalTotal = Math.max(30, Number($("#brand-result-min-local-total").value) || 30);
    currentExplorerProducts = allProducts.filter((product) => {
      return (!category || (product.categoryName || product.category || "") === category)
        && totalSalesAndMatched(product, minimumTotal, minimumLocalTotal);
    });
    const sort = $("#brand-result-sort").value;
    currentExplorerProducts.sort((left, right) => sort === "china-desc"
      ? Number(right.totalSales || 0) - Number(left.totalSales || 0)
      : (Number(right.localTotalSales || 0) - Number(left.localTotalSales || 0))
        || (Number(right.totalSales || 0) - Number(left.totalSales || 0)));
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
  ["#brand-result-category", "#brand-result-sort"]
    .forEach((selector) => $(selector).addEventListener("input", renderRows));
  $("#brand-result-reset").addEventListener("click", () => {
    $("#brand-result-category").value = "";
    $("#brand-result-min-total").value = "30";
    $("#brand-result-min-local-total").value = "30";
    $("#brand-result-sort").value = "local-desc";
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
  allExplorerProducts = [];
  domesticStockOnly = false;
  domesticResults.clear();
  domesticIdentitySearchCache.clear();
  $("#explorer-results").hidden = true;
  $("#explorer-result-title").textContent = "탐색 결과";
  $("#explorer-result-count").textContent = "";
  $("#explorer-product-grid").innerHTML = "";
  $("#domestic-batch-status").className = "status";
  $("#domestic-batch-status").textContent = "";
  $("#domestic-search-all").textContent = "표시 목록 국내 재고 검색";
  updateDomesticStockFilter();
}

async function searchDomesticAt(index, sourceProducts = currentExplorerProducts) {
  const product = sourceProducts[index];
  if (!product) return;
  const key = domesticKey(product, index);
  domesticResults.set(key, { loading: true, products: [], sources: [] });
  const response = await cachedDomesticSearch(product, !domesticBatchRunning || domesticBatchVerifyCounts);
  if (response?.canceled || domesticBatchStopRequested) {
    domesticResults.delete(key);
    return { canceled: true };
  }
  const result = response.ok ? response.data : { products: [], sources: [], error: response.message };
  domesticResults.set(key, result);
  if (hasDomesticStock(result) && domesticBatchRunning && !domesticBatchVerifyCounts) {
    const batchId = domesticBatchId(sourceProducts);
    await window.aroundG.upsert("domesticSearches", { id: `${batchId}:${key}`, batchId, key, result, policyVersion: DOMESTIC_RESULT_POLICY_VERSION });
  }
  const visibleProducts = domesticStockOnly ? domesticStockProducts() : allExplorerProducts;
  renderExplorerResults($("#explorer-result-title").textContent, visibleProducts, true);
  return result;
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
  const downloadedBrandOpen = event.target.closest("[data-open-brand-download]");
  if (downloadedBrandOpen) {
    event.preventDefault();
    event.stopPropagation();
    const file = downloadedFileByEncodedPath(downloadedBrandOpen.dataset.openBrandDownload);
    if (file) await openIntegratedBrandExcel(file, false);
    return;
  }
  const officialInternalButton = event.target.closest("[data-official-homepage][data-official-query]");
  if (officialInternalButton) {
    await window.aroundG.openOfficialInternalSearch({
      homepageUrl: decodeURIComponent(officialInternalButton.dataset.officialHomepage),
      query: decodeURIComponent(officialInternalButton.dataset.officialQuery),
    });
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
    toggleBrandSelection(brandButton.dataset.brandId, brandButton);
    return;
  }
  const category = event.target.closest("[data-category]")?.dataset.category;
  if (category) {
    selectedCategory = category;
    selectedCategoryDetail = "";
    renderCategoryButtons();
    return;
  }
  const detail = event.target.closest("[data-category-detail]")?.dataset.categoryDetail;
  if (detail) {
    selectedCategoryDetail = detail;
    localStorage.setItem("around-g-last-category", JSON.stringify({ category: selectedCategory, detail }));
    renderCategoryButtons();
  }
  const categoryBrandButton = event.target.closest("[data-category-brand-id]");
  if (categoryBrandButton) {
    const brandId = Number(categoryBrandButton.dataset.categoryBrandId);
    if (categoryBrandIds.has(brandId)) categoryBrandIds.delete(brandId);
    else categoryBrandIds.add(brandId);
    renderCategoryFavoriteBrands();
  }
});

$("#brand-open-category")?.addEventListener("click", () => {
  window.activateSearchServiceMode?.("category");
  renderCategoryFavoriteBrands({ reset: true });
  renderCategoryButtons();
});
$("#category-back-brand")?.addEventListener("click", () => window.activateSearchServiceMode?.("brand"));
$("#category-brand-select-all")?.addEventListener("click", () => {
  categoryBrandIds = new Set(pinnedBrandIds.map(Number).filter(Number.isFinite));
  renderCategoryFavoriteBrands();
});
$("#category-brand-clear")?.addEventListener("click", () => {
  categoryBrandIds.clear();
  renderCategoryFavoriteBrands();
});

document.querySelectorAll(".explorer-mode").forEach((button) => button.addEventListener("click", () => {
  const currentMode = document.querySelector(".explorer-mode.active")?.dataset.explorer;
  if (currentMode !== button.dataset.explorer) clearExplorerResults();
  document.querySelectorAll(".explorer-mode,.explorer-panel").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  $(`#explorer-${button.dataset.explorer}`).classList.add("active");
}));

$("#brand-filter").addEventListener("input", (event) => renderBrandCards(event.target.value));
$("#completed-brand-toggle")?.addEventListener("click", () => {
  completedBrandShowAll = !completedBrandShowAll;
  renderBrandCards($("#brand-filter")?.value || "");
});
$("#brand-selection-clear")?.addEventListener("click", () => {
  if (brandSelectionBusy) return;
  selectedBrandIds.clear();
  selectedBrandId = null;
  saveBrandSelections();
  renderBrandCards($("#brand-filter")?.value || "");
});
$("#frequent-brand-export")?.addEventListener("click", () => {
  if (!brandSelectionBusy && selectedBrandIds.size === 0) {
    pinnedBrandIds.forEach((id) => {
      if (explorerMeta.brands.some((brand) => Number(brand.id) === Number(id))) {
        selectedBrandIds.add(Number(id));
      }
    });
    selectedBrandId = selectedBrandIds.size === 1 ? [...selectedBrandIds][0] : null;
    saveBrandSelections();
    renderBrandCards($("#brand-filter")?.value || "");
  }
  $("#brand-export-selected")?.click();
});
$("#completed-brand-domestic-search")?.addEventListener("click", async () => {
  const selectedDownloads = selectedBrandsForExport()
    .map((brand) => latestCompletedBrandDownload(brand))
    .filter(Boolean)
    .sort((left, right) => Number(right.time || right.mtimeMs || 0) - Number(left.time || left.mtimeMs || 0));
  const latestDownload = selectedDownloads[0] || [...downloadedBrandFiles]
    .filter((file) => file?.path)
    .sort((left, right) => Number(right.time || right.mtimeMs || 0) - Number(left.time || left.mtimeMs || 0))[0];
  const status = $("#brand-status");
  if (!latestDownload) {
    if (status) {
      status.className = "status error";
      status.textContent = "국내 상품검색에 사용할 다운로드 완료 Excel이 없습니다.";
    }
    return;
  }
  await openIntegratedBrandExcel(latestDownload, true);
});
$("#frequent-brand-category")?.addEventListener("click", () => {
  $("#brand-open-category")?.click();
});
$("#brand-export-selected")?.addEventListener("click", async () => {
  if (brandSelectionBusy || activeExportBrand || hasActiveBrandExportJobs()) {
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
  // Folder monitoring is no longer started merely because the app opened.
  // An explicit brand search is also an explicit request to watch its download.
  void Promise.resolve(window.aroundG.startBrandExportFolderPolling?.()).catch(() => {});
  const selectedLabel = selectedBrands.length === 1
    ? String(selectedBrands[0].name || selectedBrands[0].ko || "선택 브랜드")
    : `${selectedBrands.length}개 브랜드`;
  // Give immediate, visible feedback before asking the main process to reset
  // the POIZON session. Previously a delayed/rejected IPC call made the search
  // button appear completely unresponsive.
  brandSelectionBusy = true;
  updateBrandSelectionControls();
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `${selectedLabel} 검색 세션 준비 중…`;
  touchBrandActivity(`${selectedLabel} 검색 시작 요청`);
  // Existing Excel files remain in the received-file history, but every
  // explicit search click must create a fresh POIZON job number and download.
  // Reset only the live run state before building the new queue.
  acceptBrandWorkEvents = false;
  let freshSession;
  let sessionWaitNoticeTimer;
  try {
    sessionWaitNoticeTimer = setTimeout(() => {
      $("#brand-status").className = "status";
      $("#brand-status").textContent = `${selectedLabel} 검색 준비 응답 대기 중… 작업은 취소되지 않습니다.`;
      touchBrandActivity(`${selectedLabel} 검색 준비 응답 대기 중`);
    }, 30_000);
    freshSession = await window.aroundG.beginSellerBrandSearchSession?.();
  } catch (error) {
    freshSession = {
      ok: false,
      code: "BRAND_SESSION_START_FAILED",
      message: error instanceof Error ? error.message : String(error || "검색 세션 시작 실패"),
    };
  } finally {
    clearTimeout(sessionWaitNoticeTimer);
  }
  if (!freshSession || freshSession.ok === false) {
    brandSelectionBusy = false;
    acceptBrandWorkEvents = true;
    updateBrandSelectionControls();
    stopBrandActivity();
    $("#brand-status").className = "status error";
    $("#brand-status").textContent = `${selectedLabel} 검색 시작 실패 · ${freshSession?.message || "새 브랜드 검색 세션을 시작하지 못했습니다."}`;
    return;
  }
  brandWorkHistoryGeneration += 1;
  brandExportJobs.clear();
  brandMainAllComplete = false;
  detectedBrandImportQueue.length = 0;
  queuedBrandImportPaths.clear();
  acceptBrandWorkEvents = true;
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
    productUrl: String(brand.productUrl || "").trim(),
    officialHomepageUrl: String(brand.officialHomepageUrl || "").trim(),
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
  let refreshedMeta = null;
  try {
    refreshedMeta = await Promise.race([
      window.aroundG.explorerMeta(),
      new Promise((resolve) => setTimeout(() => resolve(null), 2_000)),
    ]);
  } catch {}
  if (!validExplorerMetadata(refreshedMeta)) {
    refreshedMeta = { ...explorerMeta, brands: result.brands, needsBrandSync: false };
  }
  explorerMeta = refreshedMeta;
  favoriteCatalogFallbackActive = false;
  // A successful full-catalog sync can replace every numeric brand ID. Resolve
  // favorites by their persisted names again before rendering the new catalog.
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

async function acceptSellerCenterProducts(products, sourceLabel, options = {}) {
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
  if (options.renderResults !== false) {
    renderExplorerResults("POIZON 판매자센터 인기상품", limited.map((product) => ({
      ...product,
      hasSalesData: Number(product.sales30d) > 0,
    })));
  }
  return storedProducts;
}

window.aroundG.onSellerCaptureProgress((progress) => {
  const host = $("#popular-progress");
  const reportedPercent = Number(progress.percent);
  const percent = Number.isFinite(reportedPercent)
    ? Math.max(0, Math.min(100, reportedPercent))
    : Number.parseFloat(host.querySelector("i").style.width) || 0;
  host.hidden = false;
  host.querySelector("i").style.width = `${percent}%`;
  host.querySelector("span").textContent = `${percent}%`;
  if (progress.message) $("#popular-status").textContent = progress.message;
  if (categorySearchActive) {
    updateCategoryLoading({
      title: progress.message || `인기리스트에서 인기 브랜드를 확인하는 중 · ${Number(progress.completed || 0)}/200`,
      percent: Math.min(32, percent * 0.32),
    });
    if (progress.attentionRequired) {
      $("#category-status").className = "status error";
      $("#category-status").textContent = progress.message;
    }
  }
});
async function capturePopularProducts(options = {}) {
  const button = $("#popular-capture");
  button.disabled = true;
  $("#popular-progress").hidden = false;
  $("#popular-progress").querySelector("i").style.width = "0%";
  $("#popular-progress").querySelector("span").textContent = "0%";
  $("#popular-status").className = "status";
  $("#popular-status").textContent = "";
  try {
    const result = await window.aroundG.captureSellerCenter();
    if (!result.ok) {
      $("#popular-status").className = "status error";
      $("#popular-status").textContent = result.message;
      return { ok: false, message: result.message };
    }
    const excelResult = await window.aroundG.stagePopularProductsInExcel(result.products);
    if (!excelResult.ok) {
      $("#popular-status").className = "status error";
      $("#popular-status").textContent = `Excel 저장 또는 다시 불러오기 실패: ${excelResult.message}`;
      return { ok: false, message: `Excel 저장 또는 다시 불러오기 실패: ${excelResult.message}` };
    }
    const verifiedProducts = excelResult.products;
    const missingRanks = Array.isArray(excelResult.missing) ? excelResult.missing : [];
    const missingLabel = missingRanks.length
      ? ` · 누락 ${missingRanks.length}개 (${missingRanks.join(", ")})`
      : " · 누락 0개";
    const sourceLabel = `바탕화면 Excel 재검증 완료 ${excelResult.imported}/200${missingLabel} · ${excelResult.path}`;
    const storedProducts = await acceptSellerCenterProducts(verifiedProducts, sourceLabel, {
      renderResults: false,
    });
    const completedProducts = verifiedProducts.filter((product) => !product.missingRank);
    const popularFile = {
      path: excelResult.path,
      name: String(excelResult.path || "").split(/[\\/]/).pop() || "POIZON-인기상품-원본.xlsx",
      brandName: "POIZON 인기리스트",
      jobId: `인기상품 ${excelResult.imported}/200`,
    };
    await openIntegratedPopularExcel(popularFile);
    $("#popular-status").textContent = completedProducts.length
      ? `${sourceLabel} · 행별 상품검색 또는 선택 상품검색을 실행할 수 있습니다.`
      : `${sourceLabel} · 검색 가능한 상품이 없습니다.`;
    return { ok: true, products: storedProducts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "인기리스트 수집 실패");
    $("#popular-status").className = "status error";
    $("#popular-status").textContent = message;
    return { ok: false, message };
  } finally {
    button.disabled = false;
  }
}
$("#popular-capture").addEventListener("click", async () => {
  await capturePopularProducts();
});
async function runDomesticBatch(options = {}) {
  const selectedOnly = Boolean(options?.selectedOnly);
  const button = $("#domestic-search-all");
  if (domesticBatchRunning) {
    domesticBatchStopRequested = true;
    domesticIdentitySearchCache.clear();
    void window.aroundG.cancelDomesticSearch?.();
    button.disabled = true;
    button.textContent = "검색 중지 중…";
    updateExplorerSelectionUi();
    $("#domestic-batch-status").textContent = "진행 중인 판매처 검색을 즉시 중지하고 있습니다…";
    return;
  }
  domesticBatchRunning = true;
  domesticBatchStopRequested = false;
  domesticBatchVerifyCounts = selectedOnly;
  button.textContent = "검색 중지";
  updateExplorerSelectionUi();
  const batchProducts = [...(allExplorerProducts.length ? allExplorerProducts : currentExplorerProducts)];
  const searchableIndexes = batchProducts
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
  const batchId = domesticBatchId(batchProducts);
  const savedProgress = selectedOnly ? null : readDomesticBatchProgress(batchId);
  if (!selectedOnly && savedProgress) {
    await restoreDomesticStockResults(batchId);
  } else {
    // Completed/ordinary searches must never reuse yesterday's inventory.
    // Keep restoration only for an explicitly interrupted batch resume.
    domesticResults.clear();
    domesticIdentitySearchCache.clear();
    await clearSavedDomesticStockResults(batchId);
  }
  const resumeAt = Math.max(0, Number(savedProgress?.nextIndex || 0));
  const pendingIndexes = selectedOnly ? searchableIndexes : searchableIndexes.filter((index) => index >= resumeAt);
  let processed = 0;
  for (const index of pendingIndexes) {
    if (domesticBatchStopRequested) break;
    $("#domestic-batch-status").className = "status";
    $("#domestic-batch-status").textContent = selectedOnly
      ? `국내 재고 및 네이버 결과 확인 ${processed + 1}/${pendingIndexes.length}`
      : `국내 재고 검색 ${index + 1}/${searchableIndexes.length} · 발견 결과를 즉시 표시하고 있습니다.`;
    await searchDomesticAt(index, batchProducts);
    processed += 1;
    if (!selectedOnly) saveDomesticBatchProgress({ batchId, nextIndex: index + 1, total: searchableIndexes.length, complete: false });
  }
  const stopped = domesticBatchStopRequested;
  domesticBatchRunning = false;
  domesticBatchVerifyCounts = false;
  domesticBatchStopRequested = false;
  button.disabled = false;
  button.textContent = "표시 목록 국내 재고 검색";
  updateExplorerSelectionUi();
  const missingCount = batchProducts.length - searchableIndexes.length;
  if (stopped) {
    const nextIndex = selectedOnly ? processed : Number(readDomesticBatchProgress(batchId)?.nextIndex || 0);
    $("#domestic-batch-status").className = "status error";
    $("#domestic-batch-status").textContent = `국내 재고 검색 중지 ${nextIndex}/${searchableIndexes.length} · 다시 누르면 이어서 검색합니다.`;
    return;
  }
  if (!selectedOnly) localStorage.removeItem(DOMESTIC_BATCH_PROGRESS_KEY);
  $("#domestic-batch-status").className = "status success";
  $("#domestic-batch-status").textContent = `국내 재고 검색 완료 ${searchableIndexes.length}/${searchableIndexes.length} · 원본 누락 슬롯 ${missingCount}개 유지`;
}
$("#domestic-search-all").addEventListener("click", () => runDomesticBatch());
$("#domestic-stock-filter").addEventListener("click", () => {
  domesticStockOnly = !domesticStockOnly;
  const products = domesticStockOnly ? domesticStockProducts() : allExplorerProducts;
  renderExplorerResults($("#explorer-result-title").textContent, products, true);
});
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
  const workbookBrand = String(file?.brandName || file?.detectedBrandName || "").trim();
  const resolvedBrandName = workbookBrand || registeredBrand;
  if (!resolvedBrandName) return;
  const corrected = Boolean(registeredBrand && workbookBrand
    && !rendererBrandsMatch(registeredBrand, workbookBrand));
  const normalizedFile = {
    ...file,
    jobId: resolvedJobId,
    brandName: resolvedBrandName,
    registeredBrandName: corrected ? registeredBrand : "",
    brandNameCorrected: corrected,
  };
  updateBrandExportJob(
    normalizedFile.jobId,
    corrected ? "Excel 실제 브랜드로 자동 교정 · 프로그램 등록 중" : "Excel 다운로드 완료 · 프로그램 등록 중",
    normalizedFile.brandName,
    { replaceBrand: true },
  );
  updateBrandBatchState(
    normalizedFile.brandName,
    corrected ? "Excel 실제 브랜드로 자동 교정 · 등록 중" : "Excel 다운로드 완료 · 등록 중",
    normalizedFile.jobId,
  );
  queuedBrandImportPaths.add(pathKey);
  detectedBrandImportQueue.push(normalizedFile);
  $("#brand-status").className = corrected ? "status success" : "status";
  $("#brand-status").textContent = corrected
    ? `${registeredBrand} → ${normalizedFile.brandName} · Excel 실제 브랜드로 생성 목록을 자동 교정했습니다.`
    : `${normalizedFile.brandName} · Excel 다운로드 완료 · 프로그램에 등록합니다.`;
  void drainDetectedBrandImports();
});
$("#brand-download-files").addEventListener("click", async (event) => {
  const selector = event.target.closest("[data-select-brand-file-index]");
  if (selector) {
    event.stopPropagation();
    const file = downloadedBrandFiles[Number(selector.dataset.selectBrandFileIndex)];
    const pathKey = brandImportPathKey(file?.path);
    if (pathKey) selector.checked ? selectedDownloadedFilePaths.add(pathKey) : selectedDownloadedFilePaths.delete(pathKey);
    renderDownloadedBrandFiles();
    return;
  }
  const target = event.target.closest("[data-open-brand-file-index]");
  if (!target) return;
  const file = downloadedBrandFiles[Number(target.dataset.openBrandFileIndex)];
  if (!file?.path) return;
  await showExcelPreview(file, 0);
});
$("#brand-download-select-all")?.addEventListener("change", (event) => {
  selectedDownloadedFilePaths.clear();
  if (event.target.checked) downloadedBrandFiles.forEach((file) => selectedDownloadedFilePaths.add(brandImportPathKey(file.path)));
  renderDownloadedBrandFiles();
});
$("#brand-download-delete")?.addEventListener("click", async () => {
  const selected = downloadedBrandFiles.filter((file) => selectedDownloadedFilePaths.has(brandImportPathKey(file.path)));
  if (!selected.length || !window.confirm(`선택한 Excel 파일 ${selected.length}개를 휴지통으로 이동할까요?`)) return;
  const button = $("#brand-download-delete");
  button.disabled = true;
  button.textContent = "삭제 중…";
  const result = await window.aroundG.trashBrandExportFiles(selected.map((file) => file.path));
  selectedDownloadedFilePaths.clear();
  await restoreDownloadedBrandFiles();
  const status = $("#excel-files-status");
  if (status) {
    status.className = result?.ok ? "status success" : "status error";
    status.textContent = result?.ok
      ? `${Number(result.deleted || 0)}개 파일을 휴지통으로 이동했습니다.`
      : result?.message || "선택한 파일을 삭제하지 못했습니다.";
  }
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
  const wasIntegrated = excelPreviewIntegrated;
  excelPreviewRequestId += 1;
  activeExcelPreview = null;
  excelPreviewProductMode = false;
  excelPreviewBatchSearching = false;
  excelPreviewIntegrated = false;
  excelPreviewIntegratedHostId = "brand-integrated-preview-host";
  excelPreviewIntegratedWorkspaceId = "brand-product-workspace";
  $("#excel-preview").hidden = true;
  $("#brand-product-workspace").hidden = true;
  $("#popular-product-workspace").hidden = true;
  if (excelPreviewFilesParent && $("#excel-preview")?.parentElement !== excelPreviewFilesParent) excelPreviewFilesParent.append($("#excel-preview"));
  $("#explorer-files")?.classList.remove("excel-preview-mode");
  $("#products")?.classList.remove("excel-data-view-open");
  document.body.classList.remove("excel-preview-active");
  document.querySelectorAll(".brand-download-row.is-open,.brand-download-history-row.is-open").forEach((row) => row.classList.remove("is-open"));
  if (!wasIntegrated) requestAnimationFrame(() => window.scrollTo({ top: excelFilesListScrollPosition, left: 0, behavior: "auto" }));
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
      await searchExcelPreviewProduct(key, { forceRefresh: false });
    }
  }
  const shipping = Number($("#shipping").value || 0);
  const extra = Number($("#extra").value || 0);
  const comparisons = keys.map((key) => {
    const product = excelPreviewProductCache.get(key);
    const result = excelPreviewSearchResults.get(key);
    const domestic = (result?.products || [])
      .filter((candidate) => Number(candidate?.price || 0) > 0)
      .sort((left, right) => Number(right?.inStock) - Number(left?.inStock) || Number(left.price) - Number(right.price))[0];
    const domesticSource = (result?.sources || []).find((source) => source?.store === domestic?.store);
    const purchaseUrl = String(domestic?.url || domesticSource?.officialProductUrl || domesticSource?.searchUrl || "");
    const poizonPrice = verifiedExcelProductPoizonPrice(product);
    const domesticPrice = Number(domestic?.price || 0);
    const poizonFee = poizonServiceFee(poizonPrice, product?.categoryName);
    const poizonSettlement = poizonPrice - poizonFee;
    const totalCost = domesticPrice + shipping + extra;
    const netProfit = poizonPrice > 0 && domesticPrice > 0 ? poizonSettlement - totalCost : 0;
    const marginRate = totalCost > 0 ? netProfit / totalCost * 100 : 0;
    return { product, domestic, purchaseUrl, poizonPrice, domesticPrice, poizonFee, poizonSettlement, totalCost, netProfit, marginRate };
  });
  const comparable = comparisons.filter((item) => item.poizonPrice > 0 && item.domesticPrice > 0);
  const totals = comparable.reduce((sum, item) => ({
    poizonPrice: sum.poizonPrice + item.poizonPrice,
    domesticPrice: sum.domesticPrice + item.domesticPrice,
    totalCost: sum.totalCost + item.totalCost,
    netProfit: sum.netProfit + item.netProfit,
  }), { poizonPrice: 0, domesticPrice: 0, totalCost: 0, netProfit: 0 });
  $("#cost").value = String(Math.round(totals.domesticPrice));
  $("#sale-price").textContent = money(totals.poizonPrice);
  $("#sale-price-label").textContent = "POIZON 판매가 합계";
  $("#total-cost").textContent = money(totals.totalCost);
  $("#net-profit").textContent = money(totals.netProfit);
  const summary = $("#profit-selection-summary");
  summary.hidden = false;
  summary.textContent = `선택 ${keys.length.toLocaleString("ko-KR")}개 · 국내 매입가 확인 ${comparable.length.toLocaleString("ko-KR")}개 · POIZON 카테고리별 수수료 자동 적용`;
  $("#profit-comparison").hidden = false;
  $("#profit-comparison-count").textContent = `${comparable.length.toLocaleString("ko-KR")}개 비교`;
  $("#profit-comparison-rows").innerHTML = comparisons.map((item) => `<tr>
    <td><b>${text(item.product?.articleNumber || "-")}</b><small>${text(item.product?.title || "")}</small></td>
    <td>${item.poizonPrice ? money(item.poizonPrice) : "가격 없음"}</td>
    <td>${item.domesticPrice ? money(item.domesticPrice) : "검색 결과 없음"}</td>
    <td>${item.purchaseUrl
      ? `<button type="button" class="profit-store-link" data-url="${encodeURIComponent(item.purchaseUrl)}" title="구매 페이지 열기">${text(item.domestic?.store || "구매처 열기")} ↗</button>`
      : "-"}</td>
    <td>${item.poizonPrice ? money(item.totalCost) : "-"}</td>
    <td class="${item.netProfit >= 0 ? "profit-positive" : "profit-negative"}">${item.poizonPrice && item.domesticPrice ? money(item.netProfit) : "계산 불가"}</td>
    <td class="${item.marginRate >= 0 ? "profit-positive" : "profit-negative"}">${item.poizonPrice && item.domesticPrice ? `${item.marginRate.toFixed(1)}%` : "계산 불가"}</td>
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
    domesticIdentitySearchCache.clear();
    await window.aroundG.cancelDomesticSearch?.();
    $("#excel-filter-status").textContent = "상품 검색을 중지했습니다.";
    updateExcelPreviewSelectionUi([]);
    return;
  }
  const button = $("#excel-preview-search-selected");
  // Keep the original Excel row list visible while searching. Each result is
  // written into that row's rightmost result/link cell; never switch to the
  // separate grouped-product/detail-list renderer here.
  const keys = [...selectedExcelPreviewProducts].filter((key) => excelPreviewProductCache.has(key));
  if (!keys.length) {
    button.disabled = false;
    button.textContent = "상품검색";
    $("#excel-filter-status").textContent = "선택한 행에서 검색 가능한 상품번호를 찾지 못했습니다.";
    return;
  }
  // A new button press always starts a new search session. Do not leave any
  // visible or in-memory result from the previous session on another row.
  excelPreviewSearchResults.clear();
  domesticIdentitySearchCache.clear();
  if (activeExcelPreview?.file?.path) persistExcelSearchResults(activeExcelPreview.file.path);
  excelPreviewBatchSearching = true;
  updateExcelPreviewSelectionUi([]);
  $("#excel-filter-status").textContent = `선택 상품 ${keys.length.toLocaleString("ko-KR")}개를 검색하고 있습니다.`;
  for (const key of keys) {
    if (!excelPreviewBatchSearching) break;
    await searchExcelPreviewProduct(key, { forceRefresh: false });
  }
  const stopped = !excelPreviewBatchSearching;
  excelPreviewBatchSearching = false;
  $("#excel-filter-status").textContent = stopped
    ? "상품 검색을 중지했습니다."
    : `선택 상품 ${keys.length.toLocaleString("ko-KR")}개 검색을 완료했습니다.`;
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
    const sellerCount = sellerResult.products.filter((product) => totalSalesAndMatched(product, 30, 30)).length;
    const programCount = products.filter((product) => totalSalesAndMatched(product, 30, 30)).length;
    renderBrandSellerResults(`${brand?.name || ""} 브랜드 검색`, products, sourceTotal, {
      sellerCount,
      programCount,
      difference: Math.abs(sellerCount - programCount),
    });
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

const CATEGORY_SEARCH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function categorySearchDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

function categorySearchCacheId(category, detail, minimumSales30, brandIds = pinnedBrandIds) {
  const brandKey = [...brandIds].map(Number).filter(Number.isFinite).sort((a, b) => a - b).join("-") || "none";
  return `category:${categorySearchDate()}:${category}:${detail || "all"}:${minimumSales30 ? "sales30" : "all"}:favorites:${brandKey}`;
}

const CATEGORY_DETAIL_PATTERNS = {
  "축구화": [/(?:축구|풋살|football|soccer|cleat)/i, /(?:^|\s)(?:fg|ag|mg|sg|tf)(?:\s|$)/i, /(?:mercurial|phantom|predator|copa|tiempo|future ultimate)/i],
  "농구화": [/(?:농구|basketball|hoops)/i, /(?:jordan|lebron|kyrie|curry|harden|don issue|ja \d)/i],
  "러닝화": [/(?:러닝|런닝|달리기|running|runner|marathon|트레일 러닝)/i],
  "운동화": [/(?:운동화|스니커|sneaker|trainer|트레이닝 슈즈)/i],
  "샌들·슬리퍼": [/(?:샌들|슬리퍼|슬라이드|sandal|slipper|slide)/i],
  "구두·부츠": [/(?:구두|로퍼|옥스퍼드|부츠|loafer|oxford|boots?)/i],
};

function categoryDetailText(product = {}) {
  return [product.categoryName, product.category, product.categoryGroup, product.name, product.productName, product.title]
    .filter(Boolean).join(" ").replace(/[_/|-]+/g, " ");
}

function filterCategoryDetailProducts(products = [], detail = selectedCategoryDetail) {
  if (!detail || detail === "전체 상품") return [...products];
  const patterns = CATEGORY_DETAIL_PATTERNS[detail];
  if (!patterns?.length) return [...products];
  return products.filter((product) => patterns.some((pattern) => pattern.test(categoryDetailText(product))));
}

async function pruneCategorySearchHistory() {
  const searches = Array.isArray(state.categorySearches) ? state.categorySearches : [];
  const expired = searches.filter((entry) => Date.now() - Date.parse(String(entry.createdAt || entry.updatedAt || "")) > CATEGORY_SEARCH_RETENTION_MS);
  for (const entry of expired) await window.aroundG.remove("categorySearches", entry.id);
  if (expired.length) state.categorySearches = searches.filter((entry) => !expired.some((old) => old.id === entry.id));
}

function updateCategoryLoading({ title, completed, total, count, percent } = {}) {
  const host = $("#category-loading");
  if (!host) return;
  host.hidden = false;
  if (title) $("#category-loading-title").textContent = title;
  const done = Number(completed || 0);
  const maximum = Number(total || 0);
  const products = Number(count || 0);
  if (maximum || products) {
    $("#category-loading-count").textContent = `브랜드 ${done}/${maximum} · 상품 ${products.toLocaleString("ko-KR")}개 분류`;
  }
  if (Number.isFinite(Number(percent))) $("#category-loading-bar").style.width = `${Math.max(0, Math.min(100, Number(percent)))}%`;
}

function startCategoryLoading() {
  categorySearchActive = true;
  categoryLoadingStartedAt = Date.now();
  clearInterval(categoryLoadingTimer);
  $("#category-loading").hidden = false;
  categoryCompletedBrands = [];
  $("#category-loading-bar").style.width = "1%";
  $("#category-loading-count").textContent = "브랜드 0/0 · 상품 0개 분류";
  categoryLoadingTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - categoryLoadingStartedAt) / 1000);
    $("#category-loading-time").textContent = `경과 ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, 1_000);
}

function finishCategoryLoading({ keepVisible = false } = {}) {
  categorySearchActive = false;
  clearInterval(categoryLoadingTimer);
  categoryLoadingTimer = null;
  if (!keepVisible) $("#category-loading").hidden = true;
}

$("#category-search-stop").addEventListener("click", async () => {
  categorySearchRunId += 1;
  categorySearchActive = false;
  $("#category-search-stop").disabled = true;
  $("#category-loading-title").textContent = "현재 요청을 안전하게 중단하는 중…";
  await window.aroundG.cancelCategorySearch();
  finishCategoryLoading({ keepVisible: true });
  $("#category-status").className = "status error";
  $("#category-status").textContent = "카테고리 검색을 중단했습니다. 저장된 완료 결과는 그대로 유지됩니다.";
  $("#category-search").disabled = false;
  $("#category-search-stop").disabled = false;
});

$("#category-search").addEventListener("click", async () => {
  const runId = ++categorySearchRunId;
  const button = $("#category-search");
  const status = $("#category-status");
  const minimumSales30 = $("#category-min-sales").checked;
  const favoriteBrandIds = [...categoryBrandIds].map(Number).filter(Number.isFinite);
  if (!selectedCategoryDetail) return;
  if (!favoriteBrandIds.length) {
    status.className = "status error";
    status.textContent = "카테고리 검색에 사용할 다운로드 완료 브랜드가 없습니다.";
    return;
  }
  button.disabled = true;
  $("#category-search-stop").disabled = false;
  startCategoryLoading();
  status.className = "status";
  status.textContent = "1단계/3 · 저장된 검색 결과를 확인하는 중…";
  try {
    await refresh();
    await pruneCategorySearchHistory();
    const cacheId = categorySearchCacheId(selectedCategory, selectedCategoryDetail, minimumSales30, favoriteBrandIds);
    const cached = (state.categorySearches || []).find((entry) => entry.id === cacheId && Array.isArray(entry.products));
    if (cached?.complete) {
      updateCategoryLoading({ title: "저장된 카테고리 검색 결과를 불러왔습니다.", completed: cached.sourceCount, total: cached.rankedBrandCount, count: cached.products.length, percent: 100 });
      status.className = "status success";
      status.textContent = `${selectedCategory} 〉 ${selectedCategoryDetail} 저장 결과 ${cached.products.length.toLocaleString("ko-KR")}개 · ${new Date(cached.createdAt).toLocaleString("ko-KR")} 검색`;
      renderExplorerResults(`${selectedCategory} 〉 ${selectedCategoryDetail} 검색 · 저장 결과`, cached.products);
      window.setTimeout(() => finishCategoryLoading(), 1_800);
      return;
    }
    const detailProductsByKey = new Map((cached?.products || []).map((product) => {
      const key = `${product.articleNumber || ""}:${product.globalSpuId || product.spuId || product.id || product.name || ""}`;
      return [key, product];
    }));
    const completedBrandIds = new Set((cached?.completedBrandIds || []).map(Number));
    let sourceCount = Number(cached?.sourceCount || 0);
    let failedSourceCount = Number(cached?.failedSourceCount || 0);
    let sourceTotal = Number(cached?.sourceTotal || 0);
    let completedCount = completedBrandIds.size;
    let nextBrandIndex = 0;
    let partialSave = Promise.resolve();
    const savePartialResult = () => {
      const snapshot = {
        id: cacheId,
        category: selectedCategory,
        categoryDetail: selectedCategoryDetail,
        brandIds: favoriteBrandIds,
        completedBrandIds: [...completedBrandIds],
        minimumSales30,
        createdAt: cached?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        products: [...detailProductsByKey.values()],
        sourceCount,
        failedSourceCount,
        rankedBrandCount: favoriteBrandIds.length,
        sourceTotal,
        complete: false,
      };
      partialSave = partialSave.then(() => window.aroundG.upsert("categorySearches", snapshot));
      return partialSave;
    };
    const searchNextBrand = async () => {
      const brandIndex = nextBrandIndex;
      nextBrandIndex += 1;
      if (brandIndex >= favoriteBrandIds.length || runId !== categorySearchRunId) return;
      const brandId = favoriteBrandIds[brandIndex];
      if (completedBrandIds.has(brandId)) return searchNextBrand();
      const brand = explorerMeta.brands.find((item) => Number(item.id) === brandId);
      const brandName = brand?.ko || brand?.name || `브랜드 ${brandId}`;
      status.textContent = `${completedCount}/${favoriteBrandIds.length} · ${brandName} ${selectedCategoryDetail} 검색 중… · 최대 2개 동시 처리`;
      updateCategoryLoading({
        title: `${brandName} 검색 중 · 완료된 결과만 안전하게 누적합니다.`,
        completed: completedCount,
        total: favoriteBrandIds.length,
        count: detailProductsByKey.size,
        percent: Math.round((completedCount / favoriteBrandIds.length) * 100),
      });
      try {
        const brandResult = await window.aroundG.queryExplorer({
          mode: "category",
          brandIds: [brandId],
          category: selectedCategory,
          categoryDetail: selectedCategoryDetail,
          pageNum: 1,
          pageSize: 100,
          minimumSales30,
          salesByArticle: salesByArticle(),
        });
        if (runId !== categorySearchRunId) return;
        if (!brandResult.ok) {
          failedSourceCount += 1;
        } else {
          sourceCount += 1;
          sourceTotal += Number(brandResult.sourceTotal || 0);
          for (const product of filterCategoryDetailProducts(brandResult.products, selectedCategoryDetail)) {
            const key = `${product.articleNumber || ""}:${product.globalSpuId || product.spuId || product.id || product.name || ""}`;
            if (!detailProductsByKey.has(key)) detailProductsByKey.set(key, product);
          }
        }
      } catch (_error) {
        failedSourceCount += 1;
      }
      if (runId !== categorySearchRunId) return;
      completedBrandIds.add(brandId);
      completedCount = completedBrandIds.size;
      await savePartialResult();
      if (runId !== categorySearchRunId) return;
      renderExplorerResults(`${selectedCategory} 〉 ${selectedCategoryDetail} 검색 · 진행 중`, [...detailProductsByKey.values()]);
      updateCategoryLoading({
        title: `${brandName} 검색 완료 · 다음 브랜드를 준비합니다.`,
        completed: completedCount,
        total: favoriteBrandIds.length,
        count: detailProductsByKey.size,
        percent: Math.round((completedCount / favoriteBrandIds.length) * 100),
      });
      return searchNextBrand();
    };
    await Promise.all([searchNextBrand(), searchNextBrand()]);
    await partialSave;
    if (runId !== categorySearchRunId) return;
    if (!sourceCount) {
      status.className = "status error";
      status.textContent = `다운로드 완료 브랜드 ${favoriteBrandIds.length}개의 검색에 모두 실패했습니다. 잠시 후 다시 시도해 주세요.`;
      finishCategoryLoading();
      return;
    }
    const detailProducts = [...detailProductsByKey.values()];
    status.className = "status success";
    status.textContent = `${selectedCategory} 〉 ${selectedCategoryDetail} 상품 ${detailProducts.length.toLocaleString("ko-KR")}개 확인 · 다운로드 완료 브랜드 ${sourceCount}/${favoriteBrandIds.length}개 완료${failedSourceCount ? ` · ${failedSourceCount}개 검색 실패` : ""}`;
    renderExplorerResults(`${selectedCategory} 〉 ${selectedCategoryDetail} 검색`, detailProducts);
    await window.aroundG.upsert("categorySearches", {
      id: cacheId,
      category: selectedCategory,
      categoryDetail: selectedCategoryDetail,
      brandIds: favoriteBrandIds,
      completedBrandIds: favoriteBrandIds,
      minimumSales30,
      createdAt: new Date().toISOString(),
      products: detailProducts,
      sourceCount,
      failedSourceCount,
      rankedBrandCount: favoriteBrandIds.length,
      sourceTotal,
      complete: true,
    });
    updateCategoryLoading({ title: `${selectedCategoryDetail} 브랜드별 검색을 완료했습니다.`, completed: sourceCount, total: favoriteBrandIds.length, count: detailProducts.length, percent: 100 });
    window.setTimeout(() => finishCategoryLoading(), 1_800);
  } catch (error) {
    if (runId !== categorySearchRunId) return;
    status.className = "status error";
    status.textContent = `카테고리 검색 오류 · ${error instanceof Error ? error.message : String(error)}`;
    finishCategoryLoading();
  } finally {
    if (runId === categorySearchRunId) button.disabled = false;
  }
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

async function renderDomesticLoginStatuses() {
  const list = $("#domestic-login-list");
  if (!list || !window.aroundG.listDomesticLogins) return;
  list.innerHTML = '<div class="domestic-login-empty">로그인 상태 확인 중…</div>';
  const sources = await window.aroundG.listDomesticLogins().catch(() => []);
  list.innerHTML = sources.map((source) => `
    <div class="domestic-login-row" data-source-id="${text(source.id)}">
      <div><strong>${text(source.name)}</strong><span class="domestic-login-state ${source.hasSession ? "saved" : "required"}">${source.hasSession ? "세션 저장됨" : "로그인 필요"}</span></div>
      <div class="domestic-login-actions"><button type="button" data-domestic-login>${source.hasSession ? "다시 로그인" : "로그인"}</button>${source.hasSession ? '<button type="button" data-domestic-clear>연동 해제</button>' : ""}</div>
    </div>`).join("") || '<div class="domestic-login-empty">표시할 소싱몰이 없습니다.</div>';
}

$("#domestic-login-refresh")?.addEventListener("click", renderDomesticLoginStatuses);
$("#domestic-login-list")?.addEventListener("click", async (event) => {
  const row = event.target.closest("[data-source-id]");
  if (!row) return;
  if (event.target.closest("[data-domestic-login]")) await window.aroundG.openDomesticLogin(row.dataset.sourceId);
  if (event.target.closest("[data-domestic-clear]")) await window.aroundG.clearDomesticLogin(row.dataset.sourceId);
  await renderDomesticLoginStatuses();
});
window.aroundG.onDomesticLoginChanged?.(() => renderDomesticLoginStatuses());

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const saved = await window.aroundG.saveConfig({ appKey:$("#app-key").value, appSecret:$("#app-secret").value, accessToken:$("#access-token").value, apiBaseUrl:$("#api-base-url").value, poizonLoginId:$("#poizon-login-id").value, poizonPassword:$("#poizon-password").value, nikeLoginId:$("#nike-login-id").value, nikePassword:$("#nike-password").value, adidasLoginId:$("#adidas-login-id").value, adidasPassword:$("#adidas-password").value });
  $("#app-secret").value = "";
  $("#access-token").value = "";
  $("#poizon-password").value = "";
  $("#nike-password").value = "";
  $("#adidas-password").value = "";
  $("#poizon-login-id").value = saved.poizonLoginId || "";
  $("#poizon-password").placeholder = saved.hasPoizonPassword ? "암호화 저장됨 · 브랜드 검색 시 자동 입력" : "자동 로그인에 필요";
  $("#nike-login-id").value = saved.nikeLoginId || "";
  $("#nike-password").placeholder = saved.hasNikePassword ? "Windows 암호화 저장됨" : "공식몰 검색에 필요";
  $("#adidas-login-id").value = saved.adidasLoginId || "";
  $("#adidas-password").placeholder = saved.hasAdidasPassword ? "Windows 암호화 저장됨" : "공식몰 검색에 필요";
  $("#settings-status").className = "status success";
  $("#settings-status").textContent = saved.poizonLoginId && saved.hasPoizonPassword
    ? "POIZON 아이디와 비밀번호를 기억했습니다. 브랜드 검색 시 자동 로그인합니다."
    : "Windows 암호화 저장소에 설정했습니다.";
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

function renderBackupStatus(payload = {}) {
  const panel = $("#backup-state");
  if (!panel) return;
  panel.classList.remove("connected", "syncing", "warning", "disconnected");
  panel.classList.add(payload.state || "warning");
  $("#backup-state-title").textContent = payload.state === "connected"
    ? "OneDrive 백업 정상"
    : payload.state === "syncing" ? "OneDrive 백업 중"
      : payload.state === "disconnected" ? "OneDrive 로그인 필요" : "OneDrive 확인 필요";
  $("#backup-state-message").textContent = payload.message || "백업 상태를 확인합니다";
  const lamps = $("#onedrive-lamps");
  if (lamps) {
    lamps.classList.remove("checking", "connected", "syncing", "warning", "disconnected");
    lamps.classList.add(payload.state || "warning");
    const lampLabel = payload.state === "connected"
      ? "OneDrive 정상 연결"
      : payload.state === "syncing" ? "OneDrive 백업 진행 중"
        : payload.state === "disconnected" ? "OneDrive 연결 끊김" : "OneDrive 연결 확인 필요";
    lamps.setAttribute("aria-label", lampLabel);
    lamps.title = lampLabel;
  }
}
window.aroundG.onBackupStatus(renderBackupStatus);
$("#backup-state")?.addEventListener("click", async () => renderBackupStatus(await window.aroundG.runBackup()));

$("#weekly-site-health-run")?.addEventListener("click", async () => {
  renderWeeklySiteHealth({ running: true, message: "모든 연동 서버 정기점검을 시작합니다." });
  const result = await window.aroundG.runWeeklySiteHealth();
  renderWeeklySiteHealth(result || {});
});
window.aroundG.onWeeklySiteHealthStatus(renderWeeklySiteHealth);

(async () => {
  // Build the primary workspace immediately. Download-completed brands appear
  // after the real catalog and the existing workbook folder have been read.
  setupBrandLayout();

  try {
    const appInfo = await window.aroundG.getAppInfo();
    renderInstalledVersion(appInfo?.version, appInfo?.automaticUpdates !== false);
  } catch {
    renderInstalledVersion("2.10.17", true);
  }
  // These status panels are secondary. A stalled status IPC must not block
  // the brand picker, work recovery, or any other sourcing function.
  void window.aroundG.getBackupStatus()
    .then(renderBackupStatus)
    .catch(() => renderBackupStatus({ state: "warning", message: "백업 상태를 나중에 다시 확인합니다." }));
  void window.aroundG.getWeeklySiteHealth()
    .then(renderWeeklySiteHealth)
    .catch(() => renderWeeklySiteHealth({ running: false, message: "정기점검 상태를 나중에 다시 확인합니다." }));
  // Never trust the renderer's old job label. The main process verifies saved
  // files and live POIZON rows before it restores any interrupted work.
  localStorage.removeItem("around-g-last-brand-export-job");
  const exportFolder = await window.aroundG.getBrandExportFolder();
  renderBrandExportFolder(exportFolder.folder);
  // Do not block the primary screen on a slow metadata IPC response. Apply the
  // real catalog when it arrives, then reconnect favorites by persisted names.
  const explorerMetaRequest = window.aroundG.explorerMeta();
  let initialExplorerMeta = null;
  try {
    initialExplorerMeta = await Promise.race([
      explorerMetaRequest,
      new Promise((resolve) => setTimeout(() => resolve(null), 2_000)),
    ]);
  } catch {}
  if (!applyLoadedExplorerMetadata(initialExplorerMeta)) {
    void explorerMetaRequest.then(async (metadata) => {
      if (!applyLoadedExplorerMetadata(metadata)) return;
      if (metadata.needsBrandSync) await syncFullBrandCatalog({ automatic: true });
    }).catch(() => {});
  }
  // Existing POIZON workbooks and interrupted jobs are intentionally not read
  // at startup. The user starts that recovery from the header button.
  renderStartupRecoveryProgress({
    percent: 0,
    message: "수동 확인 대기 · 버튼을 누를 때만 기존 작업과 변경 사항을 확인합니다.",
  });
  window.aroundG.onBrandSyncProgress((progress) => {
    if (progress?.context === "category" && categorySearchActive) {
      const completed = Number(progress.pageNum || 0);
      const total = Number(progress.pageCount || 0);
      updateCategoryLoading({
        title: progress.phase === "start"
          ? `${progress.brandName || "브랜드"} 상자를 전달하는 중…`
          : `${progress.brandName || "브랜드"} 상자를 열어 상품을 분류했습니다.`,
        brandName: progress.brandName || "BRAND",
        brandLogoUrl: progress.brandLogoUrl || "",
        phase: progress.phase,
        completed,
        total,
        count: Number(progress.count || 0),
        percent: 35 + (total ? (completed / total) * 63 : 0),
      });
      const brandCount = Number(progress.brandProductCount || 0);
      $("#category-status").textContent = progress.phase === "complete"
        ? `3단계/3 · ${progress.brandName || "브랜드"} 전체 페이지 ${brandCount.toLocaleString("ko-KR")}개 수집 완료 · 브랜드 ${completed}/${total}`
        : `3단계/3 · ${progress.brandName || "브랜드"} 선택 카테고리 전체 페이지 조회 중 · 브랜드 ${completed}/${total}`;
      return;
    }
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
    if (audit?.updatedBrand) {
      const updated = explorerMeta.brands.find((brand) => Number(brand.id) === Number(audit.updatedBrand.brandId));
      if (updated) {
        updated.officialDomainStatus = String(audit.updatedBrand.status || "pending");
        updated.officialHomepageUrl = String(audit.updatedBrand.homepageUrl || "");
      }
    }
    renderOfficialDomainAudit(audit);
    renderBrandCards($("#brand-filter")?.value || "");
  });
  renderOfficialDomainAudit(explorerMeta.officialDomainAudit || {});
  renderDownloadedBrandFiles();
  if (explorerMeta.needsBrandSync) await syncFullBrandCatalog({ automatic: true });
  const config = await window.aroundG.getConfig();
  $("#app-key").value = config.appKey;
  $("#api-base-url").value = config.apiBaseUrl;
  $("#app-secret").placeholder = config.hasAppSecret ? "저장됨 · 변경할 때만 입력" : "필수";
  $("#access-token").placeholder = config.hasAccessToken ? "저장됨 · 변경할 때만 입력" : "선택 사항";
  $("#poizon-login-id").value = config.poizonLoginId || "";
  $("#poizon-password").placeholder = config.hasPoizonPassword ? "암호화 저장됨 · 변경할 때만 입력" : "자동 로그인에 필요";
  $("#nike-login-id").value = config.nikeLoginId || "";
  $("#nike-password").placeholder = config.hasNikePassword ? "Windows 암호화 저장됨" : "공식몰 검색에 필요";
  $("#adidas-login-id").value = config.adidasLoginId || "";
  $("#adidas-password").placeholder = config.hasAdidasPassword ? "Windows 암호화 저장됨" : "공식몰 검색에 필요";
  await renderDomesticLoginStatuses();
  await refresh();
  await pruneCategorySearchHistory();
})();
