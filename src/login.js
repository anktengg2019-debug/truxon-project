import { isFirebaseConfigured } from './firebase.js';
import {
  signInWithGoogle,
  signInWithEmailPassword,
  resetPassword,
  startPhoneSignIn,
  confirmPhoneCode,
  onAuth,
  authErrorMessage,
} from './auth.js';
import { requestEmailOtp, verifyEmailOtp } from './emailOtp.js';

const statusEl = document.getElementById('auth-status');

function setStatus(text, kind = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function nextUrl() {
  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  // Only allow same-origin relative paths.
  return next && next.startsWith('/') ? next : '/index.html';
}

function goNext() {
  location.replace(nextUrl());
}

if (!isFirebaseConfigured) {
  setStatus('Firebase is not configured (.env missing). Auth is disabled.', 'error');
  document.querySelectorAll('button, input').forEach((el) => (el.disabled = true));
} else {
  // Already signed in? Skip the form.
  const unsub = onAuth((user) => {
    unsub();
    if (user) goNext();
  });
}

// --- Tabs -----------------------------------------------------------------
document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    const which = tab.dataset.tab;
    document.querySelectorAll('.auth-panel').forEach((p) => {
      p.hidden = p.dataset.panel !== which;
    });
    setStatus('');
  });
});

// --- Google ---------------------------------------------------------------
document.getElementById('google-btn').addEventListener('click', async () => {
  setStatus('Opening Google sign-in…');
  try {
    await signInWithGoogle();
    setStatus('Signed in. Redirecting…', 'ok');
    goNext();
  } catch (err) {
    setStatus(authErrorMessage(err), 'error');
  }
});

// --- Email OTP ------------------------------------------------------------
const otpForm = document.getElementById('otp-form');
const otpEmail = document.getElementById('otp-email');
const otpCodeGroup = document.getElementById('otp-code-group');
const otpCode = document.getElementById('otp-code');
const otpSendBtn = document.getElementById('otp-send-btn');
const otpVerifyBtn = document.getElementById('otp-verify-btn');
const otpResendBtn = document.getElementById('otp-resend-btn');

let otpStage = 'request'; // 'request' | 'verify'

async function sendCode() {
  const email = otpEmail.value.trim();
  if (!email) return setStatus('Enter your email first.', 'error');
  otpSendBtn.disabled = true;
  otpResendBtn.disabled = true;
  setStatus('Sending code…');
  try {
    await requestEmailOtp(email);
    otpStage = 'verify';
    otpCodeGroup.hidden = false;
    otpSendBtn.hidden = true;
    otpVerifyBtn.hidden = false;
    otpResendBtn.hidden = false;
    otpEmail.readOnly = true;
    otpCode.focus();
    setStatus(`Code sent to ${email}. It expires in 5 minutes.`, 'ok');
  } catch (err) {
    setStatus(err.message || 'Could not send the code.', 'error');
  } finally {
    otpSendBtn.disabled = false;
    otpResendBtn.disabled = false;
  }
}

otpForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (otpStage === 'request') sendCode();
});

otpResendBtn.addEventListener('click', sendCode);

otpVerifyBtn.addEventListener('click', async () => {
  const email = otpEmail.value.trim();
  const code = otpCode.value.trim();
  if (!/^\d{6}$/.test(code)) return setStatus('Enter the 6-digit code.', 'error');
  otpVerifyBtn.disabled = true;
  setStatus('Verifying…');
  try {
    await verifyEmailOtp(email, code);
    setStatus('Signed in. Redirecting…', 'ok');
    goNext();
  } catch (err) {
    setStatus(err.message || 'Verification failed.', 'error');
  } finally {
    otpVerifyBtn.disabled = false;
  }
});

// --- Phone OTP ------------------------------------------------------------
const phoneForm = document.getElementById('phone-form');
const phoneNumber = document.getElementById('phone-number');
const phoneCodeGroup = document.getElementById('phone-code-group');
const phoneCode = document.getElementById('phone-code');
const phoneSendBtn = document.getElementById('phone-send-btn');
const phoneVerifyBtn = document.getElementById('phone-verify-btn');
const phoneResendBtn = document.getElementById('phone-resend-btn');

let phoneStage = 'request'; // 'request' | 'verify'
let phoneConfirmation = null;

async function sendPhoneCode() {
  const phone = phoneNumber.value.trim();
  if (!phone) return setStatus('Enter your phone number first.', 'error');
  phoneSendBtn.disabled = true;
  phoneResendBtn.disabled = true;
  setStatus('Sending OTP…');
  try {
    phoneConfirmation = await startPhoneSignIn(phone);
    phoneStage = 'verify';
    phoneCodeGroup.hidden = false;
    phoneSendBtn.hidden = true;
    phoneVerifyBtn.hidden = false;
    phoneResendBtn.hidden = false;
    phoneNumber.readOnly = true;
    phoneCode.focus();
    setStatus('OTP sent. Enter the 6-digit code.', 'ok');
  } catch (err) {
    setStatus(authErrorMessage(err), 'error');
  } finally {
    phoneSendBtn.disabled = false;
    phoneResendBtn.disabled = false;
  }
}

phoneForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (phoneStage === 'request') sendPhoneCode();
});

phoneResendBtn.addEventListener('click', sendPhoneCode);

phoneVerifyBtn.addEventListener('click', async () => {
  const code = phoneCode.value.trim();
  if (!/^\d{6}$/.test(code)) return setStatus('Enter the 6-digit code.', 'error');
  if (!phoneConfirmation) return setStatus('Request an OTP first.', 'error');
  phoneVerifyBtn.disabled = true;
  setStatus('Verifying…');
  try {
    await confirmPhoneCode(phoneConfirmation, code);
    setStatus('Signed in. Redirecting…', 'ok');
    goNext();
  } catch (err) {
    setStatus(authErrorMessage(err), 'error');
  } finally {
    phoneVerifyBtn.disabled = false;
  }
});

// --- Email + Password -----------------------------------------------------
const pwForm = document.getElementById('password-form');
const pwEmail = document.getElementById('pw-email');
const pwPassword = document.getElementById('pw-password');

pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = pwEmail.value.trim();
  const password = pwPassword.value;
  if (!email || !password) return setStatus('Enter email and password.', 'error');
  setStatus('Signing in…');
  try {
    await signInWithEmailPassword(email, password);
    setStatus('Signed in. Redirecting…', 'ok');
    goNext();
  } catch (err) {
    setStatus(authErrorMessage(err), 'error');
  }
});

document.getElementById('pw-forgot-btn').addEventListener('click', async () => {
  const email = pwEmail.value.trim();
  if (!email) return setStatus('Enter your email above first, then click Forgot password.', 'error');
  setStatus('Sending reset email…');
  try {
    await resetPassword(email);
    setStatus(`Password reset email sent to ${email}.`, 'ok');
  } catch (err) {
    setStatus(authErrorMessage(err), 'error');
  }
});
