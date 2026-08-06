import { toMillis } from './dates';

/** Shifts that can no longer conflict with anything — excluded from overlap
 *  and the day-hour cap. Matches the denylist previously duplicated in
 *  assignShift.ts, claim-shift.core.ts and shiftSwap.ts. */
export const TERMINAL_SHIFT_STATUSES = new Set(['cancelled', 'completed', 'expired', 'no_show']);

/** Shifts that represent real scheduled/worked time and count toward
 *  fatigue math (rest gaps, consecutive-day streaks, weekly hours).
 *  Deliberately includes 'completed' (unlike TERMINAL_SHIFT_STATUSES) —
 *  a finished shift can't overlap anything, but it's still real worked
 *  time that contributes to rest debt and weekly totals. */
export const ASSIGNED_STATUSES = new Set(['assigned', 'claimed', 'in_progress', 'completed']);

export const MAX_ASSIGNED_HOURS_PER_DAY = 16;

export interface FatigueRules {
  minRestHours: number;
  maxConsecutiveDays: number;
  maxWeeklyHours: number;
}

export const DEFAULT_FATIGUE_RULES: FatigueRules = {
  minRestHours: 8,
  maxConsecutiveDays: 6,
  maxWeeklyHours: 60,
};

export function resolveFatigueRules(orgData: Record<string, unknown> | undefined | null): FatigueRules {
  const pick = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    minRestHours: pick(orgData?.['minRestHours'], DEFAULT_FATIGUE_RULES.minRestHours),
    maxConsecutiveDays: pick(orgData?.['maxConsecutiveDays'], DEFAULT_FATIGUE_RULES.maxConsecutiveDays),
    maxWeeklyHours: pick(orgData?.['maxWeeklyScheduledHours'], DEFAULT_FATIGUE_RULES.maxWeeklyHours),
  };
}

/** Canonical overlap check — the zero/NaN-guarded version previously only
 *  used in shiftSwap.ts. This is an intentional, low-risk tightening for
 *  assignShift.ts/claim-shift.core.ts, whose prior unguarded checks could
 *  treat two shifts with missing/zero timestamps as overlapping. */
export function overlaps(aStart: any, aEnd: any, bStart: any, bEnd: any): boolean {
  const as = toMillis(aStart);
  const ae = toMillis(aEnd);
  const bs = toMillis(bStart);
  const be = toMillis(bEnd);
  return as > 0 && ae > as && bs > 0 && be > bs && as < be && bs < ae;
}

export function durationHours(startMs: number, endMs: number): number {
  return startMs > 0 && endMs > startMs ? (endMs - startMs) / 3_600_000 : 0;
}

export function utcDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return utcDayKey(dt.getTime());
}

/** Monday 00:00:00.000 UTC of the ISO week containing `ms`. Weekly hours are
 *  evaluated per fixed Mon-Sun UTC week (no per-org "week start"/timezone
 *  concept exists for scheduling today). */
export function isoWeekStartMs(ms: number): number {
  const d = new Date(ms);
  const utcDay = d.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (utcDay + 6) % 7;
  const dayStartMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return dayStartMs - daysSinceMonday * 86_400_000;
}

/** Query window a caller needs to fetch `otherShifts` from so overlap, the
 *  day-hour cap, min rest, max consecutive days and max weekly hours can all
 *  be evaluated from a single query. Symmetric around the target shift's UTC
 *  day; spans at least a full week (for the weekly-hours check) and at least
 *  `maxConsecutiveDays` in each direction (for the streak check), capped at
 *  31 days so a pathological org config can't blow up query cost — streaks
 *  longer than 31 days will not be detected. */
export function computeFatigueWindowMs(targetShiftStartMs: number, rules: FatigueRules): { windowStartMs: number; windowEndMs: number } {
  const spanDays = Math.min(Math.max(rules.maxConsecutiveDays, 7), 31);
  const targetDay = utcDayKey(targetShiftStartMs);
  const [y, m, d] = targetDay.split('-').map(Number);
  const dayStartMs = Date.UTC(y, m - 1, d);
  return {
    windowStartMs: dayStartMs - spanDays * 86_400_000,
    windowEndMs: dayStartMs + (spanDays + 1) * 86_400_000,
  };
}

export interface ShiftSlice {
  id: string;
  startAtMs: number;
  endAtMs: number;
  status: string;
}

export interface EligibilityCheckInput {
  /** The shift being assigned/claimed/swapped into. */
  targetShift: { id: string; startAtMs: number; endAtMs: number };
  /** The assignee's OTHER shifts, pre-fetched by the caller within a window
   *  wide enough to cover the fatigue lookback — see computeFatigueWindowMs.
   *  Shifts outside that window are silently not evaluated. */
  otherShifts: ShiftSlice[];
  /** Shift IDs to fully exclude (e.g. shiftSwap's traded-shift IDs, so the
   *  two shifts being swapped don't conflict-check against each other). */
  excludedShiftIds?: Set<string>;
  rules: FatigueRules;
  /** How to refer to the person in the returned message — "You", "This
   *  staff member", or an actual display name; each call site supplies
   *  whatever matches its existing message tone. */
  personLabel: string;
}

export type EligibilityViolationCode =
  | 'overlap'
  | 'day_hour_cap'
  | 'insufficient_rest'
  | 'max_consecutive_days'
  | 'max_weekly_hours';

export interface EligibilityViolation {
  code: EligibilityViolationCode;
  message: string;
}

/** Pure, synchronous eligibility check — does no I/O so it can run inside a
 *  Firestore transaction. Runs overlap, day-hour cap, min-rest,
 *  max-consecutive-days and max-weekly-hours checks in that order, returning
 *  the first violation found (or null when the shift is eligible). */
export function checkShiftEligibility(input: EligibilityCheckInput): EligibilityViolation | null {
  const { targetShift, rules, personLabel } = input;
  const excluded = input.excludedShiftIds ?? new Set<string>();
  const isYou = personLabel === 'You';
  const targetDay = utcDayKey(targetShift.startAtMs);

  const isSelf = (s: ShiftSlice) => s.id === targetShift.id || excluded.has(s.id);
  const validSlice = (s: ShiftSlice) => s.startAtMs > 0 && s.endAtMs > s.startAtMs;

  // Pass 1 — overlap + day-hour cap (TERMINAL_SHIFT_STATUSES denylist).
  const nonTerminal = input.otherShifts.filter((s) => !isSelf(s) && validSlice(s) && !TERMINAL_SHIFT_STATUSES.has(s.status));

  let targetDayHours = durationHours(targetShift.startAtMs, targetShift.endAtMs);
  for (const other of nonTerminal) {
    if (overlaps(targetShift.startAtMs, targetShift.endAtMs, other.startAtMs, other.endAtMs)) {
      return { code: 'overlap', message: `${personLabel} already ${isYou ? 'have' : 'has'} an overlapping shift.` };
    }
    if (utcDayKey(other.startAtMs) === targetDay) {
      targetDayHours += durationHours(other.startAtMs, other.endAtMs);
    }
  }
  if (targetDayHours > MAX_ASSIGNED_HOURS_PER_DAY) {
    return {
      code: 'day_hour_cap',
      message: `${personLabel} would exceed ${MAX_ASSIGNED_HOURS_PER_DAY} scheduled hours ${isYou ? 'in one day' : 'that day'}.`,
    };
  }

  // Pass 2/3/4 — fatigue checks (ASSIGNED_STATUSES allowlist, includes completed).
  const worked = input.otherShifts.filter((s) => !isSelf(s) && validSlice(s) && ASSIGNED_STATUSES.has(s.status));

  // Pass 2 — min rest hours: worst (smallest) gap to any adjacent worked shift.
  let minGapHours = Infinity;
  for (const other of worked) {
    const gapHours = other.startAtMs >= targetShift.endAtMs
      ? (other.startAtMs - targetShift.endAtMs) / 3_600_000
      : (targetShift.startAtMs - other.endAtMs) / 3_600_000;
    if (gapHours >= 0) minGapHours = Math.min(minGapHours, gapHours);
  }
  if (minGapHours < rules.minRestHours) {
    return {
      code: 'insufficient_rest',
      message: `${personLabel} would have only ${minGapHours.toFixed(1)}h of rest around this shift — at least ${rules.minRestHours}h is required.`,
    };
  }

  // Pass 3 — max consecutive days: bidirectional day-streak walk.
  const dayKeys = new Set(worked.map((s) => utcDayKey(s.startAtMs)));
  dayKeys.add(targetDay);
  let streak = 1;
  let cursor = targetDay;
  while (dayKeys.has(addDaysToKey(cursor, -1))) { cursor = addDaysToKey(cursor, -1); streak++; }
  cursor = targetDay;
  while (dayKeys.has(addDaysToKey(cursor, 1))) { cursor = addDaysToKey(cursor, 1); streak++; }
  if (streak > rules.maxConsecutiveDays) {
    return {
      code: 'max_consecutive_days',
      message: `${personLabel} would be scheduled ${streak} consecutive days in a row, exceeding the ${rules.maxConsecutiveDays}-day limit.`,
    };
  }

  // Pass 4 — max weekly hours: fixed Mon-Sun UTC week containing the target shift.
  const weekStart = isoWeekStartMs(targetShift.startAtMs);
  const weekEnd = weekStart + 7 * 86_400_000;
  const weeklyHours = worked
    .filter((s) => s.startAtMs >= weekStart && s.startAtMs < weekEnd)
    .reduce((sum, s) => sum + durationHours(s.startAtMs, s.endAtMs), 0)
    + durationHours(targetShift.startAtMs, targetShift.endAtMs);
  if (weeklyHours > rules.maxWeeklyHours) {
    return {
      code: 'max_weekly_hours',
      message: `${personLabel} would be scheduled ${weeklyHours.toFixed(1)} hours this week, exceeding the ${rules.maxWeeklyHours}-hour limit.`,
    };
  }

  return null;
}
