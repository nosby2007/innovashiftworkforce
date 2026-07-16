import { Routes } from '@angular/router';
import { AppLayoutComponent } from './layout/app-shell/app-shell.component';
import { adminGuard } from './core/auth/admin.guard';
import { superAdminGuard } from './core/auth/super-admin.guard';
import { authGuard } from './core/auth/auth.guard';
import { planFeatureGuard } from './core/auth/plan-feature.guard';

// Eagerly-loaded app page components
import { SchedulePage }     from './features/schedule/schedule.page';
import { MarketplacePage }  from './features/marketplace/marketplace.page';
import { AttendancePage }   from './features/attendance/attendance.page';
import { MessagesPage }     from './features/messages/messages.page';
import { ShiftChatPage }    from './features/messages/shift-chat.page';
import { NotificationsPage }from './features/notifications/notifications.page';
import { AccrualsPage }     from './features/accruals/accruals.page';
import { StaffPayrollPage } from './features/payroll/staff-payroll.page';
import { PayslipPrintPage } from './features/payroll/payslip-print.page';
import { StaffProfilePage } from './features/profile/staff-profile.page';
import { StaffDocumentsPage } from './features/documents/staff-documents.page';
import { StaffOnboardingPage } from './features/onboarding/staff-onboarding.page';

import { SuperAdminDashboardPage } from './features/super-admin/super-admin-dashboard.page';

import { AdminAuditPage }          from './features/admin/admin-audit.page';
import { AiCopilotPage }           from './features/admin/ai-copilot.page';
import { AdminDashboardPage }      from './features/admin/admin-dashboard.page';
import { AdminSchedulerPage }      from './features/admin/admin-scheduler.page';
import { AdminShiftCreatePage }    from './features/admin/admin-shift-create.page';
import { AdminTimesheetsPrintPage} from './features/admin/admin-timesheets-print.page';
import { AdminTimesheetsPage }     from './features/admin/admin-timesheets.page';
import { AdminPayrollPage }        from './features/admin/admin-payroll.page';
import { AdminPayrollBatchPrintPage } from './features/admin/admin-payroll-batch-print.page';
import { AdminPtoPage }            from './features/admin/admin-pto.page';
import { AdminDocumentsPage }      from './features/admin/admin-documents.page';
import { AdminReadinessPage }      from './features/admin/admin-readiness.page';
import { AdminEmployeesPage }      from './features/admin/admin-employees.page';
import { AdminEmployeeDetailsPage }from './features/admin/admin-employee-details.page';
import { AdminOrgSettingsPage }    from './features/admin/admin-org-settings.page';
import { AdminScheduleDetailsPage } from './features/admin/admin-schedule-details.page';
import { AdminScheduleDetailsPrintPage } from './features/admin/admin-schedule-details-print.page';

// Public page components
import { PublicLayoutComponent } from './features/public/public-layout/public-layout.component';
import { LandingPage }  from './features/public/landing/landing.page';
import { FeaturesPage } from './features/public/features/features.page';
import { PricingPage }  from './features/public/pricing/pricing.page';
import { ContactPage }  from './features/public/contact/contact.page';

export const APP_ROUTES: Routes = [

  // ── Dedicated print windows (no shell chrome) ────────────────────────────
  {
    path: 'print/payslip',
    component: PayslipPrintPage,
    canActivate: [authGuard],
  },
  {
    path: 'print/timesheets',
    component: AdminTimesheetsPrintPage,
    canActivate: [authGuard, adminGuard, planFeatureGuard('timesheetsExport', '/admin')],
  },
  {
    path: 'print/schedule-details',
    component: AdminScheduleDetailsPrintPage,
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'print/payroll-batch',
    component: AdminPayrollBatchPrintPage,
    canActivate: [authGuard, adminGuard, planFeatureGuard('timesheetsExport', '/admin')],
  },

  // ── Public (no auth required) ──────────────────────────────────────────────
  {
    path: '',
    component: PublicLayoutComponent,
    children: [
      { path: '',         component: LandingPage,  pathMatch: 'full' },
      { path: 'features', component: FeaturesPage },
      { path: 'pricing',  component: PricingPage },
      { path: 'contact',  component: ContactPage },
    ],
  },

  // ── Auth ────────────────────────────────────────────────────────────────────
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./features/auth/forgot-password.component').then(m => m.ForgotPasswordComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register.component').then(m => m.RegisterComponent),
  },

  // ── Authenticated app shell (/app/…) ────────────────────────────────────────
  {
    path: 'app',
    component: AppLayoutComponent,
    canActivate: [authGuard],
    data: { shellMode: 'staff' },
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

      // ── Employee workspace ─────────────────────────────────────────────────
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/employee-dashboard.page').then(m => m.EmployeeDashboardPage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.component').then(m => m.SettingsComponent),
      },
      { path: 'schedule',      component: SchedulePage },
      { path: 'onboarding',    component: StaffOnboardingPage },
      { path: 'marketplace',   component: MarketplacePage },
      { path: 'attendance',    component: AttendancePage },
      { path: 'accruals',      component: AccrualsPage },
      { path: 'payroll',       component: StaffPayrollPage },
      { path: 'payroll/payslip', component: PayslipPrintPage },
      { path: 'profile',       component: StaffProfilePage },
      { path: 'documents',     component: StaffDocumentsPage },
      { path: 'messages',      component: MessagesPage },
      { path: 'shift-chat',    component: ShiftChatPage },
      { path: 'notifications', component: NotificationsPage },
      { path: 'admin', redirectTo: '/admin', pathMatch: 'full' },
      { path: 'admin/shifts/new', redirectTo: '/admin/shifts/new', pathMatch: 'full' },
      { path: 'admin/scheduler', redirectTo: '/admin/scheduler', pathMatch: 'full' },
      { path: 'admin/timesheets', redirectTo: '/admin/timesheets', pathMatch: 'full' },
      { path: 'admin/payroll', redirectTo: '/admin/payroll', pathMatch: 'full' },
      { path: 'admin/documents', redirectTo: '/admin/documents', pathMatch: 'full' },
      { path: 'admin/readiness', redirectTo: '/admin/readiness', pathMatch: 'full' },
      { path: 'admin/timesheets/print', redirectTo: '/admin/timesheets/print', pathMatch: 'full' },
      { path: 'admin/audit', redirectTo: '/admin/audit', pathMatch: 'full' },
      { path: 'admin/employees', redirectTo: '/admin/employees', pathMatch: 'full' },
      { path: 'admin/employees/:uid', redirectTo: '/admin/employees/:uid', pathMatch: 'full' },
      { path: 'admin/schedule-details', redirectTo: '/admin/schedule-details', pathMatch: 'full' },
      { path: 'admin/org-settings', redirectTo: '/admin/org-settings', pathMatch: 'full' },
      { path: 'super-admin', redirectTo: '/platform', pathMatch: 'full' },
    ],
  },

  // ── Organization admin shell (/admin/…) ───────────────────────────────────
  {
    path: 'admin',
    component: AppLayoutComponent,
    canActivate: [authGuard, adminGuard],
    data: { shellMode: 'admin' },
    children: [
      { path: '',                     component: AdminDashboardPage,      canActivate: [planFeatureGuard('adminAnalytics', '/admin')] },
      { path: 'shifts/new',           component: AdminShiftCreatePage },
      { path: 'scheduler',            component: AdminSchedulerPage,      canActivate: [planFeatureGuard('smartScheduler', '/admin')] },
      { path: 'timesheets',           component: AdminTimesheetsPage,     canActivate: [planFeatureGuard('timesheetsExport', '/admin')] },
      { path: 'payroll',              component: AdminPayrollPage,        canActivate: [planFeatureGuard('timesheetsExport', '/admin')] },
      { path: 'pto',                  component: AdminPtoPage },
      { path: 'documents',            component: AdminDocumentsPage },
      { path: 'readiness',            component: AdminReadinessPage },
      { path: 'payroll/payslip',      component: PayslipPrintPage,        canActivate: [planFeatureGuard('timesheetsExport', '/admin')] },
      { path: 'timesheets/print',     component: AdminTimesheetsPrintPage,canActivate: [planFeatureGuard('timesheetsExport', '/admin')] },
      { path: 'audit',                component: AdminAuditPage,          canActivate: [planFeatureGuard('auditLog', '/admin')] },
      { path: 'ai-copilot',           component: AiCopilotPage,           canActivate: [planFeatureGuard('aiCopilot', '/admin')] },
      { path: 'employees',            component: AdminEmployeesPage },
      { path: 'employees/:uid',       component: AdminEmployeeDetailsPage },
      { path: 'schedule-details',     component: AdminScheduleDetailsPage },
      { path: 'org-settings',         component: AdminOrgSettingsPage },
      { path: 'settings',             loadComponent: () => import('./features/settings/settings.component').then(m => m.SettingsComponent) },
    ],
  },

  // ── Platform owner shell (/platform/…) ────────────────────────────────────
  {
    path: 'platform',
    component: AppLayoutComponent,
    canActivate: [authGuard, superAdminGuard],
    data: { shellMode: 'platform' },
    children: [
      { path: '',         component: SuperAdminDashboardPage },
      { path: 'settings', loadComponent: () => import('./features/settings/settings.component').then(m => m.SettingsComponent) },
    ],
  },

  // ── Fallback ────────────────────────────────────────────────────────────────
  { path: '**', redirectTo: '' },
];
