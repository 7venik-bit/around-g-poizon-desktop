(() => {
  // Per-row domestic size filter for the Excel preview result column.
  // Keeps the collected result intact and only narrows the rendered detail to
  // products that carry the chosen sizes. State is session-only.
  const SIZE_SETS = {
    shoes: ["220", "225", "230", "235", "240", "245", "250", "255", "260",
      "265", "270", "275", "280", "285", "290", "295", "300"],
    clothing: ["XS", "S", "M", "L", "XL", "2XL", "3XL",
      "85", "90", "95", "100", "105", "110", "115"],
    headwear: ["F", "FREE", "S/M", "M/L", "L/XL",
      "55", "56", "57", "58", "59", "60", "61", "62"],
  };
  const CATEGORY_LABELS = { shoes: "신발", clothing: "의류", headwear: "모자" };
  // Bags and accessories have no sizes. Anything else unrecognized stays manual.
  const GROUP_CATEGORY = { "신발": "shoes", "의류": "clothing", "아우터": "clothing", "모자": "headwear" };
  const FREE_ALIASES = { "프리": "FREE", "원사이즈": "FREE", "ONESIZE": "FREE" };
  const filters = new Map();

  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  function sizeTokens(label) {
    return String(label || "").toUpperCase().split(/[^A-Z0-9.가-힣]+/).filter(Boolean)
      .map((token) => FREE_ALIASES[token] || token);
  }

  function sizeEquals(left, right) {
    const leftNumber = Number(left), rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber === rightNumber;
    return left === right;
  }

  function sizeMatches(selected, tokens) {
    // A compound choice (S/M) needs every part present; a plain choice (M)
    // matches any option carrying it, including S/M and M/L ranges.
    const parts = String(selected || "").toUpperCase().split(/[^A-Z0-9.가-힣]+/).filter(Boolean)
      .map((token) => FREE_ALIASES[token] || token);
    if (!parts.length) return false;
    return parts.every((part) => tokens.some((token) => sizeEquals(token, part)));
  }

  function productHasSizes(product, sizes) {
    const wanted = (Array.isArray(sizes) ? sizes : []).map((size) => String(size));
    if (!wanted.length) return true;
    const options = Array.isArray(product?.sizes) ? product.sizes : [];
    return options.some((option) => {
      const labels = [option?.label, option?.name];
      if (Array.isArray(option?.optionPath)) labels.push(...option.optionPath);
      const tokens = labels.flatMap(sizeTokens);
      return wanted.some((size) => sizeMatches(size, tokens));
    });
  }

  function autoCategory(product) {
    try {
      if (typeof categoryGroupFromProduct !== "function") return "shoes";
      return GROUP_CATEGORY[categoryGroupFromProduct(product)] || "shoes";
    } catch {
      return "shoes";
    }
  }

  function draftFor(key) {
    const saved = filters.get(key);
    if (saved) return { category: saved.category, sizes: new Set(saved.sizes) };
    let category = "shoes";
    try {
      if (typeof excelPreviewProductCache !== "undefined") {
        const product = excelPreviewProductCache.get(key);
        if (product) category = autoCategory(product);
      }
    } catch {}
    return { category, sizes: new Set() };
  }

  function filterCount(key) {
    const saved = filters.get(String(key ?? ""));
    return saved ? saved.sizes.length : 0;
  }

  function filterResult(key, result) {
    const saved = filters.get(String(key ?? ""));
    if (!saved || !saved.sizes.length || !result) return result;
    return { ...result, products: (result.products || []).filter((item) => productHasSizes(item, saved.sizes)) };
  }

  function buttonHtml(key) {
    const plain = String(key ?? "");
    const count = filterCount(plain);
    return `<button type="button" class="excel-size-filter" data-excel-size-filter="${encodeURIComponent(plain)}" aria-pressed="${count ? "true" : "false"}">${count ? `사이즈(${count})` : "사이즈검색"}</button>`;
  }

  globalThis.excelSizeFilterButton = (key) => buttonHtml(key);
  globalThis.excelSizeFilteredResult = (key, result) => filterResult(key, result);
  globalThis.excelSizeFilterCount = (key) => filterCount(key);

  function renderPanel(cell, key, draft) {
    cell.querySelector(".excel-size-panel")?.remove();
    const panel = document.createElement("div");
    panel.className = "excel-size-panel";
    const categories = Object.entries(CATEGORY_LABELS).map(([id, label]) =>
      `<button type="button" class="excel-size-category" data-size-category="${id}" aria-pressed="${draft.category === id ? "true" : "false"}">${label}</button>`).join("");
    const chips = SIZE_SETS[draft.category].map((size) =>
      `<button type="button" class="excel-size-chip" data-size-chip="${esc(size)}" aria-pressed="${draft.sizes.has(size) ? "true" : "false"}">${esc(size)}</button>`).join("");
    panel.innerHTML = `<div class="excel-size-categories">${categories}</div>`
      + `<div class="excel-size-chips">${chips}</div>`
      + `<div class="excel-size-actions"><button type="button" data-size-apply>적용</button>`
      + `<button type="button" data-size-clear>해제</button></div>`;
    panel.dataset.key = key;
    panel._draft = draft;
    cell.append(panel);
  }

  function detailLabelHtml(product) {
    const title = String(product?.title || product?.articleNumber || "상품");
    return `<div class="domestic-inline-detail-label"><span></span><strong>${esc(title)}</strong> 국내 검색 결과</div>`;
  }

  function refreshDetail(key) {
    if (typeof excelPreviewSearchResults === "undefined" || typeof excelPreviewProductCache === "undefined") return;
    const result = excelPreviewSearchResults.get(key);
    const product = excelPreviewProductCache.get(key);
    if (!result || !product || typeof renderDomestic !== "function") return;
    const view = filterResult(key, result);
    const cell = document.querySelector(`[data-excel-size-filter="${encodeURIComponent(key)}"]`)?.closest("td");
    const row = cell?.closest("tr");
    const detail = row?.nextElementSibling;
    if (!cell || !detail || !detail.classList.contains("excel-product-search-detail")) return;
    const host = detail.querySelector("td");
    if (host) host.innerHTML = detailLabelHtml(product) + renderDomestic(view, product, key);
    const button = cell.querySelector("[data-excel-size-filter]");
    if (button) {
      const count = filterCount(key);
      button.textContent = count ? `사이즈(${count})` : "사이즈검색";
      button.setAttribute("aria-pressed", count ? "true" : "false");
    }
  }

  document.addEventListener("click", (event) => {
    const panelButton = event.target.closest("[data-size-category],[data-size-chip],[data-size-apply],[data-size-clear]");
    if (panelButton) {
      const panel = panelButton.closest(".excel-size-panel");
      if (!panel) return;
      const key = panel.dataset.key;
      const draft = panel._draft || draftFor(key);
      if (panelButton.hasAttribute("data-size-category")) {
        draft.category = panelButton.dataset.sizeCategory;
        renderPanel(panel.parentElement, key, draft);
        return;
      }
      if (panelButton.hasAttribute("data-size-chip")) {
        const size = panelButton.dataset.sizeChip;
        if (draft.sizes.has(size)) draft.sizes.delete(size);
        else draft.sizes.add(size);
        panelButton.setAttribute("aria-pressed", draft.sizes.has(size) ? "true" : "false");
        return;
      }
      if (panelButton.hasAttribute("data-size-apply")) {
        if (draft.sizes.size) filters.set(key, { category: draft.category, sizes: [...draft.sizes] });
        else filters.delete(key);
        const cell = panel.parentElement;
        panel.remove();
        const hasResult = typeof excelPreviewSearchResults !== "undefined" && excelPreviewSearchResults.get(key);
        const searchButton = cell?.querySelector("[data-excel-search-product]:not([disabled])");
        if (!hasResult && searchButton) searchButton.click();
        else refreshDetail(key);
        return;
      }
      if (panelButton.hasAttribute("data-size-clear")) {
        filters.delete(key);
        panel.remove();
        refreshDetail(key);
        return;
      }
    }
    const button = event.target.closest("[data-excel-size-filter]");
    if (!button) return;
    const key = decodeURIComponent(button.dataset.excelSizeFilter);
    const cell = button.closest("td");
    if (!cell) return;
    if (cell.querySelector(".excel-size-panel")) {
      cell.querySelector(".excel-size-panel").remove();
      return;
    }
    renderPanel(cell, key, draftFor(key));
  });
})();
