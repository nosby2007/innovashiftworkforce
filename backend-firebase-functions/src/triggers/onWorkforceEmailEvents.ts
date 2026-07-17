import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { initFirebase } from '../infra/firebase';
import { sendgridApiKey } from '../infra/external-notify';
import {
  appLink,
  formatDurationMs,
  formatWorkforceDateTime,
  joinEmailLines,
  loadWorkforceEmailConfig,
  resolveManagerEmails,
  resolveOrgUserEmail,
  sendWorkforceEmail,
  WorkforceEmailDeliveryResult,
  WorkforceEmailRecipient,
} from '../infra/workforce-email-notify';

function toMillis(value: unknown): number {
  if (!value) return 0;
  const timestamp = value as { toMillis?: () => number; seconds?: number };
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  if (typeof timestamp.seconds === 'number') return timestamp.seconds * 1000;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function shiftLabel(shift: Record<string, any>): string {
  return String(shift.title || 'Shift').trim();
}

function locationLabel(shift: Record<string, any>): string {
  return String(shift.locationName || 'Not specified').trim();
}

function requiredRoleLabel(shift: Record<string, any>): string | null {
  if (Array.isArray(shift.requiredJobRoles) && shift.requiredJobRoles.length) {
    return shift.requiredJobRoles.map((role: unknown) => String(role)).join(', ');
  }
  const role = String(shift.requiredJobRole || '').trim();
  return role || null;
}

function latestAuditAction(shift: Record<string, any>): string {
  const audit = Array.isArray(shift.auditLog) ? shift.auditLog : [];
  const latest = audit.length ? audit[audit.length - 1] : null;
  return String(latest?.action || '').trim();
}

function hasRetryableFailure(results: WorkforceEmailDeliveryResult[]): boolean {
  return results.some((result) => !result.sent && result.retryable);
}

async function loadShift(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  shiftId: string,
): Promise<Record<string, any>> {
  if (!shiftId) return {};
  const snap = await db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId).get();
  return snap.exists ? snap.data() as Record<string, any> : {};
}

async function sendShiftAssignedEmail(params: {
  db: FirebaseFirestore.Firestore;
  orgId: string;
  shiftId: string;
  shift: Record<string, any>;
  recipient: WorkforceEmailRecipient;
  timeZone: string;
  eventKey: string;
}): Promise<WorkforceEmailDeliveryResult> {
  const role = requiredRoleLabel(params.shift);
  return sendWorkforceEmail({
    db: params.db,
    orgId: params.orgId,
    eventKey: params.eventKey,
    eventType: 'shift_assigned',
    recipient: params.recipient,
    subject: 'New shift assigned',
    message: joinEmailLines([
      `Hello ${params.recipient.displayName},`,
      '',
      'A new shift has been assigned to you.',
      '',
      `Shift: ${shiftLabel(params.shift)}`,
      `Location: ${locationLabel(params.shift)}`,
      `Start: ${formatWorkforceDateTime(params.shift.startAt, params.timeZone)}`,
      `End: ${formatWorkforceDateTime(params.shift.endAt, params.timeZone)}`,
      role ? `Required role: ${role}` : null,
      '',
      'Open InnovaShift to review the complete shift details.',
    ]),
    presentation: {
      badge: 'Shift assignment',
      ctaLabel: 'View my schedule',
      ctaUrl: appLink('/app/schedule'),
    },
    related: { shiftId: params.shiftId },
  });
}

export const onShiftWorkforceEmail = onDocumentWritten({
  document: 'orgs/{orgId}/shifts/{shiftId}',
  secrets: [sendgridApiKey],
  retry: true,
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() as Record<string, any> : null;
  const after = event.data?.after?.exists ? event.data.after.data() as Record<string, any> : null;
  if (!after) return;

  const admin = initFirebase();
  const db = admin.firestore();
  const orgId = String(event.params.orgId);
  const shiftId = String(event.params.shiftId);
  const config = await loadWorkforceEmailConfig(db, orgId);
  const results: WorkforceEmailDeliveryResult[] = [];

  const beforeAssignee = String(before?.assignedUserId || '').trim();
  const afterAssignee = String(after.assignedUserId || '').trim();
  const assignmentChanged = Boolean(afterAssignee) && beforeAssignee !== afterAssignee;
  const assignmentCameFromSwap = Boolean(after.swapRequestId) && after.swapRequestId !== before?.swapRequestId;

  if (assignmentChanged && !assignmentCameFromSwap && config.preferences.shiftAssignedEmployee) {
    const recipient = await resolveOrgUserEmail(db, orgId, afterAssignee);
    if (recipient) {
      const assignedAtMs = toMillis(after.assignedAt) || toMillis(after.updatedAt) || Date.now();
      results.push(await sendShiftAssignedEmail({
        db,
        orgId,
        shiftId,
        shift: after,
        recipient,
        timeZone: config.timeZone,
        eventKey: `shift-assigned:${shiftId}:${afterAssignee}:${assignedAtMs}`,
      }));
    }
  }

  const isCallOut = Boolean(beforeAssignee) && !afterAssignee &&
    String(after.status || '') === 'published' &&
    after.marketplaceVisible === true &&
    latestAuditAction(after) === 'CALLED_OUT';

  if (isCallOut) {
    const unassignedAtMs = toMillis(after.unassignedAt) || toMillis(after.updatedAt) || Date.now();
    const eventKey = `call-out:${shiftId}:${unassignedAtMs}`;
    const employee = await resolveOrgUserEmail(db, orgId, beforeAssignee);
    const reasonAudit = Array.isArray(after.auditLog) ? after.auditLog[after.auditLog.length - 1] : null;
    const auditNote = String(reasonAudit?.note || '').trim();
    const callOutReason = auditNote.toLowerCase().startsWith('called out:')
      ? auditNote.slice('called out:'.length).trim()
      : null;

    if (employee && config.preferences.callOutEmployeeConfirmation) {
      results.push(await sendWorkforceEmail({
        db,
        orgId,
        eventKey,
        eventType: 'call_out_employee',
        recipient: employee,
        subject: 'Call-out confirmed',
        message: joinEmailLines([
          `Hello ${employee.displayName},`,
          '',
          'Your call-out was recorded and the shift was reopened for coverage.',
          '',
          `Shift: ${shiftLabel(after)}`,
          `Location: ${locationLabel(after)}`,
          `Start: ${formatWorkforceDateTime(after.startAt, config.timeZone)}`,
          `End: ${formatWorkforceDateTime(after.endAt, config.timeZone)}`,
          callOutReason ? `Reason submitted: ${callOutReason}` : null,
        ]),
        presentation: {
          badge: 'Call-out confirmation',
          ctaLabel: 'View my schedule',
          ctaUrl: appLink('/app/schedule'),
        },
        related: { shiftId },
      }));
    }

    if (config.preferences.callOutManagers) {
      const managers = await resolveManagerEmails(db, orgId);
      const role = requiredRoleLabel(after);
      const managerResults = await Promise.all(managers.map((manager) => sendWorkforceEmail({
        db,
        orgId,
        eventKey,
        eventType: 'call_out_manager',
        recipient: manager,
        subject: 'Urgent: shift needs coverage',
        message: joinEmailLines([
          `${employee?.displayName || 'A team member'} called out of an assigned shift.`,
          '',
          `Shift: ${shiftLabel(after)}`,
          `Location: ${locationLabel(after)}`,
          `Start: ${formatWorkforceDateTime(after.startAt, config.timeZone)}`,
          `End: ${formatWorkforceDateTime(after.endAt, config.timeZone)}`,
          role ? `Required role: ${role}` : null,
          callOutReason ? `Reason: ${callOutReason}` : null,
          '',
          'The shift is now visible on the marketplace and needs coverage.',
        ]),
        presentation: {
          badge: 'Coverage alert',
          ctaLabel: 'Open scheduler',
          ctaUrl: appLink('/admin/scheduler'),
        },
        related: { shiftId },
      })));
      results.push(...managerResults);
    }
  }

  if (hasRetryableFailure(results)) {
    throw new Error('One or more workforce shift emails failed and are eligible for retry.');
  }
});

export const onTimeEntryWorkforceEmail = onDocumentWritten({
  document: 'orgs/{orgId}/timeEntries/{entryId}',
  secrets: [sendgridApiKey],
  retry: true,
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() as Record<string, any> : null;
  const after = event.data?.after?.exists ? event.data.after.data() as Record<string, any> : null;
  if (!after) return;

  const admin = initFirebase();
  const db = admin.firestore();
  const orgId = String(event.params.orgId);
  const entryId = String(event.params.entryId);
  const userId = String(after.userId || '').trim();
  const shiftId = String(after.shiftId || '').trim();
  if (!userId || !shiftId) return;

  const [config, employee, shift] = await Promise.all([
    loadWorkforceEmailConfig(db, orgId),
    resolveOrgUserEmail(db, orgId, userId),
    loadShift(db, orgId, shiftId),
  ]);
  if (!employee) return;

  const results: WorkforceEmailDeliveryResult[] = [];
  const isClockIn = !before && Boolean(after.checkInAt);
  const isClockOut = !before?.checkOutAt && Boolean(after.checkOutAt);

  if (isClockIn) {
    const message = joinEmailLines([
      `Hello ${employee.displayName},`,
      '',
      'Your clock-in was successfully recorded.',
      '',
      `Shift: ${shiftLabel(shift)}`,
      `Location: ${locationLabel(shift)}`,
      `Clock-in time: ${formatWorkforceDateTime(after.checkInAt, config.timeZone)}`,
      `Method: ${String(after.method || 'manual').toUpperCase()}`,
    ]);

    if (config.preferences.clockInEmployee) {
      results.push(await sendWorkforceEmail({
        db,
        orgId,
        eventKey: `clock-in:${entryId}`,
        eventType: 'clock_in',
        recipient: employee,
        subject: 'Clock-in confirmed',
        message,
        presentation: {
          badge: 'Attendance',
          ctaLabel: 'View attendance',
          ctaUrl: appLink('/app/attendance'),
        },
        related: { entryId, shiftId },
      }));
    }

    if (config.preferences.clockInManagers) {
      const managers = await resolveManagerEmails(db, orgId);
      results.push(...await Promise.all(managers.map((manager) => sendWorkforceEmail({
        db,
        orgId,
        eventKey: `clock-in-manager:${entryId}`,
        eventType: 'clock_in',
        recipient: manager,
        subject: `${employee.displayName} clocked in`,
        message: joinEmailLines([
          `${employee.displayName} successfully clocked in.`,
          '',
          `Shift: ${shiftLabel(shift)}`,
          `Location: ${locationLabel(shift)}`,
          `Clock-in time: ${formatWorkforceDateTime(after.checkInAt, config.timeZone)}`,
          `Method: ${String(after.method || 'manual').toUpperCase()}`,
        ]),
        presentation: {
          badge: 'Manager attendance alert',
          ctaLabel: 'Open timesheets',
          ctaUrl: appLink('/admin/timesheets'),
        },
        related: { entryId, shiftId },
      }))));
    }
  }

  if (isClockOut) {
    const checkInMs = toMillis(after.checkInAt);
    const checkOutMs = toMillis(after.checkOutAt);
    const totalBreakMs = Math.max(0, Number(after.totalBreakMs || 0));
    const workedMs = Math.max(0, checkOutMs - checkInMs - totalBreakMs);
    const history = Array.isArray(after.breakPolicyHistory) ? after.breakPolicyHistory : [];
    const latestPolicy = history.length ? history[history.length - 1] : null;
    const autoDeductionMs = Math.max(0, Number(latestPolicy?.autoBreakDeductionMs || 0));

    if (config.preferences.clockOutEmployee) {
      results.push(await sendWorkforceEmail({
        db,
        orgId,
        eventKey: `clock-out:${entryId}`,
        eventType: 'clock_out',
        recipient: employee,
        subject: 'Clock-out confirmed',
        message: joinEmailLines([
          `Hello ${employee.displayName},`,
          '',
          'Your clock-out was successfully recorded.',
          '',
          `Shift: ${shiftLabel(shift)}`,
          `Location: ${locationLabel(shift)}`,
          `Clock-in: ${formatWorkforceDateTime(after.checkInAt, config.timeZone)}`,
          `Clock-out: ${formatWorkforceDateTime(after.checkOutAt, config.timeZone)}`,
          `Worked duration: ${formatDurationMs(workedMs)}`,
          `Break duration: ${formatDurationMs(totalBreakMs)}`,
          autoDeductionMs > 0 ? `Automatic break deduction applied: ${formatDurationMs(autoDeductionMs)}` : null,
          '',
          'This is an attendance summary, not a final payroll calculation.',
        ]),
        presentation: {
          badge: 'Attendance',
          ctaLabel: 'View attendance',
          ctaUrl: appLink('/app/attendance'),
        },
        related: { entryId, shiftId },
      }));
    }

    if (config.preferences.clockOutManagers) {
      const managers = await resolveManagerEmails(db, orgId);
      results.push(...await Promise.all(managers.map((manager) => sendWorkforceEmail({
        db,
        orgId,
        eventKey: `clock-out-manager:${entryId}`,
        eventType: 'clock_out',
        recipient: manager,
        subject: `${employee.displayName} clocked out`,
        message: joinEmailLines([
          `${employee.displayName} successfully clocked out.`,
          '',
          `Shift: ${shiftLabel(shift)}`,
          `Location: ${locationLabel(shift)}`,
          `Clock-in: ${formatWorkforceDateTime(after.checkInAt, config.timeZone)}`,
          `Clock-out: ${formatWorkforceDateTime(after.checkOutAt, config.timeZone)}`,
          `Worked duration: ${formatDurationMs(workedMs)}`,
          `Break duration: ${formatDurationMs(totalBreakMs)}`,
        ]),
        presentation: {
          badge: 'Manager attendance alert',
          ctaLabel: 'Open timesheets',
          ctaUrl: appLink('/admin/timesheets'),
        },
        related: { entryId, shiftId },
      }))));
    }
  }

  if (hasRetryableFailure(results)) {
    throw new Error('One or more attendance emails failed and are eligible for retry.');
  }
});

export const onShiftSwapWorkforceEmail = onDocumentWritten({
  document: 'orgs/{orgId}/shiftSwapRequests/{requestId}',
  secrets: [sendgridApiKey],
  retry: true,
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() as Record<string, any> : null;
  const after = event.data?.after?.exists ? event.data.after.data() as Record<string, any> : null;
  if (!after) return;

  const admin = initFirebase();
  const db = admin.firestore();
  const orgId = String(event.params.orgId);
  const requestId = String(event.params.requestId);
  const config = await loadWorkforceEmailConfig(db, orgId);
  const results: WorkforceEmailDeliveryResult[] = [];
  const status = String(after.status || '').trim();
  const kind = String(after.kind || (after.targetShiftId ? 'swap' : 'cover'));

  if (!before && status === 'pending' && config.preferences.shiftSwapRequests) {
    const targetUid = String(after.targetUid || '').trim();
    const target = await resolveOrgUserEmail(db, orgId, targetUid);
    if (target) {
      results.push(await sendWorkforceEmail({
        db,
        orgId,
        eventKey: `shift-swap-request:${requestId}`,
        eventType: 'shift_swap_request',
        recipient: target,
        subject: kind === 'swap' ? 'Shift trade request' : 'Shift cover request',
        message: joinEmailLines([
          `Hello ${target.displayName},`,
          '',
          `${String(after.requesterName || 'A team member')} asked you to ${kind === 'swap' ? 'trade shifts' : 'cover a shift'}.`,
          '',
          `Shift: ${String(after.shiftTitle || 'Shift')}`,
          `Location: ${String(after.shiftLocationName || 'Not specified')}`,
          `Start: ${formatWorkforceDateTime(after.sourceStartAt, config.timeZone)}`,
          `End: ${formatWorkforceDateTime(after.sourceEndAt, config.timeZone)}`,
          kind === 'swap' && after.targetShiftTitle ? `Your offered shift: ${String(after.targetShiftTitle)}` : null,
          kind === 'swap' && after.targetStartAt ? `Your shift start: ${formatWorkforceDateTime(after.targetStartAt, config.timeZone)}` : null,
          after.note ? `Message: ${String(after.note)}` : null,
          '',
          'Open InnovaShift to review and respond to this request.',
        ]),
        presentation: {
          badge: kind === 'swap' ? 'Shift trade' : 'Shift coverage',
          ctaLabel: 'Review request',
          ctaUrl: appLink('/app/schedule'),
        },
        related: { requestId, shiftId: String(after.shiftId || '') },
      }));
    }
  }

  const decisionChanged = Boolean(before) && String(before?.status || '') !== status &&
    ['approved', 'rejected', 'cancelled'].includes(status);

  if (decisionChanged && config.preferences.shiftSwapDecisions) {
    const requesterUid = String(after.requesterUid || '').trim();
    const targetUid = String(after.targetUid || '').trim();
    const [requester, target] = await Promise.all([
      resolveOrgUserEmail(db, orgId, requesterUid),
      resolveOrgUserEmail(db, orgId, targetUid),
    ]);
    const eventKey = `shift-swap-decision:${requestId}:${status}`;

    if (status === 'approved') {
      const sourceShift = await loadShift(db, orgId, String(after.shiftId || ''));
      const targetShift = after.targetShiftId
        ? await loadShift(db, orgId, String(after.targetShiftId))
        : null;

      if (requester) {
        results.push(await sendWorkforceEmail({
          db,
          orgId,
          eventKey,
          eventType: 'shift_swap_accepted',
          recipient: requester,
          subject: kind === 'swap' ? 'Shift trade approved' : 'Shift cover approved',
          message: joinEmailLines([
            `Hello ${requester.displayName},`,
            '',
            `${String(after.targetName || 'The selected team member')} accepted your ${kind === 'swap' ? 'trade' : 'coverage'} request.`,
            kind === 'swap' && targetShift ? '' : null,
            kind === 'swap' && targetShift ? `Your new shift: ${shiftLabel(targetShift)}` : 'Your original shift has been transferred to the covering employee.',
            kind === 'swap' && targetShift ? `Location: ${locationLabel(targetShift)}` : null,
            kind === 'swap' && targetShift ? `Start: ${formatWorkforceDateTime(targetShift.startAt, config.timeZone)}` : null,
            kind === 'swap' && targetShift ? `End: ${formatWorkforceDateTime(targetShift.endAt, config.timeZone)}` : null,
          ]),
          presentation: {
            badge: 'Shift change confirmed',
            ctaLabel: 'View schedule',
            ctaUrl: appLink('/app/schedule'),
          },
          related: { requestId, shiftId: String(after.shiftId || '') },
        }));
      }

      if (target) {
        results.push(await sendWorkforceEmail({
          db,
          orgId,
          eventKey,
          eventType: 'shift_swap_accepted',
          recipient: target,
          subject: kind === 'swap' ? 'Shift trade confirmed' : 'Shift cover confirmed',
          message: joinEmailLines([
            `Hello ${target.displayName},`,
            '',
            `You are now assigned to ${kind === 'swap' ? 'the traded shift' : 'the covered shift'}.`,
            '',
            `Shift: ${shiftLabel(sourceShift)}`,
            `Location: ${locationLabel(sourceShift)}`,
            `Start: ${formatWorkforceDateTime(sourceShift.startAt, config.timeZone)}`,
            `End: ${formatWorkforceDateTime(sourceShift.endAt, config.timeZone)}`,
          ]),
          presentation: {
            badge: 'Shift change confirmed',
            ctaLabel: 'View schedule',
            ctaUrl: appLink('/app/schedule'),
          },
          related: { requestId, shiftId: String(after.shiftId || '') },
        }));
      }
    }

    if (status === 'rejected' && requester) {
      results.push(await sendWorkforceEmail({
        db,
        orgId,
        eventKey,
        eventType: 'shift_swap_rejected',
        recipient: requester,
        subject: kind === 'swap' ? 'Shift trade declined' : 'Shift cover declined',
        message: joinEmailLines([
          `Hello ${requester.displayName},`,
          '',
          `${String(after.targetName || 'The selected team member')} declined your ${kind === 'swap' ? 'shift trade' : 'shift cover'} request.`,
          after.decisionNote ? `Note: ${String(after.decisionNote)}` : null,
          '',
          'Your current shift assignment has not changed.',
        ]),
        presentation: {
          badge: 'Shift request update',
          ctaLabel: 'View schedule',
          ctaUrl: appLink('/app/schedule'),
        },
        related: { requestId, shiftId: String(after.shiftId || '') },
      }));
    }

    if (status === 'cancelled' && target) {
      results.push(await sendWorkforceEmail({
        db,
        orgId,
        eventKey,
        eventType: 'shift_swap_cancelled',
        recipient: target,
        subject: 'Shift request cancelled',
        message: joinEmailLines([
          `Hello ${target.displayName},`,
          '',
          `${String(after.requesterName || 'The requester')} cancelled the pending shift ${kind === 'swap' ? 'trade' : 'cover'} request.`,
          '',
          'No schedule changes were made.',
        ]),
        presentation: {
          badge: 'Shift request update',
          ctaLabel: 'View schedule',
          ctaUrl: appLink('/app/schedule'),
        },
        related: { requestId, shiftId: String(after.shiftId || '') },
      }));
    }
  }

  if (hasRetryableFailure(results)) {
    logger.warn('[onShiftSwapWorkforceEmail] one or more emails are eligible for retry', {
      orgId,
      requestId,
      status,
    });
    throw new Error('One or more shift swap emails failed and are eligible for retry.');
  }
});
