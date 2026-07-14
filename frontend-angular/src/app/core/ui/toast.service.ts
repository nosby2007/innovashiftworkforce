import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { formatSupportError } from '../../shared/utils/support-error.util';

@Injectable({ providedIn: 'root' })
export class ToastService {
  constructor(private snackBar: MatSnackBar) {}

  success(message: string, duration = 3600) {
    this.snackBar.open(message, 'OK', {
      duration,
      horizontalPosition: 'right',
      verticalPosition: 'top',
      panelClass: ['vs-snack', 'vs-snack--success'],
    });
  }

  error(message: string, duration = 5200) {
    this.snackBar.open(message, 'OK', {
      duration,
      horizontalPosition: 'right',
      verticalPosition: 'top',
      panelClass: ['vs-snack', 'vs-snack--error'],
    });
  }

  errorFrom(error: any, fallback: string, duration = 6200) {
    const formatted = formatSupportError(error, fallback);
    this.error(
      `${formatted.message} [${formatted.code}] [Ref: ${formatted.correlationId}]`,
      duration
    );

    console.error('[SupportError]', {
      correlationId: formatted.correlationId,
      code: formatted.code,
      message: formatted.message,
      fallback,
      originalError: error,
    });
  }

  info(message: string, duration = 4200) {
    this.snackBar.open(message, 'OK', {
      duration,
      horizontalPosition: 'right',
      verticalPosition: 'top',
      panelClass: ['vs-snack', 'vs-snack--info'],
    });
  }
}
