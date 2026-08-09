const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aroundG", {
  snapshot: () => ipcRenderer.invoke("store:snapshot"),
  upsert: (collection, item) => ipcRenderer.invoke("store:upsert", collection, item),
  bulkUpsert: (collection, items) => ipcRenderer.invoke("store:bulk-upsert", collection, items),
  remove: (collection, id) => ipcRenderer.invoke("store:remove", collection, id),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  getConfig: () => ipcRenderer.invoke("config:get"),
  explorerMeta: () => ipcRenderer.invoke("explorer:meta"),
  syncBrands: () => ipcRenderer.invoke("explorer:sync-brands"),
  getOfficialDomainAudit: () => ipcRenderer.invoke("official-domain:audit-status"),
  startOfficialDomainAudit: () => ipcRenderer.invoke("official-domain:audit-start"),
  stopOfficialDomainAudit: () => ipcRenderer.invoke("official-domain:audit-stop"),
  onOfficialDomainAuditProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("official-domain:audit-progress", handler);
    return () => ipcRenderer.removeListener("official-domain:audit-progress", handler);
  },
  onBrandSyncProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("explorer:brand-progress", handler);
    return () => ipcRenderer.removeListener("explorer:brand-progress", handler);
  },
  openSellerCenter: () => ipcRenderer.invoke("seller:open"),
  openDownloadedBrandFile: (path, brand) => ipcRenderer.invoke("brand-export:open-file", { path, brand }),
  openOriginalExcelFile: (path) => ipcRenderer.invoke("brand-export:open-original", { path }),
  previewExcelFile: (path, offset = 0, limit = 100, filters = {}) => ipcRenderer.invoke("excel:preview", { path, offset, limit, filters }),
  getExcelColumnLayout: (path, columnCount = 0) => ipcRenderer.invoke("excel:get-column-layout", { path, columnCount }),
  updateExcelColumnLayout: (path, columnLayout = [], columnCount = 0) => ipcRenderer.invoke("excel:update-column-layout", { path, columnLayout, columnCount }),
  selectBrandExportFolder: () => ipcRenderer.invoke("brand-export:select-folder"),
  getBrandExportFolder: () => ipcRenderer.invoke("brand-export:get-folder"),
  listBrandExportFiles: () => ipcRenderer.invoke("brand-export:list-files"),
  clearBrandWorkHistory: () => ipcRenderer.invoke("brand-export:clear-session"),
  onBrandWorkHistoryCleared: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("brand-export:session-cleared", handler);
    return () => ipcRenderer.removeListener("brand-export:session-cleared", handler);
  },
  importBrandExcelFromPath: (path, expectedBrand = "") => ipcRenderer.invoke("excel:import-brand-source", { path, expectedBrand }),
  onBrandExportDetected: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("brand-export:detected", handler);
    return () => ipcRenderer.removeListener("brand-export:detected", handler);
  },
  onBrandExportProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("brand-export:progress", handler);
    return () => ipcRenderer.removeListener("brand-export:progress", handler);
  },
  onBrandExportError: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("brand-export:error", handler);
    return () => ipcRenderer.removeListener("brand-export:error", handler);
  },
  captureSellerCenter: () => ipcRenderer.invoke("seller:capture"),
  stagePopularProductsInExcel: (products) => ipcRenderer.invoke("excel:stage-popular-products", products),
  onSellerCaptureProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("seller:capture-progress", handler);
    return () => ipcRenderer.removeListener("seller:capture-progress", handler);
  },
  getPopularWorkflow: () => ipcRenderer.invoke("popular:workflow-get"),
  savePopularWorkflow: (input) => ipcRenderer.invoke("popular:workflow-save", input),
  queryExplorer: (input) => ipcRenderer.invoke("explorer:query", input),
  searchDomestic: (input) => ipcRenderer.invoke("domestic:search", input),
  importExcel: () => ipcRenderer.invoke("excel:import"),
  exportExcel: () => ipcRenderer.invoke("excel:export"),
  exportExplorerExcel: (input) => ipcRenderer.invoke("excel:export-explorer", input),
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
  openOfficialSearch: (input) => ipcRenderer.invoke("official:open-search", input),
  collectorCheck: (input) => ipcRenderer.invoke("collector:check", input),
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  restartForUpdate: () => ipcRenderer.invoke("update:restart"),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  }
});

window.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector('link[data-excel-column-layout="true"]')) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "./excel-column-layout.css";
    stylesheet.dataset.excelColumnLayout = "true";
    document.head.appendChild(stylesheet);
  }
  if (document.querySelector('script[data-excel-column-layout="true"]')) return;
  const script = document.createElement("script");
  script.src = "./excel-column-layout.js";
  script.dataset.excelColumnLayout = "true";
  document.head.appendChild(script);
});
