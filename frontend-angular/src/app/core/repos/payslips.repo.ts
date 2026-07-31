import { Injectable } from '@angular/core';
import { collection, doc, getDoc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';
import { DeductionBreakdown } from '../../shared/utils/payroll.util';

export interface PayslipEarningLine {
  description: string;
  hours: number;
  rate: number;
  amount: number;
  department: string | null;
  location: string | null;
}

export interface PayslipDirectDeposit {
  bankName: string;
  accountType: string;
  last4: string;
}

export interface Payslip {
  id: string;
  orgId: string;
  userId: string;
  runId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  checkNumber: string;
  currencyCode: string;
  employeeNumber: string | null;
  employeeName: string;
  totalHours: number;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  achAmount: number;
  checkAmount: number;
  earnings: PayslipEarningLine[];
  deductionBreakdown: DeductionBreakdown;
  directDeposit: PayslipDirectDeposit | null;
  ytdNetPay: number;
  createdAt?: any;
}

@Injectable({ providedIn: 'root' })
export class PayslipsRepo {
  constructor(private fs: FirestoreClient) {}

  /**
   * Newest-first pay history for one employee, optionally scoped to a
   * calendar year. Only filters by userId server-side (a single-field
   * equality query needs no composite index) — sorting and the year filter
   * both happen here in memory, since one employee's lifetime payslip count
   * is small and this sidesteps waiting on a composite index to build for
   * equality(userId) + range(payDate), which is otherwise required.
   */
  watchPayslips(orgId: string, userId: string, cb: (items: Payslip[]) => void, year?: number, max = 200): () => void {
    const col = collection(this.fs.db, `orgs/${orgId}/payslips`);
    const q = query(col, where('userId', '==', userId), limit(max));
    return onSnapshot(q, (snap) => {
      let items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Payslip);
      if (year) items = items.filter((p) => p.payDate.startsWith(String(year)));
      items.sort((a, b) => b.payDate.localeCompare(a.payDate));
      this.fs.run(() => cb(items));
    }, (error) => {
      console.warn('[InnovaShift] Payslips listener failed.', error);
      this.fs.run(() => cb([]));
    });
  }

  async getPayslip(orgId: string, payslipId: string): Promise<Payslip | null> {
    const snap = await getDoc(doc(this.fs.db, `orgs/${orgId}/payslips/${payslipId}`));
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as Payslip) : null;
  }
}
