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
      #domestic-stock-filter{display:none!important}
      #excel-preview-grid .sourcing-size{color:#111827!important;font-weight:700;white-space:nowrap}
      #excel-preview-grid .sourcing-size-sales{color:#475569!important;font-weight:700;white-space:nowrap}
      #excel-preview-grid .sourcing-domestic-search{min-width:92px;border-radius:8px;font-weight:700;box-shadow:none}
      #excel-preview-grid .sourcing-domestic-search.pending{background:#f8fafc;color:#475569;border-color:#d9e0e8}
      #excel-preview-grid .sourcing-domestic-search.loading{background:#f1f5f9;color:#64748b;border-color:#dce3ea}
      #excel-preview-grid .sourcing-domestic-search.available{background:#eef7f0;color:#4f7d57;border-color:#d4e8d7}
      #excel-preview-grid .sourcing-domestic-search.missing{background:#f3f4f6;color:#7b8794;border-color:#e1e5ea}
      #excel-preview-grid .sourcing-domestic-search.error{background:#fff4f2;color:#a65f58;border-color:#eed8d4}
      .domestic-source-list.sourcing-product-list{display:flex!important;flex-direction:column!important;gap:0!important;border:1px solid #e5e7eb!important;border-radius:12px!important;overflow:hidden!important;background:#fff!important}
      .sourcing-product-list-row{display:grid!important;grid-template-columns:58px minmax(0,1fr) 180px!important;gap:10px!important;align-items:center!important;padding:6px 10px!important;background:#fff!important;border:0!important;border-bottom:1px solid #eef0f2!important;min-height:68px!important}
      .sourcing-product-list-row:last-child{border-bottom:0!important}
      .sourcing-product-list-row:hover{background:#fafafa!important}
      .sourcing-product-thumb{width:56px!important;height:56px!important;border-radius:7px!important;background:#f5f5f5!important;overflow:hidden!important;display:flex!important;align-items:center!important;justify-content:center!important;color:#9ca3af!important;font-size:12px!important}
      .sourcing-product-thumb img{width:100%!important;height:100%!important;object-fit:cover!important;display:block!important}
      .sourcing-product-info{min-width:0!important;display:flex!important;flex-direction:column!important;gap:5px!important}
      .sourcing-product-store{display:flex!important;align-items:center!important;gap:8px!important;color:#4b5563!important;font-size:12px!important;font-weight:700!important}
      .sourcing-product-store .official{background:#fff3e8!important;color:#b86624!important;border-radius:999px!important;padding:3px 7px!important;font-size:11px!important}
      .sourcing-product-title{margin:0!important;color:#111827!important;font-size:12px!important;font-weight:700!important;line-height:1.35!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      .sourcing-product-meta{display:flex!important;flex-wrap:wrap!important;gap:6px 12px!important;color:#6b7280!important;font-size:12px!important}
      .sourcing-product-meta code{font-family:inherit!important;background:none!important;padding:0!important;color:#6b7280!important}
      .sourcing-product-actions{display:grid!important;grid-template-columns:1fr 86px!important;align-items:center!important;gap:8px!important;min-width:0!important}
      .sourcing-product-price{font-size:13px!important;text-align:right!important;font-weight:800!important;color:#111827!important;white-space:nowrap!important}
      .sourcing-product-actions button,.sourcing-source-fallback button{min-width:82px!important;padding:6px 8px!important;font-size:11px!important;border-radius:8px!important;font-weight:700!important}
      .sourcing-source-fallback{display:grid!important;grid-template-columns:minmax(100px,150px) minmax(0,1fr) 90px!important;gap:10px!important;align-items:center!important;padding:7px 10px!important;background:#fff!important;border-bottom:1px solid #eef0f2!important}
      .sourcing-source-fallback:last-child{border-bottom:0!important}
      .sourcing-source-fallback strong{font-size:13px!important;color:#111827!important}
      .sourcing-source-fallback span{font-size:12px!important;color:#6b7280!important}
      .sourcing-list-empty{padding:24px!important;text-align:center!important;color:#6b7280!important;font-size:13px!important}
      .excel-search-outcome-soldout .sourcing-domestic-search{background:#eef7f0!important;color:#4f7d57!important;border-color:#d4e8d7!important}
      #excel-preview-grid .platform-row{display:grid!important;grid-template-columns:22px 90px minmax(260px,1fr) 74px 88px 110px 70px!important;grid-template-rows:56px!important;gap:0 7px!important;align-items:center!important;min-height:56px!important;padding:3px 0!important;text-align:center!important}
      #excel-preview-grid .platform-row>*{min-width:0!important}
      #excel-preview-grid .platform-row>strong{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
      #excel-preview-grid .candidate-summary{display:grid!important;grid-template-columns:48px minmax(0,1fr)!important;gap:7px!important;align-items:center!important;text-align:left!important}
      #excel-preview-grid .candidate-image{width:46px!important;height:46px!important;object-fit:contain!important}
      #excel-preview-grid .candidate-summary b,#excel-preview-grid .candidate-summary small{display:block!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
      #excel-preview-grid .platform-row .match-signals{display:none!important}
      #excel-preview-grid .platform-row .size-list{justify-content:center!important;max-height:48px!important;overflow:hidden!important}
      #excel-preview-grid .platform-row>button{grid-column:7!important;grid-row:1!important;width:100%!important;padding:6px!important}
      #excel-preview-grid .domestic-source-section{margin:0!important;border-radius:7px!important}
      #excel-preview-grid .domestic-source-heading{min-height:30px!important;padding:4px 7px!important}
      #excel-preview-grid .domestic-source-section .platform-list{padding:0 7px!important}
      @media (max-width:980px){
        .sourcing-product-list-row{grid-template-columns:50px minmax(220px,1fr) 165px!important}
        .sourcing-product-thumb{width:48px!important;height:48px!important}
        .sourcing-product-actions{grid-column:3!important;width:100%!important}
        .sourcing-source-fallback{grid-template-columns:1fr auto!important}
        .sourcing-source-fallback span{grid-column:1!important}
      }
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

  function sourcingSizeSalesValue(product) {
    const chinaRaw = String(product?.sales30dRaw || "").trim();
    const localRaw = String(product?.localSales30dRaw || "").trim();
    const raw = chinaRaw || localRaw;
    if (/^<\s*5$/i.test(raw)) return 4;
    const rawNumber = Number(raw.replace(/[^0-9]/g, ""));
    if (raw && Number.isFinite(rawNumber)) return rawNumber;
    const chinaValue = Number(product?.sales30d);
    const localValue = Number(product?.localSales30d);
    return Number.isFinite(chinaValue) ? chinaValue : Number.isFinite(localValue) ? localValue : 0;
  }

  function displaySizeSales(product) {
    const value = sourcingSizeSalesValue(product);
    return value > 0 ? `판매량 ${Math.round(value).toLocaleString("ko-KR")}` : "판매량 -";
  }

  function sourcingProductIdentity(product) {
    return String(product?.articleNumber || product?.spuId || product?.key || "").trim().toUpperCase();
  }

  function highestQualifiedSizeReference(products = []) {
    const minimumSales = 30;
    const best = new Map();
    for (const product of Array.isArray(products) ? products : []) {
      const sales = sourcingSizeSalesValue(product);
      const price = Number(product?.averagePrice || 0);
      if (sales < minimumSales || price <= 0) continue;
      const identity = sourcingProductIdentity(product);
      if (!identity) continue;
      const current = best.get(identity);
      if (!current || price > Number(current?.averagePrice || 0)) best.set(identity, product);
    }
    return best;
  }

  function domesticSearchPresentation(result) {
    if (result?.loading) return { label: "검색 중…", className: "loading" };
    if (result?.error) return { label: "검색 실패", className: "error" };
    if (!result) return { label: "국내 검색", className: "pending" };
    const count = Array.isArray(result?.products) ? result.products.length : 0;
    if (count > 0) return { label: `상품 ${count.toLocaleString("ko-KR")}개`, className: "available" };
    const verifiedCount = (result?.sources || []).reduce((sum, source) =>
      sum + (source?.countVerified ? Number(source?.count || 0) : 0), 0);
    if (verifiedCount > 0) return { label: `결과 ${verifiedCount.toLocaleString("ko-KR")}개`, className: "available" };
    const needsReview = (result?.sources || []).some((source) => source?.verificationPending || source?.verificationFailed);
    return needsReview
      ? { label: "확인 필요", className: "pending" }
      : { label: "상품 없음", className: "missing" };
  }

  function installDomesticStatus() {
    try {
      if (typeof domesticStatus !== "function" || domesticStatus.__aroundGProductOnly) return;
      const productOnlyStatus = function productOnlyDomesticStatus(result) {
        if (!result) return { label: "확인 전", className: "pending" };
        if (result.loading) return { label: "검색 중", className: "loading" };
        if (result.error) return { label: "검색 실패", className: "pending" };
        const presentation = domesticSearchPresentation(result);
        return { label: presentation.label, className: presentation.className };
      };
      productOnlyStatus.__aroundGProductOnly = true;
      domesticStatus = productOnlyStatus;
    } catch (error) {
      console.warn("[sourcing-view] domestic status install skipped", error);
    }
  }

  function installDomesticRenderer() {
    try {
      if (typeof renderDomestic !== "function" || renderDomestic.__aroundGMusinsaList) return;
      const listRenderer = function sourcingRenderDomestic(result, sourceProduct = {}) {
        if (!result) {
          return `<span class="inventory-help">국내 상품 검색을 누르면 판매처별 일치 상품을 한 줄씩 표시합니다. 재고는 판매처에서 직접 확인하세요.</span>`;
        }
        if (result.loading) return `<span class="inventory-help">국내 판매처에서 일치 상품을 찾고 있습니다…</span>`;
        if (result.error) return `<span class="inventory-help">국내 상품 검색에 실패했습니다.</span>`;

        const products = (result.products || []).filter((product) => {
          if (!product || !(product.name || product.title)) return false;
          const store = String(product.store || product.sourceStore || "");
          const retailer = String(product.retailerName || "");
          const parallel = store === "병행수입·편집샵" || store === "SSG 병행수입"
            || product.ssgClassification === "parallel_import" || retailer.startsWith("병행수입");
          return !parallel || product.parallelRetailerVerified === true;
        });
        const sources = Array.isArray(result.sources) ? result.sources : [];
        const sourceOwnsProduct = (source, product) => {
          const sourceStore = String(source?.store || "");
          const productStore = String(product?.store || "");
          if (sourceStore === String(product?.sourceStore || "")) return true;
          if (sourceStore === productStore) return true;
          if (sourceStore === "SSG" && /^SSG(?:\s|$)/.test(productStore)) return true;
          if (sourceStore === "병행수입·편집샵" && product?.parallelRetailerVerified === true
            && (/병행수입/.test(productStore)
              || String(product?.retailerName || "").startsWith("병행수입"))) return true;
          return false;
        };
        const sourceForProduct = (product) => sources.find((source) => sourceOwnsProduct(source, product)) || {};
        const sourceAction = (source, product = {}, label = "판매처 열기") => {
          const productUrl = String(product?.url || "").trim();
          const openUrl = String(productUrl || source?.verifiedProductUrl || source?.officialProductUrl
            || source?.officialSearchUrl || source?.homepageUrl || source?.searchUrl || "");
          const query = source?.searchQuery || sourceProduct.articleNumber || sourceProduct.productCode
            || sourceProduct.spuId || result.queryCandidates?.[0] || "";
          if (!openUrl) return `<button type="button" disabled>${label}</button>`;
          if (source?.officialStatus && !productUrl) {
            return `<button type="button" data-official-homepage="${encodeURIComponent(source.homepageUrl || openUrl)}" data-official-query="${encodeURIComponent(query)}">${label}</button>`;
          }
          return `<button type="button" data-url="${encodeURIComponent(openUrl)}">${label}</button>`;
        };
        const productRows = products.map((product) => {
          const source = sourceForProduct(product);
          const candidateName = product?.title || product?.name || product?.articleNumber || "국내 상품";
          const retailer = product?.retailerName || product?.store || source?.store || "판매처";
          const article = product?.articleNumber || sourceProduct?.articleNumber || sourceProduct?.productCode || "";
          const official = product?.officialStoreVerified === true || Boolean(source?.officialStatus);
          const confidence = Number(product?.confidence || 0);
          const confidenceText = confidence > 0 ? `일치도 ${confidence}%` : "";
          return `<article class="sourcing-product-list-row">
            <div class="sourcing-product-thumb">${product?.imageUrl ? `<img src="${text(product.imageUrl)}" alt="${text(candidateName)}">` : "이미지 없음"}</div>
            <div class="sourcing-product-info">
              <div class="sourcing-product-store"><span>${text(retailer)}</span>${official ? `<span class="official">공식</span>` : ""}</div>
              <h4 class="sourcing-product-title">${text(candidateName)}</h4>
              <div class="sourcing-product-meta">${article ? `<code>${text(article)}</code>` : ""}${confidenceText ? `<span>${text(confidenceText)}</span>` : ""}</div>
            </div>
            <div class="sourcing-product-actions">
              <strong class="sourcing-product-price">${product?.price ? money(product.price) : "가격 확인"}</strong>
              ${sourceAction(source, product)}
            </div>
          </article>`;
        }).join("");

        const sourceFallbackRows = sources
          .filter((source) => !products.some((product) => sourceOwnsProduct(source, product)))
          .filter((source) => Number(source?.count || 0) > 0
            || (source?.store === "병행수입·편집샵" && source?.parallelRetailerListEnforced === true && source?.absenceConfirmed === true)
            || source?.verificationPending || source?.verificationFailed)
          .map((source) => {
            const count = Number(source?.count || 0);
            const approvedParallelMissing = source?.store === "병행수입·편집샵"
              && source?.parallelRetailerListEnforced === true && source?.absenceConfirmed === true;
            const message = approvedParallelMissing
              ? "상품없음"
              : count > 0
              ? `검색 결과 ${count.toLocaleString("ko-KR")}개 확인 · 상품 상세는 판매처에서 직접 확인`
              : source?.verificationFailed ? "검색 결과 확인이 완료되지 않았습니다." : "판매처에서 직접 확인이 필요합니다.";
            return `<div class="sourcing-source-fallback"><strong>${text(source?.store || "판매처")}</strong><span>${text(message)}</span>${sourceAction(source)}</div>`;
          }).join("");

        if (!productRows && !sourceFallbackRows) {
          return `<div class="domestic-source-list sourcing-product-list"><div class="sourcing-list-empty">일치하는 국내 판매 상품을 찾지 못했습니다.</div></div>`;
        }
        return `<div class="domestic-source-list sourcing-product-list">${productRows}${sourceFallbackRows}</div>`;
      };
      listRenderer.__aroundGMusinsaList = true;
      renderDomestic = listRenderer;
    } catch (error) {
      console.warn("[sourcing-view] domestic renderer install skipped", error);
    }
  }

  function relabelDomesticControls() {
    const replacements = new Map([
      ["선택 상품 국내 재고 검색", "선택 상품 국내 검색"],
      ["표시 목록 국내 재고 검색", "표시 목록 국내 검색"],
      ["국내 재고 검색", "국내 상품 검색"],
    ]);
    document.querySelectorAll("button").forEach((button) => {
      const label = String(button.textContent || "").trim();
      if (replacements.has(label)) button.textContent = replacements.get(label);
    });
    const stockFilter = document.querySelector("#domestic-stock-filter");
    if (stockFilter) {
      stockFilter.hidden = true;
      stockFilter.setAttribute("aria-hidden", "true");
    }
  }

  function wrapSelectionUi() {
    try {
      if (typeof updateExplorerSelectionUi === "function" && !updateExplorerSelectionUi.__aroundGNoStockLabel) {
        const original = updateExplorerSelectionUi;
        const wrapped = function sourcingUpdateExplorerSelectionUi(...args) {
          const value = original.apply(this, args);
          relabelDomesticControls();
          return value;
        };
        wrapped.__aroundGNoStockLabel = true;
        updateExplorerSelectionUi = wrapped;
      }
      if (typeof updateDomesticStockFilter === "function" && !updateDomesticStockFilter.__aroundGHidden) {
        const original = updateDomesticStockFilter;
        const wrapped = function sourcingUpdateDomesticStockFilter(...args) {
          const value = original.apply(this, args);
          const button = document.querySelector("#domestic-stock-filter");
          if (button) {
            button.hidden = true;
            button.setAttribute("aria-hidden", "true");
          }
          return value;
        };
        wrapped.__aroundGHidden = true;
        updateDomesticStockFilter = wrapped;
      }
    } catch (error) {
      console.warn("[sourcing-view] domestic controls install skipped", error);
    }
  }

  function installProductRenderer() {
    try {
      if (typeof renderExcelProductRows !== "function" || renderExcelProductRows.__aroundGSourcingView) return;
      const originalRenderExcelProductRows = renderExcelProductRows;
      const sourcingRenderer = function sourcingRenderExcelProductRows(file, products = []) {
        try {
          const highestSizeByIdentity = highestQualifiedSizeReference(products);
          const pageKeys = products.map((product) => `${brandImportPathKey(file.path)}::${product.key || product.articleNumber || product.spuId}`);
          products.forEach((product, index) => excelPreviewProductCache.set(pageKeys[index], product));
          const columns = document.querySelector("#excel-preview-columns");
          const rows = document.querySelector("#excel-preview-rows");
          if (!columns || !rows) return originalRenderExcelProductRows(file, products);
          columns.innerHTML = `<tr><th class="excel-product-select-column">선택</th><th>이미지</th><th>상품번호</th><th>상품명</th><th>브랜드</th><th>사이즈</th><th>사이즈 판매량</th><th>사이즈 최고가</th><th>중국 총판매</th><th>현지 총판매</th><th>국내 상품</th></tr>`;
          rows.innerHTML = products.length ? products.map((product, index) => {
            const key = pageKeys[index];
            const result = excelPreviewSearchResults.get(key);
            const referenceProduct = highestSizeByIdentity.get(sourcingProductIdentity(product)) || product;
            const poizonPrice = verifiedExcelProductPoizonPrice(referenceProduct);
            const search = domesticSearchPresentation(result);
            const groupClass = index % 2 === 0 ? "excel-product-group-blue" : "excel-product-group-amber";
            const productLabel = [product.articleNumber, product.title].filter(Boolean).join(" · ") || "선택 상품";
            return `<tr class="excel-product-row ${groupClass}">
              <td class="excel-product-select-column"><input type="checkbox" data-excel-product-select="${encodeURIComponent(key)}" aria-label="제품 선택"></td>
              <td class="excel-product-image">${product.logoUrl ? `<img src="${text(product.logoUrl)}" alt="">` : "-"}</td>
              <td><b>${text(product.articleNumber || "-")}</b></td>
              <td title="${text(product.title)}">${text(product.title || "-")}</td>
              <td>${text(product.brandName || "-")}</td>
              <td class="sourcing-size">${text(referenceProduct.option || product.option || "-")}</td>
              <td><span class="sourcing-size-sales">${text(displaySizeSales(referenceProduct))}</span></td>
              <td>${poizonPrice ? money(poizonPrice) : "가격 없음"}</td>
              <td>${excelProductMetric(product.totalSalesRaw, product.totalSales)}</td>
              <td>${excelProductMetric(product.localTotalSalesRaw, product.localTotalSales)}</td>
              <td><button type="button" class="excel-product-search sourcing-domestic-search ${search.className}" data-excel-search-product="${encodeURIComponent(key)}" title="국내 정확 상품 검색" ${result?.loading ? "disabled" : ""}>${text(search.label)}</button></td>
            </tr>${result && !result.loading ? `<tr class="excel-product-search-detail ${groupClass}"><td colspan="11"><div class="excel-product-search-result-label"><span></span><strong>${text(productLabel)}</strong>의 국내 검색 결과</div>${renderDomestic(result, product)}</td></tr>` : ""}`;
          }).join("") : `<tr><td class="empty" colspan="11">조건에 맞는 상품이 없습니다.</td></tr>`;
          hideCategoryColumns();
          relabelDomesticControls();
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
  installDomesticStatus();
  installDomesticRenderer();
  wrapSelectionUi();
  installProductRenderer();
  hideCategoryColumns();
  relabelDomesticControls();

  const columns = document.querySelector("#excel-preview-columns");
  const rows = document.querySelector("#excel-preview-rows");
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      installDomesticStatus();
      installDomesticRenderer();
      wrapSelectionUi();
      installProductRenderer();
      hideCategoryColumns();
      relabelDomesticControls();
    });
  };
  const observer = new MutationObserver(schedule);
  if (columns) observer.observe(columns, { childList: true, subtree: true });
  if (rows) observer.observe(rows, { childList: true, subtree: true });
  const explorerResults = document.querySelector("#explorer-results");
  if (explorerResults) observer.observe(explorerResults, { childList: true, subtree: true });
})();
