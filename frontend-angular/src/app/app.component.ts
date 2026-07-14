import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ModalHostComponent } from './shared/ui/modal/modal-host.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ModalHostComponent],
  template: `
    <router-outlet></router-outlet>
    <app-modal-host></app-modal-host>
  `
})
export class AppComponent {}
