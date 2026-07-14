import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { doc, getDoc, getFirestore, Timestamp } from 'firebase/firestore';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { TimeEntriesRepo } from '../../core/repos/time-entries.repo';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { TimeEntry } from '../../shared/models/time-entry.model';
import { formatDateTime, tsToDate } from '../../shared/utils/date.util';
import { payrollHours } from '../../shared/utils/payroll.util';

@Component({
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="print-container">
      <div class="print-header">
        <div>
          <div class="print-kicker">InnovaShift</div>
          <h2 class="print-title">Timesheet Print View</h2>
        </div>
        <div class="print-actions no-print">
          <button class="print-btn print-btn-secondary" (click)="closeWindow()">Close</button>
          <button class="print-btn" (click)="print()">Print / Save as PDF</button>
        </div>
      </div>

      <div class="print-meta">
        Organization: <strong>{{ orgName || orgId || '-' }}</strong> | User: <strong>{{ userLabel() }}</strong> | Period: <strong>{{ from }}</strong> to <strong>{{ to }}</strong>
      </div>

      <table *ngIf="rows().length>0" class="print-table">
        <thead>
          <tr>
            <th>Shift</th>
            <th>Check In</th>
            <th>Check Out</th>
            <th>Break</th>
            <th>Hours</th>
            <th>Exception</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let r of rows()">
            <td><strong>{{ r.shiftTitle }}</strong></td>
            <td>{{ r.checkIn }}</td>
            <td>{{ r.checkOut }}</td>
            <td>{{ r.breakLabel }}</td>
            <td>{{ r.hours }}</td>
            <td>{{ r.exceptionStatus }}</td>
          </tr>
        </tbody>
      </table>

      <div *ngIf="rows().length===0" class="print-empty">No entries in this range.</div>
    </div>
  `,
  styles: [`
    .print-container { max-width: 1000px; margin: 0 auto; padding: 40px; font-family: 'Inter', sans-serif; color: #000; background: #fff; min-height: 100vh; }
    .print-kicker { margin-bottom: 6px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .12em; font-weight: 900; }
    .print-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 16px; margin-bottom: 24px; }
    .print-title { margin: 0; font-size: 24px; font-weight: 900; }
    .print-actions { display:flex; gap:8px; }
    .print-meta { font-size: 14px; margin-bottom: 24px; }
    .print-meta strong { font-weight: 700; }
    
    .print-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .print-table th { text-align: left; padding: 12px 8px; border-bottom: 1px solid #000; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 11px; }
    .print-table td { padding: 12px 8px; border-bottom: 1px solid #ddd; }
    .print-table tr:last-child td { border-bottom: 2px solid #000; }
    
    .print-empty { font-size: 14px; color: #555; padding: 20px 0; font-style: italic; }
    
    .print-btn { background: #000; color: #fff; border: none; padding: 10px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; }
    .print-btn-secondary { background:#fff; color:#111827; border:1px solid #cbd5e1; }
    
    @media print {
      .no-print { display: none !important; }
      .print-container { padding: 0; min-height: 0; }
      body { background: #fff !important; }
      * { color: #000 !important; }
    }
  `]
})
export class AdminTimesheetsPrintPage implements OnDestroy {
  orgId: string | null = null;

  uid = '';
  from = '';
  to = '';
  orgName = '';

  userLabel = signal('');
  rows = signal<any[]>([]);
  private autoPrintArmed = false;
  private autoPrintDone = false;

  private unsub: (() => void) | null = null;
  private unsubUsers: (() => void) | null = null;

  constructor(
    private route: ActivatedRoute,
    private ctx: OrgContextService,
    private timeRepo: TimeEntriesRepo,
    private shiftsRepo: ShiftsRepo,
    private usersRepo: UsersRepo,
  ) {
    this.orgId = this.ctx.orgId();
    void this.loadOrgName();
    this.route.queryParamMap.subscribe(p => {
      this.uid = p.get('uid') || '';
      this.from = p.get('from') || '';
      this.to = p.get('to') || '';
      this.autoPrintArmed = p.get('print') === '1';
      this.autoPrintDone = false;
      this.load();
    });
  }

  private load() {
    if (!this.orgId || !this.uid || !this.from || !this.to) return;

    if (this.unsubUsers) this.unsubUsers();
    this.unsubUsers = this.usersRepo.watchOrgUsers(this.orgId, (users: OrgUser[]) => {
      const u = users.find(x => x.uid === this.uid);
      this.userLabel.set((u?.displayName || u?.email || this.uid) + (u?.jobRole ? ` (${u.jobRole})` : ''));
    });

    const startMs = new Date(this.from + 'T00:00:00').getTime();
    const endMs = new Date(this.to + 'T23:59:59').getTime();
    const start = Timestamp.fromMillis(startMs);
    const end = Timestamp.fromMillis(endMs);

    if (this.unsub) this.unsub();
    this.unsub = this.timeRepo.watchEntriesRange(this.orgId, this.uid, start, end, async (items: TimeEntry[]) => {
      const shiftIds = Array.from(new Set(items.map(i => i.shiftId))).filter(Boolean);
      const shiftMap = await this.shiftsRepo.getManyByIds(this.orgId!, shiftIds);

      this.rows.set(items.map(e => {
        const s = shiftMap[e.shiftId];
        const inD = tsToDate(e.checkInAt);
        const outD = tsToDate(e.checkOutAt);
        const hours = (inD && outD) ? payrollHours(e).toFixed(2) : '';
        const breakMs = Number(e.totalBreakMs || 0);
        const breakLabel = e.onBreak
          ? 'On break'
          : breakMs > 0
            ? `${Math.round(breakMs / 60000)} min`
            : '—';
        return {
          shiftTitle: s?.title || e.shiftId,
          checkIn: formatDateTime(e.checkInAt),
          checkOut: formatDateTime(e.checkOutAt),
          breakLabel,
          hours,
          exceptionStatus: e.exceptionStatus,
        };
      }));
      this.tryAutoPrint();
    });
  }

  private async loadOrgName() {
    if (!this.orgId) return;
    const snap = await getDoc(doc(getFirestore(), `orgs/${this.orgId}`)).catch(() => null);
    const data: any = snap?.exists() ? snap.data() : {};
    this.orgName = String(data?.name || this.orgId || '').trim();
  }

  private tryAutoPrint() {
    if (!this.autoPrintArmed || this.autoPrintDone) return;
    document.title = `InnovaShift_Timesheet_${this.userLabel().replace(/[^a-zA-Z0-9._-]+/g, '-')}_${this.from}_to_${this.to}`;
    this.autoPrintDone = true;
    setTimeout(() => window.print(), 350);
  }

  print() { window.print(); }
  closeWindow() { window.close(); }

  ngOnDestroy() {
    if (this.unsub) this.unsub();
    if (this.unsubUsers) this.unsubUsers();
  }
}
