(() => {
  const state = {
    filePath: "",
    columnCount: 0,
    layout: [],
    contextIndex: -1,
    resize: null,
    loadSequence: 0,
    scheduled: false,
  };
  const COLUMN_MODE_KEY = "around-g-excel-column-mode-v1";

  function previewState() {
    try {
      return activeExcelPreview || null;
    } catch {
      return null;
    }
  }

  function statusElement() {
    return document.querySelector("#excel-filter-status") || document.querySelector("#excel-files-status");
  }

  function setStatus(message, error = false) {
    const status = statusElement();
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error", error);
    status.classList.toggle("success", !error && Boolean(message));
  }

  function layoutEntry(index, create = false) {
    let entry = state.layout.find((item) => Number(item.index) === Number(index));
    if (!entry && create) {
      entry = { index: Number(index), hidden: false };
      state.layout.push(entry);
    }
    return entry || null;
  }

  function headerCells() {
    const rawHeaders = [...document.querySelectorAll("#excel-preview-columns .excel-raw-data-heading")];
    return rawHeaders.length ? rawHeaders : [...document.querySelectorAll("#excel-preview-columns th")].slice(2);
  }

  function assignColumnIndexes() {
    const headers = headerCells();
    headers.forEach((header, index) => {
      header.dataset.excelColumnIndex = String(index);
      header.classList.add("excel-layout-header");
      if (!header.querySelector(".excel-column-resizer")) {
        const handle = document.createElement("i");
        handle.className = "excel-column-resizer";
        handle.dataset.excelResizeIndex = String(index);
        handle.setAttribute("aria-hidden", "true");
        header.appendChild(handle);
      }
    });
    const rawView = headers.some((header) => header.classList.contains("excel-raw-data-heading"));
    document.querySelectorAll("#excel-preview-rows tr").forEach((row) => {
      const cells = rawView
        ? [...row.querySelectorAll(".excel-raw-data-cell")]
        : [...row.querySelectorAll("td")].slice(1);
      cells.forEach((cell, index) => {
        cell.dataset.excelColumnIndex = String(index);
      });
    });
    state.columnCount = headers.length;
    return headers;
  }

  function applyColumn(index) {
    const entry = layoutEntry(index);
    const hidden = Boolean(entry?.hidden);
    const width = Number(entry?.widthPx);
    document.querySelectorAll(`[data-excel-column-index="${index}"]`).forEach((cell) => {
      cell.classList.toggle("excel-column-hidden", hidden);
      if (Number.isFinite(width)) {
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${width}px`;
        cell.style.maxWidth = `${width}px`;
      } else {
        cell.style.removeProperty("width");
        cell.style.removeProperty("min-width");
        cell.style.removeProperty("max-width");
      }
    });
  }

  function hiddenCount() {
    return state.layout.filter((entry) => entry.hidden).length;
  }

  function applyLayout() {
    const headers = assignColumnIndexes();
    headers.forEach((_header, index) => applyColumn(index));
    const showAll = document.querySelector("#excel-show-hidden-columns");
    if (showAll) showAll.hidden = hiddenCount() === 0;
    const menuShowAll = document.querySelector("#excel-column-show-all");
    if (menuShowAll) menuShowAll.hidden = hiddenCount() === 0;
  }

  async function loadLayout() {
    const preview = previewState();
    if (preview?.viewMode === "products") return;
    const filePath = String(preview?.file?.path || "").trim();
    const headers = assignColumnIndexes();
    if (!filePath || !headers.length) return;
    if (state.filePath === filePath && state.columnCount === headers.length) {
      applyLayout();
      return;
    }
    const sequence = ++state.loadSequence;
    state.filePath = filePath;
    state.columnCount = headers.length;
    const result = await window.aroundG.getExcelColumnLayout(filePath, headers.length);
    if (sequence !== state.loadSequence || state.filePath !== filePath) return;
    if (!result?.ok) {
      state.layout = [];
      applyLayout();
      setStatus(`열 설정 불러오기 실패: ${result?.message || "원본 Excel을 읽을 수 없습니다."}`, true);
      return;
    }
    state.layout = Array.isArray(result.columnLayout) ? result.columnLayout : [];
    const integratedRawView = preview?.viewMode === "raw"
      && (() => { try { return Boolean(excelPreviewIntegrated); } catch { return false; } })();
    const compactMode = localStorage.getItem(COLUMN_MODE_KEY) !== "all";
    if (integratedRawView && compactMode) {
      const count = applySourcingColumns(false);
      if (count) {
        applyLayout();
        void persistLayout(`${count}개 불필요 열을 자동으로 숨겼습니다`);
        return;
      }
    }
    applyLayout();
  }

  async function persistLayout(message) {
    const preview = previewState();
    const filePath = String(preview?.file?.path || state.filePath || "").trim();
    if (!filePath) return;
    setStatus("열 설정을 현재 화면에 적용하는 중입니다.");
    const result = await window.aroundG.updateExcelColumnLayout(filePath, state.layout, state.columnCount);
    if (!result?.ok) {
      setStatus(`열 설정 저장 실패: ${result?.message || "원본 Excel을 수정할 수 없습니다."}`, true);
      return;
    }
    state.layout = Array.isArray(result.columnLayout) ? result.columnLayout : state.layout;
    applyLayout();
    setStatus(`${message} · 원본 Excel 파일은 변경하지 않았습니다.`);
  }

  function visibleColumnCount() {
    return Math.max(0, state.columnCount - hiddenCount());
  }

  function hideColumn(index) {
    if (index < 0 || index >= state.columnCount) return;
    if (visibleColumnCount() <= 1) {
      setStatus("마지막 표시 열은 숨길 수 없습니다.", true);
      return;
    }
    const entry = layoutEntry(index, true);
    entry.hidden = true;
    applyLayout();
    const title = headerCells()[index]?.textContent?.trim() || `열 ${index + 1}`;
    void persistLayout(`“${title}” 열을 숨겼습니다`);
  }

  function showAllColumns() {
    if (!hiddenCount()) return;
    state.layout.forEach((entry) => {
      entry.hidden = false;
    });
    localStorage.setItem(COLUMN_MODE_KEY, "all");
    applyLayout();
    void persistLayout("숨긴 열을 모두 다시 표시했습니다");
  }

  function normalizedHeader(header) {
    return String(header?.childNodes?.[0]?.textContent || header?.textContent || "")
      .normalize("NFKC")
      .replace(/[^a-z0-9가-힣]+/gi, "")
      .toLowerCase();
  }

  function sourcingEssentialColumn(header) {
    const value = normalizedHeader(header);
    return /^(?:spu이미지|상품이미지|이미지(?:url)?|상품번호|상품코드|품번|상품명|영문상품명|사이즈(?:옵션|색상)?|옵션|sku옵션|최근30일간?평균거래가|평균거래가|현재중국최저입찰가|현재중국최저입찰가예상수익|중국총판매량|총판매량|현지판매자총판매량|현지총판매량)$/i.test(value);
  }

  function applySourcingColumns(resetEssential = true) {
    let count = 0;
    headerCells().forEach((header, index) => {
      const entry = layoutEntry(index, true);
      const hidden = !sourcingEssentialColumn(header);
      if (hidden && !entry.hidden) count += 1;
      if (hidden || resetEssential) entry.hidden = hidden;
    });
    return count;
  }

  function hideCommonColumns() {
    localStorage.setItem(COLUMN_MODE_KEY, "compact");
    const count = applySourcingColumns();
    if (!count) {
      setStatus("이미 상품 소싱에 필요한 열만 표시하고 있습니다.");
      return;
    }
    applyLayout();
    void persistLayout(`${count}개 불필요 열을 숨겼습니다`);
  }

  function createControls() {
    const filters = document.querySelector("#excel-preview-filters");
    if (filters && !document.querySelector("#excel-hide-common-columns")) {
      const common = document.createElement("button");
      common.id = "excel-hide-common-columns";
      common.type = "button";
      common.textContent = "필요한 열만 보기";
      common.addEventListener("click", hideCommonColumns);
      const showAll = document.createElement("button");
      showAll.id = "excel-show-hidden-columns";
      showAll.type = "button";
      showAll.textContent = "모든 열 보기";
      showAll.hidden = true;
      showAll.addEventListener("click", showAllColumns);
      const status = document.querySelector("#excel-filter-status");
      filters.insertBefore(common, status || null);
      filters.insertBefore(showAll, status || null);
    }

    if (!document.querySelector("#excel-column-menu")) {
      const menu = document.createElement("div");
      menu.id = "excel-column-menu";
      menu.className = "excel-column-menu";
      menu.hidden = true;
      menu.innerHTML = '<strong id="excel-column-menu-title">열 설정</strong><button id="excel-column-hide" type="button">이 열 숨기기</button><button id="excel-column-show-all" type="button">숨긴 열 모두 표시</button>';
      document.body.appendChild(menu);
      menu.querySelector("#excel-column-hide").addEventListener("click", () => {
        menu.hidden = true;
        hideColumn(state.contextIndex);
      });
      menu.querySelector("#excel-column-show-all").addEventListener("click", () => {
        menu.hidden = true;
        showAllColumns();
      });
    }
  }

  function installStyles() {
    if (document.querySelector("style[data-excel-column-layout-style]")) return;
    const style = document.createElement("style");
    style.dataset.excelColumnLayoutStyle = "true";
    style.textContent = `
      #excel-preview-filters{grid-template-columns:minmax(150px,1fr) minmax(180px,1.2fr) minmax(180px,1fr) repeat(4,auto)}
      #excel-hide-common-columns,#excel-show-hidden-columns{height:32px;padding:6px 9px;white-space:nowrap}
      #excel-preview-grid table{table-layout:fixed}
      .excel-layout-header{position:sticky!important;overflow:visible!important}
      #excel-preview-grid td[data-excel-column-index]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .excel-column-hidden{display:none!important}
      .excel-column-resizer{position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:col-resize;z-index:8}
      .excel-column-resizer:hover{background:#2d7ff055}
      body.excel-column-resizing{cursor:col-resize!important;user-select:none!important}
      .excel-column-menu{position:fixed;z-index:1000;display:grid;min-width:190px;padding:7px;border:1px solid #bdcbe0;border-radius:9px;background:#fff;box-shadow:0 12px 34px #203b5b33}
      .excel-column-menu[hidden]{display:none}
      .excel-column-menu strong{padding:7px 9px;color:#294766;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .excel-column-menu button{border:0;border-radius:6px;padding:8px 9px;background:transparent;text-align:left;color:#294766;font-size:11px}
      .excel-column-menu button:hover{background:#eaf3ff;color:#1768c5}
      @media(max-width:1100px){#excel-preview-filters{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function scheduleEnhance() {
    if (state.scheduled) return;
    state.scheduled = true;
    queueMicrotask(() => {
      state.scheduled = false;
      createControls();
      void loadLayout();
    });
  }

  installStyles();
  createControls();

  const columns = document.querySelector("#excel-preview-columns");
  const rows = document.querySelector("#excel-preview-rows");
  const observer = new MutationObserver(scheduleEnhance);
  if (columns) observer.observe(columns, { childList: true, subtree: true });
  if (rows) observer.observe(rows, { childList: true, subtree: true });

  columns?.addEventListener("contextmenu", (event) => {
    const header = event.target.closest("th[data-excel-column-index]");
    if (!header) return;
    event.preventDefault();
    state.contextIndex = Number(header.dataset.excelColumnIndex);
    const menu = document.querySelector("#excel-column-menu");
    const title = document.querySelector("#excel-column-menu-title");
    if (title) title.textContent = header.textContent.trim() || `열 ${state.contextIndex + 1}`;
    if (menu) {
      menu.style.left = `${Math.min(event.clientX, window.innerWidth - 210)}px`;
      menu.style.top = `${Math.min(event.clientY, window.innerHeight - 130)}px`;
      menu.hidden = false;
    }
  });

  columns?.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-excel-resize-index]");
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(handle.dataset.excelResizeIndex);
    const header = handle.closest("th");
    state.resize = {
      index,
      startX: event.clientX,
      startWidth: Math.max(60, header?.getBoundingClientRect().width || 120),
    };
    document.body.classList.add("excel-column-resizing");
    handle.setPointerCapture?.(event.pointerId);
  });

  window.addEventListener("pointermove", (event) => {
    if (!state.resize) return;
    const widthPx = Math.max(60, Math.min(600, Math.round(state.resize.startWidth + event.clientX - state.resize.startX)));
    const entry = layoutEntry(state.resize.index, true);
    entry.widthPx = widthPx;
    applyColumn(state.resize.index);
  });

  window.addEventListener("pointerup", () => {
    if (!state.resize) return;
    const index = state.resize.index;
    state.resize = null;
    document.body.classList.remove("excel-column-resizing");
    const title = headerCells()[index]?.textContent?.trim() || `열 ${index + 1}`;
    void persistLayout(`“${title}” 열 너비를 조절했습니다`);
  });

  document.addEventListener("click", (event) => {
    const menu = document.querySelector("#excel-column-menu");
    if (menu && !event.target.closest("#excel-column-menu")) menu.hidden = true;
  });

  scheduleEnhance();
})();
