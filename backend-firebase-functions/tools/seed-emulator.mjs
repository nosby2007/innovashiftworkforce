process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

import admin from "firebase-admin";
admin.initializeApp({ projectId: "atlanta-e04aa" });

const orgId = "ORG_001";

async function main() {
  const db = admin.firestore();

  // 1) Create org
  await db.doc(`orgs/${orgId}`).set(
    { orgId, name: "Innovacare", active: true },
    { merge: true }
  );

  // 2) Create a super admin user
  const email = "nosby2007@gmail.com";
  const password = "Yolandemakougang2017.@";

  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
  } catch {
    user = await admin.auth().createUser({ email, password, emailVerified: true });
  }

  const uid = user.uid;

  // 3) Claims
  await admin.auth().setCustomUserClaims(uid, {
    orgId,
    accessRole: "admin",
    platformRole: "superAdmin",
  });

  // 4) User docs
  await db.doc(`orgs/${orgId}/users/${uid}`).set(
    { uid: uid, orgId: "ORG_001", accessRole: "admin", jobRole: "RN", active: true },
    { merge: true }
  );

  await db.doc(`platformUsers/${uid}`).set(
    { uid: uid, platformRole: "superAdmin" },
    { merge: true }
  );

  console.log("SEED OK:", { email, password, uid, orgId });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
