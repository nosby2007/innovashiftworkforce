export type ShiftStatus =
  | 'draft'
  | 'open'
  | 'published'
  | 'assigned'    // legacy — superseded by 'claimed'
  | 'claimed'
  | 'in_progress'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'no_show';

export interface ShiftAuditEntry {
  action: string;
  actorUserId: string;
  actorName?: string;
  at: any; // Firestore Timestamp
  note?: string;
}

export interface Shift {
  id: string;
  orgId: string;
  facilityId?: string | null;
  departmentId?: string | null;
  title: string;
  description?: string | null;
  locationId?: string | null;
  locationName: string;
  timezone?: string | null;
  startAt: any; // Firestore Timestamp
  endAt: any;   // Firestore Timestamp
  status: ShiftStatus;
  marketplaceVisible?: boolean;
  requiredJobRole?: string;
  requiredJobRoles?: string[];
  roleRequired?: string | null;
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  payRate?: number | null;
  notes?: string | null;
  // Lifecycle timestamps
  claimedAt?: any | null;
  clockInAt?: any | null;
  clockOutAt?: any | null;
  expiredAt?: any | null;
  cancelledAt?: any | null;
  // Audit
  auditLog?: ShiftAuditEntry[];
  createdBy?: string | null;
  createdAt?: any;
  updatedAt?: any;
}
