// One-off connectivity check (run with: node scripts/check-firestore.mjs).
// Mirrors the app: init app -> anonymous sign-in (best-effort) -> write+read drivers/_healthcheck.
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

const auth = getAuth(app);
try {
  const cred = await signInAnonymously(auth);
  console.log('AUTH OK uid=', cred.user.uid);
} catch (e) {
  console.log('AUTH FAILED', e.code);
}

const db = getFirestore(app);
const ref = doc(db, 'drivers', '_healthcheck');
try {
  await setDoc(ref, { name: '_healthcheck', lat: 0, lng: 0, updatedAt: serverTimestamp() }, { merge: true });
  const snap = await getDoc(ref);
  console.log('FIRESTORE OK exists=', snap.exists());
  process.exit(0);
} catch (e) {
  console.log('FIRESTORE ERROR', e.code, e.message);
  process.exit(1);
}
