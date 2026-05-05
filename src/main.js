const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const os = require('os');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const Store = require('electron-store');
const store = new Store();

const { startJobProcessor, stopJobProcessor } = require('./services/job-processor');
const { getPrinters } = require('./services/printer');
const { pairWithKey, testConnection, heartbeat, syncPrinters } = require('./services/api');

let mainWindow = null;
let tray = null;
let heartbeatTimer = null;

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

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

async function createTray() {
  try {
    const icon = await app.getFileIcon(process.execPath, { size: 'small' });
    tray = new Tray(icon);
  } catch {
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Boomm Printer',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else createWindow();
      },
    },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.isQuiting = true; app.quit(); } },
  ]);

  tray.setToolTip('Boomm Printer Desktop');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow();
  });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => {
    try { await heartbeat(); } catch { /* non-fatal */ }
  }, 30000);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

async function initializeApp() {
  const printAccessKey = store.get('printAccessKey');
  if (!printAccessKey) return;

  try {
    const deviceToken = store.get('deviceToken');

    if (deviceToken) {
      const printers = await getPrinters();
      await syncPrinters(printers).catch(() => {});
      startJobProcessor();
      startHeartbeat();
      broadcast('status-update', { type: 'success', message: 'Conectado ao SaaS Boomm Printer.' });
    } else {
      const printers = await getPrinters();
      const computerName = store.get('computerName') || os.hostname();
      await pairWithKey(printAccessKey, computerName, printers);
      startJobProcessor();
      startHeartbeat();
      broadcast('status-update', { type: 'success', message: 'Pareado com sucesso!' });
    }

    broadcast('pairing-status', { isPaired: true });
  } catch (error) {
    console.error('Init error:', error.message);
    broadcast('status-update', { type: 'error', message: 'Erro ao inicializar: ' + error.message });
  }
}

// IPC
ipcMain.handle('get-settings', () => ({
  apiUrl: store.get('apiUrl', process.env.SAAS_API_URL || ''),
  printAccessKey: store.get('printAccessKey', ''),
  computerName: store.get('computerName', os.hostname()),
  pollingInterval: store.get('pollingInterval', 5000),
  isPaired: !!store.get('deviceToken'),
  computerId: store.get('computerId', ''),
}));

ipcMain.handle('save-settings', async (_e, settings) => {
  store.set('apiUrl', settings.apiUrl);
  store.set('printAccessKey', settings.printAccessKey);
  store.set('computerName', settings.computerName);
  store.set('pollingInterval', Number(settings.pollingInterval) || 5000);
  store.delete('deviceToken');
  store.delete('computerId');
  store.delete('companyId');
  stopJobProcessor();
  stopHeartbeat();
  return { success: true };
});

ipcMain.handle('pair-device', async () => {
  const printAccessKey = store.get('printAccessKey');
  const computerName = store.get('computerName') || os.hostname();
  if (!printAccessKey) return { success: false, error: 'Chave de acesso não configurada.' };

  try {
    const printers = await getPrinters();
    const result = await pairWithKey(printAccessKey, computerName, printers);
    startJobProcessor();
    startHeartbeat();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('unpair-device', () => {
  stopJobProcessor();
  stopHeartbeat();
  store.delete('deviceToken');
  store.delete('computerId');
  store.delete('companyId');
  return { success: true };
});

ipcMain.handle('get-printers', async () => {
  try {
    return { success: true, printers: await getPrinters() };
  } catch (e) {
    return { success: false, error: e.message, printers: [] };
  }
});

ipcMain.handle('test-connection', async () => {
  try {
    return { success: true, ...(await testConnection()) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('sync-printers', async () => {
  try {
    const printers = await getPrinters();
    await syncPrinters(printers);
    return { success: true, count: printers.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

app.whenReady().then(async () => {
  createWindow();
  await createTray();
  await initializeApp();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopJobProcessor();
  stopHeartbeat();
});
