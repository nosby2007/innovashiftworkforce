export type ExceptionStatus = 'none'|'pending'|'approved'|'rejected';

export interface TimeEntry {
  id: string;
  orgId: string;
  userId: string;
  shiftId: string;
  method: 'qr'|'manual'|'gps';
  checkInAt: any;
  checkOutAt: any | null;
  locationVerified?: boolean;
  verifiedSiteId?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  geoAccuracyM?: number | null;
  onBreak?: boolean;
  breakStartedAt?: any | null;
  totalBreakMs?: number;
  breakPolicyLastAppliedAt?: any | null;
  breakPolicyHistory?: Array<{
    type: 'checkout_break_policy' | 'correction_break_policy';
    at: any;
    actorUserId: string;
    thresholdHours: number;
    minimumBreakMinutes: number;
    openBreakClosedMs: number;
    autoBreakDeductionMs: number;
    totalBreakMs: number;
    note?: string | null;
  }>;
  exceptionStatus: ExceptionStatus;
  correctionReason?: string | null;
  correctionRequestedBy?: string | null;
  correctionRequestedAt?: any | null;
  requestedCheckInAt?: any | null;
  requestedCheckOutAt?: any | null;
  correctionLastDecision?: {
    decision: 'approved' | 'rejected';
    decidedBy: string;
    decidedAt: any;
    decisionReason?: string | null;
    previousCheckInAt?: any | null;
    previousCheckOutAt?: any | null;
    newCheckInAt?: any | null;
    newCheckOutAt?: any | null;
  } | null;
  correctionHistory?: Array<{
    type: 'request' | 'decision';
    at: any;
    actorUserId: string;
    decision?: 'approved' | 'rejected';
    reason?: string | null;
    previousCheckInAt?: any | null;
    previousCheckOutAt?: any | null;
    requestedCheckInAt?: any | null;
    requestedCheckOutAt?: any | null;
    newCheckInAt?: any | null;
    newCheckOutAt?: any | null;
  }>;
  approvedBy?: string | null;
  approvedAt?: any | null;
  createdAt: any;
}
