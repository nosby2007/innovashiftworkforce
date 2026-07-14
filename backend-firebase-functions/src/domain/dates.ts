/** Pure date/time helpers shared across callables, extracted for unit testing. */

export function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Day bounds for a plain 'YYYY-MM-DD' request date, UTC — consistent with the
 *  UTC-day convention already used by assignShift.ts/claimShift.ts. */
export function dayBoundsMs(dateStr: string, endOfDay: boolean): number {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return 0;
  return endOfDay
    ? Date.UTC(y, m - 1, d, 23, 59, 59, 999)
    : Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}
