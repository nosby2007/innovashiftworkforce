import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { TranslocoModule } from '@jsverse/transloco';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { FunctionsClient } from '../../../core/functions/functions.client';
import { ToastService } from '../../../core/ui/toast.service';

/**
 * "Try the demo here" public CTA — provisions a temporary, fully-seeded
 * sandbox org (backend/callable/provisionSandboxOrg.ts) and signs the
 * visitor straight into the real admin UI, no signup required.
 */
@Component({
  standalone: true,
  selector: 'app-sandbox-cta-button',
  imports: [CommonModule, TranslocoModule],
  template: `
    <button type="button" class="sandbox-cta" [disabled]="loading()" (click)="start()">
      <span *ngIf="loading()" class="sandbox-cta-spinner" aria-hidden="true"></span>
      <span>{{ (loading() ? 'landing.sandboxStarting' : 'landing.sandboxTryDemo') | transloco }}</span>
    </button>
  `,
  styles: [`
    .sandbox-cta {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 13px 26px; border-radius: 12px; border: 1.5px solid var(--bdr, #cbd5e1);
      background: #fff; color: var(--ink, #0f172a); font-weight: 700; font-size: 15px;
      cursor: pointer; transition: background .15s ease, transform .15s ease;
    }
    .sandbox-cta:hover:not([disabled]) { background: #f8fafc; transform: translateY(-1px); }
    .sandbox-cta[disabled] { opacity: 0.6; cursor: not-allowed; }
    .sandbox-cta-spinner {
      display: inline-block; width: 16px; height: 16px;
      border: 2px solid rgba(15,23,42,0.18); border-top-color: rgba(15,23,42,0.7);
      border-radius: 50%; animation: sandboxCtaSpin 0.7s linear infinite;
    }
    @keyframes sandboxCtaSpin { to { transform: rotate(360deg); } }
  `],
})
export class SandboxCtaButtonComponent {
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private fns = inject(FunctionsClient);
  private toast = inject(ToastService);

  loading = signal(false);

  async start() {
    if (!isPlatformBrowser(this.platformId) || this.loading()) return;
    this.loading.set(true);
    try {
      const res = await this.fns.call('provisionSandboxOrg', {});
      const { customToken } = res as { customToken: string };
      await signInWithCustomToken(getAuth(), customToken);
      await getAuth().currentUser?.getIdTokenResult(true);
      await this.router.navigateByUrl('/admin');
    } catch (e: any) {
      const msg = e?.code === 'functions/resource-exhausted'
        ? 'Too many demo starts from this network right now — please try again shortly.'
        : 'Could not start the demo. Please try again in a moment.';
      this.toast.errorFrom(e, msg);
      this.loading.set(false);
    }
  }
}
