import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ModalHostComponent } from './shared/ui/modal/modal-host.component';
import { AppLockOverlayComponent } from './core/app-lock/app-lock-overlay.component';
import { OfflineBannerComponent } from './core/connectivity/offline-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ModalHostComponent, AppLockOverlayComponent, OfflineBannerComponent],
  template: `
    <router-outlet></router-outlet>
    <app-modal-host></app-modal-host>
    <app-lock-overlay></app-lock-overlay>
    <app-offline-banner></app-offline-banner>
  `
})
export class AppComponent {}
