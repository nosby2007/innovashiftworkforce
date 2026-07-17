import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { externalNotify, ExternalEmailPresentation } from './external-notify';

const DEFAULT_TIME_ZONE = 'America/New_York';
const DEFAULT_APP_URL = process.env.NOTIFY_APP_URL || 'https://atlanta-e04aa.web.app';
const MAX_DELIVERY_ATTEMPTS = 3;
const DELIVERY_LEASE_MS = 5 * 60 * 1000;
const ADMIN_LIKE_ROLES = new Set(['admin', 'manager', 'scheduler', 'hr']);

export interface WorkforceEmailPreferences {
  shiftAssignedEmployee: boolean;
  clockInEmployee: boolean;
  clockInManagers: boolean;
  clockOutEmployee: boolean;
  clockOutManagers: boolean;
  callOutManagers: boolean;
  callOutEmployeeConfirmation: boolean;
  shiftSwapRequests: boolean;
  shiftSwapDecisions: boolean;
}

export const DEFAULT_WORKFORCE_EMAIL_PREFERENCES: WorkforceEmailPreferences = {
  shiftAssignedEmployee: true,
  clockInEmployee: true,
  clockInManagers: false,
  clockOutEmployee: true,
  clockOutManagers: false,
  callOutManagers: true,
  callOutEmployeeConfirmation: true,
  shiftSwapRequests: true,
  shiftSwapDecisions: true,
};

export interface WorkforceEmailConfig {
  timeZone: string;
  orgName: string;
  preferences: WorkforceEmailPreferences;
}

export interface WorkforceEmailRecipient {
  uid: string;
  email: string;
  displayName: string;
  accessRole?: string | null;
}

export type WorkforceEmailEventType =
  | 'shift_assigned'
  | 'clock_in'
  | 'clock_out'
  | 'call_out_manager'
  | 'call_out_employee'
  | 'shift_swap_request'
  | 'shift_swap_accepted'
  | 'shift_swap_rejected'
  | 'shift_swap_cancelled';

export interface WorkforceEmailDeliveryRequest {
  db: FirebaseFirestore.Firestore;
  orgId: string;
  eventKey: string;
  eventType: WorkforceEmailEventType;
  recipient: WorkforceEmailRecipient;
  subject: string;
  message: string;
  presentation?: ExternalEmailPresentation;
  related?: {
    shiftId?: string | null;
    entryId?: string | null;
    requestId?: string | null;
  };
}

export interface WorkforceEmailDeliveryResult {
  claimed: boolean;
  sent: boolean;
  skipped: boolean;
  retryable: boolean;
  attemptCount: number;
  reason?: string;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function resolveEmailPreferences(raw: unknown): WorkforceEmailPreferences {
  const email = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    shiftAssignedEmployee: asBoolean(email.shiftAssignedEmployee, DEFAULT_WORKFORCE_EMAIL_PREFERENCES.shiftAssignedEmployee),
    clockInEmployee: asBoolean(email.clockInEmployee, DEFAULT_WORKFORCE_EMAIL_PREFERENCES.clockInEmployee),
    clockInManagers: asBoolean(email.clockInManagers, DEFAULT_WORKFORCE_EMAIL_PREFERENCES.clockInManagers),
    clockOutEmployee: asBoolean(email.clockOutEmployee, DEFAULT_WORKFORCE_EMAIL_PREFERENCES.clockOutEmployee),
    clockOutManagers: asBoolean(email.clockOutManagers, DEFAULT_WORKFORCE_EMAIL_PREFERENCES.clockOutManagers),
    callOutManagers: asBoolean(email.callOutManagers, DEFAULT_WORKFORCE_EMAIL_PREFERENCES.callOutManagers),
    callOutEmployeeConfirmation: asBoolean(email.callOutEmployeeConfirmation, DEFAULT_WORKFORCE_EMAIL_PREFERENCES.callOutEmployeeConfirmation),
    shiftSwapRequests: asBoolean(email.shiftSwapRequests, DEFAULT_WORKFORCE_EMAIL_PREFERENCES.shiftSwapRequests),
    shiftSwapDecisions: asBoolean(email.shiftSwapDecisions, DEFAULT_WORKFORCE_EMAIL_PREFERENCES.shiftSwapDecisions),
  };
}

function validTimeZone(value: unknown): string {
  const candidate = String(value || '').trim();
  if (!candidate) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export async function loadWorkforceEmailConfig(
  db: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<WorkforceEmailConfig> {
  const snap = await db.collection('orgs').doc(orgId).get();
  const org = snap.exists ? snap.data() as Record<string, any> : {};
  const notificationSettings = org?.notificationSettings || {};
  return {
    timeZone: validTimeZone(org?.timeZone || org?.timezone || org?.settings?.timeZone || org?.settings?.timezone),
    orgName: String(org?.name || org?.organizationName || 'your organization').trim(),
    preferences: resolveEmailPreferences(notificationSettings?.email),
  };
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value || '').trim().toLowerCase();
  if (!email || !email.includes('@') || email.length > 320) return null;
  return email;
}

export async function resolveOrgUserEmail(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  uid: string,
): Promise<WorkforceEmailRecipient | null> {
  if (!uid) return null;
  const snap = await db.collection('orgs').doc(orgId).collection('users').doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  const email = normalizeEmail(data.email);
  if (!email) return null;
  return {
    uid,
    email,
    displayName: String(data.displayName || data.name || email).trim(),
    accessRole: data.accessRole ? String(data.accessRole) : null,
  };
}

export async function resolveManagerEmails(
  db: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<WorkforceEmailRecipient[]> {
  const snap = await db.collection('orgs').doc(orgId).collection('users').limit(1000).get();
  const byEmail = new Map<string, WorkforceEmailRecipient>();
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (data.active === false) continue;
    const accessRole = String(data.accessRole || '').trim().toLowerCase();
    if (!ADMIN_LIKE_ROLES.has(accessRole)) continue;
    const email = normalizeEmail(data.email);
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, {
      uid: doc.id,
      email,
      displayName: String(data.displayName || data.name || email).trim(),
      accessRole,
    });
  }
  return Array.from(byEmail.values());
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const withToDate = value as { toDate?: () => Date; toMillis?: () => number };
  if (typeof withToDate.toDate === 'function') return withToDate.toDate();
  if (typeof withToDate.toMillis === 'function') return new Date(withToDate.toMillis());
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatWorkforceDateTime(value: unknown, timeZone: string): string {
  const date = toDate(value);
  if (!date) return 'Not specified';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: validTimeZone(timeZone),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function formatDurationMs(value: number): string {
  const totalMinutes = Math.max(0, Math.round(value / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

export function joinEmailLines(lines: Array<string | null | undefined | false>): string {
  return lines.filter((line): line is string => typeof line === 'string' && line.length > 0).join('\n');
}

export function appLink(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${DEFAULT_APP_URL}${normalized}`;
}

function deliveryId(eventKey: string, recipient: WorkforceEmailRecipient): string {
  return createHash('sha256')
    .update(`${eventKey}:${recipient.uid}:${recipient.email.toLowerCase()}`)
    .digest('hex');
}

function emailHash(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex');
}

/**
 * Claims and records one logical email delivery. A sent delivery is immutable;
 * a failed delivery can be retried up to MAX_DELIVERY_ATTEMPTS. The short lease
 * prevents concurrent trigger deliveries for the same event and recipient.
 */
export async function sendWorkforceEmail(
  request: WorkforceEmailDeliveryRequest,
): Promise<WorkforceEmailDeliveryResult> {
  const { db, orgId, eventKey, eventType, recipient } = request;
  const ref = db.collection('orgs').doc(orgId).collection('notificationDeliveries')
    .doc(deliveryId(eventKey, recipient));

  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() as Record<string, any> : null;
    const nowMs = Date.now();
    const attemptCount = Number(current?.attemptCount || 0);
    const leaseUntilMs = current?.leaseUntil?.toMillis ? current.leaseUntil.toMillis() : 0;

    if (current?.status === 'sent') {
      return { claimed: false, attemptCount, reason: 'already-sent' };
    }
    if (attemptCount >= MAX_DELIVERY_ATTEMPTS && current?.status === 'failed') {
      return { claimed: false, attemptCount, reason: 'max-attempts-reached' };
    }
    if (current?.status === 'pending' && leaseUntilMs > nowMs) {
      return { claimed: false, attemptCount, reason: 'delivery-in-progress' };
    }

    const nextAttemptCount = attemptCount + 1;
    tx.set(ref, {
      eventKey,
      eventType,
      orgId,
      recipientUid: recipient.uid,
      recipientEmailHash: emailHash(recipient.email),
      status: 'pending',
      attemptCount: nextAttemptCount,
      leaseUntil: Timestamp.fromMillis(nowMs + DELIVERY_LEASE_MS),
      related: request.related || {},
      createdAt: current?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastAttemptAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { claimed: true, attemptCount: nextAttemptCount, reason: undefined };
  });

  if (!claim.claimed) {
    return {
      claimed: false,
      sent: claim.reason === 'already-sent',
      skipped: true,
      retryable: claim.reason === 'delivery-in-progress',
      attemptCount: claim.attemptCount,
      reason: claim.reason,
    };
  }

  const startedAt = Date.now();
  const result = await externalNotify({
    channel: 'email',
    to: recipient.email,
    subject: request.subject,
    message: request.message,
    meta: {
      eventType,
      orgId,
      recipientUid: recipient.uid,
      ...request.related,
    },
    presentation: request.presentation,
  });

  if (result.sent) {
    await ref.set({
      status: 'sent',
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      leaseUntil: null,
      providerStatusCode: result.statusCode || null,
      providerMessageId: result.providerMessageId || null,
      durationMs: Date.now() - startedAt,
      lastErrorReason: null,
    }, { merge: true });
    logger.info('[workforceEmail] delivery sent', {
      eventType,
      orgId,
      recipientUid: recipient.uid,
      attemptCount: claim.attemptCount,
      durationMs: Date.now() - startedAt,
      ...request.related,
    });
    return {
      claimed: true,
      sent: true,
      skipped: false,
      retryable: false,
      attemptCount: claim.attemptCount,
    };
  }

  await ref.set({
    status: 'failed',
    failedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    leaseUntil: null,
    providerStatusCode: result.statusCode || null,
    durationMs: Date.now() - startedAt,
    lastErrorReason: result.reason || 'send-failed',
  }, { merge: true });

  const retryable = claim.attemptCount < MAX_DELIVERY_ATTEMPTS;
  logger.error('[workforceEmail] delivery failed', {
    eventType,
    orgId,
    recipientUid: recipient.uid,
    attemptCount: claim.attemptCount,
    retryable,
    reason: result.reason || 'send-failed',
    durationMs: Date.now() - startedAt,
    ...request.related,
  });

  return {
    claimed: true,
    sent: false,
    skipped: false,
    retryable,
    attemptCount: claim.attemptCount,
    reason: result.reason || 'send-failed',
  };
}
