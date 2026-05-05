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
const { registerComputer, syncPrinters, testConnection } = require('./services/api');

let mainWindow = null;
let tray = null;

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Boomm Printer Desktop');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

async function initializeApp() {
  const apiKey = store.get('apiKey');
  const computerId = store.get('computerId');

  if (!apiKey) return;

  try {
    if (!computerId) {
      await registerComputer();
    }
    const printers = await getPrinters();
    if (printers.length > 0) {
      await syncPrinters(printers);
    }
    startJobProcessor();

    if (mainWindow) {
      mainWindow.webContents.send('status-update', {
        type: 'success',
        message: 'Conectado ao SaaS Boomm Printer',
      });
    }
  } catch (error) {
    console.error('Initialization error:', error.message);
    if (mainWindow) {
      mainWindow.webContents.send('status-update', {
        type: 'error',
        message: 'Erro ao inicializar: ' + error.message,
      });
    }
  }
}

// IPC Handlers
ipcMain.handle('get-settings', () => ({
  apiUrl: store.get('apiUrl', process.env.SAAS_API_URL || ''),
  apiKey: store.get('apiKey', ''),
  computerName: store.get('computerName', os.hostname()),
  pollingInterval: store.get('pollingInterval', 5000),
}));

ipcMain.handle('save-settings', async (_event, settings) => {
  store.set('apiUrl', settings.apiUrl);
  store.set('apiKey', settings.apiKey);
  store.set('computerName', settings.computerName);
  store.set('pollingInterval', Number(settings.pollingInterval) || 5000);
  store.delete('computerId');

  stopJobProcessor();

  try {
    await initializeApp();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-printers', async () => {
  try {
    const printers = await getPrinters();
    return { success: true, printers };
  } catch (error) {
    return { success: false, error: error.message, printers: [] };
  }
});

ipcMain.handle('test-connection', async () => {
  try {
    const result = await testConnection();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sync-printers', async () => {
  try {
    const printers = await getPrinters();
    await syncPrinters(printers);
    return { success: true, count: printers.length };
  } catch (error) {
    return { success: false, error: error.message };
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
});
