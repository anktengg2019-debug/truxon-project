import { isFirebaseConfigured } from './firebase.js';
import { requireUser, getCurrentProfile, authErrorMessage } from './auth.js';
import { mountUserBar } from './userBar.js';
import { mountNav } from './nav.js';
import {
  WalletService,
  UPI_APPS,
  openUPIApp,
  formatCurrency,
  formatDate,
} from './wallet.js';

const statusEl = document.getElementById('status');
const addStatusEl = document.getElementById('add-status');
const amountEl = document.getElementById('add-amount');
const addBtn = document.getElementById('add-btn');

function setStatus(text, kind = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}
function setAddStatus(text, kind = 'info') {
  addStatusEl.textContent = text;
  addStatusEl.dataset.kind = kind;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let selectedApp = 'google_pay';
let service = null;

function renderUpiApps() {
  const grid = document.getElementById('upi-grid');
  grid.innerHTML = UPI_APPS.map(
    (a) => `<div class="upi-app${a.id === selectedApp ? ' is-active' : ''}" data-app="${a.id}">
      <span class="upi-icon">${a.icon}</span><span>${esc(a.displayName)}</span>
    </div>`,
  ).join('');
  grid.querySelectorAll('[data-app]').forEach((el) => {
    el.addEventListener('click', () => {
      selectedApp = el.dataset.app;
      renderUpiApps();
    });
  });
}

function renderTransactions(txns) {
  const container = document.getElementById('txn-list');
  if (!txns.length) {
    container.innerHTML = '<div class="empty-state">No transactions yet.</div>';
    return;
  }
  container.innerHTML = txns
    .map((t) => {
      const sign = t.type === 'debit' || t.type === 'withdrawal' ? '−' : '+';
      const cls = t.type === 'debit' || t.type === 'withdrawal' ? 'debit' : 'credit';
      return `<div class="txn">
        <div>
          <div class="txn-desc">${esc(t.description || t.type)}</div>
          <div class="txn-date">${esc(formatDate(t.createdAt))} · <span class="badge" data-status="${esc(t.status)}">${esc(t.status)}</span></div>
        </div>
        <div class="txn-amount ${cls}">${sign}${esc(formatCurrency(t.amount))}</div>
      </div>`;
    })
    .join('');
}

async function init() {
  renderUpiApps();

  if (!isFirebaseConfigured) {
    setStatus('Firebase is not configured (.env missing).', 'error');
    addBtn.disabled = true;
    return;
  }

  const user = await requireUser();
  await mountUserBar(user);
  const profile = await getCurrentProfile();
  mountNav(profile?.role, '/wallet.html');

  service = new WalletService(user.uid);
  try {
    await service.getOrCreateWallet();
    setStatus('Wallet ready.', 'ok');
  } catch (err) {
    setStatus(`Wallet error: ${err.message}`, 'error');
  }

  service.subscribeToWallet(
    (w) => {
      document.getElementById('wallet-amount').textContent = formatCurrency(w?.balance || 0);
    },
    (err) => setStatus(`Wallet error: ${err.message}`, 'error'),
  );

  service.subscribeToTransactions(
    renderTransactions,
    (err) => console.warn('txn error', err),
  );

  addBtn.addEventListener('click', async () => {
    const amount = Number(amountEl.value);
    if (!(amount > 0)) return setAddStatus('Enter a valid amount.', 'error');
    addBtn.disabled = true;
    setAddStatus('Creating payment…');
    try {
      const txn = await service.createAddMoneyTransaction(amount, selectedApp);
      setAddStatus(
        'Opening your UPI app… After paying, your balance is credited once the payment is confirmed.',
        'ok',
      );
      openUPIApp(amount, txn.transactionId, 'Add money to TRUXON wallet', selectedApp);
      amountEl.value = '';
    } catch (err) {
      setAddStatus(authErrorMessage(err), 'error');
    } finally {
      addBtn.disabled = false;
    }
  });
}

init();
