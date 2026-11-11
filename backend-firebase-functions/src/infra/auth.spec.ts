import { describe, it, expect, vi, beforeEach } from 'vitest';

// Root users/{uid} and platformUsers/{uid} documents, as the callable layer would read them.
const docs = new Map<string, Record<string, unknown>>();
vi.mock('./firebase', () => ({
  initFirebase: () => ({
    firestore: () => ({
      doc: (path: string) => ({
        get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
      }),
    }),
  }),
}));

import { requireSuperAdmin } from './auth';

beforeEach(() => docs.clear());

describe('requireSuperAdmin (platform boundary)', () => {
  it('rejects an ordinary organization admin (accessRole admin on users/{uid}), as createOrg and adminInviteUser write it', async () => {
    docs.set('users/orgAdmin', { uid: 'orgAdmin', orgId: 'orgA', accessRole: 'admin', platformRole: null });
    await expect(requireSuperAdmin({ uid: 'orgAdmin', orgId: 'orgA', accessRole: 'admin' })).rejects.toThrow(/Super admin/);
  });

  it('rejects the legacy role field too', async () => {
    docs.set('users/legacy', { uid: 'legacy', orgId: 'orgA', role: 'admin' });
    await expect(requireSuperAdmin({ uid: 'legacy', orgId: 'orgA' })).rejects.toThrow(/Super admin/);
  });

  it('accepts an explicit platformRole on users/{uid} or platformUsers/{uid}', async () => {
    docs.set('users/owner', { uid: 'owner', platformRole: 'superAdmin' });
    await expect(requireSuperAdmin({ uid: 'owner' })).resolves.toBe(true);
    docs.set('platformUsers/ops', { platformRole: 'super_admin' });
    await expect(requireSuperAdmin({ uid: 'ops' })).resolves.toBe(true);
  });

  it('accepts the platformRole custom claim without a document lookup', async () => {
    await expect(requireSuperAdmin({ uid: 'nobody', platformRole: 'superAdmin' })).resolves.toBe(true);
  });

  it('rejects unknown users', async () => {
    await expect(requireSuperAdmin({ uid: 'ghost' })).rejects.toThrow(/Super admin/);
  });
});
