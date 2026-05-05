const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  pairDevice: () => ipcRenderer.invoke('pair-device'),
  unpairDevice: () => ipcRenderer.invoke('unpair-device'),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  testConnection: () => ipcRenderer.invoke('test-connection'),
  syncPrinters: () => ipcRenderer.invoke('sync-printers'),
  onStatusUpdate: (cb) => ipcRenderer.on('status-update', (_e, d) => cb(d)),
  onJobUpdate: (cb) => ipcRenderer.on('job-update', (_e, d) => cb(d)),
  onPairingStatus: (cb) => ipcRenderer.on('pairing-status', (_e, d) => cb(d)),
});
