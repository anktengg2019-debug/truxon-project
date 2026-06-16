// Duplicate-safe Firebase Phone Auth (OTP).
//
// The "reCAPTCHA has already been rendered in this element" error happens when a
// second RecaptchaVerifier is created on a container that still holds a widget
// from a previous one (modal reopen, page switch, or resend). This module keeps a
// single verifier instance and always tears the old one down — both the SDK
// widget (verifier.clear()) and any leftover DOM — before rendering again.

import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from 'firebase/auth';
import { getAuthInstance, ensureProfileForUser } from './firebase.js';

const DEFAULT_CONTAINER_ID = 'recaptcha-container';

let recaptchaVerifier = null;
let recaptchaContainerId = null;
let confirmationResult = null;

/** Remove any reCAPTCHA widget the SDK injected into the container. */
function emptyContainer(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '';
}

/**
 * Get the single RecaptchaVerifier, creating it only once. Reuses the existing
 * instance on subsequent calls so the widget is never rendered twice.
 * @param {string} [containerId]
 * @returns {RecaptchaVerifier}
 */
export function getRecaptchaVerifier(containerId = DEFAULT_CONTAINER_ID) {
  const auth = getAuthInstance();
  if (!auth) throw new Error('Firebase is not configured');

  // Reuse the existing verifier (the whole point — no second render).
  if (recaptchaVerifier && recaptchaContainerId === containerId) {
    return recaptchaVerifier;
  }
  // Container changed: dispose the old verifier before making a new one.
  if (recaptchaVerifier) clearRecaptcha();

  emptyContainer(containerId);
  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
  });
  recaptchaContainerId = containerId;
  return recaptchaVerifier;
}

/**
 * Safely dispose the current verifier and clear its DOM so a fresh one can be
 * rendered without the "already rendered" error. Idempotent.
 */
export function clearRecaptcha() {
  if (recaptchaVerifier) {
    try {
      recaptchaVerifier.clear();
    } catch {
      // Already cleared / not yet rendered — safe to ignore.
    }
  }
  if (recaptchaContainerId) emptyContainer(recaptchaContainerId);
  recaptchaVerifier = null;
  recaptchaContainerId = null;
}

/**
 * Start phone sign-in: render reCAPTCHA (once) and request an SMS code.
 * @param {string} phoneNumber - E.164 format, e.g. "+14155552671"
 * @param {string} [containerId]
 * @returns {Promise<import('firebase/auth').ConfirmationResult>}
 */
export async function sendOtp(phoneNumber, containerId = DEFAULT_CONTAINER_ID) {
  const auth = getAuthInstance();
  if (!auth) throw new Error('Firebase is not configured');

  const verifier = getRecaptchaVerifier(containerId);
  try {
    confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, verifier);
    return confirmationResult;
  } catch (err) {
    // A failed attempt can leave the widget in a spent state; reset so the next
    // attempt (or resend) renders a clean verifier instead of erroring.
    clearRecaptcha();
    throw err;
  }
}

/**
 * Resend the code. Tears down the spent verifier first so re-rendering is safe.
 * @param {string} phoneNumber
 * @param {string} [containerId]
 */
export async function resendOtp(phoneNumber, containerId = DEFAULT_CONTAINER_ID) {
  clearRecaptcha();
  return sendOtp(phoneNumber, containerId);
}

/**
 * Confirm the SMS code and complete sign-in.
 * @param {string} code - 6-digit code from the SMS
 * @returns {Promise<import('firebase/auth').User>}
 */
export async function confirmOtp(code) {
  if (!confirmationResult) {
    throw new Error('No OTP request in progress. Send a code first.');
  }
  const credential = await confirmationResult.confirm(code);
  confirmationResult = null;
  // Make sure the new (phone) user has a profile/role for Firestore rules.
  await ensureProfileForUser(credential.user);
  return credential.user;
}

/** Whether an OTP has been sent and is awaiting confirmation. */
export function isAwaitingOtp() {
  return confirmationResult !== null;
}

/**
 * Reset the whole flow (e.g. when a login modal is closed). Disposes the
 * verifier and forgets any pending confirmation so reopening starts clean.
 */
export function resetPhoneAuth() {
  confirmationResult = null;
  clearRecaptcha();
}
