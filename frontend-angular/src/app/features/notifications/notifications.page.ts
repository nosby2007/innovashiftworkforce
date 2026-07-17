import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { NotificationsRepo, UserNotification, NOTIFICATION_ARCHIVE_RETENTION_DAYS } from '../../core/repos/notifications.repo';
import { ToastService } from '../../core/ui/toast.service';
import { PushNotificationsService } from '../../core/push/push-notifications.service';
import { formatDateTime } from '../../shared/utils/date.util';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="ntf-center">
      <header class="ntf-top">
        <h1>Control Center</h1>
        <div class="ntf-top-actions">
          <button *ngIf="pushSupported && !pushEnabled" type="button" (click)="enablePush()" [disabled]="pushBusy">
            <mat-icon>notifications_active</mat-icon><span>{{ pushBusy ? 'Enabling…' : 'Enable Push' }}</span>
          </button>
          <button type="button" (click)="markFilteredRead()" [disabled]="busy || unreadFilteredIds().length === 0">
            <mat-icon>done_all</mat-icon><span>Mark Read</span>
          </button>
          <button type="button" (click)="activeCategory = 'unread'; selectedIndex = 0">
            <mat-icon>filter_alt</mat-icon><span>Unread</span>
          </button>
          <button type="button" (click)="activeCategory = 'all'; selectedIndex = 0">
            <mat-icon>select_all</mat-icon><span>All</span>
          </button>
        </div>
      </header>

      <div *ngIf="!orgId" class="ntf-no-org">
        <mat-icon>warning_amber</mat-icon> Missing org context.
      </div>

      <section class="ntf-shell" *ngIf="orgId">
        <aside class="ntf-cats">
          <div class="ntf-cat-title">Categories</div>
          <button *ngFor="let c of categories()"
                  [class.is-active]="activeCategory === c.key"
                  (click)="activeCategory = c.key; selectedIndex = 0">
            <strong>{{ c.count }}</strong>
            <span>{{ c.label }}</span>
          </button>
        </aside>

        <main class="ntf-main">
          <div class="ntf-filter">
            <span>Filter:</span>
            <select [(ngModel)]="activeCategory">
              <option value="all">No Status, Cancel Submitted</option>
              <option value="unread">Unread</option>
              <option value="system">System Messages</option>
              <option value="shift">Shift Updates</option>
              <option value="time">Timekeeping Requests</option>
            </select>
          </div>

          <div class="ntf-empty" *ngIf="filteredItems().length===0">
            There are no notifications to display for selected criteria.
          </div>

          <button *ngFor="let n of filteredItems(); let i = index"
                  class="ntf-row"
                  [class.is-active]="i === selectedIndex"
                  (click)="selectItem(i)">
            <mat-icon>{{ getIcon(n.type) }}</mat-icon>
            <div>
              <strong>{{ n.title }}</strong>
              <span>{{ n.body }}</span>
              <em>{{ fmt(n.createdAt) }}</em>
            </div>
            <b *ngIf="!n.read">New</b>
          </button>
        </main>

        <aside class="ntf-detail">
          <h2>Details</h2>
          <ng-container *ngIf="selectedItem() as n; else noDetail">
            <div class="ntf-detail-card">
              <mat-icon>{{ getIcon(n.type) }}</mat-icon>
              <div>
                <strong>{{ n.title }}</strong>
                <span>{{ n.read ? 'Read' : 'New' }}</span>
              </div>
            </div>
            <div class="ntf-detail-block">
              <span>Subject</span>
              <strong>{{ n.title }}</strong>
            </div>
            <div class="ntf-detail-block">
              <span>Body</span>
              <p>{{ n.body }}</p>
            </div>
            <div class="ntf-detail-block">
              <span>Created</span>
              <strong>{{ fmt(n.createdAt) }}</strong>
            </div>
            <button class="ntf-detail-action" type="button" (click)="markOneRead(n)" [disabled]="busy || n.read">
              <mat-icon>done</mat-icon>
              {{ n.read ? 'Already read' : 'Mark as read' }}
            </button>
            <button class="ntf-detail-action ntf-detail-action--danger" type="button" (click)="deleteNotification(n)" [disabled]="busy">
              <mat-icon>delete_outline</mat-icon>
              Delete
            </button>
            <p class="ntf-detail-hint">Deleted notifications are removed from this list right away and permanently erased after {{ retentionDays }} days.</p>
          </ng-container>
          <ng-template #noDetail>
            <div class="ntf-muted">Select a notification to review details.</div>
          </ng-template>
        </aside>
      </section>
    </div>
  `,
  styles: [`
    .ntf-center { margin:-24px -22px; min-height:calc(100vh - 58px); background:#f8fafc; color:#1f2937; }
    .ntf-top { height:86px; background:#07533f; color:#fff; display:flex; align-items:end; justify-content:space-between; gap:16px; padding:0 28px 14px; }
    .ntf-top h1 { margin:0; font-size:18px; font-weight:700; }
    .ntf-top-actions { display:flex; gap:18px; }
    .ntf-top-actions button { border:0; background:transparent; color:rgba(255,255,255,.9); display:grid; justify-items:center; gap:3px; font-size:11px; cursor:pointer; }
    .ntf-top-actions button:disabled { opacity:.45; cursor:not-allowed; }
    .ntf-top-actions mat-icon { font-size:19px; width:19px; height:19px; }
    .ntf-no-org { margin:18px; padding:14px 16px; display:flex; gap:8px; color:#92400e; background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; }
    .ntf-shell { display:grid; grid-template-columns:170px minmax(0, 1fr) 260px; min-height:calc(100vh - 144px); }
    .ntf-cats { border-right:1px solid #d9e0e7; background:#eef3ef; padding:12px 0; }
    .ntf-cat-title { padding:0 14px 10px; color:#334155; font-size:12px; font-weight:800; }
    .ntf-cats button { width:100%; height:40px; border:0; border-bottom:1px solid #d9e0e7; background:transparent; display:grid; grid-template-columns:30px 1fr; align-items:center; text-align:left; color:#334155; cursor:pointer; }
    .ntf-cats button.is-active { background:#fff; border-left:3px solid #047857; }
    .ntf-cats strong { text-align:center; color:#0f172a; }
    .ntf-main { background:#fff; border-right:1px solid #d9e0e7; }
    .ntf-filter { height:45px; display:flex; align-items:center; gap:10px; padding:0 14px; border-bottom:1px solid #d9e0e7; color:#475569; font-size:12px; }
    .ntf-filter select { height:30px; border:1px solid #cbd5e1; border-radius:4px; background:#fff; color:#111827; }
    .ntf-empty { padding:70px 20px; text-align:center; color:#475569; font-size:12px; }
    .ntf-row { width:100%; min-height:78px; border:0; border-bottom:1px solid #d9e0e7; background:#fff; display:grid; grid-template-columns:28px 1fr 40px; gap:12px; align-items:start; padding:12px 14px; text-align:left; cursor:pointer; }
    .ntf-row.is-active { outline:2px solid #64748b; outline-offset:-4px; background:#f8fafc; }
    .ntf-row mat-icon { color:#475569; font-size:18px; width:18px; height:18px; }
    .ntf-row strong { display:block; color:#0f172a; font-size:13px; }
    .ntf-row span { display:block; margin-top:4px; color:#475569; font-size:12px; line-height:1.35; }
    .ntf-row em { display:block; margin-top:5px; color:#64748b; font-style:normal; font-size:11px; }
    .ntf-row b { justify-self:end; color:#0f766e; font-size:11px; }
    .ntf-detail { background:#eef3ef; padding:14px; }
    .ntf-detail h2 { margin:0 0 14px; text-align:center; font-size:13px; }
    .ntf-detail-card { display:flex; gap:10px; align-items:center; padding:12px 0; border-bottom:1px solid #d9e0e7; }
    .ntf-detail-card mat-icon { color:#64748b; }
    .ntf-detail-card strong { display:block; color:#0f172a; }
    .ntf-detail-card span { color:#475569; font-size:12px; }
    .ntf-detail-block { padding:12px 0; border-bottom:1px solid #d9e0e7; }
    .ntf-detail-block span { display:block; color:#64748b; font-size:11px; margin-bottom:6px; }
    .ntf-detail-block strong, .ntf-detail-block p { margin:0; color:#1f2937; font-size:12px; line-height:1.45; }
    .ntf-detail-action { width:100%; height:38px; margin-top:14px; border:1px solid #0f766e; border-radius:8px; background:#0f766e; color:#fff; display:inline-flex; align-items:center; justify-content:center; gap:8px; font-weight:800; cursor:pointer; }
    .ntf-detail-action:disabled { opacity:.55; cursor:not-allowed; background:#94a3b8; border-color:#94a3b8; }
    .ntf-detail-action mat-icon { font-size:18px; width:18px; height:18px; }
    .ntf-detail-action--danger { margin-top:8px; background:#fff; color:#b91c1c; border-color:#fecaca; }
    .ntf-detail-action--danger:disabled { background:#fff; color:#b91c1c; border-color:#fecaca; }
    .ntf-detail-hint { margin:10px 0 0; color:#64748b; font-size:11px; line-height:1.4; }
    .ntf-muted { color:#64748b; font-size:12px; }
    @media (max-width: 980px) { .ntf-shell { grid-template-columns:1fr; } .ntf-cats, .ntf-detail { border:0; } .ntf-top { align-items:flex-start; flex-direction:column; height:auto; padding:16px; } }
  `]
})
export class NotificationsPage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;
  items = signal<UserNotification[]>([]);
  activeCategory = 'all';
  selectedIndex = 0;
  busy = false;
  pushBusy = false;
  pushSupported = false;
  pushEnabled = false;
  readonly retentionDays = NOTIFICATION_ARCHIVE_RETENTION_DAYS;
  private unsub: (() => void) | null = null;

  constructor(
    private ctx: OrgContextService,
    private repo: NotificationsRepo,
    private toast: ToastService,
    private push: PushNotificationsService
  ) {
    this.pushSupported = this.push.isSupportedPlatform();
    this.pushEnabled = this.push.isEnabled();

    const bind = () => {
      const orgId = this.ctx.orgId();
      const uid = this.ctx.uid();
      this.orgId = orgId; this.uid = uid;
      if (!orgId || !uid) return;
      if (this.unsub) return;
      this.unsub = this.repo.watchMy(orgId, uid, (items) => this.items.set(items));
    };

    bind();
    setTimeout(bind, 700);
    setTimeout(bind, 2000);
  }

  async enablePush() {
    if (this.pushBusy) return;
    this.pushBusy = true;
    try {
      const ok = await this.push.enable();
      this.pushEnabled = ok;
      if (ok) {
        this.toast.success('Push notifications enabled — you\'ll be alerted when a matching shift opens up.');
      } else {
        this.toast.error('Could not enable push notifications. Check that notification permission is allowed for this app.');
      }
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to enable push notifications.');
    } finally {
      this.pushBusy = false;
    }
  }

  fmt(ts: any) { return formatDateTime(ts); }

  getIcon(type: string): string {
    switch(type) {
      case 'shift_assigned': return 'event_available';
      case 'shift_unassigned': return 'event_busy';
      case 'time_correction': return 'update';
      case 'system': return 'info_outline';
      case 'ai_digest': return 'auto_awesome';
      default: return 'notifications';
    }
  }

  categories() {
    return [
      { key: 'all', label: 'My Requests', count: this.items().length },
      { key: 'unread', label: 'Unread', count: this.items().filter((x) => !x.read).length },
      { key: 'system', label: 'System Messages', count: this.items().filter((x) => x.type === 'system').length },
      { key: 'shift', label: 'Open Shift Available', count: this.items().filter((x) => String(x.type).includes('shift')).length },
      { key: 'time', label: 'Timekeeping Requ...', count: this.items().filter((x) => String(x.type).includes('time')).length },
      { key: 'employee', label: 'Employee Requests', count: this.items().filter((x) => !x.read).length },
    ];
  }

  filteredItems(): UserNotification[] {
    if (this.activeCategory === 'all') return this.items();
    if (this.activeCategory === 'unread') return this.items().filter((x) => !x.read);
    if (this.activeCategory === 'system') return this.items().filter((x) => x.type === 'system');
    if (this.activeCategory === 'shift') return this.items().filter((x) => String(x.type).includes('shift'));
    if (this.activeCategory === 'time') return this.items().filter((x) => String(x.type).includes('time'));
    return this.items().filter((x) => !x.read);
  }

  async selectItem(index: number) {
    this.selectedIndex = index;
    const item = this.filteredItems()[index];
    if (item && !item.read) await this.markOneRead(item, false);
  }

  selectedItem(): UserNotification | null {
    return this.filteredItems()[this.selectedIndex] || null;
  }

  unreadFilteredIds(): string[] {
    return this.filteredItems().filter((n) => !n.read).map((n) => n.id);
  }

  async markFilteredRead() {
    if (!this.orgId || !this.uid || this.busy) return;
    const ids = this.unreadFilteredIds();
    if (!ids.length) return;
    this.busy = true;
    try {
      await this.repo.markAllRead(this.orgId, this.uid, ids);
      this.toast.success(`${ids.length} notification(s) marked read.`);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to update notifications.');
    } finally {
      this.busy = false;
    }
  }

  async markOneRead(notification: UserNotification, showToast = true) {
    if (!this.orgId || !this.uid || !notification?.id || notification.read || this.busy) return;
    this.busy = true;
    try {
      await this.repo.markRead(this.orgId, this.uid, notification.id);
      if (showToast) this.toast.success('Notification marked read.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to update notification.');
    } finally {
      this.busy = false;
    }
  }

  async deleteNotification(notification: UserNotification) {
    if (!this.orgId || !this.uid || !notification?.id || this.busy) return;
    this.busy = true;
    try {
      await this.repo.archive(this.orgId, this.uid, notification.id);
      this.items.set(this.items().filter((n) => n.id !== notification.id));
      this.selectedIndex = 0;
      this.toast.success('Notification deleted.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to delete notification.');
    } finally {
      this.busy = false;
    }
  }

  ngOnDestroy() {
    if (this.unsub) this.unsub();
    this.unsub = null;
  }
}
