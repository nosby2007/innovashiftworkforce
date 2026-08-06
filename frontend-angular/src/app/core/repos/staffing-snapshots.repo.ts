import { Injectable } from '@angular/core';
import { collection, query, orderBy, onSnapshot, where, Timestamp } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';

export interface StaffingSnapshot {
  id: string;
  dateKey: string;
  generatedAt: any;
  headcountScheduled: number;
  scheduledHours: number;
}

@Injectable({ providedIn: 'root' })
export class StaffingSnapshotsRepo {
  constructor(private fs: FirestoreClient) {}

  watchHistory(orgId: string, days: number, cb: (snapshots: StaffingSnapshot[]) => void) {
    const col = collection(this.fs.db, `orgs/${orgId}/staffingSnapshots`);
    const since = Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000);
    const q = query(col, where('generatedAt', '>=', since), orderBy('generatedAt', 'asc'));
    return onSnapshot(q, (snap) => {
      const snapshots = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) } as StaffingSnapshot));
      this.fs.run(() => cb(snapshots));
    }, (error: unknown) => {
      console.warn('[InnovaShift] Staffing snapshot history listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }
}
