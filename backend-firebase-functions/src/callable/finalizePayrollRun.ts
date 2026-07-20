import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';

interface DeductionBreakdownInput {
  federalTax: number;
  stateTax: number;
  socialSecurity: number;
  medicare: number;
  retirement401k: number;
  benefitsTotal: number;
  benefitLines: Array<{ id: string; label: string; provider?: string | null; amount: number }>;
  totalDeductions: number;
  netPay: number;
  employer401kMatch: number;
  employerBenefitsTotal: number;
  employerBenefitLines: Array<{ id: string; label: string; provider?: string | null; amount: number }>;
  employerContributionsTotal: number;
}

interface EarningLineInput {
  description: string;
  hours: number;
  rate: number;
  amount: number;
  department?: string | null;
  location?: string | null;
}

interface PayrollRowInput {
  userId: string;
  employeeName: string;
  employeeNumber: string | null;
  totalHours: number;
  grossPay: number;
  deductionBreakdown: DeductionBreakdownInput;
  earnings: EarningLineInput[];
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function str(value: unknown): string {
  return String(value ?? '').trim();
}

function sanitizeRow(raw: any): PayrollRowInput {
  const userId = str(raw?.userId);
  if (!userId) throw new HttpsError('invalid-argument', 'Each row requires a userId.');
  const db: DeductionBreakdownInput = raw?.deductionBreakdown || {};
  return {
    userId,
    employeeName: str(raw?.employeeName) || 'Staff member',
    employeeNumber: raw?.employeeNumber != null ? str(raw.employeeNumber) || null : null,
    totalHours: num(raw?.totalHours),
    grossPay: num(raw?.grossPay),
    deductionBreakdown: {
      federalTax: num(db.federalTax),
      stateTax: num(db.stateTax),
      socialSecurity: num(db.socialSecurity),
      medicare: num(db.medicare),
      retirement401k: num(db.retirement401k),
      benefitsTotal: num(db.benefitsTotal),
      benefitLines: Array.isArray(db.benefitLines) ? db.benefitLines.map((b) => ({
        id: str(b.id), label: str(b.label), provider: b.provider ? str(b.provider) : null, amount: num(b.amount),
      })) : [],
      totalDeductions: num(db.totalDeductions),
      netPay: num(db.netPay),
      employer401kMatch: num(db.employer401kMatch),
      employerBenefitsTotal: num(db.employerBenefitsTotal),
      employerBenefitLines: Array.isArray(db.employerBenefitLines) ? db.employerBenefitLines.map((b) => ({
        id: str(b.id), label: str(b.label), provider: b.provider ? str(b.provider) : null, amount: num(b.amount),
      })) : [],
      employerContributionsTotal: num(db.employerContributionsTotal),
    },
    earnings: Array.isArray(raw?.earnings) ? raw.earnings.map((e: any) => ({
      description: str(e.description) || 'Earnings',
      hours: num(e.hours),
      rate: num(e.rate),
      amount: num(e.amount),
      department: e.department ? str(e.department) : null,
      location: e.location ? str(e.location) : null,
    })) : [],
  };
}

/**
 * Finalizes a payroll run: locks the period (orgs/{orgId}/payrollRuns) and
 * snapshots one immutable payslip per employee (orgs/{orgId}/payslips) —
 * the durable record "Pay History" reads from and the only thing a revoked
 * employee can still see. Hours/OT/holiday/deduction math is computed
 * client-side (same engine the live payroll preview already uses) and
 * passed in as `rows`; this callable is the trust boundary for *persisting*
 * that computation as a permanent record, not for recomputing it — see
 * docs/PAY_HISTORY.md.
 */
export const finalizePayrollRun = onCall(async (req) => {
  try {
    return await finalizePayrollRunImpl(req);
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', err?.message || 'Unexpected error finalizing payroll.');
  }
});

async function finalizePayrollRunImpl(req: any) {
  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminOrHr) {
    throw new HttpsError('permission-denied', 'Admin/HR privileges required.');
  }

  const orgId = ctx.orgId;
  const periodStart = str(req.data?.periodStart);
  const periodEnd = str(req.data?.periodEnd);
  const payDate = str(req.data?.payDate) || periodEnd;
  const currencyCode = str(req.data?.currencyCode) || 'USD';
  const rawRows: any[] = Array.isArray(req.data?.rows) ? req.data.rows : [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    throw new HttpsError('invalid-argument', 'periodStart/periodEnd must be YYYY-MM-DD.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) {
    throw new HttpsError('invalid-argument', 'payDate must be YYYY-MM-DD.');
  }
  if (rawRows.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one payroll row is required.');
  }

  const rows = rawRows.map(sanitizeRow);
  const runId = `${periodStart}_to_${periodEnd}`.replace(/[^0-9A-Za-z_-]/g, '_');
  const payDateYear = payDate.slice(0, 4);

  const admin = initFirebase();
  const db = admin.firestore();
  const orgRef = db.doc(`orgs/${orgId}`);
  const runRef = db.doc(`orgs/${orgId}/payrollRuns/${runId}`);
  const now = Timestamp.now();

  // YTD net pay for each employee = sum of their already-issued payslips
  // this calendar year, plus this new one. Bounded by how many payslips an
  // org issues per employee per year (a handful), so fetching every payslip
  // this employee has ever had and filtering the year in memory is cheap —
  // and avoids needing a composite index for equality(userId) + range(payDate),
  // which Firestore requires (see the timeEntries index for the same pattern).
  const ytdByUser = new Map<string, number>();
  await Promise.all(rows.map(async (row) => {
    const snap = await db.collection(`orgs/${orgId}/payslips`)
      .where('userId', '==', row.userId)
      .get();
    const priorYtd = snap.docs.reduce((sum, d) => {
      const data = d.data() as any;
      return String(data.payDate || '').startsWith(payDateYear) ? sum + num(data.netPay) : sum;
    }, 0);
    ytdByUser.set(row.userId, num(priorYtd + row.deductionBreakdown.netPay));
  }));

  // Direct-deposit-on-file drives the ACH/check split — read once per
  // employee (Admin SDK bypasses the private/bankInfo rule, which normally
  // restricts this to the employee themselves or admin/hr).
  const directDepositByUser = new Map<string, { bankName: string; accountType: string; last4: string } | null>();
  await Promise.all(rows.map(async (row) => {
    const snap = await db.doc(`orgs/${orgId}/users/${row.userId}/private/bankInfo`).get();
    const data = snap.exists ? (snap.data() as any) : null;
    if (!data?.accountNumber) {
      directDepositByUser.set(row.userId, null);
      return;
    }
    const digits = String(data.accountNumber).replace(/\D/g, '');
    directDepositByUser.set(row.userId, {
      bankName: str(data.bankName),
      accountType: str(data.accountType) || 'checking',
      last4: digits.slice(-4),
    });
  }));

  const totalHours = rows.reduce((sum, r) => sum + r.totalHours, 0);
  const gross = rows.reduce((sum, r) => sum + r.grossPay, 0);
  const deductions = rows.reduce((sum, r) => sum + r.deductionBreakdown.totalDeductions, 0);
  const net = rows.reduce((sum, r) => sum + r.deductionBreakdown.netPay, 0);

  const checkNumbers = await db.runTransaction(async (tx) => {
    const [runSnap, orgSnap] = await Promise.all([tx.get(runRef), tx.get(orgRef)]);
    if (runSnap.exists && (runSnap.data() as any)?.status === 'finalized') {
      throw new HttpsError('failed-precondition', 'This payroll period is already finalized.');
    }

    const nextCheckNumber = Number((orgSnap.data() as any)?.nextCheckNumber) || 10000000;
    const assigned = rows.map((_, i) => String(nextCheckNumber + i));

    tx.set(orgRef, { nextCheckNumber: nextCheckNumber + rows.length }, { merge: true });

    tx.set(runRef, {
      orgId, periodStart, periodEnd, payDate,
      status: 'finalized',
      currencyCode,
      employees: rows.length,
      totalHours: num(totalHours),
      gross: num(gross),
      deductions: num(deductions),
      net: num(net),
      exceptions: 0,
      finalizedAt: now,
      finalizedBy: ctx.uid,
      updatedAt: now,
    }, { merge: true });

    rows.forEach((row, i) => {
      const directDeposit = directDepositByUser.get(row.userId) ?? null;
      const payslipRef = db.doc(`orgs/${orgId}/payslips/${runId}_${row.userId}`);
      tx.set(payslipRef, {
        orgId, userId: row.userId, runId,
        periodStart, periodEnd, payDate,
        checkNumber: assigned[i],
        currencyCode,
        employeeNumber: row.employeeNumber,
        employeeName: row.employeeName,
        totalHours: row.totalHours,
        grossPay: row.grossPay,
        totalDeductions: row.deductionBreakdown.totalDeductions,
        netPay: row.deductionBreakdown.netPay,
        achAmount: directDeposit ? row.deductionBreakdown.netPay : 0,
        checkAmount: directDeposit ? 0 : row.deductionBreakdown.netPay,
        earnings: row.earnings,
        deductionBreakdown: row.deductionBreakdown,
        directDeposit,
        ytdNetPay: ytdByUser.get(row.userId) ?? row.deductionBreakdown.netPay,
        createdAt: now,
        createdBy: ctx.uid,
      });
    });

    return assigned;
  });

  await writeAudit(orgId, {
    action: 'FINALIZE_PAYROLL',
    actorUserId: ctx.uid,
    entityType: 'payrollRun',
    entityId: runId,
    employees: rows.length,
    gross: num(gross),
    net: num(net),
  });

  return { ok: true, runId, employees: rows.length, checkNumbers };
}
