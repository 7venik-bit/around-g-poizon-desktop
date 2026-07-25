const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aroundG", {
  snapshot: () => ipcRenderer.invoke("store:snapshot"),
  upsert: (collection, item) => ipcRenderer.invoke("store:upsert", collection, item),
  bulkUpsert: (collection, items) => ipcRenderer.invoke("store:bulk-upsert", collection, items),
  remove: (collection, id) => ipcRenderer.invoke("store:remove", collection, id),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  getConfig: () => ipcRenderer.invoke("config:get"),
  explorerMeta: () => ipcRenderer.invoke("explorer:meta"),
  parsePopular: (input) => ipcRenderer.invoke("explorer:popular", input),
  resolvePopular: (input) => ipcRenderer.invoke("explorer:popular-resolve", input),
  readClipboardText: () => ipcRenderer.invoke("popular:clipboard-read"),
  getPopularWorkflow: () => ipcRenderer.invoke("popular:workflow-get"),
  savePopularWorkflow: (input) => ipcRenderer.invoke("popular:workflow-save", input),
  onPopularProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("explorer:popular-progress", handler);
    return () => ipcRenderer.removeListener("explorer:popular-progress", handler);
  },
  queryExplorer: (input) => ipcRenderer.invoke("explorer:query", input),
  importExcel: () => ipcRenderer.invoke("excel:import"),
  exportExcel: () => ipcRenderer.invoke("excel:export"),
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
  collectorCheck: (input) => ipcRenderer.invoke("collector:check", input)
  ,
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  }
});
