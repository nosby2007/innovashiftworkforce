import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { OrgExperienceService } from './org-experience.service';
import { GENERIC_WORKFORCE_SNAPSHOT } from '../../shared/models/experience-config.defaults';
import { OrganizationExperienceConfig } from '../../shared/models/experience-config.model';

/**
 * effect() requires the full Angular change-detection provider set
 * (ChangeDetectionScheduler etc.), which only TestBed reliably wires up —
 * a bare Injector.create() context isn't enough. This is the one spec in
 * this codebase that needs TestBed; everything else here uses plain `new`
 * (see connectivity.service.spec.ts) because it doesn't touch effect().
 */
function buildService(orgId: string | null, getConfig: (orgId: string) => Promise<OrganizationExperienceConfig | null>) {
  const ctx = { orgId: signal(orgId) } as any;
  const repo = { getConfig: vi.fn(getConfig) } as any;
  const fs = { run: (fn: () => void) => fn() } as any;
  const svc = TestBed.runInInjectionContext(() => new OrgExperienceService(ctx, repo, fs));
  return { svc, ctx };
}

async function flush() {
  TestBed.flushEffects();
  await Promise.resolve();
  await Promise.resolve();
  TestBed.flushEffects();
}

describe('OrgExperienceService', () => {
  it('falls back to the legacy generic config when no org is set', () => {
    const { svc } = buildService(null, async () => null);
    expect(svc.config().configurationStatus).toBe('legacy');
    expect(svc.config().snapshot).toBe(GENERIC_WORKFORCE_SNAPSHOT);
  });

  it('falls back to legacy when the org has no experience/config doc', async () => {
    const { svc } = buildService('org-1', async () => null);
    await flush();
    expect(svc.config().configurationStatus).toBe('legacy');
    expect(svc.config().industryProfileId).toBe('generic_workforce');
  });

  it('returns the resolved config verbatim once the fetch completes', async () => {
    const resolvedConfig: OrganizationExperienceConfig = {
      orgId: 'org-2',
      configurationStatus: 'configured',
      selection: null,
      industryProfileId: 'education',
      industryProfileVersionId: 'v1',
      snapshot: { ...GENERIC_WORKFORCE_SNAPSHOT, terminology: { ...GENERIC_WORKFORCE_SNAPSHOT.terminology, workUnit: { singular: 'Class Session', plural: 'Class Sessions' } } },
      activatedAt: null,
      activatedBy: null,
    };
    const { svc } = buildService('org-2', async () => resolvedConfig);
    await flush();
    expect(svc.config()).toBe(resolvedConfig);
    expect(svc.config().snapshot.terminology.workUnit.singular).toBe('Class Session');
  });

  it('ignores a stale response after the org has switched', async () => {
    let resolveFirst!: (value: OrganizationExperienceConfig | null) => void;
    const firstPromise = new Promise<OrganizationExperienceConfig | null>((resolve) => { resolveFirst = resolve; });

    const orgId = signal<string | null>('org-a');
    const ctx = { orgId } as any;
    const calls: string[] = [];
    const repo = {
      getConfig: vi.fn(async (id: string) => {
        calls.push(id);
        if (id === 'org-a') return firstPromise;
        return null;
      }),
    } as any;
    const fs = { run: (fn: () => void) => fn() } as any;
    const svc = TestBed.runInInjectionContext(() => new OrgExperienceService(ctx, repo, fs));

    await flush();
    orgId.set('org-b');
    await flush();

    // The org-a fetch resolves late, after the user has already switched to org-b.
    resolveFirst({
      orgId: 'org-a',
      configurationStatus: 'configured',
      selection: null,
      industryProfileId: 'healthcare',
      industryProfileVersionId: 'v1',
      snapshot: GENERIC_WORKFORCE_SNAPSHOT,
      activatedAt: null,
      activatedBy: null,
    });
    await flush();

    expect(calls).toEqual(['org-a', 'org-b']);
    // Must NOT have been overwritten with the stale org-a result.
    expect(svc.config().industryProfileId).toBe('generic_workforce');
    expect(svc.config().configurationStatus).toBe('legacy');
  });
});
