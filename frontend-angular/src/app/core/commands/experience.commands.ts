import { Injectable } from '@angular/core';
import { FunctionsClient } from '../functions/functions.client';
import { OrgContextService } from '../tenancy/org-context.service';

@Injectable({ providedIn: 'root' })
export class ExperienceCommands {
  constructor(private fx: FunctionsClient, private ctx: OrgContextService) {}

  async activateIndustryProfile(industryProfileId: string, industryProfileVersionId = 'v1') {
    const orgId = this.ctx.orgId();
    if (!orgId) throw new Error('Missing org context.');
    return this.fx.call('activateIndustryProfile', { orgId, industryProfileId, industryProfileVersionId });
  }
}
