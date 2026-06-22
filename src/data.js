// Firestore data layer for the Customer Booking module.
// Auth + GPS-tracking data access lives in firebase.js / auth.js and is untouched.

import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { getDb } from './firebase.js';

export const BOOKINGS_COLLECTION = 'bookings';

function requireDb() {
  const db = getDb();
  if (!db) throw new Error('Firebase is not configured');
  return db;
}

/**
 * Create a customer booking.
 * @param {string} uid - owner (customer) uid
 * @param {{pickup,drop,vehicleType,materialType,weight,customerName,mobile}} data
 * @returns {Promise<string>} the new booking id
 */
export async function createBooking(uid, data) {
  const db = requireDb();
  const ref = await addDoc(collection(db, BOOKINGS_COLLECTION), {
    ownerUid: uid,
    pickup: data.pickup,
    drop: data.drop,
    vehicleType: data.vehicleType,
    materialType: data.materialType,
    weight: Number(data.weight),
    customerName: data.customerName,
    mobile: data.mobile,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Subscribe to all bookings, newest first. */
export function subscribeToBookings(onChange, onError) {
  const db = requireDb();
  const q = query(collection(db, BOOKINGS_COLLECTION), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError && onError(err),
  );
}
