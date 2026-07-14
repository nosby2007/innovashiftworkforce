import { Component, OnDestroy, effect, EffectRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Timestamp } from 'firebase/firestore';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { ShiftChatRepo } from '../../core/repos/shift-chat.repo';
import { Shift } from '../../shared/models/shift.model';
import { ShiftChatMessage } from '../../shared/models/shift-chat.model';
import { ToastService } from '../../core/ui/toast.service';
import { formatDateTime } from '../../shared/utils/date.util';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule],
  template: `
    <div class="vs-page-pad">
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">Shift Live Chat</h1>
          <p class="vs-page-subtitle">Direct conversation between staff and management for each shift</p>
        </div>
      </div>

      <div *ngIf="!orgId" class="sc-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon>
        Missing organization context.
      </div>

      <div *ngIf="orgId" class="sc-layout">
        <aside class="sc-shifts vs-glass">
          <div class="sc-side-head">
            <div class="sc-side-title">Shift Threads</div>
            <input class="vs-input" [(ngModel)]="shiftQuery" placeholder="Search shift title or location" (ngModelChange)="refreshShiftList()">
          </div>

          <div class="sc-shift-list" *ngIf="filteredShifts.length > 0">
            <button
              type="button"
              class="sc-shift-item"
              *ngFor="let s of filteredShifts"
              [class.sc-shift-item--active]="selectedShiftId===s.id"
              (click)="selectShift(s.id)">
              <div class="sc-shift-title">{{ s.title }}</div>
              <div class="sc-shift-meta">{{ s.locationName }} · {{ fmt(s.startAt) }}</div>
            </button>
          </div>

          <div *ngIf="filteredShifts.length===0" class="sc-empty-side">
            No assigned or managed shifts found.
          </div>
        </aside>

        <section class="sc-chat vs-glass-strong" *ngIf="selectedShiftId; else noShiftSelected">
          <div class="sc-chat-head">
            <div>
              <div class="sc-chat-title">{{ selectedShift?.title || 'Shift Chat' }}</div>
              <div class="sc-chat-sub">{{ selectedShift?.locationName }} · {{ fmt(selectedShift?.startAt) }}</div>
            </div>
          </div>

          <div class="sc-msg-list" #scrollEl>
            <div *ngFor="let m of messages()" class="sc-msg-row" [class.sc-msg-row--mine]="m.senderUid===uid">
              <div class="sc-msg-bubble">
                <div class="sc-msg-top">
                  <span class="sc-msg-author">{{ m.senderName || m.senderUid }}</span>
                  <span class="sc-msg-role">{{ m.senderRole }}</span>
                  <span class="sc-msg-time">{{ fmt(m.createdAt) }}</span>
                </div>
                <div class="sc-msg-body">{{ m.message }}</div>
              </div>
            </div>

            <div *ngIf="messages().length===0" class="sc-empty-chat">
              Start the shift conversation with your team.
            </div>
          </div>

          <div class="sc-input-row">
            <textarea
              class="vs-input"
              rows="2"
              [(ngModel)]="draft"
              (keydown.enter)="onEnter($event)"
              placeholder="Type a message for this shift..."></textarea>
            <button class="vs-btn-primary" (click)="send()" [disabled]="sending || !draft.trim()">
              <mat-icon>send</mat-icon>
              {{ sending ? 'Sending...' : 'Send' }}
            </button>
          </div>
        </section>

        <ng-template #noShiftSelected>
          <section class="sc-chat vs-glass-strong sc-empty-chat-panel">
            <mat-icon>forum</mat-icon>
            <div>Select a shift on the left to open live chat.</div>
          </section>
        </ng-template>
      </div>
    </div>
  `,
  styles: [`
    .sc-no-org { display:flex; align-items:center; gap:10px; padding:20px; color:var(--warning); font-weight:600; }
    .sc-layout { display:grid; grid-template-columns: 320px 1fr; gap:14px; min-height: 68vh; }

    .sc-shifts { padding:12px; display:flex; flex-direction:column; }
    .sc-side-head { display:flex; flex-direction:column; gap:8px; margin-bottom:10px; }
    .sc-side-title { font-size:14px; font-weight:800; color:var(--text); }
    .sc-shift-list { display:flex; flex-direction:column; gap:8px; overflow:auto; }
    .sc-shift-item { text-align:left; border:1px solid var(--border); background:var(--panel); color:var(--text); border-radius:10px; padding:10px; cursor:pointer; }
    .sc-shift-item--active { border-color:rgba(99,102,241,0.40); background:rgba(99,102,241,0.10); }
    .sc-shift-title { font-size:13px; font-weight:700; }
    .sc-shift-meta { font-size:11px; color:var(--text-muted); margin-top:4px; }
    .sc-empty-side { font-size:12px; color:var(--text-subtle); padding:12px; }

    .sc-chat { display:flex; flex-direction:column; min-height: 68vh; }
    .sc-chat-head { padding:14px 16px; border-bottom:1px solid var(--border); }
    .sc-chat-title { font-size:16px; font-weight:800; color:var(--text); }
    .sc-chat-sub { font-size:12px; color:var(--text-muted); margin-top:2px; }

    .sc-msg-list { flex:1; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:10px; }
    .sc-msg-row { display:flex; justify-content:flex-start; }
    .sc-msg-row--mine { justify-content:flex-end; }
    .sc-msg-bubble { max-width: 76%; background: var(--panel); border:1px solid var(--border); border-radius: 12px; padding:10px 12px; }
    .sc-msg-row--mine .sc-msg-bubble { background: rgba(99,102,241,0.14); border-color: rgba(99,102,241,0.35); }
    .sc-msg-top { display:flex; align-items:center; gap:8px; font-size:11px; margin-bottom:6px; }
    .sc-msg-author { font-weight:700; color:var(--text); }
    .sc-msg-role { color:var(--text-muted); }
    .sc-msg-time { color:var(--text-subtle); margin-left:auto; }
    .sc-msg-body { white-space:pre-wrap; color:var(--text); font-size:13px; line-height:1.45; }
    .sc-empty-chat { color:var(--text-subtle); font-size:13px; padding:10px; }

    .sc-input-row { border-top:1px solid var(--border); padding:12px; display:flex; gap:10px; align-items:flex-end; }
    .sc-input-row textarea { resize: vertical; min-height: 56px; }

    .sc-empty-chat-panel { display:flex; align-items:center; justify-content:center; flex-direction:column; gap:10px; color:var(--text-subtle); }

    @media (max-width: 980px) {
      .sc-layout { grid-template-columns: 1fr; }
      .sc-shifts { max-height: 240px; }
      .sc-chat { min-height: 56vh; }
    }
  `]
})
export class ShiftChatPage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;
  userName = '';
  userRole = '';
  isAdminLike = false;

  allShifts = signal<Shift[]>([]);
  filteredShifts: Shift[] = [];
  selectedShiftId: string | null = null;
  selectedShift: Shift | null = null;
  shiftQuery = '';

  messages = signal<ShiftChatMessage[]>([]);
  draft = '';
  sending = false;
  private requestedShiftId: string | null = null;

  private effectRef?: EffectRef;
  private shiftUnsub: (() => void) | null = null;
  private chatUnsub: (() => void) | null = null;
  private routeSub: any;

  constructor(
    private ctx: OrgContextService,
    private route: ActivatedRoute,
    private shiftsRepo: ShiftsRepo,
    private chatRepo: ShiftChatRepo,
    private toast: ToastService
  ) {
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const shiftId = (params.get('shiftId') || '').trim();
      this.requestedShiftId = shiftId || null;
      this.tryApplyRequestedShift();
    });

    this.effectRef = effect(() => {
      const orgId = this.ctx.orgId();
      const uid = this.ctx.uid();
      const accessRole = (this.ctx.accessRole() || '').toLowerCase();

      this.orgId = orgId;
      this.uid = uid;
      this.userName = (this.ctx.displayName() || this.ctx.email() || uid || 'User').toString();
      this.userRole = accessRole || 'staff';
      this.isAdminLike = ['admin', 'manager', 'scheduler', 'hr'].includes(accessRole);

      this.cleanupShiftWatcher();
      this.cleanupChatWatcher();
      this.allShifts.set([]);
      this.filteredShifts = [];
      this.selectedShiftId = null;
      this.selectedShift = null;
      this.messages.set([]);

      if (!orgId || !uid) return;

      if (this.isAdminLike) {
        const start = Timestamp.fromMillis(Date.now() - 14 * 24 * 60 * 60 * 1000);
        const end = Timestamp.fromMillis(Date.now() + 45 * 24 * 60 * 60 * 1000);
        this.shiftUnsub = this.shiftsRepo.watchOrgRange(orgId, start, end, (items) => {
          this.allShifts.set(items);
          this.refreshShiftList();
        }, 300);
      } else {
        this.shiftUnsub = this.shiftsRepo.watchAssignedShifts(orgId, uid, (items) => {
          this.allShifts.set(items);
          this.refreshShiftList();
        }, 120);
      }
    });
  }

  fmt(ts: any) {
    return formatDateTime(ts);
  }

  refreshShiftList() {
    const q = this.shiftQuery.toLowerCase().trim();
    const items = q
      ? this.allShifts().filter((s) => {
          const t = (s.title || '').toLowerCase();
          const l = (s.locationName || '').toLowerCase();
          return t.includes(q) || l.includes(q) || s.id.toLowerCase().includes(q);
        })
      : this.allShifts();

    this.filteredShifts = items.slice(0, 120);

    if (this.tryApplyRequestedShift()) {
      return;
    }

    if (!this.selectedShiftId && this.filteredShifts.length > 0) {
      this.selectShift(this.filteredShifts[0].id);
      return;
    }

    if (this.selectedShiftId && !this.filteredShifts.some((s) => s.id === this.selectedShiftId)) {
      this.selectShift(this.filteredShifts[0]?.id || null);
    } else {
      this.selectedShift = this.filteredShifts.find((s) => s.id === this.selectedShiftId) || null;
    }
  }

  private tryApplyRequestedShift(): boolean {
    if (!this.requestedShiftId) return false;
    const hit = this.filteredShifts.find((s) => s.id === this.requestedShiftId);
    if (!hit) return false;
    this.selectShift(hit.id);
    this.requestedShiftId = null;
    return true;
  }

  selectShift(shiftId: string | null) {
    this.selectedShiftId = shiftId;
    this.selectedShift = this.filteredShifts.find((s) => s.id === shiftId) || null;

    this.cleanupChatWatcher();
    this.messages.set([]);

    if (!this.orgId || !shiftId) return;
    this.chatUnsub = this.chatRepo.watchMessages(this.orgId, shiftId, (items) => {
      this.messages.set(items);
    });
  }

  onEnter(ev: KeyboardEvent) {
    if (ev.shiftKey) return;
    ev.preventDefault();
    this.send();
  }

  async send() {
    if (!this.orgId || !this.uid || !this.selectedShiftId) {
      this.toast.error('Select a shift before sending a message. [E_CHAT_SHIFT_REQUIRED]');
      return;
    }
    const text = this.draft.trim();
    if (!text) return;

    this.sending = true;
    try {
      await this.chatRepo.sendMessage({
        orgId: this.orgId,
        shiftId: this.selectedShiftId,
        senderUid: this.uid,
        senderName: this.userName,
        senderRole: this.userRole,
        message: text,
      });
      this.draft = '';
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to send chat message.');
    } finally {
      this.sending = false;
    }
  }

  private cleanupShiftWatcher() {
    if (this.shiftUnsub) this.shiftUnsub();
    this.shiftUnsub = null;
  }

  private cleanupChatWatcher() {
    if (this.chatUnsub) this.chatUnsub();
    this.chatUnsub = null;
  }

  ngOnDestroy() {
    this.cleanupShiftWatcher();
    this.cleanupChatWatcher();
    this.effectRef?.destroy();
    this.routeSub?.unsubscribe?.();
  }
}
