const { BrowserWindow } = require('electron');
const { exec, execFile } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function getPrinters() {
  return new Promise((resolve) => {
    const cmd = 'Get-Printer | Select-Object Name,PortName,PrinterStatus,Default | ConvertTo-Json -Compress';

    exec(`powershell -NonInteractive -Command "${cmd}"`, { timeout: 12000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        return resolveViaWmic(resolve);
      }

      try {
        let data = JSON.parse(stdout.trim());
        if (!Array.isArray(data)) data = [data];

        const printers = data
          .map((p) => ({
            name: (p.Name || '').trim(),
            port: (p.PortName || '').trim(),
            status: p.PrinterStatus === 0 ? 'ready' : 'offline',
            isDefault: !!p.Default,
          }))
          .filter((p) => p.name);

        resolve(printers);
      } catch {
        resolveViaWmic(resolve);
      }
    });
  });
}

function resolveViaWmic(resolve) {
  exec('wmic printer get name,portname,default /format:csv', { timeout: 10000 }, (err, stdout) => {
    if (err || !stdout) return resolve([]);

    const lines = stdout.trim().split('\n').filter((l) => l.trim());
    const printers = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 3) {
        printers.push({
          name: (parts[2] || '').trim(),
          port: (parts[3] || '').trim(),
          status: 'unknown',
          isDefault: (parts[1] || '').trim().toLowerCase() === 'true',
        });
      }
    }

    resolve(printers.filter((p) => p.name));
  });
}

// Returns path to SumatraPDF.exe: checks packaged resources first, then dev tree.
function getSumatraPdfPath() {
  if (process.resourcesPath) {
    const packed = path.join(process.resourcesPath, 'SumatraPDF.exe');
    if (fs.existsSync(packed)) return packed;
  }
  const dev = path.join(__dirname, '..', '..', 'build', 'extraResources', 'SumatraPDF.exe');
  if (fs.existsSync(dev)) return dev;
  return null;
}

// For "Microsoft Print to PDF": bypass the print driver and save directly to disk.
// The Windows Print to PDF driver suppresses its save dialog in NonInteractive mode,
// so a normal printto verb call silently discards the output — nothing is saved.
async function savePDFtoDisk(pdfBuffer, options = {}) {
  const outputDir = path.join(os.homedir(), 'Downloads', 'Boomm Printer');
  await fs.promises.mkdir(outputDir, { recursive: true });

  const timestamp = Date.now();
  const sanitizedTitle = (options.title || 'Boomm')
    .replace(/\.pdf$/i, '')
    .replace(/[<>:"/\\|?*\r\n]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 150);

  const fileName = `${sanitizedTitle}_${timestamp}.pdf`;
  const outputPath = path.join(outputDir, fileName);

  await fs.promises.writeFile(outputPath, pdfBuffer);

  const stat = await fs.promises.stat(outputPath);
  if (!stat || stat.size === 0) {
    throw new Error(`PDF salvo mas arquivo está vazio: ${outputPath}`);
  }

  console.log(`[savePDFtoDisk] Arquivo salvo: ${outputPath} (${stat.size} bytes)`);
  return { success: true, savedPath: outputPath };
}

async function printPDF(printerName, pdfBuffer, options = {}) {
  const normalized = (printerName || '').toLowerCase();
  console.log(`[printPDF] Impressora: "${printerName}" | normalizado: "${normalized}"`);

  if (normalized === 'microsoft print to pdf' || normalized.includes('print to pdf')) {
    console.log('[printPDF] → Modo: salvar PDF em disco (Microsoft Print to PDF) — sem diálogo nativo');
    return savePDFtoDisk(pdfBuffer, options);
  }

  console.log('[printPDF] → Modo: impressão física via SumatraPDF CLI');

  const sumatraPath = getSumatraPdfPath();
  if (!sumatraPath) {
    throw new Error('SumatraPDF.exe não encontrado. Reinstale o aplicativo Boomm Printer.');
  }
  console.log(`[printPDF] SumatraPDF encontrado: ${sumatraPath}`);

  const tmpFile = path.join(os.tmpdir(), `boomm_pdf_${Date.now()}.pdf`);
  try {
    fs.writeFileSync(tmpFile, pdfBuffer);
    console.log(`[printPDF] Enviando arquivo para "${printerName}"`);

    await new Promise((resolve, reject) => {
      const copies = Math.max(1, options.copies || 1);
      const args = [
        '-print-to', printerName,
        '-silent',
        '-print-settings', `${copies}x`,
        tmpFile,
      ];

      console.log(`[printPDF] SumatraPDF args: ${JSON.stringify(args)}`);
      const child = execFile(sumatraPath, args, { timeout: 30000 });

      child.on('close', (code) => {
        console.log(`[printPDF] Comando SumatraPDF finalizado com exit code ${code}`);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SumatraPDF falhou com exit code ${code} ao imprimir em "${printerName}"`))
        }
      });

      child.on('error', (err) => {
        console.error(`[printPDF] Erro ao executar SumatraPDF: ${err.message}`);
        reject(new Error(`Erro ao executar SumatraPDF: ${err.message}`));
      });
    });

    return { success: true };
  } finally {
    setTimeout(() => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }, 15000);
  }
}

// Renders a public HTML URL to PDF using Electron's headless BrowserWindow.
// A preload script overrides window.print() before page JS runs, preventing
// the DANFE viewer from triggering the native Windows print dialog.
async function renderHtmlToPdf(url, options = {}) {
  // Write a minimal preload that silences window.print before any page JS runs
  const preloadPath = path.join(os.tmpdir(), `boomm_noprint_${Date.now()}.js`);
  try {
    fs.writeFileSync(preloadPath, 'try { window.print = function(){}; } catch(e) {}');
  } catch { /* continue without preload if write fails */ }

  return new Promise((resolve, reject) => {
    let win = null;
    let settled = false;

    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (win && !win.isDestroyed()) {
        try { win.destroy(); } catch { /* ignore */ }
      }
      try { fs.unlinkSync(preloadPath); } catch { /* ignore */ }
      fn(val);
    };

    const timer = setTimeout(() => {
      settle(reject, new Error(`Timeout (35s) ao renderizar DANFE: ${url.slice(0, 80)}`));
    }, 35000);

    try {
      win = new BrowserWindow({
        width: 900,
        height: 1200,
        show: false,
        webPreferences: {
          preload: preloadPath,
          nodeIntegration: false,
          // contextIsolation: false allows the preload to override window.print
          // in the page's own JS context, preventing native print dialogs
          contextIsolation: false,
          javascript: true,
        },
      });

      win.webContents.on('did-finish-load', () => {
        // Belt-and-suspenders: override window.print in main world after load too
        win.webContents.executeJavaScript('window.print = function(){};').catch(() => {});

        // Wait 2s for any JS-rendered content before capturing
        setTimeout(async () => {
          try {
            const pdfData = await win.webContents.printToPDF({
              landscape: false,
              pageSize: 'A4',
              printBackground: true,
              margins: { marginType: 'printableArea' },
            });
            console.log(`[renderHtmlToPdf] PDF gerado: ${pdfData.length} bytes`);
            settle(resolve, Buffer.from(pdfData));
          } catch (e) {
            settle(reject, new Error(`Erro ao gerar PDF do DANFE: ${e.message}`));
          }
        }, 2000);
      });

      win.webContents.on('did-fail-load', (_e, code, desc) => {
        settle(reject, new Error(`Falha ao carregar DANFE (${code}): ${desc}`));
      });

      win.loadURL(url).catch((e) => {
        settle(reject, new Error(`Erro ao carregar URL DANFE: ${e.message}`));
      });
    } catch (e) {
      settle(reject, new Error(`Erro ao criar janela de renderização: ${e.message}`));
    }
  });
}

async function printZPL(printerName, zplContent) {
  const ipMatch = printerName.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  if (ipMatch) return sendZPLviaTCP(ipMatch[1], 9100, zplContent);
  return sendZPLviaWindowsRaw(printerName, zplContent);
}

function sendZPLviaTCP(host, port, content) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host, port }, () => {
      client.write(content, 'utf8', () => client.end());
    });
    client.on('end', () => resolve({ success: true }));
    client.on('error', (err) => reject(err));
    client.setTimeout(10000, () => {
      client.destroy();
      reject(new Error('Timeout ao conectar na impressora ZPL via TCP'));
    });
  });
}

function sendZPLviaWindowsRaw(printerName, zplContent) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `boomm_zpl_${Date.now()}.prn`);
    fs.writeFileSync(tmpFile, zplContent, 'binary');
    exec(`copy /B "${tmpFile}" "\\\\.\\${printerName}"`, { timeout: 15000 }, (err) => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      if (err) reject(new Error('Falha ao enviar ZPL RAW: ' + err.message));
      else resolve({ success: true });
    });
  });
}

module.exports = { getPrinters, printPDF, printZPL, renderHtmlToPdf };
