import { Injectable } from '@angular/core';
import { FunctionsClient } from '../functions/functions.client';


@Injectable({ providedIn: 'root' })
export class AdminShiftsService {
  constructor(private fn: FunctionsClient) {}

  async createShift(payload: {
    orgId: string;
    title: string;
    locationId?: string | null;
    locationName?: string;
    startAtIso: string;   // ISO string
    endAtIso: string;     // ISO string
    requiredJobRoles: string[];
    status?: 'draft' | 'open' | 'published';
    publish?: boolean;
  }) {
    const startAtMs = new Date(payload.startAtIso).getTime();
    const endAtMs = new Date(payload.endAtIso).getTime();
    return this.fn.call('createShift', {
      orgId: payload.orgId,
      title: payload.title,
      locationId: payload.locationId ?? null,
      locationName: payload.locationName,
      startAtMs,
      endAtMs,
      requiredJobRoles: payload.requiredJobRoles,
      status: payload.status,
      publish: payload.publish,
    });
  }
}
