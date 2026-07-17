import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { SuperAdminService, CreateUsersRowResult } from './super-admin.service';
import { OrgDirectoryRepo, OrgDirectoryItem } from '../../core/repos/org-directory.repo';
import { ToastService } from '../../core/ui/toast.service';
import { ACCESS_ROLES, JOB_ROLES } from '../../shared/models/access-roles.model';
import { parseCsv } from '../../shared/utils/csv.util';
import { parseXlsx } from '../../shared/utils/xlsx.util';

interface EmployeeRow {
  displayName: string;
  email: string;
  orgId: string;
  accessRole: typeof ACCESS_ROLES[number];
  jobRole: string;
  payRate: number | null;
  payType: string;
  phone: string;
  employeeNumber: string;
  department: string;
  hireDate: string;
  photoURL: string;
  photoBusy?: boolean;
}

// Flexible header aliasing so CSV/Excel/JSON exports from other systems
// ("Full Name", "Org Code", "Rate", "Employee ID", ...) map onto our fields
// without requiring an exact column-name match.
const HEADER_ALIASES: Record<string, keyof EmployeeRow> = {
  email: 'email', emailaddress: 'email', workemail: 'email',
  name: 'displayName', displayname: 'displayName', fullname: 'displayName', employeename: 'displayName',
  org: 'orgId', orgid: 'orgId', organization: 'orgId', organizationcode: 'orgId', orgcode: 'orgId',
  role: 'accessRole', accessrole: 'accessRole', systemrole: 'accessRole',
  position: 'jobRole', jobrole: 'jobRole', job: 'jobRole', title: 'jobRole',
  payrate: 'payRate', rate: 'payRate', hourlyrate: 'payRate', wage: 'payRate',
  paytype: 'payType',
  phone: 'phone', phonenumber: 'phone', mobile: 'phone',
  employeenumber: 'employeeNumber', employeeid: 'employeeNumber', empno: 'employeeNumber', staffid: 'employeeNumber',
  department: 'department', dept: 'department',
  hiredate: 'hireDate', startdate: 'hireDate',
  photo: 'photoURL', photourl: 'photoURL', picture: 'photoURL', pictureurl: 'photoURL', avatar: 'photoURL',
};

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function emptyRow(): EmployeeRow {
  return {
    displayName: '', email: '', orgId: '', accessRole: 'staff', jobRole: '',
    payRate: null, payType: '', phone: '', employeeNumber: '', department: '', hireDate: '', photoURL: '',
  };
}

@Component({
  standalone: true,
  selector: 'app-super-admin-add-employees',
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <section class="vs-glass-strong sae-panel">
      <div class="vs-panel-head">
        <div>
          <div class="vs-panel-title">Add Employees</div>
          <div class="vs-panel-subtitle">Create one or more full employee records — org, role, job, pay rate, and photo. Fill rows by hand, or import a CSV/Excel/JSON file.</div>
        </div>
        <div class="sae-head-actions">
          <input #fileInput type="file" accept=".csv,.json,.xlsx,.xls" style="display:none" (change)="onFileSelected($event)">
          <button class="vs-btn-ghost" type="button" (click)="fileInput.click()" [disabled]="importing()">
            <mat-icon>upload_file</mat-icon> {{ importing() ? 'Importing…' : 'Import from File' }}
          </button>
          <button class="vs-btn-ghost" type="button" (click)="addRow()">
            <mat-icon>add</mat-icon> Add Row
          </button>
        </div>
      </div>

      <div *ngIf="importError()" class="sae-msg sae-msg--err"><mat-icon>error_outline</mat-icon> {{ importError() }}</div>
      <div *ngIf="importInfo()" class="sae-msg sae-msg--ok"><mat-icon>check_circle</mat-icon> {{ importInfo() }}</div>

      <div class="sae-table-shell">
        <table class="sae-table">
          <thead>
            <tr>
              <th>Photo</th>
              <th>Name *</th>
              <th>Email *</th>
              <th>Organization *</th>
              <th>Access Role *</th>
              <th>Position / Job Role</th>
              <th>Pay Rate</th>
              <th>Pay Type</th>
              <th>Phone</th>
              <th>Employee #</th>
              <th>Department</th>
              <th>Hire Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of rows(); let i = index">
              <td>
                <div class="sae-photo-cell">
                  <img *ngIf="row.photoURL" [src]="row.photoURL" class="sae-photo-thumb" alt="">
                  <mat-icon *ngIf="!row.photoURL" class="sae-photo-placeholder">person</mat-icon>
                  <input type="file" accept="image/*" class="sae-photo-input" (change)="onPhotoSelected($event, i)" [disabled]="!!row.photoBusy" title="Upload photo">
                </div>
              </td>
              <td><input class="vs-input sae-cell-input" [(ngModel)]="row.displayName" placeholder="Jane Doe"></td>
              <td><input class="vs-input sae-cell-input" type="email" [(ngModel)]="row.email" placeholder="jane@example.com"></td>
              <td>
                <input class="vs-input sae-cell-input" [(ngModel)]="row.orgId" placeholder="ACME_001" list="sae-org-list">
              </td>
              <td>
                <select class="vs-select sae-cell-input" [(ngModel)]="row.accessRole">
                  <option *ngFor="let r of accessRoles" [value]="r">{{ r }}</option>
                </select>
              </td>
              <td>
                <select class="vs-select sae-cell-input" [(ngModel)]="row.jobRole">
                  <option value="">—</option>
                  <option *ngFor="let j of jobRoles" [value]="j">{{ j }}</option>
                </select>
              </td>
              <td><input class="vs-input sae-cell-input sae-cell-input--num" type="number" min="0" step="0.01" [(ngModel)]="row.payRate" placeholder="0.00"></td>
              <td>
                <select class="vs-select sae-cell-input" [(ngModel)]="row.payType">
                  <option value="">—</option>
                  <option value="hourly">Hourly</option>
                  <option value="salary">Salary</option>
                  <option value="contract">Contract</option>
                </select>
              </td>
              <td><input class="vs-input sae-cell-input" [(ngModel)]="row.phone" placeholder="(555) 555-1234"></td>
              <td><input class="vs-input sae-cell-input" [(ngModel)]="row.employeeNumber" placeholder="E-1024"></td>
              <td><input class="vs-input sae-cell-input" [(ngModel)]="row.department" placeholder="Nursing"></td>
              <td><input class="vs-input sae-cell-input" type="date" [(ngModel)]="row.hireDate"></td>
              <td>
                <button class="sae-remove-btn" type="button" (click)="removeRow(i)" [disabled]="rows().length === 1" title="Remove row">
                  <mat-icon>close</mat-icon>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <datalist id="sae-org-list">
        <option *ngFor="let o of orgs()" [value]="o.orgId">{{ o.name }}</option>
      </datalist>

      <div class="sae-form-actions">
        <div class="sae-count">{{ rows().length }} row(s) ready</div>
        <button class="vs-btn-primary sae-btn" type="button" (click)="submitAll()" [disabled]="creating() || rows().length === 0">
          <mat-icon>{{ creating() ? 'hourglass_empty' : 'group_add' }}</mat-icon>
          {{ creating() ? 'Creating…' : (rows().length > 1 ? 'Create ' + rows().length + ' Employees' : 'Create Employee') }}
        </button>
      </div>

      <div class="sae-results" *ngIf="results().length > 0">
        <div class="vs-panel-title sae-results-title">Results</div>
        <div class="sae-result-row" *ngFor="let r of results()" [class.sae-result-row--err]="!r.ok">
          <mat-icon>{{ r.ok ? 'check_circle' : 'error' }}</mat-icon>
          <div>
            <strong>{{ r.email }}</strong>
            <span *ngIf="r.ok">
              {{ r.isNewUser ? 'Created.' : 'Assigned to organization.' }}
              <ng-container *ngIf="r.passwordResetLink"> — <a [href]="r.passwordResetLink" target="_blank" rel="noopener">account setup link</a></ng-container>
            </span>
            <span *ngIf="!r.ok" class="sae-error-text">{{ r.error }}</span>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .sae-panel { margin-bottom: 20px; padding: 18px 20px; }
    .sae-head-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .sae-msg { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 8px; font-size: 12.5px; margin: 10px 0; }
    .sae-msg--err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .sae-msg--ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .sae-table-shell { overflow-x: auto; margin-top: 14px; border: 1px solid #e2e8f0; border-radius: 10px; }
    .sae-table { border-collapse: collapse; width: 100%; min-width: 1180px; }
    .sae-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #64748b; padding: 10px 8px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
    .sae-table td { padding: 6px; border-bottom: 1px solid #eef2f6; vertical-align: middle; }
    .sae-cell-input { min-width: 110px; }
    .sae-cell-input--num { min-width: 80px; }
    .sae-photo-cell { position: relative; width: 40px; height: 40px; }
    .sae-photo-thumb { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; display: block; }
    .sae-photo-placeholder { width: 40px; height: 40px; border-radius: 50%; background: #eef3ef; color: #64748b; display: flex; align-items: center; justify-content: center; }
    .sae-photo-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 40px; height: 40px; }
    .sae-remove-btn { border: 0; background: transparent; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 6px; border-radius: 6px; }
    .sae-remove-btn:hover:not(:disabled) { background: #fef2f2; color: #dc2626; }
    .sae-remove-btn:disabled { opacity: .35; cursor: not-allowed; }
    .sae-form-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
    .sae-count { color: #64748b; font-size: 12.5px; }
    .sae-btn { display: inline-flex; align-items: center; gap: 8px; }
    .sae-results { margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    .sae-results-title { font-size: 13px; margin-bottom: 8px; }
    .sae-result-row { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; font-size: 12.5px; color: #1f2937; }
    .sae-result-row mat-icon { color: #16a34a; font-size: 18px; width: 18px; height: 18px; margin-top: 1px; }
    .sae-result-row--err mat-icon { color: #dc2626; }
    .sae-error-text { color: #dc2626; }
  `],
})
export class SuperAdminAddEmployeesComponent implements OnDestroy {
  accessRoles = ACCESS_ROLES;
  jobRoles = JOB_ROLES;

  rows = signal<EmployeeRow[]>([emptyRow()]);
  orgs = signal<OrgDirectoryItem[]>([]);
  creating = signal(false);
  importing = signal(false);
  importError = signal<string | null>(null);
  importInfo = signal<string | null>(null);
  results = signal<CreateUsersRowResult[]>([]);

  private unsubOrgs: (() => void) | null = null;

  constructor(
    private sa: SuperAdminService,
    private orgDirectory: OrgDirectoryRepo,
    private toast: ToastService,
  ) {
    this.unsubOrgs = this.orgDirectory.watchOrgs((items) => this.orgs.set(items));
  }

  addRow() {
    this.rows.set([...this.rows(), emptyRow()]);
  }

  removeRow(index: number) {
    if (this.rows().length <= 1) return;
    this.rows.set(this.rows().filter((_, i) => i !== index));
  }

  async onPhotoSelected(event: Event, index: number) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const rows = [...this.rows()];
    rows[index] = { ...rows[index], photoBusy: true };
    this.rows.set(rows);

    try {
      // The employee doesn't have a uid yet, so photos land in a staging
      // path (super-admin-only in storage.rules) keyed by a random id —
      // the resulting URL is stored as photoURL and never needs to move.
      const stagingId = crypto.randomUUID();
      const storageRef = ref(getStorage(), `orgs/_pending_avatars/users/${stagingId}/avatar`);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const photoURL = await getDownloadURL(storageRef);
      const next = [...this.rows()];
      next[index] = { ...next[index], photoURL, photoBusy: false };
      this.rows.set(next);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to upload photo.');
      const next = [...this.rows()];
      next[index] = { ...next[index], photoBusy: false };
      this.rows.set(next);
    }
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.importError.set(null);
    this.importInfo.set(null);
    this.importing.set(true);
    try {
      const name = file.name.toLowerCase();
      let raw: Record<string, string>[] = [];
      if (name.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('JSON file must contain an array of employee objects.');
        raw = parsed;
      } else if (name.endsWith('.csv')) {
        raw = parseCsv(await file.text());
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        raw = await parseXlsx(file);
      } else {
        throw new Error('Unsupported file type. Use .csv, .xlsx, .xls, or .json.');
      }

      if (raw.length === 0) throw new Error('No rows found in that file.');

      const imported = raw.map((r) => this.mapImportedRow(r));
      const existing = this.rows().filter((r) => r.displayName || r.email || r.orgId);
      this.rows.set([...existing, ...imported]);
      this.importInfo.set(`Imported ${imported.length} row(s) from ${file.name}. Review before creating.`);
    } catch (e: any) {
      this.importError.set(e?.message || 'Unable to parse that file.');
    } finally {
      this.importing.set(false);
    }
  }

  private mapImportedRow(raw: Record<string, any>): EmployeeRow {
    const row = emptyRow();
    for (const [key, value] of Object.entries(raw)) {
      const canon = HEADER_ALIASES[normalizeKey(key)];
      if (!canon || value == null) continue;
      const str = String(value).trim();
      if (!str) continue;
      if (canon === 'payRate') {
        const n = Number(str);
        row.payRate = Number.isFinite(n) ? n : null;
      } else if (canon === 'accessRole') {
        const norm = str.toLowerCase();
        row.accessRole = (ACCESS_ROLES as readonly string[]).includes(norm) ? (norm as typeof ACCESS_ROLES[number]) : 'staff';
      } else {
        (row as any)[canon] = str;
      }
    }
    return row;
  }

  async submitAll() {
    if (this.creating()) return;
    const rows = this.rows();

    const invalid = rows.find((r) => !r.email.trim() || !r.displayName.trim() || !r.orgId.trim());
    if (invalid) {
      this.toast.error('Every row needs at least a name, email, and organization.');
      return;
    }

    this.creating.set(true);
    this.results.set([]);
    try {
      const payload = rows.map((r) => ({
        email: r.email.trim(),
        displayName: r.displayName.trim(),
        orgId: r.orgId.trim(),
        accessRole: r.accessRole,
        jobRole: r.jobRole,
        payRate: r.payRate,
        payType: r.payType || undefined,
        phone: r.phone || undefined,
        employeeNumber: r.employeeNumber || undefined,
        department: r.department || undefined,
        hireDate: r.hireDate || undefined,
        photoURL: r.photoURL || undefined,
      }));
      const res = await this.sa.createUsers(payload);
      this.results.set(res.results);

      const okCount = res.results.filter((r) => r.ok).length;
      const failCount = res.results.length - okCount;
      if (failCount === 0) {
        this.toast.success(`Created ${okCount} employee(s).`);
        this.rows.set([emptyRow()]);
      } else {
        this.toast.error(`${okCount} succeeded, ${failCount} failed — see results below.`);
        // Keep only the failed rows so the admin can fix and resubmit.
        const failedEmails = new Set(res.results.filter((r) => !r.ok).map((r) => r.email));
        const remaining = rows.filter((r) => failedEmails.has(r.email.trim()));
        this.rows.set(remaining.length > 0 ? remaining : [emptyRow()]);
      }
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to create employees.');
    } finally {
      this.creating.set(false);
    }
  }

  ngOnDestroy() {
    this.unsubOrgs?.();
    this.unsubOrgs = null;
  }
}
