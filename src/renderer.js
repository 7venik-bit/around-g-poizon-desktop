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
let activeExportBrand = null;
const brandExportJobs = new Map();
let downloadedBrandFiles = [];
const detectedBrandImportQueue = [];
const queuedBrandImportPaths = new Set();
const completedBrandImportPaths = new Set();
let detectedBrandImportRunning = false;
let brandWorkHistoryGeneration = 0;
let acceptBrandWorkEvents = true;
const WORK_HISTORY_RESET_KEY = "around-g-work-history-reset-v2.10.4";

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

try {
  selectedBrandIds = new Set(JSON.parse(localStorage.getItem("around-g-selected-brand-ids") || "[]").map(Number));
  brandSelectionHistory = JSON.parse(localStorage.getItem("around-g-brand-selection-history") || "[]");
  downloadedBrandFiles = JSON.parse(localStorage.getItem("around-g-brand-download-files") || "[]");
  if (!Array.isArray(downloadedBrandFiles)) downloadedBrandFiles = [];
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
        <span>브랜드</span><span>최근 파일</span><span>작업번호</span><span>저장일</span><span>파일</span><span>열기</span>
      </div>${grouped.map(({ brandName, meta, files }) => {
      const [latest, ...history] = files;
      const logo = meta?.logoUrl
        ? `<img src="${text(meta.logoUrl)}" alt="${text(brandName)} 로고"><b>${text(brandName.slice(0, 1))}</b>`
        : `<b>${text(brandName.slice(0, 1))}</b>`;
      const historyRow = ({ file, index }) => `
        <div class="brand-download-history-row">
          <span></span>
          <strong title="${text(file.path || "")}">${text(file.name || file.path || "Excel 파일")}</strong>
          <code>${text(file.jobId || "-")}</code>
          <time>${text(brandTime(file.time))}</time>
          <span></span>
          <button type="button" data-open-brand-file-index="${index}">열기</button>
        </div>`;
      return `
        <article class="brand-download-row-group">
          <div class="brand-download-row">
            <span class="brand-download-brand">
            <i class="brand-download-logo">${logo}</i>
            <span class="brand-download-name">
              <strong>${text(brandName)}</strong>
              <small>다운로드 완료</small>
            </span>
            </span>
            <strong class="brand-download-filename" title="${text(latest.file.path || "")}">${text(latest.file.name || latest.file.path || "Excel 파일")}</strong>
            <code>${text(latest.file.jobId || "-")}</code>
            <time>${text(brandTime(latest.file.time))}</time>
            <b class="brand-download-badge">${files.length}개</b>
            <button type="button" data-open-brand-file-index="${latest.index}">열기</button>
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
    : '<p class="empty">다운로드가 완료되면 여기에 표시됩니다.</p>';
}

function addDownloadedBrandFile(file = {}) {
  const path = String(file.path || "").trim();
  if (!path) return;
  downloadedBrandFiles = [
    {
      path,
      name: String(file.name || ""),
      brandName: String(file.brandName || selectedBrandName || "선택 브랜드"),
      jobId: String(file.jobId || ""),
      time: Number(file.time) || Date.now(),
    },
    ...downloadedBrandFiles.filter((item) => String(item.path || "") !== path),
  ].slice(0, 500);
  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));
  renderDownloadedBrandFiles();
}

function clearBrandWorkHistoryUi() {
  brandWorkHistoryGeneration += 1;
  acceptBrandWorkEvents = false;
  downloadedBrandFiles = [];
  detectedBrandImportQueue.length = 0;
  queuedBrandImportPaths.clear();
  completedBrandImportPaths.clear();
  brandWorkbenchProducts = [];
  selectedBrandIds.clear();
  brandSelectionHistory = [];
  selectedBrandName = "";
  brandExportQueue = [];
  activeExportBrand = null;
  brandExportJobs.clear();
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
  renderBrandWorkbench();
  renderBrandSelectionPanel();
}

async function restoreDownloadedBrandFiles() {
  const generation = brandWorkHistoryGeneration;
  const result = await window.aroundG?.listBrandExportFiles?.();
  if (generation !== brandWorkHistoryGeneration) return;
  if (!result?.ok || !Array.isArray(result.files)) return;
  const diskPaths = new Set(result.files.map((file) => String(file.path || "")));
  downloadedBrandFiles = downloadedBrandFiles
    .filter((file) => diskPaths.has(String(file.path || "")))
    .sort((a, b) => Number(b.time || 0) - Number(a.time || 0))
    .slice(0, 500);
  localStorage.setItem("around-g-brand-download-files", JSON.stringify(downloadedBrandFiles));
  renderDownloadedBrandFiles();
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
  brandExportJobs.set(normalizedId, {
    brandName: brandName || previous.brandName || "선택 브랜드",
    state: state || previous.state || "감시 중",
  });
  panel.hidden = false;
  $("#brand-export-jobs-list").innerHTML = [...brandExportJobs.entries()]
    .map(([id, job]) => `<div class="brand-export-job-row"><strong>${text(job.brandName)}</strong><code>작업번호 ${text(id)}</code><span class="brand-export-job-state">${text(job.state)}</span></div>`)
    .join("");
  localStorage.setItem("around-g-last-brand-export-job", JSON.stringify({
    jobId: normalizedId,
    state: state || "감시 중",
    time: Date.now(),
  }));
}

function renderBrandSelectionPanel() {
  if (!$("#brand-selection-panel")) return;
  const selected = explorerMeta.brands.filter((brand) => selectedBrandIds.has(Number(brand.id)));
  $("#brand-selection-count").textContent = `${selected.length}개 선택`;
  $("#brand-export-selected").disabled = selected.length === 0 || Boolean(activeExportBrand);
  $("#brand-clear-selected").disabled = selected.length === 0;
  $("#brand-selection-chips").innerHTML = selected.length
    ? selected.map((brand) => {
      const entry = brandSelectionHistory.find((item) => item.brandId === Number(brand.id) && item.action === "추가");
      return `<span class="brand-selection-chip"><strong>${text(brand.name)}</strong><small>${text(brandTime(entry?.time))}</small><button type="button" data-remove-brand-id="${brand.id}" aria-label="${text(brand.name)} 삭제">×</button></span>`;
    }).join("")
    : `<span class="brand-selection-empty">브랜드 카드를 눌러 복수 선택하세요.</span>`;
  $("#brand-selection-history").innerHTML = brandSelectionHistory.length
    ? brandSelectionHistory.slice(0, 20).map((item) => `<li><time>${text(brandTime(item.time))}</time><strong>${text(item.brandName)}</strong><span>${text(item.action)}${item.jobId ? ` · 작업번호 ${text(item.jobId)}` : ""}</span></li>`).join("")
    : "<li>선택 기록이 없습니다.</li>";
}

function toggleBrandSelection(brandId) {
  const id = Number(brandId);
  const brand = explorerMeta.brands.find((item) => Number(item.id) === id);
  if (!brand) return;
  if (selectedBrandIds.has(id)) {
    selectedBrandIds.delete(id);
    recordBrandSelection(brand, "삭제");
  } else {
    selectedBrandIds.add(id);
    selectedBrandId = id;
    retainSelectedBrandName(brand.name);
    recordBrandSelection(brand, "추가");
  }
  renderBrandCards($("#brand-filter")?.value || "");
  renderBrandSelectionPanel();
}

async function exportNextSelectedBrand() {
  acceptBrandWorkEvents = true;
  if (!brandExportQueue.length) {
    activeExportBrand = null;
    renderBrandSelectionPanel();
    $("#brand-status").className = "status success";
    $("#brand-status").textContent = `${brandExportJobs.size}개 브랜드 작업 등록 완료 · 작업번호별 동시 감시를 시작합니다.`;
    await window.aroundG.startSellerBrandExportMonitor();
    return;
  }
  activeExportBrand = brandExportQueue.shift();
  selectedBrandId = Number(activeExportBrand.id);
  retainSelectedBrandName(activeExportBrand.name);
  renderBrandSelectionPanel();
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `${activeExportBrand.name} 판매자센터 요청 생성 여부 확인 중`;
  const brandKey = (value) => String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
  const selectedBrandKey = brandKey(activeExportBrand.name);
  const knownJobIds = [
    ...downloadedBrandFiles
      .filter((file) => brandKey(file.brandName || file.brand) === selectedBrandKey)
      .map((file) => String(file.jobId || "")),
    ...brandSelectionHistory
      .filter((item) => brandKey(item.brandName) === selectedBrandKey)
      .map((item) => String(item.jobId || "")),
  ].filter((jobId, index, all) => jobId && all.indexOf(jobId) === index).slice(0, 20);
  const automation = await window.aroundG.automateSellerBrandExport({
    brandName: activeExportBrand.name || "",
    brandKo: activeExportBrand.ko || "",
    brandId: selectedBrandId,
    knownJobIds,
    deferMonitor: true,
  });
  if (!automation?.ok) {
    recordBrandSelection(activeExportBrand, "데이터 가져오기 실패");
    $("#brand-status").className = "status error";
    $("#brand-status").textContent = automation?.message || "판매자센터 데이터 가져오기 작업이 생성되지 않았습니다.";
    activeExportBrand = null;
    setTimeout(exportNextSelectedBrand, 400);
  } else {
    $("#brand-export-folder-path").textContent = `저장 폴더: ${automation.folder}`;
    const reusedState = automation.reused
      ? (automation.alreadySuccessful ? "기존 성공 작업 재사용" : "기존 처리 작업 이어받기")
      : "등록 완료 · 동시 감시 대기";
    updateBrandExportJob(automation.jobId, reusedState, activeExportBrand.name);
    recordBrandSelection(activeExportBrand, automation.reused ? reusedState : "전체 내보내기 요청", { jobId: automation.jobId });
    renderBrandSelectionPanel();
    $("#brand-status").className = "status success";
    $("#brand-status").textContent = automation.reused
      ? `${activeExportBrand.name} · 작업번호 ${automation.jobId} · ${automation.alreadySuccessful ? "기존 완료 파일 재다운로드 대기" : "기존 작업 감시 등록"}`
      : `${activeExportBrand.name} 요청 접수 완료${automation.jobId ? ` · 작업번호 ${automation.jobId}` : ""} · 다음 브랜드 등록 중`;
    activeExportBrand = null;
    setTimeout(exportNextSelectedBrand, 400);
  }
}

function retainSelectedBrandName(brandName = "") {
  selectedBrandName = String(brandName || selectedBrandName || "").trim();
  const pickerSelection = $("#brand-picker-selection");
  if (pickerSelection) pickerSelection.textContent = selectedBrandName || "브랜드를 선택해 주세요";
  if (selectedBrandName) {
    localStorage.setItem("around-g-selected-brand-name", selectedBrandName);
  }
}

function setupBrandLayout() {
  const panel = $("#explorer-brand");
  const toolbar = panel?.querySelector(".brand-toolbar");
  const cards = $("#brand-cards");
  const status = panel?.querySelector(".explorer-actions");
  if (!panel || !toolbar || !cards || $("#brand-picker")) return;

  const picker = document.createElement("details");
  picker.id = "brand-picker";
  picker.className = "brand-picker";
  picker.open = !brandWorkbenchProducts.length;
  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.textContent = "브랜드 선택 목록";
  const selection = document.createElement("strong");
  selection.id = "brand-picker-selection";
  selection.textContent = selectedBrandName || "브랜드를 선택해 주세요";
  summary.append(title, selection);

  const selectionPanel = document.createElement("section");
  selectionPanel.id = "brand-selection-panel";
  selectionPanel.className = "brand-selection-panel";
  selectionPanel.innerHTML = `
    <div class="brand-selection-head">
      <div><strong>선택 브랜드</strong><span id="brand-selection-count">0개 선택</span></div>
      <div>
        <button type="button" id="brand-export-selected" class="primary">선택 브랜드 데이터 가져오기</button>
        <button type="button" id="brand-clear-selected">전체 삭제</button>
      </div>
    </div>
    <div id="brand-selection-chips" class="brand-selection-chips"></div>
    <details class="brand-selection-log"><summary>선택 시간 및 변경 내역</summary><ol id="brand-selection-history"></ol></details>`;
  picker.append(summary, toolbar, selectionPanel, cards);
  if (status) status.insertAdjacentElement("afterend", picker);
  else panel.append(picker);
  renderBrandSelectionPanel();
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

function renderBrandCards(filter = "") {
  const normalized = filter.trim().toLowerCase();
  const brands = explorerMeta.brands.filter((brand) =>
    !normalized || `${brand.name} ${brand.ko}`.toLowerCase().includes(normalized)
  );
  $("#brand-cards").innerHTML = brands.map((brand) => `<button class="brand-card ${selectedBrandIds.has(Number(brand.id)) ? "selected" : ""}" data-brand-id="${brand.id}" aria-pressed="${selectedBrandIds.has(Number(brand.id))}">
    <i class="brand-logo">${brand.logoUrl ? `<img src="${text(brand.logoUrl)}" alt="${text(brand.name)} 로고"><b>${text(brand.name.slice(0, 1))}</b>` : `<b>${text(brand.name.slice(0, 1))}</b>`}</i><span><strong>${text(brand.name)}</strong><small>${text(brand.ko)} · Brand ID ${brand.id}</small></span>
  </button>`).join("");
  document.querySelectorAll(".brand-logo img").forEach((image) => {
    image.addEventListener("load", () => image.parentElement?.classList.add("loaded"), { once: true });
    image.addEventListener("error", () => image.remove(), { once: true });
  });
  $("#brand-summary").textContent = `${explorerMeta.brands.length}개 검증 브랜드 · ${brands.length}개 표시`;
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
  if (!products.length) return { label: "상품 없음", className: "missing" };
  if (!products.some((product) => product.inStock)) return { label: "재고 없음", className: "soldout" };
  return { label: "구매 가능", className: "available" };
}

function renderDomestic(result) {
  if (!result) return `<span class="inventory-help">재고 검색을 누르면 브랜드 공식몰 → 무신사 → 네이버 패션타운 → 브랜드직영몰 → 백화점 → 아울렛 순서로 확인합니다.</span>`;
  if (result.loading) return `<span class="inventory-help">국내 플랫폼을 순서대로 확인하고 있습니다…</span>`;
  if (result.error) return `<span class="inventory-help error">국내 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.</span>`;
  const products = (result.products || []).filter((product) => product && (product.name || product.title));
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
  const directLinks = (result.sources || []).filter((source) => source.linkOnly).map((source) =>
    source.officialProductUrl
      ? `<button class="source-link" data-official-discovery="${encodeURIComponent(source.searchUrl)}" data-official-product="${encodeURIComponent(source.officialProductUrl)}"><span>${text(source.store)}</span>${source.countVerified ? `<b class="source-count">${Number(source.count || 0)}</b>` : `<small>결과 확인</small>`}</button>`
      : `<button class="source-link" data-url="${encodeURIComponent(source.searchUrl)}"><span>${text(source.store)}</span>${source.countVerified ? `<b class="source-count">${Number(source.count || 0)}</b>` : `<small>결과 확인</small>`}</button>`
  ).join("");
  return `<div class="platform-list">${productRows || `<span class="inventory-help">일치하는 국내 판매 상품을 찾지 못했습니다.</span>`}</div>
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
      <input id="brand-result-min-total" type="number" min="0" placeholder="총 판매량 최소">
      <input id="brand-result-max-total" type="number" min="0" placeholder="총 판매량 최대">
      <input id="brand-result-min-local" type="number" min="0" placeholder="현지 30일 최소">
      <input id="brand-result-max-local" type="number" min="0" placeholder="현지 30일 최대">
      <select id="brand-result-data-option">
        <option value="">누락값 포함</option>
        <option value="available">두 판매량 확인 가능</option>
        <option value="missing">누락값만 표시</option>
      </select>
      <button id="brand-result-reset" type="button" class="poizon-reset">초기화</button>
    </div>
    <div class="poizon-result-summary">
      <strong>총 ${Number(sourceTotal).toLocaleString("ko-KR")}건 결과</strong>
      <span id="brand-collection-audit">수집 ${allProducts.length.toLocaleString("ko-KR")}건</span>
      <select id="brand-result-sort"><option value="total-desc">총 판매량 내림차순</option><option value="total-asc">총 판매량 오름차순</option><option value="local-desc">현지 30일 내림차순</option><option value="local-asc">현지 30일 오름차순</option></select>
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
        <span>최근 30일 평균 거래가</span><span>총 판매량</span><span>최근 30일 판매량</span>
        <span>현지 판매자 최근 30일 판매량</span><span>관리</span>
      </div>
      <div id="brand-result-rows"></div>
    </div>`;

  const renderRows = () => {
    const category = $("#brand-result-category").value;
    const minTotalText = $("#brand-result-min-total").value;
    const maxTotalText = $("#brand-result-max-total").value;
    const minLocalText = $("#brand-result-min-local").value;
    const maxLocalText = $("#brand-result-max-local").value;
    const minimumTotal = minTotalText === "" ? null : Math.max(0, Number(minTotalText));
    const maximumTotal = maxTotalText === "" ? null : Math.max(0, Number(maxTotalText));
    const minimumLocal = minLocalText === "" ? null : Math.max(0, Number(minLocalText));
    const maximumLocal = maxLocalText === "" ? null : Math.max(0, Number(maxLocalText));
    const dataOption = $("#brand-result-data-option").value;
    currentExplorerProducts = allProducts.filter((product) =>
      (!category || (product.categoryName || product.category || "") === category)
      && (minimumTotal === null || (product.hasTotalSalesData && Number(product.totalSales) >= minimumTotal))
      && (maximumTotal === null || (product.hasTotalSalesData && Number(product.totalSales) <= maximumTotal))
      && (minimumLocal === null || (product.hasLocalSalesData && Number(product.localSales30d) >= minimumLocal))
      && (maximumLocal === null || (product.hasLocalSalesData && Number(product.localSales30d) <= maximumLocal))
      && (dataOption !== "available" || (product.hasTotalSalesData && product.hasLocalSalesData))
      && (dataOption !== "missing" || !product.hasTotalSalesData || !product.hasLocalSalesData)
    );
    const sort = $("#brand-result-sort").value;
    currentExplorerProducts.sort((left, right) => sort === "total-asc"
      ? Number(left.totalSales || 0) - Number(right.totalSales || 0)
      : sort === "local-desc"
        ? (Number(right.localSales30d || 0) - Number(left.localSales30d || 0))
          || (Number(right.totalSales || 0) - Number(left.totalSales || 0))
        : sort === "local-asc"
          ? Number(left.localSales30d || 0) - Number(right.localSales30d || 0)
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
  ["#brand-result-category", "#brand-result-min-total", "#brand-result-max-total", "#brand-result-min-local", "#brand-result-max-local", "#brand-result-data-option", "#brand-result-sort"]
    .forEach((selector) => $(selector).addEventListener("input", renderRows));
  $("#brand-result-reset").addEventListener("click", () => {
    $("#brand-result-category").value = "";
    $("#brand-result-min-total").value = "";
    $("#brand-result-max-total").value = "";
    $("#brand-result-min-local").value = "";
    $("#brand-result-max-local").value = "";
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
  const removeBrandId = event.target.closest("[data-remove-brand-id]")?.dataset.removeBrandId;
  if (removeBrandId) {
    toggleBrandSelection(removeBrandId);
    return;
  }
  if (event.target.closest("#brand-clear-selected")) {
    explorerMeta.brands
      .filter((brand) => selectedBrandIds.has(Number(brand.id)))
      .forEach((brand) => recordBrandSelection(brand, "삭제"));
    selectedBrandIds.clear();
    saveBrandSelections();
    renderBrandCards($("#brand-filter")?.value || "");
    renderBrandSelectionPanel();
    return;
  }
  if (event.target.closest("#brand-export-selected")) {
    brandExportQueue = explorerMeta.brands.filter((brand) => selectedBrandIds.has(Number(brand.id)));
    if (!brandExportQueue.length || activeExportBrand) return;
    clearExplorerResults();
    brandWorkbenchProducts = [];
    renderBrandWorkbench();
    exportNextSelectedBrand();
    return;
  }
  const brandId = event.target.closest("[data-brand-id]")?.dataset.brandId;
  if (brandId) {
    toggleBrandSelection(brandId);
    return;
    selectedBrandId = Number(brandId);
    renderBrandCards($("#brand-filter").value);
    $("#brand-search").disabled = true;
    $("#brand-search").textContent = "수집 기능 재설계 중";
    const brand = explorerMeta.brands.find((item) => item.id === selectedBrandId);
    retainSelectedBrandName(brand?.name || "");
    if ($("#brand-picker")) $("#brand-picker").open = false;
    clearExplorerResults();
    brandWorkbenchProducts = [];
    renderBrandWorkbench();
    $("#brand-status").className = "status";
    $("#brand-status").textContent = `${brand?.name || brandId} 판매자센터 전체 데이터 가져오기를 시작합니다.`;
    const automation = await window.aroundG.automateSellerBrandExport({
      brandName: brand?.name || "",
      brandKo: brand?.ko || "",
      brandId: selectedBrandId,
    });
    if (!automation.ok) {
      $("#brand-status").className = "status error";
      $("#brand-status").textContent = automation.message || "판매자센터 데이터 가져오기 자동화에 실패했습니다.";
    } else {
      $("#brand-export-folder-path").textContent = `저장 폴더: ${automation.folder}`;
      $("#brand-status").className = "status success";
      $("#brand-status").textContent = "전체 데이터를 요청했습니다. 다운로드가 끝나면 자동으로 불러옵니다.";
    }
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
$("#brand-sync").addEventListener("click", async () => {
  const button = $("#brand-sync");
  const status = $("#brand-status");
  button.disabled = true;
  status.className = "status";
  status.textContent = "POIZON 한국 브랜드 목록을 불러오는 중…";
  const result = await window.aroundG.syncBrands();
  button.disabled = false;
  if (!result.ok) {
    status.className = "status error";
    status.textContent = [result.error?.message, result.error?.code].filter(Boolean).join(" · ") || "브랜드 동기화에 실패했습니다.";
    return;
  }
  explorerMeta.brands = result.brands;
  selectedBrandId = null;
  $("#brand-search").disabled = true;
  renderBrandCards($("#brand-filter").value);
  status.className = "status success";
  status.textContent = `POIZON 브랜드 ${result.brands.length.toLocaleString("ko-KR")}개 동기화 완료`;
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
  retainSelectedBrandName(file.brandName || selectedBrandName);
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `${selectedBrandName || "선택 브랜드"} 다운로드 완료 확인 · ${file.name || file.path}`;
  const result = await window.aroundG.importBrandExcelFromPath(file.path);
  if (!acceptBrandWorkEvents || generation !== brandWorkHistoryGeneration) return false;
  if (!result.ok) {
    $("#brand-status").className = "status error";
    $("#brand-status").textContent = result.message || "감지된 파일이 POIZON 전체 내보내기 양식이 아닙니다.";
    return;
  }
  brandWorkbenchProducts = result.products || [];
  renderBrandWorkbench();
  updateBrandExportJob(file?.jobId, "완료 · Excel 자동 불러오기 완료", file?.brandName);
  $("#brand-status").className = "status success";
  $("#brand-status").textContent = `${selectedBrandName || "선택 브랜드"} 자동 불러오기 완료 · Excel ${Number(result.sourceRows || 0).toLocaleString("ko-KR")}행 → 상품 ${brandWorkbenchProducts.length.toLocaleString("ko-KR")}개`;
  return true;
}

async function drainDetectedBrandImports() {
  if (detectedBrandImportRunning) return;
  detectedBrandImportRunning = true;
  try {
    while (detectedBrandImportQueue.length) {
      const file = detectedBrandImportQueue.shift();
      const path = String(file?.path || "").trim();
      if (!path || completedBrandImportPaths.has(path)) {
        queuedBrandImportPaths.delete(path);
        continue;
      }
      updateBrandExportJob(file?.jobId, "다운로드 완료 · Excel 자동 불러오는 중", file?.brandName);
      try {
        const generation = brandWorkHistoryGeneration;
        const imported = await importDetectedBrandExport(file, generation);
        if (imported) completedBrandImportPaths.add(path);
      } catch (error) {
        $("#brand-status").className = "status error";
        $("#brand-status").textContent = `Excel 자동 불러오기 실패: ${error?.message || "UNKNOWN_ERROR"}`;
      } finally {
        queuedBrandImportPaths.delete(path);
      }
    }
  } finally {
    detectedBrandImportRunning = false;
    if (detectedBrandImportQueue.length) void drainDetectedBrandImports();
  }
}

window.aroundG.onBrandExportDetected((file) => {
  if (!acceptBrandWorkEvents) return;
  const path = String(file?.path || "").trim();
  if (!path || completedBrandImportPaths.has(path) || queuedBrandImportPaths.has(path)) return;
  updateBrandExportJob(file?.jobId, "다운로드 완료 · 자동 불러오기 대기", file?.brandName);
  addDownloadedBrandFile(file);
  queuedBrandImportPaths.add(path);
  detectedBrandImportQueue.push(file);
  $("#brand-status").className = "status";
  $("#brand-status").textContent = `${file?.brandName || "선택 브랜드"} 저장 완료 · Excel 자동 불러오기 대기 중`;
  void drainDetectedBrandImports();
});
$("#brand-download-files").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-open-brand-file-index]");
  if (!button) return;
  const file = downloadedBrandFiles[Number(button.dataset.openBrandFileIndex)];
  if (!file?.path) return;
  const result = await window.aroundG.openDownloadedBrandFile(file.path, file.brandName || file.brand || "");
  if (!result?.ok) {
    $("#brand-status").className = "status error";
    $("#brand-status").textContent = `파일 열기 실패: ${result?.message || "파일을 찾을 수 없습니다."}`;
  }
});
$("#brand-download-clear")?.addEventListener("click", async () => {
  clearBrandWorkHistoryUi();
  await window.aroundG?.clearBrandWorkHistory?.();
  $("#brand-status").className = "status success";
  $("#brand-status").textContent = "이전 작업 기록을 삭제했습니다. 원본 Excel 파일은 보존됩니다.";
});
window.aroundG.onBrandWorkHistoryCleared?.(() => clearBrandWorkHistoryUi());
window.aroundG.onBrandExportProgress((progress) => {
  if (!acceptBrandWorkEvents) return;
  updateBrandExportJob(progress?.jobId, progress?.jobState || "자동 감시 중", progress?.brandName);
  $("#brand-status").className = "status";
  $("#brand-status").textContent = progress?.message || "다운로드를 시작했습니다.";
});
window.aroundG.onBrandExportError((error) => {
  if (!acceptBrandWorkEvents) return;
  $("#brand-status").className = "status error";
  $("#brand-status").textContent = `폴더 감시 오류: ${error.message || "UNKNOWN_ERROR"}`;
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
void restoreDownloadedBrandFiles();
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

function calculate(margin) {
  const cost = Number($("#cost").value || 0) + Number($("#shipping").value || 0) + Number($("#extra").value || 0);
  const fee = Number($("#fee").value || 0) / 100;
  const target = Number(margin || 0) / 100;
  const price = cost > 0 && 1 - fee - target > 0 ? Math.ceil(cost / (1 - fee - target) / 100) * 100 : 0;
  $("#sale-price").textContent = money(price);
  $("#total-cost").textContent = money(cost);
  $("#net-profit").textContent = money(price * (1 - fee) - cost);
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
    renderInstalledVersion("2.10.13", true);
  }
  setupBrandLayout();
  try {
    const savedJob = JSON.parse(localStorage.getItem("around-g-last-brand-export-job") || "null");
    if (savedJob?.jobId) updateBrandExportJob(savedJob.jobId, savedJob.state || "마지막 작업");
  } catch {
    localStorage.removeItem("around-g-last-brand-export-job");
  }
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
  explorerMeta = await window.aroundG.explorerMeta();
  renderDownloadedBrandFiles();
  renderBrandCards();
  renderCategoryButtons();
  const config = await window.aroundG.getConfig();
  const exportFolder = await window.aroundG.getBrandExportFolder();
  $("#brand-export-folder-path").textContent = exportFolder.folder
    ? `자동 불러오기 폴더: ${exportFolder.folder}`
    : "자동 불러오기 폴더가 설정되지 않았습니다.";
  $("#app-key").value = config.appKey;
  $("#api-base-url").value = config.apiBaseUrl;
  $("#app-secret").placeholder = config.hasAppSecret ? "저장됨 · 변경할 때만 입력" : "필수";
  $("#access-token").placeholder = config.hasAccessToken ? "저장됨 · 변경할 때만 입력" : "선택 사항";
  await refresh();
})();
