import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { buildSparklinePath } from '../../utils/sparkline.util';

/** Small inline-SVG line + area trend chart. Pure CSS/SVG, no charting dependency. */
@Component({
  selector: 'app-trend-sparkline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg
      class="ts-svg"
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
      preserveAspectRatio="none"
      animate.enter="vs-fade-in"
      *ngIf="data.length > 0; else tsEmpty">
      <path class="ts-area" [attr.d]="paths().areaPath" [style.fill]="color"></path>
      <path class="ts-line" [attr.d]="paths().linePath" [style.stroke]="color"></path>
    </svg>
    <ng-template #tsEmpty>
      <div class="ts-empty">{{ emptyLabel }}</div>
    </ng-template>
  `,
  styles: [`
    .ts-svg { display: block; width: 100%; height: 100%; }
    .ts-area { opacity: 0.16; }
    .ts-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .ts-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 12px; }
  `],
})
export class TrendSparklineComponent {
  @Input() data: number[] = [];
  @Input() color = 'var(--primary)';
  @Input() width = 300;
  @Input() height = 64;
  @Input() emptyLabel = 'Collecting data…';

  paths() {
    return buildSparklinePath(this.data, this.width, this.height);
  }
}
