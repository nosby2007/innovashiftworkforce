import { Injectable } from '@angular/core';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

export interface AuthClaims {
  orgId?: string;
  accessRole?: string;
  platformRole?: string;
  jobRole?: string;
}

export interface ResolvedOrgContext {
  orgId?: string;
  accessRole?: string;
  jobRole?: string;
  platformRole?: string;
  plan?: string;
  planStatus?: string;
  countryCode?: string;
  currencyCode?: string;
  payFrequency?: string;
  taxProfile?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = getAuth();

  async waitForAuthState(timeoutMs = 6000): Promise<User | null> {
    if (this.auth.currentUser) return this.auth.currentUser;

    return new Promise<User | null>((resolve) => {
      let done = false;
      let timer: any;

      const finish = (user: User | null) => {
        if (done) return;
        done = true;
        try { unsub(); } catch {}
        if (timer) clearTimeout(timer);
        resolve(user);
      };

      const unsub = onAuthStateChanged(this.auth, (user) => finish(user));
      timer = setTimeout(() => finish(this.auth.currentUser), timeoutMs);
    });
  }

  private normalizePlatformRole(role: unknown): string | undefined {
    const value = String(role ?? '').trim();
    if (!value) return undefined;
    if (value === 'super_admin' || value === 'super-admin' || value === 'superAdmin') return 'superAdmin';
    return value;
  }

  private normalizeAccessRole(role: unknown): string | undefined {
    const value = String(role ?? '').trim();
    if (!value) return undefined;
    if (value === 'super_admin' || value === 'super-admin') return 'admin';
    return value;
  }

  onUserChanged(cb: (user: User | null) => void) {
    return onAuthStateChanged(this.auth, cb);
  }

  async getClaims(forceRefresh = false): Promise<AuthClaims> {
    const user = this.auth.currentUser;
    if (!user) return {};
    const r = await user.getIdTokenResult(forceRefresh);
    const c = r.claims || {};
    return {
      orgId:        (c['orgId'] as string)        || undefined,
      accessRole:   this.normalizeAccessRole(c['accessRole']) as string | undefined,
      platformRole: this.normalizePlatformRole(c['platformRole']) as string | undefined,
      jobRole:      (c['jobRole'] as string)      || undefined,
    };
  }

  /** Fetch display name & email from Firebase Auth profile + org user doc */
  async getUserProfile(uid: string, orgId: string | null): Promise<{ displayName?: string; email?: string }> {
    const user = this.auth.currentUser;
    let profile: { displayName?: string; email?: string } = {
      displayName: user?.displayName ?? undefined,
      email:       user?.email ?? undefined,
    };

    if (orgId) {
      try {
        const db = getFirestore();
        const snap = await getDoc(doc(db, 'orgs', orgId, 'users', uid));
        if (snap.exists()) {
          const d = snap.data();
          if (d['displayName']) profile.displayName = d['displayName'];
          if (d['email'])       profile.email       = d['email'];
        }
      } catch { /* non-critical */ }
    }

    return profile;
  }

  async resolveOrgContext(uid: string): Promise<ResolvedOrgContext> {
    try {
      const db = getFirestore();
      let root: any = null;
      let platform: any = null;

      const [rootUserSnap, platformUserSnap] = await Promise.all([
        getDoc(doc(db, 'users', uid)).catch(() => null),
        getDoc(doc(db, 'platformUsers', uid)).catch(() => null),
      ]);

      root = rootUserSnap?.exists() ? rootUserSnap.data() as any : null;
      platform = platformUserSnap?.exists() ? platformUserSnap.data() as any : null;

      let org: any = null;
      if (root?.orgId) {
        try {
          const orgSnap = await getDoc(doc(db, 'orgs', String(root.orgId)));
          org = orgSnap.exists() ? orgSnap.data() as any : null;
        } catch {
          org = null;
        }
      }

      const rawPlatformRole = root?.platformRole ?? platform?.platformRole;

      return {
        orgId: root?.orgId || undefined,
        accessRole: this.normalizeAccessRole(root?.accessRole ?? root?.role) || undefined,
        jobRole: root?.jobRole || undefined,
        platformRole: this.normalizePlatformRole(rawPlatformRole) || undefined,
        plan: org?.plan || undefined,
        planStatus: org?.planStatus || undefined,
        countryCode: org?.countryCode || undefined,
        currencyCode: org?.currencyCode || undefined,
        payFrequency: org?.payFrequency || undefined,
        taxProfile: org?.taxProfile || undefined,
      };
    } catch {
      return {};
    }
  }
}
