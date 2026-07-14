import { Injectable } from '@angular/core';
import { FunctionsClient } from '../functions/functions.client';

@Injectable({ providedIn: 'root' })
export class AttendanceCommands {
  constructor(private fx: FunctionsClient) {}
  async checkIn(
    shiftId: string,
    method: 'qr'|'manual'|'gps',
    geo?: { latitude: number; longitude: number; accuracyM?: number }
  ) {
    return this.fx.call('checkIn', { shiftId, method, ...geo });
  }
  async checkOut(
    entryId: string,
    method: 'qr'|'manual'|'gps',
    payload?: { shiftId?: string; latitude?: number; longitude?: number; accuracyM?: number }
  ) {
    return this.fx.call('checkOut', { entryId, method, ...payload });
  }

  async breakOut(entryId: string) {
    return this.fx.call('breakOut', { entryId });
  }

  async breakIn(entryId: string) {
    return this.fx.call('breakIn', { entryId });
  }

  async requestTimeCorrection(payload: {
    entryId: string;
    reason: string;
    correctedCheckInAtMs?: number;
    correctedCheckOutAtMs?: number;
  }) {
    return this.fx.call('requestTimeCorrection', payload);
  }
}
