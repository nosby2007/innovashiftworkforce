import { Injectable } from '@angular/core';
import { FunctionsClient } from '../functions/functions.client';

@Injectable({ providedIn: 'root' })
export class ShiftAdminCommands {
  constructor(private fn: FunctionsClient) {}

  createShift(payload: {
    title: string;
    locationName: string;
    locationId?: string | null;
    startAtMs: number;
    endAtMs: number;
    requiredJobRole?: string | null;
    payRate?: number | null;
    notes?: string | null;
  }) {
    return this.fn.call('createShift', payload);
  }

  rescheduleShift(shiftId: string, startAtMs: number, endAtMs: number) {
    return this.fn.call('rescheduleShift', { shiftId, startAtMs, endAtMs });
  }

  externalNotify(channel: 'email'|'sms', to: string, message: string, subject?: string) {
    return this.fn.call('externalNotifyCallable', { channel, to, message, subject });
  }
}
