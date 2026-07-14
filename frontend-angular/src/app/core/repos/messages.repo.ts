import { Injectable } from '@angular/core';
import { collection, query, orderBy, limit, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';
import { OrgMessage } from '../../shared/models/message.model';

@Injectable({ providedIn: 'root' })
export class MessagesRepo {
  constructor(private fs: FirestoreClient) {}

  watchLatest(orgId: string, cb: (items: OrgMessage[]) => void, max = 30) {
    const col = collection(this.fs.db, `orgs/${orgId}/messages`);
    const q = query(col, orderBy('createdAt','desc'), limit(max));
    return onSnapshot(q, (snap) => this.fs.run(() => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as OrgMessage[])), (error: unknown) => {
      console.warn('[InnovaShift] Messages listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  async isRead(orgId: string, messageId: string, uid: string): Promise<boolean> {
    const ref = doc(this.fs.db, `orgs/${orgId}/messageReads/${messageId}_${uid}`);
    const snap = await getDoc(ref);
    return snap.exists();
  }
}
