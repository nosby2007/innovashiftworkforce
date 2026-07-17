import { Shift } from '../models/shift.model';

const MIN_REST_HOURS = 8;

export type ShiftMatchLabel = 'great_fit' | 'role_mismatch' | 'conflict' | 'tight_turnaround' | null;

export interface ShiftMatch {
  score: number;
  label: ShiftMatchLabel;
  /** True when claiming this shift would overlap one the staff member is already assigned to. */
  hasConflict: boolean;
}

function toMs(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function shiftRoles(s: Shift): string[] {
  if (Array.isArray(s.requiredJobRoles) && s.requiredJobRoles.length) return s.requiredJobRoles;
  const single = String(s.requiredJobRole || s.roleRequired || '').trim();
  return single ? [single] : [];
}

/**
 * Ranks how well an open marketplace shift fits a given staff member, using
 * only data the staff member can already see about themselves: their own
 * job role and their own other assigned shifts (for conflict/rest-period
 * checks). Deliberately does NOT factor in distance (no staff home-location
 * field exists yet) or a reliability/no-show score (would need an explicit
 * product decision before silently deprioritizing anyone's visibility).
 */
export function scoreShiftMatch(shift: Shift, myOtherShifts: Shift[], myJobRole: string | null): ShiftMatch {
  const roles = shiftRoles(shift).map((r) => r.toLowerCase());
  const jobRole = (myJobRole || '').trim().toLowerCase();
  const roleMatches = roles.length === 0 || (jobRole !== '' && roles.includes(jobRole));

  const startMs = toMs(shift.startAt);
  const endMs = toMs(shift.endAt);

  let hasConflict = false;
  let minGapHours = Infinity;

  for (const other of myOtherShifts) {
    if (other.id === shift.id) continue;
    const status = String(other.status || '').toLowerCase();
    if (['cancelled', 'expired', 'no_show'].includes(status)) continue;

    const otherStart = toMs(other.startAt);
    const otherEnd = toMs(other.endAt);
    if (!otherStart || !otherEnd) continue;

    const overlaps = startMs < otherEnd && endMs > otherStart;
    if (overlaps) {
      hasConflict = true;
      continue;
    }
    const gapHours = startMs >= otherEnd
      ? (startMs - otherEnd) / 3_600_000
      : (otherStart - endMs) / 3_600_000;
    if (gapHours >= 0) minGapHours = Math.min(minGapHours, gapHours);
  }

  const tightTurnaround = !hasConflict && minGapHours < MIN_REST_HOURS;

  let score = 0;
  if (hasConflict) score -= 1000;
  else if (roleMatches) score += 40;
  else score -= 40;
  if (tightTurnaround) score -= 15;

  let label: ShiftMatchLabel = null;
  if (hasConflict) label = 'conflict';
  else if (!roleMatches) label = 'role_mismatch';
  else if (tightTurnaround) label = 'tight_turnaround';
  else if (roleMatches) label = 'great_fit';

  return { score, label, hasConflict };
}
