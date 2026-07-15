import { Component, NgZone, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { getAuth, updateProfile } from 'firebase/auth';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { ToastService } from '../../core/ui/toast.service';

type DependentDraft = {
  name: string;
  relationship: string;
  birthYear: number | null;
  taxEligible: boolean;
};

const EMPTY_DEPENDENT: DependentDraft = {
  name: '',
  relationship: '',
  birthYear: null,
  taxEligible: true,
};

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule],
  template: `
    <div class="vs-page-pad prof-page">
      <div class="prof-header">
        <div class="prof-hero">
          <div class="prof-avatar-wrap">
            <div class="prof-avatar" [class.prof-avatar--photo]="draft.photoURL">
              <img *ngIf="draft.photoURL" [src]="draft.photoURL" alt="Profile photo">
              <span *ngIf="!draft.photoURL">{{ initials() }}</span>
            </div>
            <button class="prof-avatar-edit" type="button" (click)="avatarInput.click()"
                    [disabled]="uploadingPhoto" aria-label="Change profile photo">
              <mat-icon>{{ uploadingPhoto ? 'hourglass_empty' : 'photo_camera' }}</mat-icon>
            </button>
            <input #avatarInput type="file" accept="image/*" hidden (change)="onAvatarSelected($event)">
          </div>
          <div class="prof-identity">
            <span>My Profile</span>
            <h1>{{ draft.displayName || draft.email || 'Staff member' }}</h1>
            <p>{{ draft.title || draft.jobRole || 'Staff' }} · {{ draft.department || 'Department not set' }} · {{ draft.employeeNumber || 'Employee ID pending' }}</p>
          </div>
        </div>
        <div class="prof-actions">
          <button class="vs-btn-ghost" type="button" (click)="resetDraft()" [disabled]="saving">
            <mat-icon>restart_alt</mat-icon> Reset
          </button>
          <button class="vs-btn-primary" type="button" (click)="saveProfile()" [disabled]="saving || !orgId || !uid">
            <mat-icon>{{ saving ? 'hourglass_empty' : 'save' }}</mat-icon> {{ saving ? 'Saving...' : 'Save Profile' }}
          </button>
        </div>
      </div>

      <div *ngIf="!orgId || !uid" class="vs-glass prof-empty">
        <mat-icon>warning_amber</mat-icon>
        Missing organization or user context.
      </div>

      <ng-container *ngIf="orgId && uid">
        <section class="prof-launchpad">
          <button class="prof-app" type="button" routerLink="/app/payroll">
            <span class="prof-app-icon prof-app-icon--green"><mat-icon>payments</mat-icon></span>
            <strong>Online Payslip</strong>
            <small>Payroll</small>
          </button>
          <button class="prof-app" type="button" routerLink="/app/payroll/payslip">
            <span class="prof-app-icon prof-app-icon--blue"><mat-icon>description</mat-icon></span>
            <strong>Employee W-2</strong>
            <small>Tax</small>
          </button>
          <button class="prof-app" type="button" (click)="scrollTo('tax')">
            <span class="prof-app-icon prof-app-icon--purple"><mat-icon>fact_check</mat-icon></span>
            <strong>W-4 Details</strong>
            <small>Withholding</small>
          </button>
          <button class="prof-app" type="button" (click)="scrollTo('personal')">
            <span class="prof-app-icon prof-app-icon--teal"><mat-icon>badge</mat-icon></span>
            <strong>Personal Information</strong>
            <small>Profile</small>
          </button>
        </section>

        <div class="prof-grid">
          <section class="vs-glass-strong prof-card" id="personal">
            <div class="prof-card-head">
              <div>
                <h2>Personal Information</h2>
                <p>Contact information visible to your organization.</p>
              </div>
              <mat-icon>person</mat-icon>
            </div>
            <div class="prof-form-grid">
              <label>
                <span>Full name</span>
                <input class="vs-input" [(ngModel)]="draft.displayName" placeholder="Full name">
              </label>
              <label>
                <span>Email</span>
                <input class="vs-input" [(ngModel)]="draft.email" disabled>
              </label>
              <label>
                <span>Phone</span>
                <input class="vs-input" [(ngModel)]="draft.phone" placeholder="Mobile phone">
              </label>
              <label>
                <span>Job title</span>
                <input class="vs-input" [(ngModel)]="draft.title" placeholder="e.g. Registered Nurse">
              </label>
              <label>
                <span>Department</span>
                <input class="vs-input" [(ngModel)]="draft.department" placeholder="Department">
              </label>
              <label>
                <span>Primary location</span>
                <input class="vs-input" [(ngModel)]="draft.locationName" placeholder="Location or site">
              </label>
            </div>
          </section>

          <section class="vs-glass-strong prof-card">
            <div class="prof-card-head">
              <div>
                <h2>Team</h2>
                <p>Manager, emergency contact, and organization identity.</p>
              </div>
              <mat-icon>groups</mat-icon>
            </div>
            <div class="prof-team-list">
              <div class="prof-team-row">
                <span class="prof-chip">Manager</span>
                <strong>{{ draft.managerName || 'Not assigned' }}</strong>
                <small>{{ draft.managerEmail || 'No manager email' }}</small>
              </div>
              <label>
                <span>Emergency contact</span>
                <input class="vs-input" [(ngModel)]="draft.emergencyContactName" placeholder="Contact name">
              </label>
              <label>
                <span>Emergency phone</span>
                <input class="vs-input" [(ngModel)]="draft.emergencyContactPhone" placeholder="Emergency phone">
              </label>
            </div>
          </section>
        </div>

        <section class="vs-glass-strong prof-card">
          <div class="prof-card-head">
            <div>
              <h2>Address</h2>
              <p>Used for payroll documents and employment records.</p>
            </div>
            <mat-icon>home_pin</mat-icon>
          </div>
          <div class="prof-form-grid prof-form-grid--address">
            <label>
              <span>Address line 1</span>
              <input class="vs-input" [(ngModel)]="draft.addressLine1" placeholder="Street address">
            </label>
            <label>
              <span>Address line 2</span>
              <input class="vs-input" [(ngModel)]="draft.addressLine2" placeholder="Apartment, suite">
            </label>
            <label>
              <span>City</span>
              <input class="vs-input" [(ngModel)]="draft.city" placeholder="City">
            </label>
            <label>
              <span>State / Province</span>
              <input class="vs-input" [(ngModel)]="draft.state" placeholder="State">
            </label>
            <label>
              <span>Postal code</span>
              <input class="vs-input" [(ngModel)]="draft.postalCode" placeholder="ZIP / postal code">
            </label>
            <label>
              <span>Country</span>
              <input class="vs-input" [(ngModel)]="draft.country" placeholder="Country">
            </label>
          </div>
        </section>

        <section class="vs-glass-strong prof-card" id="tax">
          <div class="prof-card-head">
            <div>
              <h2>Tax Forms</h2>
              <p>W-4 withholding preferences and W-2 delivery settings.</p>
            </div>
            <mat-icon>receipt_long</mat-icon>
          </div>
          <div class="prof-tax-grid">
            <div class="prof-tax-box">
              <h3>W-4 Withholding</h3>
              <div class="prof-form-grid">
                <label>
                  <span>Filing status</span>
                  <select class="vs-select" [(ngModel)]="draft.w4FilingStatus">
                    <option value="single">Single or married filing separately</option>
                    <option value="married">Married filing jointly</option>
                    <option value="head_of_household">Head of household</option>
                    <option value="non_us">Non-US / manual profile</option>
                  </select>
                </label>
                <label>
                  <span>Multiple jobs</span>
                  <select class="vs-select" [(ngModel)]="draft.w4MultipleJobs">
                    <option [ngValue]="false">No</option>
                    <option [ngValue]="true">Yes</option>
                  </select>
                </label>
                <label>
                  <span>Dependent amount</span>
                  <input class="vs-input" type="number" [(ngModel)]="draft.w4DependentAmount" min="0">
                </label>
                <label>
                  <span>Other income</span>
                  <input class="vs-input" type="number" [(ngModel)]="draft.w4OtherIncome" min="0">
                </label>
                <label>
                  <span>Deductions</span>
                  <input class="vs-input" type="number" [(ngModel)]="draft.w4Deductions" min="0">
                </label>
                <label>
                  <span>Extra withholding</span>
                  <input class="vs-input" type="number" [(ngModel)]="draft.w4ExtraWithholding" min="0">
                </label>
              </div>
              <label class="prof-check">
                <input type="checkbox" [(ngModel)]="draft.w4Certified">
                <span>I certify this withholding information is accurate to the best of my knowledge.</span>
              </label>
            </div>

            <div class="prof-tax-box">
              <h3>W-2 Delivery</h3>
              <div class="prof-form-grid">
                <label>
                  <span>Delivery preference</span>
                  <select class="vs-select" [(ngModel)]="draft.w2Delivery">
                    <option value="electronic">Electronic W-2</option>
                    <option value="mail">Mail paper copy</option>
                    <option value="both">Electronic and mail</option>
                  </select>
                </label>
                <label>
                  <span>Document email</span>
                  <input class="vs-input" [(ngModel)]="draft.w2Email" placeholder="Email for tax documents">
                </label>
              </div>
              <label class="prof-check">
                <input type="checkbox" [(ngModel)]="draft.w2ElectronicConsent">
                <span>I consent to receive W-2 documents electronically where legally allowed.</span>
              </label>
              <p class="prof-note">Final tax forms should be generated by authorized payroll or tax systems. InnovaShift stores staff preferences for payroll preparation.</p>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong prof-card">
          <div class="prof-card-head">
            <div>
              <h2>Dependents</h2>
              <p>Dependents used for benefits and tax withholding preparation.</p>
            </div>
            <button class="vs-btn-ghost" type="button" (click)="addDependent()">
              <mat-icon>add</mat-icon> Add
            </button>
          </div>
          <div class="prof-dependent-list">
            <div class="prof-dependent-row" *ngFor="let dep of dependents; let i = index">
              <input class="vs-input" [(ngModel)]="dep.name" placeholder="Dependent name">
              <input class="vs-input" [(ngModel)]="dep.relationship" placeholder="Relationship">
              <input class="vs-input" type="number" [(ngModel)]="dep.birthYear" placeholder="Birth year">
              <label class="prof-check prof-check--inline">
                <input type="checkbox" [(ngModel)]="dep.taxEligible">
                <span>Tax eligible</span>
              </label>
              <button class="vs-btn-ghost prof-remove" type="button" (click)="removeDependent(i)">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
            <div class="prof-empty-line" *ngIf="dependents.length === 0">No dependents listed.</div>
          </div>
        </section>

        <section class="vs-glass-strong prof-card">
          <div class="prof-card-head">
            <div>
              <h2>User Preferences</h2>
              <p>Accessibility, analytics, and local time zone.</p>
            </div>
            <mat-icon>tune</mat-icon>
          </div>
          <div class="prof-pref-grid">
            <label class="prof-switch">
              <input type="checkbox" [(ngModel)]="draft.accessibilityEnabled">
              <span>Accessibility enabled</span>
            </label>
            <label class="prof-switch">
              <input type="checkbox" [(ngModel)]="draft.analyticsEnabled">
              <span>Enable analytics</span>
            </label>
            <label>
              <span>Time zone</span>
              <select class="vs-select" [(ngModel)]="draft.timezone">
                <option *ngFor="let tz of timezones" [value]="tz">{{ tz }}</option>
              </select>
            </label>
          </div>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .prof-page { background: var(--bg); }
    .prof-header { max-width: 1120px; margin: 0 auto 20px; display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
    .prof-hero { flex:1; display:flex; align-items:center; gap:22px; padding:28px; border:1px solid var(--border); border-radius:8px; background:var(--surface); box-shadow:var(--shadow-sm); }
    .prof-avatar-wrap { position:relative; flex-shrink:0; }
    .prof-avatar { width:112px; height:112px; border-radius:999px; border:2px solid var(--border-strong); display:flex; align-items:center; justify-content:center; color:var(--primary); font-size:34px; font-weight:900; background:var(--panel); overflow:hidden; }
    .prof-avatar--photo { border-color:var(--border); }
    .prof-avatar img { width:100%; height:100%; object-fit:cover; }
    .prof-avatar-edit {
      position:absolute; bottom:2px; right:2px;
      width:32px; height:32px; border-radius:999px;
      display:flex; align-items:center; justify-content:center;
      background:var(--primary); color:#fff; border:2px solid var(--surface);
      cursor:pointer;
    }
    .prof-avatar-edit:hover { filter:brightness(1.08); }
    .prof-avatar-edit:disabled { opacity:0.6; cursor:default; }
    .prof-avatar-edit mat-icon { font-size:16px !important; width:16px; height:16px; }
    .prof-identity span { display:block; color:var(--text-muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; font-weight:900; margin-bottom:8px; }
    .prof-identity h1 { margin:0; color:var(--text); font-size:30px; line-height:1.1; }
    .prof-identity p { margin:10px 0 0; color:var(--text-muted); font-size:15px; }
    .prof-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .prof-actions button, .prof-card-head button { display:inline-flex; align-items:center; gap:7px; }
    .prof-empty { max-width:1120px; margin:0 auto; padding:18px; display:flex; align-items:center; gap:10px; }

    .prof-launchpad { max-width:1120px; margin:0 auto 18px; display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:14px; }
    .prof-app { min-height:96px; border:1px solid var(--border); border-radius:8px; background:var(--surface); box-shadow:var(--shadow-sm); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; color:var(--text); cursor:pointer; }
    .prof-app:hover { border-color:var(--border-strong); transform:translateY(-1px); }
    .prof-app strong { font-size:13px; }
    .prof-app small { color:var(--text-muted); font-size:11px; }
    .prof-app-icon { width:38px; height:38px; border-radius:10px; display:flex; align-items:center; justify-content:center; color:white; }
    .prof-app-icon mat-icon { font-size:20px !important; width:20px; height:20px; }
    .prof-app-icon--green { background:#059669; }
    .prof-app-icon--blue { background:#2563eb; }
    .prof-app-icon--purple { background:#7c3aed; }
    .prof-app-icon--teal { background:#0f766e; }

    .prof-grid { max-width:1120px; margin:0 auto 18px; display:grid; grid-template-columns:1.15fr .85fr; gap:18px; }
    .prof-card { max-width:1120px; margin:0 auto 18px; border-radius:8px; overflow:hidden; }
    .prof-card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; padding:18px 20px; border-bottom:1px solid var(--border); }
    .prof-card-head h2 { margin:0; color:var(--text); font-size:18px; }
    .prof-card-head p { margin:4px 0 0; color:var(--text-muted); font-size:13px; }
    .prof-card-head > mat-icon { color:var(--primary); }
    .prof-form-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; padding:18px 20px; }
    .prof-form-grid--address { grid-template-columns:repeat(3, minmax(0, 1fr)); }
    label span { display:block; color:var(--text-muted); font-size:12px; font-weight:800; margin-bottom:7px; }
    .prof-team-list { padding:18px 20px; display:grid; gap:14px; }
    .prof-team-row { padding:14px; border:1px solid var(--border); border-radius:8px; background:var(--panel); display:grid; gap:4px; }
    .prof-chip { width:max-content; padding:3px 8px; border:1px solid var(--border); border-radius:999px; color:var(--text-muted); font-size:11px; font-weight:900; }
    .prof-team-row strong { color:var(--text); }
    .prof-team-row small { color:var(--text-muted); }
    .prof-tax-grid { padding:18px 20px; display:grid; grid-template-columns:1fr 1fr; gap:18px; }
    .prof-tax-box { border:1px solid var(--border); border-radius:8px; background:var(--panel); overflow:hidden; }
    .prof-tax-box h3 { margin:0; padding:14px 16px; border-bottom:1px solid var(--border); color:var(--text); font-size:15px; }
    .prof-tax-box .prof-form-grid { padding:16px; }
    .prof-check { display:flex; align-items:flex-start; gap:10px; padding:0 16px 16px; color:var(--text-muted); font-size:13px; }
    .prof-check input { margin-top:2px; }
    .prof-check--inline { padding:0; align-items:center; }
    .prof-note { margin:0; padding:0 16px 16px; color:var(--text-subtle); font-size:12px; line-height:1.45; }
    .prof-dependent-list { padding:18px 20px; display:grid; gap:10px; }
    .prof-dependent-row { display:grid; grid-template-columns:1.1fr .85fr .55fr auto auto; gap:10px; align-items:center; }
    .prof-remove { min-width:42px; padding-inline:10px !important; }
    .prof-empty-line { padding:14px; border:1px dashed var(--border); border-radius:8px; color:var(--text-muted); }
    .prof-pref-grid { padding:18px 20px; display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:16px; align-items:center; }
    .prof-switch { min-height:52px; border:1px solid var(--border); border-radius:8px; padding:12px 14px; display:flex; align-items:center; gap:10px; background:var(--panel); }
    .prof-switch span { margin:0; color:var(--text); }
    @media (max-width: 940px) {
      .prof-header, .prof-hero { flex-direction:column; }
      .prof-launchpad, .prof-grid, .prof-tax-grid, .prof-form-grid, .prof-form-grid--address, .prof-pref-grid { grid-template-columns:1fr; }
      .prof-dependent-row { grid-template-columns:1fr; align-items:stretch; }
      .prof-avatar { width:88px; height:88px; font-size:26px; }
    }
  `],
})
export class StaffProfilePage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;
  saving = false;
  uploadingPhoto = false;
  private unsub: (() => void) | null = null;
  private source: any = {};

  timezones = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Africa/Douala',
    'Africa/Lagos',
    'Africa/Accra',
    'Africa/Nairobi',
    'Europe/London',
    'Europe/Paris',
  ];

  draft: any = this.emptyDraft();
  dependents: DependentDraft[] = [];

  constructor(private zone: NgZone, private ctx: OrgContextService, private toast: ToastService) {
    this.orgId = this.ctx.orgId();
    this.uid = this.ctx.uid();
    this.bind();
  }

  ngOnDestroy() {
    this.unsub?.();
  }

  initials(): string {
    const raw = String(this.draft.displayName || this.draft.email || this.uid || 'ST');
    const parts = raw.split(/[\s@.]+/).filter(Boolean);
    return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : raw.slice(0, 2).toUpperCase();
  }

  addDependent() {
    this.dependents = [...this.dependents, { ...EMPTY_DEPENDENT }];
  }

  removeDependent(index: number) {
    this.dependents = this.dependents.filter((_, i) => i !== index);
  }

  resetDraft() {
    this.hydrate(this.source);
  }

  scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async saveProfile() {
    if (!this.orgId || !this.uid) return;
    this.saving = true;
    try {
      const payload = this.toPayload();
      await setDoc(doc(getFirestore(), `orgs/${this.orgId}/users/${this.uid}`), payload, { merge: true });
      const current = getAuth().currentUser;
      if (current && payload.displayName) {
        await updateProfile(current, { displayName: payload.displayName }).catch(() => undefined);
      }
      this.ctx.setContext({
        orgId: this.ctx.orgId(),
        uid: this.ctx.uid(),
        accessRole: this.ctx.accessRole(),
        platformRole: this.ctx.platformRole(),
        displayName: payload.displayName || this.ctx.displayName(),
        email: this.ctx.email(),
        photoURL: this.ctx.photoURL(),
        jobRole: this.ctx.jobRole(),
        plan: this.ctx.plan(),
        planStatus: this.ctx.planStatus(),
        countryCode: this.ctx.countryCode(),
        currencyCode: this.ctx.currencyCode(),
        payFrequency: this.ctx.payFrequency(),
        taxProfile: this.ctx.taxProfile(),
      });
      this.toast.success('Profile saved.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to save profile.');
    } finally {
      this.saving = false;
    }
  }

  async onAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    input.value = '';
    if (!file || !this.orgId || !this.uid) return;

    if (!file.type.startsWith('image/')) {
      this.toast.error('Please choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.toast.error('Image must be 5MB or smaller.');
      return;
    }

    this.uploadingPhoto = true;
    try {
      const storageRef = ref(getStorage(), `orgs/${this.orgId}/users/${this.uid}/avatar`);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const photoURL = await getDownloadURL(storageRef);

      await setDoc(doc(getFirestore(), `orgs/${this.orgId}/users/${this.uid}`), {
        photoURL,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      this.draft = { ...this.draft, photoURL };
      this.ctx.setContext({
        orgId: this.ctx.orgId(),
        uid: this.ctx.uid(),
        accessRole: this.ctx.accessRole(),
        platformRole: this.ctx.platformRole(),
        displayName: this.ctx.displayName(),
        email: this.ctx.email(),
        photoURL,
        jobRole: this.ctx.jobRole(),
        plan: this.ctx.plan(),
        planStatus: this.ctx.planStatus(),
        countryCode: this.ctx.countryCode(),
        currencyCode: this.ctx.currencyCode(),
        payFrequency: this.ctx.payFrequency(),
        taxProfile: this.ctx.taxProfile(),
      });
      this.toast.success('Profile photo updated.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to upload photo.');
    } finally {
      this.uploadingPhoto = false;
    }
  }

  private bind() {
    this.unsub?.();
    if (!this.orgId || !this.uid) return;
    this.unsub = onSnapshot(doc(getFirestore(), `orgs/${this.orgId}/users/${this.uid}`), (snap) => {
      this.zone.run(() => {
        this.source = snap.exists() ? snap.data() : {};
        this.hydrate(this.source);
      });
    }, (error) => {
      console.warn('[InnovaShift] Staff profile listener failed.', error);
      this.zone.run(() => this.toast.errorFrom(error, 'Unable to load profile.'));
    });
  }

  private hydrate(data: any) {
    const profile = data?.profile || {};
    const address = profile?.address || data?.address || {};
    const emergency = profile?.emergencyContact || data?.emergencyContact || {};
    const tax = data?.taxWithholding || {};
    const w2 = data?.w2 || {};
    const preferences = data?.preferences || {};
    this.draft = {
      ...this.emptyDraft(),
      displayName: data?.displayName || '',
      email: data?.email || this.ctx.email() || '',
      photoURL: data?.photoURL || this.ctx.photoURL() || '',
      jobRole: data?.jobRole || this.ctx.jobRole() || '',
      employeeNumber: data?.employeeNumber || profile?.employeeNumber || '',
      title: profile?.title || data?.title || '',
      department: profile?.department || data?.department || '',
      locationName: profile?.locationName || data?.locationName || '',
      phone: profile?.phone || data?.phone || '',
      managerName: profile?.managerName || data?.managerName || '',
      managerEmail: profile?.managerEmail || data?.managerEmail || '',
      emergencyContactName: emergency?.name || '',
      emergencyContactPhone: emergency?.phone || '',
      addressLine1: address?.line1 || '',
      addressLine2: address?.line2 || '',
      city: address?.city || '',
      state: address?.state || '',
      postalCode: address?.postalCode || '',
      country: address?.country || '',
      w4FilingStatus: tax?.filingStatus || 'single',
      w4MultipleJobs: tax?.multipleJobs === true,
      w4DependentAmount: Number(tax?.dependentAmount || 0),
      w4OtherIncome: Number(tax?.otherIncome || 0),
      w4Deductions: Number(tax?.deductions || 0),
      w4ExtraWithholding: Number(tax?.extraWithholding || 0),
      w4Certified: tax?.certified === true,
      w2Delivery: w2?.delivery || 'electronic',
      w2Email: w2?.email || data?.email || this.ctx.email() || '',
      w2ElectronicConsent: w2?.electronicConsent !== false,
      accessibilityEnabled: preferences?.accessibilityEnabled === true,
      analyticsEnabled: preferences?.analyticsEnabled !== false,
      timezone: preferences?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    };
    this.dependents = Array.isArray(data?.dependents)
      ? data.dependents.map((dep: any) => ({
          name: String(dep?.name || ''),
          relationship: String(dep?.relationship || ''),
          birthYear: dep?.birthYear ? Number(dep.birthYear) : null,
          taxEligible: dep?.taxEligible !== false,
        }))
      : [];
  }

  private emptyDraft() {
    return {
      displayName: '',
      email: '',
      photoURL: '',
      jobRole: '',
      employeeNumber: '',
      title: '',
      department: '',
      locationName: '',
      phone: '',
      managerName: '',
      managerEmail: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
      w4FilingStatus: 'single',
      w4MultipleJobs: false,
      w4DependentAmount: 0,
      w4OtherIncome: 0,
      w4Deductions: 0,
      w4ExtraWithholding: 0,
      w4Certified: false,
      w2Delivery: 'electronic',
      w2Email: '',
      w2ElectronicConsent: true,
      accessibilityEnabled: false,
      analyticsEnabled: true,
      timezone: 'America/New_York',
    };
  }

  private toPayload() {
    const dependents = this.dependents
      .map((dep) => ({
        name: dep.name.trim(),
        relationship: dep.relationship.trim(),
        birthYear: dep.birthYear ? Number(dep.birthYear) : null,
        taxEligible: dep.taxEligible !== false,
      }))
      .filter((dep) => dep.name || dep.relationship);

    return {
      displayName: String(this.draft.displayName || '').trim(),
      phone: String(this.draft.phone || '').trim(),
      title: String(this.draft.title || '').trim(),
      department: String(this.draft.department || '').trim(),
      locationName: String(this.draft.locationName || '').trim(),
      profile: {
        employeeNumber: String(this.draft.employeeNumber || '').trim(),
        title: String(this.draft.title || '').trim(),
        department: String(this.draft.department || '').trim(),
        locationName: String(this.draft.locationName || '').trim(),
        phone: String(this.draft.phone || '').trim(),
        managerName: String(this.draft.managerName || '').trim(),
        managerEmail: String(this.draft.managerEmail || '').trim(),
        emergencyContact: {
          name: String(this.draft.emergencyContactName || '').trim(),
          phone: String(this.draft.emergencyContactPhone || '').trim(),
        },
        address: {
          line1: String(this.draft.addressLine1 || '').trim(),
          line2: String(this.draft.addressLine2 || '').trim(),
          city: String(this.draft.city || '').trim(),
          state: String(this.draft.state || '').trim(),
          postalCode: String(this.draft.postalCode || '').trim(),
          country: String(this.draft.country || '').trim(),
        },
      },
      address: {
        line1: String(this.draft.addressLine1 || '').trim(),
        line2: String(this.draft.addressLine2 || '').trim(),
        city: String(this.draft.city || '').trim(),
        state: String(this.draft.state || '').trim(),
        postalCode: String(this.draft.postalCode || '').trim(),
        country: String(this.draft.country || '').trim(),
      },
      emergencyContact: {
        name: String(this.draft.emergencyContactName || '').trim(),
        phone: String(this.draft.emergencyContactPhone || '').trim(),
      },
      taxWithholding: {
        filingStatus: this.draft.w4FilingStatus || 'single',
        multipleJobs: this.draft.w4MultipleJobs === true,
        dependentAmount: Number(this.draft.w4DependentAmount || 0),
        otherIncome: Number(this.draft.w4OtherIncome || 0),
        deductions: Number(this.draft.w4Deductions || 0),
        extraWithholding: Number(this.draft.w4ExtraWithholding || 0),
        certified: this.draft.w4Certified === true,
        updatedAt: serverTimestamp(),
      },
      w2: {
        delivery: this.draft.w2Delivery || 'electronic',
        email: String(this.draft.w2Email || '').trim(),
        electronicConsent: this.draft.w2ElectronicConsent !== false,
        updatedAt: serverTimestamp(),
      },
      dependents,
      preferences: {
        accessibilityEnabled: this.draft.accessibilityEnabled === true,
        analyticsEnabled: this.draft.analyticsEnabled !== false,
        timezone: this.draft.timezone || 'America/New_York',
      },
      profileUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  }
}
