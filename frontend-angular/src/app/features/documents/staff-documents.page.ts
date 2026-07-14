import { Component, NgZone, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { doc, getFirestore, onSnapshot } from 'firebase/firestore';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { profileCompletion } from '../../shared/utils/profile-completion.util';
import { EmployeeDocumentRecord, EmployeeDocumentType, EmployeeDocumentsRepo } from '../../core/repos/employee-documents.repo';
import { ToastService } from '../../core/ui/toast.service';

type DocumentTile = {
  title: string;
  subtitle: string;
  icon: string;
  status: 'ready' | 'attention' | 'locked';
  link?: string;
};

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, MatIconModule],
  template: `
    <div class="doc-page">
      <header class="doc-hero">
        <div>
          <span>Staff Document Center</span>
          <h1>My Documents</h1>
          <p>Payroll, tax, identity, and employment records in one place.</p>
        </div>
        <a class="doc-primary" routerLink="/app/profile">
          <mat-icon>edit</mat-icon>
          Update Profile
        </a>
      </header>

      <div *ngIf="!orgId || !uid" class="doc-alert">
        <mat-icon>warning_amber</mat-icon>
        Missing organization or user context.
      </div>

      <ng-container *ngIf="orgId && uid">
        <section class="doc-status">
          <article class="doc-score">
            <div class="doc-ring" [style.--score]="completion().score + '%'">{{ completion().score }}%</div>
            <div>
              <h2>Profile readiness</h2>
              <p>{{ completionCopy() }}</p>
              <div class="doc-missing" *ngIf="completion().missing.length">
                <span *ngFor="let item of completion().missing.slice(0, 4)">{{ item }}</span>
              </div>
            </div>
          </article>
          <article class="doc-checklist">
            <h2>Required records</h2>
            <div class="doc-check-row" *ngFor="let row of checklist()">
              <mat-icon>{{ row.ok ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
              <span>{{ row.label }}</span>
              <strong>{{ row.ok ? 'Complete' : 'Needs review' }}</strong>
            </div>
          </article>
        </section>

        <section class="doc-apps">
          <a *ngFor="let tile of tiles()"
             class="doc-app"
             [routerLink]="tile.link || null"
             [class.is-attention]="tile.status === 'attention'"
             [class.is-locked]="tile.status === 'locked'">
            <span class="doc-app-icon"><mat-icon>{{ tile.icon }}</mat-icon></span>
            <strong>{{ tile.title }}</strong>
            <small>{{ tile.subtitle }}</small>
            <em>{{ statusLabel(tile.status) }}</em>
          </a>
        </section>

        <section class="doc-record doc-upload-panel">
          <div class="doc-record-head">
            <h2>Document Verification</h2>
            <span>{{ pendingDocuments() }} pending</span>
          </div>
          <div class="doc-upload-body">
            <div class="doc-upload-form">
              <label>
                <span>Document type</span>
                <select class="doc-input" [(ngModel)]="uploadType">
                  <option value="identity">Identity Document</option>
                  <option value="w4">W-4 Withholding</option>
                  <option value="w2">W-2 Document</option>
                  <option value="certification">License or Certification</option>
                  <option value="payroll">Payroll Document</option>
                  <option value="policy">Policy Acknowledgement</option>
                  <option value="other">Other Document</option>
                </select>
              </label>
              <label>
                <span>Title</span>
                <input class="doc-input" [(ngModel)]="uploadTitle" placeholder="e.g. RN license renewal">
              </label>
              <label>
                <span>File</span>
                <input class="doc-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" (change)="selectFile($event)">
              </label>
              <button class="doc-primary doc-upload-btn" type="button" (click)="uploadDocument()" [disabled]="uploadBusy || !selectedFile">
                <mat-icon>{{ uploadBusy ? 'hourglass_empty' : 'upload_file' }}</mat-icon>
                {{ uploadBusy ? 'Uploading...' : 'Submit for Review' }}
              </button>
            </div>

            <div class="doc-history" *ngIf="documents().length; else noDocuments">
              <div class="doc-history-row" *ngFor="let item of documents()">
                <div>
                  <strong>{{ item.title || docLabel(item.type) }}</strong>
                  <span>{{ docLabel(item.type) }} · {{ item.fileName }}</span>
                </div>
                <em [class.is-ok]="item.status === 'verified'" [class.is-bad]="item.status === 'rejected'">{{ statusText(item.status) }}</em>
                <button type="button" class="doc-open" (click)="openDocument(item)" title="Open document">
                  <mat-icon>open_in_new</mat-icon>
                </button>
              </div>
            </div>
            <ng-template #noDocuments>
              <div class="doc-empty-state">No documents submitted yet.</div>
            </ng-template>
          </div>
        </section>

        <section class="doc-record">
          <div class="doc-record-head">
            <h2>Employment Record</h2>
            <span>{{ employeeNumber() }}</span>
          </div>
          <div class="doc-record-grid">
            <div><span>Name</span><strong>{{ user()?.displayName || 'Not set' }}</strong></div>
            <div><span>Email</span><strong>{{ user()?.email || 'Not set' }}</strong></div>
            <div><span>Role</span><strong>{{ user()?.jobRole || user()?.title || 'Not set' }}</strong></div>
            <div><span>Department</span><strong>{{ profileValue('department') || 'Not set' }}</strong></div>
            <div><span>Location</span><strong>{{ profileValue('locationName') || 'Not set' }}</strong></div>
            <div><span>W-2 Delivery</span><strong>{{ user()?.w2?.delivery || 'Not set' }}</strong></div>
          </div>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .doc-page { color:#1f2937; }
    .doc-hero { min-height:150px; margin:-24px -22px 22px; padding:28px; display:flex; align-items:end; justify-content:space-between; gap:18px; background:#07533f; color:#fff; }
    .doc-hero span { color:rgba(255,255,255,.74); font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.08em; }
    .doc-hero h1 { margin:6px 0 6px; font-size:34px; line-height:1.05; }
    .doc-hero p { margin:0; color:rgba(255,255,255,.82); }
    .doc-primary { height:42px; padding:0 16px; display:inline-flex; align-items:center; gap:8px; border-radius:8px; background:#fff; color:#07533f; text-decoration:none; font-weight:900; }
    .doc-upload-btn { border:0; background:#07533f; color:#fff; justify-content:center; cursor:pointer; }
    .doc-upload-btn:disabled { opacity:.55; cursor:not-allowed; }
    .doc-alert { display:flex; align-items:center; gap:10px; padding:14px 16px; border:1px solid #fed7aa; border-radius:8px; background:#fff7ed; color:#92400e; font-weight:800; }
    .doc-status { display:grid; grid-template-columns:1.2fr .8fr; gap:16px; margin-bottom:16px; }
    .doc-score, .doc-checklist, .doc-app, .doc-record { border:1px solid rgba(15,23,42,.12); border-radius:8px; background:rgba(255,255,255,.94); box-shadow:0 12px 28px rgba(15,23,42,.07); }
    .doc-score { display:flex; align-items:center; gap:18px; padding:18px; }
    .doc-score h2, .doc-checklist h2, .doc-record h2 { margin:0; font-size:17px; }
    .doc-score p { margin:6px 0 0; color:#475569; }
    .doc-ring { --score:0%; width:96px; height:96px; border-radius:50%; display:grid; place-items:center; flex:0 0 96px; background:conic-gradient(#047857 var(--score), #e2e8f0 0); color:#0f172a; font-size:22px; font-weight:900; position:relative; }
    .doc-ring::before { content:''; position:absolute; inset:9px; border-radius:50%; background:#fff; }
    .doc-ring { isolation:isolate; }
    .doc-ring::after { content:attr(style); display:none; }
    .doc-ring { color:transparent; }
    .doc-ring::marker { color:transparent; }
    .doc-ring { text-shadow:0 0 0 #0f172a; }
    .doc-missing { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
    .doc-missing span { padding:5px 8px; border-radius:999px; background:#fff7ed; color:#92400e; font-size:11px; font-weight:800; }
    .doc-checklist { padding:16px; }
    .doc-check-row { display:grid; grid-template-columns:22px 1fr auto; gap:8px; align-items:center; padding:10px 0; border-top:1px solid #e5e7eb; }
    .doc-check-row:first-of-type { margin-top:10px; }
    .doc-check-row mat-icon { color:#047857; font-size:19px; width:19px; height:19px; }
    .doc-check-row span { color:#334155; }
    .doc-check-row strong { color:#64748b; font-size:12px; }
    .doc-apps { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:14px; margin-bottom:16px; }
    .doc-app { min-height:142px; padding:16px; text-decoration:none; color:#1f2937; display:grid; align-content:start; gap:8px; position:relative; overflow:hidden; }
    .doc-app:hover { border-color:#047857; }
    .doc-app-icon { width:42px; height:42px; border-radius:10px; display:grid; place-items:center; background:#ecfdf5; color:#047857; }
    .doc-app strong { font-size:15px; }
    .doc-app small { color:#64748b; line-height:1.35; }
    .doc-app em { justify-self:start; margin-top:4px; padding:4px 8px; border-radius:999px; background:#eef2ff; color:#3730a3; font-size:11px; font-style:normal; font-weight:900; }
    .doc-app.is-attention em { background:#fff7ed; color:#92400e; }
    .doc-app.is-locked { opacity:.72; cursor:not-allowed; }
    .doc-record { padding:0; overflow:hidden; margin-bottom:16px; }
    .doc-record-head { min-height:52px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 16px; border-bottom:1px solid #e5e7eb; }
    .doc-record-head span { color:#64748b; font-weight:800; }
    .doc-record-grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:0; }
    .doc-record-grid div { padding:14px 16px; border-right:1px solid #e5e7eb; border-bottom:1px solid #e5e7eb; }
    .doc-record-grid span { display:block; color:#64748b; font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.06em; }
    .doc-record-grid strong { display:block; margin-top:5px; color:#0f172a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .doc-upload-body { padding:16px; }
    .doc-upload-form { display:grid; grid-template-columns:1fr 1.2fr 1.2fr auto; gap:12px; align-items:end; margin-bottom:14px; }
    .doc-upload-form label span { display:block; margin-bottom:6px; color:#64748b; font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.06em; }
    .doc-input { width:100%; min-height:42px; border:1px solid #cbd5e1; border-radius:8px; padding:0 11px; background:#fff; color:#0f172a; font-weight:700; }
    .doc-history { display:grid; gap:8px; }
    .doc-history-row { min-height:58px; display:grid; grid-template-columns:1fr auto 40px; align-items:center; gap:10px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:8px; background:#f8fafc; }
    .doc-history-row strong, .doc-history-row span { display:block; }
    .doc-history-row span { margin-top:3px; color:#64748b; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .doc-history-row em { padding:5px 9px; border-radius:999px; background:#fff7ed; color:#92400e; font-size:11px; font-style:normal; font-weight:900; text-transform:uppercase; }
    .doc-history-row em.is-ok { background:#ecfdf5; color:#047857; }
    .doc-history-row em.is-bad { background:#fef2f2; color:#b91c1c; }
    .doc-open { width:38px; height:38px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; color:#07533f; display:grid; place-items:center; cursor:pointer; }
    .doc-empty-state { padding:18px; border:1px dashed #cbd5e1; border-radius:8px; color:#64748b; font-weight:800; text-align:center; }
    @media (max-width:980px) { .doc-hero { margin:-14px -12px 18px; padding:22px 16px; align-items:flex-start; flex-direction:column; } .doc-status, .doc-apps, .doc-record-grid, .doc-upload-form { grid-template-columns:1fr; } }
  `]
})
export class StaffDocumentsPage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;
  user = signal<any>(null);
  documents = signal<EmployeeDocumentRecord[]>([]);
  uploadType: EmployeeDocumentType = 'identity';
  uploadTitle = '';
  selectedFile: File | null = null;
  uploadBusy = false;
  private unsub: (() => void) | null = null;
  private unsubDocs: (() => void) | null = null;

  constructor(
    private zone: NgZone,
    private ctx: OrgContextService,
    private docsRepo: EmployeeDocumentsRepo,
    private toast: ToastService,
  ) {
    this.orgId = this.ctx.orgId();
    this.uid = this.ctx.uid();
    this.bind();
    setTimeout(() => this.bind(), 700);
  }

  ngOnDestroy() {
    this.unsub?.();
    this.unsubDocs?.();
  }

  private bind() {
    this.orgId = this.ctx.orgId();
    this.uid = this.ctx.uid();
    if (!this.orgId || !this.uid || this.unsub) return;
    this.unsub = onSnapshot(doc(getFirestore(), `orgs/${this.orgId}/users/${this.uid}`), (snap) => {
      this.zone.run(() => {
        this.user.set(snap.exists() ? { uid: snap.id, ...snap.data() } : null);
      });
    }, () => {
      this.zone.run(() => { this.user.set(null); });
    });
    this.unsubDocs = this.docsRepo.watchForUser(this.orgId, this.uid, (items) => {
      this.documents.set(items);
    });
  }

  completion() {
    return profileCompletion(this.user() || {});
  }

  completionCopy(): string {
    const c = this.completion();
    if (c.status === 'complete') return 'Your profile is complete for payroll and workforce workflows.';
    if (c.status === 'needs_attention') return 'Your profile is mostly complete. Review the missing records below.';
    return 'Finish your profile before payroll, W-2, and HR records are fully ready.';
  }

  checklist() {
    const u = this.user() || {};
    return [
      { label: 'Personal contact information', ok: !!u.displayName && !!u.email && !!(u.phone || u.profile?.phone) },
      { label: 'Mailing address', ok: !!(u.address?.line1 || u.profile?.address?.line1) },
      { label: 'W-4 withholding certification', ok: u.taxWithholding?.certified === true },
      { label: 'W-2 delivery preference', ok: !!u.w2?.delivery && !!u.w2?.email },
      { label: 'Emergency contact', ok: !!(u.emergencyContact?.name || u.profile?.emergencyContact?.name) },
    ];
  }

  tiles(): DocumentTile[] {
    const u = this.user() || {};
    const c = this.completion();
    return [
      { title: 'Personal Information', subtitle: 'Name, address, contact, emergency record', icon: 'badge', status: c.score >= 75 ? 'ready' : 'attention', link: '/app/profile' },
      { title: 'W-4 Withholding', subtitle: 'Federal or local withholding preferences', icon: 'fact_check', status: u.taxWithholding?.certified ? 'ready' : 'attention', link: '/app/profile' },
      { title: 'Employee W-2', subtitle: 'Tax document delivery preference', icon: 'description', status: u.w2?.delivery ? 'ready' : 'attention', link: '/app/profile' },
      { title: 'Online Payslip', subtitle: 'Pay statements and printable PDF view', icon: 'payments', status: 'ready', link: '/app/payroll' },
      { title: 'Dependents', subtitle: 'Benefits and tax dependent records', icon: 'family_restroom', status: Array.isArray(u.dependents) && u.dependents.length ? 'ready' : 'attention', link: '/app/profile' },
      { title: 'Time-Off Records', subtitle: 'PTO, sick balance, and request history', icon: 'event_available', status: 'ready', link: '/app/accruals' },
      { title: 'Timecard Inquiry', subtitle: 'Punches, exceptions, and corrections', icon: 'receipt_long', status: 'ready', link: '/app/attendance' },
      { title: 'Company Policies', subtitle: 'Organization documents and acknowledgements', icon: 'policy', status: 'locked' },
    ];
  }

  selectFile(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] || null;
    if (!this.uploadTitle && this.selectedFile) {
      this.uploadTitle = this.docLabel(this.uploadType);
    }
  }

  async uploadDocument() {
    if (!this.orgId || !this.uid || !this.selectedFile) return;
    this.uploadBusy = true;
    try {
      await this.docsRepo.uploadEmployeeDocument({
        orgId: this.orgId,
        userId: this.uid,
        userDisplayName: this.user()?.displayName || null,
        userEmail: this.user()?.email || null,
        type: this.uploadType,
        title: this.uploadTitle || this.docLabel(this.uploadType),
        file: this.selectedFile,
      });
      this.toast.success('Document submitted for review.');
      this.selectedFile = null;
      this.uploadTitle = '';
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to upload document.');
    } finally {
      this.uploadBusy = false;
    }
  }

  async openDocument(item: EmployeeDocumentRecord) {
    try {
      window.open(await this.docsRepo.getDocumentUrl(item), '_blank', 'noopener');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to open document.');
    }
  }

  pendingDocuments() {
    return this.documents().filter((item) => item.status === 'pending').length;
  }

  docLabel(type: EmployeeDocumentType) {
    return this.docsRepo.labelFor(type);
  }

  statusText(status: string) {
    if (status === 'verified') return 'Verified';
    if (status === 'rejected') return 'Needs update';
    return 'Pending review';
  }

  statusLabel(status: DocumentTile['status']) {
    if (status === 'ready') return 'Ready';
    if (status === 'attention') return 'Needs review';
    return 'Admin managed';
  }

  employeeNumber() {
    return this.user()?.employeeNumber || this.user()?.profile?.employeeNumber || 'Employee ID pending';
  }

  profileValue(key: string) {
    return this.user()?.profile?.[key] || this.user()?.[key] || '';
  }
}
