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
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    return {
      data: Buffer.from(res.data),
      contentType: res.headers['content-type'] || 'application/pdf',
    };
  } catch (err) {
    const status = err.response?.status;
    const shortUrl = url.length > 80 ? url.slice(0, 77) + '...' : url;
    if (status === 404) throw new Error(`Arquivo não encontrado (404): ${shortUrl}`);
    if (status === 401 || status === 403) throw new Error(`Acesso negado ao arquivo (${status}): ${shortUrl}`);
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') throw new Error(`Timeout ao baixar arquivo: ${shortUrl}`);
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') throw new Error(`URL inacessível: ${shortUrl}`);
    throw new Error(`Falha ao baixar arquivo (${status || err.code || 'ERR'}): ${err.message}`);
  }
}

async function printDocument(url, contentType, printerName, jobType) {
  if (!printerName) throw new Error('Nenhuma impressora configurada para este job. Defina uma impressora padrão no SaaS.');
  const { data, contentType: ct } = await downloadUrl(url);
  const resolvedType = contentType || ct || '';
  try {
    if (resolvedType.includes('zpl') || jobType === 'zpl') {
      await printZPL(printerName, data.toString('utf8'));
    } else {
      await printPDF(printerName, data);
    }
  } catch (printErr) {
    throw new Error(`Impressora "${printerName}": ${printErr.message}`);
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

      // Mark as printing first. If the SaaS is unreachable, skip this job
      // and try again next poll — don't mark as error just because of a network blip.
      try {
        await updateJobStatus(job.id, 'printing');
      } catch (statusErr) {
        console.warn(`Job ${job.id}: não foi possível atualizar status para printing (${statusErr.message}). Tentando novamente no próximo ciclo.`);
        broadcast('job-update', { id: job.id, status: 'pending' });
        continue;
      }

      try {
        const docs = Array.isArray(job.documents) && job.documents.length > 0
          ? job.documents
          : job.content_url
            ? [{ url: job.content_url, format: job.content_type || 'PDF', type: 'label', order: 1 }]
            : [];

        if (docs.length === 0) {
          throw new Error('Job sem arquivo para impressão (content_url e documents vazios).');
        }

        docs.sort((a, b) => (a.order || 0) - (b.order || 0));

        const printerName = job.printer_name || job.printerName || '';

        for (const doc of docs) {
          if (!doc.url) continue;
          await printDocument(doc.url, doc.format, printerName, doc.type);
        }

        await updateJobStatus(job.id, 'printed').catch((e) => {
          console.error(`Job ${job.id}: impresso mas falhou ao atualizar status: ${e.message}`);
        });
        broadcast('job-update', { id: job.id, status: 'printed' });
        broadcast('status-update', { type: 'success', message: `${label} impresso com sucesso.` });
      } catch (err) {
        console.error(`Job ${job.id} falhou:`, err.message);
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
