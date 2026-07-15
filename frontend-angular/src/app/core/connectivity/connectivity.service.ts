import { Injectable, signal } from '@angular/core';
import { Network } from '@capacitor/network';

/** Thrown by assertOnline() so existing `catch (e) { toast.errorFrom(e, ...) }` call sites render it with no changes needed. */
export class OfflineError extends Error {
  code = 'offline';
  constructor(message = "You're offline. This action needs an internet connection.") {
    super(message);
    this.name = 'OfflineError';
  }
}

/**
 * Read views already work offline via Firestore's persistentLocalCache
 * (see firebase.app.ts) — this service exists for the other half: knowing
 * when writes (Cloud Function calls, Storage uploads) will fail because
 * they require a live connection, so the app can fail fast with a clear
 * message instead of hanging or throwing a cryptic network error.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  readonly online = signal(true);
  private initialized = false;

  constructor() {
    void this.init();
  }

  private async init() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const status = await Network.getStatus();
      this.online.set(status.connected);
    } catch {
      this.online.set(typeof navigator === 'undefined' ? true : navigator.onLine);
    }
    try {
      await Network.addListener('networkStatusChange', (status) => {
        this.online.set(status.connected);
      });
    } catch {
      // Best-effort — if the plugin can't watch for changes, the last known status stands.
    }
  }

  /** Throws OfflineError when there's no connection, otherwise a no-op. */
  assertOnline(message?: string): void {
    if (!this.online()) {
      throw new OfflineError(message);
    }
  }
}
