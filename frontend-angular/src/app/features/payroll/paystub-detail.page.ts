import { Component, effect, EffectRef, OnDestroy } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { TranslocoModule } from '@jsverse/transloco';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { PayslipsRepo, Payslip } from '../../core/repos/payslips.repo';
import { maskLast4 } from '../../core/repos/direct-deposit.repo';
import { PrintLauncherService } from '../../core/ui/print-launcher.service';

@Component({
  standalone: true,
  imports: [CommonModule, CurrencyPipe, MatIconModule, MatExpansionModule, TranslocoModule],
  template: `
    <div class="pd-page">
      <div class="pd-toolbar no-print">
        <button class="pd-btn" type="button" (click)="back()">
          <mat-icon>arrow_back</mat-icon>
          {{ 'paystubs.back' | transloco }}
        </button>
        <button class="pd-btn pd-btn-primary" type="button" (click)="viewCheck()" *ngIf="payslip">
          <mat-icon>picture_as_pdf</mat-icon>
          {{ 'paystubs.viewCheck' | transloco }}
        </button>
      </div>

      <div *ngIf="!loading && !payslip" class="pd-alert">
        <mat-icon>warning_amber</mat-icon>
        {{ 'paystubs.notFound' | transloco }}
      </div>

      <section class="pd-sheet" *ngIf="payslip as p">
        <header class="pd-header">
          <div>
            <div class="pd-brand">{{ 'paystubs.payPeriod' | transloco }}</div>
            <h1>{{ p.periodStart }} — {{ p.periodEnd }}</h1>
            <p>{{ 'paystubs.checkNumber' | transloco }} #{{ p.checkNumber }}</p>
          </div>
          <div class="pd-paid">
            <span>{{ 'paystubs.paidOn' | transloco: { date: p.payDate } }}</span>
          </div>
        </header>

        <section class="pd-amounts">
          <article class="pd-amount-net">
            <span>{{ 'paystubs.netPay' | transloco }}</span>
            <strong>{{ p.netPay | currency:p.currencyCode }}</strong>
          </article>
          <article>
            <span>{{ 'paystubs.achAmount' | transloco }}</span>
            <strong>{{ p.achAmount | currency:p.currencyCode }}</strong>
          </article>
          <article>
            <span>{{ 'paystubs.checkAmount' | transloco }}</span>
            <strong>{{ p.checkAmount | currency:p.currencyCode }}</strong>
          </article>
        </section>

        <section class="pd-box" *ngIf="p.directDeposit as dd">
          <h2>{{ 'paystubs.directDeposit' | transloco }}</h2>
          <div class="pd-line"><span>{{ dd.bankName }} — {{ dd.accountType === 'savings' ? ('paystubs.savings' | transloco) : ('paystubs.checking' | transloco) }}</span><em>{{ maskLast4(dd.last4) }}</em></div>
        </section>

        <mat-accordion class="pd-accordion">
          <mat-expansion-panel [expanded]="true">
            <mat-expansion-panel-header>
              <mat-panel-title>{{ 'paystubs.earnings' | transloco }}</mat-panel-title>
              <mat-panel-description>{{ p.grossPay | currency:p.currencyCode }}</mat-panel-description>
            </mat-expansion-panel-header>
            <div class="pd-earnings-table">
              <div class="pd-earnings-head">
                <span>{{ 'paystubs.colDescription' | transloco }}</span>
                <span>{{ 'paystubs.colHours' | transloco }}</span>
                <span>{{ 'paystubs.colRate' | transloco }}</span>
                <span>{{ 'paystubs.colAmount' | transloco }}</span>
                <span>{{ 'paystubs.colDepartment' | transloco }}</span>
                <span>{{ 'paystubs.colLocation' | transloco }}</span>
              </div>
              <div class="pd-earnings-row" *ngFor="let line of p.earnings">
                <span>{{ line.description }}</span>
                <span>{{ line.hours ? line.hours.toFixed(2) : '-' }}</span>
                <span>{{ line.rate ? (line.rate | currency:p.currencyCode) : '-' }}</span>
                <span>{{ line.amount | currency:p.currencyCode }}</span>
                <span>{{ line.department || '-' }}</span>
                <span>{{ line.location || '-' }}</span>
              </div>
              <div class="pd-earnings-row" *ngIf="p.earnings.length === 0">
                <span>{{ 'paystubs.noEarningsLines' | transloco }}</span>
              </div>
            </div>
          </mat-expansion-panel>
        </mat-accordion>

        <section class="pd-box">
          <h2>{{ 'paystubs.deductions' | transloco }}</h2>
          <div class="pd-line"><span>{{ 'paystubs.federalTax' | transloco }}</span><em>{{ p.deductionBreakdown.federalTax | currency:p.currencyCode }}</em></div>
          <div class="pd-line"><span>{{ 'paystubs.stateTax' | transloco }}</span><em>{{ p.deductionBreakdown.stateTax | currency:p.currencyCode }}</em></div>
          <div class="pd-line"><span>{{ 'paystubs.socialSecurity' | transloco }}</span><em>{{ p.deductionBreakdown.socialSecurity | currency:p.currencyCode }}</em></div>
          <div class="pd-line"><span>{{ 'paystubs.medicare' | transloco }}</span><em>{{ p.deductionBreakdown.medicare | currency:p.currencyCode }}</em></div>
          <div class="pd-line" *ngIf="p.deductionBreakdown.retirement401k > 0"><span>401(k)</span><em>{{ p.deductionBreakdown.retirement401k | currency:p.currencyCode }}</em></div>
          <div class="pd-line" *ngFor="let b of p.deductionBreakdown.benefitLines"><span>{{ b.label }}{{ b.provider ? ' — ' + b.provider : '' }}</span><em>{{ b.amount | currency:p.currencyCode }}</em></div>
          <div class="pd-line pd-line-total"><span>{{ 'paystubs.totalDeductions' | transloco }}</span><em>{{ p.totalDeductions | currency:p.currencyCode }}</em></div>
        </section>

        <section class="pd-ytd">
          <span>{{ 'paystubs.ytdNetPay' | transloco }}</span>
          <strong>{{ p.ytdNetPay | currency:p.currencyCode }}</strong>
        </section>
      </section>
    </div>
  `,
  styles: [`
    .pd-page { color:#1f2937; }
    .pd-toolbar { display:flex; justify-content:space-between; gap:10px; margin-bottom:14px; }
    .pd-btn { height:38px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#334155; display:inline-flex; align-items:center; gap:7px; padding:0 12px; font-weight:800; cursor:pointer; }
    .pd-btn-primary { border-color:#07533f; background:#07533f; color:#fff; }
    .pd-alert { display:flex; gap:10px; padding:14px 16px; background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; color:#92400e; font-weight:800; }
    .pd-sheet { background:#fff; border:1px solid #d1d5db; border-radius:8px; overflow:hidden; box-shadow:0 12px 28px rgba(15,23,42,.06); }
    .pd-header { padding:22px 24px; display:flex; justify-content:space-between; align-items:flex-start; gap:16px; background:#07533f; color:#fff; flex-wrap:wrap; }
    .pd-brand { font-size:11px; font-weight:900; letter-spacing:.1em; color:rgba(255,255,255,.72); text-transform:uppercase; }
    .pd-header h1 { margin:6px 0 2px; font-size:22px; }
    .pd-header p { margin:0; color:rgba(255,255,255,.82); }
    .pd-paid span { display:inline-block; padding:7px 12px; border-radius:999px; background:rgba(255,255,255,.16); font-weight:800; font-size:13px; }
    .pd-amounts { display:grid; grid-template-columns:repeat(3,1fr); gap:0; border-bottom:1px solid #d1d5db; }
    .pd-amounts article { padding:18px; border-right:1px solid #e5e7eb; }
    .pd-amounts article:last-child { border-right:0; }
    .pd-amounts span { display:block; color:#64748b; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.03em; }
    .pd-amounts strong { display:block; margin-top:8px; font-size:22px; color:#0f172a; }
    .pd-amount-net { background:#ecfdf5; }
    .pd-amount-net strong { color:#047857; }
    .pd-box { margin:18px 24px; border:1px solid #e5e7eb; border-radius:6px; overflow:hidden; }
    .pd-box h2 { margin:0; padding:12px 14px; background:#eef3ef; color:#0f172a; font-size:14px; border-bottom:1px solid #d1d5db; }
    .pd-line { display:flex; justify-content:space-between; gap:10px; padding:10px 14px; border-bottom:1px solid #f1f5f9; color:#475569; font-size:13px; }
    .pd-line em { color:#0f172a; font-style:normal; font-weight:700; }
    .pd-line-total { background:#f8fafc; font-weight:900; }
    .pd-accordion { margin:0 24px; }
    .pd-earnings-table { display:grid; }
    .pd-earnings-head, .pd-earnings-row { display:grid; grid-template-columns:2fr .8fr .9fr 1fr 1fr 1fr; gap:10px; padding:9px 4px; font-size:12px; }
    .pd-earnings-head { color:#64748b; font-weight:800; text-transform:uppercase; font-size:10px; letter-spacing:.04em; border-bottom:1px solid #e5e7eb; }
    .pd-earnings-row { border-bottom:1px solid #f1f5f9; color:#334155; }
    .pd-ytd { display:flex; justify-content:space-between; align-items:center; margin:18px 24px 24px; padding:14px 16px; background:#f8fafc; border-radius:6px; }
    .pd-ytd span { color:#475569; font-weight:800; font-size:12px; text-transform:uppercase; }
    .pd-ytd strong { color:#0f172a; font-size:18px; }
    @media (max-width:700px) { .pd-amounts { grid-template-columns:1fr; } .pd-amounts article { border-right:0; border-bottom:1px solid #e5e7eb; } .pd-earnings-head, .pd-earnings-row { grid-template-columns:1.6fr .6fr .7fr .8fr; } .pd-earnings-head span:nth-child(5), .pd-earnings-head span:nth-child(6), .pd-earnings-row span:nth-child(5), .pd-earnings-row span:nth-child(6) { display:none; } }
    @media print {
      @page { size: Letter; margin: 0.45in; }
      .no-print { display:none !important; }
      .pd-sheet { border:0; box-shadow:none; }
      .pd-header { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    }
  `]
})
export class PayStubDetailPage implements OnDestroy {
  orgId: string | null = null;
  payslip: Payslip | null = null;
  loading = true;
  private ctxEffect: EffectRef;
  private isStandalone = false;
  private autoPrintArmed = false;
  private autoPrintDone = false;

  constructor(
    private ctx: OrgContextService,
    private route: ActivatedRoute,
    private router: Router,
    private payslipsRepo: PayslipsRepo,
    private printLauncher: PrintLauncherService,
  ) {
    this.isStandalone = this.router.url.startsWith('/pay-history');
    this.autoPrintArmed = this.route.snapshot.queryParamMap.get('print') === '1';
    this.ctxEffect = effect(() => {
      this.orgId = this.ctx.orgId() || this.ctx.formerOrgId();
      void this.load();
    });
  }

  private async load() {
    const id = this.route.snapshot.paramMap.get('payslipId');
    this.loading = true;
    this.payslip = null;
    if (!this.orgId || !id) { this.loading = false; return; }
    const uid = this.ctx.uid();
    const found = await this.payslipsRepo.getPayslip(this.orgId, id);
    this.payslip = found && found.userId === uid ? found : null;
    this.loading = false;
    this.tryAutoPrint();
  }

  private tryAutoPrint() {
    if (!this.autoPrintArmed || this.autoPrintDone || !this.payslip) return;
    this.autoPrintDone = true;
    setTimeout(() => window.print(), 350);
  }

  maskLast4(last4: string) {
    return last4 ? `•••• ${last4}` : '';
  }

  /**
   * Printing needs a chrome-less page — the standalone /pay-history mount
   * already is one, but the in-shell /app/payroll/history mount is wrapped
   * by AppLayoutComponent's sidebar/top bar, which this page's own print
   * styles can't reach. So from in-shell, pop the same detail page open at
   * its standalone route instead — same pattern PayslipPrintPage uses.
   */
  viewCheck() {
    if (this.isStandalone) {
      window.print();
      return;
    }
    const id = this.route.snapshot.paramMap.get('payslipId');
    this.printLauncher.open(`/pay-history/${id}`, {}, 'paystub-check');
  }

  back() {
    const base = this.isStandalone ? '/pay-history' : '/app/payroll/history';
    void this.router.navigateByUrl(base);
  }

  ngOnDestroy() {
    this.ctxEffect.destroy();
  }
}
