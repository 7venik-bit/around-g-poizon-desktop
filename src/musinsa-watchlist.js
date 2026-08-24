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

  async function saveItem(item) {
    await api.upsert("orders", item);
    await render();
  }

  async function removeItem(id) {
    await api.remove("orders", id);
    await render();
  }

  function ensureUi() {
    const orders = document.querySelector("#orders .panel");
    if (!orders || document.querySelector("#musinsa-watchlist")) return;
    const block = document.createElement("section");
    block.id = "musinsa-watchlist";
    block.className = "musinsa-watchlist";
    block.innerHTML = `
      <div class="musinsa-watch-head">
        <div><small>LIVE MUSINSA WATCH</small><h3>무신사 실시간 주문 리스트</h3><p>상품 링크를 등록하고 구매 수량을 정한 뒤 재고 감시 대상으로 사용할 수 있습니다.</p></div>
      </div>
      <form id="musinsa-watch-add" class="musinsa-watch-add">
        <input id="musinsa-watch-url" type="url" inputmode="url" autocomplete="off" placeholder="https://www.musinsa.com/products/..." required>
        <label>수량 <span class="musinsa-qty-editor"><button type="button" id="musinsa-new-minus">−</button><input id="musinsa-watch-qty" type="number" min="1" max="20" value="1"><button type="button" id="musinsa-new-plus">+</button></span></label>
        <button class="primary" type="submit">주문 리스트 등록</button>
      </form>
      <div id="musinsa-watch-status" class="status"></div>
      <div id="musinsa-watch-items" class="musinsa-watch-items"></div>`;
    const title = orders.querySelector(".panel-title");
    if (title?.nextSibling) orders.insertBefore(block, title.nextSibling); else orders.prepend(block);

    const qty = block.querySelector("#musinsa-watch-qty");
    block.querySelector("#musinsa-new-minus").addEventListener("click", () => { qty.value = clampQty(Number(qty.value) - 1); });
    block.querySelector("#musinsa-new-plus").addEventListener("click", () => { qty.value = clampQty(Number(qty.value) + 1); });
    qty.addEventListener("change", () => { qty.value = clampQty(qty.value); });
    block.querySelector("#musinsa-watch-add").addEventListener("submit", async (event) => {
      event.preventDefault();
      const parsed = parseMusinsaUrl(block.querySelector("#musinsa-watch-url").value);
      const status = block.querySelector("#musinsa-watch-status");
      if (!parsed) { status.textContent = "무신사 상품 링크를 확인해 주세요."; return; }
      const items = await loadItems();
      const existing = items.find((item) => item.productUrl === parsed.url || (parsed.goodsNo && item.goodsNo === parsed.goodsNo));
      if (existing) { status.textContent = "이미 등록된 무신사 상품입니다."; return; }
      const now = new Date().toISOString();
      await saveItem({
        id: `musinsa-watch-${parsed.goodsNo || Date.now()}-${Date.now()}`,
        source: "musinsa-watch",
        store: "무신사",
        productUrl: parsed.url,
        goodsNo: parsed.goodsNo,
        quantity: clampQty(qty.value),
        watchEnabled: true,
        purchaseStatus: "watching",
        createdAt: now,
        updatedAt: now,
      });
      block.querySelector("#musinsa-watch-url").value = "";
      qty.value = 1;
      status.textContent = "무신사 상품을 주문 리스트에 등록했습니다.";
    });
  }

  async function render() {
    ensureUi();
    const host = document.querySelector("#musinsa-watch-items");
    if (!host) return;
    const items = await loadItems();
    if (!items.length) {
      host.innerHTML = '<p class="empty">등록된 무신사 감시 상품이 없습니다.</p>';
      return;
    }
    host.innerHTML = items.map((item) => `
      <article class="musinsa-watch-row" data-id="${escapeHtml(item.id)}">
        <div class="musinsa-watch-info"><strong>${item.goodsNo ? `상품 ${escapeHtml(item.goodsNo)}` : "무신사 상품"}</strong><a href="#" data-open="${escapeHtml(item.productUrl)}">${escapeHtml(item.productUrl)}</a><small>${item.watchEnabled !== false ? "실시간 감시 ON" : "감시 중지"}</small></div>
        <div class="musinsa-qty-editor" aria-label="구매 수량"><button type="button" data-qty="minus">−</button><strong>${clampQty(item.quantity)}</strong><button type="button" data-qty="plus">+</button></div>
        <button type="button" data-watch="toggle">${item.watchEnabled !== false ? "감시 중지" : "감시 시작"}</button>
        <button type="button" class="danger" data-remove="true">삭제</button>
      </article>`).join("");

    host.querySelectorAll(".musinsa-watch-row").forEach((row) => {
      const item = items.find((candidate) => candidate.id === row.dataset.id);
      if (!item) return;
      row.querySelector('[data-open]')?.addEventListener("click", (event) => { event.preventDefault(); api.openExternal(item.productUrl); });
      row.querySelector('[data-qty="minus"]')?.addEventListener("click", () => saveItem({ ...item, quantity: clampQty(item.quantity - 1), updatedAt: new Date().toISOString() }));
      row.querySelector('[data-qty="plus"]')?.addEventListener("click", () => saveItem({ ...item, quantity: clampQty(item.quantity + 1), updatedAt: new Date().toISOString() }));
      row.querySelector('[data-watch="toggle"]')?.addEventListener("click", () => saveItem({ ...item, watchEnabled: item.watchEnabled === false, purchaseStatus: item.watchEnabled === false ? "watching" : "paused", updatedAt: new Date().toISOString() }));
      row.querySelector('[data-remove]')?.addEventListener("click", () => removeItem(item.id));
    });
  }

  window.addEventListener("DOMContentLoaded", render, { once: true });
  document.addEventListener("click", (event) => {
    if (event.target.closest?.('[data-view="orders"]')) setTimeout(render, 0);
  });
})();
