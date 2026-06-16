// A small phone-OTP login modal. Self-contained: it injects its own trigger
// button + modal DOM, so it can be mounted on any page (dashboard, driver) and
// safely reopened. The duplicate-safe verifier logic lives in ./phoneAuth.js.

import {
  sendOtp,
  resendOtp,
  confirmOtp,
  resetPhoneAuth,
  isAwaitingOtp,
} from './phoneAuth.js';
import { getAuthInstance } from './firebase.js';

const PHONE_RE = /^\+[1-9]\d{6,14}$/; // E.164

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  });
  children.forEach((c) => node.appendChild(c));
  return node;
}

/**
 * Mount the login trigger + modal.
 * @param {HTMLElement} [host] where to place the trigger button (defaults to the sidebar).
 */
export function mountLoginModal(host) {
  const auth = getAuthInstance();
  const trigger = el('button', {
    id: 'login-trigger',
    class: 'login-trigger',
    type: 'button',
    text: 'Sign in with phone',
  });

  const phoneInput = el('input', {
    id: 'login-phone',
    type: 'tel',
    placeholder: '+14155552671',
    autocomplete: 'tel',
  });
  const sendBtn = el('button', { id: 'login-send', type: 'button', text: 'Send code' });

  const otpInput = el('input', {
    id: 'login-otp',
    type: 'text',
    inputmode: 'numeric',
    placeholder: '123456',
    autocomplete: 'one-time-code',
  });
  const verifyBtn = el('button', { id: 'login-verify', type: 'button', text: 'Verify & sign in' });
  const resendBtn = el('button', {
    id: 'login-resend',
    type: 'button',
    class: 'secondary',
    text: 'Resend code',
  });
  const otpGroup = el('div', { id: 'login-otp-group', hidden: 'true' }, [
    el('label', { text: 'Verification code' }),
    otpInput,
    el('div', { class: 'login-row' }, [verifyBtn, resendBtn]),
  ]);

  const status = el('p', { id: 'login-status', class: 'login-status' });
  const recaptcha = el('div', { id: 'recaptcha-container' });
  const closeBtn = el('button', { class: 'login-close', type: 'button', 'aria-label': 'Close', text: '×' });

  const modal = el('div', { class: 'login-modal', role: 'dialog', 'aria-modal': 'true' }, [
    closeBtn,
    el('h2', { text: 'Sign in with phone' }),
    el('label', { text: 'Phone number (E.164)' }),
    phoneInput,
    el('div', { class: 'login-row' }, [sendBtn]),
    otpGroup,
    status,
    recaptcha,
  ]);
  const overlay = el('div', { class: 'login-overlay', hidden: 'true' }, [modal]);
  document.body.appendChild(overlay);
  (host || document.querySelector('.sidebar') || document.body).appendChild(trigger);

  function setStatus(msg, kind) {
    status.textContent = msg || '';
    status.dataset.kind = kind || '';
  }

  function showOtpStep(show) {
    otpGroup.hidden = !show;
  }

  function reflectSignedIn() {
    const user = getAuthInstance()?.currentUser;
    if (user && user.phoneNumber) {
      trigger.textContent = `Signed in: ${user.phoneNumber}`;
    } else if (user && user.isAnonymous) {
      trigger.textContent = 'Sign in with phone';
    }
  }

  function openModal() {
    overlay.hidden = false;
    setStatus('');
    showOtpStep(false);
    phoneInput.value = phoneInput.value || '';
    otpInput.value = '';
    phoneInput.focus();
  }

  function closeModal() {
    overlay.hidden = true;
    // Tear down the verifier + pending confirmation so reopening renders cleanly.
    resetPhoneAuth();
    showOtpStep(false);
    setStatus('');
  }

  async function handleSend(isResend) {
    const phone = phoneInput.value.trim();
    if (!PHONE_RE.test(phone)) {
      setStatus('Enter a valid phone number in E.164 format, e.g. +14155552671', 'error');
      return;
    }
    sendBtn.disabled = true;
    resendBtn.disabled = true;
    setStatus(isResend ? 'Resending code…' : 'Sending code…');
    try {
      if (isResend) await resendOtp(phone);
      else await sendOtp(phone);
      showOtpStep(true);
      setStatus(`Code sent to ${phone}. Enter it below.`, 'ok');
      otpInput.focus();
    } catch (err) {
      setStatus(`Could not send code: ${err?.code || err?.message || err}`, 'error');
    } finally {
      sendBtn.disabled = false;
      resendBtn.disabled = false;
    }
  }

  async function handleVerify() {
    const code = otpInput.value.trim();
    if (!/^\d{4,8}$/.test(code)) {
      setStatus('Enter the numeric code from the SMS.', 'error');
      return;
    }
    if (!isAwaitingOtp()) {
      setStatus('No code request in progress. Send a code first.', 'error');
      return;
    }
    verifyBtn.disabled = true;
    setStatus('Verifying…');
    try {
      const user = await confirmOtp(code);
      setStatus(`Signed in as ${user.phoneNumber}`, 'ok');
      reflectSignedIn();
      setTimeout(closeModal, 900);
    } catch (err) {
      setStatus(`Invalid code: ${err?.code || err?.message || err}`, 'error');
    } finally {
      verifyBtn.disabled = false;
    }
  }

  trigger.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  sendBtn.addEventListener('click', () => handleSend(false));
  resendBtn.addEventListener('click', () => handleSend(true));
  verifyBtn.addEventListener('click', handleVerify);

  if (auth) {
    auth.onAuthStateChanged(reflectSignedIn);
  }

  return { open: openModal, close: closeModal };
}
