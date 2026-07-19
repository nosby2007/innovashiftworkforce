import { Component, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { TranslocoModule } from '@jsverse/transloco';
import { DrawerComponent } from '../../shared/ui/drawer/drawer.component';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { ToastService } from '../../core/ui/toast.service';
import { getJobRoleOptions } from '../../shared/utils/job-role-catalog.util';

const ROLE_LABELS: Record<string, string> = {
  admin: 'employees.roleLabelAdmin',
  manager: 'employees.roleLabelManager',
  scheduler: 'employees.roleLabelScheduler',
  hr: 'employees.roleLabelHr',
  staff: 'employees.roleLabelStaff',
};

const ROLE_BADGE: Record<string, string> = {
  admin: 'vs-badge--danger',
  manager: 'vs-badge--warning',
  scheduler: 'vs-badge--primary',
  hr: 'vs-badge--success',
  staff: 'vs-badge--neutral',
};

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, DrawerComponent, TranslocoModule],
  template: `
    <div class="vs-page-pad">
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">{{ 'employees.title' | transloco }}</h1>
          <p class="vs-page-subtitle">
            {{ 'employees.memberCount' | transloco: { shown: filteredUsers().length, total: users().length } }}
            <ng-container *ngIf="orgId"> &mdash; <strong>{{ 'employees.organizationStaff' | transloco }}</strong></ng-container>
          </p>
        </div>
        <div class="vs-page-actions">
          <button class="vs-btn-primary emp-btn" (click)="openInviteDrawer()">
            <mat-icon>person_add</mat-icon> {{ 'employees.inviteEmployee' | transloco }}
          </button>
        </div>
      </div>

      <div class="emp-filters vs-glass">
        <div class="emp-search-wrap">
          <mat-icon class="emp-search-icon">search</mat-icon>
          <input class="emp-search" [(ngModel)]="search" [placeholder]="'employees.searchPlaceholder' | transloco" id="emp-search">
        </div>
        <div class="emp-role-filters">
          <button *ngFor="let r of roleOptions"
                  class="emp-role-chip"
                  [class.emp-role-chip--active]="roleFilter() === r.value"
                  (click)="setRoleFilter(r.value)">
            {{ r.label | transloco }}
          </button>
        </div>
      </div>

      <div *ngIf="!orgId" class="emp-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon>
        {{ 'employees.noOrgContext' | transloco }}
      </div>

      <div *ngIf="orgId && loading()" class="emp-loading">
        <div class="vs-skeleton" style="height:60px; margin-bottom:8px;"></div>
        <div class="vs-skeleton" style="height:60px; margin-bottom:8px;"></div>
        <div class="vs-skeleton" style="height:60px;"></div>
      </div>

      <div *ngIf="orgId && !loading() && filteredUsers().length === 0" class="emp-empty vs-glass">
        <mat-icon>people_outline</mat-icon>
        <div>
          <strong>{{ 'employees.noEmployeesFound' | transloco }}</strong>
          <p>{{ (search || roleFilter() !== 'all') ? ('employees.adjustSearch' | transloco) : ('employees.noMembersYet' | transloco) }}</p>
        </div>
      </div>

      <div *ngIf="orgId && !loading() && filteredUsers().length > 0" class="emp-grid">
        <div *ngFor="let u of filteredUsers()" class="emp-card vs-glass">
          <img *ngIf="u.photoURL" [src]="u.photoURL" alt="" class="emp-card-avatar-img">
          <div *ngIf="!u.photoURL" class="emp-card-avatar" [style.background]="avatarColor(u.uid)">{{ initials(u) }}</div>
          <div class="emp-card-body">
            <div class="emp-card-name">{{ u.displayName || ('employees.unnamedUser' | transloco) }}</div>
            <div class="emp-card-email">{{ u.email || ('employees.emailNotSet' | transloco) }}</div>
            <div class="emp-card-meta">
              <span class="vs-badge" [ngClass]="roleBadge(u.accessRole)">{{ roleLabel(u.accessRole) | transloco }}</span>
              <span class="vs-badge vs-badge--neutral">{{ u.jobRole || ('employees.noJobRole' | transloco) }}</span>
            </div>
            <div class="emp-card-actions" *ngIf="u.active !== false">
              <button class="vs-btn-primary emp-action" type="button" (click)="openEmployeeDetails(u); $event.stopPropagation()">
                <mat-icon>visibility</mat-icon> {{ 'employees.details' | transloco }}
              </button>
              <button class="vs-btn-ghost emp-action" type="button" (click)="openTransferDrawer(u)" [disabled]="membershipBusyUid() === u.uid || u.uid === currentUid">
                <mat-icon>swap_horiz</mat-icon> {{ 'employees.requestTransfer' | transloco }}
              </button>
              <button class="vs-btn-ghost emp-action" type="button" (click)="suspendUser(u)" [disabled]="membershipBusyUid() === u.uid || u.uid === currentUid">
                <mat-icon>pause_circle</mat-icon> {{ 'employees.suspend' | transloco }}
              </button>
              <button class="vs-btn-ghost emp-action emp-action--danger" type="button" (click)="revokeUser(u)" [disabled]="membershipBusyUid() === u.uid || u.uid === currentUid">
                <mat-icon>block</mat-icon> {{ 'employees.revoke' | transloco }}
              </button>
            </div>
          </div>
          <div class="emp-card-status">
            <span class="vs-dot" [class.vs-dot--green]="u.active !== false" [class.vs-dot--red]="u.active === false"></span>
            {{ u.active !== false ? ('employees.active' | transloco) : ('employees.inactive' | transloco) }}
          </div>
        </div>
      </div>

      <app-drawer [open]="inviteOpen()" [title]="'employees.inviteDrawerTitle' | transloco" (close)="closeInviteDrawer()">
        <div class="emp-invite-form">
          <div class="vs-form-row">
            <div>
              <label class="vs-field-label">{{ 'employees.emailAddress' | transloco }}</label>
              <input class="vs-input" type="email" [(ngModel)]="inviteDraft.email" [placeholder]="'employees.emailPlaceholder' | transloco">
            </div>
          </div>

          <div class="vs-form-row">
            <div>
              <label class="vs-field-label">{{ 'employees.fullName' | transloco }}</label>
              <input class="vs-input" [(ngModel)]="inviteDraft.displayName" [placeholder]="'employees.fullNamePlaceholder' | transloco">
            </div>
          </div>

          <div class="vs-form-row vs-form-row--2">
            <div>
              <label class="vs-field-label">{{ 'employees.systemRole' | transloco }}</label>
              <input class="vs-input" value="staff (employee)" disabled>
            </div>
            <div>
              <label class="vs-field-label">{{ 'employees.jobRole' | transloco }}</label>
              <select class="vs-select" [(ngModel)]="inviteDraft.jobRole">
                <option *ngFor="let r of jobRoleOptions()" [value]="r.value">{{ r.label }}</option>
              </select>
              <div class="emp-role-help">
                {{ (orgIndustry === 'Healthcare' ? 'employees.clinicalRolesHint' : 'employees.operationalRolesHint') | transloco }}
              </div>
            </div>
          </div>

          <div *ngIf="inviteDraft.jobRole === 'Other'" class="vs-form-row">
            <div>
              <label class="vs-field-label">{{ 'employees.customJobRole' | transloco }}</label>
              <input class="vs-input" [(ngModel)]="inviteDraft.customJobRole" [placeholder]="'employees.customJobRolePlaceholder' | transloco">
            </div>
          </div>

          <div *ngIf="inviteMsg()" class="emp-msg emp-msg--ok">
            <mat-icon>check_circle</mat-icon> {{ inviteMsg() }}
          </div>

          <div *ngIf="inviteLink()" class="emp-link-box">
            <div class="emp-link-box__title">{{ 'employees.passwordSetupLink' | transloco }}</div>
            <div class="emp-link-box__row">
              <input class="vs-input" [value]="inviteLink()!" readonly>
              <button class="vs-btn-ghost" type="button" (click)="copyInviteLink()">{{ 'employees.copy' | transloco }}</button>
            </div>
          </div>

          <div class="emp-drawer-actions">
            <button class="vs-btn-ghost" type="button" (click)="closeInviteDrawer()" [disabled]="inviting()">{{ 'employees.cancel' | transloco }}</button>
            <button class="vs-btn-primary" type="button" (click)="submitInvite()" [disabled]="inviting() || !inviteDraft.email">
              <span *ngIf="!inviting()">{{ 'employees.sendInvite' | transloco }}</span>
              <span *ngIf="inviting()">{{ 'employees.sending' | transloco }}</span>
            </button>
          </div>
        </div>
      </app-drawer>

      <app-drawer [open]="transferOpen()" [title]="'employees.transferDrawerTitle' | transloco" (close)="closeTransferDrawer()">
        <div class="emp-invite-form">
          <div *ngIf="transferTargetUser() as user" class="emp-transfer-user vs-glass">
            <div><strong>{{ user.displayName || ('employees.unnamedUser' | transloco) }}</strong></div>
            <div>{{ user.email || ('employees.emailNotSet' | transloco) }}</div>
            <div>{{ user.jobRole || ('employees.noJobRole' | transloco) }} · {{ roleLabel(user.accessRole || 'staff') | transloco }}</div>
          </div>

          <div class="vs-form-row">
            <div>
              <label class="vs-field-label">{{ 'employees.targetOrgCode' | transloco }}</label>
              <input class="vs-input" [(ngModel)]="transferDraft.toOrgId" [placeholder]="'employees.targetOrgPlaceholder' | transloco">
            </div>
          </div>

          <div class="vs-form-row">
            <div>
              <label class="vs-field-label">{{ 'employees.reason' | transloco }}</label>
              <textarea class="vs-input emp-textarea" [(ngModel)]="transferDraft.reason" [placeholder]="'employees.reasonPlaceholder' | transloco"></textarea>
            </div>
          </div>

          <div *ngIf="transferMsg()" class="emp-msg emp-msg--ok">
            <mat-icon>check_circle</mat-icon> {{ transferMsg() }}
          </div>

          <div class="emp-drawer-actions">
            <button class="vs-btn-ghost" type="button" (click)="closeTransferDrawer()" [disabled]="requestingTransfer()">{{ 'employees.cancel' | transloco }}</button>
            <button class="vs-btn-primary" type="button" (click)="submitTransferRequest()" [disabled]="requestingTransfer() || !transferDraft.toOrgId.trim()">
              <span *ngIf="!requestingTransfer()">{{ 'employees.submitTransferRequest' | transloco }}</span>
              <span *ngIf="requestingTransfer()">{{ 'employees.submitting' | transloco }}</span>
            </button>
          </div>
        </div>
      </app-drawer>
    </div>
  `,
  styles: [`
    .emp-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px !important;
    }

    .emp-filters {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .emp-search-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 200px;
    }
    .emp-search-icon { color: var(--text-subtle); font-size: 18px !important; flex-shrink: 0; }
    .emp-search {
      flex: 1;
      background: none;
      border: none;
      outline: none;
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
    }
    .emp-search::placeholder { color: var(--text-subtle); }

    .emp-role-filters { display: flex; gap: 6px; flex-wrap: wrap; }
    .emp-role-chip {
      padding: 4px 12px;
      border-radius: 100px;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 140ms ease;
    }
    .emp-role-chip:hover { border-color: var(--border-strong); color: var(--text); }
    .emp-role-chip--active {
      background: rgba(99,102,241,0.20);
      border-color: rgba(99,102,241,0.45);
      color: #a5b4fc;
      font-weight: 700;
    }

    .emp-no-org {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 20px 24px;
      color: var(--warning);
      font-weight: 600;
    }
    .emp-empty {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      padding: 28px 24px;
      color: var(--text-muted);
    }
    .emp-empty mat-icon { font-size: 32px; color: var(--text-subtle); flex-shrink: 0; margin-top: 2px; }
    .emp-empty strong { color: var(--text); display: block; font-size: 15px; }
    .emp-empty p { margin: 4px 0 0; font-size: 13px; }
    .emp-loading { padding: 4px; }

    .emp-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 14px;
    }
    .emp-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px 18px;
      transition: transform var(--t-base), box-shadow var(--t-base), border-color var(--t-base);
    }
    .emp-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow) !important;
      border-color: var(--border-strong) !important;
    }
    .emp-card-avatar {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 900;
      color: #fff;
      flex-shrink: 0;
      letter-spacing: 0.05em;
    }
    .emp-card-avatar-img {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      object-fit: cover;
      flex-shrink: 0;
    }
    .emp-card-body { flex: 1; min-width: 0; }
    .emp-card-name {
      font-size: 14px;
      font-weight: 800;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .emp-card-email {
      font-size: 12px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 6px;
    }
    .emp-card-meta { display: flex; gap: 6px; flex-wrap: wrap; }
    .emp-card-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .emp-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      padding: 6px 10px !important;
    }
    .emp-action--danger {
      border-color: rgba(239, 68, 68, 0.35);
      color: #fca5a5;
    }
    .emp-action--danger:hover {
      border-color: rgba(239, 68, 68, 0.55);
      color: #fecaca;
    }
    .emp-card-status {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .emp-invite-form {
      padding: 10px 4px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .emp-role-help {
      margin-top: 6px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .emp-link-box {
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel);
    }
    .emp-link-box__title {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .emp-link-box__row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .emp-link-box__row .vs-input { flex: 1; }
    .emp-transfer-user {
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel);
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 13px;
      color: var(--text-muted);
    }
    .emp-transfer-user strong { color: var(--text); }
    .emp-textarea { min-height: 88px; resize: vertical; }
    .emp-drawer-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 10px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .emp-msg {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 600;
    }
    .emp-msg mat-icon { font-size: 16px !important; }
    .emp-msg--ok {
      background: rgba(34,197,94,0.12);
      color: #86efac;
      border: 1px solid rgba(34,197,94,0.25);
    }
  `]
})
export class AdminEmployeesPage implements OnDestroy {
  orgId: string | null = null;
  currentUid: string | null = null;
  orgIndustry = 'Healthcare';
  users = signal<OrgUser[]>([]);
  loading = signal(true);
  search = '';
  roleFilter = signal<string>('all');

  inviteOpen = signal(false);
  inviting = signal(false);
  inviteMsg = signal<string | null>(null);
  inviteLink = signal<string | null>(null);
  membershipBusyUid = signal<string | null>(null);
  transferOpen = signal(false);
  requestingTransfer = signal(false);
  transferMsg = signal<string | null>(null);
  transferTargetUser = signal<OrgUser | null>(null);
  inviteDraft = {
    email: '',
    displayName: '',
    accessRole: 'staff',
    jobRole: 'RN',
    customJobRole: '',
  };
  transferDraft = {
    toOrgId: '',
    reason: '',
  };

  private unsub: (() => void) | null = null;

  roleOptions = [
    { value: 'all', label: 'employees.roleAll' },
    { value: 'admin', label: 'employees.roleAdmin' },
    { value: 'manager', label: 'employees.roleManager' },
    { value: 'scheduler', label: 'employees.roleScheduler' },
    { value: 'hr', label: 'employees.roleHr' },
    { value: 'staff', label: 'employees.roleStaff' },
  ];

  filteredUsers = computed(() => {
    let list = this.users();
    const q = this.search.toLowerCase().trim();
    const r = this.roleFilter();
    if (q) {
      list = list.filter((u) =>
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.jobRole || '').toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q)
      );
    }
    if (r !== 'all') list = list.filter((u) => u.accessRole === r);
    return list;
  });

  constructor(private ctx: OrgContextService, private usersRepo: UsersRepo, private toast: ToastService, private router: Router) {
    const orgId = this.ctx.orgId();
    this.currentUid = this.ctx.uid();
    this.orgId = orgId;

    if (orgId) {
      this.unsub = this.usersRepo.watchOrgUsers(orgId, (users) => {
        this.users.set(users);
        this.loading.set(false);
      });

      void this.loadOrgIndustry(orgId);
    } else {
      this.loading.set(false);
    }
  }

  jobRoleOptions() {
    return getJobRoleOptions(this.orgIndustry);
  }

  openInviteDrawer() {
    this.inviteDraft = {
      email: '',
      displayName: '',
      accessRole: 'staff',
      jobRole: this.jobRoleOptions()[0]?.value ?? 'RN',
      customJobRole: '',
    };
    this.inviteMsg.set(null);
    this.inviteLink.set(null);
    this.inviteOpen.set(true);
  }

  closeInviteDrawer() {
    this.inviteOpen.set(false);
  }

  openTransferDrawer(user: OrgUser) {
    this.transferTargetUser.set(user);
    this.transferDraft = { toOrgId: '', reason: '' };
    this.transferMsg.set(null);
    this.transferOpen.set(true);
  }

  closeTransferDrawer() {
    this.transferOpen.set(false);
    this.transferTargetUser.set(null);
    this.transferMsg.set(null);
  }

  async submitInvite() {
    if (!this.inviteDraft.email) return;

    const jobRole = this.inviteDraft.jobRole === 'Other'
      ? this.inviteDraft.customJobRole.trim()
      : this.inviteDraft.jobRole.trim();

    if (!jobRole) {
      this.toast.error('Please provide a job role.');
      return;
    }

    this.inviting.set(true);
    this.inviteMsg.set(null);
    this.inviteLink.set(null);

    try {
      const fns = getFunctions(undefined, 'us-east1');
      const inviteFn = httpsCallable<any, any>(fns, 'adminInviteUser');
      const res = await inviteFn({
        email: this.inviteDraft.email,
        displayName: this.inviteDraft.displayName,
        accessRole: this.inviteDraft.accessRole,
        jobRole,
      });

      this.inviteMsg.set(res.data?.isNewUser
        ? 'User account created and added to organization.'
        : 'Existing user was successfully added to organization.');
      this.inviteLink.set(res.data?.passwordResetLink ?? null);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to send invite.');
    } finally {
      this.inviting.set(false);
    }
  }

  async copyInviteLink() {
    const link = this.inviteLink();
    if (!link) return;
    await navigator.clipboard.writeText(link);
    this.toast.success('Invite link copied.');
  }

  setRoleFilter(role: string) {
    this.roleFilter.set(role);
  }

  roleLabel(role?: string) {
    return role ? (ROLE_LABELS[role] ?? role) : 'employees.roleLabelStaff';
  }

  roleBadge(role?: string) {
    return role ? (ROLE_BADGE[role] ?? 'vs-badge--neutral') : 'vs-badge--neutral';
  }

  initials(user: OrgUser): string {
    const name = user.displayName || user.email || 'Staff member';
    const parts = name.split(/[\s@.]+/);
    return parts.length > 1
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  }

  avatarColor(uid: string): string {
    const colors = [
      'linear-gradient(135deg,#6366f1,#4f46e5)',
      'linear-gradient(135deg,#f472b6,#db2777)',
      'linear-gradient(135deg,#22c55e,#16a34a)',
      'linear-gradient(135deg,#f59e0b,#d97706)',
      'linear-gradient(135deg,#06b6d4,#0891b2)',
      'linear-gradient(135deg,#a855f7,#7c3aed)',
    ];
    const hash = uid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  }

  ngOnDestroy() {
    if (this.unsub) this.unsub();
  }

  async openEmployeeDetails(user: OrgUser) {
    await this.router.navigate(['/admin/employees', user.uid]);
  }

  async revokeUser(user: OrgUser) {
    await this.manageMembership(user, 'revoke');
  }

  async suspendUser(user: OrgUser) {
    await this.manageMembership(user, 'suspend');
  }

  async submitTransferRequest() {
    const user = this.transferTargetUser();
    if (!user?.uid || !this.orgId) return;

    this.requestingTransfer.set(true);
    this.transferMsg.set(null);
    try {
      const fns = getFunctions(undefined, 'us-east1');
      const fn = httpsCallable<any, any>(fns, 'adminRequestUserTransfer');
      await fn({
        uid: user.uid,
        toOrgId: this.transferDraft.toOrgId.trim(),
        reason: this.transferDraft.reason.trim() || undefined,
      });
      this.transferMsg.set(`Transfer request submitted for ${user.displayName || user.email || 'staff member'}.`);
      this.toast.success('Transfer request submitted for super-admin review.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to submit transfer request.');
    } finally {
      this.requestingTransfer.set(false);
    }
  }

  private async loadOrgIndustry(orgId: string) {
    try {
      const snap = await getDoc(doc(getFirestore(), 'orgs', orgId));
      const industry = String((snap.data() as any)?.industry || '').trim();
      if (industry) {
        this.orgIndustry = industry;
        this.inviteDraft.jobRole = this.jobRoleOptions()[0]?.value ?? this.inviteDraft.jobRole;
      }
    } catch {
      // keep default healthcare catalog when org settings cannot be loaded
    }
  }

  private async manageMembership(user: OrgUser, action: 'revoke' | 'suspend') {
    if (!this.orgId) {
      this.toast.error('No organization context available.');
      return;
    }
    if (user.uid === this.currentUid) {
      this.toast.error('You cannot apply this action to your own account.');
      return;
    }

    const label = action === 'revoke' ? 'revoke access' : 'suspend login';
    const confirmed = window.confirm(`Are you sure you want to ${label} for ${user.displayName || user.email || 'this staff member'}?`);
    if (!confirmed) return;

    this.membershipBusyUid.set(user.uid);
    try {
      const fns = getFunctions(undefined, 'us-east1');
      const fn = httpsCallable<any, any>(fns, 'adminManageUserMembership');
      await fn({
        uid: user.uid,
        action,
        orgId: this.orgId,
      });
      this.toast.success(action === 'revoke' ? 'User access revoked.' : 'User login suspended.');
    } catch (e: any) {
      this.toast.errorFrom(e, action === 'revoke' ? 'Failed to revoke user.' : 'Failed to suspend user.');
    } finally {
      this.membershipBusyUid.set(null);
    }
  }
}
