const { BrowserWindow } = require('electron');
const { exec } = require('child_process');
const { pathToFileURL } = require('url');
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

// Queries the Windows print spooler for diagnostic info after a print job is sent.
// Fire-and-forget — never blocks the print result.
function diagnosePrintSpooler(printerName) {
  return new Promise((resolve) => {
    const safeName = printerName.replace(/'/g, "''");
    const cmd = `Get-PrintJob -PrinterName '${safeName}' | Select-Object Id,JobStatus,DocumentName | ConvertTo-Json -Compress`;
    exec(`powershell -NonInteractive -Command "${cmd}"`, { timeout: 10000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        console.log(`[spooler] Nenhum job encontrado na fila de "${printerName}" (impressora offline ou fila vazia)`);
      } else {
        console.log(`[spooler] Jobs na fila de "${printerName}": ${stdout.trim()}`);
      }
      resolve();
    });
  });
}

async function printPDF(printerName, pdfBuffer, options = {}) {
  const normalized = (printerName || '').toLowerCase();
  console.log(`[printPDF] Impressora: "${printerName}" | normalizado: "${normalized}"`);

  if (normalized === 'microsoft print to pdf' || normalized.includes('print to pdf')) {
    console.log('[printPDF] → Modo: salvar PDF em disco (Microsoft Print to PDF) — sem diálogo nativo');
    return savePDFtoDisk(pdfBuffer, options);
  }

  console.log('[printPDF] → Modo: impressão física via Electron silent print');

  const tmpFile = path.join(os.tmpdir(), `boomm_pdf_${Date.now()}.pdf`);
  try {
    fs.writeFileSync(tmpFile, pdfBuffer);
    console.log(`[printPDF] Abrindo PDF para impressão: ${tmpFile}`);

    await new Promise((resolve, reject) => {
      let win = null;
      let settled = false;

      const settle = (fn, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (win && !win.isDestroyed()) {
          try { win.destroy(); } catch { /* ignore */ }
        }
        fn(val);
      };

      const timer = setTimeout(() => {
        settle(reject, new Error(`Timeout (30s) ao imprimir PDF na impressora "${printerName}"`))
      }, 30000);

      try {
        win = new BrowserWindow({
          width: 800,
          height: 1100,
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        win.webContents.on('did-finish-load', () => {
          console.log(`[printPDF] Enviando para impressora: ${printerName}`);
          win.webContents.print(
            {
              silent: true,
              printBackground: true,
              deviceName: printerName,
              copies: Math.max(1, options.copies || 1),
            },
            (success, failureReason) => {
              console.log(`[printPDF] Resultado webContents.print: success=${success}${!success ? `, reason=${failureReason}` : ''}`);
              if (success) {
                settle(resolve, undefined);
                diagnosePrintSpooler(printerName).catch(() => {});
              } else {
                settle(reject, new Error(`Falha ao imprimir em "${printerName}": ${failureReason || 'razão desconhecida'}`));
              }
            }
          );
        });

        win.webContents.on('did-fail-load', (_e, code, desc) => {
          settle(reject, new Error(`Falha ao carregar PDF para impressão (${code}): ${desc}`));
        });

        win.loadURL(pathToFileURL(tmpFile).toString()).catch((e) => {
          settle(reject, new Error(`Erro ao carregar PDF: ${e.message}`));
        });
      } catch (e) {
        settle(reject, new Error(`Erro ao criar janela de impressão: ${e.message}`));
      }
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
