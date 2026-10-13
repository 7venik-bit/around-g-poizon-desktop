(() => {
  // Per-row domestic size filter for the Excel preview result column.
  // Keeps the collected result intact and only narrows the rendered detail to
  // products that carry the chosen sizes. State is session-only.
  const SIZE_SETS = {
    shoes: ["220", "225", "230", "235", "240", "245", "250", "255", "260",
      "265", "270", "275", "280", "285", "290", "295", "300"],
    clothing: ["XS", "S", "M", "L", "XL", "2XL", "3XL",
      "85", "90", "95", "100", "105", "110", "115"],
  };
  const CATEGORY_LABELS = { shoes: "신발", clothing: "의류" };
  const filters = new Map();

  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  function sizeTokens(label) {
    return String(label || "").toUpperCase().split(/[^A-Z0-9.]+/).filter(Boolean);
  }

  function sizeEquals(left, right) {
    const leftNumber = Number(left), rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber === rightNumber;
    return left === right;
  }

  function productHasSizes(product, sizes) {
    const wanted = (Array.isArray(sizes) ? sizes : []).map((size) => String(size).toUpperCase());
    if (!wanted.length) return true;
    const options = Array.isArray(product?.sizes) ? product.sizes : [];
    return options.some((option) => {
      const labels = [option?.label, option?.name];
      if (Array.isArray(option?.optionPath)) labels.push(...option.optionPath);
      const tokens = labels.flatMap(sizeTokens);
      return wanted.some((size) => tokens.some((token) => sizeEquals(token, size)));
    });
  }

  function draftFor(key) {
    const saved = filters.get(key);
    if (saved) return { category: saved.category, sizes: new Set(saved.sizes) };
    return { category: "shoes", sizes: new Set() };
  }

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
    const result = excelPreviewSearchResults.get(key);
    const product = excelPreviewProductCache.get(key);
    if (!result || !product || typeof renderDomestic !== "function") return;
    const filter = filters.get(key);
    const view = filter && filter.sizes.length
      ? { ...result, products: (result.products || []).filter((item) => productHasSizes(item, filter.sizes)) }
      : result;
    const cell = document.querySelector(`[data-excel-size-filter="${encodeURIComponent(key)}"]`)?.closest("td");
    const row = cell?.closest("tr");
    const detail = row?.nextElementSibling;
    if (!cell || !detail || !detail.classList.contains("excel-product-search-detail")) return;
    const host = detail.querySelector("td");
    if (host) host.innerHTML = detailLabelHtml(product) + renderDomestic(view, product, key);
    const button = cell.querySelector("[data-excel-size-filter]");
    if (button) {
      const count = filter ? filter.sizes.length : 0;
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
        panel.remove();
        refreshDetail(key);
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
