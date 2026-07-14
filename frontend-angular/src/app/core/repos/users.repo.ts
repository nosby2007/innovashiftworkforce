import { Injectable } from '@angular/core';
import { collection, doc, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';

export interface OrgUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  jobRole?: string | null;      // RN, CNA, ...
  accessRole?: string | null;   // staff, manager, scheduler, admin, hr
  active?: boolean;
}

@Injectable({ providedIn: 'root' })
export class UsersRepo {
  constructor(private fs: FirestoreClient) {}

  watchOrgUsers(orgId: string, cb: (items: OrgUser[]) => void, max = 500) {
    const col = collection(this.fs.db, `orgs/${orgId}/users`);
    const q = query(col, orderBy('displayName','asc'), limit(max));
    return onSnapshot(q, (snap) => {
      this.fs.run(() => cb(snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) })) as OrgUser[]));
    }, (error: unknown) => {
      console.warn('[InnovaShift] Org users listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  watchOrgUser(orgId: string, uid: string, cb: (item: OrgUser | null) => void) {
    const ref = doc(this.fs.db, `orgs/${orgId}/users/${uid}`);
    return onSnapshot(ref, (snap) => {
      this.fs.run(() => cb(snap.exists() ? ({ uid: snap.id, ...(snap.data() as any) } as OrgUser) : null));
    }, (error: unknown) => {
      console.warn('[InnovaShift] Org user listener failed.', error);
      this.fs.run(() => cb(null));
    });
  }
}
