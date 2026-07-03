import { isFirebaseConfigured } from './firebase.js';
import { requireUser, getCurrentProfile, authErrorMessage } from './auth.js';
import { mountUserBar } from './userBar.js';
import { mountNav } from './nav.js';
import { formatCurrency } from './wallet.js';
import {
  subscribeToAvailableLoads,
  subscribeToCustomerLoads,
  subscribeToLoadBids,
  subscribeToTransporterBids,
  getCustomerStats,
  placeBid,
  acceptBid,
  cancelLoad,
  labelFor,
  LOAD_POSTER_ROLES,
  BIDDER_ROLES,
  TRUCK_TYPES,
  MATERIAL_TYPES,
} from './loads.js';

const statusEl = document.getElementById('status');
function setStatus(text, kind = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let currentUser = null;
let currentProfile = null;
const bidSubs = new Map(); // loadId -> unsubscribe

function loadSummary(load) {
  const route = `${esc(load.pickup?.city || '—')} → ${esc(load.dropoff?.city || '—')}`;
  const meta = [
    `${esc(labelFor(MATERIAL_TYPES, load.materialType))}`,
    `${esc(labelFor(TRUCK_TYPES, load.truckType))}`,
    `${load.weight} T`,
    load.quantity > 1 ? `${load.quantity} trucks` : null,
    `${load.bidCount || 0} bid(s)`,
  ].filter(Boolean).map((m) => `<span>${m}</span>`).join('');
  return { route, meta };
}

// ==================== POSTER (customer / vendor) ====================

async function renderPosterStats() {
  try {
    const s = await getCustomerStats(currentUser.uid);
    const tiles = [
      ['Total loads', s.totalLoads],
      ['Pending', s.pendingLoads],
      ['Booked', s.bookedLoads],
      ['Delivered', s.deliveredLoads],
      ['Total spent', formatCurrency(s.totalSpent)],
    ];
    document.getElementById('poster-stats').innerHTML = tiles
      .map(([label, value]) => `<div class="stat"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`)
      .join('');
  } catch (err) {
    console.warn('stats error', err);
  }
}

function renderMyLoads(loads) {
  const container = document.getElementById('my-loads');
  if (!loads.length) {
    container.innerHTML = '<div class="empty-state">You have no loads yet. Post one to start receiving bids.</div>';
    return;
  }
  container.innerHTML = loads
    .map((load) => {
      const { route, meta } = loadSummary(load);
      const canCancel = load.status === 'pending';
      return `<div class="card" data-load="${load.id}">
        <div class="card-head">
          <div>
            <div class="card-route">${route}</div>
            <div class="card-meta">${meta}</div>
          </div>
          <div style="text-align:right">
            <div class="price">${esc(formatCurrency(load.finalPrice || load.expectedPrice))}</div>
            <span class="badge" data-status="${esc(load.status)}">${esc(load.status)}</span>
          </div>
        </div>
        <div class="bids" data-bids="${load.id}"><div class="page-sub" style="margin:8px 0 0">Loading bids…</div></div>
        ${canCancel ? `<div class="card-actions"><button class="btn secondary" data-cancel="${load.id}">Cancel load</button></div>` : ''}
      </div>`;
    })
    .join('');

  // Wire cancel buttons.
  container.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await cancelLoad(btn.dataset.cancel, currentUser.uid);
      } catch (err) {
        alert(authErrorMessage(err));
        btn.disabled = false;
      }
    });
  });

  // Refresh per-load bid subscriptions.
  for (const [loadId, unsub] of bidSubs) {
    if (!loads.find((l) => l.id === loadId)) {
      unsub();
      bidSubs.delete(loadId);
    }
  }
  loads.forEach((load) => {
    if (bidSubs.has(load.id)) return;
    const unsub = subscribeToLoadBids(
      load.id,
      (bids) => renderLoadBids(load, bids),
      (err) => console.warn('bids error', err),
    );
    bidSubs.set(load.id, unsub);
  });
}

function renderLoadBids(load, bids) {
  const el = document.querySelector(`[data-bids="${load.id}"]`);
  if (!el) return;
  if (!bids.length) {
    el.innerHTML = '<div class="page-sub" style="margin:8px 0 0">No bids yet.</div>';
    return;
  }
  el.innerHTML = bids
    .map((bid) => {
      const canAccept = load.status === 'pending' && bid.status === 'pending';
      const who = `${esc(bid.transporterName || 'Transporter')}${bid.transporterPhone ? ` · ${esc(bid.transporterPhone)}` : ''}`;
      const detail = [bid.vehicleNumber, bid.message].filter(Boolean).map(esc).join(' · ');
      return `<div class="bid-line">
        <div class="bid-who">
          <strong>${who}</strong>
          <div class="txn-date">${detail || '—'}</div>
        </div>
        <div class="price">${esc(formatCurrency(bid.amount))}</div>
        ${canAccept
          ? `<button class="btn" data-accept="${bid.id}" data-load="${load.id}">Accept</button>`
          : `<span class="badge" data-status="${esc(bid.status)}">${esc(bid.status)}</span>`}
      </div>`;
    })
    .join('');

  el.querySelectorAll('[data-accept]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Accept this bid? Other bids will be rejected and the load booked.')) return;
      btn.disabled = true;
      try {
        await acceptBid(btn.dataset.accept, btn.dataset.load, currentUser.uid);
      } catch (err) {
        alert(authErrorMessage(err));
        btn.disabled = false;
      }
    });
  });
}

// ==================== BIDDER (transporter / driver) ====================

function renderAvailableLoads(loads) {
  const container = document.getElementById('available-loads');
  const own = loads.filter((l) => l.customerId !== currentUser.uid);
  if (!own.length) {
    container.innerHTML = '<div class="empty-state">No open loads right now. Check back soon.</div>';
    return;
  }
  container.innerHTML = own
    .map((load) => {
      const { route, meta } = loadSummary(load);
      return `<div class="card" data-load="${load.id}">
        <div class="card-head">
          <div>
            <div class="card-route">${route}</div>
            <div class="card-meta">${meta}</div>
            <div class="txn-date">${esc(load.pickup?.address || '')}</div>
          </div>
          <div style="text-align:right">
            <div class="price">${esc(formatCurrency(load.expectedPrice))}</div>
            <div class="txn-date">expected</div>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn" data-bid="${load.id}">Place bid</button>
        </div>
        <div class="bid-form" data-bidform="${load.id}" hidden></div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('[data-bid]').forEach((btn) => {
    btn.addEventListener('click', () => toggleBidForm(btn.dataset.bid));
  });
}

function toggleBidForm(loadId) {
  const holder = document.querySelector(`[data-bidform="${loadId}"]`);
  if (!holder) return;
  if (!holder.hidden) {
    holder.hidden = true;
    holder.innerHTML = '';
    return;
  }
  holder.hidden = false;
  holder.innerHTML = `
    <div class="field-grid" style="margin-top:12px">
      <div>
        <label>Your bid amount (₹)</label>
        <input type="number" min="0" step="100" data-f="amount" placeholder="e.g. 24000" />
      </div>
      <div>
        <label>Vehicle number</label>
        <input type="text" data-f="vehicleNumber" placeholder="e.g. HR55 AB 1234" />
      </div>
      <div class="full">
        <label>Message (optional)</label>
        <input type="text" data-f="message" placeholder="e.g. Can pick up today evening" />
      </div>
    </div>
    <div class="card-actions">
      <button class="btn" data-submitbid="${loadId}">Submit bid</button>
      <button class="btn secondary" data-cancelbid="${loadId}">Cancel</button>
    </div>
    <div class="login-status" data-bidstatus="${loadId}"></div>`;

  holder.querySelector(`[data-cancelbid="${loadId}"]`).addEventListener('click', () => toggleBidForm(loadId));
  holder.querySelector(`[data-submitbid="${loadId}"]`).addEventListener('click', () => submitBid(loadId, holder));
}

async function submitBid(loadId, holder) {
  const get = (f) => holder.querySelector(`[data-f="${f}"]`).value.trim();
  const amount = get('amount');
  const statusEl2 = holder.querySelector(`[data-bidstatus="${loadId}"]`);
  const setS = (t, k) => { statusEl2.textContent = t; statusEl2.dataset.kind = k; };
  if (!(Number(amount) > 0)) return setS('Enter a valid bid amount.', 'error');

  const submitBtn = holder.querySelector(`[data-submitbid="${loadId}"]`);
  submitBtn.disabled = true;
  setS('Submitting bid…', 'info');
  try {
    await placeBid({
      loadId,
      transporterId: currentUser.uid,
      transporterName: currentProfile?.name || '',
      transporterPhone: currentProfile?.phone || '',
      amount,
      message: get('message'),
      vehicleNumber: get('vehicleNumber'),
    });
    setS('Bid placed!', 'ok');
    setTimeout(() => toggleBidForm(loadId), 900);
  } catch (err) {
    setS(authErrorMessage(err), 'error');
    submitBtn.disabled = false;
  }
}

function renderMyBids(bids) {
  const container = document.getElementById('my-bids');
  if (!bids.length) {
    container.innerHTML = '<div class="empty-state">You have not placed any bids yet.</div>';
    return;
  }
  container.innerHTML = bids
    .map((bid) => `<div class="bid-line">
        <div class="bid-who">
          <strong>${esc(formatCurrency(bid.amount))}</strong>
          <div class="txn-date">${esc(bid.vehicleNumber || '')} ${esc(bid.message || '')}</div>
        </div>
        <span class="badge" data-status="${esc(bid.status)}">${esc(bid.status)}</span>
      </div>`)
    .join('');
}

// ==================== INIT ====================

async function init() {
  if (!isFirebaseConfigured) {
    setStatus('Firebase is not configured (.env missing).', 'error');
    return;
  }
  currentUser = await requireUser();
  await mountUserBar(currentUser);
  currentProfile = await getCurrentProfile();
  const role = currentProfile?.role;
  mountNav(role, '/loads.html');

  const isPoster = LOAD_POSTER_ROLES.includes(role);
  const isBidder = BIDDER_ROLES.includes(role);

  if (isPoster) {
    document.getElementById('poster-section').hidden = false;
    renderPosterStats();
    subscribeToCustomerLoads(
      currentUser.uid,
      (loads) => { renderMyLoads(loads); renderPosterStats(); },
      (err) => setStatus(`Loads error: ${err.message}`, 'error'),
    );
  }

  if (isBidder) {
    document.getElementById('bidder-section').hidden = false;
    subscribeToAvailableLoads(
      renderAvailableLoads,
      (err) => setStatus(`Loads error: ${err.message}`, 'error'),
    );
    subscribeToTransporterBids(
      currentUser.uid,
      renderMyBids,
      (err) => console.warn('my bids error', err),
    );
  }

  if (!isPoster && !isBidder) {
    setStatus('Your role has no marketplace actions.', 'warn');
  } else {
    setStatus('Live · marketplace connected', 'ok');
  }
}

init();
