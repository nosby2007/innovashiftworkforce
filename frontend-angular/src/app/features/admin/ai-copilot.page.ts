import { Component, ElementRef, OnDestroy, ViewChild, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { AiAssistantCommands, AiChatTurn, AiProposal } from '../../core/commands/ai-assistant.commands';
import { SchedulerCommands } from '../../core/commands/scheduler.commands';
import { ShiftAdminCommands } from '../../core/commands/shift-admin.commands';
import { ToastService } from '../../core/ui/toast.service';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { AiDigestRepo, AiDigest } from '../../core/repos/ai-digest.repo';

type ProposalStatus = 'pending' | 'confirmed' | 'dismissed' | 'error';

interface DisplayProposal extends AiProposal {
  status: ProposalStatus;
  busy: boolean;
}

interface DisplayMessage {
  role: 'user' | 'assistant';
  text: string;
  proposals: DisplayProposal[];
}

const SUGGESTIONS = [
  'What shifts are still open this week?',
  'Who is scheduled tomorrow?',
  'Find someone to cover an open RN shift',
];

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, DatePipe],
  template: `
    <div class="vs-page-pad ac-page">
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">AI Copilot</h1>
          <p class="vs-page-subtitle">Ask about coverage, staffing, and shifts — every action needs your confirmation before it happens.</p>
        </div>
      </div>

      <div class="vs-glass-strong ac-digest" *ngIf="digest() as d">
        <div class="ac-digest-head">
          <mat-icon class="ac-digest-icon">wb_sunny</mat-icon>
          <div>
            <div class="ac-digest-title">Today's Digest</div>
            <div class="ac-digest-date">{{ d.generatedAt?.toDate ? (d.generatedAt.toDate() | date:'EEE MMM d, h:mm a') : d.dateKey }}</div>
          </div>
        </div>
        <div class="ac-digest-summary">{{ d.summary }}</div>

        <div class="ac-proposals" *ngIf="digestProposals().length">
          <div class="ac-proposal" *ngFor="let p of digestProposals()" [class.ac-proposal--done]="p.status !== 'pending'">
            <div class="ac-proposal-summary">
              <mat-icon class="ac-proposal-icon">{{ iconFor(p.kind) }}</mat-icon>
              <span>{{ p.summary }}</span>
            </div>
            <div class="ac-proposal-actions" *ngIf="p.status === 'pending'">
              <button class="vs-btn-primary ac-btn-sm" type="button" [disabled]="p.busy" (click)="confirmProposal(p)">
                <mat-icon *ngIf="!p.busy">check</mat-icon> Confirm
              </button>
              <button class="vs-btn-ghost ac-btn-sm" type="button" [disabled]="p.busy" (click)="dismissProposal(p)">Dismiss</button>
            </div>
            <div class="ac-proposal-status" *ngIf="p.status === 'confirmed'"><mat-icon>check_circle</mat-icon> Done</div>
            <div class="ac-proposal-status" *ngIf="p.status === 'dismissed'"><mat-icon>cancel</mat-icon> Dismissed</div>
            <div class="ac-proposal-status ac-proposal-status--error" *ngIf="p.status === 'error'"><mat-icon>error</mat-icon> Failed</div>
          </div>
        </div>
      </div>

      <div class="vs-glass-strong ac-panel">
        <div class="ac-messages" #scrollAnchor>
          <div class="ac-empty" *ngIf="messages().length === 0">
            <mat-icon class="ac-empty-icon">auto_awesome</mat-icon>
            <div class="ac-empty-title">Ask me anything about your schedule</div>
            <div class="ac-suggestions">
              <button class="vs-btn-ghost ac-suggestion" type="button" *ngFor="let s of suggestions" (click)="sendSuggestion(s)">
                {{ s }}
              </button>
            </div>
          </div>

          <div class="ac-msg" *ngFor="let m of messages()" [class.ac-msg--user]="m.role === 'user'">
            <div class="ac-bubble">
              <div class="ac-bubble-text">{{ m.text }}</div>

              <div class="ac-proposals" *ngIf="m.proposals.length">
                <div class="ac-proposal" *ngFor="let p of m.proposals" [class.ac-proposal--done]="p.status !== 'pending'">
                  <div class="ac-proposal-summary">
                    <mat-icon class="ac-proposal-icon">{{ iconFor(p.kind) }}</mat-icon>
                    <span>{{ p.summary }}</span>
                  </div>
                  <div class="ac-proposal-actions" *ngIf="p.status === 'pending'">
                    <button class="vs-btn-primary ac-btn-sm" type="button" [disabled]="p.busy" (click)="confirmProposal(p)">
                      <mat-icon *ngIf="!p.busy">check</mat-icon> Confirm
                    </button>
                    <button class="vs-btn-ghost ac-btn-sm" type="button" [disabled]="p.busy" (click)="dismissProposal(p)">Dismiss</button>
                  </div>
                  <div class="ac-proposal-status" *ngIf="p.status === 'confirmed'"><mat-icon>check_circle</mat-icon> Done</div>
                  <div class="ac-proposal-status" *ngIf="p.status === 'dismissed'"><mat-icon>cancel</mat-icon> Dismissed</div>
                  <div class="ac-proposal-status ac-proposal-status--error" *ngIf="p.status === 'error'"><mat-icon>error</mat-icon> Failed</div>
                </div>
              </div>
            </div>
          </div>

          <div class="ac-msg" *ngIf="sending()">
            <div class="ac-bubble ac-bubble--typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>

        <div class="ac-composer">
          <input
            class="vs-input ac-input"
            type="text"
            placeholder="Ask the copilot..."
            [(ngModel)]="draft"
            (keydown.enter)="send()"
            [disabled]="sending()">
          <button class="vs-btn-primary ac-send-btn" type="button" [disabled]="sending() || !draft.trim()" (click)="send()">
            <mat-icon>send</mat-icon>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ac-page { width: 100%; max-width: 900px; margin: 0 auto; }

    .ac-digest { padding: 18px 20px; margin-bottom: 16px; }
    .ac-digest-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .ac-digest-icon { color: #f59e0b; font-size: 24px !important; width: 24px !important; height: 24px !important; }
    .ac-digest-title { font-weight: 800; font-size: 15px; }
    .ac-digest-date { font-size: 11.5px; color: var(--text-muted); }
    .ac-digest-summary { font-size: 13.5px; line-height: 1.5; color: var(--text); margin-bottom: 4px; }

    .ac-panel { display: flex; flex-direction: column; height: min(72vh, 760px); overflow: hidden; }

    .ac-messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }

    .ac-empty { margin: auto; text-align: center; color: var(--text-muted); padding: 20px; }
    .ac-empty-icon { font-size: 40px !important; width: 40px !important; height: 40px !important; opacity: .5; margin-bottom: 10px; }
    .ac-empty-title { font-weight: 700; margin-bottom: 16px; }
    .ac-suggestions { display: flex; flex-direction: column; gap: 8px; align-items: center; }
    .ac-suggestion { font-size: 13px; }

    .ac-msg { display: flex; }
    .ac-msg--user { justify-content: flex-end; }
    .ac-bubble {
      max-width: 78%; padding: 12px 16px; border-radius: 14px;
      background: var(--bg-elevated); border: 1px solid var(--border);
      white-space: pre-wrap; line-height: 1.5; font-size: 14px;
    }
    .ac-msg--user .ac-bubble { background: var(--primary); color: #fff; border-color: var(--primary); }

    .ac-bubble--typing { display: flex; gap: 4px; align-items: center; padding: 16px; }
    .ac-bubble--typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); animation: ac-bounce 1.2s infinite ease-in-out; }
    .ac-bubble--typing span:nth-child(2) { animation-delay: .15s; }
    .ac-bubble--typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes ac-bounce { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }

    .ac-proposals { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
    .ac-proposal {
      border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px;
      background: var(--panel); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    }
    .ac-proposal--done { opacity: .75; }
    .ac-proposal-summary { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; }
    .ac-proposal-icon { font-size: 18px !important; width: 18px !important; height: 18px !important; color: var(--primary); }
    .ac-proposal-actions { display: flex; gap: 6px; }
    .ac-btn-sm { padding: 5px 12px !important; font-size: 12.5px !important; display: inline-flex; align-items: center; gap: 4px; }
    .ac-btn-sm mat-icon { font-size: 15px !important; width: 15px !important; height: 15px !important; }
    .ac-proposal-status { display: flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--success); font-weight: 600; }
    .ac-proposal-status--error { color: var(--danger); }
    .ac-proposal-status mat-icon { font-size: 16px !important; width: 16px !important; height: 16px !important; }

    .ac-composer { display: flex; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--border); background: var(--bg-surface); }
    .ac-input { flex: 1; }
    .ac-send-btn { display: inline-flex; align-items: center; justify-content: center; width: 44px; padding: 0 !important; }
  `],
})
export class AiCopilotPage implements OnDestroy {
  @ViewChild('scrollAnchor') private scrollAnchor?: ElementRef<HTMLDivElement>;

  suggestions = SUGGESTIONS;
  draft = '';
  messages = signal<DisplayMessage[]>([]);
  sending = signal(false);

  digest = signal<AiDigest | null>(null);
  digestProposals = signal<DisplayProposal[]>([]);

  private history: AiChatTurn[] = [];
  private unsubDigest: (() => void) | null = null;

  constructor(
    private ai: AiAssistantCommands,
    private schedulerCmd: SchedulerCommands,
    private shiftAdminCmd: ShiftAdminCommands,
    private toast: ToastService,
    private ctx: OrgContextService,
    private digestRepo: AiDigestRepo,
  ) {
    const bind = () => {
      const orgId = this.ctx.orgId();
      if (!orgId || this.unsubDigest) return;
      this.unsubDigest = this.digestRepo.watchLatest(orgId, (d) => {
        this.digest.set(d);
        this.digestProposals.set((d?.proposals || []).map((p) => ({ ...p, status: 'pending', busy: false })));
      });
    };
    bind();
    setTimeout(bind, 800);
    setTimeout(bind, 2200);
  }

  ngOnDestroy() {
    this.unsubDigest?.();
  }

  sendSuggestion(text: string) {
    this.draft = text;
    this.send();
  }

  async send() {
    const text = this.draft.trim();
    if (!text || this.sending()) return;
    this.draft = '';

    this.messages.update((list) => [...list, { role: 'user', text, proposals: [] }]);
    this.sending.set(true);
    this.scrollToBottom();

    try {
      const res = await this.ai.chat(text, this.history);
      const newTurns: AiChatTurn[] = [{ role: 'user', text }, { role: 'assistant', text: res.reply }];
      this.history = [...this.history, ...newTurns].slice(-20);
      const proposals: DisplayProposal[] = (res.proposals || []).map((p) => ({ ...p, status: 'pending', busy: false }));
      this.messages.update((list) => [...list, { role: 'assistant', text: res.reply, proposals }]);
    } catch (e: any) {
      this.toast.errorFrom(e, 'AI Copilot is unavailable right now.');
      this.messages.update((list) => [...list, { role: 'assistant', text: "Sorry, I couldn't process that. Please try again.", proposals: [] }]);
    } finally {
      this.sending.set(false);
      this.scrollToBottom();
    }
  }

  async confirmProposal(p: DisplayProposal) {
    p.busy = true;
    try {
      switch (p.kind) {
        case 'create_shift':
          await this.shiftAdminCmd.createShift({
            title: p.payload['title'],
            locationName: p.payload['locationName'],
            startAtMs: p.payload['startAtMs'],
            endAtMs: p.payload['endAtMs'],
            requiredJobRole: p.payload['requiredJobRole'] ?? null,
            payRate: p.payload['payRate'] ?? null,
            notes: p.payload['notes'] ?? null,
          });
          break;
        case 'assign_shift':
          await this.schedulerCmd.assignShift(p.payload['shiftId'], p.payload['assigneeUid']);
          break;
        case 'publish_shift':
          await this.schedulerCmd.publishShift(p.payload['shiftId'], true);
          break;
        case 'unassign_shift':
          await this.schedulerCmd.unassignShift(p.payload['shiftId']);
          break;
      }
      p.status = 'confirmed';
      this.toast.success('Done.');
    } catch (e: any) {
      p.status = 'error';
      this.toast.errorFrom(e, 'Action failed.');
    } finally {
      p.busy = false;
      this.messages.update((list) => [...list]);
      this.digestProposals.update((list) => [...list]);
    }
  }

  dismissProposal(p: DisplayProposal) {
    p.status = 'dismissed';
    this.messages.update((list) => [...list]);
    this.digestProposals.update((list) => [...list]);
  }

  iconFor(kind: AiProposal['kind']): string {
    switch (kind) {
      case 'create_shift': return 'add_circle';
      case 'assign_shift': return 'person_add';
      case 'publish_shift': return 'campaign';
      case 'unassign_shift': return 'person_remove';
      default: return 'auto_awesome';
    }
  }

  private scrollToBottom() {
    setTimeout(() => {
      const el = this.scrollAnchor?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
