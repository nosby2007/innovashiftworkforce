// Regression test for the cross-tenant escalation where isBootstrapSuperAdmin() treated
// users/{uid}.accessRole == 'admin' (written for EVERY org admin by createOrg and
// adminInviteUser) as platform super-admin.
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-innovashift-rules',
    // Host and port come from FIRESTORE_EMULATOR_HOST, set by `firebase emulators:exec`.
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Org admin of tenant A, exactly as createOrg / adminInviteUser write it.
    await setDoc(doc(db, 'users/adminA'), { uid: 'adminA', orgId: 'orgA', accessRole: 'admin', platformRole: null, active: true });
    await setDoc(doc(db, 'orgs/orgA'), { name: 'Tenant A' });
    await setDoc(doc(db, 'orgs/orgA/users/adminA'), { uid: 'adminA', orgId: 'orgA', accessRole: 'admin', active: true });
    await setDoc(doc(db, 'orgs/orgA/users/staffA'), { uid: 'staffA', orgId: 'orgA', accessRole: 'staff', active: true });
    // Tenant B (victim).
    await setDoc(doc(db, 'users/staffB'), { uid: 'staffB', orgId: 'orgB', email: 'staff@tenant-b.example', accessRole: 'staff', active: true });
    await setDoc(doc(db, 'orgs/orgB'), { name: 'Tenant B' });
    await setDoc(doc(db, 'orgs/orgB/users/staffB'), { uid: 'staffB', orgId: 'orgB', accessRole: 'staff', active: true });
    // A real platform owner.
    await setDoc(doc(db, 'users/owner'), { uid: 'owner', platformRole: 'superAdmin', active: true });
  });
});
after(async () => { await env?.cleanup(); });

const adminA = () => env.authenticatedContext('adminA', { orgId: 'orgA', accessRole: 'admin' }).firestore();
const owner = () => env.authenticatedContext('owner', {}).firestore();

test('an org admin cannot read another tenant\'s root user record', async () => {
  await assertFails(getDoc(doc(adminA(), 'users/staffB')));
});
test('an org admin cannot overwrite another tenant\'s root user record', async () => {
  await assertFails(setDoc(doc(adminA(), 'users/staffB'), { uid: 'staffB', orgId: 'orgA', accessRole: 'admin' }));
});
test('an org admin cannot read another tenant\'s org document or list its users', async () => {
  await assertFails(getDoc(doc(adminA(), 'orgs/orgB')));
  await assertFails(getDocs(collection(adminA(), 'orgs/orgB/users')));
});
test('an org admin cannot grant itself platform authority', async () => {
  await assertFails(setDoc(doc(adminA(), 'users/adminA'), { uid: 'adminA', orgId: 'orgA', accessRole: 'admin', platformRole: 'superAdmin' }));
});
test('control: an org admin still reads its own profile and its own tenant', async () => {
  await assertSucceeds(getDoc(doc(adminA(), 'users/adminA')));
  await assertSucceeds(getDoc(doc(adminA(), 'orgs/orgA')));
  await assertSucceeds(getDocs(collection(adminA(), 'orgs/orgA/users')));
});
test('control: an explicit platformRole superAdmin keeps cross-tenant access', async () => {
  await assertSucceeds(getDoc(doc(owner(), 'users/staffB')));
  await assertSucceeds(getDoc(doc(owner(), 'orgs/orgB')));
});
