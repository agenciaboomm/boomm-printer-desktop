const { BrowserWindow } = require('electron');
const { getPendingJobs, updateJobStatus } = require('./api');
const { printPDF, printZPL, renderHtmlToPdf } = require('./printer');
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

function isHtmlViewerUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.includes('erp.tiny.com.br') && u.pathname.includes('doc.view');
  } catch {
    return false;
  }
}

async function printDocument(url, contentType, printerName, jobType, options = {}) {
  if (!printerName) throw new Error('Nenhuma impressora configurada para este job. Defina uma impressora padrão no SaaS.');

  const isPdfToDisk = (printerName || '').toLowerCase().includes('print to pdf');

  // If the URL is an HTML viewer (e.g. Tiny doc.view DANFE), render it via
  // Electron's headless BrowserWindow instead of downloading as raw bytes.
  if (isHtmlViewerUrl(url)) {
    broadcast('status-update', { type: 'info', message: 'DANFE HTML detectado: renderizando via Electron...' });
    if (isPdfToDisk) {
      broadcast('status-update', { type: 'info', message: 'Microsoft Print to PDF detectado: salvando em disco sem abrir diálogo de impressão.' });
    }
    const pdfBuffer = await renderHtmlToPdf(url, options);
    if (!pdfBuffer || pdfBuffer.length < 4 || pdfBuffer.slice(0, 4).toString('ascii') !== '%PDF') {
      throw new Error('DANFE renderizado não é um PDF válido.');
    }
    broadcast('status-update', { type: 'info', message: `PDF DANFE validado (%PDF OK, ${pdfBuffer.length} bytes). Enviando para impressora...` });
    try {
      return await printPDF(printerName, pdfBuffer, options);
    } catch (printErr) {
      throw new Error(`Impressora "${printerName}": ${printErr.message}`);
    }
  }

  const { data, contentType: ct } = await downloadUrl(url);
  const resolvedType = contentType || ct || '';

  if (isPdfToDisk) {
    broadcast('status-update', { type: 'info', message: 'Microsoft Print to PDF detectado: salvando em disco sem abrir diálogo de impressão.' });
  }

  // Fallback: if downloaded content is not a PDF, try HTML rendering
  if (!resolvedType.includes('pdf') && (data.length < 4 || data.slice(0, 4).toString('ascii') !== '%PDF')) {
    broadcast('status-update', { type: 'info', message: `Conteúdo não é PDF (${resolvedType}): tentando renderização HTML...` });
    const pdfBuffer = await renderHtmlToPdf(url, options);
    if (!pdfBuffer || pdfBuffer.length < 4 || pdfBuffer.slice(0, 4).toString('ascii') !== '%PDF') {
      throw new Error(`URL retornou HTML e não foi possível renderizar como PDF: ${url.slice(0, 80)}`);
    }
    broadcast('status-update', { type: 'info', message: `PDF gerado via Electron (%PDF OK, ${pdfBuffer.length} bytes).` });
    try {
      return await printPDF(printerName, pdfBuffer, options);
    } catch (printErr) {
      throw new Error(`Impressora "${printerName}": ${printErr.message}`);
    }
  }

  try {
    if (resolvedType.includes('zpl') || jobType === 'zpl') {
      return await printZPL(printerName, data.toString('utf8'));
    } else {
      return await printPDF(printerName, data, options);
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
        // Belt-check: if the printer is supposed to be a PDF-to-disk driver,
        // we MUST get a savedPath back. No file = no success.
        const isPDFToDisk = printerName.toLowerCase().includes('print to pdf');

        // Always broadcast which printer was selected — visible in Atividade Recente.
        // This is the key diagnostic: if it shows the wrong printer, check the PrintRule.
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
            // The name matched the belt-check but printPDF did not route to
            // savePDFtoDisk (internal name-check mismatch). Fail loudly.
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
      // Token revogado ou computador re-pareado em outro dispositivo.
      // Pare o polling para não inundar a Atividade com erros repetidos.
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
  const interval = Math.max(Number(store.get('pollingInterval', 2000)), 2000);
  pollTimer = setInterval(processJobs, interval);
  setTimeout(processJobs, 500);
  console.log(`Job processor started (every ${interval}ms)`);

  // Reconcile PrintPackages stuck as 'printing' from previous sessions.
  // Runs once 8 s after startup so the first poll has time to complete first.
  setTimeout(() => {
    const { reconcilePackages } = require('./api');
    reconcilePackages().then((r) => {
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
