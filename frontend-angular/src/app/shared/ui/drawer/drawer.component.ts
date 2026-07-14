import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-drawer',
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="open">
      <div class="backdrop" (click)="close.emit()"></div>
      <div class="drawer">
        <div class="header">
          <div class="title">{{ title }}</div>
          <button class="x" (click)="close.emit()">×</button>
        </div>
        <div class="body">
          <ng-content></ng-content>
        </div>
      </div>
    </ng-container>
  `,
  styles: [`
    .backdrop{position:fixed;inset:0;background:rgba(2,6,23,.62);backdrop-filter:blur(2px);z-index:1000;}
    .drawer{position:fixed;z-index:1001;right:0;top:0;height:100%;width:min(520px,92vw);
      background:var(--bg-elevated);color:var(--text);border-left:1px solid var(--border);box-shadow:-18px 0 48px rgba(0,0,0,.45);display:flex;flex-direction:column;}
    .header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--panel);}
    .title{font-weight:900;color:var(--text);}
    .x{border:1px solid var(--border);color:var(--text);border-radius:10px;background:var(--panel);padding:4px 10px;cursor:pointer;font-size:18px;line-height:18px;}
    .x:hover{background:var(--panel-2);border-color:var(--border-strong);}
    .body{padding:14px;overflow:auto;flex:1;}
  `]
})
export class DrawerComponent {
  @Input() open = false;
  @Input() title = '';
  @Output() close = new EventEmitter<void>();
}
