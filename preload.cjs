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
  getWeeklySiteHealth: () => ipcRenderer.invoke("weekly-site-health:status"),
  runWeeklySiteHealth: () => ipcRenderer.invoke("weekly-site-health:run"),
  onWeeklySiteHealthStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("weekly-site-health:status", handler);
    return () => ipcRenderer.removeListener("weekly-site-health:status", handler);
  },
  onBrandSyncProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("explorer:brand-progress", handler);
    return () => ipcRenderer.removeListener("explorer:brand-progress", handler);
  },
  openSellerCenter: () => ipcRenderer.invoke("seller:open"),
  openSellerProductSearch: () => ipcRenderer.invoke("seller:open-product-search"),
  automateSellerBrandExport: (input) => ipcRenderer.invoke("seller:brand-export", input),
  beginSellerBrandSearchSession: () => ipcRenderer.invoke("seller:begin-brand-search-session"),
  abortSellerBrandExportAttempt: () => ipcRenderer.invoke("seller:abort-brand-export-attempt"),
  stopSellerBrandWork: () => ipcRenderer.invoke("seller:stop-brand-work"),
  startSellerBrandExportMonitor: () => ipcRenderer.invoke("seller:start-brand-export-monitor"),
  listPendingBrandExportJobs: () => ipcRenderer.invoke("brand-export:pending-jobs"),
  openDownloadedBrandFile: (path, brand) => ipcRenderer.invoke("brand-export:open-file", { path, brand }),
  openOriginalExcelFile: (path) => ipcRenderer.invoke("brand-export:open-original", { path }),
  revealBrandExportFile: (path) => ipcRenderer.invoke("brand-export:reveal-file", { path }),
  previewExcelFile: (path, offset = 0, limit = 100, filters = {}) => ipcRenderer.invoke("excel:preview", { path, offset, limit, filters }),
  getExcelColumnLayout: (path, columnCount = 0) => ipcRenderer.invoke("excel:get-column-layout", { path, columnCount }),
  updateExcelColumnLayout: (path, columnLayout = [], columnCount = 0) => ipcRenderer.invoke("excel:update-column-layout", { path, columnLayout, columnCount }),
  selectBrandExportFolder: () => ipcRenderer.invoke("brand-export:select-folder"),
  getBrandExportFolder: () => ipcRenderer.invoke("brand-export:get-folder"),
  listBrandExportFiles: () => ipcRenderer.invoke("brand-export:list-files"),
  trashBrandExportFiles: (paths) => ipcRenderer.invoke("brand-export:trash-files", paths),
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
  cancelCategorySearch: () => ipcRenderer.invoke("explorer:cancel-category"),
  searchDomestic: (input) => ipcRenderer.invoke("domestic:search", input),
  listDomesticLogins: () => ipcRenderer.invoke("domestic-login:list"),
  openDomesticLogin: (sourceId) => ipcRenderer.invoke("domestic-login:open", sourceId),
  clearDomesticLogin: (sourceId) => ipcRenderer.invoke("domestic-login:clear", sourceId),
  onDomesticLoginChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("domestic-login:changed", handler);
    return () => ipcRenderer.removeListener("domestic-login:changed", handler);
  },
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
  getBackupStatus: () => ipcRenderer.invoke("backup:status"),
  runBackup: () => ipcRenderer.invoke("backup:run"),
  onBackupStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("backup:status", handler);
    return () => ipcRenderer.removeListener("backup:status", handler);
  },
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
