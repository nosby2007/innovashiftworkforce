import { Component, computed, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { filter } from 'rxjs/operators';

import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { PlanEntitlementsService, PlanFeature } from '../../core/tenancy/plan-entitlements.service';
import { getAuth, signOut } from 'firebase/auth';

type ShellMode = 'staff' | 'admin' | 'platform';
type NavSection = 'workspace' | 'admin' | 'platform' | 'account';
type NavItem = {
  label: string;
  link: string;
  icon: string;
  section: NavSection;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  feature?: PlanFeature;
  /** Restricts to specific access roles beyond the general admin-like set (e.g. payroll/PTO/documents: admin+hr only). Omit for no extra restriction. */
  roles?: string[];
};

const ROUTE_TITLES: Record<string, string> = {
  '/app/dashboard':               'Dashboard',
  '/app/onboarding':              'Staff Onboarding',
  '/app/schedule':                'My Schedule',
  '/app/marketplace':             'Shift Marketplace',
  '/app/attendance':              'Time & Attendance',
  '/app/accruals':                'My Accruals',
  '/app/payroll':                 'My Payroll',
  '/app/profile':                 'My Profile',
  '/app/documents':               'Document Center',
  '/app/messages':                'Message Center',
  '/app/shift-chat':              'Shift Live Chat',
  '/app/notifications':           'Notifications',
  '/app/settings':                'Settings',
  '/admin':                       'Admin Dashboard',
  '/admin/scheduler':             'Scheduler',
  '/admin/timesheets':            'Timesheets',
  '/admin/payroll':               'Payroll',
  '/admin/pto':                   'PTO Requests',
  '/admin/documents':             'Document Verification',
  '/admin/readiness':             'Launch Readiness',
  '/admin/audit':                 'Audit Log',
  '/admin/ai-copilot':            'AI Copilot',
  '/admin/employees':             'Employees',
  '/admin/schedule-details':      'Schedule Details',
  '/admin/org-settings':          'Organization Settings',
  '/admin/settings':              'Admin Settings',
  '/platform':                    'Platform Administration',
  '/platform/settings':           'Platform Settings',
};

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  template: `
    <mat-sidenav-container class="l-shell" [class.shell-platform]="shellMode() === 'platform'">

      <!-- ═══ SIDEBAR ═══ -->
      <mat-sidenav
        class="l-sidenav"
        [mode]="isMobile() ? 'over' : 'side'"
        [(opened)]="opened">

        <!-- Brand -->
        <div class="l-brand">
          <img src="assets/logo.png" alt="InnovaShift" class="l-logo-img">
          <div class="l-brand-text" *ngIf="shellMode() !== 'staff'">
            <div class="l-brand-name">{{ shellBrand() }}</div>
            <div class="l-brand-sub">{{ shellSubtitle() }}</div>
          </div>
        </div>

        <!-- Nav -->
        <nav class="l-nav" role="navigation" aria-label="Main navigation">

          <ng-container *ngIf="shellMode() === 'staff'">
            <div class="l-nav-section-title">Staff Workspace</div>
            <a *ngFor="let item of workspaceNav"
               class="l-nav-item"
               [routerLink]="item.link"
               routerLinkActive="is-active"
               [routerLinkActiveOptions]="{ exact: item.link === '/app/dashboard' }"
               [matTooltip]="item.label"
               matTooltipPosition="right">
              <mat-icon class="l-nav-icon">{{ item.icon }}</mat-icon>
              <span class="l-nav-label">{{ item.label }}</span>
            </a>

            <a *ngIf="isAdminLike()"
               class="l-nav-item l-nav-item--admin-bridge"
               routerLink="/admin"
               matTooltip="Admin Dashboard"
               matTooltipPosition="right">
              <mat-icon class="l-nav-icon">admin_panel_settings</mat-icon>
              <span class="l-nav-label">Admin Dashboard</span>
            </a>

            <mat-divider class="l-divider"></mat-divider>
          </ng-container>

          <ng-container *ngIf="shellMode() === 'admin'">
            <div class="l-nav-section-title">Administration</div>
            <a *ngFor="let item of visibleAdminNav()"
               class="l-nav-item"
               [routerLink]="item.link"
               routerLinkActive="is-active"
               [routerLinkActiveOptions]="{ exact: item.link === '/admin' }"
               [matTooltip]="item.label"
               matTooltipPosition="right">
              <mat-icon class="l-nav-icon">{{ item.icon }}</mat-icon>
              <span class="l-nav-label">{{ item.label }}</span>
            </a>
            <a class="l-nav-item l-nav-item--staff-bridge"
               routerLink="/app/schedule"
               matTooltip="View my staff schedule"
               matTooltipPosition="right">
              <mat-icon class="l-nav-icon">badge</mat-icon>
              <span class="l-nav-label">My Staff Schedule</span>
            </a>
            <mat-divider class="l-divider"></mat-divider>
          </ng-container>

          <ng-container *ngIf="shellMode() === 'platform'">
            <div class="l-nav-section-title">Platform Console</div>
            <a *ngFor="let item of platformNav"
               class="l-nav-item"
               [routerLink]="item.link"
               routerLinkActive="is-active"
               [routerLinkActiveOptions]="{ exact: item.link === '/platform' }"
               [matTooltip]="item.label"
               matTooltipPosition="right">
              <mat-icon class="l-nav-icon">{{ item.icon }}</mat-icon>
              <span class="l-nav-label">{{ item.label }}</span>
            </a>
            <mat-divider class="l-divider"></mat-divider>
          </ng-container>

          <div class="l-nav-section-title">Account</div>
          <a class="l-nav-item" [routerLink]="settingsLink()" routerLinkActive="is-active">
            <mat-icon class="l-nav-icon">settings</mat-icon>
            <span class="l-nav-label">Settings</span>
          </a>
        </nav>

        <!-- Sidebar Footer -->
        <div class="l-sidenav-footer">
          <div class="l-foot-avatar">
            <img *ngIf="avatarUrl()" [src]="avatarUrl()" alt="">
            <mat-icon *ngIf="!avatarUrl()">account_circle</mat-icon>
          </div>
          <div class="l-foot-info">
            <div class="l-foot-strong">{{ userDisplayName() }}</div>
            <div class="l-foot-muted">{{ roleLabel() }}</div>
          </div>
          <button mat-icon-button class="l-logout-btn"
                  (click)="logout()"
                  matTooltip="Sign out"
                  aria-label="Sign out">
            <mat-icon>logout</mat-icon>
          </button>
        </div>
      </mat-sidenav>

      <!-- ═══ CONTENT ═══ -->
      <mat-sidenav-content class="l-content">

        <!-- Topbar -->
        <mat-toolbar class="l-toolbar">
          <button mat-icon-button class="l-burger"
                  (click)="toggleSidenav()"
                  aria-label="Toggle navigation">
            <mat-icon>{{ opened ? 'menu_open' : 'menu' }}</mat-icon>
          </button>

          <div class="l-toolbar-left">
            <div class="l-toolbar-title">{{ pageTitle() }}</div>
            <div class="l-toolbar-sub" *ngIf="orgId()">Organization workspace</div>
          </div>

          <span class="l-spacer"></span>

          <button mat-button class="l-admin-bridge-top"
                  routerLink="/admin"
                  *ngIf="shellMode() === 'staff' && isAdminLike()"
                  matTooltip="Go to Admin Dashboard">
            <mat-icon>admin_panel_settings</mat-icon>
            <span class="l-bridge-label">Admin</span>
          </button>

          <button mat-button class="l-staff-bridge-top"
                  routerLink="/app/schedule"
                  *ngIf="shellMode() === 'admin'"
                  matTooltip="Go to my staff schedule">
            <mat-icon>badge</mat-icon>
            <span class="l-bridge-label">My Schedule</span>
          </button>

          <!-- Notifications -->
          <button mat-icon-button class="l-topbtn"
                  routerLink="/app/notifications"
                  *ngIf="shellMode() !== 'platform'"
                  matTooltip="Notifications"
                  aria-label="Notifications">
            <mat-icon>notifications</mat-icon>
          </button>

          <!-- User menu -->
          <button mat-button class="l-userbtn" [matMenuTriggerFor]="userMenu" id="user-menu-trigger">
            <div class="l-avatar-sm" [class.l-avatar-sm--photo]="avatarUrl()">
              <img *ngIf="avatarUrl()" [src]="avatarUrl()" alt="">
              <span *ngIf="!avatarUrl()">{{ avatarInitials() }}</span>
            </div>
            <span class="l-user-name">{{ userDisplayName() }}</span>
            <mat-icon class="l-chevron">expand_more</mat-icon>
          </button>

          <mat-menu #userMenu="matMenu" class="vs-user-menu">
            <div class="l-menu-header">
              <div class="l-menu-name">{{ userDisplayName() }}</div>
              <div class="l-menu-role">{{ roleLabel() }}</div>
              <div class="l-menu-org" *ngIf="orgId()">Organization workspace</div>
            </div>
            <mat-divider></mat-divider>
            <button mat-menu-item [routerLink]="settingsLink()">
              <mat-icon>settings</mat-icon>
              <span>Settings</span>
            </button>
            <button mat-menu-item routerLink="/admin/org-settings" *ngIf="shellMode() === 'admin'">
              <mat-icon>business</mat-icon>
              <span>Organization Settings</span>
            </button>
            <mat-divider></mat-divider>
            <button mat-menu-item (click)="logout()" class="l-menu-logout">
              <mat-icon>logout</mat-icon>
              <span>Sign out</span>
            </button>
          </mat-menu>
        </mat-toolbar>

        <!-- Page content -->
        <div class="l-page vs-animate-in">
          <router-outlet></router-outlet>
        </div>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    /* ═══ Shell ═══ */
    .l-shell {
      height: 100vh;
      background: var(--app-bg);
    }

    .l-shell.shell-platform {
      --sidebar-bg: #08111f;
      --topbar-bg: rgba(8, 17, 31, 0.92);
      color-scheme: dark;
    }

    .l-shell.shell-platform .l-brand-name,
    .l-shell.shell-platform .l-toolbar-title,
    .l-shell.shell-platform .l-foot-strong,
    .l-shell.shell-platform .l-menu-name {
      color: #f8fafc;
    }

    .l-shell.shell-platform .l-nav-item,
    .l-shell.shell-platform .l-brand-sub,
    .l-shell.shell-platform .l-toolbar-sub,
    .l-shell.shell-platform .l-foot-muted {
      color: rgba(203, 213, 225, 0.80);
    }

    /* ═══ Sidebar ═══ */
    .l-sidenav {
      width: var(--sidebar-w, 270px);
      background: var(--sidebar-bg, #ffffff) !important;
      border-right: 1px solid var(--border) !important;
      display: flex;
      flex-direction: column;
    }

    /* Brand */
    .l-brand {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 18px 16px;
      background: var(--sidebar-bg, #ffffff);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .l-logo-img {
      height: 32px;
      width: auto;
      max-width: 100%;
      object-fit: contain;
      flex-shrink: 0;
    }
    .l-brand-text { min-width: 0; display: flex; flex-direction: column; }
    .l-brand-name {
      font-size: 15px;
      font-weight: 900;
      letter-spacing: -0.01em;
      color: var(--text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .l-brand-sub {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 1px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* Nav */
    .l-nav {
      padding: 10px 10px 12px;
      overflow-y: auto;
      flex: 1;
    }
    .l-nav-section-title {
      padding: 12px 12px 5px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.16em;
      color: var(--text-subtle);
      text-transform: uppercase;
    }
    .l-nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      margin: 2px 4px;
      border-radius: 12px;
      color: var(--text-muted);
      text-decoration: none;
      border: 1px solid transparent;
      transition: all 140ms ease;
      font-size: 13.5px;
      font-weight: 600;
    }
    .l-nav-item:hover {
      color: var(--text);
      background: var(--panel);
      border-color: var(--border);
    }
    .l-nav-item.is-active {
      color: var(--text);
      background: linear-gradient(135deg, rgba(37,99,235,0.18), rgba(20,184,166,0.10));
      border-color: rgba(37,99,235,0.34);
      font-weight: 700;
    }
    .l-nav-item.is-active .l-nav-icon {
      color: #93c5fd;
    }
    .l-nav-item--admin-bridge {
      margin-top: 8px;
      color: #07533f;
      background: #ecfdf5;
      border-color: rgba(4,120,87,0.24);
      font-weight: 800;
    }
    .l-nav-item--admin-bridge:hover {
      color: #064e3b;
      background: #d1fae5;
      border-color: rgba(4,120,87,0.34);
    }
    .l-nav-item--staff-bridge {
      margin-top: 8px;
      color: #075985;
      background: #f0f9ff;
      border-color: rgba(7,89,133,0.22);
      font-weight: 800;
    }
    .l-nav-item--staff-bridge:hover {
      color: #0c4a6e;
      background: #e0f2fe;
      border-color: rgba(7,89,133,0.34);
    }
    .l-nav-icon { font-size: 19px; width: 19px; opacity: 0.85; flex-shrink: 0; }
    .l-nav-label { flex: 1; }
    .l-divider { margin: 8px 10px; opacity: 0.15; }

    /* Sidebar footer */
    .l-sidenav-footer {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-top: 1px solid var(--border);
      background: var(--sidebar-bg, #ffffff);
      flex-shrink: 0;
    }
    .l-foot-avatar {
      width: 32px; height: 32px;
      border-radius: 50%;
      background: var(--panel-2);
      border: 1px solid var(--border);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      color: var(--text-muted);
      overflow: hidden;
    }
    .l-foot-avatar mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .l-foot-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .l-foot-info { flex: 1; min-width: 0; }
    .l-foot-strong {
      font-size: 13px; font-weight: 800; color: var(--text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .l-foot-muted {
      font-size: 11px; color: var(--text-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .l-logout-btn {
      color: var(--text-muted) !important;
      flex-shrink: 0;
    }
    .l-logout-btn:hover { color: var(--danger) !important; }

    /* ═══ Content ═══ */
    .l-content { background: var(--app-bg); color: var(--text); }

    .l-toolbar {
      position: sticky; top: 0; z-index: 10;
      height: 58px !important;
      background: var(--topbar-bg, rgba(248, 250, 252, 0.86)) !important;
      backdrop-filter: blur(18px) !important;
      -webkit-backdrop-filter: blur(18px) !important;
      border-bottom: 1px solid var(--border) !important;
      padding: 0 20px !important;
      gap: 8px;
      overflow: hidden;
      display: flex !important;
      flex-wrap: nowrap !important;
    }
    .l-burger { color: var(--text) !important; flex-shrink: 0; }
    .l-toolbar-left { display: flex; flex-direction: column; justify-content: center; min-width: 0; overflow: hidden; }
    .l-toolbar-title { font-size: 16px; font-weight: 900; letter-spacing: -0.01em; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .l-toolbar-sub { font-size: 11px; color: var(--text-muted); line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .l-spacer { flex: 1 1 auto; min-width: 4px; }

    .l-topbtn { color: var(--text-muted) !important; border-radius: 10px !important; flex-shrink: 0; }
    .l-topbtn:hover { color: var(--text) !important; background: var(--panel) !important; }

    .l-admin-bridge-top {
      height: 36px !important;
      border-radius: 999px !important;
      background: #ecfdf5 !important;
      border: 1px solid rgba(4,120,87,0.24) !important;
      color: #07533f !important;
      font-size: 12px !important;
      font-weight: 800 !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 5px !important;
      flex-shrink: 0;
    }
    .l-admin-bridge-top mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }

    .l-staff-bridge-top {
      height: 36px !important;
      border-radius: 999px !important;
      background: #f0f9ff !important;
      border: 1px solid rgba(7,89,133,0.22) !important;
      color: #075985 !important;
      font-size: 12px !important;
      font-weight: 800 !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 5px !important;
      flex-shrink: 0;
    }
    .l-staff-bridge-top mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }

    .l-userbtn {
      display: flex; align-items: center; gap: 8px;
      border-radius: 12px !important;
      padding: 5px 10px 5px 6px !important;
      background: var(--panel) !important;
      border: 1px solid var(--border) !important;
      color: var(--text) !important;
      font-size: 13px !important;
      font-weight: 700 !important;
      transition: background 150ms ease, border-color 150ms ease !important;
      flex-shrink: 0;
    }
    .l-userbtn:hover { background: var(--panel-2) !important; border-color: var(--border-strong) !important; }

    .l-avatar-sm {
      width: 26px; height: 26px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 900; color: #fff;
      flex-shrink: 0;
      overflow: hidden;
    }
    .l-avatar-sm--photo { background: var(--panel-2); }
    .l-avatar-sm img { width: 100%; height: 100%; object-fit: cover; }
    .l-user-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .l-chevron { font-size: 18px !important; width: 18px !important; opacity: 0.7; }

    /* Menu header */
    .l-menu-header {
      padding: 12px 16px 10px;
    }
    .l-menu-name  { font-size: 14px; font-weight: 800; color: var(--text); }
    .l-menu-role  { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
    .l-menu-org   { font-size: 11px; color: var(--text-subtle); margin-top: 1px; }
    .l-menu-logout { color: var(--danger) !important; }

    /* Page area */
    .l-page {
      padding: 24px 22px;
      min-height: calc(100vh - 58px);
    }

    @media (max-width: 900px) {
      .l-page { padding: 14px 12px; }
      .l-user-name { display: none; }
      .l-chevron { display: none; }
    }

    @media (max-width: 520px) {
      .l-toolbar { padding: 0 10px !important; gap: 6px; }
      .l-toolbar-sub { display: none; }
      .l-bridge-label { display: none; }
      .l-admin-bridge-top, .l-staff-bridge-top { width: 36px !important; padding: 0 !important; justify-content: center !important; }
      .l-admin-bridge-top mat-icon, .l-staff-bridge-top mat-icon { margin: 0; }
      .l-userbtn { padding: 4px !important; gap: 0 !important; }
    }
  `]
})
export class AppLayoutComponent implements OnDestroy {
  opened = true;
  isMobile = signal<boolean>(false);
  private resizeListener: (() => void) | null = null;
  private routerSub: any;

  currentRoute = signal<string>('/app/dashboard');
  shellMode = signal<ShellMode>('staff');

  workspaceNav: NavItem[] = [
    { label: 'Dashboard',        link: '/app/dashboard',    icon: 'dashboard',      section: 'workspace' },
    { label: 'Onboarding',       link: '/app/onboarding',   icon: 'task_alt',       section: 'workspace' },
    { label: 'My Schedule',      link: '/app/schedule',     icon: 'event',          section: 'workspace' },
    { label: 'Shift Marketplace',link: '/app/marketplace',  icon: 'storefront',     section: 'workspace' },
    { label: 'Time & Attendance',link: '/app/attendance',   icon: 'schedule',       section: 'workspace' },
    { label: 'My Accruals',      link: '/app/accruals',     icon: 'beach_access',  section: 'workspace' },
    { label: 'My Payroll',       link: '/app/payroll',      icon: 'payments',      section: 'workspace' },
    { label: 'My Profile',       link: '/app/profile',      icon: 'account_circle',section: 'workspace' },
    { label: 'Document Center',   link: '/app/documents',    icon: 'folder_shared', section: 'workspace' },
    { label: 'Message Center',   link: '/app/messages',     icon: 'forum',          section: 'workspace' },
    { label: 'Shift Live Chat',  link: '/app/shift-chat',   icon: 'chat',           section: 'workspace' },
    { label: 'Notifications',    link: '/app/notifications',icon: 'notifications',  section: 'workspace' },
  ];

  adminNav: NavItem[] = [
    { label: 'Admin Dashboard',  link: '/admin',                  icon: 'admin_panel_settings', section: 'admin', adminOnly: true, feature: 'adminAnalytics' },
    { label: 'Employees',        link: '/admin/employees',        icon: 'people',               section: 'admin', adminOnly: true },
    { label: 'Schedule Details', link: '/admin/schedule-details', icon: 'event_note',           section: 'admin', adminOnly: true },
    { label: 'Scheduler',        link: '/admin/scheduler',        icon: 'calendar_month',       section: 'admin', adminOnly: true, feature: 'smartScheduler' },
    { label: 'AI Copilot',       link: '/admin/ai-copilot',       icon: 'auto_awesome',         section: 'admin', adminOnly: true, feature: 'aiCopilot' },
    { label: 'Timesheets',       link: '/admin/timesheets',       icon: 'receipt_long',         section: 'admin', adminOnly: true, feature: 'timesheetsExport' },
    { label: 'PTO Requests',      link: '/admin/pto',              icon: 'event_available',      section: 'admin', adminOnly: true, roles: ['admin', 'hr'] },
    { label: 'Documents',         link: '/admin/documents',        icon: 'folder_shared',        section: 'admin', adminOnly: true, roles: ['admin', 'hr'] },
    { label: 'Launch Readiness',  link: '/admin/readiness',        icon: 'health_and_safety',    section: 'admin', adminOnly: true },
    { label: 'Payroll',          link: '/admin/payroll',          icon: 'payments',             section: 'admin', adminOnly: true, feature: 'timesheetsExport', roles: ['admin', 'hr'] },
    { label: 'Audit Log',        link: '/admin/audit',            icon: 'history',              section: 'admin', adminOnly: true, feature: 'auditLog' },
    { label: 'Org Settings',     link: '/admin/org-settings',     icon: 'business',             section: 'admin', adminOnly: true },
  ];

  platformNav: NavItem[] = [
    { label: 'Platform Console', link: '/platform', icon: 'shield', section: 'platform', superAdminOnly: true },
  ];

  constructor(private ctx: OrgContextService, private plans: PlanEntitlementsService, private router: Router, private route: ActivatedRoute) {
    const mode = this.route.snapshot.data?.['shellMode'] as ShellMode | undefined;
    this.shellMode.set(mode ?? 'staff');

    if (typeof window !== 'undefined') {
      this.isMobile.set(window.innerWidth < 900);
      this.opened = window.innerWidth >= 900;
      this.resizeListener = () => {
        const mobile = window.innerWidth < 900;
        this.isMobile.set(mobile);
        if (mobile && this.opened) this.opened = false;
        if (!mobile && !this.opened) this.opened = true;
      };
      window.addEventListener('resize', this.resizeListener);
    }

    this.routerSub = this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe((e: any) => {
      this.currentRoute.set(e.urlAfterRedirects);
      if (this.isMobile()) this.opened = false;
    });
  }

  ngOnDestroy() {
    if (this.resizeListener && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeListener);
    }
    this.routerSub?.unsubscribe?.();
  }

  orgId           = computed(() => this.ctx.orgId());
  uid             = computed(() => this.ctx.uid());
  accessRole      = computed(() => this.ctx.accessRole());
  platformRole    = computed(() => this.ctx.platformRole());

  isAdminLike = computed(() => {
    const r = this.ctx.accessRole();
    return ['admin','manager','scheduler','hr'].includes(r ?? '');
  });
  isSuperAdmin = computed(() => this.ctx.platformRole() === 'superAdmin');
  visibleAdminNav = computed(() => this.adminNav.filter((item) =>
    (!item.feature || this.plans.has(item.feature)) &&
    (!item.roles || item.roles.includes(this.accessRole() ?? ''))
  ));

  shellBrand = computed(() => {
    switch (this.shellMode()) {
      case 'admin': return 'ORG ADMIN';
      case 'platform': return 'PLATFORM';
      default: return 'INNOVASHIFT';
    }
  });

  shellSubtitle = computed(() => {
    if (this.shellMode() === 'platform') return 'Super Admin Console';
    return this.orgLabel();
  });

  settingsLink = computed(() => {
    switch (this.shellMode()) {
      case 'admin': return '/admin/settings';
      case 'platform': return '/platform/settings';
      default: return '/app/settings';
    }
  });

  orgLabel = computed(() => {
    const org = this.ctx.orgId();
    return org ? 'Organization workspace' : 'No Organization';
  });

  userDisplayName = computed(() => {
    const uid = this.ctx.uid();
    if (!uid) return 'Guest';
    return this.ctx.displayName?.() || this.ctx.email?.() || 'User';
  });

  avatarUrl = computed(() => this.ctx.photoURL());

  avatarInitials = computed(() => {
    const name = this.userDisplayName();
    if (!name || name === 'Guest') return 'G';
    const parts = name.split(' ');
    return parts.length > 1
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  });

  roleLabel = computed(() => {
    const r = this.ctx.accessRole();
    const p = this.ctx.platformRole();
    if (p === 'superAdmin') return 'Super Admin';
    const map: Record<string, string> = {
      admin: 'Administrator', manager: 'Manager',
      scheduler: 'Scheduler', hr: 'HR', staff: 'Staff'
    };
    return map[r ?? ''] ?? (r ?? 'Employee');
  });

  pageTitle = computed(() => {
    const route = this.currentRoute();
    if (route.startsWith('/admin/employees/')) return 'Employee Details';
    // Match longest prefix
    const match = Object.keys(ROUTE_TITLES)
      .filter(k => route === k || route.startsWith(k + '/'))
      .sort((a, b) => b.length - a.length)[0];
    return match ? ROUTE_TITLES[match] : 'INNOVASHIFT';
  });

  toggleSidenav() { this.opened = !this.opened; }

  async logout() {
    try {
      await signOut(getAuth());
    } catch { /* ignore */ }
    this.ctx.setContext({ orgId: null, uid: null, accessRole: null, platformRole: null });
    await this.router.navigateByUrl('/login');
  }
}
