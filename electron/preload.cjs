const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('evoTdx', {
  readDefaultConfig: () => ipcRenderer.invoke('evo:tdx:read-default-config'),
});
