const $ = (selector) => document.querySelector(selector);
const money = (value) => `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
let state = { products: [], ledger: [], orders: [], favorites: [] };
let entryCollection = "products";
let explorerMeta = { brands: [], categories: [] };
let selectedBrandId = null;
let selectedCategory = "전체";
let explorerProducts = [];

function text(value) {
  const span = document.createElement("span");
  span.textContent = value ?? "";
  return span.innerHTML;
}

function renderProducts() {
  const body = $("#product-rows");
  body.innerHTML = state.products.map((row) => `<tr>
    <td><strong>${text(row.brand)}</strong></td><td>${text(row.name)}</td>
    <td><code>${text(row.articleNumber)}</code></td><td><code>${text(row.spuId)}</code></td>
    <td>${money(row.poizonPrice)}</td><td>${money(row.domesticPrice)}</td>
    <td><button data-domestic="${row.id}">국내 가격 조회</button> <button data-search="${encodeURIComponent([row.brand,row.articleNumber,row.name].filter(Boolean).join(" "))}">네이버 열기</button> <button data-remove="products:${row.id}">삭제</button></td>
  </tr>`).join("");
  $("#product-empty").hidden = state.products.length > 0;
}

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
  explorerProducts = products;
  $("#explorer-results").hidden = false;
  $("#explorer-result-title").textContent = title;
  $("#explorer-result-count").textContent = `${products.length.toLocaleString("ko-KR")}개 표시`;
  $("#explorer-product-grid").innerHTML = products.length ? products.map((product, index) => `<article class="explorer-product">
    ${product.logoUrl ? `<img src="${text(product.logoUrl)}" alt="">` : ""}
    <div class="explorer-product-body">
      <span class="badge">${text(product.categoryGroup || "인기상품")}</span>
      ${product.hasSalesData ? `<span class="badge">30일 ${Number(product.sales30d).toLocaleString("ko-KR")}건</span>` : `<span class="badge muted">판매량 미결합</span>`}
      <h3>${text(product.title || product.name)}</h3>
      <p>${text(product.brandName || product.brand || "")}</p>
      <div class="explorer-product-meta"><code>${text(product.articleNumber || "")}</code><span>${product.averagePrice || product.minPrice?.value ? money(product.averagePrice || product.minPrice.value) : ""}</span></div>
      <div class="explorer-product-actions"><button data-explorer-add="${index}" class="primary">후보에 저장</button><button data-search="${encodeURIComponent([product.brandName, product.articleNumber, product.title || product.name].filter(Boolean).join(" "))}">국내 검색</button></div>
    </div>
  </article>`).join("") : `<div class="empty">조건에 맞는 상품이 없습니다.</div>`;
  $("#explorer-results").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function refresh() {
  state = await window.aroundG.snapshot();
  renderProducts();
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
  const domesticId = event.target.dataset.domestic;
  if (domesticId) {
    const product = state.products.find((item) => item.id === domesticId);
    if (!product) return;
    const status = $("#query-status");
    const queryText = [product.brand, product.articleNumber, product.name].filter(Boolean).join(" ");
    status.className = "status";
    status.textContent = "무신사·SSG·코오롱몰 가격을 조회하고 있습니다…";
    try {
      const result = await window.aroundG.queryDomestic({ query: queryText });
      const priced = result.products.filter((item) => Number(item.price) > 0);
      const lowest = priced.length ? Math.min(...priced.map((item) => Number(item.price))) : 0;
      const sourceText = result.sources.map((source) => `${source.store} ${source.ok ? `${source.count}건` : "연결 실패"}`).join(" · ");
      if (lowest) {
        await window.aroundG.upsert("products", {
          ...product,
          domesticPrice: lowest,
          domesticCheckedAt: new Date().toISOString(),
          domesticSources: result.sources
        });
        await refresh();
        status.className = "status success";
        status.textContent = `국내 최저가 ${money(lowest)} · ${sourceText}`;
      } else {
        status.className = result.sources.some((source) => source.ok) ? "status" : "status error";
        status.textContent = `가격 결과가 없습니다. ${sourceText}`;
      }
    } catch (error) {
      status.className = "status error";
      status.textContent = `국내 가격 조회 실패: ${error.message}`;
    }
  }
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
  const explorerAdd = event.target.dataset.explorerAdd;
  if (explorerAdd !== undefined) {
    const product = explorerProducts[Number(explorerAdd)];
    if (!product) return;
    await window.aroundG.upsert("products", {
      brand: product.brandName || product.brand || "",
      name: product.title || product.name || "",
      articleNumber: product.articleNumber || "",
      spuId: product.globalSpuId || product.spuId || product.regionSpuId || "",
      poizonPrice: product.averagePrice || product.minPrice?.value || 0,
      sales30d: product.sales30d || 0,
      category: product.categoryGroup || product.categoryName || "",
      source: product.source || "poizon-explorer",
    });
    await refresh();
    event.target.textContent = "저장됨";
    event.target.disabled = true;
  }
});

document.querySelectorAll(".explorer-mode").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".explorer-mode,.explorer-panel").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  $(`#explorer-${button.dataset.explorer}`).classList.add("active");
}));

$("#brand-filter").addEventListener("input", (event) => renderBrandCards(event.target.value));

$("#popular-apply").addEventListener("click", async () => {
  const status = $("#popular-status");
  const result = await window.aroundG.parsePopular({ text: $("#popular-paste").value });
  if (!result.ok) {
    status.className = "status error";
    status.textContent = "표의 헤더와 상품 행을 함께 붙여넣어 주세요.";
    return;
  }
  for (const product of result.products) {
    await window.aroundG.upsert("products", {
      brand: "",
      name: product.name,
      articleNumber: product.articleNumber,
      poizonPrice: product.averagePrice,
      sales30d: product.sales30d,
      popularityRank: product.rank,
      source: product.source,
    });
  }
  await refresh();
  status.className = "status success";
  status.textContent = `${result.products.length}개 인기상품을 저장하고 판매량 데이터를 결합했습니다.`;
  renderExplorerResults("POIZON 인기상품", result.products.map((product) => ({ ...product, hasSalesData: true })));
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

$("#query-button").addEventListener("click", async () => {
  const value = $("#query-value").value.trim();
  if (!value) return;
  const status = $("#query-status");
  status.className = "status";
  status.textContent = "POIZON 조회 중…";
  const result = await window.aroundG.queryPoizon({ mode: $("#query-mode").value, value });
  if (!result.ok) {
    status.className = "status error";
    status.textContent = `${result.error.message} (${result.error.code})`;
    return;
  }
  status.className = "status success";
  const candidates = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.data?.list) ? result.data.list : [result.data?.data || result.data || {}];
  const payload = candidates[0] || {};
  status.textContent = `조회가 완료되었습니다. ${candidates.length}개 결과 중 첫 결과를 로컬 상품 목록에 저장했습니다.`;
  await window.aroundG.upsert("products", {
    brand: payload.brandName || payload.brand || "",
    name: payload.title || payload.productName || value,
    articleNumber: payload.articleNumber || ($("#query-mode").value === "article" ? value : ""),
    spuId: payload.spuId || payload.globalSpuId || payload.regionSpuId || ($("#query-mode").value === "spu" ? value : ""),
    poizonPrice: payload.price || payload.salePrice || 0,
    poizonResultCount: candidates.length,
    poizonRegionSpuId: payload.regionSpuId || "",
    poizonSkuIds: payload.skuIdList || [],
    source: "poizon-api"
  });
  await refresh();
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
  $("#dialog-title").textContent = collection === "products" ? "상품 직접 추가" : collection === "ledger" ? "장부 추가" : "주문 추가";
  ["#entry-brand","#entry-name","#entry-article","#entry-price"].forEach((selector) => $(selector).value = "");
  $("#entry-dialog").showModal();
}
$("#add-product").addEventListener("click", () => openEntry("products"));
document.querySelectorAll(".add-record").forEach((button) => button.addEventListener("click", () => openEntry(button.dataset.collection)));
$("#entry-save").addEventListener("click", async (event) => {
  event.preventDefault();
  if (!$("#entry-name").value.trim()) return;
  const base = { brand: $("#entry-brand").value.trim(), name: $("#entry-name").value.trim(), articleNumber: $("#entry-article").value.trim() };
  if (entryCollection === "products") Object.assign(base, { poizonPrice: Number($("#entry-price").value || 0), source: "manual" });
  else base.price = Number($("#entry-price").value || 0);
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
  await refresh();
})();
