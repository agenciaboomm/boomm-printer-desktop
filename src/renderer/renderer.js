'use strict';
const api = window.electronAPI;
let jobsDone = 0, jobsFailed = 0;

// --- Nav ---
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
    link.classList.add('active');
    const sec = document.getElementById(link.dataset.section);
    if (sec) sec.classList.add('active');
  });
});

function switchTab(name) {
  document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
  document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
  const link = document.querySelector(`[data-section="${name}"]`);
  if (link) link.classList.add('active');
  const sec = document.getElementById(name);
  if (sec) sec.classList.add('active');
}

// --- Init ---
async function init() {
  const s = await api.getSettings();
  document.getElementById('apiUrl').value = s.apiUrl || '';
  document.getElementById('printAccessKey').value = s.printAccessKey || '';
  document.getElementById('computerName').value = s.computerName || '';
  // Default alinhado com main.js (2000ms). Evita salvar 5000ms acidentalmente.
  document.getElementById('pollingInterval').value = s.pollingInterval || 2000;
  if (s.appVersion) {
    document.getElementById('app-version').textContent = `v${s.appVersion} Desktop`;
    document.getElementById('settings-version').textContent = `v${s.appVersion}`;
  }
  setPairingUI(s.isPaired, s.computerId);
  await loadPrinters();

  api.onStatusUpdate(addLog);
  api.onJobUpdate(handleJobUpdate);
  api.onPairingStatus((d) => setPairingUI(d.isPaired, d.computerId));
  api.onUpdater(handleUpdater);
  api.onDeepLinkPair(handleDeepLink);
}

// --- Deep link ---
function handleDeepLink(d) {
  if (d.apiUrl) document.getElementById('apiUrl').value = d.apiUrl;
  if (d.key) document.getElementById('printAccessKey').value = d.key;
  setPairingUI(false, null);
  switchTab('settings');
  // Auto-trigger pairing after a short delay so the UI settles
  setTimeout(() => document.getElementById('pair-btn').click(), 300);
}

// --- Pairing ---
function setPairingUI(isPaired, computerId) {
  const box = document.getElementById('pairing-box');
  const icon = document.getElementById('pairing-icon');
  const label = document.getElementById('pairing-label');
  const detail = document.getElementById('pairing-detail');
  const unpairBtn = document.getElementById('unpair-btn');
  const badge = document.getElementById('status-badge');

  if (isPaired) {
    box.className = 'pairing-box paired';
    icon.textContent = '🟢';
    label.textContent = 'Pareado';
    detail.textContent = computerId ? `Computer ID: ${computerId}` : 'Conectado ao SaaS Boomm Printer.';
    unpairBtn.style.display = 'inline-block';
    badge.className = 'badge badge-success';
    badge.textContent = 'Conectado';
  } else {
    box.className = 'pairing-box unpaired';
    icon.textContent = '🔴';
    label.textContent = 'Não pareado';
    detail.textContent = 'Configure a URL e a Chave de Acesso abaixo, depois clique em Parear.';
    unpairBtn.style.display = 'none';
    badge.className = 'badge badge-warning';
    badge.textContent = 'Não pareado';
  }
}

// --- Auto-update ---
const updateBanner = document.getElementById('update-banner');
const updateIcon = document.getElementById('update-icon');
const updateMessage = document.getElementById('update-message');
const updateProgressWrap = document.getElementById('update-progress-wrap');
const updateProgressFill = document.getElementById('update-progress-fill');
const updatePercent = document.getElementById('update-percent');
const btnDownload = document.getElementById('btn-download-update');
const btnInstall = document.getElementById('btn-install-update');
const btnCheck = document.getElementById('btn-check-updates');
const btnDismiss = document.getElementById('btn-dismiss-banner');
const updateStatusMsg = document.getElementById('update-status-msg');

function handleUpdater(d) {
  updateStatusMsg.textContent = '';
  updateProgressWrap.style.display = 'none';
  btnDownload.style.display = 'none';
  btnInstall.style.display = 'none';
  btnCheck.style.display = 'none';

  switch (d.state) {
    case 'checking':
      showBanner('default');
      updateIcon.textContent = '⏳';
      updateMessage.textContent = 'Verificando atualizações...';
      updateStatusMsg.textContent = 'Verificando...';
      break;

    case 'available':
      showBanner('default');
      updateIcon.textContent = '⬆️';
      updateMessage.textContent = `Nova versão ${d.version} disponível!`;
      btnDownload.style.display = 'inline-block';
      updateStatusMsg.textContent = `Versão ${d.version} disponível`;
      break;

    case 'latest':
      hideBanner();
      updateStatusMsg.textContent = 'Você já está na versão mais recente.';
      break;

    case 'downloading':
      showBanner('default');
      updateIcon.textContent = '⏬';
      updateMessage.textContent = 'Baixando atualização...';
      updateProgressWrap.style.display = 'flex';
      updateProgressFill.style.width = `${d.percent}%`;
      updatePercent.textContent = `${d.percent}%`;
      updateStatusMsg.textContent = `Baixando: ${d.percent}%`;
      break;

    case 'ready':
      showBanner('ready');
      updateIcon.textContent = '✅';
      updateMessage.textContent = `Versão ${d.version} pronta para instalar.`;
      btnInstall.style.display = 'inline-block';
      updateStatusMsg.textContent = `Versão ${d.version} baixada — pronta para instalar.`;
      break;

    case 'error':
      showBanner('error');
      updateIcon.textContent = '⚠️';
      updateMessage.textContent = `Erro: ${d.message}`;
      btnCheck.style.display = 'inline-block';
      updateStatusMsg.textContent = `Erro: ${d.message}`;
      break;
  }
}

function showBanner(type) {
  updateBanner.className = `update-banner visible${ type === 'ready' ? ' state-ready' : type === 'error' ? ' state-error' : '' }`;
}
function hideBanner() {
  updateBanner.className = 'update-banner';
}

btnDownload.addEventListener('click', () => api.downloadUpdate());
btnInstall.addEventListener('click', () => api.installUpdate());
btnDismiss.addEventListener('click', hideBanner);
btnCheck.addEventListener('click', () => api.checkForUpdates());

document.getElementById('settings-check-updates-btn').addEventListener('click', async () => {
  const btn = document.getElementById('settings-check-updates-btn');
  btn.disabled = true; btn.textContent = 'Verificando...';
  await api.checkForUpdates();
  btn.disabled = false; btn.textContent = 'Verificar Atualizações';
});

// --- Printers ---
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

// --- Logs ---
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

// --- Jobs ---
function handleJobUpdate(data) {
  // job-processor broadcasts 'printed' (not 'completed') on success
  if (data.status === 'printed') document.getElementById('stat-jobs-done').textContent = ++jobsDone;
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

// --- Settings buttons ---
document.getElementById('pair-btn').addEventListener('click', async () => {
  const btn = document.getElementById('pair-btn');
  await api.saveSettings({
    apiUrl: document.getElementById('apiUrl').value.trim(),
    printAccessKey: document.getElementById('printAccessKey').value.trim(),
    computerName: document.getElementById('computerName').value.trim(),
    pollingInterval: parseInt(document.getElementById('pollingInterval').value, 10) || 2000,
  });
  btn.disabled = true; btn.textContent = 'Pareando...';
  const r = await api.pairDevice();
  btn.disabled = false; btn.textContent = '🔗 Parear Agora';
  if (r.success) { setPairingUI(true, r.computer_id); showAlert('Pareado com sucesso!', 'success'); }
  else showAlert('Erro ao parear: ' + r.error, 'error');
});

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = 'Salvando...';
  await api.saveSettings({
    apiUrl: document.getElementById('apiUrl').value.trim(),
    printAccessKey: document.getElementById('printAccessKey').value.trim(),
    computerName: document.getElementById('computerName').value.trim(),
    pollingInterval: parseInt(document.getElementById('pollingInterval').value, 10) || 2000,
  });
  btn.disabled = false; btn.textContent = 'Salvar';
  showAlert('Configurações salvas. Clique em Parear para conectar.', 'info');
});

document.getElementById('unpair-btn').addEventListener('click', async () => {
  const r = await api.unpairDevice();
  if (r.success) { setPairingUI(false, null); showAlert('Pareamento desfeito.', 'info'); }
});

document.getElementById('test-conn-btn').addEventListener('click', async () => {
  const btn = document.getElementById('test-conn-btn');
  btn.disabled = true; btn.textContent = 'Testando...';
  const r = await api.testConnection();
  btn.disabled = false; btn.textContent = 'Testar Conexão';
  if (r.success) showAlert('Conexão OK!', 'success');
  else showAlert('Falha: ' + r.error, 'error');
});

document.getElementById('refresh-printers-btn').addEventListener('click', loadPrinters);
document.getElementById('sync-printers-btn').addEventListener('click', async () => {
  const r = await api.syncPrinters();
  if (r.success) showAlert(`${r.count} impressora(s) sincronizadas!`, 'success');
  else showAlert('Erro: ' + r.error, 'error');
});

// --- Helpers ---
function showAlert(msg, type='info') {
  const c = document.getElementById('alerts-container');
  const el = document.createElement('div');
  el.className = `alert alert-${type}`; el.textContent = msg;
  c.appendChild(el); setTimeout(() => el.remove(), 4500);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
