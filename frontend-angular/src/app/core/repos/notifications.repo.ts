import { Injectable } from '@angular/core';
import { collection, doc, query, orderBy, limit, onSnapshot, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';

export interface UserNotification {
  id: string;
  orgId: string;
  uid: string;
  type: string;
  title: string;
  body?: string;
  read: boolean;
  createdAt: any;
  meta?: any;
}

@Injectable({ providedIn: 'root' })
export class NotificationsRepo {
  constructor(private fs: FirestoreClient) {}

  watchMy(orgId: string, uid: string, cb: (items: UserNotification[]) => void, max = 50) {
    const col = collection(this.fs.db, `orgs/${orgId}/userNotifications/${uid}/items`);
    const q = query(col, orderBy('createdAt','desc'), limit(max));
    return onSnapshot(q, (snap) => {
      this.fs.run(() => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as UserNotification[]));
    }, (error: unknown) => {
      console.warn('[InnovaShift] Notifications listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  async markRead(orgId: string, uid: string, notificationId: string): Promise<void> {
    if (!orgId || !uid || !notificationId) return;
    const ref = doc(this.fs.db, `orgs/${orgId}/userNotifications/${uid}/items/${notificationId}`);
    await updateDoc(ref, { read: true, readAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }

  async markAllRead(orgId: string, uid: string, notificationIds: string[]): Promise<void> {
    if (!orgId || !uid || notificationIds.length === 0) return;
    const batch = writeBatch(this.fs.db);
    for (const id of notificationIds.slice(0, 400)) {
      const ref = doc(this.fs.db, `orgs/${orgId}/userNotifications/${uid}/items/${id}`);
      batch.update(ref, { read: true, readAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    await batch.commit();
  }
}
