import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { OrgContextService } from '../tenancy/org-context.service';
import { AuthService } from './auth.service';
import { AppLockService } from '../app-lock/app-lock.service';

/**
 * Single source of truth for populating OrgContextService on boot and on
 * every subsequent auth state change. Registered as a blocking APP_INITIALIZER
 * (see app.config.ts) so routing/guards never run against an empty context.
 */
@Injectable({ providedIn: 'root' })
export class SessionBootstrapService {
  private readyPromise: Promise<void> | null = null;
  private platformId = inject(PLATFORM_ID);

  constructor(private auth: AuthService, private ctx: OrgContextService, private appLock: AppLockService) {}

  /** Idempotent: safe to call more than once, always returns the same first-resolution promise. */
  start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    // Prerendering the public marketing pages boots this app config too, but
    // those pages never read OrgContextService and Firebase Auth's client
    // SDK isn't meant to run in Node — skip wiring the listener there.
    if (!isPlatformBrowser(this.platformId)) {
      this.readyPromise = Promise.resolve();
      return this.readyPromise;
    }

    this.readyPromise = new Promise<void>((resolveFirstRun) => {
      let first = true;
      this.auth.onUserChanged(async (user) => {
        // Captured before any await: true only for a session restored from
        // persistence on cold boot, false for an interactive sign-in that
        // happens later in this page's lifetime — we only want to arm the
        // lock in the former case, never right after typing a password.
        const isColdBootRestore = first;
        try {
          if (!user) {
            this.ctx.clear();
            this.appLock.reset();
            return;
          }

          if (isColdBootRestore) {
            void this.appLock.armIfEnabled(user.uid);
          }

          // Already populated for this user (e.g. by a guard) — avoid a redundant refetch.
          if (this.ctx.uid() === user.uid && this.ctx.orgId()) return;

          // Login already force-refreshes claims. On normal boot, use cached claims
          // and Firestore fallback to avoid an extra token network round trip.
          const [claims, fallback] = await Promise.all([
            this.auth.getClaims(false),
            // Always resolve Firestore context to keep plan/planStatus fresh across the app.
            this.auth.resolveOrgContext(user.uid),
          ]);

          const orgId = claims.orgId ?? fallback.orgId ?? null;

          // Fetch user profile (displayName, email) from Auth + Firestore
          const profile = await this.auth.getUserProfile(user.uid, orgId);

          this.ctx.setContext({
            orgId,
            uid:         user.uid,
            accessRole:  claims.accessRole  ?? fallback.accessRole  ?? null,
            platformRole:claims.platformRole ?? fallback.platformRole ?? null,
            jobRole:     claims.jobRole     ?? fallback.jobRole     ?? null,
            displayName: profile.displayName ?? user.displayName ?? null,
            email:       profile.email       ?? user.email       ?? null,
            photoURL:    profile.photoURL    ?? user.photoURL    ?? null,
            plan:        fallback.plan        ?? null,
            planStatus:  fallback.planStatus  ?? null,
            countryCode: fallback.countryCode ?? null,
            currencyCode:fallback.currencyCode?? null,
            payFrequency:fallback.payFrequency?? null,
            taxProfile:  fallback.taxProfile  ?? null,
            formerOrgId: fallback.formerOrgId ?? null,
          });
        } finally {
          if (first) {
            first = false;
            resolveFirstRun();
          }
        }
      });
    });

    return this.readyPromise;
  }
}
