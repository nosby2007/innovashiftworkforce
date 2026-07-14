import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { resolveRequiredRoles } from '../domain/job-roles';

const MAX_SHIFT_DURATION_HOURS = 24;
const MAX_ASSIGNED_HOURS_PER_DAY = 16;

function overlaps(aStart: any, aEnd: any, bStart: any, bEnd: any): boolean {
  const as = aStart?.toMillis ? aStart.toMillis() : Number(aStart);
  const ae = aEnd?.toMillis ? aEnd.toMillis() : Number(aEnd);
  const bs = bStart?.toMillis ? bStart.toMillis() : Number(bStart);
  const be = bEnd?.toMillis ? bEnd.toMillis() : Number(bEnd);
  return as < be && bs < ae;
}

function utcDayKeyFromMillis(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function durationHours(startAt: any, endAt: any): number {
  const startMs = startAt?.toMillis ? startAt.toMillis() : Number(startAt || 0);
  const endMs = endAt?.toMillis ? endAt.toMillis() : Number(endAt || 0);
  if (!startMs || !endMs || endMs <= startMs) return 0;
  return (endMs - startMs) / 3_600_000;
}

export const updateShift = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();

  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'Admin/Scheduler privileges required.');
  }
  const orgId = ctx.orgId;

  const shiftId = String(req.data?.shiftId || '').trim();
  if (!shiftId) throw new HttpsError('invalid-argument', 'shiftId is required.');

  const hasTitle = req.data?.title !== undefined;
  const hasLocationId = req.data?.locationId !== undefined;
  const hasLocationName = req.data?.locationName !== undefined;
  const hasStart = req.data?.startAtMs !== undefined;
  const hasEnd = req.data?.endAtMs !== undefined;
  const hasRole = req.data?.requiredJobRole !== undefined || req.data?.requiredJobRoles !== undefined;
  const hasPayRate = req.data?.payRate !== undefined;
  const hasNotes = req.data?.notes !== undefined;

  const title = hasTitle ? String(req.data.title || '').trim() : null;
  const locationId = hasLocationId ? (String(req.data.locationId || '').trim() || null) : null;
  let locationName = hasLocationName ? String(req.data.locationName || '').trim() : null;
  const startAtMs = hasStart ? Number(req.data.startAtMs || 0) : null;
  const endAtMs = hasEnd ? Number(req.data.endAtMs || 0) : null;
  const requiredJobRoles = hasRole ? resolveRequiredRoles(req.data?.requiredJobRoles ?? req.data?.requiredJobRole) : null;
  const payRateRaw = hasPayRate ? Number(req.data.payRate) : null;
  const payRate = hasPayRate ? (Number.isFinite(payRateRaw) ? payRateRaw : null) : null;
  const notes = hasNotes ? (String(req.data.notes || '').trim() || null) : null;

  if (hasTitle) {
    if (!title) throw new HttpsError('invalid-argument', 'title cannot be empty.');
    if (title.length > 120) throw new HttpsError('invalid-argument', 'title must be 120 characters or less.');
  }
  if (hasStart !== hasEnd) {
    throw new HttpsError('invalid-argument', 'startAtMs and endAtMs must be provided together.');
  }
  if (hasStart && hasEnd) {
    if (!startAtMs || !endAtMs) throw new HttpsError('invalid-argument', 'startAtMs/endAtMs are required.');
    if (endAtMs <= startAtMs) throw new HttpsError('invalid-argument', 'endAt must be after startAt.');
    if ((endAtMs - startAtMs) / 3_600_000 > MAX_SHIFT_DURATION_HOURS) {
      throw new HttpsError('invalid-argument', `Shift duration cannot exceed ${MAX_SHIFT_DURATION_HOURS} hours.`);
    }
  }
  if (hasPayRate && payRate != null && payRate < 0) {
    throw new HttpsError('invalid-argument', 'payRate cannot be negative.');
  }
  if (hasNotes && notes && notes.length > 2000) {
    throw new HttpsError('invalid-argument', 'notes must be 2000 characters or less.');
  }

  const ref = db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId);

  if (hasLocationId && locationId) {
    const orgSnap = await db.collection('orgs').doc(orgId).get();
    const org = orgSnap.exists ? (orgSnap.data() as any) : {};
    const sites = Array.isArray(org?.sites) ? org.sites : [];
    const matchedSite = sites.find((site: any) => String(site?.id || '').trim() === locationId);
    if (!matchedSite) throw new HttpsError('invalid-argument', 'Selected site was not found in organization settings.');
    locationName = String(matchedSite?.name || '').trim();
  }
  if (hasLocationId && !locationId) {
    throw new HttpsError('invalid-argument', 'locationId cannot be empty.');
  }
  if (hasLocationName && !locationId && !locationName) {
    throw new HttpsError('invalid-argument', 'locationName cannot be empty.');
  }

  const changes: Record<string, unknown> = {};

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Shift not found.');
    const s: any = snap.data() || {};
    if (s.status === 'completed' || s.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'Cannot edit a completed/cancelled shift.');
    }

    let newStart = s.startAt;
    let newEnd = s.endAt;
    if (hasStart && hasEnd) {
      newStart = Timestamp.fromMillis(startAtMs!);
      newEnd = Timestamp.fromMillis(endAtMs!);
      const timesChanged = toMillisSafe(s.startAt) !== startAtMs || toMillisSafe(s.endAt) !== endAtMs;

      if (timesChanged && s.assignedUserId) {
        const targetDay = utcDayKeyFromMillis(startAtMs!);
        let targetDayHours = durationHours(newStart, newEnd);
        const qsnap = await tx.get(
          db.collection('orgs').doc(orgId).collection('shifts')
            .where('assignedUserId', '==', s.assignedUserId)
            .limit(200)
        );
        for (const d of qsnap.docs) {
          if (d.id === shiftId) continue;
          const other: any = d.data();
          if (!other?.startAt || !other?.endAt) continue;
          if (['cancelled', 'completed', 'expired', 'no_show'].includes(other.status)) continue;
          const otherStartMs = other.startAt?.toMillis ? other.startAt.toMillis() : Number(other.startAt || 0);
          if (otherStartMs && utcDayKeyFromMillis(otherStartMs) === targetDay) {
            targetDayHours += durationHours(other.startAt, other.endAt);
          }
          if (overlaps(newStart, newEnd, other.startAt, other.endAt)) {
            throw new HttpsError('failed-precondition', 'Overlap detected for assigned staff member.');
          }
        }
        if (targetDayHours > MAX_ASSIGNED_HOURS_PER_DAY) {
          throw new HttpsError('failed-precondition', `Edit would exceed ${MAX_ASSIGNED_HOURS_PER_DAY} scheduled hours for this staff member on that day.`);
        }
      }

      if (timesChanged) {
        changes['startAt'] = startAtMs;
        changes['endAt'] = endAtMs;
      }
    }

    const patch: Record<string, unknown> = {
      updatedAt: Timestamp.now(),
      updatedBy: ctx.uid,
    };
    if (hasStart && hasEnd) {
      patch['startAt'] = newStart;
      patch['endAt'] = newEnd;
    }
    if (hasTitle) { patch['title'] = title; changes['title'] = title; }
    if (hasLocationId || hasLocationName) {
      patch['locationId'] = locationId;
      patch['locationName'] = locationName;
      changes['locationId'] = locationId;
      changes['locationName'] = locationName;
    }
    if (hasRole) {
      patch['requiredJobRoles'] = requiredJobRoles;
      patch['requiredJobRole'] = requiredJobRoles?.[0] ?? null;
      changes['requiredJobRoles'] = requiredJobRoles;
    }
    if (hasPayRate) { patch['payRate'] = payRate; changes['payRate'] = payRate; }
    if (hasNotes) { patch['notes'] = notes; changes['notes'] = notes; }

    patch['auditLog'] = FieldValue.arrayUnion({
      action: 'UPDATED',
      actorUserId: ctx.uid,
      at: Timestamp.now(),
      note: 'Shift details edited by admin.',
    });

    tx.update(ref, patch);
  });

  await writeAudit(orgId, {
    action: 'shift.update',
    actorUid: ctx.uid,
    target: { shiftId },
    details: changes,
  });

  return { ok: true, shiftId };
});

function toMillisSafe(value: any): number {
  return value?.toMillis ? value.toMillis() : Number(value || 0);
}
