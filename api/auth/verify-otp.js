// POST /api/auth/verify-otp  { email, code }
// Verifies the hashed OTP (checking expiry + attempt count), provisions/looks up
// the Firebase user, ensures the users/{uid} profile, and returns a custom token
// the client exchanges via signInWithCustomToken.
import { adminAuth, adminDb } from '../_lib/admin.js';
import {
  OTP_MAX_ATTEMPTS,
  normalizeEmail,
  isValidEmail,
  otpDocId,
  hashCode,
  safeEqual,
} from '../_lib/otp.js';

const DEFAULT_ROLE = 'customer';

async function provisionUser(auth, db, email) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, emailVerified: true });
  }
  if (!user.emailVerified) {
    await auth.updateUser(user.uid, { emailVerified: true });
  }

  const profileRef = db.collection('users').doc(user.uid);
  const profileSnap = await profileRef.get();
  const FieldValue = (await import('firebase-admin')).default.firestore
    .FieldValue;
  if (!profileSnap.exists) {
    await profileRef.set({
      uid: user.uid,
      name: user.displayName || '',
      email,
      phone: user.phoneNumber || '',
      role: DEFAULT_ROLE,
      createdAt: FieldValue.serverTimestamp(),
      lastLogin: FieldValue.serverTimestamp(),
      isVerified: true,
      profileCompleted: false,
    });
  } else {
    await profileRef.set(
      { lastLogin: FieldValue.serverTimestamp(), isVerified: true },
      { merge: true },
    );
  }
  return user;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the 6-digit code sent to your email.' });
  }

  let auth;
  let db;
  try {
    auth = adminAuth();
    db = adminDb();
  } catch (err) {
    return res.status(500).json({ error: 'Server not configured: ' + err.message });
  }

  const ref = db.collection('emailOtps').doc(otpDocId(email));

  try {
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(400).json({ error: 'No code requested. Request a new one.' });
    }
    const data = snap.data();

    if (Date.now() > data.expiresAt) {
      await ref.delete();
      return res.status(400).json({ error: 'Code expired. Request a new one.' });
    }
    if ((data.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
      await ref.delete();
      return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
    }

    const ok = safeEqual(hashCode(code, data.salt), data.hash);
    if (!ok) {
      const attempts = (data.attempts ?? 0) + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await ref.delete();
        return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
      }
      await ref.update({ attempts });
      const left = OTP_MAX_ATTEMPTS - attempts;
      return res.status(400).json({ error: `Incorrect code. ${left} attempt(s) left.` });
    }

    // Success — consume the OTP and mint a sign-in token.
    await ref.delete();
    const user = await provisionUser(auth, db, email);
    const token = await auth.createCustomToken(user.uid);
    return res.status(200).json({ token });
  } catch (err) {
    console.error('[verify-otp]', err);
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
}
