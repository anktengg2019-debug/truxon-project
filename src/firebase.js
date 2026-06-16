import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
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

let db = null;
let auth = null;
// Resolves once we know the auth state (signed in, or sign-in attempted and failed).
// Firestore calls await this so writes/reads carry an auth token when rules require it.
let authReady = Promise.resolve();

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
}

/**
 * Write (upsert) a driver's live position to Firestore.
 * @param {object} driver - { id, name, lat, lng, heading, speed, status }
 */
export async function publishDriverPosition(driver) {
  if (!db) throw new Error('Firebase is not configured');
  await authReady;
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
  authReady.then(() => {
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
