import { Injectable, signal } from '@angular/core';

export interface OrgContext {
  orgId: string | null;
  uid: string | null;
  accessRole: string | null;
  platformRole?: string | null;
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
  jobRole?: string | null;
  plan?: string | null;        // SaaS plan: 'free' | 'starter' | 'pro' | 'enterprise'
  planStatus?: string | null;  // 'active' | 'trialing' | 'past_due' | 'canceled'
  countryCode?: string | null;
  currencyCode?: string | null;
  payFrequency?: string | null;
  taxProfile?: string | null;
}

@Injectable({ providedIn: 'root' })
export class OrgContextService {
  readonly orgId       = signal<string | null>(null);
  readonly uid         = signal<string | null>(null);
  readonly accessRole  = signal<string | null>(null);
  readonly platformRole= signal<string | null>(null);
  readonly displayName = signal<string | null>(null);
  readonly email       = signal<string | null>(null);
  readonly photoURL    = signal<string | null>(null);
  readonly jobRole     = signal<string | null>(null);
  readonly plan        = signal<string | null>(null);
  readonly planStatus  = signal<string | null>(null);
  readonly countryCode = signal<string | null>(null);
  readonly currencyCode= signal<string | null>(null);
  readonly payFrequency= signal<string | null>(null);
  readonly taxProfile  = signal<string | null>(null);

  setContext(ctx: OrgContext) {
    this.orgId.set(ctx.orgId);
    this.uid.set(ctx.uid);
    this.accessRole.set(ctx.accessRole);
    this.platformRole.set(ctx.platformRole ?? null);
    this.displayName.set(ctx.displayName ?? null);
    this.email.set(ctx.email ?? null);
    this.photoURL.set(ctx.photoURL ?? null);
    this.jobRole.set(ctx.jobRole ?? null);
    this.plan.set(ctx.plan ?? null);
    this.planStatus.set(ctx.planStatus ?? null);
    this.countryCode.set(ctx.countryCode ?? null);
    this.currencyCode.set(ctx.currencyCode ?? null);
    this.payFrequency.set(ctx.payFrequency ?? null);
    this.taxProfile.set(ctx.taxProfile ?? null);
  }

  clear() {
    this.setContext({
      orgId: null, uid: null, accessRole: null, platformRole: null,
      displayName: null, email: null, photoURL: null, jobRole: null, plan: null, planStatus: null,
      countryCode: null, currencyCode: null, payFrequency: null, taxProfile: null,
    });
  }
}
