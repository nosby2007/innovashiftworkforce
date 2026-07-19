import { EffectRef, Injectable, effect, inject } from '@angular/core';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';
import { TranslocoService } from '@jsverse/transloco';
import { OrgContextService } from '../tenancy/org-context.service';

const STORAGE_KEY = 'isw_lang';

export interface LanguageOption {
  code: string;
  label: string;
}

/**
 * Resolves and persists the active UI language. Initial language, in
 * priority order: localStorage (fast, works before auth resolves) ->
 * the signed-in user's saved preferences.language (authoritative,
 * synced across devices) -> browser language -> 'en'. Changing language
 * updates both immediately.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private transloco = inject(TranslocoService);
  private ctx = inject(OrgContextService);
  private effectRef?: EffectRef;
  private loadedForUid: string | null = null;

  static readonly SUPPORTED: readonly string[] = ['en', 'fr'];
  readonly options: LanguageOption[] = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
  ];

  init(): void {
    this.transloco.setActiveLang(this.resolveInitialLang());

    this.effectRef = effect(() => {
      const uid = this.ctx.uid();
      const orgId = this.ctx.orgId();
      if (!uid || !orgId || this.loadedForUid === uid) return;
      this.loadedForUid = uid;
      void this.loadSavedPreference(orgId, uid);
    });
  }

  async setLanguage(lang: string): Promise<void> {
    if (!LanguageService.SUPPORTED.includes(lang)) return;
    this.transloco.setActiveLang(lang);
    this.persistLocally(lang);

    const uid = this.ctx.uid();
    const orgId = this.ctx.orgId();
    if (!uid || !orgId) return;

    try {
      await setDoc(doc(getFirestore(), `orgs/${orgId}/users/${uid}`), {
        preferences: { language: lang },
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      // Best-effort — the language switch already took effect locally
      // regardless of whether the profile write succeeds.
      console.warn('[InnovaShift] Failed to save language preference.', e);
    }
  }

  private resolveInitialLang(): string {
    if (typeof window === 'undefined') return 'en';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && LanguageService.SUPPORTED.includes(stored)) return stored;
    const browserLang = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return LanguageService.SUPPORTED.includes(browserLang) ? browserLang : 'en';
  }

  private async loadSavedPreference(orgId: string, uid: string): Promise<void> {
    try {
      const snap = await getDoc(doc(getFirestore(), `orgs/${orgId}/users/${uid}`));
      const saved = snap.exists() ? (snap.data() as any)?.preferences?.language : null;
      if (saved && LanguageService.SUPPORTED.includes(saved) && saved !== this.transloco.getActiveLang()) {
        this.transloco.setActiveLang(saved);
        this.persistLocally(saved);
      }
    } catch {
      // Best-effort — keep whichever language is already active.
    }
  }

  private persistLocally(lang: string): void {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, lang);
  }
}
