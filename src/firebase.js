// Firebase initialization (no anonymous auth, no App Check / reCAPTCHA).
// Auth is handled explicitly by the user via Google, Email OTP, or Email+Password
// (see src/auth.js). Firestore reads/writes are gated by the signed-in user.

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

export const DRIVERS_COLLECTION = 'drivers';
export const USERS_COLLECTION = 'users';

let app = null;
let db = null;
let auth = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  auth.useDeviceLanguage();
  // Keep the session across reloads/tabs (auto-login). Best-effort.
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('[firebase] Could not set auth persistence:', err?.message ?? err);
  });
}

/** @returns {import('firebase/app').FirebaseApp | null} */
export function getFirebaseApp() {
  return app;
}

/** @returns {import('firebase/auth').Auth | null} */
export function getAuthInstance() {
  return auth;
}

/** @returns {import('firebase/firestore').Firestore | null} */
export function getDb() {
  return db;
}

/**
 * Write (upsert) a driver's live position to Firestore. Requires a signed-in user
 * whose role is allowed to write drivers (see firestore.rules).
 * @param {object} driver - { id, name, lat, lng, heading, speed, status }
 */
export async function publishDriverPosition(driver) {
  if (!db) throw new Error('Firebase is not configured');
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
  const ref = collection(db, DRIVERS_COLLECTION);
  return onSnapshot(
    ref,
    (snapshot) => {
      const drivers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onChange(drivers);
    },
    (error) => {
      if (onError) onError(error);
    },
  );
}
