import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { config } from './app/app.config.server';
import { initFirebaseApp } from './app/core/firebase/firebase.app';

// Mirrors main.ts: AuthService's `getAuth()` field initializer throws
// "no app" unless a Firebase app has already been registered. Only
// `initializeApp()` itself runs here — the persistent IndexedDB Firestore
// cache it also sets up is best-effort and already wrapped in a try/catch,
// so it's a silent no-op in Node.
initFirebaseApp();

const bootstrap = (context: BootstrapContext) => bootstrapApplication(AppComponent, config, context);

export default bootstrap;
