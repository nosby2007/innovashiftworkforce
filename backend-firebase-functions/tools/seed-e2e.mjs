process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import admin from 'firebase-admin';

admin.initializeApp({ projectId: 'atlanta-e04aa' });

const ORG_ID = 'ORG_001';
const ADMIN_UID = 'e2e-admin-uid';
const EMP_UID = 'e2e-emp-uid';

const ADMIN_EMAIL = 'e2e.admin@innovashift.local';
const EMP_EMAIL = 'e2e.staff@innovashift.local';
const PASSWORD = 'E2e!Pass1234';

const ACTIVE_SHIFT_ID = 'SHIFT_E2E_ACTIVE';
const HISTORY_SHIFT_ID = 'SHIFT_E2E_HISTORY';
const HISTORY_ENTRY_ID = 'ENTRY_E2E_HISTORY';

async function upsertUser(uid, email, displayName) {
  try {
    await admin.auth().getUser(uid);
    await admin.auth().updateUser(uid, { email, password: PASSWORD, displayName, emailVerified: true });
  } catch {
    await admin.auth().createUser({ uid, email, password: PASSWORD, displayName, emailVerified: true });
  }
}

async function main() {
  const db = admin.firestore();
  const now = Date.now();

  await db.doc(`orgs/${ORG_ID}`).set(
    {
      orgId: ORG_ID,
      name: 'Innovacare',
      active: true,
      plan: 'pro',
      planStatus: 'active',
      defaultPayRate: 24,
      gpsAttendanceEnabled: false,
      updatedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true }
  );

  await upsertUser(ADMIN_UID, ADMIN_EMAIL, 'E2E Admin');
  await upsertUser(EMP_UID, EMP_EMAIL, 'E2E Staff');

  await admin.auth().setCustomUserClaims(ADMIN_UID, {
    orgId: ORG_ID,
    accessRole: 'admin',
    platformRole: null,
  });
  await admin.auth().setCustomUserClaims(EMP_UID, {
    orgId: ORG_ID,
    accessRole: 'staff',
    platformRole: null,
  });

  const users = [
    {
      uid: ADMIN_UID,
      email: ADMIN_EMAIL,
      displayName: 'E2E Admin',
      accessRole: 'admin',
      jobRole: 'RN',
      platformRole: 'admin',
    },
    {
      uid: EMP_UID,
      email: EMP_EMAIL,
      displayName: 'E2E Staff',
      accessRole: 'staff',
      jobRole: 'CNA',
      platformRole: 'staff',
    },
  ];

  for (const user of users) {
    await db.doc(`orgs/${ORG_ID}/users/${user.uid}`).set(
      {
        uid: user.uid,
        orgId: ORG_ID,
        email: user.email,
        displayName: user.displayName,
        accessRole: user.accessRole,
        jobRole: user.jobRole,
        active: true,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true }
    );

    await db.doc(`users/${user.uid}`).set(
      {
        uid: user.uid,
        orgId: ORG_ID,
        email: user.email,
        displayName: user.displayName,
        accessRole: user.accessRole,
        jobRole: user.jobRole,
        platformRole: user.platformRole,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true }
    );

    await db.doc(`platformUsers/${user.uid}`).set(
      {
        uid: user.uid,
        platformRole: user.platformRole,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true }
    );
  }

  const activeStart = now - 30 * 60 * 1000;
  const activeEnd = now + 90 * 60 * 1000;
  await db.doc(`orgs/${ORG_ID}/shifts/${ACTIVE_SHIFT_ID}`).set(
    {
      orgId: ORG_ID,
      title: 'E2E Active Shift',
      locationName: 'Perry, GA',
      locationId: 'site-e2e',
      requiredJobRole: 'CNA',
      payRate: 26,
      status: 'claimed',
      assignedUserId: EMP_UID,
      marketplaceVisible: false,
      startAt: admin.firestore.Timestamp.fromMillis(activeStart),
      endAt: admin.firestore.Timestamp.fromMillis(activeEnd),
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      createdBy: ADMIN_UID,
    },
    { merge: true }
  );

  const histStart = now - 4 * 60 * 60 * 1000;
  const histEnd = now - 2 * 60 * 60 * 1000;
  await db.doc(`orgs/${ORG_ID}/shifts/${HISTORY_SHIFT_ID}`).set(
    {
      orgId: ORG_ID,
      title: 'E2E History Shift',
      locationName: 'Perry, GA',
      locationId: 'site-e2e',
      requiredJobRole: 'CNA',
      payRate: 25,
      status: 'completed',
      assignedUserId: EMP_UID,
      startAt: admin.firestore.Timestamp.fromMillis(histStart),
      endAt: admin.firestore.Timestamp.fromMillis(histEnd),
      clockOutAt: admin.firestore.Timestamp.fromMillis(histEnd),
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      createdBy: ADMIN_UID,
    },
    { merge: true }
  );

  await db.doc(`orgs/${ORG_ID}/timeEntries/${HISTORY_ENTRY_ID}`).set(
    {
      orgId: ORG_ID,
      userId: EMP_UID,
      shiftId: HISTORY_SHIFT_ID,
      method: 'manual',
      checkInAt: admin.firestore.Timestamp.fromMillis(histStart),
      checkOutAt: admin.firestore.Timestamp.fromMillis(histEnd),
      onBreak: false,
      breakStartedAt: null,
      totalBreakMs: 0,
      locationVerified: true,
      exceptionStatus: 'none',
      correctionReason: null,
      correctionRequestedBy: null,
      correctionRequestedAt: null,
      requestedCheckInAt: null,
      requestedCheckOutAt: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true }
  );

  const openEntries = await db.collection(`orgs/${ORG_ID}/timeEntries`)
    .where('userId', '==', EMP_UID)
    .where('checkOutAt', '==', null)
    .get();

  for (const docSnap of openEntries.docs) {
    if (docSnap.id !== HISTORY_ENTRY_ID) {
      await docSnap.ref.delete();
    }
  }

  console.log('E2E SEED READY');
  console.log(JSON.stringify({
    orgId: ORG_ID,
    admin: { uid: ADMIN_UID, email: ADMIN_EMAIL, password: PASSWORD },
    employee: { uid: EMP_UID, email: EMP_EMAIL, password: PASSWORD },
    shifts: { active: ACTIVE_SHIFT_ID, history: HISTORY_SHIFT_ID },
    entry: HISTORY_ENTRY_ID,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
