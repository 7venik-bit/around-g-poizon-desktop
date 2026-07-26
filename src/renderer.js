const $ = (selector) => document.querySelector(selector);
const money = (value) => `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
let state = { products: [], ledger: [], orders: [], favorites: [] };
let entryCollection = "ledger";
let explorerMeta = { brands: [], categories: [] };
let selectedBrandId = null;
let selectedCategory = "전체";
let currentExplorerProducts = [];
const domesticResults = new Map();
let domesticBatchRunning = false;

function popularWorkflowInput(markSynced = false) {
  return {
    period: "week",
    compare: "week",
    unit: "SPU",
    limit: Number($("#popular-limit").value),
    reminder: $("#popular-reminder").checked,
    markSynced,
  };
}

function renderPopularDue(lastSyncAt, reminder = true) {
  const host = $("#popular-due");
  if (!reminder) {
    host.className = "status";
    host.textContent = "갱신 알림 꺼짐";
    return;
  }
  if (!lastSyncAt) {
    host.className = "status error";
    host.textContent = "첫 인기상품 갱신이 필요합니다.";
    return;
  }
  const elapsedDays = Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 86_400_000);
  const remaining = 14 - elapsedDays;
  host.className = remaining <= 0 ? "status error" : "status success";
  host.textContent = remaining <= 0
    ? `2주 갱신일이 ${Math.abs(remaining)}일 지났습니다.`
    : `마지막 갱신 ${elapsedDays}일 전 · 다음 갱신까지 ${remaining}일`;
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
  $("#brand-cards").innerHTML = brands.map((brand) => `<button class="brand-card ${brand.id === selectedBrandId ? "selected" : ""}" data-brand-id="${brand.id}">
    <i>${text(brand.name.slice(0, 1))}</i><span><strong>${text(brand.name)}</strong><small>${text(brand.ko)} · Brand ID ${brand.id}</small></span>
  </button>`).join("");
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
  if (!result) return `<span class="inventory-help">재고 검색을 누르면 무신사 → 네이버 패션타운(브랜드직영몰·백화점·아울렛) → 백화점 → 아울렛 순서로 확인합니다.</span>`;
  if (result.loading) return `<span class="inventory-help">국내 플랫폼을 순서대로 확인하고 있습니다…</span>`;
  if (result.error) return `<span class="inventory-help error">국내 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.</span>`;
  const productsByStore = new Map();
  for (const product of result.products || []) {
    if (!productsByStore.has(product.store)) productsByStore.set(product.store, product);
  }
  return `<div class="platform-list">${(result.sources || []).map((source) => {
    const product = productsByStore.get(source.store);
    const sizes = product?.sizes || [];
    const sourceState = product
      ? product.inStock ? "available" : "soldout"
      : source.linkOnly ? "link" : source.ok ? "missing" : "error";
    const sourceLabel = product
      ? product.inStock ? "구매 가능" : "재고 없음"
      : source.linkOnly ? "검색 링크" : source.ok ? "상품 없음" : "확인 실패";
    const confidenceClass = Number(product?.confidence || 0) >= 75 ? "high"
      : Number(product?.confidence || 0) >= 45 ? "medium" : "low";
    const candidateName = product?.title || product?.name || product?.articleNumber || "";
    return `<div class="platform-row">
      <span class="platform-priority">${source.priority}</span>
      <strong>${text(source.store)}</strong>
      <div class="candidate-summary">
        ${product?.imageUrl ? `<img class="candidate-image" src="${text(product.imageUrl)}" alt="${text(candidateName)}">` : `<span class="candidate-image empty">이미지 없음</span>`}
        <span><b>${text(candidateName || source.store + " 검색 결과")}</b>${product?.price ? `<small>${money(product.price)}</small>` : ""}</span>
      </div>
      <span class="stock-state ${sourceState}">${sourceLabel}</span>
      ${product ? `<span class="confidence ${confidenceClass}">신뢰도 ${Number(product.confidence || 0)}%</span>` : ""}
      <div class="size-list">${sizes.length
        ? sizes.map((size) => `<span class="size-chip ${size.inStock ? "available" : "soldout"}">${text(size.label)}</span>`).join("")
        : product?.inStock ? `<span class="size-chip unknown">사이즈 확인 필요</span>` : ""}</div>
      ${product ? `<div class="match-signals"><span>코드 ${text(product.signals?.code)}</span><span>상품명 ${text(product.signals?.title)}</span><span>이미지 ${text(product.signals?.image)}</span></div>` : ""}
      <button data-url="${encodeURIComponent(product?.url || source.searchUrl)}">${product?.inStock ? "구매" : "검색"}</button>
    </div>`;
  }).join("")}</div>`;
}

function renderExplorerResults(title, products, preserveDomestic = false) {
  currentExplorerProducts = products;
  if (!preserveDomestic) domesticResults.clear();
  $("#explorer-results").hidden = false;
  $("#explorer-result-title").textContent = title;
  $("#explorer-result-count").textContent = `${products.length.toLocaleString("ko-KR")}개 표시`;
  $("#explorer-product-grid").innerHTML = products.length ? products.map((product, index) => {
    const key = domesticKey(product, index);
    const result = domesticResults.get(key);
    const status = domesticStatus(result);
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
      <div class="domestic-inventory">
        <div class="inventory-heading"><span class="inventory-status ${status.className}">${status.label}</span><button data-domestic="${encodeURIComponent(key)}" data-index="${index}" class="primary">국내 재고 검색</button></div>
        ${renderDomestic(result)}
      </div>
    </article>`;
  }).join("") : `<div class="empty">조건에 맞는 상품이 없습니다.</div>`;
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
    document.querySelectorAll(".nav,.view").forEach((item) => item.classList.remove("active"));
    nav.classList.add("active");
    $(`#${nav.dataset.view}`).classList.add("active");
    $("#page-title").textContent = nav.textContent;
  }
  const remove = event.target.dataset.remove;
  if (remove) {
    const [collection, id] = remove.split(":");
    await window.aroundG.remove(collection, id);
    await refresh();
  }
  const query = event.target.dataset.search;
  if (query) await window.aroundG.openExternal(`https://search.naver.com/search.naver?where=shopping&query=${query}`);
  const externalUrl = event.target.dataset.url;
  if (externalUrl) await window.aroundG.openExternal(decodeURIComponent(externalUrl));
  const domesticIndex = event.target.dataset.index;
  if (event.target.dataset.domestic && domesticIndex !== undefined) await searchDomesticAt(Number(domesticIndex));
  const brandId = event.target.closest("[data-brand-id]")?.dataset.brandId;
  if (brandId) {
    selectedBrandId = Number(brandId);
    renderBrandCards($("#brand-filter").value);
    $("#brand-search").disabled = false;
    const brand = explorerMeta.brands.find((item) => item.id === selectedBrandId);
    $("#brand-status").textContent = `${brand?.name || brandId} 선택됨`;
  }
  const category = event.target.closest("[data-category]")?.dataset.category;
  if (category) {
    selectedCategory = category;
    renderCategoryButtons();
  }
});

document.querySelectorAll(".explorer-mode").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".explorer-mode,.explorer-panel").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  $(`#explorer-${button.dataset.explorer}`).classList.add("active");
}));

$("#brand-filter").addEventListener("input", (event) => renderBrandCards(event.target.value));

async function acceptSellerCenterProducts(products, sourceLabel) {
  const limited = products.slice(0, Number($("#popular-limit").value));
  const storedProducts = limited.map((product) => ({
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
  const workflow = await window.aroundG.savePopularWorkflow(popularWorkflowInput(true));
  renderPopularDue(workflow.lastSyncAt, workflow.reminder);
  await refresh();
  $("#popular-status").className = "status success";
  $("#popular-status").textContent = `${sourceLabel} · 판매자센터 인기상품 ${limited.length}개를 직접 가져왔습니다.`;
  renderExplorerResults("POIZON 판매자센터 인기상품", limited.map((product) => ({
    ...product,
    hasSalesData: Number(product.sales30d) > 0,
  })));
}

$("#popular-open").addEventListener("click", async () => {
  await window.aroundG.openSellerCenter();
  $("#popular-status").className = "status";
  $("#popular-status").textContent = "앱 전용 판매자센터 창에서 로그인하고 인기상품 화면을 연 뒤 ‘현재 인기상품 가져오기’를 누르세요.";
});
$("#popular-capture").addEventListener("click", async () => {
  const button = $("#popular-capture");
  button.disabled = true;
  $("#popular-status").className = "status";
  $("#popular-status").textContent = "판매자센터 현재 화면의 인기상품 표와 이미지를 읽고 있습니다…";
  try {
    const result = await window.aroundG.captureSellerCenter();
    if (!result.ok) {
      $("#popular-status").className = "status error";
      $("#popular-status").textContent = result.message;
      return;
    }
    const applied = (result.conditions || []).filter((condition) => condition.found).length;
    await acceptSellerCenterProducts(result.products, `자동 조건 ${applied}/${result.conditions?.length || 6} 적용`);
  } finally {
    button.disabled = false;
  }
});
for (const selector of ["#popular-limit", "#popular-reminder"]) {
  $(selector).addEventListener("change", async () => {
    const workflow = await window.aroundG.savePopularWorkflow(popularWorkflowInput(false));
    renderPopularDue(workflow.lastSyncAt, workflow.reminder);
  });
}
$("#domestic-search-all").addEventListener("click", async () => {
  const button = $("#domestic-search-all");
  if (domesticBatchRunning) {
    domesticBatchRunning = false;
    button.textContent = "표시 목록 국내 재고 검색";
    $("#domestic-batch-status").textContent = "국내 재고 검색을 중지했습니다.";
    return;
  }
  domesticBatchRunning = true;
  button.textContent = "검색 중지";
  for (let index = 0; index < currentExplorerProducts.length && domesticBatchRunning; index += 1) {
    $("#domestic-batch-status").className = "status";
    $("#domestic-batch-status").textContent = `국내 재고 검색 ${index + 1}/${currentExplorerProducts.length} · 플랫폼 요청 제한을 피하기 위해 순차 진행합니다.`;
    await searchDomesticAt(index);
  }
  const completed = domesticResults.size;
  domesticBatchRunning = false;
  button.textContent = "표시 목록 국내 재고 검색";
  $("#domestic-batch-status").className = "status success";
  $("#domestic-batch-status").textContent = `국내 재고 검색 완료 ${completed}/${currentExplorerProducts.length}`;
});
$("#brand-search").addEventListener("click", async () => {
  const status = $("#brand-status");
  status.className = "status";
  status.textContent = "POIZON 브랜드 상품 조회 중…";
  const result = await window.aroundG.queryExplorer({
    mode: "brand",
    brandId: selectedBrandId,
    pageNum: 1,
    pageSize: 30,
    minimumSales30: $("#brand-min-sales").checked,
    salesByArticle: salesByArticle(),
  });
  if (!result.ok) {
    status.className = "status error";
    status.textContent = result.error.message;
    return;
  }
  if ($("#brand-min-sales").checked && !result.salesFilterAvailable) {
    status.className = "status error";
    status.textContent = "판매량 데이터가 없습니다. 인기상품 표를 먼저 붙여넣거나 30건 옵션을 해제하세요.";
  } else {
    status.className = "status success";
    status.textContent = `공식 API 조회 완료 · 전체 ${Number(result.total).toLocaleString("ko-KR")}건`;
  }
  const brand = explorerMeta.brands.find((item) => item.id === selectedBrandId);
  renderExplorerResults(`${brand?.name || ""} 브랜드 검색`, result.products);
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

let updateCloseTimer;
let updateCloseInterval;
let latestUpdateMeta = { version: "", releaseDate: "" };

function cancelUpdateAutoClose() {
  clearTimeout(updateCloseTimer);
  clearInterval(updateCloseInterval);
  $("#update-auto-close").hidden = true;
}

function scheduleUpdateAutoClose() {
  cancelUpdateAutoClose();
  let seconds = 5;
  $("#update-auto-close").hidden = false;
  $("#update-auto-close").textContent = `${seconds}초 뒤 자동으로 닫힙니다.`;
  updateCloseInterval = setInterval(() => {
    seconds -= 1;
    $("#update-auto-close").textContent = `${seconds}초 뒤 자동으로 닫힙니다.`;
  }, 1000);
  updateCloseTimer = setTimeout(() => {
    clearInterval(updateCloseInterval);
    $("#update-mini").hidden = true;
  }, 5000);
}

function formatUpdateDate(value) {
  if (!value) return "날짜 정보 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

$("#update-check").addEventListener("click", async () => {
  cancelUpdateAutoClose();
  $("#update-mini").hidden = false;
  $("#update-mini-message").textContent = "GitHub Releases에서 새 버전을 확인하고 있습니다…";
  $("#update-progress-bar").style.width = "8%";
  $("#update-progress-text").textContent = "8%";
  const result = await window.aroundG.checkForUpdates();
  if (!result.ok) {
    $("#update-mini-message").textContent = result.message;
    $("#update-mini-note").textContent = "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
  }
});
async function downloadUpdate() {
  cancelUpdateAutoClose();
  $("#update-mini-download").disabled = true;
  $("#update-mini").hidden = false;
  $("#update-mini-message").textContent = "업데이트 다운로드를 준비하고 있습니다…";
  const result = await window.aroundG.installUpdate();
  if (!result.ok) {
    $("#update-mini-message").textContent = result.message;
    $("#update-mini-download").disabled = false;
  }
}
$("#update-mini-download").addEventListener("click", downloadUpdate);
$("#update-mini-close").addEventListener("click", () => {
  cancelUpdateAutoClose();
  $("#update-mini").hidden = true;
});
$("#update-mini-restart").addEventListener("click", async () => {
  $("#update-mini-restart").disabled = true;
  $("#update-mini-message").textContent = "설치 후 자동으로 다시 시작합니다…";
  const result = await window.aroundG.restartForUpdate();
  if (!result.ok) {
    $("#update-mini-message").textContent = result.message;
    $("#update-mini-restart").disabled = false;
  }
});
window.aroundG.onUpdateStatus((payload) => {
  const mini = $("#update-mini");
  mini.hidden = false;
  if (payload.version) latestUpdateMeta.version = payload.version;
  if (payload.releaseDate) latestUpdateMeta.releaseDate = payload.releaseDate;
  $("#update-version").textContent = latestUpdateMeta.version || "현재 버전";
  $("#update-date").textContent = formatUpdateDate(latestUpdateMeta.releaseDate);
  $("#update-alert").hidden = payload.status !== "available" && payload.status !== "downloading" && payload.status !== "downloaded";
  $("#update-mini-message").textContent = payload.message;
  $("#update-mini-download").hidden = payload.status !== "available";
  $("#update-mini-restart").hidden = payload.status !== "downloaded";
  const progress = payload.status === "checking" ? 8
    : payload.status === "available" ? 15
      : payload.status === "downloading" ? Number(payload.percent || 0)
        : ["downloaded", "current"].includes(payload.status) ? 100 : 0;
  $("#update-progress-bar").style.width = `${Math.max(0, Math.min(100, progress))}%`;
  $("#update-progress-text").textContent = `${Math.round(Math.max(0, Math.min(100, progress)))}%`;
  const stepOrder = ["checking", "downloading", "downloaded"];
  const activeStep = payload.status === "available" ? "downloading"
    : payload.status === "current" ? "downloaded" : payload.status;
  const activeIndex = stepOrder.indexOf(activeStep);
  document.querySelectorAll("[data-update-step]").forEach((step, index) => {
    step.classList.toggle("active", index === activeIndex);
    step.classList.toggle("done", activeIndex >= 0 && index < activeIndex);
  });
  if (payload.status === "downloaded") {
    cancelUpdateAutoClose();
    $("#update-mini-note").textContent = "3초 뒤 프로그램이 종료되고 자동 설치된 후 다시 열립니다.";
  } else if (payload.status === "downloading") {
    cancelUpdateAutoClose();
    $("#update-mini-note").textContent = "다운로드 중에도 프로그램을 계속 사용할 수 있습니다.";
  } else if (payload.status === "current") {
    $("#update-mini-note").textContent = "현재 최신 버전을 사용하고 있습니다.";
  }
  if (["available", "current", "error"].includes(payload.status)) scheduleUpdateAutoClose();
});

(async () => {
  explorerMeta = await window.aroundG.explorerMeta();
  renderBrandCards();
  renderCategoryButtons();
  const config = await window.aroundG.getConfig();
  $("#app-key").value = config.appKey;
  $("#api-base-url").value = config.apiBaseUrl;
  $("#app-secret").placeholder = config.hasAppSecret ? "저장됨 · 변경할 때만 입력" : "필수";
  $("#access-token").placeholder = config.hasAccessToken ? "저장됨 · 변경할 때만 입력" : "선택 사항";
  const popularWorkflow = await window.aroundG.getPopularWorkflow();
  $("#popular-limit").value = String(popularWorkflow.limit);
  $("#popular-reminder").checked = popularWorkflow.reminder;
  renderPopularDue(popularWorkflow.lastSyncAt, popularWorkflow.reminder);
  await refresh();
})();
