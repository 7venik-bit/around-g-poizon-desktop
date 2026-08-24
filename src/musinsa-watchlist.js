(() => {
  const api = window.aroundG;
  if (!api) return;
  const clampQty = (value) => Math.max(1, Math.min(20, Number(value) || 1));
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const parseMusinsaUrl = (raw) => {
    try {
      const url = new URL(String(raw || "").trim());
      const host = url.hostname.toLowerCase();
      if (!(host === "musinsa.com" || host.endsWith(".musinsa.com"))) return null;
      const match = url.pathname.match(/\/products?\/(\d+)/i) || url.pathname.match(/\/app\/goods\/(\d+)/i);
      return { url: url.href, goodsNo: match?.[1] || "" };
    } catch { return null; }
  };
  async function loadItems() {
    const snapshot = await api.snapshot();
    return (Array.isArray(snapshot?.orders) ? snapshot.orders : []).filter((item) => item?.source === "musinsa-watch");
  }
  async function saveItem(item) { await api.upsert("orders", item); await render(); }
  async function removeItem(id) { await api.remove("orders", id); await render(); }
  async function loadSizes(productUrl) {
    if (!api.checkMusinsaStock) return { ok: false, sizes: [] };
    return api.checkMusinsaStock({ url: productUrl }).catch(() => ({ ok: false, sizes: [] }));
  }
  function sizeOptions(item) {
    const sizes = Array.isArray(item.sizes) ? item.sizes : [];
    if (!sizes.length) return '<option value="">사이즈 확인 중/확인 불가</option>';
    return ['<option value="">구매 사이즈 선택</option>', ...sizes.map((size) => `<option value="${escapeHtml(size.label)}" ${item.selectedSize === size.label ? "selected" : ""} ${size.inStock === false ? "disabled" : ""}>${escapeHtml(size.label)}${size.inStock === false ? " · 품절" : " · 구매가능"}</option>`)].join("");
  }
  function ensureUi() {
    const orders = document.querySelector("#orders .panel");
    if (!orders || document.querySelector("#musinsa-watchlist")) return;
    const block = document.createElement("section");
    block.id = "musinsa-watchlist"; block.className = "musinsa-watchlist";
    block.innerHTML = `<div class="musinsa-watch-head"><div><small>LIVE MUSINSA WATCH</small><h3>무신사 실시간 주문 리스트</h3><p>상품 링크 등록 즉시 무신사의 실제 옵션/사이즈를 불러옵니다.</p></div></div><form id="musinsa-watch-add" class="musinsa-watch-add"><input id="musinsa-watch-url" type="url" inputmode="url" autocomplete="off" placeholder="https://www.musinsa.com/products/..." required><label>수량 <span class="musinsa-qty-editor"><button type="button" id="musinsa-new-minus">−</button><input id="musinsa-watch-qty" type="number" min="1" max="20" value="1"><button type="button" id="musinsa-new-plus">+</button></span></label><button class="primary" type="submit">링크 등록·사이즈 불러오기</button></form><div id="musinsa-watch-status" class="status"></div><div id="musinsa-watch-items" class="musinsa-watch-items"></div>`;
    const title = orders.querySelector(".panel-title"); if (title?.nextSibling) orders.insertBefore(block, title.nextSibling); else orders.prepend(block);
    const qty = block.querySelector("#musinsa-watch-qty");
    block.querySelector("#musinsa-new-minus").addEventListener("click", () => { qty.value = clampQty(Number(qty.value) - 1); });
    block.querySelector("#musinsa-new-plus").addEventListener("click", () => { qty.value = clampQty(Number(qty.value) + 1); });
    qty.addEventListener("change", () => { qty.value = clampQty(qty.value); });
    block.querySelector("#musinsa-watch-add").addEventListener("submit", async (event) => {
      event.preventDefault(); const parsed = parseMusinsaUrl(block.querySelector("#musinsa-watch-url").value); const status = block.querySelector("#musinsa-watch-status");
      if (!parsed) { status.textContent = "무신사 상품 링크를 확인해 주세요."; return; }
      const items = await loadItems(); const existing = items.find((item) => item.productUrl === parsed.url || (parsed.goodsNo && item.goodsNo === parsed.goodsNo));
      if (existing) { status.textContent = "이미 등록된 무신사 상품입니다."; return; }
      status.textContent = "무신사 상품의 실제 사이즈를 불러오는 중입니다…";
      const stock = await loadSizes(parsed.url); const now = new Date().toISOString();
      await saveItem({ id: `musinsa-watch-${parsed.goodsNo || Date.now()}-${Date.now()}`, source: "musinsa-watch", store: "무신사", productUrl: parsed.url, goodsNo: stock.productId || parsed.goodsNo, quantity: clampQty(qty.value), watchEnabled: true, purchaseStatus: "watching", sizes: Array.isArray(stock.sizes) ? stock.sizes : [], selectedSize: "", inStock: stock.ok ? stock.inStock === true : null, stockCheckOk: stock.ok === true, lastCheckedAt: stock.checkedAt || now, createdAt: now, updatedAt: now });
      block.querySelector("#musinsa-watch-url").value = ""; qty.value = 1;
      status.textContent = stock.ok ? `사이즈 ${stock.sizes.length}개를 불러와 주문 리스트에 등록했습니다.` : "상품은 등록했지만 사이즈를 불러오지 못했습니다. 감시 중 다시 확인합니다.";
    });
  }
  async function render() {
    ensureUi(); const host = document.querySelector("#musinsa-watch-items"); if (!host) return; const items = await loadItems();
    if (!items.length) { host.innerHTML = '<p class="empty">등록된 무신사 감시 상품이 없습니다.</p>'; return; }
    host.innerHTML = items.map((item) => `<article class="musinsa-watch-row" data-id="${escapeHtml(item.id)}"><div class="musinsa-watch-info"><strong>${item.goodsNo ? `상품 ${escapeHtml(item.goodsNo)}` : "무신사 상품"}</strong><a href="#" data-open="${escapeHtml(item.productUrl)}">${escapeHtml(item.productUrl)}</a><small>${item.watchEnabled !== false ? "실시간 감시 ON" : "감시 중지"} · ${item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleTimeString("ko-KR") : "재고 확인 전"}</small><select data-size="select">${sizeOptions(item)}</select></div><div class="musinsa-qty-editor" aria-label="구매 수량"><button type="button" data-qty="minus">−</button><strong>${clampQty(item.quantity)}</strong><button type="button" data-qty="plus">+</button></div><button type="button" data-refresh="true">사이즈 새로고침</button><button type="button" data-watch="toggle">${item.watchEnabled !== false ? "감시 중지" : "감시 시작"}</button><button type="button" class="danger" data-remove="true">삭제</button></article>`).join("");
    host.querySelectorAll(".musinsa-watch-row").forEach((row) => { const item = items.find((candidate) => candidate.id === row.dataset.id); if (!item) return;
      row.querySelector('[data-open]')?.addEventListener("click", (event) => { event.preventDefault(); api.openExternal(item.productUrl); });
      row.querySelector('[data-size="select"]')?.addEventListener("change", (event) => saveItem({ ...item, selectedSize: event.target.value, updatedAt: new Date().toISOString() }));
      row.querySelector('[data-refresh]')?.addEventListener("click", async () => { const stock = await loadSizes(item.productUrl); if (stock.ok) await saveItem({ ...item, sizes: stock.sizes, inStock: stock.inStock, stockCheckOk: true, lastCheckedAt: stock.checkedAt, updatedAt: new Date().toISOString() }); });
      row.querySelector('[data-qty="minus"]')?.addEventListener("click", () => saveItem({ ...item, quantity: clampQty(item.quantity - 1), updatedAt: new Date().toISOString() }));
      row.querySelector('[data-qty="plus"]')?.addEventListener("click", () => saveItem({ ...item, quantity: clampQty(item.quantity + 1), updatedAt: new Date().toISOString() }));
      row.querySelector('[data-watch="toggle"]')?.addEventListener("click", () => saveItem({ ...item, watchEnabled: item.watchEnabled === false, purchaseStatus: item.watchEnabled === false ? "watching" : "paused", updatedAt: new Date().toISOString() }));
      row.querySelector('[data-remove]')?.addEventListener("click", () => removeItem(item.id));
    });
  }
  window.addEventListener("aroundg:musinsa-stock-updated", () => render());
  window.addEventListener("DOMContentLoaded", render, { once: true });
  document.addEventListener("click", (event) => { if (event.target.closest?.('[data-view="orders"]')) setTimeout(render, 0); });
})();
