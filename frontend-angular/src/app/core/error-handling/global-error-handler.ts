import { ErrorHandler, Injectable, Injector } from '@angular/core';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { FirestoreClient } from '../firestore/firestore.client';
import { OrgContextService } from '../tenancy/org-context.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  // Injector is used instead of constructor DI to avoid a circular init
  // order between ErrorHandler and services that themselves may error.
  constructor(private injector: Injector) {}

  handleError(error: unknown): void {
    console.error('[GlobalErrorHandler]', error);

    try {
      const firestore = this.injector.get(FirestoreClient);
      const ctx = this.injector.get(OrgContextService, null);
      const err = error as any;

      addDoc(collection(firestore.db, 'clientErrorLogs'), {
        message: String(err?.message ?? err),
        stack: typeof err?.stack === 'string' ? err.stack.slice(0, 4000) : null,
        url: typeof window !== 'undefined' ? window.location.href : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        uid: ctx?.uid?.() ?? null,
        orgId: ctx?.orgId?.() ?? null,
        createdAt: serverTimestamp(),
      }).catch(() => {
        // Best-effort only — never let logging itself throw.
      });
    } catch {
      // Best-effort only — never let logging itself throw.
    }
  }
}
