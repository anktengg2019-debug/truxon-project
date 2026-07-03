// Load & bidding service — ported from the TRUXON marketplace (Next.js) to the
// vanilla-JS site. Framework-agnostic Firestore logic over the same collections.
// Collections: loads/{id}, bids/{id}.

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  onSnapshot,
  increment,
  writeBatch,
} from 'firebase/firestore';
import { getDb } from './firebase.js';

export const LOADS_COLLECTION = 'loads';
export const BIDS_COLLECTION = 'bids';

// Roles allowed to post loads vs. bid on them.
export const LOAD_POSTER_ROLES = ['customer', 'vendor', 'admin'];
export const BIDDER_ROLES = ['transporter', 'driver', 'admin'];

export const TRUCK_TYPES = [
  { value: 'small', label: 'Small (1-2 T)' },
  { value: 'medium', label: 'Medium (3-5 T)' },
  { value: 'large', label: 'Large (7-10 T)' },
  { value: 'heavy', label: 'Heavy (15+ T)' },
  { value: 'container', label: 'Container (20-40 ft)' },
  { value: 'tanker', label: 'Tanker (10-30 KL)' },
  { value: 'refrigerated', label: 'Refrigerated (5-15 T)' },
];

export const MATERIAL_TYPES = [
  { value: 'general', label: 'General Goods' },
  { value: 'steel', label: 'Steel & Metals' },
  { value: 'cement', label: 'Cement & Construction' },
  { value: 'fmcg', label: 'FMCG & Groceries' },
  { value: 'automotive', label: 'Automotive' },
  { value: 'chemical', label: 'Chemicals' },
  { value: 'agriculture', label: 'Agriculture' },
  { value: 'construction', label: 'Construction Material' },
  { value: 'textile', label: 'Textile & Garments' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'pharma', label: 'Pharmaceuticals' },
  { value: 'other', label: 'Other' },
];

export const LOAD_STATUSES = ['pending', 'booked', 'in_transit', 'delivered', 'cancelled'];

function requireDb() {
  const db = getDb();
  if (!db) throw new Error('Firebase is not configured');
  return db;
}

// ==================== LOADS ====================

/**
 * Create a new load posting.
 * @param {string} customerId owner uid
 * @param {object} data { customerName, customerPhone, materialType, materialDescription,
 *   weight, truckType, quantity, pickup, dropoff, expectedPrice, pickupDate, pickupTimeWindow }
 * @returns {Promise<string>} new load id
 */
export async function createLoad(customerId, data) {
  const db = requireDb();
  const ref = await addDoc(collection(db, LOADS_COLLECTION), {
    customerId,
    customerName: data.customerName || '',
    customerPhone: data.customerPhone || '',
    materialType: data.materialType,
    materialDescription: data.materialDescription || '',
    weight: Number(data.weight),
    truckType: data.truckType,
    quantity: Number(data.quantity) || 1,
    pickup: data.pickup,
    dropoff: data.dropoff,
    expectedPrice: Number(data.expectedPrice) || 0,
    pickupDate: data.pickupDate ? Timestamp.fromDate(new Date(data.pickupDate)) : null,
    pickupTimeWindow: data.pickupTimeWindow || 'flexible',
    status: 'pending',
    bidCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
  });
  return ref.id;
}

/** Cancel a pending load (owner only). */
export async function cancelLoad(loadId, customerId) {
  const db = requireDb();
  const ref = doc(db, LOADS_COLLECTION, loadId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Load not found');
  const load = snap.data();
  if (load.customerId !== customerId) throw new Error('Not your load');
  if (load.status !== 'pending') throw new Error('Cannot cancel: load already booked or in transit');
  await updateDoc(ref, { status: 'cancelled', updatedAt: serverTimestamp() });
}

/** Real-time subscription to available (pending) loads for transporters. */
export function subscribeToAvailableLoads(onChange, onError) {
  const db = requireDb();
  const q = query(
    collection(db, LOADS_COLLECTION),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map(convertLoad)),
    (err) => onError && onError(err),
  );
}

/** Real-time subscription to a customer's own loads. */
export function subscribeToCustomerLoads(customerId, onChange, onError) {
  const db = requireDb();
  const q = query(
    collection(db, LOADS_COLLECTION),
    where('customerId', '==', customerId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map(convertLoad)),
    (err) => onError && onError(err),
  );
}

/** Aggregate stats for a customer's loads. */
export async function getCustomerStats(customerId) {
  const db = requireDb();
  const q = query(collection(db, LOADS_COLLECTION), where('customerId', '==', customerId));
  const snap = await getDocs(q);
  const stats = {
    totalLoads: 0,
    pendingLoads: 0,
    bookedLoads: 0,
    inTransitLoads: 0,
    deliveredLoads: 0,
    totalSpent: 0,
    activeBids: 0,
  };
  snap.docs.forEach((d) => {
    const load = d.data();
    stats.totalLoads++;
    if (load.status === 'pending') stats.pendingLoads++;
    else if (load.status === 'booked') stats.bookedLoads++;
    else if (load.status === 'in_transit') stats.inTransitLoads++;
    else if (load.status === 'delivered') {
      stats.deliveredLoads++;
      stats.totalSpent += load.finalPrice || load.expectedPrice || 0;
    }
    stats.activeBids += load.bidCount || 0;
  });
  return stats;
}

// ==================== BIDS ====================

/**
 * Place a bid on a load. Increments the load's bidCount.
 * @param {object} bidData { loadId, transporterId, transporterName, transporterPhone,
 *   amount, message, vehicleNumber, driverName, driverPhone }
 * @returns {Promise<string>} new bid id
 */
export async function placeBid(bidData) {
  const db = requireDb();
  const batch = writeBatch(db);

  const bidRef = doc(collection(db, BIDS_COLLECTION));
  batch.set(bidRef, {
    loadId: bidData.loadId,
    transporterId: bidData.transporterId,
    transporterName: bidData.transporterName || '',
    transporterPhone: bidData.transporterPhone || '',
    amount: Number(bidData.amount),
    message: bidData.message || '',
    vehicleNumber: bidData.vehicleNumber || '',
    driverName: bidData.driverName || '',
    driverPhone: bidData.driverPhone || '',
    status: 'pending',
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)),
  });

  const loadRef = doc(db, LOADS_COLLECTION, bidData.loadId);
  batch.update(loadRef, { bidCount: increment(1), updatedAt: serverTimestamp() });

  await batch.commit();
  return bidRef.id;
}

/** Real-time subscription to a load's bids (for the load owner). */
export function subscribeToLoadBids(loadId, onChange, onError) {
  const db = requireDb();
  const q = query(
    collection(db, BIDS_COLLECTION),
    where('loadId', '==', loadId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map(convertBid)),
    (err) => onError && onError(err),
  );
}

/** Real-time subscription to a transporter's own bids. */
export function subscribeToTransporterBids(transporterId, onChange, onError) {
  const db = requireDb();
  const q = query(
    collection(db, BIDS_COLLECTION),
    where('transporterId', '==', transporterId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map(convertBid)),
    (err) => onError && onError(err),
  );
}

/**
 * Accept a bid (load owner). Marks the bid accepted, rejects the others, and
 * books the load with the winning transporter + price.
 */
export async function acceptBid(bidId, loadId, _customerId) {
  const db = requireDb();
  const bidRef = doc(db, BIDS_COLLECTION, bidId);
  const bidSnap = await getDoc(bidRef);
  if (!bidSnap.exists()) throw new Error('Bid not found');
  const bid = bidSnap.data();

  const batch = writeBatch(db);
  batch.update(bidRef, { status: 'accepted', respondedAt: serverTimestamp() });

  const otherBids = await getDocs(
    query(
      collection(db, BIDS_COLLECTION),
      where('loadId', '==', loadId),
      where('status', '==', 'pending'),
    ),
  );
  otherBids.docs.forEach((d) => {
    if (d.id !== bidId) {
      batch.update(d.ref, { status: 'rejected', respondedAt: serverTimestamp() });
    }
  });

  const loadRef = doc(db, LOADS_COLLECTION, loadId);
  batch.update(loadRef, {
    status: 'booked',
    assignedTransporterId: bid.transporterId,
    finalPrice: bid.amount,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

// ==================== HELPERS ====================

function convertLoad(d) {
  const data = d.data();
  return {
    id: d.id,
    ...data,
    pickupDate: data.pickupDate?.toDate?.() ?? null,
    createdAt: data.createdAt?.toDate?.() ?? null,
    updatedAt: data.updatedAt?.toDate?.() ?? null,
    expiresAt: data.expiresAt?.toDate?.() ?? null,
  };
}

function convertBid(d) {
  const data = d.data();
  return {
    id: d.id,
    ...data,
    createdAt: data.createdAt?.toDate?.() ?? null,
    expiresAt: data.expiresAt?.toDate?.() ?? null,
    respondedAt: data.respondedAt?.toDate?.() ?? null,
  };
}

export function labelFor(list, value) {
  return list.find((o) => o.value === value)?.label ?? value;
}
