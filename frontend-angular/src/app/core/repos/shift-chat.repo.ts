import { Injectable } from '@angular/core';
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';
import { ShiftChatMessage } from '../../shared/models/shift-chat.model';

@Injectable({ providedIn: 'root' })
export class ShiftChatRepo {
  constructor(private fs: FirestoreClient) {}

  watchMessages(orgId: string, shiftId: string, cb: (items: ShiftChatMessage[]) => void, max = 200) {
    const col = collection(this.fs.db, `orgs/${orgId}/shifts/${shiftId}/chatMessages`);
    const q = query(col, orderBy('createdAt', 'asc'), limit(max));
    return onSnapshot(q, (snap) => {
      this.fs.run(() => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ShiftChatMessage[]));
    }, (error: unknown) => {
      console.warn('[InnovaShift] Shift chat listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  async sendMessage(payload: {
    orgId: string;
    shiftId: string;
    senderUid: string;
    senderName: string;
    senderRole: string;
    message: string;
  }) {
    const col = collection(this.fs.db, `orgs/${payload.orgId}/shifts/${payload.shiftId}/chatMessages`);
    await addDoc(col, {
      orgId: payload.orgId,
      shiftId: payload.shiftId,
      senderUid: payload.senderUid,
      senderName: payload.senderName,
      senderRole: payload.senderRole,
      message: payload.message,
      createdAt: serverTimestamp(),
    });
  }
}
