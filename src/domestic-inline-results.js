(() => {
  if (globalThis.__aroundGDomesticInlineResultsInstalled) return;

  const STYLE_MARKER = "data-domestic-inline-list-style";

  function safeText(value) {
    try {
      if (typeof text === "function") return text(value ?? "");
    } catch {}
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeMoney(value) {
    const number = Number(value || 0);
    if (!(number > 0)) return "-";
    try {
      if (typeof money === "function") return money(number);
    } catch {}
    return `${Math.round(number).toLocaleString("ko-KR")}원`;
  }

  function installStyles() {
    if (document.querySelector(`style[${STYLE_MARKER}]`)) return;
    const style = document.createElement("style");
    style.setAttribute(STYLE_MARKER, "true");
    style.textContent = `
      /* Keep the POIZON row compact and place retailer results in the next full-width row. */
      #excel-preview.product-view #excel-preview-grid table{width:100%!important;min-width:980px!important;table-layout:fixed!important}
      #excel-preview.product-view #excel-preview-grid .excel-product-row>td{height:54px!important;vertical-align:middle!important}
      #excel-preview.product-view #excel-preview-grid .excel-product-search-detail{display:table-row!important}
      #excel-preview.product-view #excel-preview-grid .excel-product-search-detail>td{width:auto!important;height:auto!important;padding:5px 9px!important;white-space:normal!important;overflow:visible!important;text-align:left!important;vertical-align:top!important}
      .domestic-inline-detail-label{display:flex!important;align-items:center!important;gap:7px!important;margin:0 0 6px!important;color:#314a68!important;font-size:12px!important;font-weight:800!important}
      .domestic-inline-detail-label>span{width:7px!important;height:7px!important;border-radius:50%!important;background:#4b8ff0!important}
      .excel-product-group-amber .domestic-inline-detail-label>span{background:#e6a23c!important}
      .domestic-inline-detail-label>em{margin-left:auto!important;color:#64748b!important;font-size:11px!important;font-style:normal!important}

      .domestic-inline-results{display:flex!important;flex-direction:column!important;gap:0!important;width:100%!important;min-width:0!important;border-top:1px solid #dfe5ec!important;background:transparent!important;border-radius:0!important;box-shadow:none!important}
      .domestic-inline-head,.domestic-inline-row{display:grid!important;grid-template-columns:120px minmax(240px,1fr) 130px 100px 180px!important;gap:8px!important;align-items:center!important}
      .domestic-inline-head{min-height:28px!important;padding:4px 0!important;border-bottom:1px solid #dfe5ec!important;color:#64748b!important;font-size:10px!important;font-weight:800!important;text-align:left!important}
      .domestic-inline-head span:nth-child(4),.domestic-inline-head span:nth-child(5){text-align:right!important}
      .domestic-inline-row{min-height:40px!important;padding:5px 0!important;border:0!important;border-bottom:1px solid #eef1f4!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;font-size:11px!important;line-height:1.35!important}
      .domestic-inline-row:last-child{border-bottom:0!important}
      .domestic-inline-row:hover{background:#fafbfd!important}
      .domestic-inline-store{display:flex!important;align-items:center!important;gap:3px!important;min-width:0!important;color:#334155!important;font-weight:800!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      .domestic-inline-official{flex:0 0 auto!important;padding:2px 5px!important;border-radius:999px!important;background:#fff3e8!important;color:#b86624!important;font-size:10px!important;font-weight:800!important}
      .domestic-inline-title{min-width:0!important;color:#111827!important;font-weight:650!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      .domestic-inline-code{min-width:0!important;color:#64748b!important;font-family:inherit!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      .domestic-inline-price{text-align:right!important;color:#111827!important;font-weight:800!important;white-space:nowrap!important}
      .domestic-inline-price-fetch{min-width:76px!important;border-color:#9cc5ff!important;background:#f3f8ff!important;color:#1769c2!important}
      .domestic-inline-price-fetch:disabled{opacity:.65!important;cursor:wait!important}
      .domestic-inline-row button{min-width:64px!important;height:30px!important;padding:5px 8px!important;border-radius:6px!important;font-size:10px!important;font-weight:800!important;white-space:nowrap!important;overflow:visible!important}
      .domestic-inline-row .stock-watch-register-button{min-width:96px!important;flex:0 0 96px!important}
      .domestic-inline-fallback .domestic-inline-title{color:#64748b!important;font-weight:600!important}
      .domestic-inline-empty{padding:8px 0!important;color:#7b8794!important;font-size:11px!important;text-align:left!important}
      .domestic-inline-empty.error{color:#b42318!important;font-weight:700!important}
      .domestic-inline-warning{padding:5px 0!important;color:#9a6700!important;font-size:8px!important;font-weight:700!important}

      /* Explorer/popular views also use the same compact rows without thumbnails. */
      .domestic-source-list.sourcing-product-list{display:flex!important;flex-direction:column!important;gap:0!important;border:0!important;border-radius:0!important;overflow:visible!important;background:transparent!important;box-shadow:none!important}
      .domestic-source-list.sourcing-product-list .sourcing-product-list-row,
      .domestic-source-list.sourcing-product-list .sourcing-source-fallback,
      .domestic-source-list.sourcing-product-list .sourcing-product-thumb{display:none!important}

      @media(max-width:1180px){
        .domestic-inline-head,.domestic-inline-row{grid-template-columns:100px minmax(190px,1fr) 110px 90px 168px!important;gap:6px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function searchPresentation(result) {
    if (globalThis.AroundGDomesticVerdict?.resultPresentation) {
      return globalThis.AroundGDomesticVerdict.resultPresentation(result);
    }
    if (result?.loading) return { label: "검색 중…", className: "loading" };
    if (result?.error) return { label: "검색 실패", className: "error" };
    if (!result) return { label: "국내 검색", className: "pending" };
    const productCount = Array.isArray(result?.products) ? result.products.length : 0;
    if (productCount > 0) return { label: `상품 ${productCount.toLocaleString("ko-KR")}개`, className: "available" };
    const verifiedCount = (result?.sources || []).reduce((sum, source) =>
      sum + (source?.countVerified ? Number(source?.count || 0) : 0), 0);
    if (verifiedCount > 0) return { label: `결과 ${verifiedCount.toLocaleString("ko-KR")}개`, className: "available" };
    const needsReview = (result?.sources || []).some((source) =>
      source?.verificationPending || source?.verificationFailed || source?.securityVerificationRequired || source?.loginRequired
    );
    return needsReview ? { label: "확인 필요", className: "pending" } : { label: "상품 없음", className: "missing" };
  }

  function sourceOwnsProduct(source, product) {
    const sourceStore = String(source?.store || "");
    const productStore = String(product?.store || product?.retailerName || "");
    if (sourceStore === String(product?.sourceStore || "")) return true;
    if (sourceStore === productStore) return true;
    if (sourceStore === "SSG" && /^SSG(?:\s|$)/.test(productStore)) return true;
    if (sourceStore === "병행수입·편집샵" && product?.parallelRetailerVerified === true
      && (/병행수입/.test(productStore)
        || String(product?.retailerName || "").startsWith("병행수입"))) return true;
    return false;
  }

  function approvedDomesticProduct(product) {
    const store = String(product?.store || product?.sourceStore || "");
    const retailer = String(product?.retailerName || "");
    const parallel = store === "병행수입·편집샵" || store === "SSG 병행수입"
      || product?.ssgClassification === "parallel_import" || retailer.startsWith("병행수입");
    return !parallel || product?.parallelRetailerVerified === true;
  }

  function displayedProductTitle(product = {}, sourceProduct = {}) {
    const raw = String(product?.title || product?.name || product?.articleNumber || "국내 상품")
      .replace(/\s+/g, " ").trim();
    const store = String(product?.sourceStore || product?.store || "");
    if (store !== "네이버 패션타운") return raw;
    const sourceTitle = String(sourceProduct?.apiTitle || sourceProduct?.title || sourceProduct?.name || "")
      .replace(/\s+/g, " ").trim();
    // Naver sometimes exposes the entire card accessibility text as the link
    // title. Keep that raw text for matching, but never show delivery, option,
    // sorting and promotion copy as the product name.
    const wholeCardText = raw.length > 72
      || /(배송\s*옵션|옵션\s*펼치기|가격대|가격순|인기순|리뷰|라이브|선택됨)/i.test(raw);
    const selected = wholeCardText && sourceTitle ? sourceTitle : raw;
    return selected.length > 46 ? `${selected.slice(0, 45).trim()}…` : selected;
  }

  function sourceAction(source = {}, product = {}, sourceProduct = {}, label = "열기") {
    const productUrl = String(product?.url || "").trim();
    const openUrl = String(productUrl
      || source?.verifiedProductUrl
      || source?.officialProductUrl
      || source?.resultsUrl
      || source?.searchResultsUrl
      || source?.officialSearchUrl
      || source?.homepageUrl
      || source?.searchUrl
      || "").trim();
    const query = source?.searchQuery || sourceProduct?.articleNumber || sourceProduct?.productCode
      || sourceProduct?.spuId || "";
    if (!openUrl) return `<button type="button" disabled>${label}</button>`;
    if (source?.officialStatus && !productUrl) {
      return `<button type="button" data-official-homepage="${encodeURIComponent(source.homepageUrl || openUrl)}" data-official-query="${encodeURIComponent(query)}">${label}</button>`;
    }
    return `<button type="button" data-url="${encodeURIComponent(openUrl)}">${label}</button>`;
  }

  function inlineRenderDomestic(result, sourceProduct = {}, contextKey = "") {
    if (!result) return `<div class="domestic-inline-empty">국내 상품 검색 전</div>`;
    if (result.loading) return `<div class="domestic-inline-empty">국내 판매처 검색 중…</div>`;
    if (result.error) return `<div class="domestic-inline-empty error">국내 검색 실패: ${safeText(result.error)}</div>`;

    const products = Array.isArray(result.products) ? result.products.filter((product) => product && approvedDomesticProduct(product)) : [];
    const sources = Array.isArray(result.sources) ? result.sources : [];
    const sourceForProduct = (product) => sources.find((source) => sourceOwnsProduct(source, product)) || {};

    const rows = products.map((product) => {
      const source = sourceForProduct(product);
      const retailer = product?.retailerName || product?.store || source?.store || "판매처";
      const rawTitle = product?.title || product?.name || product?.articleNumber || "국내 상품";
      const title = displayedProductTitle(product, sourceProduct);
      const article = product?.articleNumber || sourceProduct?.articleNumber || sourceProduct?.productCode || "-";
      const official = product?.officialStoreVerified === true || Boolean(source?.officialStatus);
      return `<div class="domestic-inline-row">
        <div class="domestic-inline-store" title="${safeText(retailer)}"><span>${safeText(retailer)}</span>${official ? `<span class="domestic-inline-official">공식</span>` : ""}</div>
        <div class="domestic-inline-title" title="${safeText(rawTitle)}">${safeText(title)}</div>
        <div class="domestic-inline-code" title="${safeText(article)}">${safeText(article)}</div>
        <div class="domestic-inline-price">${safeMoney(product?.price)}</div>
        <div class="domestic-inline-actions">${sourceAction(source, product, sourceProduct)}${typeof stockWatchRegistrationButton === "function" ? stockWatchRegistrationButton(product, sourceProduct) : ""}</div>
      </div>`;
    });

    const representedSources = new Set();
    for (const product of products) {
      const source = sourceForProduct(product);
      if (source?.store) representedSources.add(String(source.store));
    }

    for (const source of sources) {
      const store = String(source?.store || "판매처");
      if (representedSources.has(store)) continue;
      const count = Number(source?.count || 0);
      const hasUsefulLink = Boolean(source?.verifiedProductUrl || source?.officialProductUrl || source?.resultsUrl
        || source?.searchResultsUrl || source?.officialSearchUrl || source?.homepageUrl || source?.searchUrl);
      const verdict = globalThis.AroundGDomesticVerdict?.sourceVerdict
        ? globalThis.AroundGDomesticVerdict.sourceVerdict(source, [])
        : count > 0
          ? { label: `상품 있음 · ${count.toLocaleString("ko-KR")}개`, state: "available" }
          : source?.absenceConfirmed
            ? { label: "상품 없음", state: "missing" }
            : { label: "확인 중", state: "pending" };
      const searched = source?.searchCompleted || source?.searchSubmitted || source?.countVerified
        || source?.absenceConfirmed || source?.presenceConfirmed;
      if (!(count > 0 || searched || source?.verificationPending || source?.verificationFailed || hasUsefulLink)) continue;
      const message = verdict.label;
      const naverPriceAction = store === "네이버 패션타운" && contextKey
        ? `<button type="button" class="domestic-inline-price-fetch" data-inline-naver-price="${encodeURIComponent(contextKey)}">가격 가져오기</button>`
        : "-";
      rows.push(`<div class="domestic-inline-row domestic-inline-fallback">
        <div class="domestic-inline-store" title="${safeText(store)}">${safeText(store)}</div>
        <div class="domestic-inline-title">${safeText(message)}</div>
        <div class="domestic-inline-code">${safeText(source?.searchQuery || sourceProduct?.articleNumber || "-")}</div>
        <div class="domestic-inline-price">${naverPriceAction}</div>
        <div>${sourceAction(source, {}, sourceProduct)}</div>
      </div>`);
    }

    const warningCount = Array.isArray(result.technicalWarnings) ? result.technicalWarnings.length : 0;
    const warning = warningCount
      ? `<div class="domestic-inline-warning">일부 판매처 추가 확인 실패 · 확보된 검색 결과를 표시합니다.</div>`
      : "";
    return rows.length
      ? `${warning}<div class="domestic-inline-results"><div class="domestic-inline-head"><span>판매처</span><span>상품명</span><span>품번</span><span>가격</span><span>링크</span></div>${rows.join("")}</div>`
      : `<div class="domestic-inline-empty">일치하는 국내 판매 상품 없음</div>`;
  }

  function sizeSalesValue(product) {
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
    const value = sizeSalesValue(product);
    return value > 0 ? `판매량 ${Math.round(value).toLocaleString("ko-KR")}` : "판매량 -";
  }

  function productIdentity(product) {
    return String(product?.articleNumber || product?.spuId || product?.key || "").trim().toUpperCase();
  }

  function highestQualifiedSizeReference(products = []) {
    const best = new Map();
    for (const product of Array.isArray(products) ? products : []) {
      const sales = sizeSalesValue(product);
      const price = Number(product?.averagePrice || 0);
      if (sales < 30 || price <= 0) continue;
      const identity = productIdentity(product);
      if (!identity) continue;
      const current = best.get(identity);
      if (!current || price > Number(current?.averagePrice || 0)) best.set(identity, product);
    }
    return best;
  }

  function installRenderers() {
    installStyles();
    try {
      inlineRenderDomestic.__aroundGMusinsaList = true;
      inlineRenderDomestic.__aroundGInlineList = true;
      renderDomestic = inlineRenderDomestic;
    } catch (error) {
      console.warn("[domestic-inline-results] renderDomestic override skipped", error);
    }

    try {
      if (typeof renderExcelProductRows !== "function") return;
      const previousRenderer = renderExcelProductRows;
      const inlineExcelRenderer = function inlineExcelProductRows(file, products = []) {
        try {
          const columns = document.querySelector("#excel-preview-columns");
          const rows = document.querySelector("#excel-preview-rows");
          if (!columns || !rows) return previousRenderer(file, products);
          const highestSizeByIdentity = highestQualifiedSizeReference(products);
          const pageKeys = products.map((product) => `${brandImportPathKey(file.path)}::${product.key || product.articleNumber || product.spuId}`);
          products.forEach((product, index) => excelPreviewProductCache.set(pageKeys[index], product));
          columns.innerHTML = `<tr><th class="excel-product-select-column">선택</th><th>이미지</th><th>상품번호</th><th>상품명</th><th>브랜드</th><th>사이즈</th><th>사이즈 판매량</th><th>사이즈 최고가</th><th>중국 총판매</th><th>현지 총판매</th></tr>`;
          rows.innerHTML = products.length ? products.map((product, index) => {
            const key = pageKeys[index];
            const result = excelPreviewSearchResults.get(key);
            const referenceProduct = highestSizeByIdentity.get(productIdentity(product)) || product;
            const poizonPrice = verifiedExcelProductPoizonPrice(referenceProduct);
            const search = searchPresentation(result);
            const groupClass = index % 2 === 0 ? "excel-product-group-blue" : "excel-product-group-amber";
            return `<tr class="excel-product-row ${groupClass}">
              <td class="excel-product-select-column"><input type="checkbox" data-excel-product-select="${encodeURIComponent(key)}" aria-label="제품 선택"></td>
              <td class="excel-product-image">${product.logoUrl ? `<img src="${safeText(product.logoUrl)}" alt="">` : "-"}</td>
              <td><b>${safeText(product.articleNumber || "-")}</b></td>
              <td title="${safeText(product.title || "")}">${safeText(product.title || "-")}</td>
              <td>${safeText(product.brandName || "-")}</td>
              <td class="sourcing-size">${safeText(referenceProduct.option || product.option || "-")}</td>
              <td><span class="sourcing-size-sales">${safeText(displaySizeSales(referenceProduct))}</span></td>
              <td>${poizonPrice ? safeMoney(poizonPrice) : "가격 없음"}</td>
              <td>${excelProductMetric(product.totalSalesRaw, product.totalSales)}</td>
              <td>${excelProductMetric(product.localTotalSalesRaw, product.localTotalSales)}</td>
            </tr>${result ? `<tr class="excel-product-search-detail ${groupClass}"><td colspan="10"><div class="domestic-inline-detail-label"><span></span><strong>${safeText(product.title || product.articleNumber || "상품")}</strong> 국내 검색 결과<em>${safeText(search.label)}</em></div>${inlineRenderDomestic(result, product, key)}</td></tr>` : ""}`;
          }).join("") : `<tr><td class="empty" colspan="10">조건에 맞는 상품이 없습니다.</td></tr>`;
          return pageKeys;
        } catch (error) {
          console.warn("[domestic-inline-results] excel renderer fallback", error);
          return previousRenderer(file, products);
        }
      };
      inlineExcelRenderer.__aroundGSourcingView = true;
      inlineExcelRenderer.__aroundGInlineList = true;
      renderExcelProductRows = inlineExcelRenderer;

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
      console.warn("[domestic-inline-results] renderExcelProductRows override skipped", error);
    }
  }

  installRenderers();

  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-inline-naver-price]");
    if (!button || button.disabled) return;
    const key = decodeURIComponent(button.dataset.inlineNaverPrice || "");
    const product = typeof excelPreviewProductCache !== "undefined" ? excelPreviewProductCache.get(key) : null;
    if (!product || typeof window.aroundG?.lookupDomesticPrice !== "function") return;
    event.preventDefault();
    button.disabled = true;
    button.textContent = "확인 중…";
    try {
      const response = await window.aroundG.lookupDomesticPrice({
        articleNumber: product.articleNumber || "",
        productCode: product.productCode || product.spuId || product.globalSpuId || "",
        brand: product.brandName || product.brand || "",
        title: product.apiTitle || product.title || product.name || "",
      });
      if (!response?.ok || !Array.isArray(response.candidates) || !response.candidates.length) {
        button.disabled = false;
        button.textContent = "다시 가져오기";
        button.title = response?.message || "가격을 확인하지 못했습니다.";
        return;
      }
      const current = excelPreviewSearchResults.get(key) || { products: [], sources: [] };
      const candidates = response.candidates.filter((candidate) => Number(candidate?.price || 0) > 0);
      const byUrl = new Map();
      for (const candidate of [...candidates, ...(current.products || [])]) {
        const identity = String(candidate?.url || `${candidate?.store || "판매처"}:${candidate?.title || ""}:${candidate?.price || 0}`);
        if (!byUrl.has(identity)) byUrl.set(identity, candidate);
      }
      excelPreviewSearchResults.set(key, {
        ...current,
        error: "",
        products: [...byUrl.values()],
        domesticPriceCandidates: [
          ...candidates,
          ...(current.domesticPriceCandidates || []),
        ],
      });
      if (activeExcelPreview?.file?.path && typeof persistExcelSearchResults === "function") {
        persistExcelSearchResults(activeExcelPreview.file.path);
      }
      if (activeExcelPreview?.file && activeExcelPreview?.viewMode === "products") {
        renderExcelProductRows(activeExcelPreview.file, excelPreviewPageProducts);
      }
    } catch (error) {
      button.disabled = false;
      button.textContent = "다시 가져오기";
      button.title = error instanceof Error ? error.message : "가격 확인 요청에 실패했습니다.";
    }
  });

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      try {
        if (!renderDomestic?.__aroundGInlineList || !renderExcelProductRows?.__aroundGInlineList) installRenderers();
      } catch {}
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  globalThis.__aroundGDomesticInlineResultsInstalled = true;
})();
