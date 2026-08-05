import { Injectable } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';
import { OrganizationExperienceConfig } from '../../shared/models/experience-config.model';

@Injectable({ providedIn: 'root' })
export class OrgExperienceRepo {
  constructor(private fs: FirestoreClient) {}

  /** Returns null if the org hasn't activated an industry profile (the "legacy" case) or on read failure. */
  async getConfig(orgId: string): Promise<OrganizationExperienceConfig | null> {
    try {
      const snap = await getDoc(doc(this.fs.db, 'orgs', orgId, 'experience', 'config'));
      return snap.exists() ? (snap.data() as OrganizationExperienceConfig) : null;
    } catch (error) {
      console.warn('[InnovaShift] Org experience config read failed; falling back to legacy defaults.', error);
      return null;
    }
  }
}
