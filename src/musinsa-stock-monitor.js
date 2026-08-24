(() => {
  const INTERVAL_MS = 60_000;
  const timers = new Map();

  function findWatchlist() {
    try { return JSON.parse(localStorage.getItem("around-g-musinsa-watchlist-v1") || "[]"); } catch { return []; }
  }
  function saveWatchlist(items) {
    localStorage.setItem("around-g-musinsa-watchlist-v1", JSON.stringify(items));
  }
  async function check(item) {
    if (!window.aroundG?.checkMusinsaStock || !item?.url) return;
    const result = await window.aroundG.checkMusinsaStock({ url: item.url }).catch(() => null);
    const items = findWatchlist();
    const current = items.find((entry) => entry.id === item.id);
    if (!current || !result) return;
    current.lastCheckedAt = result.checkedAt || new Date().toISOString();
    current.stockCheckOk = result.ok === true;
    current.inStock = result.ok ? result.inStock === true : null;
    current.sizes = Array.isArray(result.sizes) ? result.sizes : [];
    current.productId = result.productId || current.productId || "";
    current.status = !result.ok ? "재고 확인 실패" : result.inStock ? "재고 있음" : "품절";
    saveWatchlist(items);
    window.dispatchEvent(new CustomEvent("aroundg:musinsa-stock-updated", { detail: { id: item.id, result } }));
  }
  function sync() {
    const active = findWatchlist().filter((item) => item.watching === true);
    const activeIds = new Set(active.map((item) => item.id));
    for (const [id, timer] of timers) if (!activeIds.has(id)) { clearInterval(timer); timers.delete(id); }
    for (const item of active) {
      if (timers.has(item.id)) continue;
      check(item);
      timers.set(item.id, setInterval(() => check(item), INTERVAL_MS));
    }
  }
  window.addEventListener("storage", sync);
  window.addEventListener("aroundg:musinsa-watchlist-changed", sync);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });
  setInterval(sync, 5_000);
  sync();
})();
