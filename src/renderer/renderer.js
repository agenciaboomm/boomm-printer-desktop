'use strict';
const api = window.electronAPI;
let jobsDone = 0, jobsFailed = 0;

document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
    link.classList.add('active');
    const sec = document.getElementById(link.dataset.section);
    if (sec) sec.classList.add('active');
  });
});

async function init() {
  const s = await api.getSettings();
  document.getElementById('apiUrl').value = s.apiUrl || '';
  document.getElementById('apiKey').value = s.apiKey || '';
  document.getElementById('computerName').value = s.computerName || '';
  document.getElementById('pollingInterval').value = s.pollingInterval || 5000;
  await loadPrinters();
  api.onStatusUpdate(addLog);
  api.onJobUpdate(handleJobUpdate);
}

async function loadPrinters() {
  const result = await api.getPrinters();
  renderPrinters(result.printers || []);
  document.getElementById('stat-printers').textContent = (result.printers || []).length;
}

function renderPrinters(list) {
  const c = document.getElementById('printers-list');
  if (!list || !list.length) { c.innerHTML = '<p class="empty-state">Nenhuma impressora encontrada.</p>'; return; }
  c.innerHTML = list.map((p) =>
    `<div class="printer-item ${p.isDefault ? 'default' : ''}">
      <div class="printer-icon">🖨️</div>
      <div class="printer-info">
        <div class="printer-name">${escHtml(p.name)}</div>
        <div class="printer-details">Porta: ${escHtml(p.port||'N/A')} &bull; Status: ${escHtml(p.status)}</div>
      </div>
      ${p.isDefault ? '<span class="printer-badge">Padrão</span>' : ''}
    </div>`
  ).join('');
}

function addLog(data) {
  const log = document.getElementById('activity-log');
  const ph = log.querySelector('.empty-state'); if (ph) ph.remove();
  const time = new Date().toLocaleTimeString('pt-BR');
  const icon = data.type === 'error' ? '❌' : data.type === 'success' ? '✅' : 'ℹ️';
  const el = document.createElement('div');
  el.className = `log-entry ${data.type||''}`;
  el.innerHTML = `<span class="log-time">${time}</span>${icon} ${escHtml(data.message)}`;
  log.insertBefore(el, log.firstChild);
  while (log.children.length > 60) log.removeChild(log.lastChild);
}

function handleJobUpdate(data) {
  if (data.status === 'completed') document.getElementById('stat-jobs-done').textContent = ++jobsDone;
  else if (data.status === 'failed') document.getElementById('stat-jobs-fail').textContent = ++jobsFailed;
  const ex = document.getElementById(`job-${data.id}`);
  if (ex) { ex.className = `job-item status-${data.status}`; ex.querySelector('.job-status').textContent = data.status; return; }
  const c = document.getElementById('jobs-list');
  const ph = c.querySelector('.empty-state'); if (ph) ph.remove();
  const el = document.createElement('div');
  el.id = `job-${data.id}`; el.className = `job-item status-${data.status}`;
  el.innerHTML = `<span class="job-id">#${escHtml(String(data.id))}</span><span class="job-name">${escHtml(data.name||'Job')}</span><span class="job-status">${escHtml(data.status)}</span>`;
  c.insertBefore(el, c.firstChild);
  if (c.children.length > 100) c.removeChild(c.lastChild);
}

function setStatus(ok) {
  const b = document.getElementById('status-badge');
  b.className = ok ? 'badge badge-success' : 'badge badge-error';
  b.textContent = ok ? 'Conectado' : 'Desconectado';
}

function showAlert(msg, type='info') {
  const c = document.getElementById('alerts-container');
  const el = document.createElement('div');
  el.className = `alert alert-${type}`; el.textContent = msg;
  c.appendChild(el); setTimeout(() => el.remove(), 4500);
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true; btn.textContent = 'Salvando...';
  const r = await api.saveSettings({
    apiUrl: document.getElementById('apiUrl').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    computerName: document.getElementById('computerName').value.trim(),
    pollingInterval: parseInt(document.getElementById('pollingInterval').value, 10) || 5000,
  });
  btn.disabled = false; btn.textContent = 'Salvar Configurações';
  if (r.success) showAlert('Configurações salvas!', 'success');
  else showAlert('Erro: ' + r.error, 'error');
});

document.getElementById('test-conn-btn').addEventListener('click', async () => {
  const btn = document.getElementById('test-conn-btn');
  btn.disabled = true; btn.textContent = 'Testando...';
  const r = await api.testConnection();
  btn.disabled = false; btn.textContent = 'Testar Conexão';
  setStatus(r.success);
  if (r.success) showAlert('Conexão OK!', 'success');
  else showAlert('Falha: ' + r.error, 'error');
});

document.getElementById('refresh-printers-btn').addEventListener('click', loadPrinters);
document.getElementById('sync-printers-btn').addEventListener('click', async () => {
  const r = await api.syncPrinters();
  if (r.success) showAlert(`${r.count} impressora(s) sincronizadas!`, 'success');
  else showAlert('Erro: ' + r.error, 'error');
});

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
