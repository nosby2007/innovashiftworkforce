import { Injectable, NgZone } from '@angular/core';
import { getFirestore } from 'firebase/firestore';

@Injectable({ providedIn: 'root' })
export class FirestoreClient {
  readonly db = getFirestore();

  constructor(private zone: NgZone) {}

  run<T>(fn: () => T): T {
    return this.zone.run(fn);
  }
}
