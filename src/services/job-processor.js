const { BrowserWindow } = require('electron');
const { getPendingJobs, updateJobStatus } = require('./api');
const { printPDF, printZPL, renderHtmlUrlToPdf, isPdfBuffer } = require('./printer');
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

function looksLikeHtml(buffer, contentType = '') {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return true;
  if (!Buffer.isBuffer(buffer)) return false;
  const head = buffer.slice(0, 300).toString('utf8').trim().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<html');
}

async function printDocument(url, contentType, printerName, jobType, options = {}) {
  if (!printerName) throw new Error('Nenhuma impressora configurada para este job. Defina uma impressora padrão no SaaS.');

  const declaredType = String(contentType || '').toLowerCase();

  if (declaredType.includes('zpl') || jobType === 'zpl') {
    const { data } = await downloadUrl(url);
    return await printZPL(printerName, data.toString('utf8'));
  }

  const { data, contentType: downloadedType } = await downloadUrl(url);
  let pdfBuffer = data;

  if (looksLikeHtml(data, downloadedType) || looksLikeHtml(data, declaredType)) {
    broadcast('status-update', { type: 'info', message: 'DANFE HTML detectado: renderizando como PDF real via Electron.' });
    pdfBuffer = await renderHtmlUrlToPdf(url, options);
  }

  if (!isPdfBuffer(pdfBuffer)) {
    const preview = Buffer.isBuffer(pdfBuffer) ? pdfBuffer.slice(0, 80).toString('utf8') : '';
    throw new Error(`Arquivo recebido não é PDF válido. Content-Type=${downloadedType || declaredType || 'n/a'} Preview=${preview.replace(/\s+/g, ' ').slice(0, 80)}`);
  }

  try {
    return await printPDF(printerName, pdfBuffer, options);
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
            ? [{ url: job.content_url, format: job.content_type || 'PDF', type: job.document_type || 'label', order: 1 }]
            : [];

        if (docs.length === 0) {
          throw new Error('Job sem arquivo para impressão (content_url e documents vazios).');
        }

        docs.sort((a, b) => (a.order || 0) - (b.order || 0));

        const printerName = job.printer_name || job.printerName || '';
        const isPDFToDisk = printerName.toLowerCase().includes('print to pdf');

        console.log(`[job-processor] Job "${label}": printer_name="${printerName}" isPDFToDisk=${isPDFToDisk}`);
        broadcast('status-update', {
          type: 'info',
          message: `Imprimindo "${label}" | Impressora: "${printerName || 'não definida'}"`,
        });

        for (const doc of docs) {
          if (!doc.url) continue;
          const result = await printDocument(doc.url, doc.format, printerName, doc.type, { title: label });
          if (result?.savedPath) {
            broadcast('status-update', { type: 'info', message: `PDF salvo em: ${result.savedPath}` });
          } else if (isPDFToDisk) {
            throw new Error(
              `Impressora "${printerName}" deveria salvar em disco mas nenhum arquivo foi gerado. ` +
              `Verifique se o nome exato no Windows é "Microsoft Print to PDF".`
            );
          }
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
    const httpStatus = err.response?.status;
    if (httpStatus === 401) {
      stopJobProcessor();
      broadcast('status-update', { type: 'error', message: 'Sessão expirada (401). Refazer o pareamento em Configurações.' });
      broadcast('pairing-status', { isPaired: false, expired: true });
    } else if (!err.message?.includes('Configure') && !err.message?.includes('pareado')) {
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
  const interval = Math.max(Number(store.get('pollingInterval', 10000)), 10000);
  pollTimer = setInterval(processJobs, interval);
  setTimeout(processJobs, 1000);
  console.log(`Job processor started (every ${interval}ms)`);

  setTimeout(() => {
    const api = require('./api');
    if (typeof api.reconcilePackages !== 'function') return;
    api.reconcilePackages().then((r) => {
      if (r && (r.reconciled > 0 || r.timed_out > 0)) {
        broadcast('status-update', {
          type: 'info',
          message: `Reconciliação: ${r.reconciled} pacotes resolvidos, ${r.timed_out} expirados de ${r.total} presos.`,
        });
      }
    }).catch(() => null);
  }, 8000);
}

function stopJobProcessor() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = { startJobProcessor, stopJobProcessor };
