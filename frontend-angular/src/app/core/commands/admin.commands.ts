import { Injectable } from '@angular/core';
import { FunctionsClient } from '../functions/functions.client';

@Injectable({ providedIn: 'root' })
export class AdminCommands {
  constructor(private fx: FunctionsClient) {}
  async decideTimeCorrection(
    entryId: string,
    decision: 'approved'|'rejected',
    options?: { decisionReason?: string; force?: boolean }
  ) {
    return this.fx.call('approveTimeCorrection', {
      entryId,
      decision,
      decisionReason: options?.decisionReason,
      force: options?.force,
    });
  }

  async applyTimeCorrection(payload: {
    entryId: string;
    correctedCheckInAtMs?: number;
    correctedCheckOutAtMs?: number;
    decisionReason?: string;
    force?: boolean;
  }) {
    return this.fx.call('approveTimeCorrection', {
      entryId: payload.entryId,
      decision: 'approved',
      correctedCheckInAtMs: payload.correctedCheckInAtMs,
      correctedCheckOutAtMs: payload.correctedCheckOutAtMs,
      decisionReason: payload.decisionReason,
      force: payload.force,
    });
  }

  async sendMessage(payload: {
    title: string;
    body: string;
    type?: string;
    targetType: 'single' | 'multi' | 'orgAll' | 'platformAll';
    userIds?: string[];
    inApp?: boolean;
    internet?: boolean;
    internetChannel?: 'email' | 'sms';
  }) {
    return this.fx.call('sendMessage', payload);
  }

  async reviewEmployeeDocument(payload: {
    orgId: string;
    documentId: string;
    decision: 'verified' | 'rejected';
    reviewNote?: string;
  }) {
    return this.fx.call('reviewEmployeeDocument', payload);
  }

  async deleteTimeEntry(entryId: string, reason: string) {
    return this.fx.call('deleteTimeEntry', { entryId, reason });
  }
}
