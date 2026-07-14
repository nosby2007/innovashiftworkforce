import { Injectable } from '@angular/core';
import { FunctionsClient } from '../functions/functions.client';
import { OrgContextService } from '../tenancy/org-context.service';

@Injectable({ providedIn: 'root' })
export class ShiftsCommands {
  constructor(private fx: FunctionsClient, private ctx: OrgContextService) {}
  async claimShift(shiftId: string) {
    if (!this.ctx.orgId()) throw new Error('Missing org context.');
    return this.fx.call('claimShift', { shiftId });
  }

  async listShiftSwapCandidates(shiftId: string) {
    if (!this.ctx.orgId()) throw new Error('Missing org context.');
    return this.fx.call('listShiftSwapCandidates', { shiftId });
  }

  async requestShiftSwap(payload: {
    shiftId: string;
    targetUid: string;
    targetShiftId?: string | null;
    note?: string | null;
  }) {
    if (!this.ctx.orgId()) throw new Error('Missing org context.');
    return this.fx.call('requestShiftSwap', payload);
  }

  async respondShiftSwap(requestId: string, decision: 'accept' | 'reject' | 'cancel', decisionNote?: string | null) {
    if (!this.ctx.orgId()) throw new Error('Missing org context.');
    return this.fx.call('respondShiftSwap', { requestId, decision, decisionNote });
  }

  async listShiftSwapRequests(status?: string, limit = 100) {
    if (!this.ctx.orgId()) throw new Error('Missing org context.');
    return this.fx.call('listShiftSwapRequests', { status: status || undefined, limit });
  }
}
