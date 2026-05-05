const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings & pairing
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  pairDevice: () => ipcRenderer.invoke('pair-device'),
  unpairDevice: () => ipcRenderer.invoke('unpair-device'),
  // Printers
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  testConnection: () => ipcRenderer.invoke('test-connection'),
  syncPrinters: () => ipcRenderer.invoke('sync-printers'),
  // Auto-update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
  // Events
  onStatusUpdate: (cb) => ipcRenderer.on('status-update', (_e, d) => cb(d)),
  onJobUpdate: (cb) => ipcRenderer.on('job-update', (_e, d) => cb(d)),
  onPairingStatus: (cb) => ipcRenderer.on('pairing-status', (_e, d) => cb(d)),
  onUpdater: (cb) => ipcRenderer.on('updater', (_e, d) => cb(d)),
});
