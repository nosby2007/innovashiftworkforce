import { Injectable } from '@angular/core';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';
import { IndustryProfile, IndustryProfileVersion } from '../../shared/models/experience-config.model';

/**
 * Read-only access to the global industry profile catalog. No Phase 1 UI
 * consumes this yet — it exists so the catalog is genuinely usable (not
 * decorative) as soon as Phase 2's wizard needs to list profiles.
 */
@Injectable({ providedIn: 'root' })
export class IndustryProfilesRepo {
  constructor(private fs: FirestoreClient) {}

  async listActive(): Promise<IndustryProfile[]> {
    const q = query(collection(this.fs.db, 'industryProfiles'), where('active', '==', true));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as IndustryProfile);
  }

  async getPublishedVersion(profileId: string, versionId: string): Promise<IndustryProfileVersion | null> {
    const snap = await getDoc(doc(this.fs.db, 'industryProfiles', profileId, 'versions', versionId));
    if (!snap.exists()) return null;
    const version = snap.data() as IndustryProfileVersion;
    return version.status === 'published' ? version : null;
  }
}
