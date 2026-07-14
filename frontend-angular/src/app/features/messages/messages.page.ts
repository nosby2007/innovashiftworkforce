import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { MessagesRepo } from '../../core/repos/messages.repo';
import { MessagesCommands } from '../../core/commands/messages.commands';
import { OrgMessage } from '../../shared/models/message.model';
import { formatDateTime } from '../../shared/utils/date.util';
import { ToastService } from '../../core/ui/toast.service';

@Component({
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="vs-page-pad">
      <!-- Header -->
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">Message Center</h1>
          <p class="vs-page-subtitle">Announcements and direct messages</p>
        </div>
      </div>

      <div *ngIf="!orgId" class="msg-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon> Missing org context.
      </div>

      <div *ngIf="orgId">
        <div *ngIf="items().length===0" class="msg-empty vs-glass">
          <mat-icon style="font-size:32px;color:var(--text-subtle);margin-bottom:12px;">mark_email_read</mat-icon>
          <div style="font-size:16px;font-weight:700;">You're all caught up!</div>
          <div style="font-size:13px;color:var(--text-muted);">No messages found.</div>
        </div>

        <div class="msg-list" *ngIf="items().length > 0">
          <div *ngFor="let m of items()" class="vs-glass-strong msg-card" [class.msg-card--unread]="unreadIds().has(m.id)">

            <div class="msg-card-top">
              <div style="display:flex;align-items:center;gap:12px;">
                <mat-icon class="msg-icon">{{ unreadIds().has(m.id) ? 'mail' : 'drafts' }}</mat-icon>
                <div class="msg-title">{{ m.title }}</div>
                <span *ngIf="unreadIds().has(m.id)" class="vs-badge vs-badge--warning" style="font-size:10px;">NEW</span>
              </div>
              <div class="msg-date">{{ fmt(m.createdAt) }}</div>
            </div>

            <div class="msg-card-body">{{ m.body }}</div>

            <div class="msg-card-actions">
              <button class="vs-btn-secondary msg-btn" (click)="open(m)" [disabled]="busyId===m.id || !unreadIds().has(m.id)">
                <mat-icon>done_all</mat-icon>
                {{ busyId===m.id ? 'Marking...' : (unreadIds().has(m.id) ? 'Mark as Read' : 'Read') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .msg-no-org { display:flex; align-items:center; gap:10px; padding:20px; color:var(--warning); font-weight:600; border-radius:var(--radius-md); }
    .msg-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; text-align:center; border-radius:var(--radius-lg); margin-top:20px; }
    
    .msg-list { display:flex; flex-direction:column; gap:16px; margin-top:24px; max-width: 800px; }
    
    .msg-card { padding:20px; border-radius:var(--radius-lg); transition: transform 0.2s, box-shadow 0.2s; border-left: 3px solid transparent; }
    .msg-card--unread { border-left-color: var(--warning); background: rgba(245,158,11,0.03); }
    
    .msg-card-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
    .msg-icon { color:var(--text-subtle); }
    .msg-card--unread .msg-icon { color:var(--warning); }
    .msg-title { font-size:16px; font-weight:800; color:var(--text); }
    .msg-date { font-size:13px; color:var(--text-muted); font-weight:500; }
    
    .msg-card-body { font-size:14px; color:var(--text-muted); line-height:1.6; margin-left:36px; margin-bottom:16px; }
    
    .msg-card-actions { display:flex; justify-content:flex-end; border-top:1px solid var(--border); padding-top:16px; }
    
    .msg-btn { padding:8px 16px !important; font-size:13px !important; display:inline-flex; align-items:center; gap:6px; }
    .msg-btn mat-icon { font-size:16px !important; width:16px; height:16px; }
  `]
})
export class MessagesPage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;

  items = signal<OrgMessage[]>([]);
  unreadIds = signal<Set<string>>(new Set<string>());
  busyId: string | null = null;

  private unsub: (() => void) | null = null;

  constructor(
    private ctx: OrgContextService,
    private repo: MessagesRepo,
    private cmd: MessagesCommands,
    private toast: ToastService
  ) {
    const bind = () => {
      const orgId = this.ctx.orgId();
      const uid = this.ctx.uid();
      this.orgId = orgId; this.uid = uid;
      if (!orgId || !uid) return;
      if (this.unsub) return;

      this.unsub = this.repo.watchLatest(orgId, async (items) => {
        this.items.set(items);
        const top = items.slice(0, 10);
        const unread: string[] = [];
        for (const m of top) {
          const read = await this.repo.isRead(orgId, m.id, uid);
          if (!read) unread.push(m.id);
        }
        this.unreadIds.set(new Set(unread));
      });
    };

    bind();
    setTimeout(bind, 600);
    setTimeout(bind, 1800);
  }

  fmt(ts: any) { return formatDateTime(ts); }

  async open(m: OrgMessage) {
    if (!this.orgId || !this.uid) return;
    this.busyId = m.id;
    try {
      await this.cmd.markRead(m.id);
      this.unreadIds.update((s) => {
        const next = new Set(s);
        next.delete(m.id);
        return next;
      });
      this.toast.success(`Marked as read: ${m.title}`);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to mark read.');
    } finally {
      this.busyId = null;
    }
  }

  ngOnDestroy() {
    if (this.unsub) this.unsub();
    this.unsub = null;
  }
}
