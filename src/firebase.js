import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

const DRIVERS_COLLECTION = 'drivers';

let db = null;
if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
}

/**
 * Write (upsert) a driver's live position to Firestore.
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
