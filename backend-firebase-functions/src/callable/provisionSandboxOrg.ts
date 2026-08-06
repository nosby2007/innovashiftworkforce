import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'node:crypto';
import { initFirebase } from '../infra/firebase';
import { buildSandboxSeed, pickSandboxSeedProfile } from '../domain/sandbox-seed';
import { DEMO_SESSION_DURATION_MS } from '../domain/sandbox-config';

const SHORT_WINDOW_MS = 15 * 60 * 1000; // 1 provisioning per IP per 15 min
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAILY_CAP = 5; // max 5 sandbox orgs per IP per day
const BATCH_LIMIT = 450;

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 40);
}

/**
 * Public, unauthenticated callable — provisions a temporary, sandboxed org
 * ("try a live demo") pre-seeded with fake employees/shifts and returns a
 * custom token the client redeems via signInWithCustomToken(). Deliberately
 * NOT gated by resolveTenantWithFallback, matching contactIntake.ts as the
 * one other unauthenticated public entry point in this codebase.
 *
 * Given its own runtime footprint (cpu/memory/timeoutSeconds) above the
 * global default — it does more Admin SDK/Firestore round trips per call
 * (Auth user create + claims + several doc writes + a batch + custom-token
 * signing) than an ordinary lightweight callable, and it's the first thing
 * a prospect ever sees, so it shouldn't be the one starved by a cold start.
 */
export const provisionSandboxOrg = onCall(
  { region: 'us-east1', cpu: 1, memory: '512MiB', timeoutSeconds: 120 },
  async (req) => {
    const admin = initFirebase();
    const db = admin.firestore();

    const ip = String(req.rawRequest?.headers['x-forwarded-for'] || req.rawRequest?.ip || 'unknown')
      .split(',')[0]
      .trim();
    const userAgent = String(req.rawRequest?.get?.('user-agent') || '').slice(0, 300);
    const ipHash = hashIp(ip);
    const nowMs = Date.now();
    const lockRef = db.collection('sandboxProvisionRateLocks').doc(ipHash);

    let blockReason: 'short-window' | 'daily-cap' | null = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(lockRef);
      const data = snap.exists ? (snap.data() as any) : null;
      const lastAttemptMs = data?.lastAttemptAt?.toMillis ? data.lastAttemptAt.toMillis() : 0;
      const windowStartMs = data?.windowStartAt?.toMillis ? data.windowStartAt.toMillis() : 0;
      const withinDailyWindow = nowMs - windowStartMs < DAILY_WINDOW_MS;
      const dailyCount = Number(data?.dailyCount || 0);

      if (nowMs - lastAttemptMs < SHORT_WINDOW_MS) {
        blockReason = 'short-window';
        return;
      }
      const nextDailyCount = withinDailyWindow ? dailyCount + 1 : 1;
      if (nextDailyCount > DAILY_CAP) {
        blockReason = 'daily-cap';
        return;
      }

      tx.set(lockRef, {
        ipHash,
        userAgent,
        lastAttemptAt: Timestamp.fromMillis(nowMs),
        windowStartAt: withinDailyWindow ? (data?.windowStartAt || Timestamp.fromMillis(nowMs)) : Timestamp.fromMillis(nowMs),
        dailyCount: nextDailyCount,
        expiresAt: Timestamp.fromMillis(nowMs + DAILY_WINDOW_MS),
      }, { merge: true });
    });

    if (blockReason) {
      throw new HttpsError('resource-exhausted',
        blockReason === 'short-window'
          ? 'Please wait a few minutes before starting another demo.'
          : 'Daily demo limit reached for this network. Please try again tomorrow, or contact us for a guided walkthrough.');
    }

    const orgId = `sandbox-${randomBytes(6).toString('hex')}`;
    const profile = pickSandboxSeedProfile(nowMs);
    const demoExpiresAtMs = nowMs + DEMO_SESSION_DURATION_MS;
    const now = Timestamp.fromMillis(nowMs);
    const demoExpiresAt = Timestamp.fromMillis(demoExpiresAtMs);

    let adminUid: string | undefined;
    try {
      const userRecord = await admin.auth().createUser({
        displayName: 'Jamie Rivera (Demo)',
      });
      adminUid = userRecord.uid;

      await admin.auth().setCustomUserClaims(adminUid, {
        orgId,
        accessRole: 'admin',
        platformRole: null,
        isDemo: true,
      });

      const seed = buildSandboxSeed({ nowMs, profile });

      const base = {
        orgId,
        name: profile.orgName,
        active: true,
        plan: 'pro',
        planStatus: 'trialing',
        countryCode: 'US',
        currencyCode: 'USD',
        payFrequency: 'biweekly',
        taxProfile: 'us_federal_state',
        payrollTaxNotes: null,
        isDemo: true,
        demoExpiresAt,
        demoAdminUid: adminUid,
        createdAt: now,
        updatedAt: now,
        createdBy: 'system:provisionSandboxOrg',
      };

      await db.collection('orgDirectory').doc(orgId).set(base, { merge: true });
      await db.collection('orgs').doc(orgId).set(base, { merge: true });

      const orgUsersCol = db.collection('orgs').doc(orgId).collection('users');
      await orgUsersCol.doc(adminUid).set({
        uid: adminUid,
        orgId,
        email: null,
        displayName: 'Jamie Rivera (Demo)',
        accessRole: 'admin',
        jobRole: 'Manager',
        active: true,
        createdAt: now,
        updatedAt: now,
        createdBy: 'system:provisionSandboxOrg',
      });
      await db.doc(`users/${adminUid}`).set({
        uid: adminUid,
        orgId,
        email: null,
        displayName: 'Jamie Rivera (Demo)',
        accessRole: 'admin',
        jobRole: 'Manager',
        platformRole: null,
        active: true,
        updatedAt: now,
      });

      // Batch-write the seeded fake employees/shifts/timeEntries/requests,
      // chunked at BATCH_LIMIT (matches enforceDataRetention.ts's convention,
      // safely under Firestore's 500-write-per-batch cap).
      type WriteOp = { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> };
      const ops: WriteOp[] = [];

      for (const employee of seed.employees) {
        ops.push({
          ref: orgUsersCol.doc(employee.uid),
          data: {
            uid: employee.uid,
            orgId,
            email: employee.email,
            displayName: employee.displayName,
            accessRole: employee.accessRole,
            jobRole: employee.jobRole,
            active: true,
            createdAt: now,
            updatedAt: now,
            createdBy: 'system:provisionSandboxOrg',
          },
        });
      }

      const shiftsCol = db.collection('orgs').doc(orgId).collection('shifts');
      for (const shift of seed.shifts) {
        ops.push({
          ref: shiftsCol.doc(shift.id),
          data: {
            orgId,
            title: shift.title,
            locationId: null,
            locationName: shift.locationName,
            startAt: Timestamp.fromMillis(shift.startAtMs),
            endAt: Timestamp.fromMillis(shift.endAtMs),
            status: shift.status,
            marketplaceVisible: shift.marketplaceVisible,
            requiredJobRole: shift.requiredJobRole,
            requiredJobRoles: shift.requiredJobRoles,
            assignedUserId: shift.assignedUserId,
            assignedUserName: shift.assignedUserName,
            payRate: shift.payRate,
            notes: null,
            createdAt: now,
            createdBy: 'system:provisionSandboxOrg',
            updatedAt: now,
            updatedBy: 'system:provisionSandboxOrg',
          },
        });
      }

      const timeEntriesCol = db.collection('orgs').doc(orgId).collection('timeEntries');
      for (const entry of seed.timeEntries) {
        ops.push({
          ref: timeEntriesCol.doc(entry.id),
          data: {
            orgId,
            userId: entry.userId,
            shiftId: entry.shiftId,
            method: 'manual',
            checkInAt: Timestamp.fromMillis(entry.checkInAtMs),
            checkOutAt: Timestamp.fromMillis(entry.checkOutAtMs),
            onBreak: false,
            breakStartedAt: null,
            totalBreakMs: 0,
            locationVerified: false,
            verifiedSiteId: null,
            geoLat: null,
            geoLng: null,
            geoAccuracyM: null,
            exceptionStatus: 'none',
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      const timeOff = seed.timeOffRequest;
      ops.push({
        ref: db.collection('orgs').doc(orgId).collection('requests').doc(timeOff.id),
        data: {
          orgId,
          userId: timeOff.userId,
          displayName: timeOff.displayName,
          type: 'time_off',
          requestType: timeOff.requestType,
          status: 'pending',
          startDate: timeOff.startDate,
          endDate: timeOff.endDate,
          hours: timeOff.hours,
          payRate: null,
          paid: null,
          notes: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const swap = seed.shiftSwapRequest;
      ops.push({
        ref: db.collection('orgs').doc(orgId).collection('shiftSwapRequests').doc(swap.id),
        data: {
          requestId: swap.id,
          orgId,
          status: 'pending',
          kind: 'cover',
          shiftId: swap.shiftId,
          shiftTitle: swap.shiftTitle,
          shiftLocationName: swap.shiftLocationName,
          sourceStartAt: Timestamp.fromMillis(swap.sourceStartAtMs),
          sourceEndAt: Timestamp.fromMillis(swap.sourceEndAtMs),
          requesterUid: swap.requesterUid,
          requesterName: swap.requesterName,
          targetUid: swap.targetUid,
          targetName: swap.targetName,
          targetShiftId: null,
          targetShiftTitle: null,
          targetShiftLocationName: null,
          targetStartAt: null,
          targetEndAt: null,
          note: null,
          createdAt: now,
          updatedAt: now,
          createdBy: swap.requesterUid,
        },
      });

      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const op of ops.slice(i, i + BATCH_LIMIT)) {
          batch.set(op.ref, op.data);
        }
        await batch.commit();
      }

      const customToken = await admin.auth().createCustomToken(adminUid);

      logger.info(`[provisionSandboxOrg] provisioned ${orgId} for ip=${ipHash}`);

      return { ok: true, customToken, orgId, expiresAtMs: demoExpiresAtMs };
    } catch (err) {
      logger.error(`[provisionSandboxOrg] failed for ip=${ipHash}, orgId=${orgId}`, err);
      if (adminUid) {
        await admin.auth().deleteUser(adminUid).catch(() => undefined);
      }
      throw new HttpsError('internal', 'Something went wrong starting your demo. Please try again in a moment.');
    }
  },
);
