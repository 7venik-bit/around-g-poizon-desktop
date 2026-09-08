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
      .sourcing-price-comparison{border:1px solid #d7e2ef!important;border-radius:8px!important;overflow-x:auto!important;background:#fff!important}
      .sourcing-price-row{display:grid!important;grid-template-columns:minmax(90px,125px) minmax(220px,1fr) 90px 82px 92px 88px 92px 82px!important;align-items:center!important;min-height:38px!important;border-bottom:1px solid #e7edf4!important;color:#17365d!important;font-size:10px!important}
      .sourcing-price-row:last-child{border-bottom:0!important}
      .sourcing-price-row>*{min-width:0!important;padding:5px 7px!important;text-align:center!important;box-sizing:border-box!important}
      .sourcing-price-head{min-height:29px!important;background:#243f63!important;color:#fff!important;font-weight:800!important}
      .sourcing-price-store,.sourcing-price-title{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
      .sourcing-price-title{text-align:left!important}
      .sourcing-price-positive{color:#047857!important;font-weight:800!important}
      .sourcing-price-caution{color:#b45309!important;font-weight:800!important}
      .sourcing-price-negative{color:#dc2626!important;font-weight:800!important}
      .sourcing-price-unknown{color:#7b8794!important}
      .sourcing-price-summary{display:flex!important;flex-direction:column!important;gap:2px!important;white-space:nowrap!important}
      .sourcing-price-summary strong{font-size:10px!important}
      .sourcing-price-summary small{font-size:8px!important;color:#64748b!important}
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

  function numericDomesticPrice(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
  }

  function domesticProductShipping(product = {}) {
    for (const key of ["shippingFee", "deliveryFee", "shippingPrice", "deliveryPrice"]) {
      if (!Object.prototype.hasOwnProperty.call(product, key)) continue;
      const amount = Number(product[key]);
      if (Number.isFinite(amount) && amount >= 0) return { known: true, amount: Math.round(amount) };
    }
    return { known: false, amount: 0 };
  }

  function domesticPriceEligibleProduct(product = {}) {
    const store = String(product.store || product.sourceStore || "");
    const retailer = String(product.retailerName || "");
    const parallel = store === "병행수입·편집샵" || store === "SSG 병행수입"
      || product.ssgClassification === "parallel_import" || retailer.startsWith("병행수입");
    return (!parallel || product.parallelRetailerVerified === true) && product.inStock !== false;
  }

  function domesticPriceComparison(result, poizonPrice = 0) {
    const basePrice = numericDomesticPrice(poizonPrice);
    const pricedProducts = (Array.isArray(result?.products) ? result.products : [])
      .filter(domesticPriceEligibleProduct)
      .map((product) => ({ product, price: numericDomesticPrice(product?.price) }))
      .filter((entry) => entry.price > 0)
      .sort((left, right) => left.price - right.price);
    const lowest = pricedProducts[0] || null;
    if (!lowest || !basePrice) return {
      domesticLowest: lowest?.price || 0,
      difference: null,
      marginRate: null,
      className: "sourcing-price-unknown",
    };
    const difference = lowest.price - basePrice;
    const marginRate = lowest.price > 0 ? (difference / lowest.price) * 100 : null;
    const className = difference < 0 || Number(marginRate) < 10
      ? "sourcing-price-negative"
      : marginRate < 20 ? "sourcing-price-caution" : "sourcing-price-positive";
    return { domesticLowest: lowest.price, difference, marginRate, className };
  }

  function signedMoney(value) {
    if (!Number.isFinite(Number(value))) return "–";
    const amount = Math.round(Number(value));
    return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${money(Math.abs(amount))}`;
  }

  function domesticSearchPresentation(result) {
    if (globalThis.AroundGDomesticVerdict?.resultPresentation) {
      return globalThis.AroundGDomesticVerdict.resultPresentation(result);
    }
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
      const listRenderer = function sourcingRenderDomestic(result, sourceProduct = {}, contextKey = "") {
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
        const poizonPrice = verifiedExcelProductPoizonPrice(sourceProduct);
        const sourceAction = (source, product = {}, label = "판매처 열기") => {
          const productUrl = String(product?.url || "").trim();
          const openUrl = String(productUrl || source?.verifiedProductUrl || source?.officialProductUrl
            || source?.officialSearchUrl || source?.homepageUrl || source?.searchUrl || "");
          const query = source?.searchQuery || sourceProduct.articleNumber || sourceProduct.productCode
            || sourceProduct.spuId || result.queryCandidates?.[0] || "";
          if (!openUrl) return `<button type="button" disabled>${label}</button>`;
          if (source?.officialStatus && !productUrl) {
            return `<button type="button" data-official-homepage="${encodeURIComponent(source.homepageUrl || openUrl)}" data-official-query="${encodeURIComponent(query)}" data-official-result-key="${encodeURIComponent(contextKey)}">${label}</button>`;
          }
          return `<button type="button" data-url="${encodeURIComponent(openUrl)}">${label}</button>`;
        };
        const productRows = products.map((product) => {
          const source = sourceForProduct(product);
          const candidateName = product?.title || product?.name || product?.articleNumber || "국내 상품";
          const sourceStore = String(source?.store || product?.store || "");
          const simpleLinkResult = product?.linkOnly === true
            || sourceStore === "브랜드 공식몰"
            || /^네이버\s/.test(sourceStore);
          if (simpleLinkResult && /^https?:\/\//i.test(String(product?.url || ""))) {
            const linkPrice = numericDomesticPrice(product?.price);
            const linkDifference = linkPrice && poizonPrice ? linkPrice - poizonPrice : null;
            return `<div class="sourcing-price-row">
              <strong class="sourcing-price-store">${text(sourceStore || "공식 판매처")}</strong>
              <span class="sourcing-price-title" title="${text(candidateName)}">${text(sourceStore === "브랜드 공식몰" ? candidateName : "검색 결과 링크")}</span>
              <strong>${linkPrice ? money(linkPrice) : "가격 확인"}</strong>
              <span class="sourcing-price-unknown">–</span>
              <span class="sourcing-price-unknown">–</span>
              <span class="sourcing-price-unknown">–</span>
              <strong class="${Number.isFinite(linkDifference) ? linkDifference < 0 ? "sourcing-price-negative" : "sourcing-price-caution" : "sourcing-price-unknown"}">${signedMoney(linkDifference)}</strong>
              ${sourceAction(source, product, "열기")}
            </div>`;
          }
          const retailer = product?.retailerName || product?.store || source?.store || "판매처";
          const price = numericDomesticPrice(product?.price);
          const shipping = domesticProductShipping(product);
          const actualPrice = price && shipping.known ? price + shipping.amount : 0;
          const difference = price && poizonPrice ? price - poizonPrice : null;
          const differenceClass = !Number.isFinite(difference) ? "sourcing-price-unknown"
            : difference < 0 ? "sourcing-price-negative"
              : difference / Math.max(price, 1) >= 0.2 ? "sourcing-price-positive" : "sourcing-price-caution";
          const stockLabel = product?.inStock === true ? "재고 있음"
            : product?.inStock === false ? "품절" : "확인 필요";
          return `<div class="sourcing-price-row">
            <strong class="sourcing-price-store">${text(retailer)}</strong>
            <span class="sourcing-price-title" title="${text(candidateName)}">${text(candidateName)}</span>
            <strong>${price ? money(price) : "가격 확인"}</strong>
            <span class="${shipping.known ? "" : "sourcing-price-unknown"}">${shipping.known ? shipping.amount ? money(shipping.amount) : "무료" : "미확인"}</span>
            <strong class="${actualPrice ? "" : "sourcing-price-unknown"}">${actualPrice ? money(actualPrice) : "확인 필요"}</strong>
            <span>${text(stockLabel)}</span>
            <strong class="${differenceClass}">${signedMoney(difference)}</strong>
            <div class="sourcing-price-actions">${sourceAction(source, product, "열기")}${typeof stockWatchRegistrationButton === "function" ? stockWatchRegistrationButton(product, sourceProduct) : ""}</div>
          </div>`;
        }).join("");

        const sourceFallbackRows = sources
          .filter((source) => !products.some((product) => sourceOwnsProduct(source, product)))
          .filter((source) => source?.resultLinkOnly === true || Number(source?.count || 0) > 0
            || source?.absenceConfirmed === true
            || (source?.store === "병행수입·편집샵" && source?.parallelRetailerListEnforced === true && source?.absenceConfirmed === true)
            || source?.verificationPending || source?.verificationFailed)
          .map((source) => {
            const count = Number(source?.count || 0);
            const officialMallSource = source?.store === "브랜드 공식몰";
            const approvedParallelMissing = source?.store === "병행수입·편집샵"
              && source?.parallelRetailerListEnforced === true && source?.absenceConfirmed === true;
            const message = source?.absenceConfirmed === true
              ? "상품 없음"
              : officialMallSource
              ? "검색 결과"
              : source?.resultLinkOnly === true
              ? "검색 결과 링크"
              : approvedParallelMissing
              ? "상품없음"
              : count > 0
              ? `검색 결과 ${count.toLocaleString("ko-KR")}개 확인 · 상품 상세는 판매처에서 직접 확인`
              : source?.verificationFailed ? "검색 결과 확인이 완료되지 않았습니다." : "판매처에서 직접 확인이 필요합니다.";
            return `<div class="sourcing-price-row">
              <strong class="sourcing-price-store">${text(source?.store || "판매처")}</strong>
              <span class="sourcing-price-title">${text(message)}</span>
              <span class="sourcing-price-unknown">${officialMallSource ? "–" : "가격 확인"}</span>
              <span class="sourcing-price-unknown">–</span>
              <span class="sourcing-price-unknown">–</span>
              <span class="sourcing-price-unknown">–</span>
              <span class="sourcing-price-unknown">–</span>
              ${sourceAction(source, {}, "열기")}
            </div>`;
          }).join("");

        if (!productRows && !sourceFallbackRows) {
          return `<div class="sourcing-price-comparison"><div class="sourcing-list-empty">일치하는 국내 판매 상품을 찾지 못했습니다.</div></div>`;
        }
        return `<div class="sourcing-price-comparison">
          <div class="sourcing-price-row sourcing-price-head"><span>판매처</span><span>상품명</span><span>판매가</span><span>배송비</span><span>실구매가</span><span>재고</span><span>POIZON 대비</span><span>링크</span></div>
          ${productRows}${sourceFallbackRows}
        </div>`;
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
        if (typeof renderVerifiedSpuRows === "function" && products.some((p) => Array.isArray(p.verificationOptions))) return renderVerifiedSpuRows(file, products);
        try {
          const highestSizeByIdentity = highestQualifiedSizeReference(products);
          const pageKeys = products.map((product) => `${brandImportPathKey(file.path)}::${product.key || product.articleNumber || product.spuId}`);
          products.forEach((product, index) => excelPreviewProductCache.set(pageKeys[index], product));
          const columns = document.querySelector("#excel-preview-columns");
          const rows = document.querySelector("#excel-preview-rows");
          if (!columns || !rows) return originalRenderExcelProductRows(file, products);
          columns.innerHTML = `<tr><th class="excel-product-select-column">선택</th><th>이미지</th><th>상품번호</th><th>상품명</th><th>브랜드</th><th>사이즈</th><th>사이즈 판매량</th><th>POIZON 기준가</th><th>국내 최저가</th><th>가격 차이</th><th>예상 마진율</th><th>중국 총판매</th><th>현지 총판매</th><th>국내 상품</th></tr>`;
          rows.innerHTML = products.length ? products.map((product, index) => {
            const key = pageKeys[index];
            const result = excelPreviewSearchResults.get(key);
            const referenceProduct = highestSizeByIdentity.get(sourcingProductIdentity(product)) || product;
            const poizonPrice = verifiedExcelProductPoizonPrice(referenceProduct);
            const comparison = domesticPriceComparison(result, poizonPrice);
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
              <td class="${comparison.className}">${comparison.domesticLowest ? money(comparison.domesticLowest) : result ? "가격 없음" : "검색 후 계산"}</td>
              <td class="${comparison.className}">${signedMoney(comparison.difference)}</td>
              <td class="${comparison.className}"><div class="sourcing-price-summary"><strong>${Number.isFinite(comparison.marginRate) ? `${comparison.marginRate.toFixed(1)}%` : "–"}</strong><small>수수료·배송비 미반영</small></div></td>
              <td>${excelProductMetric(product.totalSalesRaw, product.totalSales)}</td>
              <td>${excelProductMetric(product.localTotalSalesRaw, product.localTotalSales)}</td>
              <td><button type="button" class="excel-product-search sourcing-domestic-search ${search.className}" data-excel-search-product="${encodeURIComponent(key)}" title="국내 정확 상품 검색" ${result?.loading ? "disabled" : ""}>${text(search.label)}</button></td>
            </tr>${result && !result.loading ? `<tr class="excel-product-search-detail ${groupClass}"><td colspan="14"><div class="excel-product-search-result-label"><span></span><strong>${text(productLabel)}</strong>의 판매처별 가격 비교</div>${renderDomestic(result, referenceProduct, key)}</td></tr>` : ""}`;
          }).join("") : `<tr><td class="empty" colspan="14">조건에 맞는 상품이 없습니다.</td></tr>`;
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

(() => {
  if (document.querySelector("style[data-compact-sourcing-list-style]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-compact-sourcing-list-style", "true");
  style.textContent = `
    /* One product per row. Compact sourcing-table layout for every product renderer. */
    #explorer-product-grid{display:flex!important;flex-direction:column!important;gap:0!important;border:1px solid #e5e7eb!important;border-radius:8px!important;overflow:hidden!important;background:#fff!important}
    #explorer-product-grid>.product-selection-toolbar{margin:0!important;padding:7px 9px!important;border-bottom:1px solid #e5e7eb!important;background:#f8fafc!important}
    #explorer-product-grid .explorer-product-row{display:grid!important;grid-template-columns:32px minmax(0,1fr) 68px!important;gap:8px!important;align-items:center!important;min-height:56px!important;margin:0!important;padding:6px 9px!important;border:0!important;border-bottom:1px solid #edf0f3!important;border-radius:0!important;background:#fff!important;box-shadow:none!important}
    #explorer-product-grid .explorer-product-row:nth-of-type(even){background:#fbfcfd!important}
    #explorer-product-grid .explorer-product-row:hover{background:#f6f9fc!important}
    #explorer-product-grid .rank-number{width:26px!important;height:26px!important;border-radius:6px!important;font-size:10px!important;line-height:1!important}
    #explorer-product-grid .product-summary{display:grid!important;grid-template-columns:44px minmax(0,1fr)!important;gap:8px!important;align-items:center!important;min-width:0!important}
    #explorer-product-grid .product-summary img,
    #explorer-product-grid .product-summary .image-placeholder,
    #explorer-product-grid .seller-product-info img,
    #explorer-product-grid .seller-product-info .image-placeholder{width:44px!important;height:44px!important;max-width:44px!important;max-height:44px!important;min-width:44px!important;object-fit:contain!important;border-radius:5px!important;margin:0!important;background:#fff!important}
    #explorer-product-grid .product-summary h3{margin:2px 0!important;font-size:11px!important;line-height:1.25!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;min-height:0!important}
    #explorer-product-grid .product-summary p{margin:0!important;font-size:9px!important;line-height:1.2!important;color:#6b7280!important}
    #explorer-product-grid .explorer-product-meta{margin:2px 0 0!important;font-size:9px!important;line-height:1.2!important;gap:8px!important}
    #explorer-product-grid .product-badges{gap:3px!important}
    #explorer-product-grid .badge{padding:2px 5px!important;font-size:8px!important;line-height:1.1!important}
    #explorer-product-grid .product-select-option{justify-self:end!important;margin:0!important;font-size:9px!important;white-space:nowrap!important}

    /* Domestic matches are subordinate rows, never large cards. */
    #explorer-product-grid .domestic-inventory{grid-column:2/-1!important;margin:0!important;padding:5px 0 0!important;border-top:1px solid #f0f2f4!important;min-width:0!important}
    #explorer-product-grid .inventory-heading{min-height:28px!important;margin:0 0 4px!important;gap:6px!important}
    #explorer-product-grid .inventory-heading button{padding:4px 7px!important;border-radius:5px!important;font-size:9px!important}
    .domestic-source-list.sourcing-product-list{display:flex!important;flex-direction:column!important;gap:0!important;border:1px solid #e5e7eb!important;border-radius:6px!important;overflow:hidden!important;background:#fff!important;box-shadow:none!important}
    .sourcing-product-list-row{display:grid!important;grid-template-columns:44px minmax(0,1fr) 100px!important;gap:8px!important;align-items:center!important;min-height:56px!important;padding:5px 7px!important;border:0!important;border-bottom:1px solid #edf0f3!important;border-radius:0!important;background:#fff!important;box-shadow:none!important}
    .sourcing-product-list-row:nth-child(even){background:#fbfcfd!important}
    .sourcing-product-thumb{width:44px!important;height:44px!important;max-width:44px!important;max-height:44px!important;min-width:44px!important;border-radius:5px!important;border:1px solid #eceff2!important;overflow:hidden!important;background:#f8fafc!important;font-size:8px!important}
    .sourcing-product-thumb img{width:44px!important;height:44px!important;max-width:44px!important;max-height:44px!important;object-fit:contain!important;margin:0!important;background:#fff!important}
    .sourcing-product-info{gap:1px!important;min-width:0!important}
    .sourcing-product-store{gap:4px!important;font-size:9px!important;line-height:1.2!important}
    .sourcing-product-store .official{padding:2px 5px!important;font-size:8px!important}
    .sourcing-product-title{margin:0!important;font-size:11px!important;line-height:1.25!important;display:-webkit-box!important;-webkit-line-clamp:1!important;-webkit-box-orient:vertical!important;overflow:hidden!important}
    .sourcing-product-meta{gap:4px 7px!important;font-size:9px!important;line-height:1.15!important}
    .sourcing-product-actions{min-width:100px!important;gap:3px!important;justify-content:center!important}
    .sourcing-product-price{font-size:10px!important;line-height:1.1!important}
    .sourcing-product-actions button{min-width:82px!important;padding:5px 6px!important;border-radius:5px!important;font-size:9px!important}
    .sourcing-source-fallback{display:grid!important;grid-template-columns:minmax(110px,155px) minmax(80px,1fr) 84px!important;gap:7px!important;align-items:center!important;min-height:36px!important;padding:5px 7px!important;border:0!important;border-bottom:1px solid #edf0f3!important;border-radius:0!important;background:#fff!important}
    .sourcing-source-fallback:nth-child(even){background:#fbfcfd!important}
    .sourcing-source-fallback strong{font-size:10px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    .sourcing-source-fallback span{display:inline-flex!important;width:max-content!important;max-width:100%!important;align-items:center!important;padding:2px 6px!important;border-radius:999px!important;background:#ecfdf3!important;color:#147a4a!important;font-size:9px!important;font-weight:800!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    .sourcing-source-fallback button{min-width:78px!important;padding:4px 6px!important;border-radius:5px!important;font-size:9px!important;font-weight:800!important}

    /* Seller-result path uses a separate renderer; keep it equally dense. */
    #explorer-product-grid .seller-result-table{overflow:auto!important;background:#fff!important}
    #explorer-product-grid .seller-result-row{min-height:58px!important;margin:0!important;padding:5px 7px!important;border-radius:0!important;border-bottom:1px solid #edf0f3!important;background:#fff!important;box-shadow:none!important}
    #explorer-product-grid .seller-result-row:nth-child(even){background:#fbfcfd!important}
    #explorer-product-grid .seller-product-info{display:grid!important;grid-template-columns:22px 44px minmax(0,1fr)!important;gap:7px!important;align-items:center!important;min-width:0!important}
    #explorer-product-grid .seller-product-info code,#explorer-product-grid .seller-product-info small{font-size:9px!important;line-height:1.15!important}
    #explorer-product-grid .seller-product-info strong{font-size:10px!important;line-height:1.2!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}

    /* Excel/product view follows the same visual density. */
    #excel-preview-grid{font-size:10px!important}
    #excel-preview-grid th{font-size:9px!important;padding:6px 7px!important;white-space:nowrap!important}
    #excel-preview-grid td{padding:5px 7px!important}
    #excel-preview-grid .excel-product-row td{height:42px!important}
    #excel-preview-grid img{width:44px!important;height:44px!important;max-width:44px!important;max-height:44px!important;object-fit:contain!important;margin:0 auto!important;border-radius:5px!important;background:#fff!important}
    #excel-preview-grid .excel-product-image img{width:34px!important;height:34px!important;max-width:34px!important;max-height:34px!important}
    #excel-preview-grid .excel-product-search-detail td{padding:4px 6px!important;background:#fff!important;border-left:2px solid #e5e7eb!important}
    #excel-preview-grid .excel-product-search-result-label{margin:0 0 4px!important;padding:3px 6px!important;border-radius:5px!important;background:#f8fafc!important;font-size:9px!important}

    @media (max-width:980px){
      #explorer-product-grid .explorer-product-row{grid-template-columns:28px minmax(0,1fr) 58px!important;min-height:52px!important;padding:5px 7px!important}
      #explorer-product-grid .product-summary{grid-template-columns:40px minmax(0,1fr)!important}
      #explorer-product-grid .product-summary img,
      #explorer-product-grid .product-summary .image-placeholder,
      #explorer-product-grid .seller-product-info img,
      #explorer-product-grid .seller-product-info .image-placeholder,
      .sourcing-product-thumb,
      .sourcing-product-thumb img{width:40px!important;height:40px!important;max-width:40px!important;max-height:40px!important;min-width:40px!important}
      .sourcing-product-list-row{grid-template-columns:40px minmax(0,1fr) 86px!important;min-height:52px!important}
      .sourcing-source-fallback{grid-template-columns:minmax(95px,135px) minmax(70px,1fr) 76px!important}
    }
  `;
  document.head.appendChild(style);
})();

(() => {
  const marker = "data-around-g-domestic-image-clamp";
  if (document.documentElement.hasAttribute(marker)) return;
  document.documentElement.setAttribute(marker, "true");

  const selector = [
    "#excel-preview-rows .excel-product-search-detail img",
    "#explorer-product-grid .domestic-inventory img",
    ".domestic-source-list img",
    ".sourcing-product-list-row img"
  ].join(",");

  const hardClampImage = (image) => {
    if (!(image instanceof HTMLImageElement)) return;
    image.width = 44;
    image.height = 44;
    image.style.setProperty("width", "44px", "important");
    image.style.setProperty("height", "44px", "important");
    image.style.setProperty("max-width", "44px", "important");
    image.style.setProperty("max-height", "44px", "important");
    image.style.setProperty("min-width", "44px", "important");
    image.style.setProperty("min-height", "44px", "important");
    image.style.setProperty("object-fit", "contain", "important");
    image.style.setProperty("object-position", "center", "important");
    image.style.setProperty("display", "block", "important");
    image.style.setProperty("margin", "0", "important");
    image.style.setProperty("flex", "0 0 44px", "important");

    const thumb = image.closest(".sourcing-product-thumb");
    if (thumb) {
      thumb.style.setProperty("width", "44px", "important");
      thumb.style.setProperty("height", "44px", "important");
      thumb.style.setProperty("max-width", "44px", "important");
      thumb.style.setProperty("max-height", "44px", "important");
      thumb.style.setProperty("min-width", "44px", "important");
      thumb.style.setProperty("overflow", "hidden", "important");
      thumb.style.setProperty("flex", "0 0 44px", "important");
    }

    const imageLink = image.closest(".excel-image-cell a");
    if (imageLink) {
      imageLink.style.setProperty("display", "block", "important");
      imageLink.style.setProperty("width", "44px", "important");
      imageLink.style.setProperty("height", "44px", "important");
      imageLink.style.setProperty("max-width", "44px", "important");
      imageLink.style.setProperty("max-height", "44px", "important");
      imageLink.style.setProperty("overflow", "hidden", "important");
    }
  };

  const clampWithin = (root = document) => {
    if (root instanceof HTMLImageElement && root.matches(selector)) hardClampImage(root);
    if (!root?.querySelectorAll) return;
    root.querySelectorAll(selector).forEach(hardClampImage);
  };

  clampWithin(document);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) clampWithin(node);
      }
    }
  });

  [document.querySelector("#excel-preview-rows"), document.querySelector("#explorer-product-grid")]
    .filter(Boolean)
    .forEach((root) => observer.observe(root, { childList: true, subtree: true }));
})();

(() => {
  if (document.querySelector("style[data-product-image-text-alignment]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-product-image-text-alignment", "true");
  style.textContent = `
    /* Product layout rule: image stays on the left, copy stays on the right. */
    #explorer-product-grid .product-summary,
    .candidate-summary{
      display:flex!important;
      flex-direction:row!important;
      align-items:flex-start!important;
      gap:8px!important;
      min-width:0!important;
    }

    #explorer-product-grid .product-summary>img,
    #explorer-product-grid .product-summary>.image-placeholder{
      flex:0 0 44px!important;
      align-self:flex-start!important;
      margin:0!important;
    }

    #explorer-product-grid .product-summary>div{
      display:flex!important;
      flex:1 1 auto!important;
      flex-direction:column!important;
      align-items:flex-start!important;
      min-width:0!important;
      margin:0!important;
      padding:0!important;
    }

    .candidate-summary>.candidate-image{
      flex:0 0 48px!important;
      align-self:flex-start!important;
      margin:0!important;
    }

    .candidate-summary>span{
      display:flex!important;
      flex:1 1 auto!important;
      flex-direction:column!important;
      align-items:flex-start!important;
      min-width:0!important;
      margin:0!important;
      padding:0!important;
    }

    .sourcing-product-list-row{
      display:flex!important;
      flex-direction:row!important;
      align-items:flex-start!important;
      gap:8px!important;
      min-width:0!important;
    }

    .sourcing-product-thumb{
      flex:0 0 44px!important;
      align-self:flex-start!important;
      margin:0!important;
    }

    .sourcing-product-info{
      display:flex!important;
      flex:1 1 auto!important;
      flex-direction:column!important;
      align-items:flex-start!important;
      min-width:0!important;
      margin:0!important;
      padding:0!important;
    }

    .sourcing-product-actions{
      flex:0 0 100px!important;
      align-self:center!important;
      margin-left:auto!important;
    }

    #explorer-product-grid .seller-product-info{
      align-items:flex-start!important;
    }

    #explorer-product-grid .product-summary h3,
    #explorer-product-grid .product-summary p,
    .candidate-summary b,
    .candidate-summary small,
    .sourcing-product-store,
    .sourcing-product-title,
    .sourcing-product-meta{
      margin-top:0!important;
    }

    /* Excel product rows remain tables, but image and identity cells share the same top line. */
    #excel-preview-grid .excel-product-row .excel-product-image,
    #excel-preview-grid .excel-product-row .excel-product-image+td,
    #excel-preview-grid .excel-product-row .excel-product-image+td+td,
    #excel-preview-grid .excel-product-row .excel-product-image+td+td+td{
      vertical-align:top!important;
    }
  `;
  document.head.appendChild(style);
})();
