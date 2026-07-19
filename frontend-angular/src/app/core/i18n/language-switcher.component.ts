import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { LanguageService } from './language.service';

@Component({
  selector: 'app-language-switcher',
  standalone: true,
  imports: [CommonModule, MatMenuModule, MatIconModule, MatTooltipModule, TranslocoModule],
  template: `
    <button mat-icon-button class="lang-switch-btn" [matMenuTriggerFor]="langMenu"
            [matTooltip]="'shell.language' | transloco" matTooltipPosition="below"
            [attr.aria-label]="'shell.language' | transloco">
      <mat-icon>translate</mat-icon>
    </button>
    <mat-menu #langMenu="matMenu">
      <button mat-menu-item *ngFor="let opt of lang.options"
              [class.is-active-lang]="opt.code === activeLang()"
              (click)="select(opt.code)">
        <span>{{ opt.label }}</span>
        <mat-icon *ngIf="opt.code === activeLang()" class="lang-check">check</mat-icon>
      </button>
    </mat-menu>
  `,
  styles: [`
    .lang-switch-btn { color: inherit; }
    button[mat-menu-item] { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .lang-check { font-size: 18px; width: 18px; height: 18px; color: var(--primary); }
  `],
})
export class LanguageSwitcherComponent {
  lang = inject(LanguageService);
  private transloco = inject(TranslocoService);

  activeLang() {
    return this.transloco.getActiveLang();
  }

  select(code: string) {
    void this.lang.setLanguage(code);
  }
}
