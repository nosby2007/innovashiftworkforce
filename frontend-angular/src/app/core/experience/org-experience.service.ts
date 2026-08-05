import { Injectable, computed, effect, signal } from '@angular/core';
import { OrgContextService } from '../tenancy/org-context.service';
import { OrgExperienceRepo } from '../repos/org-experience.repo';
import { FirestoreClient } from '../firestore/firestore.client';
import { OrganizationExperienceConfig } from '../../shared/models/experience-config.model';
import { legacyFallbackConfig } from '../../shared/models/experience-config.defaults';

/**
 * Resolves the current org's Industry Configuration Engine snapshot.
 *
 * Deliberately NOT wired into a blocking APP_INITIALIZER (unlike
 * SessionBootstrapService) — OrgContextService/PlanEntitlementsService are
 * synchronous signal reads, but this needs an async Firestore fetch. Adding
 * it to the boot sequence would cost every page's first paint for a feature
 * most orgs haven't opted into. Instead this fetches lazily on first access
 * and the computed `config()` starts (and, for ~100% of orgs today, stays)
 * at the legacy/generic default — so consumers render correct-by-default
 * text immediately, then confirm-and-noop once the (non-existent, for most
 * orgs) doc read resolves.
 */
@Injectable({ providedIn: 'root' })
export class OrgExperienceService {
  private loadedOrgId: string | null = null;
  private resolved = signal<OrganizationExperienceConfig | null>(null);

  constructor(
    private ctx: OrgContextService,
    private repo: OrgExperienceRepo,
    private fs: FirestoreClient
  ) {
    effect(() => {
      const orgId = this.ctx.orgId();
      if (!orgId || orgId === this.loadedOrgId) return;
      this.loadedOrgId = orgId;
      this.repo.getConfig(orgId).then((cfg) => {
        if (this.ctx.orgId() !== orgId) return; // stale response after an org switch (e.g. revoked-employee flows)
        this.fs.run(() => this.resolved.set(cfg));
      });
    });
  }

  /** Never throws, never returns an undefined section — legacy fallback is baked in. */
  readonly config = computed<OrganizationExperienceConfig>(() => {
    return this.resolved() ?? legacyFallbackConfig(this.ctx.orgId() ?? '');
  });

  readonly configurationStatus = computed(() => this.config().configurationStatus);
}
