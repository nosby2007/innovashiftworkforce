import { Injectable } from '@angular/core';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FirestoreClient } from '../firestore/firestore.client';

export interface OrgDirectoryItem {
  orgId: string;
  name: string;
  active?: boolean;
  plan?: string;
  planStatus?: string;
  industry?: string;
  timezone?: string;
  contactEmail?: string;
  countryCode?: string;
  currencyCode?: string;
  payFrequency?: string;
  taxProfile?: string;
  maxEmployees?: number;
  defaultPayRate?: number;
  createdAt?: any;
  createdBy?: string | null;
}

@Injectable({ providedIn: 'root' })
export class OrgDirectoryRepo {
  private lastGood: OrgDirectoryItem[] = [];
  private readonly cacheKey = 'innovashift.platformOrgs.cache.v1';

  constructor(private fs: FirestoreClient) {}

  watchOrgs(cb: (items: OrgDirectoryItem[]) => void, max = 100, onError?: (error: unknown) => void) {
    let cancelled = false;
    const cached = this.readCache();
    if (cached.length) {
      this.lastGood = cached;
      this.fs.run(() => cb(cached));
    }

    this.loadOrgs(max)
      .catch(async (firstError) => {
        await getAuth().currentUser?.getIdToken(true).catch(() => undefined);
        return this.loadOrgs(max).catch((secondError) => {
          throw secondError || firstError;
        });
      })
      .then((items) => {
        if (cancelled) return;
        const fallback = this.lastGood.length ? this.lastGood : this.readCache();
        if (items.length === 0 && fallback.length > 0) {
          console.warn('[InnovaShift] Platform org list returned empty; keeping last known tenant list.');
          onError?.(new Error('Platform org list returned empty after a successful non-empty load.'));
          this.fs.run(() => cb(fallback));
          return;
        }
        this.lastGood = items;
        if (items.length > 0) this.writeCache(items);
        this.fs.run(() => cb(items));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn('[InnovaShift] Platform org list failed.', error);
        onError?.(error);
        const fallback = this.lastGood.length ? this.lastGood : this.readCache();
        if (fallback.length) this.fs.run(() => cb(fallback));
      });
    return () => { cancelled = true; };
  }

  private async loadOrgs(max: number): Promise<OrgDirectoryItem[]> {
    const call = httpsCallable<any, any>(getFunctions(undefined, 'us-east1'), 'listPlatformOrgs');
    const res = await call({ limit: max });
    return Array.isArray(res.data?.items) ? res.data.items as OrgDirectoryItem[] : [];
  }

  private readCache(): OrgDirectoryItem[] {
    if (typeof sessionStorage === 'undefined' && typeof localStorage === 'undefined') return [];
    try {
      const raw = sessionStorage?.getItem(this.cacheKey) || localStorage?.getItem(this.cacheKey) || '[]';
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeCache(items: OrgDirectoryItem[]) {
    if (items.length === 0) return;
    if (typeof sessionStorage === 'undefined' && typeof localStorage === 'undefined') return;
    try {
      const payload = JSON.stringify(items.slice(0, 500));
      sessionStorage?.setItem(this.cacheKey, payload);
      localStorage?.setItem(this.cacheKey, payload);
    } catch {
      // Ignore private-mode storage errors.
    }
  }
}
