const { exec } = require('child_process');
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
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const rawTitle = (options.title || `Boomm_${Date.now()}`)
    .replace(/[<>:"/\\|?*\r\n]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const fileName = rawTitle.endsWith('.pdf') ? rawTitle : `${rawTitle}.pdf`;
  const outputPath = path.join(outputDir, fileName);

  fs.writeFileSync(outputPath, pdfBuffer);

  const stat = fs.statSync(outputPath);
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
    console.log('[printPDF] → Modo: salvar PDF em disco (Microsoft Print to PDF)');
    return savePDFtoDisk(pdfBuffer, options);
  }

  console.log('[printPDF] → Modo: impressão física via PowerShell');
  const tmpFile = path.join(os.tmpdir(), `boomm_pdf_${Date.now()}.pdf`);

  try {
    fs.writeFileSync(tmpFile, pdfBuffer);

    await new Promise((resolve, reject) => {
      const psScript = [
        `$file = '${tmpFile.replace(/'/g, "''")}'`,
        `$printer = '${printerName.replace(/'/g, "''")}'`,
        `$shell = New-Object -ComObject Shell.Application`,
        `$dir = $shell.Namespace([System.IO.Path]::GetDirectoryName($file))`,
        `$item = $dir.ParseName([System.IO.Path]::GetFileName($file))`,
        `$item.InvokeVerbEx('printto', $printer)`,
        `Start-Sleep -Seconds 4`,
      ].join('; ');

      exec(`powershell -NonInteractive -Command "${psScript}"`, { timeout: 30000 }, (err) => {
        if (err) {
          const fallback = `Start-Process -FilePath '${tmpFile.replace(/'/g, "''")}' -Verb print -Wait`;
          exec(`powershell -NonInteractive -Command "${fallback}"`, { timeout: 20000 }, (err2) => {
            if (err2) reject(new Error('Falha ao imprimir PDF: ' + err2.message));
            else resolve();
          });
        } else {
          resolve();
        }
      });
    });

    return { success: true };
  } finally {
    setTimeout(() => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }, 15000);
  }
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

module.exports = { getPrinters, printPDF, printZPL };
