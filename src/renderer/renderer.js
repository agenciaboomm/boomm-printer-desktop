'use strict';

const api = window.electronAPI;

let jobsDone = 0;
let jobsFailed = 0;

// --- Navigation ---
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
    link.classList.add('active');
    const section = document.getElementById(link.dataset.section);
    if (section) section.classList.add('active');
  });
});

// --- Init ---
async function init() {
  const settings = await api.getSettings();
  document.getElementById('apiUrl').value = settings.apiUrl || '';
  document.getElementById('apiKey').value = settings.apiKey || '';
  document.getElementById('computerName').value = settings.computerName || '';
  document.getElementById('pollingInterval').value = settings.pollingInterval || 5000;

  await loadPrinters();

  api.onStatusUpdate((data) => addLog(data));
  api.onJobUpdate((data) => handleJobUpdate(data));
}

// --- Printers ---
async function loadPrinters() {
  const result = await api.getPrinters();
  renderPrinters(result.printers || []);
  document.getElementById('stat-printers').textContent = (result.printers || []).length;
}

function renderPrinters(list) {
  const container = document.getElementById('printers-list');
  if (!list || list.length === 0) {
    container.innerHTML = '<p class="empty-state">Nenhuma impressora encontrada no sistema.</p>';
    return;
  }
  container.innerHTML = list
    .map(
      (p) => `
      <div class="printer-item ${p.isDefault ? 'default' : ''}">
        <div class="printer-icon">🖨️</div>
        <div class="printer-info">
          <div class="printer-name">${escHtml(p.name)}</div>
          <div class="printer-details">Porta: ${escHtml(p.port || 'N/A')} &bull; Status: ${escHtml(p.status)}</div>
        </div>
        ${p.isDefault ? '<span class="printer-badge">Padrão</span>' : ''}
      </div>`
    )
    .join('');
}

// --- Logs ---
function addLog(data) {
  const log = document.getElementById('activity-log');
  const placeholder = log.querySelector('.empty-state');
  if (placeholder) placeholder.remove();

  const time = new Date().toLocaleTimeString('pt-BR');
  const icon = data.type === 'error' ? '❌' : data.type === 'success' ? '✅' : 'ℹ️';
  const el = document.createElement('div');
  el.className = `log-entry ${data.type || ''}`;
  el.innerHTML = `<span class="log-time">${time}</span>${icon} ${escHtml(data.message)}`;
  log.insertBefore(el, log.firstChild);
  while (log.children.length > 60) log.removeChild(log.lastChild);
}

// --- Jobs ---
function handleJobUpdate(data) {
  if (data.status === 'completed') {
    jobsDone++;
    document.getElementById('stat-jobs-done').textContent = jobsDone;
  } else if (data.status === 'failed') {
    jobsFailed++;
    document.getElementById('stat-jobs-fail').textContent = jobsFailed;
  }

  const existing = document.getElementById(`job-${data.id}`);
  if (existing) {
    existing.className = `job-item status-${data.status}`;
    existing.querySelector('.job-status').textContent = data.status;
  } else {
    const container = document.getElementById('jobs-list');
    const placeholder = container.querySelector('.empty-state');
    if (placeholder) placeholder.remove();
    const el = document.createElement('div');
    el.id = `job-${data.id}`;
    el.className = `job-item status-${data.status}`;
    el.innerHTML = `
      <span class="job-id">#${escHtml(String(data.id))}</span>
      <span class="job-name">${escHtml(data.name || 'Job')}</span>
      <span class="job-status">${escHtml(data.status)}</span>`;
    container.insertBefore(el, container.firstChild);
    if (container.children.length > 100) container.removeChild(container.lastChild);
  }
}

// --- Status badge ---
function setStatus(connected) {
  const badge = document.getElementById('status-badge');
  if (connected) {
    badge.className = 'badge badge-success';
    badge.textContent = 'Conectado';
  } else {
    badge.className = 'badge badge-error';
    badge.textContent = 'Desconectado';
  }
}

// --- Alerts ---
function showAlert(message, type = 'info') {
  const container = document.getElementById('alerts-container');
  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// --- Settings form ---
document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const result = await api.saveSettings({
    apiUrl: document.getElementById('apiUrl').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    computerName: document.getElementById('computerName').value.trim(),
    pollingInterval: parseInt(document.getElementById('pollingInterval').value, 10) || 5000,
  });

  btn.disabled = false;
  btn.textContent = 'Salvar Configurações';

  if (result.success) showAlert('Configurações salvas com sucesso!', 'success');
  else showAlert('Erro ao salvar: ' + result.error, 'error');
});

document.getElementById('test-conn-btn').addEventListener('click', async () => {
  const btn = document.getElementById('test-conn-btn');
  btn.disabled = true;
  btn.textContent = 'Testando...';
  const result = await api.testConnection();
  btn.disabled = false;
  btn.textContent = 'Testar Conexão';
  if (result.success) {
    setStatus(true);
    showAlert('Conexão estabelecida com sucesso!', 'success');
  } else {
    setStatus(false);
    showAlert('Falha na conexão: ' + result.error, 'error');
  }
});

document.getElementById('refresh-printers-btn').addEventListener('click', loadPrinters);

document.getElementById('sync-printers-btn').addEventListener('click', async () => {
  const result = await api.syncPrinters();
  if (result.success) showAlert(`${result.count} impressora(s) sincronizadas!`, 'success');
  else showAlert('Erro ao sincronizar: ' + result.error, 'error');
});

// --- Helpers ---
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
