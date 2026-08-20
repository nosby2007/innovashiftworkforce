import { Injectable } from '@angular/core';
import { collection, doc, query, orderBy, limit, onSnapshot, updateDoc, writeBatch, arrayUnion } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';

/** platformNotifications docs are purged 30 days after creation — see
 *  scheduled/enforceDataRetention.ts's purgeOldPlatformNotifications. */
export const PLATFORM_NOTIFICATION_RETENTION_DAYS = 30;

export type PlatformAlertSeverity = 'info' | 'warning';

export interface PlatformNotification {
  id: string;
  type: string;
  severity: PlatformAlertSeverity;
  title: string;
  body?: string;
  meta?: any;
  createdAt: any;
  readBy: string[];
}

/**
 * Cross-org, super-admin-only alert inbox — new demo/contact requests and
 * rate-limit abuse signals (see infra/platform-alerts.ts on the backend).
 * Unlike NotificationsRepo (one doc per recipient under an org), this is a
 * single shared inbox: every super admin reads the same docs, and "read"
 * state is tracked per-admin via the readBy array rather than N copies.
 */
@Injectable({ providedIn: 'root' })
export class PlatformNotificationsRepo {
  constructor(private fs: FirestoreClient) {}

  watchRecent(cb: (items: PlatformNotification[]) => void, max = 100) {
    const col = collection(this.fs.db, 'platformNotifications');
    const q = query(col, orderBy('createdAt', 'desc'), limit(max));
    return onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PlatformNotification[];
      this.fs.run(() => cb(items));
    }, (error: unknown) => {
      console.warn('[InnovaShift] Platform notifications listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  async markRead(notificationId: string, uid: string): Promise<void> {
    if (!notificationId || !uid) return;
    const ref = doc(this.fs.db, `platformNotifications/${notificationId}`);
    await updateDoc(ref, { readBy: arrayUnion(uid) });
  }

  async markAllRead(notificationIds: string[], uid: string): Promise<void> {
    if (!uid || notificationIds.length === 0) return;
    const batch = writeBatch(this.fs.db);
    for (const id of notificationIds.slice(0, 400)) {
      const ref = doc(this.fs.db, `platformNotifications/${id}`);
      batch.update(ref, { readBy: arrayUnion(uid) });
    }
    await batch.commit();
  }
}
