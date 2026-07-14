import * as admin from 'firebase-admin';
import { getApps, initializeApp } from 'firebase-admin/app';

let inited = false;

export function initFirebase() {
  if (!inited) {
    if (getApps().length === 0) {
      initializeApp();
    }
    inited = true;
  }
  return admin; // IMPORTANT: on retourne le namespace firebase-admin, pas l'app
}
