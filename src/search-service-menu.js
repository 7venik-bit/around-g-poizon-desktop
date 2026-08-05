(() => {
  if (document.querySelector("#search-service-menu")) return;

  const modes = [
    { id: "popular", label: "인기리스트", group: "search" },
    { id: "brand", label: "포이즌 원본 데이터 가져오기", group: "search" },
    { id: "category", label: "카테고리", group: "search" },
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
      ${modes.filter((item) => item.group === "search").map((item) => `
        <button type="button" class="search-service-button" data-service-explorer="${item.id}">
          <i aria-hidden="true"></i><span>${item.label}</span>
        </button>`).join("")}
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
