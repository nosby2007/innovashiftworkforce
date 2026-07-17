import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { SuperAdminService, ContactRequestItem, ContactRequestStatus } from './super-admin.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatDateTime } from '../../shared/utils/date.util';

/**
 * Demo requests submitted through the public Contact page are notified by
 * email automatically (contactIntake) so nothing depends on a super admin
 * being online at the moment they arrive — this panel is the durable,
 * always-there queue for whenever someone next checks in.
 */
@Component({
  standalone: true,
  selector: 'app-super-admin-demo-requests',
  imports: [CommonModule, MatIconModule],
  template: `
    <section class="vs-glass-strong sdr-panel" *ngIf="requests().length > 0 || loading()">
      <div class="vs-panel-head">
        <div>
          <div class="vs-panel-title">Demo Requests <span class="sdr-badge" *ngIf="pendingCount() > 0">{{ pendingCount() }} new</span></div>
          <div class="vs-panel-subtitle">Submitted via the public Contact page — the requester and your team both got an automatic email, this is the follow-up queue</div>
        </div>
        <div class="sdr-head-actions">
          <button class="vs-btn-ghost" type="button" (click)="showAll.set(!showAll())">
            {{ showAll() ? 'Show pending only' : 'Show all' }}
          </button>
          <button class="vs-btn-ghost" type="button" (click)="load()" [disabled]="loading()">
            <mat-icon [class.sa-spin]="loading()">refresh</mat-icon>
          </button>
        </div>
      </div>

      <div class="sdr-empty" *ngIf="!loading() && visibleRequests().length === 0">
        <mat-icon>inbox</mat-icon> No {{ showAll() ? '' : 'pending ' }}demo requests.
      </div>

      <div class="sdr-row" *ngFor="let r of visibleRequests()">
        <div class="sdr-main">
          <div class="sdr-title">
            <strong>{{ r.name }}</strong> · {{ r.organization }}
            <span class="vs-badge"
                  [class.vs-badge--warning]="r.status === 'new'"
                  [class.vs-badge--success]="r.status === 'converted'"
                  [class.vs-badge--neutral]="r.status === 'contacted'"
                  [class.vs-badge--danger]="r.status === 'dismissed'">
              {{ r.status }}
            </span>
          </div>
          <div class="sdr-meta">
            <a [href]="'mailto:' + r.email">{{ r.email }}</a> · {{ r.size }} employees · {{ fmt(r.createdAt) }}
          </div>
          <div class="sdr-message" *ngIf="r.message">{{ r.message }}</div>
        </div>
        <div class="sdr-actions">
          <button class="vs-btn-ghost sdr-btn" type="button" (click)="setStatus(r, 'contacted')" [disabled]="busyId() === r.id || r.status === 'contacted'">
            Contacted
          </button>
          <button class="vs-btn-primary sdr-btn" type="button" (click)="setStatus(r, 'converted')" [disabled]="busyId() === r.id || r.status === 'converted'">
            Converted
          </button>
          <button class="vs-btn-ghost sdr-btn" type="button" (click)="setStatus(r, 'dismissed')" [disabled]="busyId() === r.id || r.status === 'dismissed'">
            Dismiss
          </button>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .sdr-panel { margin-bottom: 20px; padding: 18px 20px; }
    .sdr-badge { display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 800; vertical-align: middle; }
    .sdr-head-actions { display: flex; align-items: center; gap: 8px; }
    .sdr-empty { display: flex; align-items: center; gap: 8px; padding: 24px 4px; color: var(--text-muted); font-size: 13px; }
    .sdr-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 12px 4px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .sdr-row:last-child { border-bottom: none; }
    .sdr-main { min-width: 0; flex: 1; }
    .sdr-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
    .sdr-meta { margin-top: 4px; font-size: 12px; color: var(--text-muted); }
    .sdr-meta a { color: inherit; }
    .sdr-message { margin-top: 6px; font-size: 12.5px; color: var(--text); background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
    .sdr-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .sdr-btn { padding: 6px 12px !important; font-size: 12px !important; }
  `],
})
export class SuperAdminDemoRequestsComponent {
  requests = signal<ContactRequestItem[]>([]);
  loading = signal(false);
  busyId = signal<string | null>(null);
  showAll = signal(false);

  pendingCount = computed(() => this.requests().filter((r) => r.status === 'new').length);
  visibleRequests = computed(() => this.showAll() ? this.requests() : this.requests().filter((r) => r.status === 'new'));

  constructor(private sa: SuperAdminService, private toast: ToastService) {
    this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      this.requests.set(await this.sa.listContactRequests());
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to load demo requests.');
    } finally {
      this.loading.set(false);
    }
  }

  async setStatus(r: ContactRequestItem, status: ContactRequestStatus) {
    if (this.busyId()) return;
    this.busyId.set(r.id);
    try {
      await this.sa.updateContactRequestStatus(r.id, status);
      this.requests.set(this.requests().map((x) => x.id === r.id ? { ...x, status } : x));
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to update status.');
    } finally {
      this.busyId.set(null);
    }
  }

  fmt(ts: any) { return formatDateTime(ts); }
}
