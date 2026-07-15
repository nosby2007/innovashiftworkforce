import { bootstrapApplication } from '@angular/platform-browser';
import { defineCustomElements } from '@ionic/pwa-elements/loader';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { initFirebaseApp } from './app/core/firebase/firebase.app';
import 'zone.js';

// Initialize Firebase App
initFirebaseApp();

// Gives @capacitor/camera a real live-preview camera modal on the web
// (desktop or mobile browser) instead of falling back to a bare file input.
void defineCustomElements(window);

bootstrapApplication(AppComponent, appConfig).catch(console.error);
