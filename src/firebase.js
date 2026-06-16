import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from 'firebase/app-check';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
};

const APPCHECK_SITE_KEY = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

const DRIVERS_COLLECTION = 'drivers';
const USERS_COLLECTION = 'users';
const DEFAULT_ROLE = 'user';

let db = null;
let auth = null;
// Resolves once we know the auth state (signed in, or sign-in attempted and failed).
// Firestore calls await this so writes/reads carry an auth token when rules require it.
let authReady = Promise.resolve();
// Resolves after authReady AND the signed-in user's profile doc has been ensured.
// Role-based rules read users/{uid}.role, so the profile must exist before driver ops.
let ready = Promise.resolve();

/**
 * Ensure a profile document exists for the signed-in user so role-based rules
 * (which read users/{uid}.role) have a document to evaluate. Self-creates with a
 * default role on first sign-in. Best-effort: never throws.
 */
async function ensureUserProfile(user) {
  if (!user) return;
  try {
    const ref = doc(collection(db, USERS_COLLECTION), user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        { role: DEFAULT_ROLE, createdAt: serverTimestamp() },
        { merge: true },
      );
    } else if (snap.data().role == null) {
      // Profile exists but is missing the role field rules depend on.
      await setDoc(ref, { role: DEFAULT_ROLE }, { merge: true });
    }
  } catch (err) {
    console.warn(
      '[firebase] Could not ensure user profile (' +
        (err?.code ?? 'error') +
        '). Driver ops may be denied until users/{uid}.role exists.',
    );
  }
}

if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);

  // App Check protects backend resources from abuse. Only initialize when a
  // reCAPTCHA v3 site key is provided; otherwise skip so local/dev still works.
  if (APPCHECK_SITE_KEY) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(APPCHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn('[firebase] App Check init failed:', err?.message ?? err);
    }
  }

  db = getFirestore(app);
  auth = getAuth(app);
  // Use the device language for reCAPTCHA / SMS templates (phone auth).
  auth.useDeviceLanguage();

  authReady = new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (user) resolve(user);
    });
    signInAnonymously(auth).catch((err) => {
      // Anonymous auth may be disabled in the console. Don't hard-fail:
      // open ("if true") rules still work unauthenticated. Auth-gated rules
      // require enabling Anonymous sign-in in Firebase Console > Authentication.
      console.warn(
        '[firebase] Anonymous sign-in unavailable (' +
          (err?.code ?? 'error') +
          '). Continuing unauthenticated; enable Anonymous Authentication if your rules require auth.',
      );
      resolve(null);
    });
  });

  // After auth, ensure the user's profile (role) doc exists so role-based rules pass.
  ready = authReady.then(ensureUserProfile);
}

/** @returns {import('firebase/auth').Auth | null} the initialized Auth instance, or null if Firebase isn't configured. */
export function getAuthInstance() {
  return auth;
}

/**
 * Ensure the given (or current) user has a profile doc with a role, so role-based
 * rules pass. Exposed for sign-in flows (e.g. phone auth) that change the user
 * after the initial anonymous bootstrap.
 */
export async function ensureProfileForUser(user) {
  await ensureUserProfile(user ?? auth?.currentUser ?? null);
}

/**
 * Write (upsert) a driver's live position to Firestore.
 * @param {object} driver - { id, name, lat, lng, heading, speed, status }
 */
export async function publishDriverPosition(driver) {
  if (!db) throw new Error('Firebase is not configured');
  await ready;
  const ref = doc(collection(db, DRIVERS_COLLECTION), driver.id);
  await setDoc(
    ref,
    {
      name: driver.name,
      lat: driver.lat,
      lng: driver.lng,
      heading: driver.heading ?? 0,
      speed: driver.speed ?? 0,
      status: driver.status ?? 'active',
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Subscribe to all drivers' live positions.
 * @param {(drivers: object[]) => void} onChange
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe function
 */
export function subscribeToDrivers(onChange, onError) {
  if (!db) throw new Error('Firebase is not configured');
  let unsub = () => {};
  let cancelled = false;
  ready.then(() => {
    if (cancelled) return;
    const ref = collection(db, DRIVERS_COLLECTION);
    unsub = onSnapshot(
      ref,
      (snapshot) => {
        const drivers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        onChange(drivers);
      },
      (error) => {
        if (onError) onError(error);
      },
    );
  });
  return () => {
    cancelled = true;
    unsub();
  };
}
