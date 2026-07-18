import { Injectable } from '@angular/core';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';

export interface AvailabilityEntry {
  id: string;
  orgId: string;
  userId: string;
  userDisplayName?: string | null;
  jobRole?: string | null;
  date: string;        // 'YYYY-MM-DD'
  startTime: string;   // 'HH:mm'
  endTime: string;     // 'HH:mm'
  note?: string | null;
  createdAt?: any;
}

@Injectable({ providedIn: 'root' })
export class AvailabilityRepo {
  constructor(private fs: FirestoreClient) {}

  /** A single staff member's own upcoming availability. Sorted client-side
   * (not orderBy in the query) — a userId-equality + date-orderBy query
   * would need a composite index; this avoids that entirely. */
  watchMyAvailability(orgId: string, uid: string, cb: (items: AvailabilityEntry[]) => void, max = 200) {
    const col = collection(this.fs.db, `orgs/${orgId}/availability`);
    const q = query(col, where('userId', '==', uid), limit(max));
    return onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as AvailabilityEntry)
        .sort((a, b) => a.date.localeCompare(b.date));
      this.fs.run(() => cb(items));
    }, (error) => {
      console.warn('[InnovaShift] Availability listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  /** Org-wide availability (admin/scheduler view) within a date range. */
  watchOrgAvailability(orgId: string, fromDate: string, toDate: string, cb: (items: AvailabilityEntry[]) => void, max = 1000) {
    const col = collection(this.fs.db, `orgs/${orgId}/availability`);
    const q = query(col, where('date', '>=', fromDate), where('date', '<=', toDate), orderBy('date', 'asc'), limit(max));
    return onSnapshot(q, (snap) => {
      this.fs.run(() => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as AvailabilityEntry)));
    }, (error) => {
      console.warn('[InnovaShift] Org availability listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  async addEntry(entry: {
    orgId: string;
    userId: string;
    userDisplayName?: string | null;
    jobRole?: string | null;
    date: string;
    startTime: string;
    endTime: string;
    note?: string | null;
  }): Promise<void> {
    const col = collection(this.fs.db, `orgs/${entry.orgId}/availability`);
    await addDoc(col, {
      ...entry,
      note: entry.note || null,
      createdAt: serverTimestamp(),
    });
  }

  async removeEntry(orgId: string, entryId: string): Promise<void> {
    await deleteDoc(doc(this.fs.db, `orgs/${orgId}/availability/${entryId}`));
  }
}
