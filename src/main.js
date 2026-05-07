const { app, BrowserWindow, ipcMain, Tray, Menu, net } = require('electron');
const path = require('path');
const os = require('os');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const Store = require('electron-store');
const store = new Store();
const { autoUpdater } = require('electron-updater');

const { startJobProcessor, stopJobProcessor } = require('./services/job-processor');
const { getPrinters } = require('./services/printer');
const { pairWithKey, testConnection, heartbeat, syncPrinters, triggerCheckReady } = require('./services/api');

let mainWindow = null;
let tray = null;
let heartbeatTimer = null;
let checkReadyTimer = null;
let checkReadyBackoffTimer = null;
let pendingDeepLink = null;

// --- Single instance lock + deep link (Windows) ---
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => a.startsWith('boommprinter://'));
    if (url) handleDeepLink(url);
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    else createWindow();
  });
}

function handleDeepLink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'pair') return;
    const apiUrl = parsed.searchParams.get('apiUrl') || '';
    const key = parsed.searchParams.get('key') || '';
    if (apiUrl) store.set('apiUrl', apiUrl);
    if (key) store.set('printAccessKey', key);
    store.delete('deviceToken'); store.delete('computerId'); store.delete('companyId');
    stopJobProcessor(); stopHeartbeat(); stopCheckReady();
    const payload = { apiUrl, key };
    const hasWindow = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed());
    if (hasWindow) broadcast('deep-link-pair', payload);
    else pendingDeepLink = payload;
  } catch {}
}

// --- Auto-updater config ---
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

autoUpdater.on('checking-for-update', () =>
  broadcast('updater', { state: 'checking' })
);
autoUpdater.on('update-available', (info) =>
  broadcast('updater', { state: 'available', version: info.version })
);
autoUpdater.on('update-not-available', () =>
  broadcast('updater', { state: 'latest' })
);
autoUpdater.on('download-progress', (p) =>
  broadcast('updater', { state: 'downloading', percent: Math.round(p.percent) })
);
autoUpdater.on('update-downloaded', (info) =>
  broadcast('updater', { state: 'ready', version: info.version })
);
autoUpdater.on('error', (err) =>
  broadcast('updater', { state: 'error', message: err.message })
);

// --- Helpers ---
function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 640,
    minHeight: 480,
    title: 'Boomm Printer Desktop',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      broadcast('deep-link-pair', pendingDeepLink);
      pendingDeepLink = null;
    }
  });
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) { e.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function createTray() {
  try {
    const icon = await app.getFileIcon(process.execPath, { size: 'small' });
    tray = new Tray(icon);
  } catch { return; }
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir Boomm Printer', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow(); } },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('Boomm Printer Desktop');
  tray.setContextMenu(menu);
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow(); });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => { try { await heartbeat(); } catch { /* non-fatal */ } }, 30000);
}
function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function startCheckReady() {
  stopCheckReady();
  checkReadyTimer = setInterval(async () => {
    if (!net.isOnline()) return;
    try {
      const result = await triggerCheckReady();
      // result skipped / recent_check / backoff (body-level) are non-errors
      if (result?.result === 'backoff' && typeof result?.backoff_seconds === 'number') {
        stopCheckReady();
        checkReadyBackoffTimer = setTimeout(startCheckReady, result.backoff_seconds * 1000);
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        const backoffSec = err.response?.data?.backoff_seconds || 30;
        stopCheckReady();
        checkReadyBackoffTimer = setTimeout(startCheckReady, backoffSec * 1000);
      }
      // network failures and other errors are non-fatal
    }
  }, 5000);
}
function stopCheckReady() {
  if (checkReadyBackoffTimer) { clearTimeout(checkReadyBackoffTimer); checkReadyBackoffTimer = null; }
  if (checkReadyTimer) { clearInterval(checkReadyTimer); checkReadyTimer = null; }
}

async function initializeApp() {
  // Only start if already paired — never auto-pair at startup
  const deviceToken = store.get('deviceToken');
  if (!deviceToken) return;

  startJobProcessor();
  startHeartbeat();
  startCheckReady();
  getPrinters().then((p) => syncPrinters(p)).catch(() => {}); // background sync, non-fatal
  broadcast('pairing-status', { isPaired: true, computerId: store.get('computerId') });
  broadcast('status-update', { type: 'success', message: 'Conectado ao SaaS Boomm Printer.' });
}

// --- IPC: Settings ---
ipcMain.handle('get-settings', () => ({
  apiUrl: store.get('apiUrl', process.env.SAAS_API_URL || ''),
  printAccessKey: store.get('printAccessKey', ''),
  computerName: store.get('computerName', os.hostname()),
  pollingInterval: store.get('pollingInterval', 2000),
  isPaired: !!store.get('deviceToken'),
  computerId: store.get('computerId', ''),
  appVersion: app.getVersion(),
}));

ipcMain.handle('save-settings', async (_e, s) => {
  store.set('apiUrl', s.apiUrl); store.set('printAccessKey', s.printAccessKey);
  store.set('computerName', s.computerName); store.set('pollingInterval', Number(s.pollingInterval) || 2000);
  store.delete('deviceToken'); store.delete('computerId'); store.delete('companyId');
  stopJobProcessor(); stopHeartbeat(); stopCheckReady();
  return { success: true };
});

ipcMain.handle('pair-device', async () => {
  const key = store.get('printAccessKey');
  if (!key) return { success: false, error: 'Chave de acesso não configurada.' };
  try {
    const result = await pairWithKey(key, store.get('computerName') || os.hostname(), await getPrinters());
    startJobProcessor(); startHeartbeat(); startCheckReady();
    return { success: true, ...result };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('unpair-device', () => {
  stopJobProcessor(); stopHeartbeat(); stopCheckReady();
  store.delete('deviceToken'); store.delete('computerId'); store.delete('companyId');
  return { success: true };
});

ipcMain.handle('get-printers', async () => {
  try { return { success: true, printers: await getPrinters() }; }
  catch (e) { return { success: false, error: e.message, printers: [] }; }
});

ipcMain.handle('test-connection', async () => {
  try {
    const result = await testConnection();
    if (!result.connected) return { success: false, error: result.message };
    return { success: true, ...result };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('sync-printers', async () => {
  try { const p = await getPrinters(); await syncPrinters(p); return { success: true, count: p.length }; }
  catch (e) { return { success: false, error: e.message }; }
});

// --- IPC: Auto-update ---
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) return { success: false, message: 'Não disponível em modo dev.' };
  try { await autoUpdater.checkForUpdates(); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.on('download-update', () => autoUpdater.downloadUpdate().catch(console.error));
ipcMain.on('install-update', () => autoUpdater.quitAndInstall(false, true));

// --- App lifecycle ---
app.whenReady().then(async () => {
  // Deep link from first launch: Windows passes URL as a CLI argument
  const deepLinkArg = process.argv.find((a) => a.startsWith('boommprinter://'));
  if (deepLinkArg) handleDeepLink(deepLinkArg); // saves to pendingDeepLink (no window yet)

  createWindow();
  await createTray();
  await initializeApp();

  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform === 'darwin') app.quit(); });
app.on('before-quit', () => { stopJobProcessor(); stopHeartbeat(); stopCheckReady(); });
