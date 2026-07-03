import { isFirebaseConfigured } from './firebase.js';
import { requireUser, getCurrentProfile, authErrorMessage } from './auth.js';
import { mountUserBar } from './userBar.js';
import { mountNav } from './nav.js';
import {
  createLoad,
  TRUCK_TYPES,
  MATERIAL_TYPES,
  LOAD_POSTER_ROLES,
} from './loads.js';

const statusEl = document.getElementById('status');
const formStatusEl = document.getElementById('form-status');
const formEl = document.getElementById('load-form');

function setStatus(text, kind = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}
function setFormStatus(text, kind = 'info') {
  formStatusEl.textContent = text;
  formStatusEl.dataset.kind = kind;
}

function fillOptions(selectId, options) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = options
    .map((o) => `<option value="${o.value}">${o.label}</option>`)
    .join('');
}

function disableForm() {
  formEl.querySelectorAll('button, input, select').forEach((el) => (el.disabled = true));
}

async function init() {
  fillOptions('pl-material', MATERIAL_TYPES);
  fillOptions('pl-truck', TRUCK_TYPES);

  if (!isFirebaseConfigured) {
    setStatus('Firebase is not configured (.env missing).', 'error');
    disableForm();
    return;
  }

  const user = await requireUser();
  await mountUserBar(user);
  const profile = await getCurrentProfile();
  mountNav(profile?.role, '/post-load.html');

  if (!LOAD_POSTER_ROLES.includes(profile?.role)) {
    setStatus('Only customers and vendors can post loads.', 'warn');
    disableForm();
    return;
  }

  // Prefill contact from profile.
  document.getElementById('pl-contact-name').value = profile?.name || '';
  document.getElementById('pl-contact-phone').value = profile?.phone || '';
  setStatus('Ready. Fill in the load details.', 'ok');

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const contactName = document.getElementById('pl-contact-name').value.trim();
    const contactPhone = document.getElementById('pl-contact-phone').value.trim();
    const data = {
      customerName: contactName,
      customerPhone: contactPhone,
      materialType: document.getElementById('pl-material').value,
      truckType: document.getElementById('pl-truck').value,
      materialDescription: document.getElementById('pl-description').value.trim(),
      weight: document.getElementById('pl-weight').value,
      quantity: document.getElementById('pl-quantity').value,
      expectedPrice: document.getElementById('pl-price').value,
      pickupDate: document.getElementById('pl-date').value,
      pickupTimeWindow: document.getElementById('pl-window').value,
      pickup: {
        city: document.getElementById('pl-pickup-city').value.trim(),
        address: document.getElementById('pl-pickup-address').value.trim(),
        contactName,
        contactPhone,
      },
      dropoff: {
        city: document.getElementById('pl-dropoff-city').value.trim(),
        address: document.getElementById('pl-dropoff-address').value.trim(),
        contactName,
        contactPhone,
      },
    };

    if (!(Number(data.weight) > 0)) return setFormStatus('Weight must be greater than 0.', 'error');
    if (!(Number(data.expectedPrice) > 0)) return setFormStatus('Enter an expected price.', 'error');

    const submitBtn = document.getElementById('pl-submit');
    submitBtn.disabled = true;
    setFormStatus('Posting load…');
    try {
      const id = await createLoad(user.uid, data);
      setFormStatus(`Load posted (#${id}). Redirecting to your loads…`, 'ok');
      formEl.reset();
      document.getElementById('pl-quantity').value = '1';
      setTimeout(() => location.assign('/loads.html'), 1200);
    } catch (err) {
      setFormStatus(authErrorMessage(err), 'error');
      submitBtn.disabled = false;
    }
  });
}

init();
