import { Injectable } from '@angular/core';
import { doc, onSnapshot } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';

export interface OrgMetricsSummary {
  openCount: number;
  assignedCount: number;
  upcoming7dOpenCount: number;
  updatedAt?: any;
}

@Injectable({ providedIn: 'root' })
export class MetricsRepo {
  constructor(private fs: FirestoreClient) {}

  watchSummary(orgId: string, cb: (m: OrgMetricsSummary | null) => void) {
    const ref = doc(this.fs.db, `orgs/${orgId}/metrics/summary`);
    return onSnapshot(ref, (snap) => {
      this.fs.run(() => cb(snap.exists() ? (snap.data() as any as OrgMetricsSummary) : null));
    }, (error: unknown) => {
      console.warn('[InnovaShift] Metrics listener failed.', error);
      this.fs.run(() => cb(null));
    });
  }
}
