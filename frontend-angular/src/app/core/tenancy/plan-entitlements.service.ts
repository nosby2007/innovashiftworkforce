import { Injectable, computed } from '@angular/core';
import { OrgContextService } from './org-context.service';

export type PlanFeature =
  | 'adminAnalytics'
  | 'smartScheduler'
  | 'timesheetsExport'
  | 'auditLog'
  | 'gpsAttendance'
  | 'multiSiteManagement'
  | 'ssoConfig'
  | 'customIntegrations'
  | 'aiCopilot';

const PLAN_ORDER = ['starter', 'pro', 'enterprise'] as const;
const FEATURE_MIN_PLAN: Record<PlanFeature, typeof PLAN_ORDER[number]> = {
  adminAnalytics: 'pro',
  smartScheduler: 'pro',
  timesheetsExport: 'pro',
  auditLog: 'enterprise',
  gpsAttendance: 'pro',
  multiSiteManagement: 'enterprise',
  ssoConfig: 'enterprise',
  customIntegrations: 'enterprise',
  aiCopilot: 'pro',
};

@Injectable({ providedIn: 'root' })
export class PlanEntitlementsService {
  constructor(private ctx: OrgContextService) {}

  effectivePlan = computed(() => {
    const rawPlan = String(this.ctx.plan() || 'free').trim().toLowerCase();
    const rawStatus = String(this.ctx.planStatus() || 'active').trim().toLowerCase();
    const normalizedPlan = rawPlan === 'free' ? 'starter' : rawPlan;
    const activeStatus = rawStatus === 'active' || rawStatus === 'trialing';
    return activeStatus ? normalizedPlan : 'starter';
  });

  has(feature: PlanFeature): boolean {
    const current = this.rank(this.effectivePlan());
    const required = this.rank(FEATURE_MIN_PLAN[feature]);
    return current >= required;
  }

  private rank(plan: string): number {
    const idx = PLAN_ORDER.indexOf(plan as (typeof PLAN_ORDER)[number]);
    return idx === -1 ? 0 : idx;
  }
}
