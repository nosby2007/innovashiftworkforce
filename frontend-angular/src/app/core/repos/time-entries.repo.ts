import { Injectable } from '@angular/core';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';
import { TimeEntry } from '../../shared/models/time-entry.model';

@Injectable({ providedIn: 'root' })
export class TimeEntriesRepo {
  constructor(private fs: FirestoreClient) {}

  watchMyEntries(orgId: string, uid: string, cb: (items: TimeEntry[]) => void, max = 50) {
    const col = collection(this.fs.db, `orgs/${orgId}/timeEntries`);
    const q = query(col, where('userId','==',uid), orderBy('createdAt','desc'), limit(max));
    return onSnapshot(q, (snap) => this.fs.run(() => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as TimeEntry[])), (error: unknown) => {
      console.warn('[InnovaShift] My time entries listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  watchPendingApprovals(orgId: string, cb: (items: TimeEntry[]) => void, max = 100) {
    const col = collection(this.fs.db, `orgs/${orgId}/timeEntries`);
    const q = query(col, where('exceptionStatus','==','pending'), orderBy('createdAt','desc'), limit(max));
    return onSnapshot(q, (snap) => this.fs.run(() => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as TimeEntry[])), (error: unknown) => {
      console.warn('[InnovaShift] Pending approvals listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

watchEntriesRange(orgId: string, uid: string, startAt: any, endAt: any, cb: (items: TimeEntry[]) => void, max = 2000) {
  const col = collection(this.fs.db, `orgs/${orgId}/timeEntries`);
  const q = query(
    col,
    where('userId','==',uid),
    where('checkInAt','>=', startAt),
    where('checkInAt','<=', endAt),
    orderBy('checkInAt','asc'),
    limit(max)
  );
  return onSnapshot(q, (snap) => this.fs.run(() => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as TimeEntry[])), (error: unknown) => {
    console.warn('[InnovaShift] Time entries range listener failed.', error);
    this.fs.run(() => cb([]));
  });
}

watchOrgEntriesRange(orgId: string, startAt: any, endAt: any, cb: (items: TimeEntry[]) => void, max = 5000) {
  const col = collection(this.fs.db, `orgs/${orgId}/timeEntries`);
  const q = query(
    col,
    where('checkInAt','>=', startAt),
    where('checkInAt','<=', endAt),
    orderBy('checkInAt','asc'),
    limit(max)
  );
  return onSnapshot(q, (snap) => this.fs.run(() => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as TimeEntry[])), (error: unknown) => {
    console.warn('[InnovaShift] Org time entries range listener failed.', error);
    this.fs.run(() => cb([]));
  });
}

}
