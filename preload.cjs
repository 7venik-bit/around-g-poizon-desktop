const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aroundG", {
  snapshot: () => ipcRenderer.invoke("store:snapshot"),
  upsert: (collection, item) => ipcRenderer.invoke("store:upsert", collection, item),
  bulkUpsert: (collection, items) => ipcRenderer.invoke("store:bulk-upsert", collection, items),
  remove: (collection, id) => ipcRenderer.invoke("store:remove", collection, id),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  getConfig: () => ipcRenderer.invoke("config:get"),
  explorerMeta: () => ipcRenderer.invoke("explorer:meta"),
  openSellerCenter: () => ipcRenderer.invoke("seller:open"),
  captureSellerCenter: () => ipcRenderer.invoke("seller:capture"),
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
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
  collectorCheck: (input) => ipcRenderer.invoke("collector:check", input)
  ,
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  restartForUpdate: () => ipcRenderer.invoke("update:restart"),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  }
});
