import { Injectable } from '@angular/core';
import { FunctionsClient } from '../functions/functions.client';
import { OrgContextService } from '../tenancy/org-context.service';

@Injectable({ providedIn: 'root' })
export class MessagesCommands {
  constructor(private fx: FunctionsClient, private ctx: OrgContextService) {}
  async markRead(messageId: string) {
    if (!this.ctx.orgId()) throw new Error('Missing org context.');
    return this.fx.call('markMessageRead', { messageId });
  }
}
