import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { normalizeOrgPlan } from '../infra/plans';

function validateMethod(m:any){ if(m!=='qr' && m!=='manual' && m!=='gps') throw new HttpsError('invalid-argument','method must be qr, gps or manual.'); return m as 'qr'|'manual'|'gps'; }

function haversineMeters(lat1:number, lon1:number, lat2:number, lon2:number){
  const toRad = (value:number) => value * Math.PI / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeSites(raw:any): any[] {
  return Array.isArray(raw) ? raw.filter(Boolean) : [];
}

function assertGpsPayload(data:any) {
  const lat = Number(data?.latitude);
  const lng = Number(data?.longitude);
  const accuracyM = Number(data?.accuracyM || 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new HttpsError('invalid-argument', 'latitude and longitude are required for gps verification.');
  }
  return { lat, lng, accuracyM: Number.isFinite(accuracyM) ? accuracyM : 0 };
}

async function verifyGpsAgainstOrg(db: FirebaseFirestore.Firestore, orgId: string, shiftId: string, org:any, data:any) {
  const { lat, lng, accuracyM } = assertGpsPayload(data);
  const sites = normalizeSites(org?.sites).filter((site) => site?.active !== false);
  if (!sites.length) {
    throw new HttpsError('failed-precondition', 'GPS verification requires at least one configured site.');
  }

  const shiftSnap = await db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId).get();
  const shift = shiftSnap.exists ? (shiftSnap.data() as any) : null;

  const candidateSites = shift?.locationId
    ? sites.filter((site) => String(site.id || '').trim() === String(shift.locationId || '').trim())
    : sites.filter((site) => String(site.name || '').trim().toLowerCase() === String(shift?.locationName || '').trim().toLowerCase());

  const pool = candidateSites.length ? candidateSites : sites;
  const matchedSite = pool.find((site) => {
    const siteLat = Number(site.latitude);
    const siteLng = Number(site.longitude);
    const radiusM = Number(site.radiusM || 150);
    if (!Number.isFinite(siteLat) || !Number.isFinite(siteLng)) return false;
    const distanceM = haversineMeters(lat, lng, siteLat, siteLng);
    return distanceM <= radiusM + Math.max(0, accuracyM);
  });

  if (!matchedSite) {
    throw new HttpsError('permission-denied', 'You are outside the allowed geofence for this shift.');
  }

  return {
    verifiedSiteId: String(matchedSite.id || '').trim() || null,
    geoLat: lat,
    geoLng: lng,
    geoAccuracyM: accuracyM,
  };
}

const DEFAULT_BREAK_REQUIRED_AFTER_HOURS = 6;
const DEFAULT_MIN_REQUIRED_BREAK_MINUTES = 30;

function toMillis(value: any): number {
  return value?.toMillis ? value.toMillis() : Number(value || 0);
}

export const checkIn = onCall(async (req) => {
  const admin=initFirebase(); const db=admin.firestore();
  const ctx = await resolveTenantWithFallback(req);
  const orgId = ctx.orgId;
  const shiftId=String(req.data?.shiftId||''); const method=validateMethod(req.data?.method);
  if(!shiftId) throw new HttpsError('invalid-argument','shiftId is required.');

  // Resume existing active entry if the user reopens the page before clock-out.
  const existingOpenSnap = await db.collection('orgs').doc(orgId).collection('timeEntries')
    .where('userId', '==', ctx.uid)
    .where('checkOutAt', '==', null)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  if (!existingOpenSnap.empty) {
    const existing = existingOpenSnap.docs[0];
    return { ok:true, entryId: existing.id, resumed: true };
  }

  const orgSnap = await db.collection('orgs').doc(orgId).get();
  const org = orgSnap.exists ? (orgSnap.data() as any) : {};
  const plan = normalizeOrgPlan(org?.plan);
  const gpsEnabled = org?.gpsAttendanceEnabled === true;
  if (method === 'gps' && plan === 'starter') {
    throw new HttpsError('permission-denied', 'GPS attendance verification requires Pro or Enterprise plan.');
  }
  if (gpsEnabled && method !== 'gps') {
    throw new HttpsError('failed-precondition', 'This organization requires GPS-verified attendance.');
  }

  // Validate shift assignment before proceeding
  const shiftRef = db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId);
  const shiftSnap = await shiftRef.get();
  if (!shiftSnap.exists) throw new HttpsError('not-found', 'Shift not found.');
  const shift = shiftSnap.data() as any;
  if (shift.assignedUserId && shift.assignedUserId !== ctx.uid) {
    throw new HttpsError('permission-denied', 'You are not assigned to this shift.');
  }
  if (['completed', 'cancelled', 'expired', 'no_show'].includes(shift.status)) {
    throw new HttpsError('failed-precondition', `Cannot clock in: shift is ${shift.status}.`);
  }

  const gpsMeta = method === 'gps'
    ? await verifyGpsAgainstOrg(db, orgId, shiftId, org, req.data)
    : { verifiedSiteId: null, geoLat: null, geoLng: null, geoAccuracyM: null };

  const nowTs = Timestamp.now();
  const now = FieldValue.serverTimestamp();
  const entryRef = db.collection('orgs').doc(orgId).collection('timeEntries').doc();
  await entryRef.set({
    orgId,
    userId: ctx.uid,
    shiftId,
    method,
    checkInAt: now,
    checkOutAt: null,
    onBreak: false,
    breakStartedAt: null,
    totalBreakMs: 0,
    locationVerified: method==='qr' || method==='gps',
    verifiedSiteId: gpsMeta.verifiedSiteId,
    geoLat: gpsMeta.geoLat,
    geoLng: gpsMeta.geoLng,
    geoAccuracyM: gpsMeta.geoAccuracyM,
    exceptionStatus:'none',
    createdAt: now,
    updatedAt: now,
  });

  // Advance shift lifecycle: claimed/assigned/open → in_progress
  await shiftRef.update({
    status: 'in_progress',
    clockInAt: nowTs,
    updatedAt: nowTs,
    auditLog: FieldValue.arrayUnion({
      action: 'CLOCKED_IN',
      actorUserId: ctx.uid,
      at: nowTs,
      note: `Clocked in via ${method}. TimeEntry: ${entryRef.id}`,
    }),
  });

  await writeAudit(orgId,{ actorUserId: ctx.uid, action:'CHECK_IN', entityType:'timeEntry', entityId: entryRef.id, shiftId });
  return { ok:true, entryId: entryRef.id };
});

export const checkOut = onCall(async (req) => {
  const admin=initFirebase(); const db=admin.firestore();
  const ctx = await resolveTenantWithFallback(req);
  const orgId = ctx.orgId;
  const entryId=String(req.data?.entryId||''); const method=validateMethod(req.data?.method);
  if(!entryId) throw new HttpsError('invalid-argument','entryId is required.');
  const ref=db.collection('orgs').doc(orgId).collection('timeEntries').doc(entryId);
  const now=Timestamp.now();

  const orgSnap = await db.collection('orgs').doc(orgId).get();
  const org = orgSnap.exists ? (orgSnap.data() as any) : {};
  const plan = normalizeOrgPlan(org?.plan);
  const gpsEnabled = org?.gpsAttendanceEnabled === true;
  if (method === 'gps' && plan === 'starter') {
    throw new HttpsError('permission-denied', 'GPS attendance verification requires Pro or Enterprise plan.');
  }
  const breakRequiredAfterHours = Number(org?.breakRequiredAfterHours || DEFAULT_BREAK_REQUIRED_AFTER_HOURS);
  const minRequiredBreakMinutes = Math.max(
    DEFAULT_MIN_REQUIRED_BREAK_MINUTES,
    Number(org?.minRequiredBreakMinutes || DEFAULT_MIN_REQUIRED_BREAK_MINUTES)
  );
  const shiftId = String(req.data?.shiftId || '');
  const gpsMeta = method === 'gps'
    ? await verifyGpsAgainstOrg(db, orgId, shiftId, org, req.data)
    : { verifiedSiteId: null, geoLat: null, geoLng: null, geoAccuracyM: null };

  await db.runTransaction(async (tx) => {
    const snap=await tx.get(ref);
    if(!snap.exists) throw new HttpsError('not-found','Time entry not found.');
    const e=snap.data() as any;
    if(e.userId!==ctx.uid) throw new HttpsError('permission-denied','Cannot check out another user.');
    if(e.checkOutAt) throw new HttpsError('failed-precondition','Already checked out.');
    if (gpsEnabled && method !== 'gps') {
      throw new HttpsError('failed-precondition', 'This organization requires GPS-verified attendance.');
    }

    const inMs = toMillis(e.checkInAt);
    let resolvedBreakMs = Math.max(0, Number(e.totalBreakMs || 0));
    let openBreakClosedMs = 0;
    let autoBreakDeductionMs = 0;
    if (inMs > 0) {
      const breakStartedMs = toMillis(e.breakStartedAt);
      if (e.onBreak && breakStartedMs > 0 && now.toMillis() >= breakStartedMs) {
        openBreakClosedMs = Math.max(0, now.toMillis() - breakStartedMs);
        resolvedBreakMs += openBreakClosedMs;
      }

      const grossWorkedMs = Math.max(0, now.toMillis() - inMs);
      const requiredThresholdMs = Math.max(1, breakRequiredAfterHours) * 60 * 60 * 1000;
      const minBreakMs = Math.max(1, minRequiredBreakMinutes) * 60 * 1000;
      if (grossWorkedMs >= requiredThresholdMs && resolvedBreakMs < minBreakMs) {
        autoBreakDeductionMs = minBreakMs - resolvedBreakMs;
        resolvedBreakMs += autoBreakDeductionMs;
      }
    }

    const patch: any = {
      checkOutAt: now,
      method,
      updatedAt: now,
      onBreak: false,
      breakStartedAt: null,
      totalBreakMs: resolvedBreakMs,
      locationVerified: method==='qr' || method==='gps',
      verifiedSiteId: gpsMeta.verifiedSiteId ?? e.verifiedSiteId ?? null,
      geoLat: gpsMeta.geoLat,
      geoLng: gpsMeta.geoLng,
      geoAccuracyM: gpsMeta.geoAccuracyM,
    };

    if (openBreakClosedMs > 0 || autoBreakDeductionMs > 0) {
      patch.breakPolicyLastAppliedAt = now;
      patch.breakPolicyHistory = FieldValue.arrayUnion({
        type: 'checkout_break_policy',
        at: now,
        actorUserId: ctx.uid,
        thresholdHours: Math.max(1, breakRequiredAfterHours),
        minimumBreakMinutes: Math.max(1, minRequiredBreakMinutes),
        openBreakClosedMs,
        autoBreakDeductionMs,
        totalBreakMs: resolvedBreakMs,
        note: autoBreakDeductionMs > 0
          ? 'Automatic meal break deduction applied at checkout.'
          : 'Open break was closed at checkout.',
      });
    }

    tx.update(ref, patch);
  });

  // Advance shift lifecycle: in_progress → completed
  if (shiftId) {
    const shiftRef = db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId);
    const shiftSnap = await shiftRef.get();
    if (shiftSnap.exists) {
      const shiftData = shiftSnap.data() as any;
      if (shiftData.assignedUserId === ctx.uid && shiftData.status === 'in_progress') {
        await shiftRef.update({
          status: 'completed',
          clockOutAt: now,
          updatedAt: now,
          auditLog: FieldValue.arrayUnion({
            action: 'CLOCKED_OUT',
            actorUserId: ctx.uid,
            at: now,
            note: `Clocked out via ${method}. TimeEntry: ${entryId}`,
          }),
        });
      }
    }
  }

  await writeAudit(orgId,{ actorUserId: ctx.uid, action:'CHECK_OUT', entityType:'timeEntry', entityId: entryId });
  return { ok:true };
});

export const breakOut = onCall(async (req) => {
  const admin=initFirebase(); const db=admin.firestore();
  const ctx = await resolveTenantWithFallback(req);
  const orgId = ctx.orgId;
  const entryId=String(req.data?.entryId||'');
  if(!entryId) throw new HttpsError('invalid-argument','entryId is required.');

  const ref=db.collection('orgs').doc(orgId).collection('timeEntries').doc(entryId);
  const now=Timestamp.now();

  await db.runTransaction(async (tx) => {
    const snap=await tx.get(ref);
    if(!snap.exists) throw new HttpsError('not-found','Time entry not found.');
    const e=snap.data() as any;
    if(e.userId!==ctx.uid) throw new HttpsError('permission-denied','Cannot break out another user.');
    if(e.checkOutAt) throw new HttpsError('failed-precondition','Already checked out.');
    if(e.onBreak) throw new HttpsError('failed-precondition','Already on break.');

    tx.update(ref,{ onBreak: true, breakStartedAt: now, updatedAt: now });
  });

  await writeAudit(orgId,{ actorUserId: ctx.uid, action:'BREAK_OUT', entityType:'timeEntry', entityId: entryId });
  return { ok:true };
});

export const breakIn = onCall(async (req) => {
  const admin=initFirebase(); const db=admin.firestore();
  const ctx = await resolveTenantWithFallback(req);
  const orgId = ctx.orgId;
  const entryId=String(req.data?.entryId||'');
  if(!entryId) throw new HttpsError('invalid-argument','entryId is required.');

  const ref=db.collection('orgs').doc(orgId).collection('timeEntries').doc(entryId);
  const now=Timestamp.now();

  await db.runTransaction(async (tx) => {
    const snap=await tx.get(ref);
    if(!snap.exists) throw new HttpsError('not-found','Time entry not found.');
    const e=snap.data() as any;
    if(e.userId!==ctx.uid) throw new HttpsError('permission-denied','Cannot break in another user.');
    if(e.checkOutAt) throw new HttpsError('failed-precondition','Already checked out.');
    if(!e.onBreak || !e.breakStartedAt) throw new HttpsError('failed-precondition','Not currently on break.');

    const startedMs = e.breakStartedAt?.toMillis ? e.breakStartedAt.toMillis() : Number(e.breakStartedAt);
    const deltaMs = Math.max(0, now.toMillis() - startedMs);

    tx.update(ref,{
      onBreak: false,
      breakStartedAt: null,
      totalBreakMs: FieldValue.increment(deltaMs),
      updatedAt: now,
    });
  });

  await writeAudit(orgId,{ actorUserId: ctx.uid, action:'BREAK_IN', entityType:'timeEntry', entityId: entryId });
  return { ok:true };
});
