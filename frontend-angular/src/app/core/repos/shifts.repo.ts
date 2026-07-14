import { Injectable } from '@angular/core';
import { collection, query, where, orderBy, limit, onSnapshot, Timestamp, doc, getDoc } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';
import { Shift } from '../../shared/models/shift.model';
import { getCurrentWeekRange } from '../../shared/utils/shift-lifecycle.utils';

@Injectable({ providedIn: 'root' })
export class ShiftsRepo {
  constructor(private fs: FirestoreClient) {}

  private isRealShift(s: Shift): boolean {
    return !String(s.id || '').startsWith('seed-');
  }

  /**
   * Marketplace: open/published shifts in the current calendar week, not yet overdue.
   * Excludes expired, claimed, or hidden shifts.
   */
  watchMarketplace(orgId: string, cb: (items: Shift[]) => void, max = 100, onError?: (error: unknown) => void): () => void {
    const { start, end } = getCurrentWeekRange();
    const weekStart = Timestamp.fromDate(start);
    const weekEnd = Timestamp.fromDate(end);
    const col = collection(this.fs.db, `orgs/${orgId}/shifts`);
    const q = query(
      col,
      where('status', 'in', ['open', 'published']),
      where('startAt', '>=', weekStart),
      where('startAt', '<=', weekEnd),
      orderBy('startAt', 'asc'),
      limit(max)
    );
    return onSnapshot(q, (snap) => {
      const nowMs = Date.now();
      const items = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }) as Shift)
        // client-side: drop any where assignedUserId exists, marketplaceVisible===false, or endAt already past
        .filter(s => {
          if (!this.isRealShift(s)) return false;
          if (s.assignedUserId) return false;
          if (s.marketplaceVisible === false) return false;
          const endMs = typeof s.endAt?.toMillis === 'function' ? s.endAt.toMillis() : Number(s.endAt || 0);
          if (endMs > 0 && endMs < nowMs) return false;
          return true;
        });
      this.fs.run(() => cb(items));
    }, (error: unknown) => {
      console.warn('[InnovaShift] Shift marketplace listener failed.', error);
      onError?.(error);
      this.fs.run(() => cb([]));
    });
  }

  /** @deprecated Use watchMarketplace — kept for legacy callers */
  watchOpenShifts(orgId: string, cb: (items: Shift[]) => void, max = 50): () => void {
    return this.watchMarketplace(orgId, cb, max);
  }

  /**
   * Employee "My Upcoming Shifts": claimed/assigned shifts for the current user,
   * with startAt in the future (or today), not yet in_progress or completed.
   */
  watchMySchedule(orgId: string, uid: string, cb: (items: Shift[]) => void, max = 100): () => void {
    const nowMs = Date.now();
    const horizon = Timestamp.fromMillis(nowMs + 45 * 24 * 60 * 60 * 1000);
    const col = collection(this.fs.db, `orgs/${orgId}/shifts`);
    const q = query(
      col,
      where('assignedUserId', '==', uid),
      where('startAt', '<=', horizon),
      orderBy('startAt', 'asc'),
      limit(max)
    );
    return onSnapshot(q, (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }) as Shift)
        .filter((s) => {
          if (!this.isRealShift(s)) return false;
          const status = String(s.status || '').toLowerCase();
          if (['completed', 'cancelled', 'expired', 'no_show'].includes(status)) return false;
          const endMs = typeof s.endAt?.toMillis === 'function' ? s.endAt.toMillis() : Number(s.endAt || 0);
          return endMs > nowMs;
        });
      this.fs.run(() => cb(items));
    }, (error: unknown) => {
      console.warn('[InnovaShift] My schedule listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  /**
   * Employee "Current Shift": the single in_progress shift for the user.
   */
  watchCurrentShift(orgId: string, uid: string, cb: (shift: Shift | null) => void): () => void {
    const col = collection(this.fs.db, `orgs/${orgId}/shifts`);
    const q = query(
      col,
      where('assignedUserId', '==', uid),
      where('status', '==', 'in_progress'),
      limit(1)
    );
    return onSnapshot(q, (snap) => {
      if (snap.empty) { this.fs.run(() => cb(null)); return; }
      const d = snap.docs[0];
      const shift = { id: d.id, ...(d.data() as any) } as Shift;
      this.fs.run(() => cb(this.isRealShift(shift) ? shift : null));
    }, (error: unknown) => {
      console.warn('[InnovaShift] Current shift listener failed.', error);
      this.fs.run(() => cb(null));
    });
  }

  /**
   * Employee "Shift History": completed shifts for the user.
   */
  watchMyHistory(orgId: string, uid: string, cb: (items: Shift[]) => void, max = 50): () => void {
    const col = collection(this.fs.db, `orgs/${orgId}/shifts`);
    const q = query(
      col,
      where('assignedUserId', '==', uid),
      where('status', '==', 'completed'),
      orderBy('clockOutAt', 'desc'),
      limit(max)
    );
    return onSnapshot(q, (snap) => this.fs.run(() => cb((snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Shift[]).filter((s) => this.isRealShift(s)))), (error: unknown) => {
      console.warn('[InnovaShift] Shift history listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  /**
   * Manager view: shifts by status within a date range.
   */
  watchByStatus(
    orgId: string,
    status: string | string[],
    startAt: Timestamp,
    endAt: Timestamp,
    cb: (items: Shift[]) => void,
    max = 200
  ): () => void {
    const col = collection(this.fs.db, `orgs/${orgId}/shifts`);
    const statusList = Array.isArray(status) ? status : [status];
    const q = query(
      col,
      where('status', 'in', statusList),
      where('startAt', '>=', startAt),
      where('startAt', '<=', endAt),
      orderBy('startAt', 'asc'),
      limit(max)
    );
    return onSnapshot(q, (snap) => this.fs.run(() => cb((snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Shift[]).filter((s) => this.isRealShift(s)))), (error: unknown) => {
      console.warn('[InnovaShift] Status shift listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  /**
   * Manager view: ALL shifts in a date range regardless of status.
   */
  watchAssignedShifts(orgId: string, uid: string, cb: (items: Shift[]) => void, max = 100): () => void {
    const col = collection(this.fs.db, `orgs/${orgId}/shifts`);
    const q = query(col, where('assignedUserId', '==', uid), orderBy('startAt', 'asc'), limit(max));
    return onSnapshot(q, (snap) => this.fs.run(() => cb((snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Shift[]).filter((s) => this.isRealShift(s)))), (error: unknown) => {
      console.warn('[InnovaShift] Assigned shifts listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  watchLookahead(orgId: string, uid: string, cb: (items: Shift[]) => void, days = 14): () => void {
    const nowMs = Date.now();
    const end = Timestamp.fromMillis(nowMs + days * 24 * 60 * 60 * 1000);
    const col = collection(this.fs.db, `orgs/${orgId}/shifts`);
    const q = query(
      col,
      where('assignedUserId', '==', uid),
      where('startAt', '<=', end),
      orderBy('startAt', 'asc'),
      limit(50)
    );
    return onSnapshot(q, (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }) as Shift)
        .filter((s) => {
          if (!this.isRealShift(s)) return false;
          const status = String(s.status || '').toLowerCase();
          if (['completed', 'cancelled', 'expired', 'no_show'].includes(status)) return false;
          const endMs = typeof s.endAt?.toMillis === 'function' ? s.endAt.toMillis() : Number(s.endAt || 0);
          return endMs > nowMs;
        });
      this.fs.run(() => cb(items));
    }, (error: unknown) => {
      console.warn('[InnovaShift] Lookahead listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  watchOrgRange(orgId: string, startAt: any, endAt: any, cb: (items: Shift[]) => void, max = 500): () => void {
    const col = collection(this.fs.db, `orgs/${orgId}/shifts`);
    const q = query(
      col,
      where('startAt', '>=', startAt),
      where('startAt', '<=', endAt),
      orderBy('startAt', 'asc'),
      limit(max)
    );
    return onSnapshot(q, (snap) => this.fs.run(() => cb((snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Shift[]).filter((s) => this.isRealShift(s)))), (error: unknown) => {
      console.warn('[InnovaShift] Org range shift listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  async getManyByIds(orgId: string, ids: string[]): Promise<Record<string, Shift>> {
    const out: Record<string, Shift> = {};
    for (const id of ids) {
      const ref = doc(this.fs.db, `orgs/${orgId}/shifts/${id}`);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const shift = { id: snap.id, ...(snap.data() as any) } as Shift;
        if (this.isRealShift(shift)) out[id] = shift;
      }
    }
    return out;
  }
}
