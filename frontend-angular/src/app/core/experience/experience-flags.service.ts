import { Injectable, OnDestroy, computed, effect, signal } from '@angular/core';
import { doc, getFirestore, onSnapshot } from 'firebase/firestore';
import { OrgContextService } from '../tenancy/org-context.service';
import {
  DEFAULT_EXPERIENCE_FLAGS,
  ExperienceFlagKey,
  ExperienceFlags,
  normalizeExperienceFlags,
} from './experience-flags.model';

@Injectable({ providedIn: 'root' })
export class ExperienceFlagsService implements OnDestroy {
  private readonly flagsSignal = signal<ExperienceFlags>({ ...DEFAULT_EXPERIENCE_FLAGS });
  private unsubscribe: (() => void) | null = null;

  readonly flags = computed(() => this.flagsSignal());
  readonly anyNextExperienceEnabled = computed(() => Object.values(this.flagsSignal()).some(Boolean));

  constructor(private ctx: OrgContextService) {
    effect(() => {
      const orgId = this.ctx.orgId();
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.flagsSignal.set({ ...DEFAULT_EXPERIENCE_FLAGS });

      if (!orgId) return;

      this.unsubscribe = onSnapshot(
        doc(getFirestore(), 'orgs', orgId),
        (snap) => {
          const data = snap.exists() ? (snap.data() as any) : {};
          this.flagsSignal.set(normalizeExperienceFlags(data?.experienceFlags));
        },
        () => {
          this.flagsSignal.set({ ...DEFAULT_EXPERIENCE_FLAGS });
        }
      );
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  enabled(key: ExperienceFlagKey): boolean {
    return this.flagsSignal()[key] === true;
  }
}
