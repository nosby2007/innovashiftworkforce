import { ApplicationConfig, APP_INITIALIZER, ErrorHandler, importProvidersFrom, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideTransloco } from '@jsverse/transloco';

import { APP_ROUTES } from './app.routes';

import { ThemeService } from './core/theme/theme.service';
import { SessionBootstrapService } from './core/auth/session-bootstrap.service';
import { GlobalErrorHandler } from './core/error-handling/global-error-handler';
import { AppUpdateService } from './core/pwa/app-update.service';
import { LanguageService } from './core/i18n/language.service';
import { TranslocoHttpLoader } from './core/i18n/transloco-http-loader';

// Material modules you want globally
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDatepickerInputEvent } from '@angular/material/datepicker';
import { ModalHostComponent } from './shared/ui/modal/modal-host.component';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(APP_ROUTES),
    provideHttpClient(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideTransloco({
      config: {
        availableLangs: ['en', 'fr'],
        defaultLang: 'en',
        fallbackLang: 'en',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: TranslocoHttpLoader,
    }),

    importProvidersFrom(
      MatToolbarModule,
      MatSidenavModule,
      MatIconModule,
      MatButtonModule,
      MatMenuModule,
      MatCardModule,
      MatFormFieldModule,
      MatSelectModule,
      MatDatepickerModule,
      MatNativeDateModule,
      MatSnackBarModule,
      ModalHostComponent
    ),

    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [ThemeService],
      useFactory: (theme: ThemeService) => () => theme.init(),
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [LanguageService],
      useFactory: (language: LanguageService) => () => language.init(),
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [SessionBootstrapService],
      useFactory: (session: SessionBootstrapService) => () => session.start(),
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [AppUpdateService],
      useFactory: (appUpdate: AppUpdateService) => () => appUpdate.init(),
    },
    provideClientHydration(withEventReplay()),
  ],
};
