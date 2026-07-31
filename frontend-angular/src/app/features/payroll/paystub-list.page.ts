import { Component, effect, EffectRef, OnDestroy, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@jsverse/transloco';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { PayslipsRepo, Payslip } from '../../core/repos/payslips.repo';

function taxesOf(p: Payslip): number {
  const d = p.deductionBreakdown;
  if (!d) return 0;
  return Math.round((Number(d.federalTax || 0) + Number(d.stateTax || 0) + Number(d.socialSecurity || 0) + Number(d.medicare || 0)) * 100) / 100;
}

function otherDeductionsOf(p: Payslip): number {
  return Math.round((Number(p.totalDeductions || 0) - taxesOf(p)) * 100) / 100;
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, MatIconModule, TranslocoModule],
  template: `
    <div class="pstub-list">
      <header class="pstub-hero">
        <div>
          <div class="pstub-kicker">{{ 'nav.myPayroll' | transloco }}</div>
          <h1>{{ 'paystubs.payHistory' | transloco }}</h1>
          <p>{{ 'paystubs.payHistorySubtitle' | transloco }}</p>
        </div>
      </header>

      <div *ngIf="!orgId" class="pstub-alert">
        <mat-icon>warning_amber</mat-icon>
        {{ 'paystubs.missingContext' | transloco }}
      </div>

      <section class="pstub-filters" *ngIf="orgId">
        <div class="pstub-filter">
          <label>{{ 'paystubs.year' | transloco }}</label>
          <select [(ngModel)]="year" (ngModelChange)="onYearChange()">
            <option [ngValue]="null">{{ 'paystubs.allYears' | transloco }}</option>
            <option *ngFor="let y of years" [ngValue]="y">{{ y }}</option>
          </select>
        </div>
        <div class="pstub-filter pstub-search">
          <mat-icon>search</mat-icon>
          <input type="text" [(ngModel)]="query" [placeholder]="'paystubs.searchPlaceholder' | transloco">
        </div>
      </section>

      <section class="pstub-cards" *ngIf="orgId">
        <div class="pstub-empty" *ngIf="!loading && filteredPayslips().length === 0">
          <mat-icon>receipt_long</mat-icon>
          <p>{{ 'paystubs.noPaystubs' | transloco }}</p>
        </div>

        <article class="pstub-card" *ngFor="let p of filteredPayslips()">
          <div class="pstub-card-main">
            <div class="pstub-card-date">
              <mat-icon>event</mat-icon>
              <div>
                <strong>{{ p.payDate }}</strong>
                <span>{{ 'paystubs.checkNumber' | transloco }} #{{ p.checkNumber }}</span>
              </div>
            </div>
            <div class="pstub-card-amounts">
              <div><span>{{ 'paystubs.gross' | transloco }}</span><strong>{{ p.grossPay | currency:p.currencyCode }}</strong></div>
              <div><span>{{ 'paystubs.taxes' | transloco }}</span><strong>{{ taxesOf(p) | currency:p.currencyCode }}</strong></div>
              <div><span>{{ 'paystubs.deductions' | transloco }}</span><strong>{{ otherDeductionsOf(p) | currency:p.currencyCode }}</strong></div>
              <div class="pstub-net"><span>{{ 'paystubs.netPay' | transloco }}</span><strong>{{ p.netPay | currency:p.currencyCode }}</strong></div>
            </div>
          </div>
          <button class="pstub-view-btn" type="button" (click)="viewPaystub(p)">
            <mat-icon>visibility</mat-icon>
            {{ 'paystubs.viewPaystub' | transloco }}
          </button>
        </article>
      </section>
    </div>
  `,
  styles: [`
    .pstub-list { max-width:980px; margin:0 auto; color:#1f2937; }
    .pstub-hero { margin-bottom:18px; }
    .pstub-kicker { color:#07533f; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; margin-bottom:6px; }
    .pstub-hero h1 { margin:0; font-size:28px; font-weight:800; color:#0f172a; }
    .pstub-hero p { margin:6px 0 0; color:#64748b; }
    .pstub-alert { display:flex; gap:10px; padding:14px 16px; background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; color:#92400e; font-weight:800; }
    .pstub-filters { display:flex; gap:14px; margin-bottom:16px; flex-wrap:wrap; }
    .pstub-filter { display:flex; align-items:center; gap:8px; }
    .pstub-filter label { font-size:12px; font-weight:800; color:#475569; }
    .pstub-filter select { height:38px; border:1px solid #cbd5e1; border-radius:6px; padding:0 10px; background:#fff; color:#111827; }
    .pstub-search { flex:1; min-width:220px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; padding:0 10px; height:38px; }
    .pstub-search mat-icon { color:#94a3b8; font-size:20px; width:20px; height:20px; }
    .pstub-search input { border:0; outline:0; flex:1; height:100%; color:#111827; }
    .pstub-cards { display:grid; gap:12px; }
    .pstub-empty { display:flex; flex-direction:column; align-items:center; gap:10px; padding:48px 0; color:#94a3b8; }
    .pstub-empty mat-icon { font-size:40px; width:40px; height:40px; }
    .pstub-card { border:1px solid rgba(15,23,42,.12); border-radius:8px; background:#fff; box-shadow:0 12px 28px rgba(15,23,42,.06); padding:16px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
    .pstub-card-main { display:flex; align-items:center; gap:24px; flex-wrap:wrap; flex:1; }
    .pstub-card-date { display:flex; align-items:center; gap:10px; min-width:170px; }
    .pstub-card-date mat-icon { color:#07533f; }
    .pstub-card-date strong { display:block; color:#0f172a; }
    .pstub-card-date span { color:#64748b; font-size:12px; }
    .pstub-card-amounts { display:flex; gap:22px; flex-wrap:wrap; }
    .pstub-card-amounts div { display:flex; flex-direction:column; gap:2px; }
    .pstub-card-amounts span { color:#64748b; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.03em; }
    .pstub-card-amounts strong { color:#0f172a; }
    .pstub-net strong { color:#047857; }
    .pstub-view-btn { height:38px; border:1px solid #07533f; border-radius:6px; background:#07533f; color:#fff; display:inline-flex; align-items:center; gap:7px; padding:0 14px; font-weight:800; cursor:pointer; white-space:nowrap; }
    @media (max-width:640px) { .pstub-card { flex-direction:column; align-items:stretch; } .pstub-view-btn { width:100%; justify-content:center; } }
  `]
})
export class PayStubListPage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;
  loading = true;
  year: number | null = new Date().getFullYear();
  query = '';
  years: number[] = [];
  private payslips = signal<Payslip[]>([]);
  private unsub: (() => void) | null = null;
  private ctxEffect: EffectRef;
  private isStandalone = false;

  constructor(
    private ctx: OrgContextService,
    private payslipsRepo: PayslipsRepo,
    private router: Router,
  ) {
    const currentYear = new Date().getFullYear();
    this.years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
    this.isStandalone = this.router.url.startsWith('/pay-history');
    this.ctxEffect = effect(() => {
      this.orgId = this.ctx.orgId() || this.ctx.formerOrgId();
      this.uid = this.ctx.uid();
      this.bind();
    });
  }

  onYearChange() {
    this.bind();
  }

  private bind() {
    this.unsub?.();
    this.loading = true;
    this.payslips.set([]);
    if (!this.orgId || !this.uid) { this.loading = false; return; }
    this.unsub = this.payslipsRepo.watchPayslips(this.orgId, this.uid, (items) => {
      this.payslips.set(items);
      this.loading = false;
    }, this.year ?? undefined);
  }

  filteredPayslips(): Payslip[] {
    const q = this.query.toLowerCase().trim();
    const items = this.payslips();
    if (!q) return items;
    return items.filter((p) => p.payDate.includes(q) || p.checkNumber.toLowerCase().includes(q));
  }

  taxesOf(p: Payslip) { return taxesOf(p); }
  otherDeductionsOf(p: Payslip) { return otherDeductionsOf(p); }

  viewPaystub(p: Payslip) {
    const base = this.isStandalone ? '/pay-history' : '/app/payroll/history';
    void this.router.navigate([base, p.id]);
  }

  ngOnDestroy() {
    this.unsub?.();
    this.ctxEffect.destroy();
  }
}
