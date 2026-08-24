(() => {
  const INTERVAL_MS = 60_000;
  const timers = new Map();
  const api = window.aroundG;
  if (!api) return;

  async function findWatchlist() {
    const snapshot = await api.snapshot().catch(() => null);
    return (Array.isArray(snapshot?.orders) ? snapshot.orders : [])
      .filter((item) => item?.source === "musinsa-watch");
  }

  async function saveItem(item) {
    await api.upsert("orders", item);
  }

  async function check(item) {
    if (!api.checkMusinsaStock || !item?.productUrl) return;
    const result = await api.checkMusinsaStock({ url: item.productUrl }).catch(() => null);
    if (!result) return;

    const currentItems = await findWatchlist();
    const current = currentItems.find((entry) => entry.id === item.id);
    if (!current) return;

    const sizes = Array.isArray(result.sizes) ? result.sizes : [];
    const selectedSize = String(current.selectedSize || "").trim();
    const selectedOption = selectedSize
      ? sizes.find((size) => String(size?.label || "").trim() === selectedSize)
      : null;
    const selectedSizeInStock = selectedOption ? selectedOption.inStock === true : false;
    const now = result.checkedAt || new Date().toISOString();

    const next = {
      ...current,
      lastCheckedAt: now,
      stockCheckOk: result.ok === true,
      inStock: result.ok ? result.inStock === true : null,
      sizes,
      goodsNo: result.productId || current.goodsNo || "",
      selectedSizeInStock: selectedSize ? selectedSizeInStock : null,
      purchaseStatus: !result.ok
        ? "stock_check_failed"
        : !selectedSize
          ? "size_required"
          : selectedSizeInStock
            ? "ready_to_purchase"
            : "watching",
      updatedAt: now,
    };

    if (selectedSize && selectedSizeInStock && api.validateMusinsaAutoPurchase) {
      const validation = await api.validateMusinsaAutoPurchase({
        articleNumber: next.goodsNo,
        size: selectedSize,
        quantity: next.quantity,
        maxPrice: next.maxPrice,
        currentPrice: next.currentPrice,
      }).catch(() => null);
      if (validation) {
        next.autoPurchaseValidation = validation;
        next.purchaseStatus = validation.ok ? "purchase_conditions_met" : "stock_available_conditions_pending";
      }
    }

    await saveItem(next);
    window.dispatchEvent(new CustomEvent("aroundg:musinsa-stock-updated", {
      detail: { id: item.id, result, selectedSize, selectedSizeInStock, purchaseStatus: next.purchaseStatus },
    }));
  }

  async function sync() {
    const items = await findWatchlist();
    const active = items.filter((item) => item.watchEnabled !== false);
    const activeIds = new Set(active.map((item) => item.id));

    for (const [id, timer] of timers) {
      if (!activeIds.has(id)) {
        clearInterval(timer);
        timers.delete(id);
      }
    }

    for (const item of active) {
      if (timers.has(item.id)) continue;
      void check(item);
      timers.set(item.id, setInterval(() => void check(item), INTERVAL_MS));
    }
  }

  window.addEventListener("aroundg:musinsa-watchlist-changed", () => void sync());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void sync(); });
  setInterval(() => void sync(), 5_000);
  void sync();
})();
