(() => {
  const CATEGORY_HEADERS = new Set([
    "카테고리", "카테고리 대분류", "카테고리 중분류", "카테고리 소분류",
    "대분류", "중분류", "소분류",
  ]);

  function installStyles() {
    if (document.querySelector("style[data-sourcing-view-style]")) return;
    const style = document.createElement("style");
    style.dataset.sourcingViewStyle = "true";
    style.textContent = `
      .sourcing-hidden-column{display:none!important}
      #excel-preview-grid .sourcing-size{color:#111827!important;font-weight:700;white-space:nowrap}
      #excel-preview-grid .sourcing-size-sales{color:#475569!important;font-weight:700;white-space:nowrap}
      #excel-preview-grid .sourcing-stock{min-width:86px;border-radius:8px;font-weight:700;box-shadow:none}
      #excel-preview-grid .sourcing-stock.available{background:#eef7f0;color:#4f7d57;border-color:#d4e8d7}
      #excel-preview-grid .sourcing-stock.pending{background:#fff7ed;color:#ad6b31;border-color:#f1ddc9}
      #excel-preview-grid .sourcing-stock.soldout{background:#f3f4f6;color:#7b8794;border-color:#e1e5ea}
      #excel-preview-grid .sourcing-stock.missing{background:#f6f7f8;color:#7a828a;border-color:#e5e7eb}
      #excel-preview-grid .sourcing-stock.error{background:#fff4f2;color:#a65f58;border-color:#eed8d4}
      #excel-preview-grid .sourcing-stock.loading{background:#f1f5f9;color:#64748b;border-color:#dce3ea}
      #excel-preview-grid .size-chip{color:#111827!important;text-decoration:none!important}
      #excel-preview-grid .size-chip.available{background:#f2f7f3!important;color:#111827!important}
      #excel-preview-grid .size-chip.unknown{background:#fff7ed!important;color:#111827!important}
      #excel-preview-grid .size-chip.soldout{background:#f3f4f6!important;color:#7b8794!important;text-decoration:line-through!important}
      #excel-preview-grid .stock-state.available{background:#eef7f0!important;color:#4f7d57!important}
      #excel-preview-grid .stock-state.soldout{background:#f3f4f6!important;color:#7b8794!important}
      #excel-preview-grid .stock-state.link{background:#fff7ed!important;color:#ad6b31!important}
    `;
    document.head.appendChild(style);
  }

  function normalizeHeader(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function hideCategoryColumns() {
    const headerRow = document.querySelector("#excel-preview-columns tr");
    if (!headerRow) return;
    const headers = [...headerRow.children];
    const hiddenIndexes = headers
      .map((header, index) => CATEGORY_HEADERS.has(normalizeHeader(header.textContent)) ? index : -1)
      .filter((index) => index >= 0);
    if (!hiddenIndexes.length) return;
    hiddenIndexes.forEach((index) => headers[index]?.classList.add("sourcing-hidden-column"));
    document.querySelectorAll("#excel-preview-rows tr").forEach((row) => {
      const cells = [...row.children];
      hiddenIndexes.forEach((index) => cells[index]?.classList.add("sourcing-hidden-column"));
    });
  }

  function displaySizeSales(product) {
    const localRaw = String(product?.localSales30dRaw || "").trim();
    const chinaRaw = String(product?.sales30dRaw || "").trim();
    const localValue = Number(product?.localSales30d);
    const chinaValue = Number(product?.sales30d);
    const raw = localRaw || chinaRaw;
    const value = Number.isFinite(localValue) ? localValue : chinaValue;
    if (raw) return `판매량 ${raw}`;
    if (Number.isFinite(value)) return `판매량 ${Math.round(value).toLocaleString("ko-KR")}`;
    return "판매량 -";
  }

  function stockPresentation(result, outcome) {
    if (result?.loading) return { label: "검색 중…", className: "loading" };
    if (result?.error) return { label: "검색 실패", className: "error" };
    if (!result) return { label: "상품 검색", className: "pending" };
    const name = String(outcome?.className || "").toLowerCase();
    if (name === "available") return { label: "재고 있음", className: "available" };
    if (name === "soldout") return { label: "품절", className: "soldout" };
    if (name === "pending") return { label: "확인 필요", className: "pending" };
    if (name === "missing") return { label: "국내 없음", className: "missing" };
    if (name === "error") return { label: "검색 실패", className: "error" };
    return { label: "확인 완료", className: "pending" };
  }

  function installProductRenderer() {
    try {
      if (typeof renderExcelProductRows !== "function" || renderExcelProductRows.__aroundGSourcingView) return;
      const originalRenderExcelProductRows = renderExcelProductRows;
      const sourcingRenderer = function sourcingRenderExcelProductRows(file, products = []) {
        try {
          const pageKeys = products.map((product) => `${brandImportPathKey(file.path)}::${product.key || product.articleNumber || product.spuId}`);
          products.forEach((product, index) => excelPreviewProductCache.set(pageKeys[index], product));
          const columns = document.querySelector("#excel-preview-columns");
          const rows = document.querySelector("#excel-preview-rows");
          if (!columns || !rows) return originalRenderExcelProductRows(file, products);
          columns.innerHTML = `<tr><th class="excel-product-select-column">선택</th><th>이미지</th><th>상품번호</th><th>상품명</th><th>브랜드</th><th>사이즈</th><th>사이즈 판매량</th><th>평균가격</th><th>중국 총판매</th><th>현지 총판매</th><th>재고</th></tr>`;
          rows.innerHTML = products.length ? products.map((product, index) => {
            const key = pageKeys[index];
            const result = excelPreviewSearchResults.get(key);
            const poizonPrice = verifiedExcelProductPoizonPrice(product);
            const outcome = result && !result.loading ? domesticStatus(result) : null;
            const stock = stockPresentation(result, outcome);
            const groupClass = index % 2 === 0 ? "excel-product-group-blue" : "excel-product-group-amber";
            const outcomeClass = outcome ? `excel-search-outcome-${outcome.className}` : "";
            const productLabel = [product.articleNumber, product.title].filter(Boolean).join(" · ") || "선택 상품";
            const resultCount = Array.isArray(result?.products) ? result.products.length : 0;
            const searchTitle = result ? `국내 검색 결과 ${resultCount.toLocaleString("ko-KR")}개` : "국내 상품 재고 검색";
            return `<tr class="excel-product-row ${groupClass} ${outcomeClass}">
              <td class="excel-product-select-column"><input type="checkbox" data-excel-product-select="${encodeURIComponent(key)}" aria-label="제품 선택"></td>
              <td class="excel-product-image">${product.logoUrl ? `<img src="${text(product.logoUrl)}" alt="">` : "-"}</td>
              <td><b>${text(product.articleNumber || "-")}</b></td>
              <td title="${text(product.title)}">${text(product.title || "-")}</td>
              <td>${text(product.brandName || "-")}</td>
              <td class="sourcing-size">${text(product.option || "-")}</td>
              <td><span class="sourcing-size-sales">${text(displaySizeSales(product))}</span></td>
              <td>${poizonPrice ? money(poizonPrice) : "가격 없음"}</td>
              <td>${excelProductMetric(product.totalSalesRaw, product.totalSales)}</td>
              <td>${excelProductMetric(product.localTotalSalesRaw, product.localTotalSales)}</td>
              <td><button type="button" class="excel-product-search sourcing-stock ${stock.className}" data-excel-search-product="${encodeURIComponent(key)}" title="${text(searchTitle)}" ${result?.loading ? "disabled" : ""}>${text(stock.label)}</button></td>
            </tr>${result && !result.loading ? `<tr class="excel-product-search-detail ${groupClass} ${outcomeClass}"><td colspan="11"><div class="excel-product-search-result-label"><span></span><strong>${text(productLabel)}</strong>의 국내 검색 결과 <b class="excel-search-outcome-label">${text(outcome?.label || "확인 완료")}</b></div>${renderDomestic(result, product)}</td></tr>` : ""}`;
          }).join("") : `<tr><td class="empty" colspan="11">조건에 맞는 상품이 없습니다.</td></tr>`;
          hideCategoryColumns();
          return pageKeys;
        } catch (error) {
          console.warn("[sourcing-view] product renderer fallback", error);
          return originalRenderExcelProductRows(file, products);
        }
      };
      sourcingRenderer.__aroundGSourcingView = true;
      renderExcelProductRows = sourcingRenderer;

      queueMicrotask(() => {
        try {
          if (typeof activeExcelPreview !== "undefined"
            && activeExcelPreview?.viewMode === "products"
            && Array.isArray(excelPreviewPageProducts)
            && activeExcelPreview?.file) {
            renderExcelProductRows(activeExcelPreview.file, excelPreviewPageProducts);
          }
        } catch {}
      });
    } catch (error) {
      console.warn("[sourcing-view] renderer install skipped", error);
    }
  }

  installStyles();
  installProductRenderer();
  hideCategoryColumns();

  const columns = document.querySelector("#excel-preview-columns");
  const rows = document.querySelector("#excel-preview-rows");
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      installProductRenderer();
      hideCategoryColumns();
    });
  };
  const observer = new MutationObserver(schedule);
  if (columns) observer.observe(columns, { childList: true, subtree: true });
  if (rows) observer.observe(rows, { childList: true, subtree: true });
})();
