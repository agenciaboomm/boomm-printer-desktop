const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  testConnection: () => ipcRenderer.invoke('test-connection'),
  syncPrinters: () => ipcRenderer.invoke('sync-printers'),
  onStatusUpdate: (cb) => ipcRenderer.on('status-update', (_e, data) => cb(data)),
  onJobUpdate: (cb) => ipcRenderer.on('job-update', (_e, data) => cb(data)),
});
