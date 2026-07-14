import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { initFirebase } from '../infra/firebase';

function inNext7Days(ts: any): boolean {
  if (!ts) return false;
  const ms = ts.toMillis ? ts.toMillis() : Number(ts);
  const now = Date.now();
  const end = now + 7 * 24 * 60 * 60 * 1000;
  return ms >= now && ms <= end;
}

export const onShiftWriteMetrics = onDocumentWritten('orgs/{orgId}/shifts/{shiftId}', async (event) => {
  const admin = initFirebase();
  const db = admin.firestore();

  const orgId = event.params.orgId as string;

  const before = event.data?.before?.exists ? event.data.before.data() as any : null;
  const after  = event.data?.after?.exists ? event.data.after.data() as any : null;

  const metricsRef = db.collection('orgs').doc(orgId).collection('metrics').doc('summary');

  const beforeStatus = before?.status ?? null;
  const afterStatus = after?.status ?? null;

  const beforeOpen = beforeStatus && ['open','published'].includes(beforeStatus);
  const afterOpen  = afterStatus && ['open','published'].includes(afterStatus);

  const beforeAssigned = beforeStatus === 'assigned';
  const afterAssigned  = afterStatus === 'assigned';

  const beforeIn7 = beforeOpen && inNext7Days(before?.startAt);
  const afterIn7  = afterOpen && inNext7Days(after?.startAt);

  const inc = admin.firestore.FieldValue.increment;

  const updates: any = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // initialize doc if missing
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(metricsRef);
    if (!snap.exists) {
      tx.set(metricsRef, {
        openCount: 0,
        assignedCount: 0,
        upcoming7dOpenCount: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    // delta counts
    if (beforeOpen !== afterOpen) {
      updates.openCount = inc(afterOpen ? 1 : -1);
    }
    if (beforeAssigned !== afterAssigned) {
      updates.assignedCount = inc(afterAssigned ? 1 : -1);
    }
    if (beforeIn7 !== afterIn7) {
      updates.upcoming7dOpenCount = inc(afterIn7 ? 1 : -1);
    }

    tx.set(metricsRef, updates, { merge: true });
  });
});
