import { filterInventoryProducts, hasSalesMode, salesPair } from "../services/inventory-filter.mjs";

const params = new URLSearchParams(location.search);
const filePath = params.get("path") || "";
const requestedBrand = params.get("brand") || "";
const state = {
  products: [],
  sourceProducts: [],
  selected: new Set(),
  searching: false,
  stopped: false,
  salesMode: "recent30",
  sourceRows: 0,
  filters: { localMinimum: 30, localMaximum: null, chinaMinimum: 30, chinaMaximum: null },
};
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const keyOf = (product, index) => String(product.spuId || product.articleNumber || `row-${index}`);
let workGeneration = 0;

function clearWorkScreen(message = "이전 작업 화면을 지웠습니다. 원본 Excel 파일은 보존됩니다.") {
  workGeneration += 1;
  state.products = [];
  state.sourceProducts = [];
  state.sourceRows = 0;
  state.selected.clear();
  state.searching = false;
  state.stopped = true;
  $("#products").innerHTML = "";
  $("#filter-summary").hidden = true;
  $("#sales-filter-controls").hidden = true;
  $("#progress").hidden = true;
  $("#source").textContent = "";
  $("#title").textContent = "국내 재고·사이즈 확인";
  $("#status").textContent = message;
  updateSelection();
}

function salesData(product) {
  return salesPair(product, state.salesMode);
}

function qualifyingVariants(product) {
  const variants = Array.isArray(product.variants) && product.variants.length
    ? product.variants
    : [product];
  return variants.filter((variant) => {
    const sales = salesData(variant);
    return sales.local >= state.filters.localMinimum
      && (state.filters.localMaximum === null || sales.local <= state.filters.localMaximum)
      && sales.china >= state.filters.chinaMinimum
      && (state.filters.chinaMaximum === null || sales.china <= state.filters.chinaMaximum);
  });
}

function numberFilter(selector, fallback = null) {
  const value = $(selector).value.trim();
  if (value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function applySalesFilters() {
  state.filters = {
    localMinimum: numberFilter("#local-min", 0),
    localMaximum: numberFilter("#local-max"),
    chinaMinimum: numberFilter("#china-min", 0),
    chinaMaximum: numberFilter("#china-max"),
  };
  state.products = filterInventoryProducts(state.sourceProducts, { mode: state.salesMode, ...state.filters });
  state.selected.clear();
  const matchedRows = state.products.reduce((sum, product) => sum + product.filteredVariants.length, 0);
  const metric = salesPair({}, state.salesMode);
  const range = (minimum, maximum) => maximum === null ? `${minimum.toLocaleString("ko-KR")}건 이상` : `${minimum.toLocaleString("ko-KR")}~${maximum.toLocaleString("ko-KR")}건`;
  $("#sales-filter-label").innerHTML = `<b>${esc(metric.localLabel)} ${range(state.filters.localMinimum, state.filters.localMaximum)}</b> · <b>${esc(metric.chinaLabel)} ${range(state.filters.chinaMinimum, state.filters.chinaMaximum)}</b>`;
  $("#filter-count").textContent = `원본 상품 ${state.sourceProducts.length.toLocaleString()}개 · 옵션 ${state.sourceRows.toLocaleString()}행 → 조건 충족 상품 ${state.products.length.toLocaleString()}개 · 옵션 ${matchedRows.toLocaleString()}행`;
  $("#status").textContent = state.products.length
    ? `${metric.localLabel}과 ${metric.chinaLabel}을 같은 옵션 행에서 필터링했습니다.`
    : "현재 판매량 범위에 맞는 옵션이 없습니다. 최소·최대값을 조정해 주세요.";
  render();
}

function metricText(rawValue, numericValue) {
  const raw = String(rawValue ?? "").trim();
  return raw || Number(numericValue || 0).toLocaleString("ko-KR");
}

function updateSelection() {
  $("#selected-count").textContent = `${state.selected.size.toLocaleString()}개 선택`;
  $("#search-selected").disabled = !state.selected.size || state.searching;
  $("#select-all").checked = !!state.products.length && state.selected.size === state.products.length;
  $("#select-all").indeterminate = state.selected.size > 0 && state.selected.size < state.products.length;
}

function progress(done, total) {
  const percent = total ? Math.round(done / total * 100) : 0;
  $("#progress").hidden = false;
  $("#progress span").style.width = `${percent}%`;
  $("#progress b").textContent = `${percent}%`;
}

function render() {
  $("#products").innerHTML = state.products.map((product, index) => {
    const key = keyOf(product, index);
    const image = product.logoUrl ? `<img src="${esc(product.logoUrl)}" alt="">` : "<div></div>";
    const variants = Array.isArray(product.filteredVariants) ? product.filteredVariants : qualifyingVariants(product);
    const variantRows = variants.map((variant) => {
      const sales = salesData(variant);
      const localRaw = state.salesMode === "total" ? variant.localTotalSalesRaw : variant.localSales30dRaw;
      const chinaRaw = state.salesMode === "total" ? variant.totalSalesRaw : variant.sales30dRaw;
      const option = variant.option || (variant.skuId ? `SKU ${variant.skuId}` : `원본 ${variant.sourceRow || "-"}행`);
      return `<div class="variant-row">
        <span>${esc(option)}</span>
        <b>${esc(sales.localLabel)} ${esc(metricText(localRaw, sales.local))}건</b>
        <b>${esc(sales.chinaLabel)} ${esc(metricText(chinaRaw, sales.china))}건</b>
      </div>`;
    }).join("");
    return `<article class="product" data-key="${esc(key)}" data-index="${index}">
      <div class="head">
        <input class="check" type="checkbox" ${state.selected.has(key) ? "checked" : ""}>
        ${image}
        <div><h2>${esc(product.title || product.apiTitle || product.articleNumber || "상품명 없음")}</h2>
          <div class="meta"><span>상품번호 ${esc(product.articleNumber || "-")}</span><span>SPU ID ${esc(product.spuId || "-")}</span><span>${esc(product.brandName || requestedBrand || "-")}</span><span>${esc(product.categoryName || "")}</span><strong>조건 충족 옵션 ${variants.length.toLocaleString("ko-KR")}개</strong></div>
        </div>
        <button class="search-one">국내 재고·사이즈 검색</button>
      </div><div class="source-variants">${variantRows}</div><div class="results"></div>
    </article>`;
  }).join("");
  updateSelection();
}

function showResults(article, data) {
  const candidates = Array.isArray(data?.products) ? data.products : [];
  if (!candidates.length) {
    article.querySelector(".results").innerHTML = `<div class="empty">일치하는 국내 판매 상품을 찾지 못했습니다.</div>`;
    return;
  }
  article.querySelector(".results").innerHTML = candidates.map((item) => {
    const sizes = (item.sizes || []).map((size) => {
      const value = typeof size === "object" ? size.label || size.size : size;
      const unavailable = typeof size === "object" && size.inStock === false;
      return `<span class="size ${unavailable ? "none" : ""}">${esc(value)}</span>`;
    }).join("");
    const url = item.url || item.link || "";
    const stockClass = item.inStock === true ? "" : item.inStock === false ? "none" : "unknown";
    const stockLabel = item.inStock === true ? "재고 있음" : item.inStock === false ? "품절" : "확인 필요";
    return `<div class="candidate">
      <span class="store">${esc(item.store || item.mallName || item.source || "국내 판매처")}</span>
      <strong>${esc(item.title || item.name || item.articleNumber || "검색 결과")}</strong>
      <span class="stock ${stockClass}"${stockClass === "unknown" ? ' style="color:#8b590e;background:#fff0d8"' : ""}>${stockLabel}</span>
      <div class="sizes">${sizes || "<span>옵션 확인 필요</span>"}</div>
      ${url ? `<button class="open-link" data-url="${esc(url)}">${item.inStock === true ? "구매" : "확인"}</button>` : ""}
    </div>`;
  }).join("");
}

async function searchOne(index) {
  const product = state.products[index];
  const article = $(`.product[data-index="${index}"]`);
  if (!product || !article) return;
  const button = article.querySelector(".search-one");
  button.disabled = true;
  button.textContent = "검색 중…";
  article.querySelector(".results").innerHTML = "";
  const brand = product.brandName || product.brand || requestedBrand || "";
  const title = product.apiTitle || product.title || product.name || "";
  const result = await window.aroundG.searchDomestic({
    // 인기상품 검색과 동일하게 브랜드 → 상품번호 → 상품명 순서로 검색어를 구성한다.
    query: [brand, product.articleNumber, title].filter(Boolean).join(" "),
    articleNumber: product.articleNumber || "",
    brand,
    title,
    imageUrl: product.logoUrl || "",
    // 인기상품의 선택 검색과 동일하게 각 검색 경로의 실제 결과 수도 확인한다.
    verifyLinkCounts: true,
  });
  if (result?.ok) showResults(article, result.data);
  else article.querySelector(".results").innerHTML = `<div class="empty">${esc(result?.message || "검색에 실패했습니다.")}</div>`;
  button.disabled = false;
  button.textContent = "국내 재고·사이즈 다시 검색";
}

async function searchSelected() {
  if (state.searching) return;
  state.searching = true;
  state.stopped = false;
  $("#stop").hidden = false;
  updateSelection();
  const indexes = state.products.map((p, i) => ({ key: keyOf(p, i), i })).filter((row) => state.selected.has(row.key)).map((row) => row.i);
  let completed = 0;
  for (const index of indexes) {
    if (state.stopped) break;
    $("#status").textContent = `${completed + 1}/${indexes.length} 상품의 국내 재고와 사이즈를 확인하는 중입니다.`;
    await searchOne(index);
    completed += 1;
    progress(completed, indexes.length);
  }
  state.searching = false;
  $("#stop").hidden = true;
  $("#status").textContent = state.stopped ? `검색 중지 · ${completed}개 완료` : `${completed}개 상품 검색을 완료했습니다.`;
  updateSelection();
}

$("#products").addEventListener("change", (event) => {
  if (!event.target.classList.contains("check")) return;
  const key = event.target.closest(".product").dataset.key;
  if (event.target.checked) state.selected.add(key); else state.selected.delete(key);
  updateSelection();
});
$("#products").addEventListener("click", async (event) => {
  const article = event.target.closest(".product");
  if (event.target.closest(".search-one") && article) await searchOne(Number(article.dataset.index));
  const link = event.target.closest(".open-link");
  if (link) await window.aroundG.openExternal(link.dataset.url);
});
$("#select-all").addEventListener("change", (event) => {
  state.selected.clear();
  if (event.target.checked) state.products.forEach((product, index) => state.selected.add(keyOf(product, index)));
  render();
});
$("#search-selected").addEventListener("click", searchSelected);
$("#stop").addEventListener("click", () => { state.stopped = true; });
$("#clear-work").addEventListener("click", async () => {
  const button = $("#clear-work");
  button.disabled = true;
  clearWorkScreen();
  const result = await window.aroundG?.clearBrandWorkHistory?.();
  if (result?.ok === false) {
    $("#status").textContent = result.message || "작업 기록을 지우지 못했습니다.";
  }
  button.disabled = false;
});
window.aroundG.onBrandWorkHistoryCleared?.(() => clearWorkScreen());
$("#sales-filter-controls").addEventListener("input", (event) => {
  if (event.target.id === "sales-mode") state.salesMode = event.target.value;
  applySalesFilters();
});
$("#reset-filter").addEventListener("click", () => {
  $("#local-min").value = "30";
  $("#local-max").value = "";
  $("#china-min").value = "30";
  $("#china-max").value = "";
  applySalesFilters();
});
$("#open-excel").addEventListener("click", () => window.aroundG.openOriginalExcelFile(filePath));

(async () => {
  const generation = ++workGeneration;
  $("#source").textContent = filePath;
  const result = await window.aroundG.importBrandExcelFromPath(filePath, requestedBrand);
  if (generation !== workGeneration) return;
  if (!result?.ok) {
    $("#status").textContent = result?.message || "Excel 상품 데이터를 불러오지 못했습니다.";
    return;
  }
  state.sourceProducts = result.products || [];
  state.sourceRows = Number(result.sourceRows || 0);
  const hasRecentPair = hasSalesMode(state.sourceProducts, "recent30");
  const hasTotalPair = hasSalesMode(state.sourceProducts, "total");
  state.salesMode = hasRecentPair ? "recent30" : hasTotalPair ? "total" : "missing";
  state.products = state.salesMode === "missing" ? [] : filterInventoryProducts(state.sourceProducts, { mode: state.salesMode, ...state.filters });
  const brand = requestedBrand || state.sourceProducts.find((item) => item.brandName)?.brandName || "POIZON";
  $("#title").textContent = `${brand} 국내 재고·사이즈 확인`;
  $("#filter-summary").hidden = false;
  $("#sales-filter-controls").hidden = state.salesMode === "missing";
  $("#sales-mode").value = state.salesMode === "missing" ? "recent30" : state.salesMode;
  $("#sales-mode option[value='recent30']").disabled = !hasRecentPair;
  $("#sales-mode option[value='total']").disabled = !hasTotalPair;
  $("#sales-filter-label").innerHTML = state.salesMode === "total"
    ? "<b>중국 총 판매량 30건 이상</b> · <b>현지 판매자 총 판매량 30건 이상</b>"
    : "<b>최근 30일 판매량 30건 이상</b> · <b>현지 판매자 최근 30일 판매량 30건 이상</b>";
  const matchedRows = state.products.reduce((sum, product) => sum + product.filteredVariants.length, 0);
  $("#filter-count").textContent = `원본 상품 ${state.sourceProducts.length.toLocaleString()}개 · 옵션 ${state.sourceRows.toLocaleString()}행 → 조건 충족 상품 ${state.products.length.toLocaleString()}개 · 옵션 ${matchedRows.toLocaleString()}행`;
  if (state.salesMode === "missing") {
    const missing = [
      !hasRecentPair ? "최근 30일 판매량 열 묶음" : "",
      !hasTotalPair ? "총 판매량 열 묶음" : "",
    ].filter(Boolean).join(", ");
    $("#status").textContent = `Excel에서 사용할 판매량 열을 찾지 못했습니다: ${missing}. POIZON 상품검색 전체 내보내기 파일인지 확인해 주세요.`;
  } else if (state.salesMode === "total") {
    $("#status").textContent = state.products.length
      ? "POIZON 전체 내보내기의 중국 총 판매량과 현지 판매자 총 판매량 열을 정상 인식해 각각 30건 이상으로 필터링했습니다."
      : "중국 총 판매량과 현지 판매자 총 판매량이 모두 30건 이상인 상품이 없습니다.";
  } else if (!state.products.length) {
    $("#status").textContent = "두 판매량이 같은 원본 옵션 행에서 모두 30건 이상인 상품이 없습니다.";
  } else {
    $("#status").textContent = `원본 옵션 행을 먼저 필터링했습니다. 판매량 숫자는 같은 사이즈 행의 값을 그대로 표시하며 서로 다른 옵션의 최대값을 섞지 않습니다.`;
  }
  render();
})();
