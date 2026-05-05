const axios = require('axios');
const os = require('os');
const Store = require('electron-store');

const store = new Store();

function getClient() {
  const apiUrl = store.get('apiUrl');
  const apiKey = store.get('apiKey');

  if (!apiUrl || !apiKey) {
    throw new Error('Configure a URL da API e a Chave de API nas Configurações.');
  }

  return axios.create({
    baseURL: apiUrl.replace(/\/$/, ''),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-App': 'boomm-printer-desktop',
      'X-Version': '0.1.0',
    },
    timeout: 15000,
  });
}

async function testConnection() {
  const client = getClient();
  const res = await client.get('/api/desktop/ping');
  return res.data;
}

async function registerComputer() {
  const client = getClient();
  const computerName = store.get('computerName') || os.hostname();

  const res = await client.post('/api/desktop/computers/register', {
    name: computerName,
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    version: '0.1.0',
  });

  if (res.data?.id) {
    store.set('computerId', res.data.id);
  }

  return res.data;
}

async function syncPrinters(printers) {
  const client = getClient();
  const computerId = store.get('computerId');

  if (!computerId) {
    throw new Error('computerId não encontrado. Registre o computador primeiro.');
  }

  const res = await client.post(`/api/desktop/computers/${computerId}/printers`, {
    printers: printers.map((p) => ({
      name: p.name,
      port: p.port || '',
      status: p.status || 'ready',
      isDefault: p.isDefault || false,
    })),
  });

  return res.data;
}

async function getPendingJobs() {
  const client = getClient();
  const computerId = store.get('computerId');
  if (!computerId) return [];

  const res = await client.get(`/api/desktop/computers/${computerId}/jobs`, {
    params: { status: 'pending' },
  });

  return Array.isArray(res.data) ? res.data : res.data?.jobs || [];
}

async function updateJobStatus(jobId, status, error = null) {
  const client = getClient();
  const payload = { status };
  if (error) payload.error = error;
  const res = await client.patch(`/api/desktop/jobs/${jobId}/status`, payload);
  return res.data;
}

async function downloadJobFile(jobId) {
  const client = getClient();
  const res = await client.get(`/api/desktop/jobs/${jobId}/file`, {
    responseType: 'arraybuffer',
  });
  return {
    data: Buffer.from(res.data),
    contentType: res.headers['content-type'] || 'application/pdf',
  };
}

module.exports = {
  testConnection,
  registerComputer,
  syncPrinters,
  getPendingJobs,
  updateJobStatus,
  downloadJobFile,
};
