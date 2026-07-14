import { Injectable } from '@angular/core';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';

export interface AuditLog {
  id: string;
  action: string;
  actorUid: string;
  createdAt: any;
  target?: any;
  details?: any;
}

@Injectable({ providedIn: 'root' })
export class AuditRepo {
  constructor(private fs: FirestoreClient) {}

  watchRecent(orgId: string, cb: (items: AuditLog[]) => void, max = 200) {
    const col = collection(this.fs.db, `orgs/${orgId}/auditLogs`);
    const q = query(col, orderBy('createdAt','desc'), limit(max));
    return onSnapshot(q, (snap) => {
      this.fs.run(() => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as AuditLog[]));
    }, (error: unknown) => {
      console.warn('[InnovaShift] Audit log listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }
}
