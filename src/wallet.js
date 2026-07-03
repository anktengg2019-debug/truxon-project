// Wallet & direct-UPI payment service — ported from the TRUXON marketplace.
// No payment gateway: "add money" creates a pending transaction and opens the
// user's UPI app; balance is credited when the payment is confirmed (admin).
// Collections: wallets/{id}, transactions/{id}.

import {
  collection,
  doc,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  increment,
  limit,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { getDb } from './firebase.js';

export const TRUXON_UPI_ID = 'truxon@icici';
export const TRUXON_MERCHANT_NAME = 'TRUXON LOGISTICS';

export const UPI_APPS = [
  { id: 'google_pay', displayName: 'Google Pay', icon: '💳', color: '#4285F4', androidIntent: 'tez://upi/pay', iosScheme: 'gpay://' },
  { id: 'phonepe', displayName: 'PhonePe', icon: '💜', color: '#5f259f', androidIntent: 'phonepe://pay', iosScheme: 'phonepe://' },
  { id: 'paytm', displayName: 'Paytm', icon: '💙', color: '#00B9F5', androidIntent: 'paytmmp://pay', iosScheme: 'paytm://' },
  { id: 'bhim', displayName: 'BHIM UPI', icon: '🟠', color: '#E36B00', androidIntent: 'bhim://pay', iosScheme: 'bhim://' },
  { id: 'amazon_pay', displayName: 'Amazon Pay', icon: '📦', color: '#FF9900', androidIntent: 'amazonpay://pay', iosScheme: 'amazonpay://' },
  { id: 'other', displayName: 'Other UPI app', icon: '🏦', color: '#8b949e' },
];

function requireDb() {
  const db = getDb();
  if (!db) throw new Error('Firebase is not configured');
  return db;
}

// ==================== UPI DEEP LINKS ====================

function buildUPIURI({ pa, pn, am, tr, tn, cu, url }) {
  const params = new URLSearchParams({ pa, pn, am, tr, tn, cu });
  if (url) params.append('url', url);
  return `upi://pay?${params.toString()}`;
}

/** Generate a UPI deep link (app-specific on mobile, generic otherwise). */
export function generateUPIDeepLink(amount, transactionId, description, app = 'google_pay') {
  const generic = buildUPIURI({
    pa: TRUXON_UPI_ID,
    pn: TRUXON_MERCHANT_NAME,
    am: Number(amount).toFixed(2),
    tr: transactionId,
    tn: String(description).substring(0, 80),
    cu: 'INR',
  });

  const cfg = UPI_APPS.find((a) => a.id === app);
  if (!cfg || typeof window === 'undefined') return generic;

  const ua = navigator.userAgent;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  if (isMobile) {
    if (/Android/i.test(ua) && cfg.androidIntent) {
      return `${cfg.androidIntent}?${generic.replace('upi://pay?', '')}`;
    }
    if (/iPhone|iPad|iPod/i.test(ua) && cfg.iosScheme) {
      return `${cfg.iosScheme}?${generic.replace('upi://pay?', '')}`;
    }
  }
  return generic;
}

/** Open the chosen UPI app to pay. */
export function openUPIApp(amount, transactionId, description, app) {
  const link = generateUPIDeepLink(amount, transactionId, description, app);
  if (typeof window !== 'undefined') window.location.href = link;
  return link;
}

// ==================== WALLET SERVICE ====================

export class WalletService {
  constructor(userId) {
    this.userId = userId;
  }

  async getOrCreateWallet() {
    const db = requireDb();
    const snap = await getDocs(query(collection(db, 'wallets'), where('userId', '==', this.userId)));
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    }
    const ref = await addDoc(collection(db, 'wallets'), {
      userId: this.userId,
      balance: 0,
      currency: 'INR',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { id: ref.id, userId: this.userId, balance: 0, currency: 'INR', status: 'active' };
  }

  subscribeToWallet(callback, onError) {
    const db = requireDb();
    const q = query(collection(db, 'wallets'), where('userId', '==', this.userId));
    return onSnapshot(
      q,
      (snap) => {
        if (snap.empty) return callback(null);
        const d = snap.docs[0];
        callback({ id: d.id, ...d.data() });
      },
      (err) => onError && onError(err),
    );
  }

  /** Create a pending "add money" transaction (credited after confirmation). */
  async createAddMoneyTransaction(amount, upiApp) {
    const db = requireDb();
    const wallet = await this.getOrCreateWallet();
    const transactionId = `TRX${Date.now()}${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const appName = UPI_APPS.find((a) => a.id === upiApp)?.displayName || 'UPI';
    const ref = await addDoc(collection(db, 'transactions'), {
      userId: this.userId,
      type: 'credit',
      amount: Number(amount),
      currency: 'INR',
      status: 'pending',
      paymentMethod: 'upi',
      upiApp,
      description: `Add money to TRUXON wallet via ${appName}`,
      transactionId,
      balanceAfter: wallet.balance,
      createdAt: serverTimestamp(),
    });
    return { id: ref.id, transactionId, amount: Number(amount), upiApp };
  }

  /** Deduct wallet balance to pay for a booked load. */
  async deductForBooking(amount, loadId, recipientId, description) {
    const db = requireDb();
    const wallet = await this.getOrCreateWallet();
    if ((wallet.balance || 0) < amount) {
      return { success: false, error: 'Insufficient balance' };
    }
    const batch = writeBatch(db);
    const txnRef = doc(collection(db, 'transactions'));
    const newBalance = wallet.balance - amount;
    batch.set(txnRef, {
      userId: this.userId,
      type: 'debit',
      amount: Number(amount),
      currency: 'INR',
      status: 'completed',
      paymentMethod: 'wallet',
      description,
      loadId,
      relatedUserId: recipientId,
      balanceAfter: newBalance,
      createdAt: serverTimestamp(),
      completedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'wallets', wallet.id), {
      balance: increment(-amount),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return { success: true, transactionId: txnRef.id };
  }

  subscribeToTransactions(callback, onError, limitCount = 50) {
    const db = requireDb();
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', this.userId),
      orderBy('createdAt', 'desc'),
      limit(limitCount),
    );
    return onSnapshot(
      q,
      (snap) =>
        callback(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ...data,
              createdAt: data.createdAt?.toDate?.() ?? null,
              completedAt: data.completedAt?.toDate?.() ?? null,
            };
          }),
        ),
      (err) => onError && onError(err),
    );
  }
}

// ==================== UTILS ====================

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

export function formatDate(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
