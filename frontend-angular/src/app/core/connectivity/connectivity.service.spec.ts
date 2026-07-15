import { describe, it, expect } from 'vitest';
import { ConnectivityService, OfflineError } from './connectivity.service';

describe('ConnectivityService', () => {
  it('does not throw when online', () => {
    const svc = new ConnectivityService();
    svc.online.set(true);
    expect(() => svc.assertOnline()).not.toThrow();
  });

  it('throws an OfflineError when offline', () => {
    const svc = new ConnectivityService();
    svc.online.set(false);
    expect(() => svc.assertOnline()).toThrow(OfflineError);
  });

  it('honors a custom message', () => {
    const svc = new ConnectivityService();
    svc.online.set(false);
    expect(() => svc.assertOnline('Custom offline message')).toThrow('Custom offline message');
  });

  it('OfflineError exposes a stable code for formatSupportError', () => {
    const err = new OfflineError();
    expect(err.code).toBe('offline');
  });
});
