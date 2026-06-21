// Firebase Admin singleton for serverless functions. Initialized from a service
// account provided via env (raw JSON or base64-encoded JSON).
import admin from 'firebase-admin';

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT env var is not set. Provide the service account JSON (or base64 of it).',
    );
  }
  const json = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(json);
}

let app = null;

export function getAdmin() {
  if (!app) {
    app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert(loadServiceAccount()),
        });
  }
  return admin;
}

export function adminAuth() {
  return getAdmin().auth();
}

export function adminDb() {
  return getAdmin().firestore();
}
