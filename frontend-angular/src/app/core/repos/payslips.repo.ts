import { Injectable } from '@angular/core';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
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

  /** Newest-first pay history for one employee, optionally scoped to a calendar year. */
  watchPayslips(orgId: string, userId: string, cb: (items: Payslip[]) => void, year?: number, max = 100): () => void {
    const col = collection(this.fs.db, `orgs/${orgId}/payslips`);
    const constraints = [where('userId', '==', userId)];
    if (year) {
      constraints.push(where('payDate', '>=', `${year}-01-01`));
      constraints.push(where('payDate', '<=', `${year}-12-31`));
    }
    const q = query(col, ...constraints, orderBy('payDate', 'desc'), limit(max));
    return onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Payslip);
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
