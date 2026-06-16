import { TruckMap } from './truckMap.js';
import { subscribeToDrivers, isFirebaseConfigured } from './firebase.js';
import { SimulatedTruck, DEMO_ROUTE } from './simulation.js';
import { mountLoginModal } from './loginModal.js';

if (isFirebaseConfigured) mountLoginModal();

const statusEl = document.getElementById('status');
const listEl = document.getElementById('driver-list');
const countEl = document.getElementById('driver-count');

const truckMap = new TruckMap('map');

function setStatus(text, kind = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function renderList(drivers) {
  countEl.textContent = String(drivers.length);
  if (drivers.length === 0) {
    listEl.innerHTML = '<li class="empty">No active drivers yet.</li>';
    return;
  }
  listEl.innerHTML = drivers
    .map((d) => {
      const speed = d.speed != null ? `${Math.round(d.speed)} km/h` : '—';
      return `<li data-id="${d.id}">
        <span class="dot"></span>
        <span class="name">${d.name || d.id}</span>
        <span class="speed">${speed}</span>
      </li>`;
    })
    .join('');
  listEl.querySelectorAll('li[data-id]').forEach((li) => {
    li.addEventListener('click', () => truckMap.setFollow(li.dataset.id));
  });
}

function startLiveMode() {
  setStatus('Connecting to Firestore…');
  subscribeToDrivers(
    (drivers) => {
      const sorted = [...drivers].sort((a, b) =>
        (a.name || a.id).localeCompare(b.name || b.id),
      );
      truckMap.update(sorted);
      renderList(sorted);
      setStatus(`Live · ${drivers.length} driver(s) tracked`, 'ok');
    },
    (err) => {
      console.error(err);
      setStatus(`Firestore error: ${err.message}`, 'error');
    },
  );
}

// Offline demo: animate fake trucks locally without Firebase.
function startDemoMode(reason) {
  setStatus(`${reason} Showing local simulation (demo).`, 'warn');
  const trucks = [
    { id: 'demo-1', name: 'Demo Truck 1', color: '#1f6feb', sim: new SimulatedTruck({ route: DEMO_ROUTE, speedKmh: 50 }) },
    { id: 'demo-2', name: 'Demo Truck 2', color: '#d29922', sim: new SimulatedTruck({ route: [...DEMO_ROUTE].reverse(), speedKmh: 38 }) },
  ];
  setInterval(() => {
    const drivers = trucks.map((t) => {
      const p = t.sim.step(5);
      return { id: t.id, name: t.name, color: t.color, ...p, status: 'active' };
    });
    truckMap.update(drivers);
    renderList(drivers);
  }, 5000);
}

const params = new URLSearchParams(location.search);
if (params.get('demo') === '1') {
  startDemoMode('Demo mode forced via ?demo=1.');
} else if (isFirebaseConfigured) {
  startLiveMode();
} else {
  startDemoMode('Firebase is not configured (.env missing).');
}
