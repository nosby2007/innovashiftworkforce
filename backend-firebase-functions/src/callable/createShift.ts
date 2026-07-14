import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp } from 'firebase-admin/firestore';
import { resolveRequiredRoles } from '../domain/job-roles';

const ALLOWED_CREATE_STATUSES = new Set(['draft', 'open', 'published']);
const MAX_SHIFT_DURATION_HOURS = 24;

export const createShift = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();

  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'Admin/Scheduler privileges required.');
  }
  const orgId = ctx.orgId;

  const title = String(req.data?.title || '').trim();
  const locationId = String(req.data?.locationId || '').trim() || null;
  let locationName = String(req.data?.locationName || '').trim();
  const startAtMs = Number(req.data?.startAtMs || 0);
  const endAtMs = Number(req.data?.endAtMs || 0);
  const requiredJobRoles = resolveRequiredRoles(req.data?.requiredJobRoles ?? req.data?.requiredJobRole);
  const requiredJobRole = requiredJobRoles[0] ?? null;
  const payRateRaw = req.data?.payRate != null ? Number(req.data.payRate) : null;
  const payRate = payRateRaw != null && Number.isFinite(payRateRaw) ? payRateRaw : null;
  const notes = String(req.data?.notes || '').trim() || null;
  const publish = Boolean(req.data?.publish);
  const requestedStatus = String(req.data?.status || '').trim().toLowerCase();
  const status = publish
    ? 'published'
    : ALLOWED_CREATE_STATUSES.has(requestedStatus)
      ? requestedStatus
      : 'open';

  const orgSnap = await db.collection('orgs').doc(orgId).get();
  if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found.');
  const org = orgSnap.data() as any;
  const planStatus = String(org?.planStatus || '').trim();
  if (!ctx.isSuperAdmin && !['active', 'trialing'].includes(planStatus)) {
    throw new HttpsError('failed-precondition', 'Organization plan must be active to create shifts.');
  }

  if (locationId) {
    const sites = Array.isArray(org?.sites) ? org.sites : [];
    const matchedSite = sites.find((site: any) => String(site?.id || '').trim() === locationId);
    if (!matchedSite) throw new HttpsError('invalid-argument', 'Selected site was not found in organization settings.');
    locationName = String(matchedSite?.name || '').trim();
  }

  if (!title) throw new HttpsError('invalid-argument', 'title is required.');
  if (title.length > 120) throw new HttpsError('invalid-argument', 'title must be 120 characters or less.');
  if (!locationName) throw new HttpsError('invalid-argument', 'locationName is required.');
  if (locationName.length > 160) throw new HttpsError('invalid-argument', 'locationName must be 160 characters or less.');
  if (!startAtMs || !endAtMs) throw new HttpsError('invalid-argument', 'startAtMs/endAtMs are required.');
  if (endAtMs <= startAtMs) throw new HttpsError('invalid-argument', 'endAt must be after startAt.');
  if ((endAtMs - startAtMs) / 3_600_000 > MAX_SHIFT_DURATION_HOURS) {
    throw new HttpsError('invalid-argument', `Shift duration cannot exceed ${MAX_SHIFT_DURATION_HOURS} hours.`);
  }
  if (payRate != null && payRate < 0) throw new HttpsError('invalid-argument', 'payRate cannot be negative.');
  if (notes && notes.length > 2000) throw new HttpsError('invalid-argument', 'notes must be 2000 characters or less.');

  const ref = db.collection('orgs').doc(orgId).collection('shifts').doc();
  const now = Timestamp.now();

  await ref.set({
    orgId,
    title,
    locationId,
    locationName,
    startAt: Timestamp.fromMillis(startAtMs),
    endAt: Timestamp.fromMillis(endAtMs),
    status,
    marketplaceVisible: status !== 'draft',
    requiredJobRole,
    requiredJobRoles,
    assignedUserId: null,
    payRate,
    notes,
    createdAt: now,
    createdBy: ctx.uid,
    updatedAt: now,
    updatedBy: ctx.uid,
  });

  await writeAudit(orgId, {
    action: 'shift.create',
    actorUid: ctx.uid,
    target: { shiftId: ref.id },
    details: { title, locationId, locationName, startAtMs, endAtMs, status, requiredJobRole, requiredJobRoles, payRate },
  });

  return { ok: true, shiftId: ref.id };
});
