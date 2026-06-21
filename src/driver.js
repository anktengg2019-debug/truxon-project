import { publishDriverPosition, isFirebaseConfigured } from './firebase.js';
import { TruckMap } from './truckMap.js';
import { SimulatedTruck, DEMO_ROUTE, bearing } from './simulation.js';
import { requireUser } from './auth.js';
import { mountUserBar } from './userBar.js';

const PUBLISH_INTERVAL_MS = 5000;

const form = document.getElementById('driver-form');
const idInput = document.getElementById('driver-id');
const nameInput = document.getElementById('driver-name');
const modeInputs = document.getElementsByName('mode');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusEl = document.getElementById('status');
const coordsEl = document.getElementById('coords');

const truckMap = new TruckMap('map', { zoom: 14 });

let timer = null;
let geoWatchId = null;
let lastPos = null;
let simTruck = null;

function setStatus(text, kind = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function selectedMode() {
  for (const i of modeInputs) if (i.checked) return i.value;
  return 'simulate';
}

async function publish(driver) {
  truckMap.update([{ ...driver, color: '#1f6feb' }]);
  truckMap.setFollow(driver.id);
  coordsEl.textContent = `${driver.lat.toFixed(5)}, ${driver.lng.toFixed(5)} · ${Math.round(
    driver.speed || 0,
  )} km/h`;
  if (!isFirebaseConfigured) {
    setStatus('Firebase not configured — running locally only (not saved).', 'warn');
    return;
  }
  try {
    await publishDriverPosition(driver);
    setStatus(`Live · last update ${new Date().toLocaleTimeString()}`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(`Publish failed: ${err.message}`, 'error');
  }
}

function startSimulation(base) {
  simTruck = new SimulatedTruck({ route: DEMO_ROUTE, speedKmh: 45 });
  const tick = () => {
    const p = simTruck.step(PUBLISH_INTERVAL_MS / 1000);
    publish({ ...base, ...p, status: 'active' });
  };
  tick();
  timer = setInterval(tick, PUBLISH_INTERVAL_MS);
}

function startGeolocation(base) {
  if (!('geolocation' in navigator)) {
    setStatus('Geolocation unavailable in this browser. Use simulate mode.', 'error');
    return false;
  }
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const heading =
        pos.coords.heading != null && !Number.isNaN(pos.coords.heading)
          ? pos.coords.heading
          : lastPos
            ? bearing(lastPos, cur)
            : 0;
      const speed =
        pos.coords.speed != null && !Number.isNaN(pos.coords.speed)
          ? pos.coords.speed * 3.6
          : 0;
      lastPos = cur;
      lastPos.heading = heading;
      lastPos.speed = speed;
    },
    (err) => setStatus(`Geolocation error: ${err.message}`, 'error'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
  );
  const tick = () => {
    if (!lastPos) return;
    publish({ ...base, ...lastPos, status: 'active' });
  };
  timer = setInterval(tick, PUBLISH_INTERVAL_MS);
  return true;
}

function start() {
  const id = idInput.value.trim();
  const name = nameInput.value.trim() || id;
  if (!id) {
    setStatus('Enter a driver/truck ID first.', 'error');
    return;
  }
  const base = { id, name };
  const mode = selectedMode();
  if (mode === 'gps') {
    if (!startGeolocation(base)) return;
    setStatus('Waiting for GPS fix…');
  } else {
    startSimulation(base);
  }
  startBtn.disabled = true;
  stopBtn.disabled = false;
  idInput.disabled = true;
  nameInput.disabled = true;
}

function stop() {
  if (timer) clearInterval(timer);
  if (geoWatchId != null) navigator.geolocation.clearWatch(geoWatchId);
  timer = null;
  geoWatchId = null;
  simTruck = null;
  lastPos = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  idInput.disabled = false;
  nameInput.disabled = false;
  setStatus('Stopped.', 'info');
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  start();
});
stopBtn.addEventListener('click', stop);

async function init() {
  if (!isFirebaseConfigured) {
    setStatus('Firebase not configured — positions will not be saved to Firestore.', 'warn');
    return;
  }
  // Protected route: redirects to /login.html if not signed in.
  const user = await requireUser();
  await mountUserBar(user);
}

init();
