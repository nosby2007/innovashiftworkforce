/**
 * Pure predicates for the two rate-limiter-driven abuse signals that feed
 * platform-admin alerts (see infra/platform-alerts.ts). No Firestore/Admin
 * SDK imports — callers (provisionSandboxOrg.ts, contactIntake.ts) read the
 * relevant lock/counter doc, call these, then act on the result.
 */

/** Sandbox demo daily-cap block: alert once per lock doc (the lock doc's own
 *  24h window already matches the daily-cap window, so "not yet alerted on
 *  this doc" is equivalent to "not yet alerted today for this IP"). */
export function isSandboxDailyCapFirstAlert(lockData: { alertedForDailyCap?: boolean } | null | undefined): boolean {
  return lockData?.alertedForDailyCap !== true;
}

export interface ContactAbuseCounterState {
  count: number;
  windowStartAtMs: number;
  alertedAt: number | null;
}

export interface ContactAbuseEvaluation extends ContactAbuseCounterState {
  shouldAlert: boolean;
}

const CONTACT_ABUSE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const CONTACT_ABUSE_THRESHOLD = 10; // blocked attempts from one IP within the window

/**
 * Rolls a per-IP counter of contact-form rate-limit blocks forward by one
 * event, resetting the window if it has expired, and decides whether this
 * event should trigger an alert (crosses the threshold, and hasn't already
 * alerted within the current window — so a sustained attack pings admins
 * once, not on every single blocked request).
 */
export function evaluateContactAbuseCounter(
  existing: ContactAbuseCounterState | null,
  nowMs: number,
): ContactAbuseEvaluation {
  const windowExpired = !existing || nowMs - existing.windowStartAtMs >= CONTACT_ABUSE_WINDOW_MS;
  const windowStartAtMs = windowExpired ? nowMs : existing!.windowStartAtMs;
  const count = windowExpired ? 1 : existing!.count + 1;
  const alertedAt = windowExpired ? null : existing!.alertedAt;

  const shouldAlert = count >= CONTACT_ABUSE_THRESHOLD && alertedAt == null;

  return {
    count,
    windowStartAtMs,
    alertedAt: shouldAlert ? nowMs : alertedAt,
    shouldAlert,
  };
}
