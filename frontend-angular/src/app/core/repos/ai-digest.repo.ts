import { Injectable } from '@angular/core';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';

export interface AiDigestGap {
  shiftId: string;
  title: string;
  locationName: string;
  status: string;
  requiredJobRole: string | null;
  startAtMs: number;
  needsPublish: boolean;
}

export interface AiDigestProposal {
  id: string;
  kind: 'create_shift' | 'assign_shift' | 'publish_shift' | 'unassign_shift';
  summary: string;
  payload: Record<string, any>;
}

export interface AiDigest {
  id: string;
  dateKey: string;
  generatedAt: any;
  summary: string;
  gaps: AiDigestGap[];
  proposals: AiDigestProposal[];
}

@Injectable({ providedIn: 'root' })
export class AiDigestRepo {
  constructor(private fs: FirestoreClient) {}

  watchLatest(orgId: string, cb: (digest: AiDigest | null) => void) {
    const col = collection(this.fs.db, `orgs/${orgId}/aiDigests`);
    const q = query(col, orderBy('generatedAt', 'desc'), limit(1));
    return onSnapshot(q, (snap) => {
      const doc = snap.docs[0];
      this.fs.run(() => cb(doc ? ({ id: doc.id, ...(doc.data() as any) } as AiDigest) : null));
    }, (error: unknown) => {
      console.warn('[InnovaShift] AI digest listener failed.', error);
      this.fs.run(() => cb(null));
    });
  }
}
