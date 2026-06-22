import { isFirebaseConfigured } from './firebase.js';
import { requireUser, authErrorMessage } from './auth.js';
import { createBooking } from './data.js';

const statusEl = document.getElementById('booking-status');
const formEl = document.getElementById('booking-form');

function setStatus(text, kind = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

async function init() {
  if (!isFirebaseConfigured) {
    setStatus('Firebase is not configured (.env missing). Booking is disabled.', 'error');
    formEl.querySelectorAll('button, input, select').forEach((el) => (el.disabled = true));
    return;
  }
  const user = await requireUser();

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      customerName: document.getElementById('bk-customer').value.trim(),
      mobile: document.getElementById('bk-mobile').value.trim(),
      pickup: document.getElementById('bk-pickup').value.trim(),
      drop: document.getElementById('bk-drop').value.trim(),
      vehicleType: document.getElementById('bk-vehicle').value,
      materialType: document.getElementById('bk-material').value.trim(),
      weight: document.getElementById('bk-weight').value,
    };
    if (
      !data.customerName || !data.mobile || !data.pickup || !data.drop ||
      !data.materialType || !data.weight
    ) {
      return setStatus('Please fill in all fields.', 'error');
    }
    if (!(Number(data.weight) > 0)) {
      return setStatus('Weight must be greater than 0.', 'error');
    }
    setStatus('Creating booking…');
    try {
      const id = await createBooking(user.uid, data);
      setStatus(`Booking created (#${id}).`, 'ok');
      formEl.reset();
    } catch (err) {
      setStatus(authErrorMessage(err), 'error');
    }
  });
}

init();
