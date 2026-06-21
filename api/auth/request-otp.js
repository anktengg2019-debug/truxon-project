// POST /api/auth/request-otp  { email }
// Generates a 6-digit OTP, stores only its hash (with salt + expiry), enforces
// rate limiting, and emails the code. Never reveals whether an account exists.
import { adminDb } from '../_lib/admin.js';
import { sendOtpEmail } from '../_lib/email.js';
import {
  OTP_TTL_MINUTES,
  RESEND_MIN_INTERVAL_MS,
  MAX_SENDS_PER_WINDOW,
  RATE_WINDOW_MS,
  normalizeEmail,
  isValidEmail,
  otpDocId,
  generateCode,
  hashCode,
  newSalt,
} from '../_lib/otp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  let db;
  try {
    db = adminDb();
  } catch (err) {
    return res.status(500).json({ error: 'Server not configured: ' + err.message });
  }

  const ref = db.collection('emailOtps').doc(otpDocId(email));
  const now = Date.now();

  try {
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() : null;

    // Rate limiting.
    let windowStart = prev?.windowStart ?? now;
    let sendCount = prev?.sendCount ?? 0;
    if (now - windowStart > RATE_WINDOW_MS) {
      windowStart = now;
      sendCount = 0;
    }
    if (prev?.lastSentAt && now - prev.lastSentAt < RESEND_MIN_INTERVAL_MS) {
      const retryAfter = Math.ceil(
        (RESEND_MIN_INTERVAL_MS - (now - prev.lastSentAt)) / 1000,
      );
      return res
        .status(429)
        .json({ error: `Please wait ${retryAfter}s before requesting another code.`, retryAfter });
    }
    if (sendCount >= MAX_SENDS_PER_WINDOW) {
      return res
        .status(429)
        .json({ error: 'Too many code requests. Try again later.' });
    }

    const code = generateCode();
    const salt = newSalt();
    const expiresAt = now + OTP_TTL_MINUTES * 60 * 1000;

    await ref.set({
      email,
      hash: hashCode(code, salt),
      salt,
      expiresAt,
      attempts: 0,
      sendCount: sendCount + 1,
      windowStart,
      lastSentAt: now,
      createdAt: now,
    });

    await sendOtpEmail(email, code, OTP_TTL_MINUTES);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[request-otp]', err);
    return res.status(500).json({ error: 'Could not send the code. Please try again.' });
  }
}
