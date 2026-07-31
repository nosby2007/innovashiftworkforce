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
import { AppLockService } from '../../core/app-lock/app-lock.service';
import { ConnectivityService } from '../../core/connectivity/connectivity.service';
import { TwoFactorService } from '../../core/auth/two-factor.service';
import { DirectDepositRepo, DirectDepositInfo, BankAccountType, maskLast4 } from '../../core/repos/direct-deposit.repo';
import type { TotpSecret } from 'firebase/auth';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

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
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, TranslocoModule],
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
                    [disabled]="uploadingPhoto" [attr.aria-label]="'profile.changePhotoAria' | transloco">
              <mat-icon>{{ uploadingPhoto ? 'hourglass_empty' : 'photo_camera' }}</mat-icon>
            </button>
            <input #avatarInput type="file" accept="image/*" hidden (change)="onAvatarSelected($event)">
          </div>
          <div class="prof-identity">
            <span>{{ 'profile.myProfile' | transloco }}</span>
            <h1>{{ draft.displayName || draft.email || ('profile.staffMemberFallback' | transloco) }}</h1>
            <p>{{ draft.title || draft.jobRole || ('profile.staffFallback' | transloco) }} · {{ draft.department || ('profile.departmentNotSet' | transloco) }} · {{ draft.employeeNumber || ('profile.employeeIdPending' | transloco) }}</p>
          </div>
        </div>
        <div class="prof-actions">
          <button class="vs-btn-ghost" type="button" (click)="resetDraft()" [disabled]="saving">
            <mat-icon>restart_alt</mat-icon> {{ 'profile.reset' | transloco }}
          </button>
          <button class="vs-btn-primary" type="button" (click)="saveProfile()" [disabled]="saving || !orgId || !uid">
            <mat-icon>{{ saving ? 'hourglass_empty' : 'save' }}</mat-icon> {{ (saving ? 'profile.saving' : 'profile.saveProfile') | transloco }}
          </button>
        </div>
      </div>

      <div *ngIf="!orgId || !uid" class="vs-glass prof-empty">
        <mat-icon>warning_amber</mat-icon>
        {{ 'profile.missingContext' | transloco }}
      </div>

      <ng-container *ngIf="orgId && uid">
        <section class="prof-launchpad">
          <button class="prof-app" type="button" routerLink="/app/payroll">
            <span class="prof-app-icon prof-app-icon--green"><mat-icon>payments</mat-icon></span>
            <strong>{{ 'profile.onlinePayslip' | transloco }}</strong>
            <small>{{ 'profile.payrollLabel' | transloco }}</small>
          </button>
          <button class="prof-app" type="button" routerLink="/app/payroll/payslip">
            <span class="prof-app-icon prof-app-icon--blue"><mat-icon>description</mat-icon></span>
            <strong>{{ 'profile.employeeW2' | transloco }}</strong>
            <small>{{ 'profile.taxLabel' | transloco }}</small>
          </button>
          <button class="prof-app" type="button" (click)="scrollTo('tax')">
            <span class="prof-app-icon prof-app-icon--purple"><mat-icon>fact_check</mat-icon></span>
            <strong>{{ 'profile.w4Details' | transloco }}</strong>
            <small>{{ 'profile.withholdingLabel' | transloco }}</small>
          </button>
          <button class="prof-app" type="button" (click)="scrollTo('personal')">
            <span class="prof-app-icon prof-app-icon--teal"><mat-icon>badge</mat-icon></span>
            <strong>{{ 'profile.personalInformation' | transloco }}</strong>
            <small>{{ 'profile.profileLabel' | transloco }}</small>
          </button>
        </section>

        <div class="prof-grid">
          <section class="vs-glass-strong prof-card" id="personal">
            <div class="prof-card-head">
              <div>
                <h2>{{ 'profile.personalInformation' | transloco }}</h2>
                <p>{{ 'profile.personalInfoSub' | transloco }}</p>
              </div>
              <mat-icon>person</mat-icon>
            </div>
            <div class="prof-form-grid">
              <label>
                <span>{{ 'profile.fullName' | transloco }}</span>
                <input class="vs-input" [(ngModel)]="draft.displayName" [placeholder]="'profile.fullName' | transloco">
              </label>
              <label>
                <span>{{ 'profile.email' | transloco }}</span>
                <input class="vs-input" [(ngModel)]="draft.email" disabled>
              </label>
              <label>
                <span>{{ 'profile.phone' | transloco }}</span>
                <input class="vs-input" [(ngModel)]="draft.phone" [placeholder]="'profile.phonePlaceholder' | transloco">
              </label>
              <label>
                <span>{{ 'profile.jobTitle' | transloco }}</span>
                <input class="vs-input" [(ngModel)]="draft.title" [placeholder]="'profile.jobTitlePlaceholder' | transloco">
              </label>
              <label>
                <span>{{ 'profile.department' | transloco }}</span>
                <input class="vs-input" [(ngModel)]="draft.department" [placeholder]="'profile.departmentPlaceholder' | transloco">
              </label>
              <label>
                <span>{{ 'profile.primaryLocation' | transloco }}</span>
                <input class="vs-input" [(ngModel)]="draft.locationName" [placeholder]="'profile.locationPlaceholder' | transloco">
              </label>
            </div>
          </section>

          <section class="vs-glass-strong prof-card">
            <div class="prof-card-head">
              <div>
                <h2>{{ 'profile.team' | transloco }}</h2>
                <p>{{ 'profile.teamSub' | transloco }}</p>
              </div>
              <mat-icon>groups</mat-icon>
            </div>
            <div class="prof-team-list">
              <div class="prof-team-row">
                <span class="prof-chip">{{ 'profile.manager' | transloco }}</span>
                <strong>{{ draft.managerName || ('profile.notAssigned' | transloco) }}</strong>
                <small>{{ draft.managerEmail || ('profile.noManagerEmail' | transloco) }}</small>
              </div>
              <label>
                <span>{{ 'profile.emergencyContact' | transloco }}</span>
                <input class="vs-input" [(ngModel)]="draft.emergencyContactName" [placeholder]="'profile.contactNamePlaceholder' | transloco">
              </label>
              <label>
                <span>{{ 'profile.emergencyPhone' | transloco }}</span>
                <input class="vs-input" [(ngModel)]="draft.emergencyContactPhone" [placeholder]="'profile.emergencyPhonePlaceholder' | transloco">
              </label>
            </div>
          </section>
        </div>

        <section class="vs-glass-strong prof-card">
          <div class="prof-card-head">
            <div>
              <h2>{{ 'profile.address' | transloco }}</h2>
              <p>{{ 'profile.addressSub' | transloco }}</p>
            </div>
            <mat-icon>home_pin</mat-icon>
          </div>
          <div class="prof-form-grid prof-form-grid--address">
            <label>
              <span>{{ 'profile.addressLine1' | transloco }}</span>
              <input class="vs-input" [(ngModel)]="draft.addressLine1" [placeholder]="'profile.addressLine1Placeholder' | transloco">
            </label>
            <label>
              <span>{{ 'profile.addressLine2' | transloco }}</span>
              <input class="vs-input" [(ngModel)]="draft.addressLine2" [placeholder]="'profile.addressLine2Placeholder' | transloco">
            </label>
            <label>
              <span>{{ 'profile.city' | transloco }}</span>
              <input class="vs-input" [(ngModel)]="draft.city" [placeholder]="'profile.city' | transloco">
            </label>
            <label>
              <span>{{ 'profile.state' | transloco }}</span>
              <input class="vs-input" [(ngModel)]="draft.state" [placeholder]="'profile.statePlaceholder' | transloco">
            </label>
            <label>
              <span>{{ 'profile.postalCode' | transloco }}</span>
              <input class="vs-input" [(ngModel)]="draft.postalCode" [placeholder]="'profile.postalCodePlaceholder' | transloco">
            </label>
            <label>
              <span>{{ 'profile.country' | transloco }}</span>
              <input class="vs-input" [(ngModel)]="draft.country" [placeholder]="'profile.country' | transloco">
            </label>
          </div>
        </section>

        <section class="vs-glass-strong prof-card" id="tax">
          <div class="prof-card-head">
            <div>
              <h2>{{ 'profile.taxForms' | transloco }}</h2>
              <p>{{ 'profile.taxFormsSub' | transloco }}</p>
            </div>
            <mat-icon>receipt_long</mat-icon>
          </div>
          <div class="prof-tax-grid">
            <div class="prof-tax-box">
              <h3>{{ 'profile.w4Withholding' | transloco }}</h3>
              <div class="prof-form-grid">
                <label>
                  <span>{{ 'profile.filingStatus' | transloco }}</span>
                  <select class="vs-select" [(ngModel)]="draft.w4FilingStatus">
                    <option value="single">{{ 'profile.filingSingle' | transloco }}</option>
                    <option value="married">{{ 'profile.filingMarried' | transloco }}</option>
                    <option value="head_of_household">{{ 'profile.filingHoh' | transloco }}</option>
                    <option value="non_us">{{ 'profile.filingNonUs' | transloco }}</option>
                  </select>
                </label>
                <label>
                  <span>{{ 'profile.multipleJobs' | transloco }}</span>
                  <select class="vs-select" [(ngModel)]="draft.w4MultipleJobs">
                    <option [ngValue]="false">{{ 'profile.no' | transloco }}</option>
                    <option [ngValue]="true">{{ 'profile.yes' | transloco }}</option>
                  </select>
                </label>
                <label>
                  <span>{{ 'profile.dependentAmount' | transloco }}</span>
                  <input class="vs-input" type="number" [(ngModel)]="draft.w4DependentAmount" min="0">
                </label>
                <label>
                  <span>{{ 'profile.otherIncome' | transloco }}</span>
                  <input class="vs-input" type="number" [(ngModel)]="draft.w4OtherIncome" min="0">
                </label>
                <label>
                  <span>{{ 'profile.deductions' | transloco }}</span>
                  <input class="vs-input" type="number" [(ngModel)]="draft.w4Deductions" min="0">
                </label>
                <label>
                  <span>{{ 'profile.extraWithholding' | transloco }}</span>
                  <input class="vs-input" type="number" [(ngModel)]="draft.w4ExtraWithholding" min="0">
                </label>
              </div>
              <label class="prof-check">
                <input type="checkbox" [(ngModel)]="draft.w4Certified">
                <span>{{ 'profile.w4CertifyText' | transloco }}</span>
              </label>
            </div>

            <div class="prof-tax-box">
              <h3>{{ 'profile.w2Delivery' | transloco }}</h3>
              <div class="prof-form-grid">
                <label>
                  <span>{{ 'profile.deliveryPreference' | transloco }}</span>
                  <select class="vs-select" [(ngModel)]="draft.w2Delivery">
                    <option value="electronic">{{ 'profile.deliveryElectronic' | transloco }}</option>
                    <option value="mail">{{ 'profile.deliveryMail' | transloco }}</option>
                    <option value="both">{{ 'profile.deliveryBoth' | transloco }}</option>
                  </select>
                </label>
                <label>
                  <span>{{ 'profile.documentEmail' | transloco }}</span>
                  <input class="vs-input" [(ngModel)]="draft.w2Email" [placeholder]="'profile.documentEmailPlaceholder' | transloco">
                </label>
              </div>
              <label class="prof-check">
                <input type="checkbox" [(ngModel)]="draft.w2ElectronicConsent">
                <span>{{ 'profile.w2ConsentText' | transloco }}</span>
              </label>
              <p class="prof-note">{{ 'profile.taxFormsNote' | transloco }}</p>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong prof-card" id="direct-deposit">
          <div class="prof-card-head">
            <div>
              <h2>{{ 'profile.directDeposit' | transloco }}</h2>
              <p>{{ 'profile.directDepositSub' | transloco }}</p>
            </div>
            <mat-icon>account_balance</mat-icon>
          </div>

          <div class="prof-dd-summary" *ngIf="directDeposit() && !editingDirectDeposit">
            <div>
              <strong>{{ directDeposit()!.bankName }}</strong>
              <span>{{ (directDeposit()!.accountType === 'savings' ? 'profile.savings' : 'profile.checking') | transloco }} · {{ maskedAccountNumber() }}</span>
            </div>
            <button class="vs-btn-ghost" type="button" (click)="startEditDirectDeposit()">
              <mat-icon>edit</mat-icon> {{ 'profile.update' | transloco }}
            </button>
          </div>

          <div class="prof-dd-empty" *ngIf="!directDeposit() && !editingDirectDeposit">
            <p>{{ 'profile.noDdOnFile' | transloco }}</p>
            <button class="vs-btn-primary" type="button" (click)="startEditDirectDeposit()">
              <mat-icon>add</mat-icon> {{ 'profile.addBankAccount' | transloco }}
            </button>
          </div>

          <div class="prof-form-grid" *ngIf="editingDirectDeposit">
            <label>
              <span>{{ 'profile.bankName' | transloco }}</span>
              <input class="vs-input" [(ngModel)]="ddDraft.bankName" [placeholder]="'profile.bankNamePlaceholder' | transloco">
            </label>
            <label>
              <span>{{ 'profile.accountType' | transloco }}</span>
              <select class="vs-select" [(ngModel)]="ddDraft.accountType">
                <option value="checking">{{ 'profile.checking' | transloco }}</option>
                <option value="savings">{{ 'profile.savings' | transloco }}</option>
              </select>
            </label>
            <label>
              <span>{{ 'profile.routingNumber' | transloco }}</span>
              <input class="vs-input" [(ngModel)]="ddDraft.routingNumber" [placeholder]="'profile.routingNumberPlaceholder' | transloco" autocomplete="off">
            </label>
            <label>
              <span>{{ 'profile.accountNumber' | transloco }}</span>
              <input class="vs-input" type="password" [(ngModel)]="ddDraft.accountNumber" [placeholder]="'profile.accountNumberPlaceholder' | transloco" autocomplete="off">
            </label>
            <label>
              <span>{{ 'profile.confirmAccountNumber' | transloco }}</span>
              <input class="vs-input" type="password" [(ngModel)]="ddDraft.confirmAccountNumber" [placeholder]="'profile.confirmAccountNumberPlaceholder' | transloco" autocomplete="off">
            </label>
          </div>
          <p class="prof-note" *ngIf="editingDirectDeposit">{{ 'profile.ddNote' | transloco }}</p>
          <div class="prof-dd-actions" *ngIf="editingDirectDeposit">
            <button class="vs-btn-ghost" type="button" (click)="cancelEditDirectDeposit()" [disabled]="ddSaving">{{ 'profile.cancel' | transloco }}</button>
            <button class="vs-btn-primary" type="button" (click)="saveDirectDeposit()" [disabled]="ddSaving">
              {{ (ddSaving ? 'profile.saving' : 'profile.saveBankAccount') | transloco }}
            </button>
          </div>
        </section>

        <section class="vs-glass-strong prof-card">
          <div class="prof-card-head">
            <div>
              <h2>{{ 'profile.dependents' | transloco }}</h2>
              <p>{{ 'profile.dependentsSub' | transloco }}</p>
            </div>
            <button class="vs-btn-ghost" type="button" (click)="addDependent()">
              <mat-icon>add</mat-icon> {{ 'profile.add' | transloco }}
            </button>
          </div>
          <div class="prof-dependent-list">
            <div class="prof-dependent-row" *ngFor="let dep of dependents; let i = index">
              <input class="vs-input" [(ngModel)]="dep.name" [placeholder]="'profile.dependentNamePlaceholder' | transloco">
              <input class="vs-input" [(ngModel)]="dep.relationship" [placeholder]="'profile.relationshipPlaceholder' | transloco">
              <input class="vs-input" type="number" [(ngModel)]="dep.birthYear" [placeholder]="'profile.birthYearPlaceholder' | transloco">
              <label class="prof-check prof-check--inline">
                <input type="checkbox" [(ngModel)]="dep.taxEligible">
                <span>{{ 'profile.taxEligible' | transloco }}</span>
              </label>
              <button class="vs-btn-ghost prof-remove" type="button" (click)="removeDependent(i)">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
            <div class="prof-empty-line" *ngIf="dependents.length === 0">{{ 'profile.noDependentsListed' | transloco }}</div>
          </div>
        </section>

        <section class="vs-glass-strong prof-card">
          <div class="prof-card-head">
            <div>
              <h2>{{ 'profile.userPreferences' | transloco }}</h2>
              <p>{{ 'profile.userPreferencesSub' | transloco }}</p>
            </div>
            <mat-icon>tune</mat-icon>
          </div>
          <div class="prof-pref-grid">
            <label class="prof-switch">
              <input type="checkbox" [(ngModel)]="draft.accessibilityEnabled">
              <span>{{ 'profile.accessibilityEnabled' | transloco }}</span>
            </label>
            <label class="prof-switch">
              <input type="checkbox" [(ngModel)]="draft.analyticsEnabled">
              <span>{{ 'profile.enableAnalytics' | transloco }}</span>
            </label>
            <label>
              <span>{{ 'profile.timeZone' | transloco }}</span>
              <select class="vs-select" [(ngModel)]="draft.timezone">
                <option *ngFor="let tz of timezones" [value]="tz">{{ tz }}</option>
              </select>
            </label>
          </div>
        </section>

        <section class="vs-glass-strong prof-card" *ngIf="lockSupported">
          <div class="prof-card-head">
            <div>
              <h2>{{ 'profile.security' | transloco }}</h2>
              <p>{{ 'profile.securitySub' | transloco }}</p>
            </div>
            <mat-icon>fingerprint</mat-icon>
          </div>
          <div class="prof-pref-grid">
            <label class="prof-switch">
              <input type="checkbox" [checked]="lockEnabled" (change)="onToggleAppLock($event)" [disabled]="lockBusy">
              <span>{{ (lockEnabled ? 'profile.lockEnabledText' : 'profile.enableLockText') | transloco }}</span>
            </label>
          </div>
        </section>

        <section class="vs-glass-strong prof-card">
          <div class="prof-card-head">
            <div>
              <h2>{{ 'profile.twoFactorAuth' | transloco }}</h2>
              <p>{{ 'profile.twoFactorSub' | transloco }}</p>
            </div>
            <mat-icon>verified_user</mat-icon>
          </div>

          <div class="tfa-body">
            <div class="tfa-status" *ngIf="tfaEnrolled && tfaStep === 'idle'">
              <mat-icon class="tfa-status-icon tfa-status-icon--on">check_circle</mat-icon>
              <div>
                <strong>{{ 'profile.tfaEnabledTitle' | transloco }}</strong>
                <span>{{ 'profile.tfaEnabledSub' | transloco }}</span>
              </div>
              <button class="vs-btn-ghost" type="button" (click)="startTfaDisable()" [disabled]="tfaBusy">{{ 'profile.disable' | transloco }}</button>
            </div>

            <div class="tfa-status" *ngIf="!tfaEnrolled && tfaStep === 'idle'">
              <mat-icon class="tfa-status-icon">gpp_maybe</mat-icon>
              <div>
                <strong>{{ 'profile.tfaOffTitle' | transloco }}</strong>
                <span>{{ 'profile.tfaOffSub' | transloco }}</span>
              </div>
              <button class="vs-btn-primary" type="button" (click)="startTfaEnroll()" [disabled]="tfaBusy">{{ 'profile.enable' | transloco }}</button>
            </div>

            <div class="tfa-step" *ngIf="tfaStep === 'password'">
              <label class="vs-field-label">{{ 'profile.confirmPasswordToContinue' | transloco }}</label>
              <input class="doc-input" type="password" [(ngModel)]="tfaPassword" [placeholder]="'profile.currentPasswordPlaceholder' | transloco" (keyup.enter)="confirmTfaPassword()">
              <div class="tfa-step-actions">
                <button class="vs-btn-ghost" type="button" (click)="cancelTfa()" [disabled]="tfaBusy">{{ 'profile.cancel' | transloco }}</button>
                <button class="vs-btn-primary" type="button" (click)="confirmTfaPassword()" [disabled]="tfaBusy || !tfaPassword">
                  {{ (tfaBusy ? 'profile.verifying' : 'profile.continueLabel') | transloco }}
                </button>
              </div>
            </div>

            <div class="tfa-step" *ngIf="tfaStep === 'scan'">
              <p class="tfa-hint">{{ 'profile.scanQrHint' | transloco }}</p>
              <div class="tfa-qr-row">
                <img *ngIf="tfaQrDataUrl" [src]="tfaQrDataUrl" alt="Two-factor authentication QR code" class="tfa-qr">
                <div class="tfa-secret">
                  <span>{{ 'profile.manualEntryKey' | transloco }}</span>
                  <code>{{ tfaSecretKey }}</code>
                </div>
              </div>
              <label class="vs-field-label">{{ 'profile.enterCodeLabel' | transloco }}</label>
              <input class="doc-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [(ngModel)]="tfaCode" placeholder="000000" (keyup.enter)="confirmTfaEnroll()">
              <div class="tfa-step-actions">
                <button class="vs-btn-ghost" type="button" (click)="cancelTfa()" [disabled]="tfaBusy">{{ 'profile.cancel' | transloco }}</button>
                <button class="vs-btn-primary" type="button" (click)="confirmTfaEnroll()" [disabled]="tfaBusy || tfaCode.length !== 6">
                  {{ (tfaBusy ? 'profile.verifying' : 'profile.verifyEnable') | transloco }}
                </button>
              </div>
            </div>

            <div class="tfa-step" *ngIf="tfaStep === 'confirm-disable'">
              <p class="tfa-hint">{{ 'profile.tfaDisableHint' | transloco }}</p>
              <div class="tfa-step-actions">
                <button class="vs-btn-ghost" type="button" (click)="cancelTfa()" [disabled]="tfaBusy">{{ 'profile.cancel' | transloco }}</button>
                <button class="vs-btn-primary tfa-danger" type="button" (click)="confirmTfaDisable()" [disabled]="tfaBusy">
                  {{ (tfaBusy ? 'profile.disabling' : 'profile.disableTwoFactor') | transloco }}
                </button>
              </div>
            </div>
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
    .prof-dd-summary { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:18px 20px; }
    .prof-dd-summary strong { display:block; color:var(--text); }
    .prof-dd-summary span { display:block; margin-top:4px; color:var(--text-muted); font-size:13px; }
    .prof-dd-empty { padding:18px 20px; display:flex; align-items:center; justify-content:space-between; gap:14px; color:var(--text-muted); }
    .prof-dd-empty p { margin:0; }
    .prof-dd-actions { display:flex; justify-content:flex-end; gap:10px; padding:0 20px 18px; }
    .prof-pref-grid { padding:18px 20px; display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:16px; align-items:center; }
    .prof-switch { min-height:52px; border:1px solid var(--border); border-radius:8px; padding:12px 14px; display:flex; align-items:center; gap:10px; background:var(--panel); }
    .prof-switch span { margin:0; color:var(--text); }
    .tfa-body { padding:18px 20px; display:grid; gap:14px; }
    .tfa-status { display:grid; grid-template-columns:28px 1fr auto; align-items:center; gap:12px; padding:12px 14px; border:1px solid var(--border); border-radius:8px; background:var(--panel); }
    .tfa-status-icon { color:var(--text-muted); }
    .tfa-status-icon--on { color:#047857; }
    .tfa-status strong { display:block; color:var(--text); font-size:14px; }
    .tfa-status span { display:block; margin-top:2px; color:var(--text-muted); font-size:12px; }
    .tfa-step { display:grid; gap:10px; padding:14px; border:1px solid var(--border); border-radius:8px; background:var(--panel); }
    .tfa-hint { margin:0; color:var(--text-muted); font-size:12px; }
    .tfa-qr-row { display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
    .tfa-qr { width:160px; height:160px; border-radius:8px; border:1px solid var(--border); background:#fff; padding:8px; }
    .tfa-secret { display:grid; gap:4px; }
    .tfa-secret span { color:var(--text-muted); font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.05em; }
    .tfa-secret code { padding:6px 10px; border-radius:6px; background:var(--panel-2, #eef2f7); color:var(--text); font-size:13px; letter-spacing:.05em; word-break:break-all; }
    .tfa-step-actions { display:flex; justify-content:flex-end; gap:10px; }
    .tfa-danger { background:#b91c1c !important; border-color:#b91c1c !important; }
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
  lockSupported = false;
  lockEnabled = false;
  lockBusy = false;
  tfaEnrolled = false;
  tfaBusy = false;
  tfaStep: 'idle' | 'password' | 'scan' | 'confirm-disable' = 'idle';
  tfaPassword = '';
  tfaCode = '';
  tfaSecretKey = '';
  tfaQrDataUrl = '';
  private tfaPendingSecret: TotpSecret | null = null;
  private tfaIntent: 'enroll' | 'disable' | null = null;
  private unsub: (() => void) | null = null;
  private unsubDirectDeposit: (() => void) | null = null;
  private source: any = {};

  private directDepositSig: DirectDepositInfo | null = null;
  editingDirectDeposit = false;
  ddSaving = false;
  ddDraft: { bankName: string; accountType: BankAccountType; routingNumber: string; accountNumber: string; confirmAccountNumber: string } = this.emptyDdDraft();

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

  constructor(
    private zone: NgZone,
    private ctx: OrgContextService,
    private toast: ToastService,
    private appLock: AppLockService,
    private connectivity: ConnectivityService,
    private twoFactor: TwoFactorService,
    private directDepositRepo: DirectDepositRepo,
    private i18n: TranslocoService,
  ) {
    this.orgId = this.ctx.orgId();
    this.uid = this.ctx.uid();
    this.bind();
    void this.loadAppLockState();
    this.loadTfaState();
    if (this.orgId && this.uid) {
      this.unsubDirectDeposit = this.directDepositRepo.watch(this.orgId, this.uid, (info) => {
        this.directDepositSig = info;
      });
    }
  }

  directDeposit(): DirectDepositInfo | null {
    return this.directDepositSig;
  }

  maskedAccountNumber(): string {
    return maskLast4(this.directDepositSig?.accountNumber || '');
  }

  private emptyDdDraft() {
    return { bankName: '', accountType: 'checking' as BankAccountType, routingNumber: '', accountNumber: '', confirmAccountNumber: '' };
  }

  startEditDirectDeposit() {
    this.ddDraft = this.emptyDdDraft();
    this.editingDirectDeposit = true;
  }

  cancelEditDirectDeposit() {
    this.editingDirectDeposit = false;
    this.ddDraft = this.emptyDdDraft();
  }

  async saveDirectDeposit() {
    if (!this.orgId || !this.uid || this.ddSaving) return;
    const bankName = this.ddDraft.bankName.trim();
    const routingNumber = this.ddDraft.routingNumber.trim();
    const accountNumber = this.ddDraft.accountNumber.trim();
    if (!bankName || !routingNumber || !accountNumber) {
      this.toast.error(this.i18n.translate('profile.bankFieldsRequired'));
      return;
    }
    if (accountNumber !== this.ddDraft.confirmAccountNumber.trim()) {
      this.toast.error(this.i18n.translate('profile.accountNumbersMismatch'));
      return;
    }
    this.ddSaving = true;
    try {
      await this.directDepositRepo.save(this.orgId, this.uid, {
        bankName,
        accountType: this.ddDraft.accountType,
        routingNumber,
        accountNumber,
      });
      this.toast.success(this.i18n.translate('profile.ddSaved'));
      this.editingDirectDeposit = false;
      this.ddDraft = this.emptyDdDraft();
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('profile.ddSaveFailed'));
    } finally {
      this.ddSaving = false;
    }
  }

  private async loadAppLockState() {
    this.lockSupported = await this.appLock.isAvailable();
    if (this.uid) {
      this.lockEnabled = await this.appLock.isEnabled(this.uid);
    }
  }

  private loadTfaState() {
    const user = getAuth().currentUser;
    this.tfaEnrolled = user ? this.twoFactor.isEnrolled(user) : false;
  }

  startTfaEnroll() {
    this.tfaIntent = 'enroll';
    this.tfaStep = 'password';
    this.tfaPassword = '';
  }

  startTfaDisable() {
    this.tfaIntent = 'disable';
    this.tfaStep = 'password';
    this.tfaPassword = '';
  }

  cancelTfa() {
    this.tfaStep = 'idle';
    this.tfaPassword = '';
    this.tfaCode = '';
    this.tfaSecretKey = '';
    this.tfaQrDataUrl = '';
    this.tfaPendingSecret = null;
    this.tfaIntent = null;
  }

  async confirmTfaPassword() {
    const user = getAuth().currentUser;
    if (!user || !this.tfaPassword || this.tfaBusy) return;
    this.tfaBusy = true;
    try {
      await this.twoFactor.reauthenticate(user, this.tfaPassword);
      this.tfaPassword = '';
      if (this.tfaIntent === 'enroll') {
        const label = user.email || this.draft.displayName || 'InnovaShift user';
        const start = await this.twoFactor.startEnrollment(user, label);
        this.tfaPendingSecret = start.secret;
        this.tfaSecretKey = start.secretKey;
        this.tfaQrDataUrl = start.qrCodeDataUrl;
        this.tfaStep = 'scan';
      } else if (this.tfaIntent === 'disable') {
        this.tfaStep = 'confirm-disable';
      }
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('profile.incorrectPassword'));
    } finally {
      this.tfaBusy = false;
    }
  }

  async confirmTfaEnroll() {
    const user = getAuth().currentUser;
    if (!user || !this.tfaPendingSecret || this.tfaCode.length !== 6 || this.tfaBusy) return;
    this.tfaBusy = true;
    try {
      await this.twoFactor.verifyAndEnroll(user, this.tfaPendingSecret, this.tfaCode, 'Authenticator app');
      this.tfaEnrolled = true;
      this.toast.success(this.i18n.translate('profile.tfaEnabled'));
      this.cancelTfa();
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('profile.invalidCode'));
    } finally {
      this.tfaBusy = false;
    }
  }

  async confirmTfaDisable() {
    const user = getAuth().currentUser;
    if (!user || this.tfaBusy) return;
    this.tfaBusy = true;
    try {
      const factorUid = this.twoFactor.getEnrolledFactorUid(user);
      if (factorUid) await this.twoFactor.unenroll(user, factorUid);
      this.tfaEnrolled = false;
      this.toast.success(this.i18n.translate('profile.tfaDisabled'));
      this.cancelTfa();
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('profile.tfaDisableFailed'));
    } finally {
      this.tfaBusy = false;
    }
  }

  async onToggleAppLock(event: Event) {
    const input = event.target as HTMLInputElement;
    const wantEnabled = input.checked;
    if (!this.uid || this.lockBusy) {
      input.checked = this.lockEnabled;
      return;
    }
    this.lockBusy = true;
    try {
      if (wantEnabled) {
        const label = this.draft.displayName || this.draft.email || 'InnovaShift user';
        const ok = await this.appLock.enable(this.uid, label);
        this.lockEnabled = ok;
        input.checked = ok;
        if (ok) {
          this.toast.success(this.i18n.translate('profile.lockEnabledToast'));
        } else {
          this.toast.error(this.i18n.translate('profile.lockEnableFailed'));
        }
      } else {
        await this.appLock.disable(this.uid);
        this.lockEnabled = false;
        this.toast.success(this.i18n.translate('profile.lockDisabled'));
      }
    } finally {
      this.lockBusy = false;
    }
  }

  ngOnDestroy() {
    this.unsub?.();
    this.unsubDirectDeposit?.();
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
      this.toast.success(this.i18n.translate('profile.profileSaved'));
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('profile.profileSaveFailed'));
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
      this.toast.error(this.i18n.translate('profile.chooseImageFile'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.toast.error(this.i18n.translate('profile.imageTooLarge'));
      return;
    }
    try {
      this.connectivity.assertOnline();
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('profile.uploadPhotoFailed'));
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
      this.toast.success(this.i18n.translate('profile.photoUpdated'));
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('profile.photoUploadFailed'));
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
      this.zone.run(() => this.toast.errorFrom(error, this.i18n.translate('profile.profileLoadFailed')));
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
