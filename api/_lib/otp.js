// Shared OTP helpers: validation, hashing, and Firestore document keying.
import crypto from 'crypto';

export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 3;
// Rate limiting.
export const RESEND_MIN_INTERVAL_MS = 60 * 1000; // one code per minute
export const MAX_SENDS_PER_WINDOW = 5;
export const RATE_WINDOW_MS = 60 * 60 * 1000; // per hour

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return EMAIL_RE.test(email);
}

/** Firestore document id for an email (safe characters only). */
export function otpDocId(email) {
  return crypto.createHash('sha256').update(email).digest('hex');
}

export function generateCode() {
  // 6-digit, zero-padded, cryptographically random.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashCode(code, salt) {
  return crypto
    .createHash('sha256')
    .update(`${salt}:${code}`)
    .digest('hex');
}

export function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/** Constant-time compare of two hex strings. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
