const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('evoNet', {
  request: (input) => ipcRenderer.invoke('evo:net:request', input),
});

contextBridge.exposeInMainWorld('evoTdx', {
  readDefaultConfig: () => ipcRenderer.invoke('evo:tdx:read-default-config'),
  parseConfig: (config) => ipcRenderer.invoke('evo:tdx:parse-config', { config }),
  probeConfig: (config, code, limit = 8) => ipcRenderer.invoke('evo:tdx:probe-config', { config, code, limit }),
  fetchDailyBars: (host, code, count = 120) => ipcRenderer.invoke('evo:tdx:daily-bars', { host, code, count }),
  fetchQuotes: (host, codes = ['600519']) => ipcRenderer.invoke('evo:tdx:quotes', { host, codes }),
  fetchSecurities: (host) => ipcRenderer.invoke('evo:tdx:securities', { host }),
  fetchSnapshot: (host, market = 'all', force = false) =>
    ipcRenderer.invoke('evo:tdx:snapshot', { host, market, force }),
  fetchFinance: (host, code) => ipcRenderer.invoke('evo:tdx:finance', { host, code }),
  autoConnect: (config, code = '600519', count = 120, limit = 12) =>
    ipcRenderer.invoke('evo:tdx:auto-connect', { config, code, count, limit }),
});

contextBridge.exposeInMainWorld('evoWeb', {
  searchNews: (query) => ipcRenderer.invoke('evo:web:news-search', { query }),
});

contextBridge.exposeInMainWorld('evoPc', {
  junkScan: () => ipcRenderer.invoke('evo:pc:junk:scan'),
  junkClean: (ids) => ipcRenderer.invoke('evo:pc:junk:clean', { ids }),
  softwareList: () => ipcRenderer.invoke('evo:pc:software:list'),
  softwareUninstall: (entries) => ipcRenderer.invoke('evo:pc:software:uninstall', { entries }),
  networkDiagnose: () => ipcRenderer.invoke('evo:pc:network:diagnose'),
  networkRepair: (action) => ipcRenderer.invoke('evo:pc:network:repair', { action }),
  systemReport: () => ipcRenderer.invoke('evo:pc:system:report'),
  runTool: (kind, payload = {}) => ipcRenderer.invoke('evo:pc:tool', { kind, ...payload }),
});

contextBridge.exposeInMainWorld('evoTv', {
  base: () => ipcRenderer.invoke('evo:tv:base'),
});

contextBridge.exposeInMainWorld('evoGf', {
  base: () => ipcRenderer.invoke('evo:gf:base'),
});

contextBridge.exposeInMainWorld('evoIma', {
  base: () => ipcRenderer.invoke('evo:ima:base'),
});
