import { Shift } from '../models/shift.model';

/** Returns the Monday and Sunday (23:59:59.999) of the week containing `date`. */
export function getCurrentWeekRange(date = new Date()): { start: Date; end: Date } {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

/** Returns true if the shift's end time has passed (with optional grace period in minutes). */
export function isShiftOverdue(shift: Shift, now: Date = new Date(), gracePeriodMinutes = 0): boolean {
  if (!shift.endAt) return false;
  const endMs = typeof shift.endAt.toMillis === 'function'
    ? shift.endAt.toMillis()
    : Number(shift.endAt);
  if (!Number.isFinite(endMs) || endMs === 0) return false;
  return endMs + gracePeriodMinutes * 60_000 < now.getTime();
}

/** Returns true when a shift should appear in the employee marketplace. */
export function canDisplayInMarketplace(shift: Shift, now: Date = new Date()): boolean {
  // Admin/manager roles always see everything — filter at the query level for role variants.
  if (!['open', 'published'].includes(shift.status)) return false;
  if (shift.assignedUserId) return false;
  if (shift.marketplaceVisible === false) return false;
  if (isShiftOverdue(shift, now)) return false;
  return true;
}

/** Returns true when a given user can claim a shift. */
export function canClaimShift(shift: Shift, uid: string | null, now: Date = new Date()): boolean {
  if (!uid) return false;
  if (!['open', 'published'].includes(shift.status)) return false;
  if (shift.assignedUserId) return false;
  if (isShiftOverdue(shift, now)) return false;
  return true;
}

/** Returns true when a user can clock in for a shift. */
export function canClockIn(
  shift: Shift,
  uid: string | null,
  now: Date = new Date(),
  windowMinutesBefore = 30
): boolean {
  if (!uid) return false;
  if (shift.assignedUserId !== uid) return false;
  if (!['claimed', 'assigned', 'open', 'published'].includes(shift.status)) return false;
  if (!shift.startAt) return false;
  const startMs = typeof shift.startAt.toMillis === 'function'
    ? shift.startAt.toMillis()
    : Number(shift.startAt);
  if (!Number.isFinite(startMs)) return false;
  const earliest = startMs - windowMinutesBefore * 60_000;
  const endMs = typeof shift.endAt?.toMillis === 'function'
    ? shift.endAt.toMillis()
    : Number(shift.endAt || 0);
  // Can clock in from (startAt - window) until endAt
  return now.getTime() >= earliest && (endMs === 0 || now.getTime() < endMs);
}

/** Formats a Firestore Timestamp or ms number as a local time string. */
export function fmtShiftTime(ts: any, locale = 'en-US'): string {
  if (!ts) return '';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** Formats a Firestore Timestamp or ms number as a short date string. */
export function fmtShiftDate(ts: any, locale = 'en-US'): string {
  if (!ts) return '';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Returns hours between startAt and endAt. */
export function shiftHours(shift: Shift): number {
  if (!shift.startAt || !shift.endAt) return 0;
  const s = typeof shift.startAt.toMillis === 'function' ? shift.startAt.toMillis() : Number(shift.startAt);
  const e = typeof shift.endAt.toMillis === 'function' ? shift.endAt.toMillis() : Number(shift.endAt);
  return Math.max(0, Math.round(((e - s) / 3_600_000) * 100) / 100);
}

/** Human-readable label for a shift status. */
export function shiftStatusLabel(status: string): string {
  const MAP: Record<string, string> = {
    draft: 'Draft',
    open: 'Open',
    published: 'Published',
    assigned: 'Claimed',   // legacy mapping
    claimed: 'Claimed',
    in_progress: 'In Progress',
    completed: 'Completed',
    expired: 'Expired',
    cancelled: 'Cancelled',
    no_show: 'No Show',
  };
  return MAP[status] ?? status;
}

/** CSS badge class for a shift status. */
export function shiftStatusBadge(status: string): string {
  const MAP: Record<string, string> = {
    draft: 'vs-badge--muted',
    open: 'vs-badge--open',
    published: 'vs-badge--primary',
    assigned: 'vs-badge--assigned',
    claimed: 'vs-badge--assigned',
    in_progress: 'vs-badge--warning',
    completed: 'vs-badge--success',
    expired: 'vs-badge--error',
    cancelled: 'vs-badge--error',
    no_show: 'vs-badge--error',
  };
  return MAP[status] ?? '';
}
