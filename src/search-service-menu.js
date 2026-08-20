(() => {
  if (document.querySelector("#search-service-menu")) return;

  const modes = [
    { id: "popular", label: "인기리스트", group: "search" },
    { id: "brand", label: "브랜드 검색", group: "search" },
    { id: "category", label: "카테고리 검색", group: "search", hidden: true },
    { id: "files", label: "받은 Excel 파일", group: "files" },
  ];
  const validModes = new Set(modes.map((item) => item.id));
  const productsNav = document.querySelector('.nav[data-view="products"]');
  const productsView = document.querySelector("#products");
  const sidebarNav = productsNav?.closest("nav");
  if (!productsNav || !productsView || !sidebarNav) return;

  const menu = document.createElement("section");
  menu.id = "search-service-menu";
  menu.className = "search-service-menu";
  menu.setAttribute("aria-label", "POIZON 검색 서비스");
  menu.innerHTML = `
    <small>검색 서비스</small>
    <div class="search-service-buttons">
      ${modes.filter((item) => item.group === "search" && !item.hidden).map((item) => `
        <button type="button" class="search-service-button" data-service-explorer="${item.id}">
          <i aria-hidden="true"></i><span>${item.label}</span>
        </button>`).join("")}
    </div>
    <div id="domestic-module-lamps" class="domestic-module-lamps" role="status" aria-label="국내 검색 모듈 상태">
      ${[
        ["official", "공식몰"], ["musinsa", "무신사"], ["naver", "네이버"],
        ["ssg", "SSG"], ["lotte", "롯데"], ["parallel", "병행"], ["kolon", "코오롱"],
      ].map(([id, label]) => `<span class="module-lamp idle" data-module-lamp="${id}" title="${label} · 대기"><i></i><small>${label}</small></span>`).join("")}
    </div>
    <small class="search-service-file-label">데이터 파일</small>
    <button type="button" class="search-service-button search-service-file" data-service-explorer="files">
      <i aria-hidden="true"></i><span>받은 Excel 파일</span>
    </button>`;
  productsNav.insertAdjacentElement("afterend", menu);

  // The four service buttons below replace the redundant parent menu row.
  // Keep its DOM node only because the original renderer uses it internally
  // when activating the products view.
  productsNav.hidden = true;
  productsNav.setAttribute("aria-hidden", "true");
  productsNav.tabIndex = -1;

  // Remove the redundant brand-screen heading and the three-step guide shown
  // above the brand selector. Preserve only the hidden legacy button because
  // the original renderer still reads its disabled state internally.
  const brandPanel = document.querySelector("#explorer-brand");
  const brandHeading = brandPanel?.querySelector(":scope > h2");
  if (brandHeading) brandHeading.remove();
  const brandFlow = brandPanel?.querySelector(":scope > .brand-fetch-action");
  if (brandFlow) {
    const legacyBrandSearch = brandFlow.querySelector("#brand-search");
    if (legacyBrandSearch) {
      legacyBrandSearch.hidden = true;
      legacyBrandSearch.setAttribute("aria-hidden", "true");
      brandPanel.prepend(legacyBrandSearch);
    }
    brandFlow.remove();
  }

  const oldModes = document.querySelector(".raw-data-modes");
  if (oldModes) {
    oldModes.hidden = true;
    oldModes.setAttribute("aria-hidden", "true");
  }

  function currentMode() {
    const activePanel = document.querySelector(".explorer-panel.active");
    return String(activePanel?.id || "").replace(/^explorer-/, "");
  }

  function clearResultsWhenChanging(previous, next) {
    if (!previous || previous === next) return;
    try {
      if (typeof clearExplorerResults === "function") clearExplorerResults();
    } catch {
      // The search screens still switch safely if the result helper is unavailable.
    }
  }

  function activateMode(mode, options = {}) {
    if (!validModes.has(mode)) mode = "brand";
    const target = document.querySelector(`#explorer-${mode}`);
    if (!target) return;
    const previous = currentMode();
    clearResultsWhenChanging(previous, mode);

    document.querySelectorAll(".explorer-panel").forEach((panel) => panel.classList.remove("active"));
    target.hidden = false;
    target.removeAttribute("aria-hidden");
    target.classList.add("active");

    menu.querySelectorAll("[data-service-explorer]").forEach((button) => {
      const active = button.dataset.serviceExplorer === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });

    document.querySelectorAll(".nav").forEach((button) => button.classList.remove("active"));
    productsNav.classList.add("active");
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    productsView.classList.add("active");

    if (options.persist !== false) localStorage.setItem("around-g-search-service-mode", mode);
  }

  window.activateSearchServiceMode = activateMode;
  window.resetDomesticModuleLamps = () => {
    menu.querySelectorAll("[data-module-lamp]").forEach((lamp) => {
      lamp.classList.remove("running", "success", "failed");
      lamp.classList.add("idle");
      const label = lamp.querySelector("small")?.textContent || "검색";
      lamp.title = `${label} · 대기`;
    });
  };

  window.aroundG?.onDomesticModuleStatus?.((payload) => {
    const moduleId = String(payload?.moduleId || "");
    const lamp = menu.querySelector(`[data-module-lamp="${moduleId}"]`);
    if (!lamp) return;
    const state = ["running", "success", "failed"].includes(payload?.state) ? payload.state : "idle";
    lamp.classList.remove("idle", "running", "success", "failed");
    lamp.classList.add(state);
    const label = lamp.querySelector("small")?.textContent || moduleId;
    const stateLabel = state === "running" ? "검색 중" : state === "success" ? "완료" : state === "failed" ? "실패" : "대기";
    lamp.title = `${label} · ${stateLabel}`;
    menu.querySelector("#domestic-module-lamps")?.setAttribute("aria-label", `${label} 모듈 ${stateLabel}`);
  });

  menu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-service-explorer]");
    if (!button) return;
    activateMode(button.dataset.serviceExplorer);
  });

  productsNav.addEventListener("click", () => {
    const selected = localStorage.getItem("around-g-search-service-mode");
    activateMode(validModes.has(selected) ? selected : currentMode() || "brand", { persist: false });
  });

  const initial = currentMode();
  const saved = localStorage.getItem("around-g-search-service-mode");
  activateMode(validModes.has(initial) ? initial : validModes.has(saved) ? saved : "brand", { persist: false });
})();
