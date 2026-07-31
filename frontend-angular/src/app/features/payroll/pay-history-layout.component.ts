import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Router } from '@angular/router';
import { getAuth, signOut } from 'firebase/auth';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@jsverse/transloco';
import { OrgContextService } from '../../core/tenancy/org-context.service';

/**
 * Minimal top-level shell for /pay-history — a former employee has no live
 * org membership, so the normal AppLayoutComponent (nav, admin links, org
 * switcher, etc.) has nothing to bind to. This wrapper is just enough chrome
 * to view/print pay stubs and sign out.
 */
@Component({
  standalone: true,
  imports: [RouterOutlet, MatIconModule, TranslocoModule],
  template: `
    <div class="ph-shell">
      <header class="ph-header no-print">
        <div class="ph-brand">
          <mat-icon>receipt_long</mat-icon>
          <span>{{ 'paystubs.payHistory' | transloco }}</span>
        </div>
        <button class="ph-logout" type="button" (click)="logout()">
          <mat-icon>logout</mat-icon>
          {{ 'shell.signOut' | transloco }}
        </button>
      </header>
      <main class="ph-main">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    .ph-shell { min-height:100vh; background:#f1f5f9; }
    .ph-header { height:60px; padding:0 20px; display:flex; align-items:center; justify-content:space-between; background:#07533f; color:#fff; }
    .ph-brand { display:flex; align-items:center; gap:9px; font-weight:800; }
    .ph-logout { height:36px; border:1px solid rgba(255,255,255,.5); border-radius:6px; background:transparent; color:#fff; display:inline-flex; align-items:center; gap:6px; padding:0 12px; font-weight:800; cursor:pointer; }
    .ph-logout:hover { background:rgba(255,255,255,.12); }
    .ph-main { padding:20px; max-width:980px; margin:0 auto; }
    @media print { .ph-header { display:none; } .ph-shell { background:#fff; } .ph-main { padding:0; max-width:none; } }
  `]
})
export class PayHistoryLayoutComponent {
  constructor(private ctx: OrgContextService, private router: Router) {}

  async logout() {
    try { await signOut(getAuth()); } catch { /* ignore */ }
    this.ctx.clear();
    await this.router.navigateByUrl('/login');
  }
}
