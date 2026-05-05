const axios = require('axios');
const os = require('os');
const Store = require('electron-store');

const store = new Store();
const { version: APP_VERSION } = require('../../package.json');

function getClient(authToken) {
  const apiUrl = store.get('apiUrl');
  if (!apiUrl) throw new Error('URL da API não configurada.');

  return axios.create({
    baseURL: apiUrl.replace(/\/$/, ''),
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'X-App': 'boomm-printer-desktop',
      'X-Version': APP_VERSION,
    },
    timeout: 15000,
  });
}

function getPairedClient() {
  const deviceToken = store.get('deviceToken');
  if (!deviceToken) {
    throw new Error('App não pareado. Configure a chave de acesso e clique em Parear.');
  }
  return getClient(deviceToken);
}

async function pairWithKey(printAccessKey, computerName, printers) {
  const apiUrl = store.get('apiUrl');
  if (!apiUrl || !printAccessKey) {
    throw new Error('URL da API e Chave de acesso são obrigatórios.');
  }

  const client = axios.create({
    baseURL: apiUrl.replace(/\/$/, ''),
    headers: {
      'Content-Type': 'application/json',
      'X-App': 'boomm-printer-desktop',
      'X-Version': APP_VERSION,
    },
    timeout: 15000,
  });

  const res = await client.post('/api/desktop/pair', {
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

  const data = res.data;
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
    const client = getPairedClient();
    const res = await client.post('/api/desktop/heartbeat', {
      status: 'online',
      timestamp: new Date().toISOString(),
    });
    return { connected: true, ...res.data };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) throw new Error('Token inválido (401). Refaça o pareamento.');
    if (status === 405) throw new Error('Método não permitido (405). Verifique a URL do SaaS.');
    throw err;
  }
}

async function heartbeat() {
  try {
    const client = getPairedClient();
    const res = await client.post('/api/desktop/heartbeat', {
      status: 'online',
      timestamp: new Date().toISOString(),
    });
    return res.data;
  } catch {
    return null;
  }
}

async function syncPrinters(printers) {
  const client = getPairedClient();
  const res = await client.post('/api/desktop/printers/sync', {
    computer_id: store.get('computerId'),
    printers: printers.map((p) => ({
      name: p.name,
      port: p.port || '',
      status: p.status || 'ready',
      is_default: p.isDefault || false,
    })),
  });
  return res.data;
}

async function getPendingJobs() {
  const client = getPairedClient();
  const res = await client.get('/api/desktop/jobs', {
    params: { status: 'pending', computer_id: store.get('computerId') },
  });
  return Array.isArray(res.data) ? res.data : res.data?.jobs || [];
}

async function updateJobStatus(jobId, status, error = null) {
  const client = getPairedClient();
  const payload = { status };
  if (error) payload.error = error;
  const res = await client.patch(`/api/desktop/jobs/${jobId}/status`, payload);
  return res.data;
}

async function downloadJobFile(jobId) {
  const client = getPairedClient();
  const res = await client.get(`/api/desktop/jobs/${jobId}/file`, {
    responseType: 'arraybuffer',
  });
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
