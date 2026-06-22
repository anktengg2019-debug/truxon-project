// Email OTP client. Talks to the serverless endpoints (api/auth/*) which generate,
// hash, store, and verify the 6-digit code, then mint a Firebase custom token.

import { signInWithEmailOtpToken } from './auth.js';

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON response (e.g. backend not deployed).
  }
  if (!res.ok) {
    const msg = data?.error || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.retryAfter = data?.retryAfter;
    throw err;
  }
  return data;
}

/**
 * Request a 6-digit OTP be emailed to the address.
 * @param {string} email
 * @returns {Promise<{ ok: true }>}
 */
export async function requestEmailOtp(email) {
  return postJson('/api/auth/request-otp', { email });
}

/**
 * Verify the OTP and sign in. Returns the signed-in user.
 * @param {string} email
 * @param {string} code - 6-digit code
 */
export async function verifyEmailOtp(email, code) {
  const { token } = await postJson('/api/auth/verify-otp', { email, code });
  if (!token) throw new Error('Verification failed: no token returned.');
  return signInWithEmailOtpToken(token);
}
