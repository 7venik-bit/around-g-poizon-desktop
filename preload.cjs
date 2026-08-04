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
  onBrandSyncProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("explorer:brand-progress", handler);
    return () => ipcRenderer.removeListener("explorer:brand-progress", handler);
  },
  openSellerCenter: () => ipcRenderer.invoke("seller:open"),
  openSellerProductSearch: () => ipcRenderer.invoke("seller:open-product-search"),
  automateSellerBrandExport: (input) => ipcRenderer.invoke("seller:brand-export", input),
  startSellerBrandExportMonitor: () => ipcRenderer.invoke("seller:start-brand-export-monitor"),
  openDownloadedBrandFile: (path, brand) => ipcRenderer.invoke("brand-export:open-file", { path, brand }),
  openOriginalExcelFile: (path) => ipcRenderer.invoke("brand-export:open-original", { path }),
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
  collectorCheck: (input) => ipcRenderer.invoke("collector:check", input)
  ,
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
