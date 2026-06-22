// Production auth for Truxon: Google, Email OTP, Email + Password, and Phone OTP.
// Session persists across reloads (browserLocalPersistence is set in firebase.js),
// giving auto-login + logout. Phone OTP uses an invisible reCAPTCHA (v10 modular).

import {
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  updateProfile,
  signOut,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { getAuthInstance, getDb, USERS_COLLECTION } from './firebase.js';

/** Allowed user roles. */
export const ROLES = ['customer', 'transporter', 'vendor', 'driver', 'admin'];
export const DEFAULT_ROLE = 'customer';
// Roles permitted to read the live fleet / broadcast positions (driver page).
export const FLEET_ROLES = ['transporter', 'vendor', 'driver', 'admin'];

function requireAuth() {
  const auth = getAuthInstance();
  if (!auth) throw new Error('Firebase is not configured');
  return auth;
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error('Firebase is not configured');
  return db;
}

/**
 * Create the users/{uid} profile on first sign-in and refresh lastLogin on every
 * sign-in. Never downgrades an existing role. Returns the stored profile.
 * @param {import('firebase/auth').User} user
 * @param {{ name?: string, phone?: string, role?: string }} [extra]
 */
export async function ensureUserProfile(user, extra = {}) {
  const db = requireDb();
  const ref = doc(db, USERS_COLLECTION, user.uid);
  const snap = await getDoc(ref);
  const now = serverTimestamp();

  if (!snap.exists()) {
    const role = ROLES.includes(extra.role) ? extra.role : DEFAULT_ROLE;
    const name = extra.name || user.displayName || '';
    const phone = extra.phone || user.phoneNumber || '';
    const profile = {
      uid: user.uid,
      name,
      email: user.email || '',
      phone,
      role,
      createdAt: now,
      lastLogin: now,
      isVerified: Boolean(user.emailVerified),
      profileCompleted: Boolean(name && phone),
    };
    await setDoc(ref, profile);
    return profile;
  }

  // Existing profile: refresh login metadata only (never change role here).
  const patch = {
    lastLogin: now,
    isVerified: Boolean(user.emailVerified),
    email: user.email || snap.data().email || '',
  };
  if (extra.name) patch.name = extra.name;
  if (extra.phone) patch.phone = extra.phone;
  await setDoc(ref, patch, { merge: true });
  return { ...snap.data(), ...patch };
}

/** @returns {Promise<object|null>} the current user's profile doc, or null. */
export async function getCurrentProfile() {
  const auth = requireAuth();
  const user = auth.currentUser;
  if (!user) return null;
  const db = requireDb();
  const snap = await getDoc(doc(db, USERS_COLLECTION, user.uid));
  return snap.exists() ? snap.data() : null;
}

/** Google one-click sign-in. Creates the profile if missing. */
export async function signInWithGoogle() {
  const auth = requireAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const { user } = await signInWithPopup(auth, provider);
  await ensureUserProfile(user);
  return user;
}

/**
 * Email + password sign-up. Sends a verification email and creates the profile.
 * @param {{ name: string, email: string, phone: string, password: string, role: string }} data
 */
export async function signUpWithEmailPassword(data) {
  const auth = requireAuth();
  const { user } = await createUserWithEmailAndPassword(
    auth,
    data.email,
    data.password,
  );
  if (data.name) {
    await updateProfile(user, { displayName: data.name });
  }
  await ensureUserProfile(user, {
    name: data.name,
    phone: data.phone,
    role: data.role,
  });
  // Fire-and-forget; surfacing a failure here shouldn't block signup.
  try {
    await sendEmailVerification(user);
  } catch (err) {
    console.warn('[auth] Could not send verification email:', err?.message ?? err);
  }
  return user;
}

/** Email + password sign-in. */
export async function signInWithEmailPassword(email, password) {
  const auth = requireAuth();
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  await ensureUserProfile(user);
  return user;
}

/** Send a password reset email. */
export async function resetPassword(email) {
  const auth = requireAuth();
  await sendPasswordResetEmail(auth, email);
}

/**
 * Complete an Email OTP sign-in using a custom token minted by the backend
 * (see api/auth/verify-otp.js). The profile is ensured server-side, but we also
 * refresh lastLogin client-side.
 * @param {string} customToken
 */
export async function signInWithEmailOtpToken(customToken) {
  const auth = requireAuth();
  const { user } = await signInWithCustomToken(auth, customToken);
  await ensureUserProfile(user);
  return user;
}

// --- Phone OTP ------------------------------------------------------------
// A single invisible reCAPTCHA verifier is created lazily and reused for the
// life of the page. We never read auth.settings.appVerificationDisabledForTesting.
let recaptchaVerifier = null;

/**
 * Get (creating once) the shared invisible RecaptchaVerifier.
 * @param {string} [containerId] id of an element to host the widget
 */
export function getRecaptchaVerifier(containerId = 'recaptcha-container') {
  const auth = requireAuth();
  if (!recaptchaVerifier) {
    recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      size: 'invisible',
    });
  }
  return recaptchaVerifier;
}

/** Normalize an Indian phone number to E.164 (+91XXXXXXXXXX). */
export function toE164(input) {
  const raw = String(input || '').trim();
  if (raw.startsWith('+')) return '+' + raw.slice(1).replace(/\D/g, '');
  const digits = raw.replace(/\D/g, '').slice(-10);
  return '+91' + digits;
}

/**
 * Start phone sign-in: sends an SMS code. Returns the confirmationResult to
 * pass to confirmPhoneCode().
 * @param {string} phone user-entered phone number
 * @param {string} [containerId]
 */
export async function startPhoneSignIn(phone, containerId = 'recaptcha-container') {
  const auth = requireAuth();
  const verifier = getRecaptchaVerifier(containerId);
  return signInWithPhoneNumber(auth, toE164(phone), verifier);
}

/**
 * Confirm the SMS code and finish sign-in. Creates the profile if missing.
 * @param {import('firebase/auth').ConfirmationResult} confirmationResult
 * @param {string} code 6-digit SMS code
 */
export async function confirmPhoneCode(confirmationResult, code) {
  const { user } = await confirmationResult.confirm(code);
  await ensureUserProfile(user);
  return user;
}

/** Sign out the current user. */
export async function logout() {
  const auth = requireAuth();
  await signOut(auth);
}

/**
 * Subscribe to auth state. Calls back with the User (or null).
 * @param {(user: import('firebase/auth').User | null) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onAuth(cb) {
  const auth = requireAuth();
  return onAuthStateChanged(auth, cb);
}

/**
 * Route guard: resolve the current user once, redirecting to the login page if
 * not signed in. Use at the top of protected pages.
 * @param {string} [loginUrl]
 * @returns {Promise<import('firebase/auth').User>}
 */
export function requireUser(loginUrl = '/login.html') {
  const auth = requireAuth();
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (user) {
        resolve(user);
      } else {
        const next = encodeURIComponent(
          location.pathname + location.search,
        );
        location.replace(`${loginUrl}?next=${next}`);
      }
    });
  });
}

/** Map a Firebase auth error code to a friendly message. */
export function authErrorMessage(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-email': 'That email address is not valid.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/email-already-in-use': 'An account already exists with that email.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/popup-blocked': 'Popup blocked — allow popups and try again.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/operation-not-allowed':
      'This sign-in method is not enabled in Firebase. Enable it in Authentication → Sign-in method.',
    'auth/invalid-phone-number': 'That phone number is not valid.',
    'auth/missing-phone-number': 'Enter your phone number first.',
    'auth/invalid-verification-code': 'Incorrect code. Please try again.',
    'auth/code-expired': 'The code expired. Request a new one.',
    'auth/captcha-check-failed': 'reCAPTCHA failed. Reload the page and try again.',
  };
  return map[code] || err?.message || 'Something went wrong. Please try again.';
}
