import { Injectable } from '@angular/core';
import { FunctionsClient } from '../functions/functions.client';

@Injectable({ providedIn: 'root' })
export class SchedulerCommands {
  constructor(private fn: FunctionsClient) {}

  listShifts(payload: {
    startAtMs?: number;
    endAtMs?: number;
    status?: 'open'|'published'|'assigned'|'claimed'|'in_progress'|'completed'|'expired'|'cancelled'|'no_show'|'';
    requiredJobRole?: string;
    assignedToMe?: boolean;
    limit?: number;
    afterDocId?: string | null;
  }) {
    return this.fn.call('listShifts', payload);
  }

  postShiftToMarketplace(shiftId: string): Promise<{ ok: boolean; shiftId: string }> {
    return this.fn.call('publishShift', { shiftId, publish: true });
  }

  publishShift(shiftId: string, publish: boolean) {
    return this.fn.call('publishShift', { shiftId, publish });
  }

  assignShift(shiftId: string, assigneeUid: string) {
    return this.fn.call('assignShift', { shiftId, assigneeUid });
  }

  unassignShift(shiftId: string) {
    return this.fn.call('unassignShift', { shiftId });
  }

  deleteShift(shiftId: string) {
    return this.fn.call('deleteShift', { shiftId });
  }
}
