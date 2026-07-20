import { Injectable } from '@angular/core';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';

export interface PayrollRunSummary {
  id: string;
  orgId: string;
  periodStart: string; // 'YYYY-MM-DD'
  periodEnd: string;
  payDate: string;
  status: 'finalized' | 'draft';
  finalizedAt?: any;
}

@Injectable({ providedIn: 'root' })
export class PayrollRunsRepo {
  constructor(private fs: FirestoreClient) {}

  /**
   * All finalized payroll runs, newest-first by periodEnd. Single
   * equality-only query — no composite index required. Sorting happens in
   * JS rather than via orderBy(), following the convention already
   * established for payslips.repo.ts and the finalizePayrollRun.ts YTD
   * lookup: never combine an equality where() with an orderBy()/range() on
   * a different field, since that needs a composite index this app avoids
   * depending on.
   */
  watchFinalizedRuns(orgId: string, cb: (runs: PayrollRunSummary[]) => void, max = 500): () => void {
    const col = collection(this.fs.db, `orgs/${orgId}/payrollRuns`);
    const q = query(col, where('status', '==', 'finalized'), limit(max));
    return onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as PayrollRunSummary);
      items.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
      this.fs.run(() => cb(items));
    }, (error) => {
      console.warn('[InnovaShift] Finalized payroll runs listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }
}
