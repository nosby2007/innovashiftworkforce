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
import { MetricsRepo, OrgMetricsSummary } from '../../core/repos/metrics.repo';
import { StaffingSnapshotsRepo, StaffingSnapshot } from '../../core/repos/staffing-snapshots.repo';
import { TipCardComponent } from '../../shared/ui/tip-card/tip-card.component';
import { StatCardComponent, StatCardVariant } from '../../shared/ui/stat-card/stat-card.component';
import { TrendSparklineComponent } from '../../shared/ui/trend-sparkline/trend-sparkline.component';
import { RadialGaugeComponent, RadialGaugeVariant } from '../../shared/ui/radial-gauge/radial-gauge.component';
import { computeRiskScore } from '../../shared/utils/ai-risk.util';

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

const TREND_DAYS = 30;

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, DatePipe, TipCardComponent, StatCardComponent, TrendSparklineComponent, RadialGaugeComponent],
  template: `
    <div class="vs-page-pad acc-page">
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">AI Command Center</h1>
          <p class="vs-page-subtitle">Live staffing analysis, recommendations, and trends — every action still needs your confirmation.</p>
        </div>
      </div>

      <app-tip-card tipId="ai-copilot-intro" title="How the Copilot works" icon="auto_awesome">
        Ask it anything about your schedule — it can also draft actions like creating or publishing a shift, but it never touches anything without you clicking Confirm first.
      </app-tip-card>

      <div class="acc-shell">
        <div class="acc-main">

          <!-- KPI / gauge strip -->
          <div class="acc-kpis">
            <div class="acc-kpi-card vs-glass" animate.enter="vs-fade-in">
              <app-radial-gauge [value]="coveragePct()" [variant]="coverageVariant()" label="Coverage"></app-radial-gauge>
            </div>
            <div class="acc-kpi-card vs-glass" animate.enter="vs-fade-in">
              <app-radial-gauge [value]="riskScore().score" [max]="6" [variant]="riskVariant()" [displayValue]="riskLabel()" label="Risk Level"></app-radial-gauge>
            </div>
            <app-stat-card variant="warning" icon="event_busy" label="Open Next 7 Days" [value]="metrics()?.upcoming7dOpenCount ?? 0"></app-stat-card>
            <app-stat-card [variant]="trendVariant()" [icon]="trendIcon()" label="Trend" [value]="trendLabel()"></app-stat-card>
          </div>

          <!-- Trend graphs -->
          <div class="acc-trends">
            <div class="acc-trend-card vs-glass" animate.enter="vs-fade-in">
              <div class="acc-trend-head"><span>Coverage Gaps</span><small>last {{ trendDays }} days</small></div>
              <app-trend-sparkline [data]="coverageGapsTrend()" color="var(--warning)"></app-trend-sparkline>
            </div>
            <div class="acc-trend-card vs-glass" animate.enter="vs-fade-in">
              <div class="acc-trend-head"><span>Risk Alerts</span><small>last {{ trendDays }} days</small></div>
              <app-trend-sparkline [data]="riskTrend()" color="var(--danger)"></app-trend-sparkline>
            </div>
            <div class="acc-trend-card vs-glass" animate.enter="vs-fade-in">
              <div class="acc-trend-head"><span>Staffing Scheduled</span><small>hours / day</small></div>
              <app-trend-sparkline *ngIf="staffingHistory().length >= 3; else staffingCollecting" [data]="staffingHoursTrend()" color="var(--success)"></app-trend-sparkline>
              <ng-template #staffingCollecting>
                <div class="acc-collecting">Collecting data — a new data point is added each day.</div>
              </ng-template>
            </div>
          </div>

          <!-- Recommended actions -->
          <div class="vs-glass-strong acc-section" *ngIf="digestProposals().length" animate.enter="vs-fade-in">
            <div class="acc-section-head"><mat-icon>auto_awesome</mat-icon><span>Recommended Actions</span></div>
            <div class="ac-proposals">
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

          <!-- Coverage gaps -->
          <div class="vs-glass-strong acc-section" *ngIf="digest()?.gaps?.length" animate.enter="vs-fade-in">
            <div class="acc-section-head"><mat-icon>event_busy</mat-icon><span>Coverage Gaps</span></div>
            <div class="acc-gap-row" *ngFor="let g of digest()!.gaps">
              <div class="acc-gap-main">
                <strong>{{ g.title }}</strong>
                <span>{{ g.locationName || 'Unspecified location' }} · {{ g.requiredJobRole || 'Any role' }}</span>
              </div>
              <span class="acc-gap-time">{{ g.startAtMs | date:'EEE MMM d, h:mm a' }}</span>
              <span class="vs-badge vs-badge--warning" *ngIf="g.needsPublish">Needs publish</span>
            </div>
          </div>

          <!-- Today's briefing -->
          <div class="vs-glass-strong acc-section" *ngIf="digest() as d" animate.enter="vs-fade-in">
            <div class="acc-section-head">
              <mat-icon class="ac-digest-icon">wb_sunny</mat-icon>
              <span>Today's Briefing</span>
              <small class="acc-section-date">{{ d.generatedAt?.toDate ? (d.generatedAt.toDate() | date:'EEE MMM d, h:mm a') : d.dateKey }}</small>
            </div>
            <div class="ac-digest-summary">{{ d.summary }}</div>

            <div class="ac-alerts" *ngIf="d.alerts?.length">
              <div class="ac-alert" *ngFor="let a of d.alerts" [class.ac-alert--critical]="a.severity === 'critical'">
                <mat-icon class="ac-alert-icon">{{ a.severity === 'critical' ? 'error' : 'warning' }}</mat-icon>
                <span>{{ a.detail }}</span>
              </div>
            </div>

            <div class="ac-forecast" *ngIf="d.forecast as f" [class.ac-forecast--worsening]="f.direction === 'worsening'" [class.ac-forecast--improving]="f.direction === 'improving'">
              <mat-icon class="ac-forecast-icon">{{ f.direction === 'worsening' ? 'trending_up' : f.direction === 'improving' ? 'trending_down' : 'trending_flat' }}</mat-icon>
              <div>
                <div class="ac-forecast-title">
                  Long-term outlook: {{ f.direction === 'worsening' ? 'Trending worse' : f.direction === 'improving' ? 'Trending better' : 'Stable' }}
                </div>
                <div class="ac-forecast-detail" *ngIf="f.commentary">{{ f.commentary }}</div>
                <div class="ac-forecast-detail" *ngIf="!f.commentary">
                  {{ f.recentProblemDays }} problem day(s) in the last 4 weeks (avg {{ f.recentAvgGaps | number:'1.0-1' }} unfilled shifts) vs {{ f.priorProblemDays }} in the prior 4 weeks (avg {{ f.priorAvgGaps | number:'1.0-1' }}).
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- Docked chat -->
        <div class="vs-glass-strong ac-panel acc-chat">
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
    </div>
  `,
  styles: [`
    .acc-page { width: 100%; max-width: 1400px; margin: 0 auto; }

    .acc-shell { display: grid; grid-template-columns: 1fr 380px; gap: 20px; align-items: start; }
    @media (max-width: 1100px) { .acc-shell { grid-template-columns: 1fr; } }

    .acc-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

    .acc-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
    @media (max-width: 900px) { .acc-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .acc-kpi-card { display: flex; align-items: center; justify-content: center; padding: 16px; min-height: 148px; }

    .acc-trends { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    @media (max-width: 900px) { .acc-trends { grid-template-columns: 1fr; } }
    .acc-trend-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
    .acc-trend-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .acc-trend-head span { font-weight: 800; font-size: 13px; color: var(--text); }
    .acc-trend-head small { font-size: 11px; color: var(--text-muted); }
    .acc-collecting { height: 64px; display: flex; align-items: center; justify-content: center; text-align: center; color: var(--text-muted); font-size: 12px; padding: 0 8px; }

    .acc-section { padding: 18px 20px; }
    .acc-section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-weight: 800; font-size: 14px; color: var(--text); }
    .acc-section-date { margin-left: auto; font-weight: 500; font-size: 11.5px; color: var(--text-muted); }

    .acc-gap-row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      padding: 10px 0; border-top: 1px solid var(--border);
    }
    .acc-gap-row:first-of-type { border-top: none; padding-top: 0; }
    .acc-gap-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .acc-gap-main strong { font-size: 13.5px; color: var(--text); }
    .acc-gap-main span { font-size: 12px; color: var(--text-muted); }
    .acc-gap-time { font-size: 12px; color: var(--text-muted); white-space: nowrap; }

    .acc-chat { display: flex; flex-direction: column; height: min(85vh, 900px); overflow: hidden; position: sticky; top: 20px; }
    @media (max-width: 1100px) { .acc-chat { position: static; height: 560px; } }

    .ac-digest-icon { color: #f59e0b; font-size: 22px !important; width: 22px !important; height: 22px !important; }
    .ac-digest-summary { font-size: 13.5px; line-height: 1.5; color: var(--text); margin-bottom: 4px; }

    .ac-alerts { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
    .ac-alert {
      display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; line-height: 1.4;
      padding: 8px 10px; border-radius: 8px; background: rgba(245,158,11,0.10); color: var(--text);
      border: 1px solid rgba(245,158,11,0.30);
    }
    .ac-alert--critical { background: rgba(239,68,68,0.10); border-color: rgba(239,68,68,0.30); }
    .ac-alert-icon { font-size: 16px !important; width: 16px !important; height: 16px !important; color: #f59e0b; flex-shrink: 0; margin-top: 1px; }
    .ac-alert--critical .ac-alert-icon { color: var(--danger); }

    .ac-forecast {
      display: flex; align-items: flex-start; gap: 10px; margin-top: 12px;
      padding: 10px 12px; border-radius: 8px; background: rgba(148,163,184,0.10);
      border: 1px solid rgba(148,163,184,0.25);
    }
    .ac-forecast--worsening { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.25); }
    .ac-forecast--improving { background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.25); }
    .ac-forecast-icon { font-size: 18px !important; width: 18px !important; height: 18px !important; color: var(--text-muted); flex-shrink: 0; margin-top: 1px; }
    .ac-forecast--worsening .ac-forecast-icon { color: var(--danger); }
    .ac-forecast--improving .ac-forecast-icon { color: #10b981; }
    .ac-forecast-title { font-weight: 800; font-size: 12.5px; margin-bottom: 2px; }
    .ac-forecast-detail { font-size: 12px; line-height: 1.4; color: var(--text-muted); }

    .ac-panel { display: flex; flex-direction: column; overflow: hidden; }
    .ac-messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }

    .ac-empty { margin: auto; text-align: center; color: var(--text-muted); padding: 20px; }
    .ac-empty-icon { font-size: 40px !important; width: 40px !important; height: 40px !important; opacity: .5; margin-bottom: 10px; }
    .ac-empty-title { font-weight: 700; margin-bottom: 16px; }
    .ac-suggestions { display: flex; flex-direction: column; gap: 8px; align-items: center; }
    .ac-suggestion { font-size: 13px; }

    .ac-msg { display: flex; }
    .ac-msg--user { justify-content: flex-end; }
    .ac-bubble {
      max-width: 88%; padding: 12px 16px; border-radius: 14px;
      background: var(--bg-elevated); border: 1px solid var(--border);
      white-space: pre-wrap; line-height: 1.5; font-size: 14px;
    }
    .ac-msg--user .ac-bubble { background: var(--primary); color: #fff; border-color: var(--primary); }

    .ac-bubble--typing { display: flex; gap: 4px; align-items: center; padding: 16px; }
    .ac-bubble--typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); animation: ac-bounce 1.2s infinite ease-in-out; }
    .ac-bubble--typing span:nth-child(2) { animation-delay: .15s; }
    .ac-bubble--typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes ac-bounce { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }

    .ac-proposals { display: flex; flex-direction: column; gap: 8px; }
    .acc-section .ac-proposals { margin-top: 0; }
    .ac-bubble .ac-proposals { margin-top: 10px; }
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
  trendDays = TREND_DAYS;
  draft = '';
  messages = signal<DisplayMessage[]>([]);
  sending = signal(false);

  digest = signal<AiDigest | null>(null);
  digestProposals = signal<DisplayProposal[]>([]);
  digestHistory = signal<AiDigest[]>([]);
  metrics = signal<OrgMetricsSummary | null>(null);
  staffingHistory = signal<StaffingSnapshot[]>([]);

  private history: AiChatTurn[] = [];
  private unsubDigest: (() => void) | null = null;
  private unsubHistory: (() => void) | null = null;
  private unsubMetrics: (() => void) | null = null;
  private unsubStaffing: (() => void) | null = null;

  constructor(
    private ai: AiAssistantCommands,
    private schedulerCmd: SchedulerCommands,
    private shiftAdminCmd: ShiftAdminCommands,
    private toast: ToastService,
    private ctx: OrgContextService,
    private digestRepo: AiDigestRepo,
    private metricsRepo: MetricsRepo,
    private staffingRepo: StaffingSnapshotsRepo,
  ) {
    const bind = () => {
      const orgId = this.ctx.orgId();
      if (!orgId || this.unsubDigest) return;
      this.unsubDigest = this.digestRepo.watchLatest(orgId, (d) => {
        this.digest.set(d);
        this.digestProposals.set((d?.proposals || []).map((p) => ({ ...p, status: 'pending', busy: false })));
      });
      this.unsubHistory = this.digestRepo.watchHistory(orgId, TREND_DAYS, (list) => this.digestHistory.set(list));
      this.unsubMetrics = this.metricsRepo.watchSummary(orgId, (m) => this.metrics.set(m));
      this.unsubStaffing = this.staffingRepo.watchHistory(orgId, TREND_DAYS, (list) => this.staffingHistory.set(list));
    };
    bind();
    setTimeout(bind, 800);
    setTimeout(bind, 2200);
  }

  ngOnDestroy() {
    this.unsubDigest?.();
    this.unsubHistory?.();
    this.unsubMetrics?.();
    this.unsubStaffing?.();
  }

  coveragePct(): number {
    const m = this.metrics();
    if (!m) return 0;
    const total = (m.openCount || 0) + (m.assignedCount || 0);
    if (total === 0) return 100; // nothing scheduled at all — nothing uncovered either
    return Math.round(((m.assignedCount || 0) / total) * 100);
  }

  coverageVariant(): RadialGaugeVariant {
    const pct = this.coveragePct();
    return pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'danger';
  }

  riskScore() {
    return computeRiskScore(this.digest()?.alerts ?? []);
  }

  riskVariant(): RadialGaugeVariant {
    const level = this.riskScore().level;
    return level === 'low' ? 'success' : level === 'medium' ? 'warning' : 'danger';
  }

  riskLabel(): string {
    const level = this.riskScore().level;
    return level === 'low' ? 'Low' : level === 'medium' ? 'Medium' : 'High';
  }

  private trendDirection() {
    return this.digest()?.forecast?.direction;
  }

  trendIcon(): string {
    const d = this.trendDirection();
    return d === 'worsening' ? 'trending_up' : d === 'improving' ? 'trending_down' : 'trending_flat';
  }

  trendVariant(): StatCardVariant {
    const d = this.trendDirection();
    return d === 'worsening' ? 'danger' : d === 'improving' ? 'success' : 'primary';
  }

  trendLabel(): string {
    const d = this.trendDirection();
    return d === 'worsening' ? 'Worsening' : d === 'improving' ? 'Improving' : d === 'stable' ? 'Stable' : 'No data yet';
  }

  private last30Dates(): string[] {
    const dates: string[] = [];
    const now = new Date();
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }

  coverageGapsTrend(): number[] {
    const byDate = new Map(this.digestHistory().map((d) => [d.dateKey, d.gaps?.length ?? 0]));
    return this.last30Dates().map((date) => byDate.get(date) ?? 0);
  }

  riskTrend(): number[] {
    const byDate = new Map(this.digestHistory().map((d) => [d.dateKey, computeRiskScore(d.alerts ?? []).score]));
    return this.last30Dates().map((date) => byDate.get(date) ?? 0);
  }

  staffingHoursTrend(): number[] {
    const byDate = new Map(this.staffingHistory().map((s) => [s.dateKey, s.scheduledHours]));
    return this.last30Dates().map((date) => byDate.get(date) ?? 0);
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
