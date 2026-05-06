const { BrowserWindow } = require('electron');
const { getPendingJobs, updateJobStatus } = require('./api');
const { printPDF, printZPL } = require('./printer');
const axios = require('axios');

let pollTimer = null;
let isProcessing = false;

function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
  });
}

async function downloadUrl(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  return {
    data: Buffer.from(res.data),
    contentType: res.headers['content-type'] || 'application/pdf',
  };
}

async function printDocument(url, contentType, printerName, jobType) {
  const { data, contentType: ct } = await downloadUrl(url);
  const resolvedType = contentType || ct || '';
  if (resolvedType.includes('zpl') || jobType === 'zpl') {
    await printZPL(printerName, data.toString('utf8'));
  } else {
    await printPDF(printerName, data);
  }
}

async function processJobs() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const jobs = await getPendingJobs();

    for (const job of jobs) {
      const label = job.title || job.name || `Job #${job.id.slice(0, 8)}`;
      broadcast('job-update', { id: job.id, status: 'processing', name: label });

      try {
        await updateJobStatus(job.id, 'printing');

        const docs = Array.isArray(job.documents) && job.documents.length > 0
          ? job.documents
          : job.content_url
            ? [{ url: job.content_url, format: job.content_type || 'PDF', type: 'label', order: 1 }]
            : [];

        if (docs.length === 0) {
          throw new Error('Job sem arquivo para impressão (content_url e documents vazios).');
        }

        // sort by order ascending
        docs.sort((a, b) => (a.order || 0) - (b.order || 0));

        const printerName = job.printer_name || job.printerName || '';

        for (const doc of docs) {
          if (!doc.url) continue;
          await printDocument(doc.url, doc.format, printerName, doc.type);
        }

        await updateJobStatus(job.id, 'printed');
        broadcast('job-update', { id: job.id, status: 'printed' });
        broadcast('status-update', { type: 'success', message: `${label} impresso com sucesso.` });
      } catch (err) {
        console.error(`Job ${job.id} failed:`, err.message);
        await updateJobStatus(job.id, 'error', err.message).catch(() => {});
        broadcast('job-update', { id: job.id, status: 'failed', error: err.message });
        broadcast('status-update', { type: 'error', message: `${label} falhou: ${err.message}` });
      }
    }
  } catch (err) {
    if (!err.message?.includes('Configure') && !err.message?.includes('pareado')) {
      broadcast('status-update', { type: 'error', message: 'Erro ao buscar jobs: ' + err.message });
    }
  } finally {
    isProcessing = false;
  }
}

function startJobProcessor() {
  stopJobProcessor();
  const Store = require('electron-store');
  const store = new Store();
  const interval = Math.max(Number(store.get('pollingInterval', 5000)), 3000);
  pollTimer = setInterval(processJobs, interval);
  setTimeout(processJobs, 2000);
  console.log(`Job processor started (every ${interval}ms)`);
}

function stopJobProcessor() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = { startJobProcessor, stopJobProcessor };
