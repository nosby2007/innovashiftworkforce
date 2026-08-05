import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireSuperAdmin } from '../infra/auth';
import { writeAudit } from '../infra/audit';
import { buildSnapshotFromVersion, IndustryProfileVersion } from '../domain/experience-config';

/**
 * SuperAdmin-only: activates a published industry profile version for an
 * org by deep-copying its config sections onto orgs/{orgId}/experience/config.
 * This is the one write path Phase 1 ships — no UI calls it yet (invoked
 * manually/via the seed-QA script against a pilot org). It is not
 * throwaway: Phase 2's setup wizard will call this exact callable.
 *
 * The snapshot is a real deep copy, not a live reference — editing a
 * profile version later (not supported client-side yet) must never
 * silently change an org that already activated it.
 */
export const activateIndustryProfile = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const caller = getClaims(req);
  await requireSuperAdmin(caller);

  const orgId = String(req.data?.orgId || '').trim();
  const industryProfileId = String(req.data?.industryProfileId || '').trim();
  const industryProfileVersionId = String(req.data?.industryProfileVersionId || 'v1').trim();
  if (!orgId) throw new HttpsError('invalid-argument', 'orgId is required.');
  if (!industryProfileId) throw new HttpsError('invalid-argument', 'industryProfileId is required.');

  const orgSnap = await db.collection('orgs').doc(orgId).get();
  if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found.');

  const versionRef = db.collection('industryProfiles').doc(industryProfileId).collection('versions').doc(industryProfileVersionId);
  const versionSnap = await versionRef.get();
  if (!versionSnap.exists) throw new HttpsError('not-found', 'Industry profile version not found.');

  const version = versionSnap.data() as IndustryProfileVersion;
  if (version.status !== 'published') {
    throw new HttpsError('failed-precondition', 'Only published industry profile versions can be activated.');
  }

  const now = Timestamp.now();
  const snapshot = buildSnapshotFromVersion(version);

  await db.collection('orgs').doc(orgId).collection('experience').doc('config').set({
    orgId,
    configurationStatus: 'configured',
    selection: {
      industryProfileId,
      industryProfileVersionId,
      selectedAt: now,
      selectedBy: caller.uid,
      notes: req.data?.notes ? String(req.data.notes).trim().slice(0, 2000) : null,
    },
    industryProfileId,
    industryProfileVersionId,
    snapshot,
    activatedAt: now,
    activatedBy: caller.uid,
    updatedAt: now,
  }, { merge: false });

  await writeAudit(orgId, {
    action: 'experience.industry_profile_activated',
    actorUid: caller.uid,
    target: { orgId },
    details: { industryProfileId, industryProfileVersionId },
  });

  return { ok: true, orgId, industryProfileId, industryProfileVersionId };
});
