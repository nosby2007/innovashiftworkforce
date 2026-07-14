import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

export const onUserCreate = functions.region('us-east1').auth.user().onCreate(async (user) => {
  const db = admin.firestore();

  await db.doc(`users/${user.uid}`).set(
    {
      uid: user.uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      createdAt: admin.firestore.Timestamp.now(),
    },
    { merge: true }
  );
});
