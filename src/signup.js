import { isFirebaseConfigured } from './firebase.js';
import {
  signInWithGoogle,
  signUpWithEmailPassword,
  authErrorMessage,
  ROLES,
} from './auth.js';

const statusEl = document.getElementById('auth-status');

function setStatus(text, kind = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

if (!isFirebaseConfigured) {
  setStatus('Firebase is not configured (.env missing). Sign-up is disabled.', 'error');
  document.querySelectorAll('button, input, select').forEach((el) => (el.disabled = true));
}

document.getElementById('google-btn').addEventListener('click', async () => {
  setStatus('Opening Google sign-in…');
  try {
    await signInWithGoogle();
    setStatus('Account ready. Redirecting…', 'ok');
    location.replace('/index.html');
  } catch (err) {
    setStatus(authErrorMessage(err), 'error');
  }
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    name: document.getElementById('su-name').value.trim(),
    email: document.getElementById('su-email').value.trim(),
    phone: document.getElementById('su-phone').value.trim(),
    password: document.getElementById('su-password').value,
    role: document.getElementById('su-role').value,
  };
  if (!data.name || !data.email || !data.phone || !data.password) {
    return setStatus('Please fill in all fields.', 'error');
  }
  if (data.password.length < 6) {
    return setStatus('Password should be at least 6 characters.', 'error');
  }
  if (!ROLES.includes(data.role)) {
    return setStatus('Choose a valid role.', 'error');
  }
  setStatus('Creating your account…');
  try {
    await signUpWithEmailPassword(data);
    setStatus('Account created. A verification email is on its way. Redirecting…', 'ok');
    location.replace('/index.html');
  } catch (err) {
    setStatus(authErrorMessage(err), 'error');
  }
});
