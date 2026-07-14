import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div style="display:grid;grid-template-columns:260px 1fr;gap:14px;align-items:start;">
      <!-- Sidebar -->
      <aside style="border:1px solid var(--border);border-radius:16px;padding:12px;background:var(--panel);">
        <div style="font-weight:900;font-size:16px;margin-bottom:10px;">Admin</div>

        <nav style="display:flex;flex-direction:column;gap:8px;">
          <a routerLink="/admin" routerLinkActive="active" [routerLinkActiveOptions]="{ exact:true }"
             style="padding:10px 12px;border-radius:12px;text-decoration:none;color:var(--text);border:1px solid transparent;">
            Dashboard
          </a>

          <a routerLink="/admin/shifts/new" routerLinkActive="active"
             style="padding:10px 12px;border-radius:12px;text-decoration:none;color:var(--text);border:1px solid transparent;">
            Create Shift
          </a>

          <a routerLink="/admin/scheduler" routerLinkActive="active"
             style="padding:10px 12px;border-radius:12px;text-decoration:none;color:var(--text);border:1px solid transparent;">
            Scheduler
          </a>

          <a routerLink="/admin/timesheets" routerLinkActive="active"
             style="padding:10px 12px;border-radius:12px;text-decoration:none;color:var(--text);border:1px solid transparent;">
            Timesheets
          </a>

          <a routerLink="/admin/audit" routerLinkActive="active"
             style="padding:10px 12px;border-radius:12px;text-decoration:none;color:var(--text);border:1px solid transparent;">
            Audit
          </a>
        </nav>

        <style>
          a.active {
            background: rgba(255,255,255,0.08);
            border-color: var(--border);
          }
        </style>
      </aside>

      <!-- Content -->
      <main style="min-width:0;">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
})
export class AdminShellPage {}
