import { Injectable } from '@angular/core';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  query,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FirestoreClient } from '../firestore/firestore.client';

export type TimeOffType = 'pto' | 'sick' | 'unpaid';
export type TimeOffStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface AccrualBalance {
  uid: string;
  orgId: string;
  ptoBalance: number;
  sickBalance: number;
  ptoTaken: number;
  sickTaken: number;
  plannedPto: number;
  plannedSick: number;
  asOf?: any;
  updatedAt?: any;
}

export interface TimeOffRequest {
  id: string;
  orgId: string;
  userId: string;
  displayName?: string | null;
  type: 'time_off';
  requestType: TimeOffType;
  status: TimeOffStatus;
  startDate: string;
  endDate: string;
  hours: number;
  payRate?: number | null;
  paid?: boolean | null;
  notes?: string | null;
  createdAt?: any;
  updatedAt?: any;
  decidedAt?: any;
  decidedBy?: string | null;
  managerNote?: string | null;
}

export interface AccrualLedgerItem {
  id: string;
  orgId: string;
  userId: string;
  type: TimeOffType | 'adjustment';
  label?: string | null;
  hours: number;
  balanceAfter?: number | null;
  createdAt?: any;
  source?: string | null;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeBalance(orgId: string, uid: string, data: any): AccrualBalance {
  const balances = data?.balances || {};
  const taken = data?.taken || {};
  const planned = data?.planned || {};
  return {
    uid,
    orgId,
    ptoBalance: num(data?.ptoBalance ?? balances?.pto ?? balances?.PTO),
    sickBalance: num(data?.sickBalance ?? balances?.sick ?? balances?.SICK),
    ptoTaken: num(data?.ptoTaken ?? taken?.pto ?? taken?.PTO),
    sickTaken: num(data?.sickTaken ?? taken?.sick ?? taken?.SICK),
    plannedPto: num(data?.plannedPto ?? planned?.pto ?? planned?.PTO),
    plannedSick: num(data?.plannedSick ?? planned?.sick ?? planned?.SICK),
    asOf: data?.asOf ?? data?.updatedAt ?? null,
    updatedAt: data?.updatedAt ?? null,
  };
}

@Injectable({ providedIn: 'root' })
export class AccrualsRepo {
  constructor(private fs: FirestoreClient) {}

  emptyBalance(orgId: string, uid: string): AccrualBalance {
    return normalizeBalance(orgId, uid, {});
  }

  watchBalance(orgId: string, uid: string, cb: (balance: AccrualBalance) => void): () => void {
    const ref = doc(this.fs.db, `orgs/${orgId}/accrualBalances/${uid}`);
    return onSnapshot(ref, (snap) => {
      const data = snap.exists() ? snap.data() : {};
      this.fs.run(() => cb(normalizeBalance(orgId, uid, data)));
    }, (error) => {
      console.warn('[InnovaShift] Accrual balance listener failed.', error);
      this.fs.run(() => cb(this.emptyBalance(orgId, uid)));
    });
  }

  watchRequests(orgId: string, uid: string, cb: (items: TimeOffRequest[]) => void, max = 50): () => void {
    const col = collection(this.fs.db, `orgs/${orgId}/requests`);
    const q = query(col, where('userId', '==', uid), limit(max));
    return onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as TimeOffRequest)
        .filter((r) => String(r.type || '') === 'time_off')
        .sort((a, b) => this.toMs(b.createdAt) - this.toMs(a.createdAt));
      this.fs.run(() => cb(items));
    }, (error) => {
      console.warn('[InnovaShift] Time-off request listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  watchOrgRequests(orgId: string, cb: (items: TimeOffRequest[]) => void, max = 500): () => void {
    const col = collection(this.fs.db, `orgs/${orgId}/requests`);
    const q = query(col, limit(max));
    return onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as TimeOffRequest)
        .filter((r) => String(r.type || '') === 'time_off')
        .sort((a, b) => this.toMs(b.createdAt) - this.toMs(a.createdAt));
      this.fs.run(() => cb(items));
    }, (error) => {
      console.warn('[InnovaShift] Org time-off request listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  /**
   * Approve/reject a time-off request. Runs server-side (Cloud Function) rather than
   * a client transaction because approval must also be able to unassign+republish
   * overlapping shifts, and orgs/{orgId}/shifts is Cloud-Function-only per firestore.rules.
   */
  async decideTimeOffRequest(payload: {
    orgId: string;
    request: TimeOffRequest;
    decision: 'approved' | 'rejected';
    managerNote?: string | null;
    actorUid?: string | null;
    payRate?: number | null;
    paid?: boolean | null;
  }): Promise<void> {
    const fns = getFunctions(undefined, 'us-east1');
    const decideCallable = httpsCallable(fns, 'decideTimeOffRequest');
    await decideCallable({
      orgId: payload.orgId,
      requestId: payload.request.id,
      decision: payload.decision,
      managerNote: payload.managerNote ?? null,
      payRate: payload.payRate ?? null,
      paid: payload.paid ?? null,
    });
  }

  watchLedger(orgId: string, uid: string, cb: (items: AccrualLedgerItem[]) => void, max = 50): () => void {
    const col = collection(this.fs.db, `orgs/${orgId}/accrualLedger`);
    const q = query(col, where('userId', '==', uid), limit(max));
    return onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as AccrualLedgerItem)
        .sort((a, b) => this.toMs(b.createdAt) - this.toMs(a.createdAt));
      this.fs.run(() => cb(items));
    }, (error) => {
      console.warn('[InnovaShift] Accrual ledger listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  async submitTimeOffRequest(payload: {
    orgId: string;
    uid: string;
    displayName?: string | null;
    requestType: TimeOffType;
    startDate: string;
    endDate: string;
    hours: number;
    notes?: string | null;
  }): Promise<string> {
    const hours = num(payload.hours);
    const requestType = payload.requestType;
    const ref = await addDoc(collection(this.fs.db, `orgs/${payload.orgId}/requests`), {
      orgId: payload.orgId,
      userId: payload.uid,
      displayName: payload.displayName ?? null,
      type: 'time_off',
      requestType,
      status: 'pending',
      startDate: payload.startDate,
      endDate: payload.endDate,
      hours,
      notes: payload.notes?.trim() || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Keep a user-owned request pointer for fast profile/activity screens.
    await setDoc(doc(this.fs.db, `orgs/${payload.orgId}/userRequests/${payload.uid}_${ref.id}`), {
      orgId: payload.orgId,
      userId: payload.uid,
      requestId: ref.id,
      type: 'time_off',
      status: 'pending',
      requestType,
      hours,
      createdAt: serverTimestamp(),
    }, { merge: true }).catch(() => undefined);

    return ref.id;
  }

  private toMs(value: any): number {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Timestamp) return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : 0;
  }
}
