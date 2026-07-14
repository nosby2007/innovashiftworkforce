import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalService, ModalRef } from './modal.service';


@Component({
  standalone: true,
  selector: 'app-modal-host',
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="ref as r">
      <div class="backdrop" (click)="close()"></div>
      <div class="panel" role="dialog" aria-modal="true">
        <div class="header">
          <div class="title">{{ r.title }}</div>
          <button class="x" (click)="close()">×</button>
        </div>
        <div class="body">
          <ng-container *ngTemplateOutlet="r.tpl; context: r.context"></ng-container>
        </div>
      </div>
    </ng-container>
  `,
  styles: [`
    .backdrop{position:fixed;inset:0;background:rgba(2,6,23,.55);z-index:1000;}
    .panel{position:fixed;z-index:1001;left:50%;top:10%;transform:translateX(-50%);width:min(920px,92vw);max-height:80vh;
      background:var(--panel, #0f172a);color:var(--text, #e5e7eb);border:1px solid var(--border, #334155);border-radius:12px;box-shadow:0 16px 50px rgba(0,0,0,.45);display:flex;flex-direction:column;}
    .header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border, #334155);}
    .title{font-weight:900;color:var(--text, #e5e7eb);}
    .x{border:1px solid var(--border, #334155);border-radius:10px;background:var(--panel-2, #111827);color:var(--text, #e5e7eb);padding:4px 10px;cursor:pointer;font-size:18px;line-height:18px;}
    .body{padding:14px;overflow:auto;}
  `]
})
export class ModalHostComponent {
  ref: ModalRef | null = null;
  constructor(private modal: ModalService) {
    this.modal.ref$.subscribe(r => this.ref = r);
  }
  close(){ this.modal.close(); }
}
