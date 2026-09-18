const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('evoTdx', {
  readDefaultConfig: () => ipcRenderer.invoke('evo:tdx:read-default-config'),
  parseConfig: (config) => ipcRenderer.invoke('evo:tdx:parse-config', { config }),
  probeConfig: (config, code, limit = 8) => ipcRenderer.invoke('evo:tdx:probe-config', { config, code, limit }),
  fetchDailyBars: (host, code, count = 120) => ipcRenderer.invoke('evo:tdx:daily-bars', { host, code, count }),
});
