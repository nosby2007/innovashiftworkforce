import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ConnectivityService } from './connectivity.service';
import { OrgContextService } from '../tenancy/org-context.service';

@Component({
  standalone: true,
  selector: 'app-offline-banner',
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="ob-banner" *ngIf="!connectivity.online() && ctx.uid()">
      <mat-icon>cloud_off</mat-icon>
      <span>You're offline — showing saved data. Actions like clocking in/out need a connection.</span>
    </div>
  `,
  styles: [`
    .ob-banner {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 4000;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 9px 14px calc(9px + env(safe-area-inset-bottom, 0px));
      background: #b45309; color: #fff; font-size: 12px; font-weight: 700; text-align: center;
      box-shadow: 0 -4px 14px rgba(0,0,0,.18);
    }
    .ob-banner mat-icon { flex-shrink: 0; font-size: 16px; width: 16px; height: 16px; }
  `],
})
export class OfflineBannerComponent {
  constructor(public connectivity: ConnectivityService, public ctx: OrgContextService) {}
}
