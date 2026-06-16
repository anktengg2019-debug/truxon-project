// One-off connectivity check (run with: node scripts/check-firestore.mjs).
// Mirrors the app: init app -> anonymous sign-in (best-effort) -> write+read drivers/_healthcheck.
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

let uid = null;

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
  uid = cred.user.uid;
  console.log('AUTH OK uid=', uid);
} catch (e) {
  console.log('AUTH FAILED', e.code);
}

const db = getFirestore(app);

// Mirror ensureUserProfile(): role-based rules need users/{uid} before driver ops.
if (uid) {
  try {
    await setDoc(doc(db, 'users', uid), { role: 'user', createdAt: serverTimestamp() }, { merge: true });
    console.log('PROFILE OK users/' + uid);
  } catch (e) {
    console.log('PROFILE ERROR', e.code, e.message);
  }
}

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
