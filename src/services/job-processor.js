const { BrowserWindow } = require('electron');
const { getPendingJobs, updateJobStatus, downloadJobFile } = require('./api');
const { printPDF, printZPL } = require('./printer');

let pollTimer = null;
let isProcessing = false;

function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
  });
}

async function processJobs() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const jobs = await getPendingJobs();

    for (const job of jobs) {
      broadcast('job-update', { id: job.id, status: 'processing', name: job.name || `Job #${job.id}` });

      try {
        await updateJobStatus(job.id, 'processing');

        const { data, contentType } = await downloadJobFile(job.id);
        const printerName = job.printer_name || job.printerName || '';

        if (contentType.includes('zpl') || job.type === 'zpl') {
          await printZPL(printerName, data.toString('utf8'));
        } else {
          await printPDF(printerName, data);
        }

        await updateJobStatus(job.id, 'completed');
        broadcast('job-update', { id: job.id, status: 'completed' });
        broadcast('status-update', { type: 'success', message: `Job #${job.id} impresso com sucesso.` });
      } catch (err) {
        console.error(`Job ${job.id} failed:`, err.message);
        await updateJobStatus(job.id, 'failed', err.message).catch(() => {});
        broadcast('job-update', { id: job.id, status: 'failed', error: err.message });
        broadcast('status-update', { type: 'error', message: `Job #${job.id} falhou: ${err.message}` });
      }
    }
  } catch (err) {
    if (!err.message?.includes('Configure')) {
      console.error('Poll error:', err.message);
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
    console.log('Job processor stopped');
  }
}

module.exports = { startJobProcessor, stopJobProcessor };
