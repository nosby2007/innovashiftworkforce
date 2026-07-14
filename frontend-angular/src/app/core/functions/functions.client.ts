import { Injectable } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';

@Injectable({ providedIn: 'root' })
export class FunctionsClient {
  private fn = getFunctions(undefined, 'us-east1');
  async call(name: string, data: any): Promise<any> {
    const callable = httpsCallable(this.fn, name);
    const res = await callable(data);
    return res.data;
  }
}
