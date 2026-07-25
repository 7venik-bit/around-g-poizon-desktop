const $ = (selector) => document.querySelector(selector);
const money = (value) => `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
let state = { products: [], ledger: [], orders: [], favorites: [] };
let entryCollection = "ledger";
let explorerMeta = { brands: [], categories: [] };
let selectedBrandId = null;
let selectedCategory = "전체";
let popularProcessing = false;
const SELLER_RANK_URL = "https://seller.poizon.com/main/dataCenter/merchantRankBoard";

function popularWorkflowInput(markSynced = false) {
  return {
    period: $("#popular-period").value,
    compare: $("#popular-compare").value,
    unit: $("#popular-unit").value,
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

function renderExplorerResults(title, products) {
  $("#explorer-results").hidden = false;
  $("#explorer-result-title").textContent = title;
  $("#explorer-result-count").textContent = `${products.length.toLocaleString("ko-KR")}개 표시`;
  $("#explorer-product-grid").innerHTML = products.length ? products.map((product, index) => `<article class="explorer-product">
    ${product.logoUrl ? `<img src="${text(product.logoUrl)}" alt="">` : ""}
    <div class="explorer-product-body">
      <span class="badge">${text(product.categoryGroup || "인기상품")}</span>
      ${product.apiMatched ? `<span class="badge">API 연결</span>` : product.apiMatched === false ? `<span class="badge muted">API 미일치</span>` : ""}
      ${product.hasSalesData ? `<span class="badge">30일 ${Number(product.sales30d).toLocaleString("ko-KR")}건</span>` : `<span class="badge muted">판매량 미결합</span>`}
      <h3>${text(product.title || product.name)}</h3>
      <p>${text(product.brandName || product.brand || "")}</p>
      <div class="explorer-product-meta"><code>${text(product.articleNumber || "")}</code><span>${product.averagePrice || product.minPrice?.value ? money(product.averagePrice || product.minPrice.value) : ""}</span></div>
      <div class="explorer-product-actions"><button data-search="${encodeURIComponent([product.brandName, product.articleNumber, product.title || product.name].filter(Boolean).join(" "))}" class="primary">국내 검색</button></div>
    </div>
  </article>`).join("") : `<div class="empty">조건에 맞는 상품이 없습니다.</div>`;
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

async function processPopular(textValue) {
  const status = $("#popular-status");
  const normalized = String(textValue || "").trim();
  if (!normalized) return;
  if (popularProcessing) {
    status.className = "status";
    status.textContent = "이미 API 조회가 진행 중입니다.";
    return;
  }
  popularProcessing = true;
  $("#popular-apply").disabled = true;
  status.className = "status";
  status.textContent = "품번을 추출하고 POIZON API에서 자동 조회하고 있습니다…";
  try {
    const result = await window.aroundG.resolvePopular({
      text: normalized,
      limit: Number($("#popular-limit").value),
      unit: $("#popular-unit").value,
    });
    if (!result.ok) {
      status.className = "status error";
      status.textContent = result.error.message;
      return;
    }
    const storedProducts = result.products.map((product) => ({
      brand: "",
      name: product.name,
      articleNumber: product.articleNumber,
      poizonPrice: product.averagePrice,
      sales30d: product.sales30d,
      popularityRank: product.rank,
      spuId: product.globalSpuId || product.spuId || product.regionSpuId || "",
      poizonRegionSpuId: product.regionSpuId || "",
      poizonSkuIds: product.skuIdList || [],
      poizonResultCount: product.apiResultCount || 0,
      poizonApiMatched: product.apiMatched,
      source: product.source,
    }));
    await window.aroundG.bulkUpsert("products", storedProducts);
    const workflow = await window.aroundG.savePopularWorkflow(popularWorkflowInput(true));
    renderPopularDue(workflow.lastSyncAt, workflow.reminder);
    await refresh();
    status.className = result.matchedCount ? "status success" : "status error";
    status.textContent = `${result.products.length}개 품번 처리 · API 일치 ${result.matchedCount}개 · 미일치 ${result.failedCount}개`;
    renderExplorerResults("POIZON 인기상품", result.products.map((product) => ({
      ...product,
      hasSalesData: Number(product.sales30d) > 0,
    })));
  } catch (error) {
    showRuntimeError(error);
  } finally {
    popularProcessing = false;
    $("#popular-apply").disabled = false;
  }
}

$("#popular-apply").addEventListener("click", () => processPopular($("#popular-paste").value));
$("#popular-open").addEventListener("click", () => window.aroundG.openExternal(SELLER_RANK_URL));
$("#popular-clipboard").addEventListener("click", async () => {
  const clipboardText = await window.aroundG.readClipboardText();
  if (!clipboardText.trim()) {
    $("#popular-status").className = "status error";
    $("#popular-status").textContent = "클립보드가 비어 있습니다. 판매자센터 인기상품 표를 먼저 복사해 주세요.";
    return;
  }
  $("#popular-paste").value = clipboardText;
  await processPopular(clipboardText);
});
for (const selector of ["#popular-period", "#popular-compare", "#popular-unit", "#popular-limit", "#popular-reminder"]) {
  $(selector).addEventListener("change", async () => {
    const workflow = await window.aroundG.savePopularWorkflow(popularWorkflowInput(false));
    renderPopularDue(workflow.lastSyncAt, workflow.reminder);
  });
}
window.aroundG.onPopularProgress((progress) => {
  $("#popular-status").className = "status";
  $("#popular-status").textContent = `POIZON API 조회 ${progress.completed}/${progress.total} · 일치 ${progress.matched}개`;
});

$("#popular-paste").addEventListener("paste", (event) => {
  const pasted = event.clipboardData?.getData("text/plain") || "";
  if (!pasted) return;
  event.preventDefault();
  $("#popular-paste").value = pasted;
  processPopular(pasted);
});

const popularDropZone = $("#popular-drop-zone");
for (const eventName of ["dragenter", "dragover"]) {
  popularDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    popularDropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "dragend"]) {
  popularDropZone.addEventListener(eventName, () => popularDropZone.classList.remove("dragging"));
}
popularDropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  popularDropZone.classList.remove("dragging");
  const file = event.dataTransfer?.files?.[0];
  let dropped = event.dataTransfer?.getData("text/plain") || "";
  if (file) {
    if (!/\.(txt|csv|tsv)$/i.test(file.name) || file.size > 2_000_000) {
      $("#popular-status").className = "status error";
      $("#popular-status").textContent = "2MB 이하의 TXT·CSV·TSV 파일만 사용할 수 있습니다.";
      return;
    }
    dropped = await file.text();
  }
  if (!dropped.trim()) {
    $("#popular-status").className = "status error";
    $("#popular-status").textContent = "드롭된 내용에서 표 텍스트를 찾지 못했습니다.";
    return;
  }
  $("#popular-paste").value = dropped;
  processPopular(dropped);
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

$("#update-check").addEventListener("click", async () => {
  $("#update-status").className = "status";
  $("#update-status").textContent = "GitHub Releases에서 새 버전을 확인하고 있습니다…";
  const result = await window.aroundG.checkForUpdates();
  if (!result.ok) {
    $("#update-status").className = "status error";
    $("#update-status").textContent = result.message;
  }
});
$("#update-install").addEventListener("click", async () => {
  $("#update-install").disabled = true;
  const result = await window.aroundG.installUpdate();
  if (!result.ok) {
    $("#update-status").className = "status error";
    $("#update-status").textContent = result.message;
    $("#update-install").disabled = false;
  }
});
window.aroundG.onUpdateStatus((payload) => {
  $("#update-status").className = payload.status === "error" ? "status error" : "status success";
  $("#update-status").textContent = payload.message;
  $("#update-install").hidden = payload.status !== "available";
  if (payload.status === "downloaded") {
    $("#update-install").hidden = true;
    $("#update-status").textContent = `${payload.message} 앱을 종료하면 자동 설치됩니다.`;
  }
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
  $("#popular-period").value = popularWorkflow.period;
  $("#popular-compare").value = popularWorkflow.compare;
  $("#popular-unit").value = popularWorkflow.unit;
  $("#popular-limit").value = String(popularWorkflow.limit);
  $("#popular-reminder").checked = popularWorkflow.reminder;
  renderPopularDue(popularWorkflow.lastSyncAt, popularWorkflow.reminder);
  await refresh();
})();
