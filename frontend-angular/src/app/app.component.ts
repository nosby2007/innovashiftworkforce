import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ModalHostComponent } from './shared/ui/modal/modal-host.component';
import { AppLockOverlayComponent } from './core/app-lock/app-lock-overlay.component';
import { OfflineBannerComponent } from './core/connectivity/offline-banner.component';
import { SandboxBannerComponent } from './core/sandbox/sandbox-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ModalHostComponent, AppLockOverlayComponent, OfflineBannerComponent, SandboxBannerComponent],
  template: `
    <router-outlet></router-outlet>
    <app-modal-host></app-modal-host>
    <app-lock-overlay></app-lock-overlay>
    <app-offline-banner></app-offline-banner>
    <app-sandbox-banner></app-sandbox-banner>
  `
})
export class AppComponent {}
