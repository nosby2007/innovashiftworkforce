process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

import admin from "firebase-admin";

admin.initializeApp({ projectId: "atlanta-e04aa" });

const uid = process.env.SUPERADMIN_UID || "Hvsba4FyAUOdlfQrkcHFTPJ73SKs";
const email = process.env.SUPERADMIN_EMAIL || null;
const displayName = process.env.SUPERADMIN_NAME || "Platform Super Admin";
const orgId = process.env.ORG_ID || null;

async function main() {
  const db = admin.firestore();

  await admin.auth().setCustomUserClaims(uid, {
    orgId,
    accessRole: "admin",
    platformRole: "superAdmin"
  });

  await db.doc(`users/${uid}`).set(
    {
      uid,
      email,
      displayName,
      orgId,
      accessRole: "admin",
      platformRole: "superAdmin",
      jobRole: "RN",
      active: true,
      status: "active",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  await db.doc(`platformUsers/${uid}`).set(
    { uid, platformRole: "superAdmin", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  if (orgId) {
    await db.doc(`orgs/${orgId}`).set(
      { orgId, name: "Innovacare", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    await db.doc(`orgs/${orgId}/users/${uid}`).set(
      {
        uid,
        orgId,
        accessRole: "admin",
        jobRole: "RN",
        active: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  }

  console.log("BOOTSTRAP OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
