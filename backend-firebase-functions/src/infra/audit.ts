import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from './firebase';
export async function writeAudit(orgId:string, entry:any){
  const admin=initFirebase(); const db=admin.firestore();
  await db.collection('orgs').doc(orgId).collection('auditLogs').add({ ...entry, createdAt: Timestamp.now() });
}
