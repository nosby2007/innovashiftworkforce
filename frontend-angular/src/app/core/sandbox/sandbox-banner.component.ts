import { Component, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, Router } from '@angular/router';
import { getAuth, signOut } from 'firebase/auth';
import { OrgContextService } from '../tenancy/org-context.service';
import { ToastService } from '../ui/toast.service';

const EXPIRY_CHECK_INTERVAL_MS = 30_000;

/**
 * Persistent "you're in a live demo" banner for a sandbox org (see
 * callable/provisionSandboxOrg.ts). Mirrors OfflineBannerComponent's
 * fixed/signal-gated shape, pinned to the opposite edge (top) so it never
 * collides with the offline banner (bottom). No dismiss button — visibility
 * is driven entirely by the live ctx.isDemo() signal, not local state, so a
 * demo visitor can't just close it and keep going. The only ways it goes
 * away are "Sign up" (navigate off, stay signed in) or "Exit demo"
 * (sign out) or the session actually expiring.
 */
@Component({
  standalone: true,
  selector: 'app-sandbox-banner',
  imports: [CommonModule, MatIconModule, RouterLink],
  template: `
    <div class="sb-banner" *ngIf="ctx.isDemo()">
      <mat-icon>science</mat-icon>
      <span>You're exploring a live demo — this data resets automatically in a few hours.</span>
      <a routerLink="/pricing" class="sb-banner__cta">Sign up</a>
      <button type="button" (click)="exit()" class="sb-banner__exit">Exit demo</button>
    </div>
  `,
  styles: [`
    .sb-banner {
      position: fixed; left: 0; right: 0; top: 0; z-index: 4000;
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 9px 14px calc(9px + env(safe-area-inset-top, 0px));
      background: #4338ca; color: #fff; font-size: 12px; font-weight: 700; text-align: center;
      box-shadow: 0 4px 14px rgba(0,0,0,.18);
    }
    .sb-banner mat-icon { flex-shrink: 0; font-size: 16px; width: 16px; height: 16px; }
    .sb-banner__cta, .sb-banner__exit {
      font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em;
      padding: 4px 10px; border-radius: 999px; cursor: pointer;
    }
    .sb-banner__cta { background: #fff; color: #4338ca; text-decoration: none; }
    .sb-banner__exit { background: rgba(255,255,255,0.16); color: #fff; border: 1px solid rgba(255,255,255,0.4); }
  `],
})
export class SandboxBannerComponent implements OnDestroy {
  private timer: any = null;

  constructor(public ctx: OrgContextService, private router: Router, private toast: ToastService) {
    effect(() => {
      if (this.ctx.isDemo() && this.ctx.demoExpiresAtMs() != null) {
        this.startExpiryWatch();
      } else {
        this.stopExpiryWatch();
      }
    });
  }

  private startExpiryWatch() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const expiresAtMs = this.ctx.demoExpiresAtMs();
      if (expiresAtMs != null && Date.now() > expiresAtMs) {
        this.exit('This demo session has ended.');
      }
    }, EXPIRY_CHECK_INTERVAL_MS);
  }

  private stopExpiryWatch() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async exit(reason?: string) {
    this.stopExpiryWatch();
    try {
      await signOut(getAuth());
    } catch { /* ignore */ }
    this.ctx.clear();
    await this.router.navigateByUrl('/');
    if (reason) this.toast.success(reason);
  }

  ngOnDestroy() {
    this.stopExpiryWatch();
  }
}
