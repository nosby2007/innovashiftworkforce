import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { initFirebaseApp } from './app/core/firebase/firebase.app';
import 'zone.js';

// Initialize Firebase App
initFirebaseApp();

bootstrapApplication(AppComponent, appConfig).catch(console.error);
