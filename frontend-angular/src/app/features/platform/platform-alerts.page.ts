import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { PlatformNotificationsRepo, PlatformNotification, PLATFORM_NOTIFICATION_RETENTION_DAYS } from '../../core/repos/platform-notifications.repo';
import { ToastService } from '../../core/ui/toast.service';
import { PushNotificationsService } from '../../core/push/push-notifications.service';
import { formatDateTime } from '../../shared/utils/date.util';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

@Component({
  standalone: true,
  imports: [CommonModule, MatIconModule, TranslocoModule],
  template: `
    <div class="pa-page">
      <header class="pa-top">
        <div>
          <h1>{{ 'platformAlerts.title' | transloco }}</h1>
          <p>{{ 'platformAlerts.subtitle' | transloco }}</p>
        </div>
        <div class="pa-top-actions">
          <button *ngIf="pushSupported && !pushEnabled" type="button" (click)="enablePush()" [disabled]="pushBusy">
            <mat-icon>notifications_active</mat-icon><span>{{ (pushBusy ? 'notifications.enabling' : 'platformAlerts.enablePush') | transloco }}</span>
          </button>
          <button type="button" (click)="markAllRead()" [disabled]="busy || unreadIds().length === 0">
            <mat-icon>done_all</mat-icon><span>{{ 'platformAlerts.markAllRead' | transloco }}</span>
          </button>
        </div>
      </header>

      <div class="pa-empty" *ngIf="items().length === 0">
        <mat-icon>shield</mat-icon>
        <span>{{ 'platformAlerts.empty' | transloco }}</span>
      </div>

      <ul class="pa-list" *ngIf="items().length > 0">
        <li *ngFor="let n of items()" class="pa-row" [class.is-unread]="!isRead(n)">
          <span class="pa-sev" [class.pa-sev--warning]="n.severity === 'warning'">
            <mat-icon>{{ n.severity === 'warning' ? 'warning_amber' : 'info_outline' }}</mat-icon>
          </span>
          <div class="pa-body">
            <strong>{{ n.title }}</strong>
            <span>{{ n.body }}</span>
            <em>{{ fmt(n.createdAt) }}</em>
          </div>
          <button type="button" class="pa-mark" *ngIf="!isRead(n)" (click)="markOneRead(n)" [disabled]="busy">
            {{ 'platformAlerts.markRead' | transloco }}
          </button>
        </li>
      </ul>

      <p class="pa-hint">{{ 'platformAlerts.retentionHint' | transloco: { days: retentionDays } }}</p>
    </div>
  `,
  styles: [`
    .pa-page { margin: -24px -22px; min-height: calc(100vh - 58px); background: #f8fafc; color: #1f2937; padding: 0 0 28px; }
    .pa-top { background: #07533f; color: #fff; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 28px; }
    .pa-top h1 { margin: 0; font-size: 18px; font-weight: 800; }
    .pa-top p { margin: 4px 0 0; font-size: 12px; color: rgba(255,255,255,.8); }
    .pa-top-actions { display: flex; gap: 10px; flex-shrink: 0; }
    .pa-top-actions button { height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.3); background: rgba(255,255,255,.1); color: #fff; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .pa-top-actions button:disabled { opacity: .45; cursor: not-allowed; }
    .pa-top-actions mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pa-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 70px 20px; color: #64748b; font-size: 13px; }
    .pa-empty mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: .5; }
    .pa-list { list-style: none; margin: 18px 24px 0; padding: 0; background: #fff; border: 1px solid #d9e0e7; border-radius: 12px; overflow: hidden; }
    .pa-row { display: grid; grid-template-columns: 36px 1fr auto; gap: 12px; align-items: center; padding: 14px 16px; border-bottom: 1px solid #eef2f6; }
    .pa-row:last-child { border-bottom: 0; }
    .pa-row.is-unread { background: #f0fdf4; }
    .pa-sev { width: 32px; height: 32px; border-radius: 50%; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center; }
    .pa-sev--warning { background: #fffbeb; color: #b45309; }
    .pa-sev mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pa-body strong { display: block; color: #0f172a; font-size: 13px; }
    .pa-body span { display: block; margin-top: 3px; color: #475569; font-size: 12px; line-height: 1.4; }
    .pa-body em { display: block; margin-top: 5px; color: #94a3b8; font-style: normal; font-size: 11px; }
    .pa-mark { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #334155; font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .pa-mark:disabled { opacity: .5; cursor: not-allowed; }
    .pa-hint { margin: 14px 24px 0; color: #94a3b8; font-size: 11px; }
    @media (max-width: 700px) { .pa-top { flex-direction: column; align-items: flex-start; } .pa-list, .pa-hint { margin-left: 14px; margin-right: 14px; } }
  `]
})
export class PlatformAlertsPage implements OnDestroy {
  items = signal<PlatformNotification[]>([]);
  busy = false;
  pushBusy = false;
  pushSupported = false;
  pushEnabled = false;
  readonly retentionDays = PLATFORM_NOTIFICATION_RETENTION_DAYS;
  private unsub: (() => void) | null = null;

  constructor(
    private ctx: OrgContextService,
    private repo: PlatformNotificationsRepo,
    private toast: ToastService,
    private push: PushNotificationsService,
    private i18n: TranslocoService,
  ) {
    this.pushSupported = this.push.isSupportedPlatform();
    this.pushEnabled = this.push.isEnabled();
    this.unsub = this.repo.watchRecent((items) => this.items.set(items));
  }

  async enablePush() {
    if (this.pushBusy) return;
    this.pushBusy = true;
    try {
      const ok = await this.push.enable();
      this.pushEnabled = ok;
      if (ok) {
        this.toast.success(this.i18n.translate('notifications.pushEnabled'));
      } else {
        this.toast.error(this.i18n.translate('notifications.pushEnableFailed'));
      }
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('notifications.pushEnableError'));
    } finally {
      this.pushBusy = false;
    }
  }

  fmt(ts: any) { return formatDateTime(ts); }

  isRead(n: PlatformNotification): boolean {
    const uid = this.ctx.uid();
    return !!uid && (n.readBy || []).includes(uid);
  }

  unreadIds(): string[] {
    return this.items().filter((n) => !this.isRead(n)).map((n) => n.id);
  }

  async markOneRead(n: PlatformNotification) {
    const uid = this.ctx.uid();
    if (!uid || this.isRead(n) || this.busy) return;
    this.busy = true;
    try {
      await this.repo.markRead(n.id, uid);
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('notifications.updateFailed'));
    } finally {
      this.busy = false;
    }
  }

  async markAllRead() {
    const uid = this.ctx.uid();
    if (!uid || this.busy) return;
    const ids = this.unreadIds();
    if (!ids.length) return;
    this.busy = true;
    try {
      await this.repo.markAllRead(ids, uid);
      this.toast.success(this.i18n.translate('notifications.notificationsMarkedRead', { count: ids.length }));
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('notifications.updateFailed'));
    } finally {
      this.busy = false;
    }
  }

  ngOnDestroy() {
    if (this.unsub) this.unsub();
    this.unsub = null;
  }
}
