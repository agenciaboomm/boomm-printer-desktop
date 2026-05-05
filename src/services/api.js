const axios = require('axios');
const os = require('os');
const Store = require('electron-store');

const store = new Store();
const { version: APP_VERSION } = require('../../package.json');

function getBaseUrl() {
  const apiUrl = store.get('apiUrl');
  if (!apiUrl) throw new Error('URL da API não configurada.');
  return apiUrl.replace(/\/$/, '');
}

function getDeviceToken() {
  const deviceToken = store.get('deviceToken');
  if (!deviceToken) {
    throw new Error('App não pareado. Configure a chave de acesso e clique em Parear.');
  }
  return deviceToken;
}

async function callDesktopApi(path, body, authToken = null) {
  const baseUrl = getBaseUrl();
  const headers = {
    'Content-Type': 'application/json',
    'X-App': 'boomm-printer-desktop',
    'X-Version': APP_VERSION,
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const res = await axios.post(
    `${baseUrl}/functions/desktopApi`,
    { _path: path, ...body },
    { headers, timeout: 15000 }
  );
  return res.data;
}

async function pairWithKey(printAccessKey, computerName, printers) {
  const apiUrl = store.get('apiUrl');
  if (!apiUrl || !printAccessKey) {
    throw new Error('URL da API e Chave de acesso são obrigatórios.');
  }

  const data = await callDesktopApi('/pair', {
    print_access_key: printAccessKey,
    computer_name: computerName || os.hostname(),
    hostname: os.hostname(),
    os: process.platform,
    arch: process.arch,
    app_version: APP_VERSION,
    local_printers: printers.map((p) => ({
      name: p.name,
      port: p.port || '',
      is_default: p.isDefault || false,
    })),
  });

  if (data.device_token) store.set('deviceToken', data.device_token);
  if (data.computer_id) store.set('computerId', data.computer_id);
  if (data.company_id) store.set('companyId', data.company_id);

  return data;
}

async function testConnection() {
  const deviceToken = store.get('deviceToken');
  if (!deviceToken) {
    return { connected: false, message: 'App não pareado. Clique em "Parear Agora" primeiro.' };
  }
  try {
    const data = await callDesktopApi('/heartbeat', { app_version: APP_VERSION }, deviceToken);
    return { connected: true, ...data };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) throw new Error('Token inválido (401). Refaça o pareamento.');
    if (status === 405) throw new Error('Método não permitido (405). Verifique a URL do SaaS.');
    throw err;
  }
}

async function heartbeat() {
  try {
    const deviceToken = getDeviceToken();
    return await callDesktopApi('/heartbeat', { app_version: APP_VERSION }, deviceToken);
  } catch {
    return null;
  }
}

async function syncPrinters(printers) {
  const deviceToken = getDeviceToken();
  return await callDesktopApi('/printers/sync', {
    printers: printers.map((p) => ({
      name: p.name,
      port: p.port || '',
      status: p.status || 'ready',
      is_default: p.isDefault || false,
    })),
  }, deviceToken);
}

async function getPendingJobs() {
  const deviceToken = getDeviceToken();
  const data = await callDesktopApi('/jobs', { status: 'sent' }, deviceToken);
  return Array.isArray(data) ? data : data?.jobs || [];
}

async function updateJobStatus(jobId, status, error = null) {
  const deviceToken = getDeviceToken();
  const body = { status };
  if (error) body.error = error;
  return await callDesktopApi(`/jobs/${jobId}/status`, body, deviceToken);
}

async function downloadJobFile(jobId) {
  const baseUrl = getBaseUrl();
  const deviceToken = getDeviceToken();
  const res = await axios.post(
    `${baseUrl}/functions/desktopApi`,
    { _path: `/jobs/${jobId}/file` },
    {
      headers: {
        Authorization: `Bearer ${deviceToken}`,
        'Content-Type': 'application/json',
        'X-App': 'boomm-printer-desktop',
        'X-Version': APP_VERSION,
      },
      responseType: 'arraybuffer',
      timeout: 30000,
    }
  );
  return {
    data: Buffer.from(res.data),
    contentType: res.headers['content-type'] || 'application/pdf',
  };
}

module.exports = {
  pairWithKey,
  testConnection,
  heartbeat,
  syncPrinters,
  getPendingJobs,
  updateJobStatus,
  downloadJobFile,
};
