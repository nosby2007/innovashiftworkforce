import { Injectable } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ConnectivityService } from '../connectivity/connectivity.service';

@Injectable({ providedIn: 'root' })
export class FunctionsClient {
  private fn = getFunctions(undefined, 'us-east1');

  constructor(private connectivity: ConnectivityService) {}

  async call(name: string, data: any): Promise<any> {
    // Every callable requires a live connection to reach server-side
    // validation (geofence checks, business rules, audit logging) — fail
    // fast with a clear message rather than hanging or throwing a raw
    // network error. This single guard covers every call site in the app.
    this.connectivity.assertOnline();
    const callable = httpsCallable(this.fn, name);
    const res = await callable(data);
    return res.data;
  }
}
