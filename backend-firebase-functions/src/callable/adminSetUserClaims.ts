import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireSuperAdmin } from '../infra/auth';
import { writeAudit } from '../infra/audit';
import { Timestamp } from 'firebase-admin/firestore';
import { assertOrgCanAddActiveUser } from '../infra/plans';

type AccessRole = 'staff'|'manager'|'scheduler'|'admin'|'hr';
type PlatformRole = 'superAdmin'|null;

function assertAccessRole(role:any):AccessRole{
  const allowed:AccessRole[]=['staff','manager','scheduler','admin','hr'];
  if(!allowed.includes(role)) throw new HttpsError('invalid-argument','Invalid accessRole.');
  return role;
}
function assertPlatformRole(role:any):PlatformRole{
  if(role===null||role===undefined) return null;
  const v = String(role).trim();
  if(v==='superAdmin' || v==='super_admin' || v==='super-admin') return 'superAdmin';
  throw new HttpsError('invalid-argument','Invalid platformRole.');
}

export const adminSetUserClaims = onCall(async (req) => {
  const admin=initFirebase(); const db=admin.firestore();
  const caller=getClaims(req);

  const targetUid=String(req.data?.uid||'');
  const targetOrgId=String(req.data?.orgId||'');
  const accessRole=assertAccessRole(req.data?.accessRole);
  const platformRole=assertPlatformRole(req.data?.platformRole);
  const jobRole=String(req.data?.jobRole||'RN');
  const active=req.data?.active===false?false:true;

  if(!targetUid) throw new HttpsError('invalid-argument','uid is required.');
  if(!targetOrgId && platformRole!=='superAdmin') throw new HttpsError('invalid-argument','orgId is required unless setting superAdmin.');

  let callerIsSuper = false;
  try {
    await requireSuperAdmin(caller);
    callerIsSuper = true;
  } catch {
    callerIsSuper = false;
  }
  const callerOrg = caller.orgId;

  if(!callerIsSuper){
    if(!callerOrg) throw new HttpsError('permission-denied','Caller has no orgId claim.');
    if(targetOrgId!==callerOrg) throw new HttpsError('permission-denied','Cross-org update not allowed.');
    // Role assignment (including granting 'admin' itself) is admin-only —
    // scheduler/manager/hr must not be able to escalate their own or
    // anyone else's accessRole. Mirrors adminInviteUser's "elevated roles
    // are provisioned by super-admin workflows" policy for org-level callers.
    if(String(caller.accessRole)!=='admin') throw new HttpsError('permission-denied','Admin required.');
    if(platformRole==='superAdmin') throw new HttpsError('permission-denied','Only superAdmin can assign superAdmin.');
  }

  if (targetOrgId && active) {
    const [orgSnap, orgUserSnap] = await Promise.all([
      db.collection('orgs').doc(targetOrgId).get(),
      db.collection('orgs').doc(targetOrgId).collection('users').doc(targetUid).get(),
    ]);
    const alreadyActiveInOrg = orgUserSnap.exists && orgUserSnap.data()?.active !== false;
    if (!alreadyActiveInOrg) {
      await assertOrgCanAddActiveUser(db, targetOrgId, orgSnap.data()?.plan, targetUid);
    }
  }

  await admin.auth().setCustomUserClaims(targetUid, { orgId: targetOrgId || callerOrg || null, accessRole, platformRole: platformRole ?? null });

  if(targetOrgId){
    await db.collection('orgs').doc(targetOrgId).collection('users').doc(targetUid).set({
      uid: targetUid, orgId: targetOrgId, accessRole, jobRole, active, createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
    }, { merge:true });
  }

  await db.collection('platformUsers').doc(targetUid).set({
    uid: targetUid, platformRole: platformRole ?? null, updatedAt: Timestamp.now()
  }, { merge:true });

  const auditOrg = targetOrgId || callerOrg;
  if(auditOrg){
    await writeAudit(auditOrg,{ actorUserId: caller.uid, action:'SET_USER_CLAIMS', entityType:'user', entityId: targetUid, targetOrgId, accessRole, platformRole, jobRole, active });
  }

  return { ok:true };
});
