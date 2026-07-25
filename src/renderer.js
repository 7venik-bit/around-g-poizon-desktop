const $ = (selector) => document.querySelector(selector);
const money = (value) => `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
let state = { products: [], ledger: [], orders: [], favorites: [] };
let entryCollection = "products";

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
    <td><button data-search="${encodeURIComponent([row.brand,row.articleNumber,row.name].filter(Boolean).join(" "))}">국내 검색</button> <button data-remove="products:${row.id}">삭제</button></td>
  </tr>`).join("");
  $("#product-empty").hidden = state.products.length > 0;
}

function renderRecords(collection) {
  const host = $(`#${collection}-list`);
  host.innerHTML = state[collection].length
    ? state[collection].map((row) => `<div class="record"><div><strong>${text(row.name)}</strong><small>${text(row.brand)} · ${text(row.articleNumber)}</small></div><div>${money(row.price)} <button data-remove="${collection}:${row.id}">삭제</button></div></div>`).join("")
    : `<div class="empty">저장된 항목이 없습니다.</div>`;
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
  status.textContent = "조회가 완료되었습니다. 결과를 로컬 상품 목록에 저장했습니다.";
  const payload = result.data?.data || result.data || {};
  await window.aroundG.upsert("products", {
    brand: payload.brandName || payload.brand || "",
    name: payload.title || payload.productName || value,
    articleNumber: payload.articleNumber || ($("#query-mode").value === "article" ? value : ""),
    spuId: payload.spuId || ($("#query-mode").value === "spu" ? value : ""),
    poizonPrice: payload.price || payload.salePrice || 0,
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
  const config = await window.aroundG.getConfig();
  $("#app-key").value = config.appKey;
  $("#api-base-url").value = config.apiBaseUrl;
  $("#app-secret").placeholder = config.hasAppSecret ? "저장됨 · 변경할 때만 입력" : "필수";
  $("#access-token").placeholder = config.hasAccessToken ? "저장됨 · 변경할 때만 입력" : "선택 사항";
  await refresh();
})();
