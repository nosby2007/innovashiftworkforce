import { Component, effect, EffectRef, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { ToastService } from '../../core/ui/toast.service';
import {
  AccrualBalance,
  AccrualLedgerItem,
  AccrualsRepo,
  TimeOffRequest,
  TimeOffType,
} from '../../core/repos/accruals.repo';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, TranslocoModule],
  template: `
    <div class="acr-page">
      <header class="acr-header">
        <div>
          <h1>{{ 'accruals.title' | transloco }}</h1>
          <p>{{ 'accruals.subtitle' | transloco }}</p>
        </div>
        <div class="acr-asof">
          <span>{{ 'accruals.balanceAsOf' | transloco }}</span>
          <strong>{{ asOfLabel() }}</strong>
        </div>
      </header>

      <div *ngIf="!orgId || !uid" class="acr-alert">
        <mat-icon>warning_amber</mat-icon>
        {{ 'accruals.missingStaffContext' | transloco }}
      </div>

      <section class="acr-grid" *ngIf="orgId && uid">
        <article class="acr-card acr-balance">
          <div class="acr-card-head">
            <h2>{{ 'accruals.sick' | transloco }}</h2>
            <mat-icon>health_and_safety</mat-icon>
          </div>
          <div class="acr-balance-value">{{ balance().sickBalance }} h</div>
          <div class="acr-meter"><span [style.width.%]="balancePercent(balance().sickBalance, 40)"></span></div>
          <dl>
            <div><dt>{{ 'accruals.availableBalance' | transloco }}</dt><dd>{{ balance().sickBalance }} h</dd></div>
            <div><dt>{{ 'accruals.plannedTakings' | transloco }}</dt><dd>{{ balance().plannedSick }} h</dd></div>
            <div><dt>{{ 'accruals.takenToDate' | transloco }}</dt><dd>{{ balance().sickTaken }} h</dd></div>
          </dl>
        </article>

        <article class="acr-card acr-balance">
          <div class="acr-card-head">
            <h2>{{ 'accruals.pto' | transloco }}</h2>
            <mat-icon>beach_access</mat-icon>
          </div>
          <div class="acr-balance-value">{{ balance().ptoBalance }} h</div>
          <div class="acr-meter acr-meter-blue"><span [style.width.%]="balancePercent(balance().ptoBalance, 80)"></span></div>
          <dl>
            <div><dt>{{ 'accruals.availableBalance' | transloco }}</dt><dd>{{ balance().ptoBalance }} h</dd></div>
            <div><dt>{{ 'accruals.plannedTakings' | transloco }}</dt><dd>{{ balance().plannedPto }} h</dd></div>
            <div><dt>{{ 'accruals.takenToDate' | transloco }}</dt><dd>{{ balance().ptoTaken }} h</dd></div>
          </dl>
        </article>

        <article class="acr-card acr-request">
          <div class="acr-card-head">
            <h2>{{ 'accruals.timeOffRequest' | transloco }}</h2>
            <mat-icon>event_available</mat-icon>
          </div>
          <form (ngSubmit)="submitRequest()">
            <label>
              <span>{{ 'accruals.requestType' | transloco }}</span>
              <select [(ngModel)]="requestType" name="type">
                <option value="pto">{{ 'accruals.typePto' | transloco }}</option>
                <option value="sick">{{ 'accruals.typeSick' | transloco }}</option>
                <option value="unpaid">{{ 'accruals.typeUnpaid' | transloco }}</option>
              </select>
            </label>
            <div class="acr-two">
              <label>
                <span>{{ 'accruals.startDate' | transloco }}</span>
                <input type="date" [(ngModel)]="startDate" name="startDate">
              </label>
              <label>
                <span>{{ 'accruals.endDate' | transloco }}</span>
                <input type="date" [(ngModel)]="endDate" name="endDate">
              </label>
            </div>
            <label>
              <span>{{ 'accruals.hours' | transloco }}</span>
              <input type="number" min="1" step="0.25" [(ngModel)]="hours" name="hours">
            </label>
            <label>
              <span>{{ 'accruals.notes' | transloco }}</span>
              <textarea rows="4" [(ngModel)]="notes" name="notes" [placeholder]="'accruals.notesPlaceholder' | transloco"></textarea>
            </label>
            <button class="acr-submit" type="submit" [disabled]="busy">
              <mat-icon>{{ busy ? 'hourglass_top' : 'send' }}</mat-icon>
              {{ (busy ? 'accruals.submitting' : 'accruals.submitRequest') | transloco }}
            </button>
          </form>
        </article>
      </section>

      <section class="acr-lower" *ngIf="orgId && uid">
        <article class="acr-card acr-history">
          <div class="acr-card-head">
            <h2>{{ 'accruals.myRequests' | transloco }}</h2>
            <mat-icon>assignment</mat-icon>
          </div>
          <div class="acr-empty" *ngIf="requests().length === 0">
            <mat-icon>inbox</mat-icon>
            {{ 'accruals.noRequestsYet' | transloco }}
          </div>
          <div class="acr-history-row" *ngFor="let r of requests()">
            <span>
              <strong>{{ requestLabel(r) | transloco }}</strong>
              <em>{{ r.startDate }} to {{ r.endDate }}</em>
            </span>
            <strong>{{ r.hours }} h</strong>
            <em class="acr-status" [class.is-pending]="r.status === 'pending'" [class.is-approved]="r.status === 'approved'" [class.is-rejected]="r.status === 'rejected'">
              {{ r.status | titlecase }}
            </em>
          </div>
        </article>

        <article class="acr-card acr-history">
          <div class="acr-card-head">
            <h2>{{ 'accruals.recentAccrualActivity' | transloco }}</h2>
            <mat-icon>history</mat-icon>
          </div>
          <div class="acr-empty" *ngIf="ledger().length === 0">
            <mat-icon>history</mat-icon>
            {{ 'accruals.noLedgerEntries' | transloco }}
          </div>
          <div class="acr-history-row" *ngFor="let item of ledger()">
            <span>
              <strong>{{ item.label || ledgerLabel(item) }}</strong>
              <em>{{ fmtDate(item.createdAt) }}</em>
            </span>
            <strong [class.is-negative]="item.hours < 0">{{ signedHours(item.hours) }}</strong>
            <em>{{ item.source || ('accruals.accrualFallback' | transloco) }}</em>
          </div>
        </article>
      </section>
    </div>
  `,
  styles: [`
    .acr-page { max-width:1180px; margin:0 auto; color:#1f2937; }
    .acr-header { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin:18px 0 20px; }
    .acr-header h1 { margin:0; font-size:30px; font-weight:700; letter-spacing:0; }
    .acr-header p { margin:6px 0 0; color:#64748b; }
    .acr-asof { display:grid; gap:2px; text-align:right; color:#047857; }
    .acr-asof span { color:#64748b; font-size:12px; font-weight:700; }
    .acr-asof strong { font-weight:900; }
    .acr-alert { display:flex; align-items:center; gap:10px; padding:14px 16px; border:1px solid #fed7aa; background:#fff7ed; color:#9a3412; border-radius:8px; font-weight:800; }
    .acr-grid { display:grid; grid-template-columns:1fr 1fr 1.35fr; gap:16px; align-items:start; }
    .acr-lower { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px; }
    .acr-card { border:1px solid rgba(15,23,42,.14); border-radius:8px; background:rgba(255,255,255,.96); box-shadow:0 12px 28px rgba(15,23,42,.07); overflow:hidden; }
    .acr-card-head { min-height:48px; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:0 16px; border-bottom:1px solid #e5e7eb; }
    .acr-card-head h2 { margin:0; font-size:15px; font-weight:900; letter-spacing:0; }
    .acr-card-head mat-icon { color:#047857; }
    .acr-balance { padding-bottom:16px; }
    .acr-balance-value { padding:22px 16px 8px; text-align:center; font-size:36px; font-weight:900; color:#0f172a; }
    .acr-meter { height:8px; margin:0 18px 20px; border-radius:999px; background:#e5e7eb; overflow:hidden; }
    .acr-meter span { display:block; height:100%; border-radius:999px; background:#047857; }
    .acr-meter-blue span { background:#075985; }
    dl { margin:0; padding:0 16px; display:grid; gap:10px; }
    dl div, .acr-history-row { display:flex; justify-content:space-between; gap:12px; align-items:center; color:#475569; }
    dt { font-size:12px; } dd { margin:0; color:#0f172a; font-weight:900; }
    .acr-request form { padding:16px; display:grid; gap:12px; }
    label { display:grid; gap:6px; color:#475569; font-size:12px; font-weight:800; }
    input, select, textarea { width:100%; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#111827; padding:10px 11px; font:inherit; }
    .acr-two { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .acr-submit { height:42px; border:0; border-radius:6px; background:#047857; color:#fff; display:inline-flex; align-items:center; justify-content:center; gap:8px; font-weight:900; cursor:pointer; }
    .acr-submit:disabled { opacity:.65; cursor:not-allowed; }
    .acr-history-row { padding:14px 16px; border-top:1px solid #e5e7eb; }
    .acr-history-row:first-of-type { border-top:0; }
    .acr-history-row > span { display:grid; gap:3px; min-width:0; }
    .acr-history-row strong { color:#0f172a; }
    .acr-history-row strong.is-negative { color:#b91c1c; }
    .acr-history-row em { color:#64748b; font-style:normal; font-size:12px; }
    .acr-status { border:1px solid #cbd5e1; border-radius:999px; padding:4px 8px; font-weight:800; }
    .acr-status.is-pending { color:#92400e; background:#fffbeb; border-color:#fde68a; }
    .acr-status.is-approved { color:#047857; background:#ecfdf5; border-color:#a7f3d0; }
    .acr-status.is-rejected { color:#b91c1c; background:#fef2f2; border-color:#fecaca; }
    .acr-empty { min-height:86px; display:flex; align-items:center; justify-content:center; gap:8px; color:#64748b; font-weight:800; }
    @media (max-width:980px) {
      .acr-grid, .acr-lower { grid-template-columns:1fr; }
      .acr-two { grid-template-columns:1fr; }
      .acr-header { align-items:flex-start; flex-direction:column; }
      .acr-asof { text-align:left; }
    }
  `]
})
export class AccrualsPage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;
  balance = signal<AccrualBalance>({
    uid: '',
    orgId: '',
    ptoBalance: 0,
    sickBalance: 0,
    ptoTaken: 0,
    sickTaken: 0,
    plannedPto: 0,
    plannedSick: 0,
  });
  requests = signal<TimeOffRequest[]>([]);
  ledger = signal<AccrualLedgerItem[]>([]);
  requestType: TimeOffType = 'pto';
  startDate = '';
  endDate = '';
  hours = 8;
  notes = '';
  busy = false;

  private ctxEffect: EffectRef;
  private unsub: Array<() => void> = [];

  constructor(
    private ctx: OrgContextService,
    private toast: ToastService,
    private accruals: AccrualsRepo,
    private i18n: TranslocoService,
  ) {
    this.ctxEffect = effect(() => {
      this.orgId = this.ctx.orgId();
      this.uid = this.ctx.uid();
      this.cleanup();

      if (!this.orgId || !this.uid) {
        this.balance.set(this.accruals.emptyBalance('', ''));
        this.requests.set([]);
        this.ledger.set([]);
        return;
      }

      this.balance.set(this.accruals.emptyBalance(this.orgId, this.uid));
      this.unsub.push(this.accruals.watchBalance(this.orgId, this.uid, (b) => this.balance.set(b)));
      this.unsub.push(this.accruals.watchRequests(this.orgId, this.uid, (items) => this.requests.set(items)));
      this.unsub.push(this.accruals.watchLedger(this.orgId, this.uid, (items) => this.ledger.set(items)));
    });
  }

  balancePercent(value: number, max: number): number {
    return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  }

  async submitRequest() {
    if (!this.orgId || !this.uid) {
      this.toast.error(this.i18n.translate('accruals.missingStaffContextError'));
      return;
    }
    if (!this.startDate || !this.endDate || !this.hours || this.hours <= 0) {
      this.toast.error(this.i18n.translate('accruals.selectDatesHours'));
      return;
    }
    if (this.endDate < this.startDate) {
      this.toast.error(this.i18n.translate('accruals.endAfterStartDate'));
      return;
    }

    this.busy = true;
    try {
      await this.accruals.submitTimeOffRequest({
        orgId: this.orgId,
        uid: this.uid,
        displayName: this.ctx.displayName(),
        requestType: this.requestType,
        startDate: this.startDate,
        endDate: this.endDate,
        hours: Number(this.hours),
        notes: this.notes,
      });
      this.toast.success(this.i18n.translate('accruals.requestSent'));
      this.startDate = '';
      this.endDate = '';
      this.hours = 8;
      this.notes = '';
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('accruals.requestFailed'));
    } finally {
      this.busy = false;
    }
  }

  asOfLabel(): string {
    return this.fmtDate(this.balance().asOf || this.balance().updatedAt || new Date());
  }

  requestLabel(r: TimeOffRequest): string {
    const map: Record<string, string> = { pto: 'accruals.ptoRequest', sick: 'accruals.sickRequest', unpaid: 'accruals.unpaidRequest' };
    return map[r.requestType] || 'accruals.timeOffRequestFallback';
  }

  ledgerLabel(item: AccrualLedgerItem): string {
    const type = String(item.type || 'adjustment').toUpperCase();
    return `${type} accrual`;
  }

  signedHours(hours: number): string {
    const value = Math.round(Number(hours || 0) * 100) / 100;
    return `${value > 0 ? '+' : ''}${value} h`;
  }

  fmtDate(value: any): string {
    const d = this.toDate(value);
    if (d.getTime() <= 0) return 'Today';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private toDate(value: any): Date {
    if (!value) return new Date(0);
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : new Date(0);
  }

  private cleanup() {
    this.unsub.forEach((u) => u());
    this.unsub = [];
  }

  ngOnDestroy() {
    this.cleanup();
    this.ctxEffect.destroy();
  }
}
